import proj4 from 'proj4';
import { parseWrfRunFolder } from '@/lib/wrfModelRuns';

/** Domínio Centro-Sul (já usado na página). */
export const CENTRO_SUL_BOUNDS = {
  north: -17.9648,
  south: -35.7217,
  east: -41.368,
  west: -62.632,
};

/** Paraná — namelist.wps &geogrid (dx=6 km, LCC, ref_lat/ref_lon). */
const PARANA_REF_LAT = -24.452;
const PARANA_REF_LON = -51.647;
const PARANA_E_WE = 134;
const PARANA_E_SN = 84;
const PARANA_DX = 6000;

const WGS84 = 'EPSG:4326';

const PARANA_LCC =
  '+proj=lcc +lat_1=-24.452 +lat_2=-24.452 +lat_0=-24.452 +lon_0=-51.647 +a=6370000 +b=6370000 +units=m +no_defs';

function paranaProjectedHalfExtentM() {
  const [cx, cy] = proj4(WGS84, PARANA_LCC, [PARANA_REF_LON, PARANA_REF_LAT]);
  const w = (PARANA_E_WE - 1) * PARANA_DX;
  const h = (PARANA_E_SN - 1) * PARANA_DX;
  return { cx, cy, w, h };
}

/** Cantos aproximados (ref no centro do domínio em projeção). */
export function getParanaGeographicBounds(): {
  north: number;
  south: number;
  east: number;
  west: number;
} {
  const { cx, cy, w, h } = paranaProjectedHalfExtentM();
  const pts = [
    proj4(PARANA_LCC, WGS84, [cx - w / 2, cy - h / 2]),
    proj4(PARANA_LCC, WGS84, [cx + w / 2, cy - h / 2]),
    proj4(PARANA_LCC, WGS84, [cx - w / 2, cy + h / 2]),
    proj4(PARANA_LCC, WGS84, [cx + w / 2, cy + h / 2]),
  ];
  const lats = pts.map((p) => p[1]);
  const lons = pts.map((p) => p[0]);
  return {
    north: Math.max(...lats),
    south: Math.min(...lats),
    east: Math.max(...lons),
    west: Math.min(...lons),
  };
}

/**
 * Pixel → lat/lon no domínio Paraná (imagem alinhada ao retângulo da grelha LCC).
 * Topo da imagem = norte.
 */
export function imagePixelToLatLonParana(
  offsetX: number,
  offsetY: number,
  rectWidth: number,
  rectHeight: number
): { lat: number; lon: number } {
  const xRatio = offsetX / rectWidth;
  const yRatio = offsetY / rectHeight;
  const { cx, cy, w, h } = paranaProjectedHalfExtentM();
  const x = cx - w / 2 + xRatio * w;
  const y = cy + h / 2 - yRatio * h;
  const [lon, lat] = proj4(PARANA_LCC, WGS84, [x, y]);
  return { lat, lon };
}

export function getMapBoundsForRunFolder(run: string): {
  north: number;
  south: number;
  east: number;
  west: number;
} {
  const p = parseWrfRunFolder(run);
  if (p?.domain === 'parana') {
    return getParanaGeographicBounds();
  }
  return CENTRO_SUL_BOUNDS;
}

export function isParanaRun(run: string): boolean {
  return parseWrfRunFolder(run)?.domain === 'parana';
}
