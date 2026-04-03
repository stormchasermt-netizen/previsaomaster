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
): { lat: number; lon: number; gridX: number; gridY: number } | null {
  // 1. Margens da Imagem JPG (Baseado nas tuas medições exatas 2318x1905)
  // Mas vamos usar as métricas exatas do recorte real do script plot_wrf2.py lidas da VM:
  // Largura: 2295, Altura: 1904
  // Borda Esquerda Px: 19
  // Borda Direita Px: 75
  // Borda Topo Px: 345
  // Borda Fundo Px: 364
  const imgW = 2326;
  const imgH = 2060;
  const marginLeft = 20 / imgW;           
  const marginRight = (imgW - 198) / imgW; 
  const marginTop = 100 / imgH;             
  const marginBottom = (imgH - 83) / imgH; 

  const mapWidth = marginRight - marginLeft;
  const mapHeight = marginBottom - marginTop;

  const xRatioOriginal = offsetX / rectWidth;
  const yRatioOriginal = offsetY / rectHeight;

  const xRatio = (xRatioOriginal - marginLeft) / mapWidth;
  const yRatio = (yRatioOriginal - marginTop) / mapHeight;
  
  if (xRatio < 0 || xRatio > 1 || yRatio < 0 || yRatio > 1) {
    return null;
  }

  // 2. Limites EXATOS projetados do Matplotlib Axes
  // A imagem não é retangular em Lat/Lon! É retangular na projeção LCC do WRF.
  // Os limites em metros (LCC) extraídos do subplot_kw={'projection': cart_proj} são:
  const lcc_xmin = -1190157.8789286374;
  const lcc_xmax =  1190157.8789285964;
  const lcc_ymin = -1018317.073233748;
  const lcc_ymax =   956096.3317749603;

  const lcc_x = lcc_xmin + xRatio * (lcc_xmax - lcc_xmin);
  const lcc_y = lcc_ymax - yRatio * (lcc_ymax - lcc_ymin); // y invertido no ecrã

  // Converter LCC -> Lat/Lon (Para exibir na tela)
  const [lon, lat] = proj4(CENTRO_SUL_LCC, WGS84, [lcc_x, lcc_y]);
  
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
  rectHeight: number
): { lat: number; lon: number; gridX: number; gridY: number } | null {
  // 1. Margens da Imagem JPG (Assumindo a mesma caixa/medida para Paraná, extraida de plot_wrf2.py)
  const imgW = 2326;
  const imgH = 2060;
  const marginLeft = 20 / imgW;           
  const marginRight = (imgW - 198) / imgW; 
  const marginTop = 100 / imgH;             
  const marginBottom = (imgH - 83) / imgH; 

  const mapWidth = marginRight - marginLeft;
  const mapHeight = marginBottom - marginTop;

  const xRatioOriginal = offsetX / rectWidth;
  const yRatioOriginal = offsetY / rectHeight;

  const xRatio = (xRatioOriginal - marginLeft) / mapWidth;
  const yRatio = (yRatioOriginal - marginTop) / mapHeight;
  
  if (xRatio < 0 || xRatio > 1 || yRatio < 0 || yRatio > 1) {
    return null;
  }

  // 2. Limites EXATOS projetados do Matplotlib Axes extraídos da VM (Paraná)
  const lcc_xmin = -435236.6971430953;
  const lcc_xmax =  538811.4763422405;
  const lcc_ymin = -32828.08727992561;
  const lcc_ymax =  571665.4411961415;

  const lcc_x = lcc_xmin + xRatio * (lcc_xmax - lcc_xmin);
  const lcc_y = lcc_ymax - yRatio * (lcc_ymax - lcc_ymin); // y invertido no ecrã
  
  // Converter LCC -> Lat/Lon
  const [lon, lat] = proj4(PARANA_LCC, WGS84, [lcc_x, lcc_y]);
  
  // 4. Converter LCC -> Índice da Matriz .npy.gz 
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
