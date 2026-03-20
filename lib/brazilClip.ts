/**
 * Utilitários para recortar polígonos aos limites do Brasil.
 * Usado para overlays Prevots e outras camadas que devem respeitar o território nacional.
 */
import intersect from '@turf/intersect';
import { polygon as turfPolygon, featureCollection } from '@turf/helpers';

export const BRASIL_GEOJSON_URL =
  'https://cdn.jsdelivr.net/gh/LucasMouraChaser/brasilunificado@main/brasilunificado.geojson';

type BrazilPolygonFeature = {
  type: 'Feature';
  geometry: { type: 'Polygon'; coordinates: number[][][] };
  properties?: object;
};
export type BrazilForClip = BrazilPolygonFeature[];

/** Normaliza coordenadas [lat,lng] para [lng,lat] quando detectado. */
function normalizeToLngLat(ring: number[][]): number[][] {
  if (!ring.length) return ring;
  const [a, b] = ring[0];
  const looksLikeLat = a >= -35 && a <= 6;
  const looksLikeLng = b >= -76 && b <= -33;
  if (looksLikeLat && looksLikeLng) return ring.map(([x, y]) => [y, x]);
  return ring;
}

/** Extrai polígonos do GeoJSON do Brasil para clipping. */
export function getBrazilPolygons(geojson: GeoJSON.FeatureCollection | { features?: GeoJSON.Feature[] }): BrazilForClip | null {
  const features = (geojson as { features?: GeoJSON.Feature[] })?.features;
  if (!features?.length) return null;
  const parts: BrazilPolygonFeature[] = [];
  for (const f of features) {
    const geom = (f as GeoJSON.Feature).geometry;
    if (!geom) continue;
    if (geom.type === 'Polygon' && Array.isArray(geom.coordinates?.[0])) {
      const ring = normalizeToLngLat(geom.coordinates[0]);
      parts.push(turfPolygon([ring]) as unknown as BrazilPolygonFeature);
    } else if (geom.type === 'MultiPolygon' && Array.isArray(geom.coordinates)) {
      for (const poly of geom.coordinates) {
        if (poly?.[0]?.length) {
          const normalized = normalizeToLngLat(poly[0]);
          parts.push(turfPolygon([normalized]) as unknown as BrazilPolygonFeature);
        }
      }
    }
  }
  return parts.length ? parts : null;
}

function reverseRing(ring: number[][]): number[][] {
  if (ring.length <= 2) return ring;
  const first = ring[0];
  const middle = ring.slice(1, -1).reverse();
  return [first, ...middle, first];
}

/**
 * Recorta um polígono (anel [lng,lat][]) aos limites do Brasil.
 * Retorna o anel recortado ou null se fora do território.
 */
export function clipPolygonToBrazil(
  ring: number[][],
  brazilParts: BrazilForClip | null
): number[][] | null {
  if (!ring.length || !brazilParts?.length) return null;
  const runOne = (r: number[][], brazilFeature: BrazilPolygonFeature): number[][] | null => {
    try {
      const poly = turfPolygon([r]);
      const result = intersect(featureCollection([poly as any, brazilFeature as any]));
      if (!result?.geometry) return null;
      const g = result.geometry as { type: string; coordinates: number[][][] | number[][][][] };
      if (g.type === 'Polygon' && g.coordinates?.[0]?.length >= 3) return g.coordinates[0] as number[][];
      if (g.type === 'MultiPolygon' && Array.isArray(g.coordinates) && g.coordinates.length) {
        const first = (g.coordinates as number[][][][]).find((c) => c[0]?.length >= 3);
        return first ? (first[0] as number[][]) : null;
      }
      return null;
    } catch {
      return null;
    }
  };
  const run = (r: number[][]): number[][] | null => {
    for (const part of brazilParts) {
      const clipped = runOne(r, part);
      if (clipped) return clipped;
    }
    return null;
  };
  let clipped: number[][] | null = run(ring);
  if (!clipped && ring.length >= 3) clipped = run(reverseRing(ring));
  return clipped;
}
