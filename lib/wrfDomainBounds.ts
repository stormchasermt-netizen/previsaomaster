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
  rectHeight: number,
  naturalWidth: number,
  naturalHeight: number
): { lat: number; lon: number; gridX: number; gridY: number } | null {
  // Medições exatas dos arquivos gerados pelo plot_wrf2_copy.py (VM) com `bbox_inches='tight'`:
  // A área do mapa (PlateCarree) tem SEMPRE 1983x1875 pixels (mesmo que a imagem mude de tamanho).
  // A margem esquerda é sempre 20 pixels e a margem inferior é sempre 84 pixels.
  // As margens direita e superior variam dependendo da barra de cores e dos títulos.
  const marginLeft = 20 / naturalWidth;
  const marginBottom = 84 / naturalHeight;
  const mapWidth = 1983 / naturalWidth;
  const mapHeight = 1875 / naturalHeight;
  const marginTop = (naturalHeight - 84 - 1875) / naturalHeight;

  const xRatioOriginal = offsetX / rectWidth;
  const yRatioOriginal = offsetY / rectHeight;

  const xRatio = (xRatioOriginal - marginLeft) / mapWidth;
  const yRatio = (yRatioOriginal - marginTop) / mapHeight;
  
  if (xRatio < 0 || xRatio > 1 || yRatio < 0 || yRatio > 1) {
    return null;
  }

  // 2. Limites EXATOS projetados do Matplotlib Axes
  // O meteorologista usa margins de 0.2 graus do tamanho do quadro no PlateCarree para o arquivo principal:
  // (Ou `[-0.5, +0.5, min, max]` como estava no `plot_wrf2.py` mas ele corrigiu para "0.2 do tamanho do quadro")
  const min_lon = -62.632019 - 0.2;
  const max_lon = -41.367981 + 0.2;
  const min_lat = -35.721680 - 0.2;
  const max_lat = -17.964783 + 0.2;

  const lon = min_lon + xRatio * (max_lon - min_lon);
  const lat = max_lat - yRatio * (max_lat - min_lat); // y invertido no ecrã

  // Converter Lat/Lon -> LCC
  const [lcc_x, lcc_y] = proj4(WGS84, CENTRO_SUL_LCC, [lon, lat]);
  
  // Converter LCC -> Índice da Matriz .npy.gz (Para o Hover de valor puro)
  const wrf_left_x = -((CENTRO_SUL_E_WE - 1) / 2) * CENTRO_SUL_DX;
  const wrf_bottom_y = -((CENTRO_SUL_E_SN - 1) / 2) * CENTRO_SUL_DX;

  const gridX = Math.floor((lcc_x - wrf_left_x) / CENTRO_SUL_DX);
  const gridY = Math.floor((lcc_y - wrf_bottom_y) / CENTRO_SUL_DX);
  
  return { lat, lon, gridX, gridY };
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
  rectHeight: number,
  naturalWidth: number,
  naturalHeight: number
): { lat: number; lon: number; gridX: number; gridY: number } | null {
  // 1. Margens EXATAS da imagem (Paraná usa a mesma moldura Matplotlib)
  const marginLeft = 20 / naturalWidth;
  const marginBottom = 84 / naturalHeight;
  const mapWidth = 1983 / naturalWidth;
  const mapHeight = 1875 / naturalHeight;
  const marginTop = (naturalHeight - 84 - 1875) / naturalHeight;

  const xRatioOriginal = offsetX / rectWidth;
  const yRatioOriginal = offsetY / rectHeight;

  const xRatio = (xRatioOriginal - marginLeft) / mapWidth;
  const yRatio = (yRatioOriginal - marginTop) / mapHeight;
  
  if (xRatio < 0 || xRatio > 1 || yRatio < 0 || yRatio > 1) {
    return null;
  }

  // 2. Limites EXATOS projetados do Matplotlib Axes extraídos da VM (Paraná)
  const min_lon = -56.0 - 0.2;
  const max_lon = -47.0 + 0.2;
  const min_lat = -27.0 - 0.2;
  const max_lat = -22.0 + 0.2;

  const lon = min_lon + xRatio * (max_lon - min_lon);
  const lat = max_lat - yRatio * (max_lat - min_lat); // y invertido no ecrã
  
  // 4. Converter LCC -> Índice da Matriz .npy.gz 
  const [lcc_x, lcc_y] = proj4(WGS84, PARANA_LCC, [lon, lat]);
  const wrf_left_x = -((PARANA_E_WE - 1) / 2) * PARANA_DX;
  const wrf_bottom_y = -((PARANA_E_SN - 1) / 2) * PARANA_DX;

  const gridX = Math.floor((lcc_x - wrf_left_x) / PARANA_DX);
  const gridY = Math.floor((lcc_y - wrf_bottom_y) / PARANA_DX);
  
  return { lat, lon, gridX, gridY };
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
