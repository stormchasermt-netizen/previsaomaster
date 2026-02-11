import { PREVISAO_SCORING } from './constants';
import type { StormReport, PrevisaoDifficulty, PrevisaoEvent } from './types';

// --- EVENT ROTATION (prevents repeating the same event) ---
const recentEventIds: string[] = []; // Circular buffer of recently played event IDs
const MAX_RECENT = 5; // Remember last 5 events

export function pickRandomEvent(activeEvents: PrevisaoEvent[], currentEventId?: string | null): PrevisaoEvent | null {
  if (activeEvents.length === 0) return null;
  if (activeEvents.length === 1) return activeEvents[0];

  // Filter out recently played events (and the current one if provided)
  let candidates = activeEvents.filter(e => 
    !recentEventIds.includes(e.id) && e.id !== currentEventId
  );
  
  // If all events were recently played, just exclude the current one
  if (candidates.length === 0) {
    candidates = activeEvents.filter(e => e.id !== currentEventId);
  }
  
  // If still empty (only 1 event total), use all
  if (candidates.length === 0) {
    candidates = activeEvents;
  }

  const picked = candidates[Math.floor(Math.random() * candidates.length)];
  
  // Track in recent list
  recentEventIds.push(picked.id);
  if (recentEventIds.length > MAX_RECENT) {
    recentEventIds.shift(); // Remove oldest
  }

  return picked;
}

export function distanceKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371; 
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function minDistanceToReports(
  forecastLat: number,
  forecastLng: number,
  reports: StormReport[]
): number {
  if (reports.length === 0) return 99999;
  return Math.min(
    ...reports.map((r) => distanceKm(forecastLat, forecastLng, r.lat, r.lng))
  );
}

export function isGoodForecastForStreak(distanceKm: number): boolean {
  return distanceKm <= PREVISAO_SCORING.STREAK_THRESHOLD_KM;
}

export function streakBonusPercent(streakCount: number): number {
  if (streakCount >= 7) return PREVISAO_SCORING.STREAK_BONUS_MAX;
  if (streakCount <= 0) return 0;
  return Math.min(PREVISAO_SCORING.STREAK_BONUS_MAX, (streakCount / 7) * PREVISAO_SCORING.STREAK_BONUS_MAX);
}

/**
 * HELPER: Normalize Report Type
 * CRITICAL FIX: Default must be 'vento' (low score). 
 * Only return 'tornado' if explicitly detected.
 */
export function normalizeReportType(rawType?: string): 'tornado' | 'vento' | 'granizo' {
    const t = rawType ? rawType.toLowerCase().trim() : '';
    
    // Explicit Tornado Check
    if (t.includes('tornado') || t.includes('torn') || t.includes('landspout')) return 'tornado';
    
    // Explicit Hail Check
    if (t.includes('granizo') || t.includes('hail')) return 'granizo';
    
    // Default fallback (Wind/Unknown) - Safer for scoring
    return 'vento'; 
}

/**
 * NEW SCORING ALGORITHM
 * 
 * Major Adjustments:
 * 1. "Highlander Rule": If there is a Tornado, NOTHING else matters for Precision score.
 * 2. Cluster Score: heavily nerved for non-tornadoes.
 */
export function computeScore(
  forecastLat: number,
  forecastLng: number,
  reports: StormReport[],
  difficulty: PrevisaoDifficulty,
  streakCount: number
): {
  basePoints: number;
  precisionScore: number;
  clusterScore: number;
  reportsCaught: number;
  difficultyMultiplier: number;
  streakBonus: number;
  finalScore: number;
  minDistance: number;
} {
  const maxRange = PREVISAO_SCORING.RADIUS_KM; // 100km

  // 1. Analyze Event Composition
  let hasTornado = false;
  let minDistanceToAnyTornado = 99999;
  let minDistanceToAny = 99999;

  // Pre-process reports with normalized types
  const processedReports = reports.map(r => {
      const type = normalizeReportType(r.type);
      const dist = distanceKm(forecastLat, forecastLng, r.lat, r.lng);
      
      if (dist < minDistanceToAny) minDistanceToAny = dist;
      
      if (type === 'tornado') {
          hasTornado = true;
          if (dist < minDistanceToAnyTornado) minDistanceToAnyTornado = dist;
      }
      return { ...r, type, dist }; // normalized
  });

  // 2. Calculate Precision Score
  // If a tornado exists, we ONLY calculate precision based on tornadoes.
  // This prevents "farming" points by landing on a wind report when the objective was a tornado.
  let bestPrecisionScore = 0;

  processedReports.forEach(r => {
      // Logic: If event has tornado, ignore non-tornadoes for precision calculation
      if (hasTornado && r.type !== 'tornado') return;

      if (r.dist < maxRange) {
          // Non-linear decay: (1 - dist/100)^3 (Sharper decay)
          const decayFactor = Math.pow(1 - (r.dist / maxRange), 3);
          
          const weight = PREVISAO_SCORING.REPORT_WEIGHTS[r.type];
          const points = PREVISAO_SCORING.PRECISION_MAX_POINTS * decayFactor * weight;
          
          if (points > bestPrecisionScore) {
              bestPrecisionScore = points;
          }
      }
  });

  // 3. Cluster Score (The "Circle")
  let clusterScore = 0;
  let reportsCaught = 0;

  processedReports.forEach(r => {
    if (r.dist <= maxRange) {
      reportsCaught++;
      // Linear decay for cluster points
      const decayFactor = 1 - (r.dist / maxRange);
      
      // Apply Weight based on type
      const weight = PREVISAO_SCORING.REPORT_WEIGHTS[r.type];

      clusterScore += PREVISAO_SCORING.CLUSTER_PER_REPORT_MAX * decayFactor * weight;
    }
  });

  // 4. Final Distance Determination (Strict Geometry)
  let finalMinDistance = hasTornado ? minDistanceToAnyTornado : minDistanceToAny;

  // Combine Base
  const rawBase = bestPrecisionScore + clusterScore;
  
  // Multipliers
  const diffMult = PREVISAO_SCORING.MULTIPLIERS[difficulty];
  const streakBonusPct = streakBonusPercent(streakCount);

  // Final Calc
  const finalScore = Math.round(rawBase * diffMult * (1 + streakBonusPct));

  return {
    basePoints: Math.round(rawBase),
    precisionScore: Math.round(bestPrecisionScore),
    clusterScore: Math.round(clusterScore),
    reportsCaught,
    minDistance: finalMinDistance,
    difficultyMultiplier: diffMult,
    streakBonus: streakBonusPct,
    finalScore
  };
}