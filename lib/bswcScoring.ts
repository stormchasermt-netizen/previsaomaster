/**
 * Lógica de pontuação BSWC – Previsão & Sondagens
 * Baseado no backend Wix original.
 */
import type { BswcScoreStats, BswcScoreboard } from '@/lib/types';

declare const turf: any;

const weights = { granizo: 5, vento: 7, tornado: 10 };
const ssBonus = { granizo: 2, vento: 3, tornado: 4 };
const outPenalty = { granizo: -3, vento: -3, tornado: -3 };

const pctByRisk = {
  granizo: { 1: 0.05, 2: 0.15, 3: 0.3, 4: 0.45 },
  vento: { 1: 0.05, 2: 0.15, 3: 0.3, 4: 0.45 },
  tornado: { 1: 0.02, 2: 0.05, 3: 0.1, 4: 0.15 },
};

const defW: Record<number, number> = { 1: 2, 2: 4, 3: 7, 4: 10 };

type PolygonFeature = {
  type: 'Feature';
  geometry: { type: 'Polygon'; coordinates: number[][][] };
  properties: { level: number; type?: string };
};

export function computeScoreboard(
  polygons: PolygonFeature[],
  reports: Array<{ lat: number; lng: number; hazard: string; sev: string }>
): BswcScoreboard {
  const stats: BswcScoreboard = {
    granizo: { hit: 0, miss: 0, pct: 0, pts: 0 },
    vento: { hit: 0, miss: 0, pct: 0, pts: 0 },
    tornado: { hit: 0, miss: 0, pct: 0, pts: 0 },
    totalPts: 0,
  };

  const hazards = ['granizo', 'vento', 'tornado'] as const;

  hazards.forEach((haz) => {
    const polys = polygons.filter(
      (p) => (p.properties?.type || '').toLowerCase() === haz
    );
    if (!polys.length) {
      stats[haz] = { hit: 0, miss: 0, pct: 0, pts: 0 };
      return;
    }

    let hit = 0;
    let miss = 0;
    let pts = 0;

    reports.forEach((rep) => {
      if (rep.hazard !== haz) return;
      const pt = turf.point([rep.lng, rep.lat]);
      const inside = polys.some((poly) =>
        turf.booleanPointInPolygon(pt, poly)
      );
      const sev = String(rep.sev || 'NOR').trim().toUpperCase();

      if (inside) {
        hit++;
        let p = weights[haz] || 0;
        if (sev === 'SS') p += ssBonus[haz] || 0;
        pts += p;
      } else {
        miss++;
        pts += outPenalty[haz] || 0;
      }
    });

    const total = hit + miss;
    const pct = total ? Math.round((hit * 100) / total) : 0;
    stats[haz] = { hit, miss, pct, pts };
  });

  // Deflator simplificado (sem toda a lógica de células)
  let deflatorPts = 0;
  hazards.forEach((haz) => {
    const polys = polygons.filter(
      (p) => (p.properties?.type || '').toLowerCase() === haz
    );
    if (!polys.length) return;

    const areaByLvl: Record<number, number> = {};
    polys.forEach((poly) => {
      const lvl = Number(poly.properties?.level || 0);
      if (!lvl) return;
      try {
        const area = turf.area(poly) / 1e6;
        areaByLvl[lvl] = (areaByLvl[lvl] || 0) + area;
      } catch {
        // ignore
      }
    });

    Object.entries(areaByLvl).forEach(([lvlStr, areaKm2]) => {
      const lvl = Number(lvlStr);
      const pctReq = pctByRisk[haz as keyof typeof pctByRisk]?.[lvl as 1 | 2 | 3 | 4] ?? 0.1;
      const cells = areaKm2 / (80 * 80);
      const reqCells = Math.ceil(cells * pctReq);

      const actual = reports.filter((rep) => {
        if (rep.hazard !== haz) return false;
        const pt = turf.point([rep.lng, rep.lat]);
        return polys
          .filter((p) => Number(p.properties?.level) === lvl)
          .some((p) => turf.booleanPointInPolygon(pt, p));
      }).length;

      if (actual < reqCells) {
        let w = defW[lvl] || 5;
        if (lvl === 3) w *= 2;
        if (lvl === 4) w *= 3;
        deflatorPts += (reqCells - actual) * w;
      }
    });
  });

  const rawPts =
    stats.granizo.pts + stats.vento.pts + stats.tornado.pts;
  stats.totalPts = Math.max(0, rawPts - deflatorPts);

  return stats;
}
