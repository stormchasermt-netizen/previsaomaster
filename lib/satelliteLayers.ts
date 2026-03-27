/**
 * satelliteLayers.ts
 * Definições de camadas de satélite e mesoanálise para o mapa Ao Vivo.
 * Fonte principal: NASA GIBS (Global Imagery Browse Services)
 */

export type SatelliteLayerId = 'goes_visible' | 'goes_ir' | 'goes_wv' | 'meso_cape' | 'meso_precip_water';

export interface SatelliteLayer {
  id: SatelliteLayerId;
  name: string;
  gibsLayer: string; // Nome da camada no NASA GIBS
  format: 'image/png' | 'image/jpeg';
  transparent: boolean;
  attribution: string;
  isMeso?: boolean;
}

export const SATELLITE_LAYERS: SatelliteLayer[] = [
  {
    id: 'goes_visible',
    name: 'GOES Visível (B02)',
    gibsLayer: 'GOES-East_ABI_Band2_Red_Visible_Operational',
    format: 'image/png',
    transparent: true,
    attribution: 'NASA GIBS / NOAA GOES-16'
  },
  {
    id: 'goes_ir',
    name: 'GOES Infravermelho (B13)',
    gibsLayer: 'GOES-East_ABI_Band13_Clean_IR_Operational',
    format: 'image/png',
    transparent: true,
    attribution: 'NASA GIBS / NOAA GOES-16'
  },
  {
    id: 'goes_wv',
    name: 'Vapor de Água (High)',
    gibsLayer: 'GOES-East_ABI_Band8_Upper-Level_Water_Vapor_Operational',
    format: 'image/png',
    transparent: true,
    attribution: 'NASA GIBS / NOAA GOES-16'
  },
  {
     id: 'meso_precip_water',
     name: 'Água Precipitável (Total)',
     gibsLayer: 'GEFS_Precipitable_Water_Total',
     format: 'image/png',
     transparent: true,
     attribution: 'NASA GIBS / GEFS',
     isMeso: true
  }
];

/**
 * Constrói a URL de uma camada WMS do NASA GIBS para EPSG:4326.
 * @param layer Camada do satélite
 * @param time String de tempo no formato ISO (ex: 2024-03-27T12:00:00Z)
 * @param bbox Delimitação [minLng, minLat, maxLng, maxLat]
 */
export function buildGibsWmsUrl(layer: SatelliteLayer, time: string, bbox: [number, number, number, number]): string {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  // NASA GIBS EPSG:4326 WMS Endpoint
  const baseUrl = 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi';
  
  const params = new URLSearchParams({
    SERVICE: 'WMS',
    VERSION: '1.3.0',
    REQUEST: 'GetMap',
    LAYERS: layer.gibsLayer,
    STYLE: 'default',
    FORMAT: layer.format,
    TRANSPARENT: layer.transparent ? 'TRUE' : 'FALSE',
    TIME: time,
    WIDTH: '1024', // Alta resolução
    HEIGHT: '1024',
    CRS: 'EPSG:4326',
    BBOX: `${minLat},${minLng},${maxLat},${maxLng}` // WMS 1.3.0 usa Lat,Lng por padrão para EPSG:4326
  });

  return `${baseUrl}?${params.toString()}`;
}

/**
 * Converte um timestamp UTC (string YYYYMMDDHHmm) para o formato ISO exigido pelo GIBS.
 * GIBS geralmente aceita YYYY-MM-DD ou YYYY-MM-DDThh:mm:ssZ
 */
export function formatTimestampToGibsISO(ts12: string): string {
  if (ts12.length < 12) return new Date().toISOString().split('.')[0] + 'Z';
  const y = ts12.slice(0, 4);
  const m = ts12.slice(4, 6);
  const d = ts12.slice(6, 8);
  const hh = ts12.slice(8, 10);
  const mm = ts12.slice(10, 12);
  return `${y}-${m}-${d}T${hh}:${mm}:00Z`;
}
