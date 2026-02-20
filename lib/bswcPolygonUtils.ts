/**
 * Utilitários para polígonos BSWC – regras do mapa Leaflet original
 * - Validação geográfica (Brasil, área mínima)
 * - Regra: polígono de nível maior não pode ser maior que um de nível menor
 * - buildOverall: união de polígonos sobrepostos do mesmo nível; mantém o maior quando não se tocam
 */
import type { BswcForecastFeature, BswcHazard } from '@/lib/types';

declare const turf: any;

const MIN_AREA_KM2 = 1;

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Valida um novo polígono antes de adicionar.
 * Regras: dentro do Brasil, área >= 1 km², nível maior não pode ter área maior que nível menor.
 */
export function validateNewPolygon(
  newFeature: BswcForecastFeature,
  existingPolygons: BswcForecastFeature[],
  brazilBoundary: GeoJSON.Feature | null
): ValidationResult {
  if (!brazilBoundary) {
    return { valid: false, error: 'Contorno do Brasil ainda não carregado.' };
  }

  const hazard = (newFeature.properties?.type || '').toLowerCase() as BswcHazard;
  const newLevel = Number(newFeature.properties?.level || 0);
  const turfPoly = turf.polygon(newFeature.geometry.coordinates);

  // 1) Intersecta com o Brasil
  let clipped: GeoJSON.Feature | null = null;
  try {
    clipped = turf.intersect(turfPoly, brazilBoundary);
    if (!clipped || !clipped.geometry) {
      return { valid: false, error: 'Previsão é feita apenas para o Brasil.' };
    }
  } catch {
    return { valid: false, error: 'Erro ao validar polígono com limites do Brasil.' };
  }

  const newArea = turf.area(clipped) / 1e6; // km²
  if (newArea < MIN_AREA_KM2) {
    return { valid: false, error: 'Polígono muito pequeno (mínimo 1 km²).' };
  }

  // 2) Polígono de nível maior não pode ser maior que um de nível menor (mesmo hazard)
  const sameHazardPolys = existingPolygons.filter(
    (p) => (p.properties?.type || '').toLowerCase() === hazard
  );

  for (const p of sameHazardPolys) {
    const existingLevel = Number(p.properties?.level || 0);
    if (existingLevel >= newLevel) continue;

    try {
      const existingTurf = turf.polygon(p.geometry.coordinates);
      const existingArea = turf.area(existingTurf) / 1e6;
      if (newArea > existingArea) {
        return {
          valid: false,
          error: 'Um polígono de nível maior não pode ser maior que um de nível menor.',
        };
      }
    } catch {
      // ignora polígonos inválidos
    }
  }

  return { valid: true };
}

/**
 * Converte coordenadas GeoJSON para formato turf e aplica intersect com Brasil.
 */
export function clipToBrazil(
  coords: number[][][],
  brazilBoundary: GeoJSON.Feature | null
): BswcForecastFeature[] | null {
  if (!brazilBoundary) return null;

  const turfPoly = turf.polygon(coords);
  let clipped: GeoJSON.Feature | null = null;
  try {
    clipped = turf.intersect(turfPoly, brazilBoundary);
    if (!clipped) return null;
  } catch {
    return null;
  }

  const geom = clipped.geometry;
  const features: BswcForecastFeature[] = [];

  if (geom.type === 'Polygon' && geom.coordinates?.[0]?.length >= 3) {
    features.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: geom.coordinates },
      properties: { dia: 'd0', type: 'granizo', level: 1 }, // será sobrescrito
    });
  } else if (geom.type === 'MultiPolygon') {
    geom.coordinates.forEach((ring: number[][][]) => {
      if (ring?.[0]?.length >= 3) {
        features.push({
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: ring },
          properties: { dia: 'd0', type: 'granizo', level: 1 },
        });
      }
    });
  }

  return features.length ? features : null;
}

export interface OverallFeature {
  type: 'Feature';
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  properties: { level: number };
}

/**
 * buildOverall: regras do mosaico PREV 1-4
 * - Se dois polígonos do MESMO nível se sobrepõem → une (union)
 * - Se NÃO se tocam → mantém o MAIOR
 */
export function buildOverall(fc: { type: 'FeatureCollection'; features: BswcForecastFeature[] }): {
  type: 'FeatureCollection';
  features: OverallFeature[];
} {
  const byLvl: Record<number, BswcForecastFeature[]> = {};

  fc.features.forEach((f) => {
    const lvl = Number(f.properties?.level || 0);
    if (!lvl) return;
    (byLvl[lvl] ??= []).push(f);
  });

  const feats: OverallFeature[] = [];

  Object.entries(byLvl).forEach(([lvlStr, arr]) => {
    const lvl = Number(lvlStr);
    let current: any = turf.feature(arr[0].geometry);

    for (let i = 1; i < arr.length; i++) {
      const next = turf.feature(arr[i].geometry);
      const test = turf.union(current, next);
      const a0 = turf.area(current);
      const a1 = turf.area(next);
      const at = turf.area(test);

      const overlapped = at < a0 + a1 * 1.05;
      current = overlapped ? test : a0 > a1 ? current : next;
    }

    feats.push({
      type: 'Feature',
      geometry: current.geometry,
      properties: { level: lvl },
    });
  });

  return { type: 'FeatureCollection', features: feats };
}
