import proj4 from 'proj4';
import { parseWrfRunFolder } from '@/lib/wrfModelRuns';

const WGS84 = 'EPSG:4326';

/** Centro-Sul - namelist.wps &geogrid (dx=3 km, LCC, ref_lat=-27.0, ref_lon=-52.0). */
const CENTRO_SUL_REF_LAT = -27.0;
const CENTRO_SUL_REF_LON = -52.0;
const CENTRO_SUL_E_WE = 651;
const CENTRO_SUL_E_SN = 651;
const CENTRO_SUL_DX = 3000;

const CENTRO_SUL_LCC =
  '+proj=lcc +lat_1=-27.0 +lat_2=-27.0 +lat_0=-27.0 +lon_0=-52.0 +a=6370000 +b=6370000 +units=m +no_defs';

function centroSulProjectedHalfExtentM() {
  const [cx, cy] = proj4(WGS84, CENTRO_SUL_LCC, [CENTRO_SUL_REF_LON, CENTRO_SUL_REF_LAT]);
  const w = (CENTRO_SUL_E_WE - 1) * CENTRO_SUL_DX;
  const h = (CENTRO_SUL_E_SN - 1) * CENTRO_SUL_DX;
  return { cx, cy, w, h };
}

/** Domínio Centro-Sul calculado rigorosamente pela projeção LCC do namelist.wps */
export function getCentroSulGeographicBounds(): {
  north: number;
  south: number;
  east: number;
  west: number;
} {
  const { cx, cy, w, h } = centroSulProjectedHalfExtentM();
  const pts = [
    proj4(CENTRO_SUL_LCC, WGS84, [cx - w / 2, cy - h / 2]),
    proj4(CENTRO_SUL_LCC, WGS84, [cx + w / 2, cy - h / 2]),
    proj4(CENTRO_SUL_LCC, WGS84, [cx - w / 2, cy + h / 2]),
    proj4(CENTRO_SUL_LCC, WGS84, [cx + w / 2, cy + h / 2]),
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

export const CENTRO_SUL_BOUNDS = getCentroSulGeographicBounds();

export function imagePixelToLatLonCentroSul(
  offsetX: number,
  offsetY: number,
  rectWidth: number,
  rectHeight: number
): { lat: number; lon: number } {
  const xRatio = offsetX / rectWidth;
  const yRatio = offsetY / rectHeight;
  const { cx, cy, w, h } = centroSulProjectedHalfExtentM();
  const x = cx - w / 2 + xRatio * w;
  const y = cy + h / 2 - yRatio * h;
  const [lon, lat] = proj4(CENTRO_SUL_LCC, WGS84, [x, y]);
  return { lat, lon };
}
const PARANA_REF_LAT = -24.452;
const PARANA_REF_LON = -51.647;
const PARANA_E_WE = 134;
const PARANA_E_SN = 84;
const PARANA_DX = 6000;

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
