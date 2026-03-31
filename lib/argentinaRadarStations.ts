/**
 * Radares meteorológicos da Argentina (OHMC/SMN).
 * URL: https://webmet.ohmc.ar/media/radares/images/{id}/{YYYY}/{MM}/{DD}/{id}_{YYYYMMDD}T{HHmm}00Z_{COLMAX|VRAD}_00.png
 * Refletividade: COLMAX | Velocidade: VRAD
 * Timestamp em UTC (sufixo Z).
 */

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export interface ArgentinaRadarStation {
  id: string;
  name: string;
  lat: number;
  lng: number;
  rangeKm: number;
  updateIntervalMinutes: number;
}

/** Centros alinhados a `docs/radaresv2.txt` (API WebMET `api_radares/radares/?format=json`). */
export const ARGENTINA_RADAR_STATIONS: ArgentinaRadarStation[] = [
  { id: 'AR5', name: 'Pergamino', lat: -33.94612, lng: -60.5626, rangeKm: 240, updateIntervalMinutes: 10 },
  { id: 'AR7', name: 'Paraná', lat: -31.84849, lng: -60.53724, rangeKm: 240, updateIntervalMinutes: 10 },
  { id: 'AR8', name: 'Anguil', lat: -36.53965, lng: -63.98984, rangeKm: 240, updateIntervalMinutes: 10 },
  { id: 'RMA00', name: 'Bariloche', lat: -41.13944, lng: -71.14944, rangeKm: 240, updateIntervalMinutes: 10 },
  { id: 'RMA1', name: 'Córdoba', lat: -31.44139, lng: -64.19194, rangeKm: 240, updateIntervalMinutes: 10 },
  { id: 'RMA2', name: 'Ezeiza', lat: -34.80082, lng: -58.51557, rangeKm: 240, updateIntervalMinutes: 10 },
  { id: 'RMA3', name: 'Las Lomitas', lat: -24.73028, lng: -60.55139, rangeKm: 240, updateIntervalMinutes: 10 },
  { id: 'RMA4', name: 'Resistencia', lat: -27.45167, lng: -59.05083, rangeKm: 240, updateIntervalMinutes: 10 },
  { id: 'RMA5', name: 'Bernardo de Irigoyen', lat: -26.27812, lng: -53.67085, rangeKm: 240, updateIntervalMinutes: 10 },
  { id: 'RMA6', name: 'Mar del Plata', lat: -37.91306, lng: -57.52783, rangeKm: 240, updateIntervalMinutes: 10 },
  { id: 'RMA7', name: 'Neuquén', lat: -38.87662, lng: -68.14489, rangeKm: 240, updateIntervalMinutes: 10 },
  { id: 'RMA8', name: 'Mercedes', lat: -29.19591, lng: -58.04485, rangeKm: 240, updateIntervalMinutes: 10 },
  { id: 'RMA9', name: 'Río Grande', lat: -53.78399, lng: -67.74426, rangeKm: 240, updateIntervalMinutes: 10 },
  { id: 'RMA10', name: 'Espora', lat: -38.73426, lng: -62.16341, rangeKm: 240, updateIntervalMinutes: 10 },
  { id: 'RMA11', name: 'Termas Río Hondo', lat: -27.5026, lng: -64.90575, rangeKm: 240, updateIntervalMinutes: 10 },
  { id: 'RMA12', name: 'Las Grutas', lat: -40.77221, lng: -65.07604, rangeKm: 240, updateIntervalMinutes: 10 },
  { id: 'RMA13', name: 'Ituzaingó (Corrientes)', lat: -27.62229, lng: -56.84181, rangeKm: 240, updateIntervalMinutes: 10 },
  { id: 'RMA14', name: 'Bolívar', lat: -36.18903, lng: -61.07041, rangeKm: 240, updateIntervalMinutes: 10 },
  { id: 'RMA15', name: 'Patquía', lat: -30.0308, lng: -66.8763, rangeKm: 240, updateIntervalMinutes: 10 },
  { id: 'RMA16', name: 'Villa Reynolds', lat: -33.71829, lng: -65.37546, rangeKm: 240, updateIntervalMinutes: 10 },
  { id: 'RMA17', name: 'Alejandro Roca', lat: -33.3514, lng: -63.7036, rangeKm: 240, updateIntervalMinutes: 10 },
  { id: 'RMA18', name: 'Santa Isabel (La Pampa)', lat: -36.22317, lng: -66.93639, rangeKm: 240, updateIntervalMinutes: 10 },
];

const OHMC_BASE = 'https://webmet.ohmc.ar/media/radares/images';

/** Retorna timestamp em UTC no formato YYYYMMDDTHHmm00Z, arredondado ao intervalo do radar. */
export function getArgentinaRadarTimestamp(
  nominalDate: Date,
  station: ArgentinaRadarStation
): string {
  const d = new Date(nominalDate);
  // O nominalDate já é em local time (UTC-3), e o nome do arquivo da Argentina 
  // usa o horário local mas com sufixo Z. Portanto, NÃO devemos somar 3 horas.
  // Vamos usar getUTCHours() porque o nominalDate foi construído com Date.UTC
  // a partir do ts12 (que já é o tempo correto desejado).
  
  const interval = station.updateIntervalMinutes;
  const totalMin = d.getUTCHours() * 60 + d.getUTCMinutes();
  const snapped = Math.floor(totalMin / interval) * interval;
  const nh = Math.floor(snapped / 60) % 24;
  const nm = snapped % 60;
  const y = d.getUTCFullYear().toString();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}T${String(nh).padStart(2, '0')}${String(nm).padStart(2, '0')}00Z`;
}

/**
 * Monta URL PNG para radar Argentina (OHMC).
 * produto: reflectividade → COLMAX | velocidade → VRAD
 * Timestamp em UTC (formato YYYYMMDDTHHmm00Z).
 */
export function buildArgentinaRadarPngUrl(
  station: ArgentinaRadarStation,
  tsArgentina: string,
  productType: 'reflectividade' | 'velocidade' | 'vil' | 'waldvogel'
): string {
  const prod = productType === 'reflectividade' ? 'COLMAX' : 'VRAD';
  const y = tsArgentina.slice(0, 4);
  const m = tsArgentina.slice(4, 6);
  const d = tsArgentina.slice(6, 8);
  return `${OHMC_BASE}/${station.id}/${y}/${m}/${d}/${station.id}_${tsArgentina}_${prod}_00.png`;
}

/** Retorna radares Argentina dentro do raio, ordenados por distância. */
export function findArgentinaRadarsWithinRadius(
  centroid: { lat: number; lng: number },
  radiusKm: number = 300
): ArgentinaRadarStation[] {
  const result: { station: ArgentinaRadarStation; dist: number }[] = [];
  for (const s of ARGENTINA_RADAR_STATIONS) {
    const d = haversineKm(centroid.lat, centroid.lng, s.lat, s.lng);
    if (d <= radiusKm) {
      result.push({ station: s, dist: d });
    }
  }
  result.sort((a, b) => a.dist - b.dist);
  return result.map((r) => r.station);
}

/** Bounds geográficos da imagem (quadrado centrado no radar). */
export function getArgentinaRadarBounds(station: ArgentinaRadarStation): {
  north: number;
  south: number;
  east: number;
  west: number;
} {
  const latDelta = station.rangeKm / 111.32;
  const latRadians = station.lat * (Math.PI / 180);
  const lngDelta = station.rangeKm / (111.32 * Math.cos(latRadians));
  return {
    north: station.lat + latDelta,
    south: station.lat - latDelta,
    east: station.lng + lngDelta,
    west: station.lng - lngDelta,
  };
}
