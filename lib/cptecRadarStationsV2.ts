/**
 * Estações de radar CPTEC/INPE.
 * Suporta SIGMA (WMS) e Nowcasting (PNG direto).
 *
 * Nowcasting PNG: https://s{N}.cptec.inpe.br/radar/{org}/{slug}/{product}/{subtype}/{ano}/{mes}/R{id}_{YYYYMMDDHHmm}.png
 * Intervalos variam por radar: Lontras a cada 5 min; Santiago, Morro da Igreja, São Roque a cada 10 min; Chapecó a cada 6 min. ppicz = reflectividade, ppivr = velocidade.
 * São Roque usa cappi/cappi3km em vez de ppi/ppicz.
 *
 * Chapecó histórico: até 25/09/2020 usava 5 min a partir de 00:00; após 26/09, 6 min a partir de XX:00.
 * Fallback automático: se 6min não retornar imagens → tenta 5min/00:00 → 5min/00:02 → 6min/00:02.
 */

import type { TornadoTrack } from './tornadoTracksData';

/** Até 25/09/2020 o radar de Chapecó usava imagens a cada 5 min a partir de 00:00. */
export const CHAPECO_5MIN_UNTIL = '2020-09-25';

/**
 * Configurações de fallback universal para busca de imagens de radar.
 * Ordem de tentativa: 10, 7.5, 6, 5 min (offset 0).
 * Usado em sync histórico e fallback genérico.
 */
export function getUniversalFallbackConfigs(): { interval: number; offset: number }[] {
  return [
    { interval: 10, offset: 0 },
    { interval: 7.5, offset: 0 },
    { interval: 6, offset: 0 },
    { interval: 5, offset: 0 },
  ];
}

/**
 * Configurações de fallback para Chapecó (Nowcasting PNG), em ordem de tentativa.
 * Usado quando imagens não são encontradas no esquema padrão.
 */
export function getChapecoFallbackConfigs(trackDate: string): { interval: number; offset: number }[] {
  const isLegacy = trackDate <= CHAPECO_5MIN_UNTIL;
  if (isLegacy) {
    return [
      { interval: 5, offset: 0 },
      { interval: 5, offset: 2 },
      { interval: 6, offset: 0 },
      { interval: 6, offset: 2 },
    ];
  }
  return [
    { interval: 6, offset: 0 },
    { interval: 5, offset: 0 },
    { interval: 5, offset: 2 },
    { interval: 6, offset: 2 },
  ];
}

export interface CptecRadarStation {
  /** ID no nome do arquivo (ex.: R12137761) */
  id: string;
  /** Slug na URL (ex.: santiago, chapeco) */
  slug: string;
  /** Nome da estação */
  name: string;
  /** Latitude da antena */
  lat: number;
  /** Longitude da antena */
  lng: number;
  /** Alcance em km (250 DECEA/Santiago, 450 Chapecó vigilância, 240 IPMET) */
  rangeKm: number;
  /** Organização/origem: decea, sdcsc, inea, cemaden, sipam, funceme, argentina, redemet */
  org: 'decea' | 'sdcsc' | 'inea' | 'cemaden' | 'sipam' | 'funceme' | 'argentina' | 'redemet';
  /** Slug SIPAM para radares HD (usado nas URLs siger.sipam.gov.br). Ex: 'sbbv' */
  sipamSlug?: string;
  /** ID para chamadas na API da FUNCEME (ex: 'GMWR1000SST') */
  funcemeId?: string;
  /** Servidor s0, s1, s2, s3 */
  server: string;
  /** Produto: ppi ou cappi (São Roque) */
  product: 'ppi' | 'cappi';
  /** Subtipo: ppicz (reflectividade), ppivr (velocidade), cappi3km */
  subtype: string;
  /** Produto SIGMA (cappi, ppi, etc.) - legado WMS */
  sigmaProduct?: string;
  /** Subtipo SIGMA - legado WMS */
  sigmaSubtype?: string;
  /** Intervalo de atualização em minutos (ex.: 6 ou 10). Santiago usa 10, Chapecó 6. */
  updateIntervalMinutes?: number;
  /** Minuto de início do ciclo na hora (ex.: 2 para Chapecó = XX:02, XX:08…; 0 para Santiago = XX:00, XX:10…). */
  updateIntervalOffsetMinutes?: number;
  /** Servidor para ppivr (velocidade), quando diferente de server. Ex.: Chapecó usa s2 (ppicz) e s3 (ppivr). */
  velocityServer?: string;
  /** ID no arquivo para ppivr, quando diferente de id. Ex.: Chapecó usa R12137761 (ppicz) e R12137762 (ppivr). */
  velocityId?: string;
  /** ID no arquivo para VIL. */
  vilId?: string;
  /** ID no arquivo para Waldvogel. */
  waldvogelId?: string;
  /** Limites geográficos nativos para alinhamento preciso (minLat, minLon, maxLat, maxLon) */
  bounds?: {
    minLon: number;
    minLat: number;
    maxLon: number;
    maxLat: number;
  };
}

/**
 * Arredonda um timestamp ts12 (YYYYMMDDHHmm) para baixo, baseando-se no intervalo do radar.
 * Ex: 10:15 arredondado para intervalo de 10 min vira 10:10.
 */
export function floorTimestampToInterval(ts12: string, intervalMinutes: number): string {
  if (!ts12 || ts12.length !== 12 || intervalMinutes <= 1) return ts12;

  const y = parseInt(ts12.slice(0, 4), 10);
  const m = parseInt(ts12.slice(4, 6), 10) - 1;
  const d = parseInt(ts12.slice(6, 8), 10);
  const hh = parseInt(ts12.slice(8, 10), 10);
  const mm = parseInt(ts12.slice(10, 12), 10);

  // Calcula os minutos passados desde a meia-noite
  const totalMinutes = hh * 60 + mm;
  
  // Arredonda para baixo para o múltiplo do intervalo
  const flooredTotalMinutes = Math.floor(totalMinutes / intervalMinutes) * intervalMinutes;
  
  const flooredHh = Math.floor(flooredTotalMinutes / 60);
  const flooredMm = flooredTotalMinutes % 60;

  return `${ts12.slice(0, 8)}${String(flooredHh).padStart(2, '0')}${String(flooredMm).padStart(2, '0')}`;
}


/**
 * Lista completa de radares CPTEC/Nowcasting.
 * URL: https://s{N}.cptec.inpe.br/radar/{org}/{slug}/ppi/{ppicz|ppivr}/{ano}/{mes}/{idtip}_{YYYYMMDDHHmm}.png
 */
export const CPTEC_RADAR_STATIONS: CptecRadarStation[] = [
  // ----------------------------------------------------
  // DECEA / SDCSC / CEMADEN / SIPAM / FUNCEME
  // Lista oficial conforme radaresv2.txt
  // ----------------------------------------------------
  { id: 'R12457387', slug: 'saofrancisco', name: 'São Francisco', lat: -16.017361, lng: -44.69525, rangeKm: 250, org: 'cemaden', server: 's1', product: 'ppi', subtype: 'ppicz', velocityId: 'R12457388', vilId: 'R12452184', waldvogelId: 'R12454605', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -47.009944916, minLat: -18.237812042, maxLon: -42.335361481, maxLat: -13.748636246 } },
  { id: 'R12277383', slug: 'jaraguari', name: 'Jaraguari', lat: -20.27855, lng: -54.47396, rangeKm: 250, org: 'cemaden', server: 's1', product: 'ppi', subtype: 'ppicz', velocityId: 'R12277384', vilId: 'R12272180', waldvogelId: 'R12274497', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -56.837623596, minLat: -22.503732681, maxLon: -52.047153473, maxLat: -18.014743805 } },
  { id: 'R12137761', slug: 'chapeco', name: 'Chapecó', lat: -27.03354, lng: -52.598625, rangeKm: 250, org: 'sdcsc', server: 's1', product: 'ppi', subtype: 'ppicz', velocityId: 'R12137762', vilId: 'R12132556', waldvogelId: 'R12134629', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -55.1672, minLat: -29.28548, maxLon: -50.03005, maxLat: -24.7816 } },
  { id: 'R12544957', slug: 'morroigreja', name: 'Morro da Igreja', lat: -28.1078451, lng: -49.4719928, rangeKm: 250, org: 'decea', server: 's1', product: 'ppi', subtype: 'ppicz', velocityId: 'R12544956', vilId: 'R12544955', waldvogelId: 'R12544489', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -52.0632, minLat: -30.3648, maxLon: -46.8704, maxLat: -25.8599 } },
  { id: 'R12977393', slug: 'santatereza', name: 'Santa Tereza', lat: -19.97280738, lng: -40.54523388, rangeKm: 250, org: 'cemaden', server: 's1', product: 'ppi', subtype: 'ppicz', velocityId: 'R12977394', vilId: 'R12972190', waldvogelId: 'R12974614', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -42.939214, minLat: -22.22030575, maxLon: -38.15125375, maxLat: -17.725309 } },
  { id: 'R12477391', slug: 'tresmarias', name: 'Três Marias', lat: -18.207222, lng: -45.460556, rangeKm: 250, org: 'cemaden', server: 's1', product: 'ppi', subtype: 'ppicz', velocityId: 'R12477392', vilId: 'R12472188', waldvogelId: 'R12474611', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -47.797908783, minLat: -20.43413353, maxLon: -43.067661285, maxLat: -15.945045471 } },
  { id: 'R12567564', slug: 'picocouto', name: 'Pico do Couto', lat: -22.4466503, lng: -43.2971821, rangeKm: 250, org: 'decea', server: 's1', product: 'ppi', subtype: 'ppicz', velocityId: 'R12567537', vilId: 'R12567556', waldvogelId: 'R12564846', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -45.7583, minLat: -24.701, maxLon: -40.8262, maxLat: -20.2013 } },
  { id: 'R12537563', slug: 'saoroque', name: 'São Roque', lat: -23.598889, lng: -47.097778, rangeKm: 250, org: 'decea', server: 's1', product: 'ppi', subtype: 'ppicz', velocityId: 'R12537536', vilId: 'R12537542', waldvogelId: 'R12534843', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -49.6153, minLat: -25.8356, maxLon: -44.6369, maxLat: -21.3348 } },
  { id: 'R12957397', slug: 'guaratiba', name: 'Guaratiba', lat: -22.99324989, lng: -43.58794022, rangeKm: 250, org: 'inea', server: 's1', product: 'ppi', subtype: 'ppicz', velocityId: 'R12957398', vilId: 'R12952194', waldvogelId: 'R12954620', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -46.05399022, minLat: -25.24309989, maxLon: -41.12189022, maxLat: -20.74339989 } },
  { id: 'R12247379', slug: 'natal', name: 'Natal', lat: -5.90448, lng: -35.25401, rangeKm: 250, org: 'cemaden', server: 's1', product: 'ppi', subtype: 'ppicz', velocityId: 'R12247380', vilId: 'R12242177', waldvogelId: 'R12244491', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -37.506313324, minLat: -8.141628265, maxLon: -32.989379883, maxLat: -3.65220499 } },
  { id: 'R12467389', slug: 'salvador', name: 'Salvador', lat: -12.9025, lng: -38.326667, rangeKm: 250, org: 'cemaden', server: 's1', product: 'ppi', subtype: 'ppicz', velocityId: 'R12467390', vilId: 'R12462186', waldvogelId: 'R12464608', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -40.613765717, minLat: -15.134028435, maxLon: -36.004219055, maxLat: -10.644747734 } },
  { id: 'R12447385', slug: 'maceio', name: 'Maceió', lat: -9.551389, lng: -35.770833, rangeKm: 250, org: 'cemaden', server: 's1', product: 'ppi', subtype: 'ppicz', velocityId: 'R12447386', vilId: 'R12442182', waldvogelId: 'R12444600', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -38.036766052, minLat: -11.785545349, maxLon: -33.480552673, maxLat: -7.296182156 } },
  { id: 'R12507565', slug: 'gama', name: 'Gama', lat: -15.9648935, lng: -48.021985, rangeKm: 250, org: 'decea', server: 's1', product: 'ppi', subtype: 'ppicz', velocityId: 'R12507562', vilId: 'R12507561', waldvogelId: 'R12504490', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -50.3701, minLat: -18.2131, maxLon: -45.6527, maxLat: -13.7188 } },
  { id: 'R12558322', slug: 'santiago', name: 'Santiago', lat: -29.2045064, lng: -54.9406844, rangeKm: 250, org: 'decea', server: 's1', product: 'ppi', subtype: 'ppicz', velocityId: 'R12558323', vilId: 'R12558321', waldvogelId: 'R12554487', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -57.5513, minLat: -31.4619, maxLon: -52.2986, maxLat: -26.956 } },
  { id: 'R12578316', slug: 'cangucu', name: 'Canguçu', lat: -31.3821522, lng: -52.7126416, rangeKm: 250, org: 'decea', server: 's1', product: 'ppi', subtype: 'ppicz', velocityId: 'R12577538', vilId: 'R12578315', waldvogelId: 'R12574488', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -55.3873, minLat: -33.6406, maxLon: -50.0057, maxLat: -29.1325 } },
  { id: 'R12897395', slug: 'almenara', name: 'Almenara', lat: -16.18919963, lng: -40.647541, rangeKm: 250, org: 'cemaden', server: 's1', product: 'ppi', subtype: 'ppicz', velocityId: 'R12897396', vilId: 'R12892192', waldvogelId: 'R12894617', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -42.990238, minLat: -18.43678125, maxLon: -38.304844, maxLat: -13.941618 } },
  { id: 'R12997399', slug: 'macae', name: 'Macaé', lat: -22.40584946, lng: -41.86047745, rangeKm: 250, org: 'inea', server: 's1', product: 'ppi', subtype: 'ppicz', velocityId: 'R12997758', vilId: 'R12992196', waldvogelId: 'R12994623', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -44.32652745, minLat: -24.65569946, maxLon: -39.39442745, maxLat: -20.15599946 } },
  { id: 'R12257381', slug: 'petrolina', name: 'Petrolina', lat: -9.367, lng: -40.573, rangeKm: 250, org: 'cemaden', server: 's1', product: 'ppi', subtype: 'ppicz', velocityId: 'R12257382', vilId: 'R12252178', waldvogelId: 'R12254494', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -42.838165283, minLat: -11.60140419, maxLon: -38.28440094, maxLat: -7.11203622 } },
  { id: 'R12227759', slug: 'lontras', name: 'Lontras', lat: -27.214725, lng: -49.4559, rangeKm: 250, org: 'sdcsc', server: 's1', product: 'ppi', subtype: 'ppicz', velocityId: 'R12227760', vilId: 'R12222198', waldvogelId: 'R12224626', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -52.029, minLat: -29.46675, maxLon: -46.8827, maxLat: -24.9627 } },

  // Radares Especiais (Mosaico custom ou Links Fixos)


];

/** URL da Cloud Function getRadarIPMet (proxy WMS mosaico estadual). */

/** URL da Cloud Function getRadarUSP (proxy pelletron 36km Capital/SP). Atualize após deploy se diferente. */

/**
 * Bounds fixos da imagem IPMet (BBOX do getRadarIPMet Cloud Function).
 * Fonte WMS: BBOX=-5635549.220625,-2817774.6103125,-5322463.1528125,-2504688.5425
 * Em EPSG:4326: oeste -55.876, sul -26.400, leste -44.516, norte -18.080
 */

/**
 * Bounds fixos da imagem USP/StarNet (extent EPSG:4326 do mapa).
 * Fonte: ol.proj.transformExtent([-47.134155, -23.930042, -46.337808, -23.192604], ...)
 */

/**
 * Bounds fixos do Radar FUNCEME Fortaleza (GMWR1000SST).
 * Extraído do KML oficial: rangeGMWR1000SST.kml
 */

/**
 * Bounds fixos do Radar FUNCEME Quixeramobim (RMT0100DS).
 * Extraído do KML oficial: rangeRMT0100DS.kml
 */

/**
 * Bounds fixos dos Radares SIPAM-HD (Norte/Centro-Oeste).
 * Extraídos da API oficial: apihidro.sipam.gov.br/radares/
 * Chave = sipamSlug (nomeRadar)
 */


/**
 * Verifica se uma estação CPTEC do Norte tem versão HD via SIPAM.
 */

/**
 * Retorna o sipamSlug para uma estação (se existir).
 */

/** Calcula distância em km entre dois pontos (Haversine). */
export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/** Retorna o centroide (centro) dos polígonos do rastro. */
export function getTrackCentroid(track: TornadoTrack): { lat: number; lng: number } | null {
  if (!track.polygons?.length) return null;
  let sumLat = 0,
    sumLng = 0,
    count = 0;
  track.polygons.forEach((poly) => {
    poly.coordinates[0]?.forEach(([lng, lat]) => {
      sumLat += lat;
      sumLng += lng;
      count++;
    });
  });
  if (count === 0) return null;
  return { lat: sumLat / count, lng: sumLng / count };
}

/** Encontra o radar mais próximo que cobre o ponto, ou null se nenhum alcançar. */
export function findNearestRadar(
  centroid: { lat: number; lng: number }
): CptecRadarStation | null {
  let best: CptecRadarStation | null = null;
  let bestDist = Infinity;
  for (const s of CPTEC_RADAR_STATIONS) {
    const d = haversineKm(centroid.lat, centroid.lng, s.lat, s.lng);
    if (d <= s.rangeKm && d < bestDist) {
      bestDist = d;
      best = s;
    }
  }
  return best;
}

/**
 * Retorna todos os radares dentro de radiusKm do ponto, ordenados por distância.
 */
export function findRadarsWithinRadius(
  centroid: { lat: number; lng: number },
  radiusKm: number = 300
): CptecRadarStation[] {
  const result: { station: CptecRadarStation; dist: number }[] = [];
  for (const s of CPTEC_RADAR_STATIONS) {
    const d = haversineKm(centroid.lat, centroid.lng, s.lat, s.lng);
    if (d <= radiusKm) {
      result.push({ station: s, dist: d });
    }
  }
  result.sort((a, b) => a.dist - b.dist);
  return result.map((r) => r.station);
}

/**
 * Calcula os bounds (NE e SW) a partir de um ponto central e um raio em km.
 * 1° latitude ≈ 111,32 km (constante); 1° longitude encolhe conforme a latitude.
 */
export function calculateRadarBounds(
  centerLat: number,
  centerLng: number,
  radiusKm: number
): { ne: { lat: number; lng: number }; sw: { lat: number; lng: number } } {
  const latDelta = radiusKm / 111.32;
  const latRadians = centerLat * (Math.PI / 180);
  const lngDelta = radiusKm / (111.32 * Math.cos(latRadians));
  return {
    ne: { lat: centerLat + latDelta, lng: centerLng + lngDelta },
    sw: { lat: centerLat - latDelta, lng: centerLng - lngDelta },
  };
}

/**
 * Geodesic forward: dado ponto de partida (lat, lng), azimute em graus e distância em km,
 * retorna o ponto de chegada. Equivalente ao g_calc.fwd do pyproj.
 * Azimute: 0=Norte, 90=Leste, 180=Sul, 270=Oeste.
 */
export function geodesicForward(
  lat: number,
  lng: number,
  bearingDeg: number,
  distanceKm: number
): { lat: number; lng: number } {
  const R = 6371;
  const d = distanceKm / R;
  const lat1 = (lat * Math.PI) / 180;
  const lng1 = (lng * Math.PI) / 180;
  const brg = (bearingDeg * Math.PI) / 180;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brg));
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(brg) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
    );
  return { lat: (lat2 * 180) / Math.PI, lng: (lng2 * 180) / Math.PI };
}

/**
 * Bounds usando geodesic forward (N/S/E/W exatos à distância radiusKm).
 * Usado para radares cuja imagem é gerada com essa projeção (ex.: IPMet).
 */
export function calculateRadarBoundsGeodesic(
  centerLat: number,
  centerLng: number,
  radiusKm: number
): { ne: { lat: number; lng: number }; sw: { lat: number; lng: number } } {
  const north = geodesicForward(centerLat, centerLng, 0, radiusKm);
  const south = geodesicForward(centerLat, centerLng, 180, radiusKm);
  const east = geodesicForward(centerLat, centerLng, 90, radiusKm);
  const west = geodesicForward(centerLat, centerLng, 270, radiusKm);
  return {
    ne: { lat: north.lat, lng: east.lng },
    sw: { lat: south.lat, lng: west.lng },
  };
}

/** Bounds geográficos da imagem PPI (quadrado centrado no radar). IPMet usa bounds fixos da WMS.
 *  @param overrideRangeKm - Se fornecido, usa esse alcance em vez do padrão da estação (ex: 400km para REDEMET Santiago).
 */
export function getRadarImageBounds(station: CptecRadarStation, overrideRangeKm?: number): {
  north: number;
  south: number;
  east: number;
  west: number;
} {
  const range = overrideRangeKm ?? station.rangeKm;
  const b = calculateRadarBoundsGeodesic(station.lat, station.lng, range);
  return {
    north: b.ne.lat,
    south: b.sw.lat,
    east: b.ne.lng,
    west: b.sw.lng,
  };
}

/** Retorna timestamp atual no formato YYYYMMDDHHmm (horário local). */
export function getNowTimestamp12(): string {
  const d = new Date();
  return (
    d.getFullYear().toString() +
    String(d.getMonth() + 1).padStart(2, '0') +
    String(d.getDate()).padStart(2, '0') +
    String(d.getHours()).padStart(2, '0') +
    String(d.getMinutes()).padStart(2, '0')
  );
}

/** Retorna timestamp de N minutos atrás (horário local do navegador). */
export function getNowMinusMinutesTimestamp12(minutesAgo: number): string {
  const d = new Date(Date.now() - minutesAgo * 60 * 1000);
  return (
    d.getFullYear().toString() +
    String(d.getMonth() + 1).padStart(2, '0') +
    String(d.getDate()).padStart(2, '0') +
    String(d.getHours()).padStart(2, '0') +
    String(d.getMinutes()).padStart(2, '0')
  );
}

/** Retorna timestamp de N minutos atrás em UTC (formato YYYYMMDDHHmm). CPTEC Nowcasting usa UTC nas imagens. */
export function getNowMinusMinutesTimestamp12UTC(minutesAgo: number): string {
  const d = new Date(Date.now() - minutesAgo * 60 * 1000);
  return (
    d.getUTCFullYear().toString() +
    String(d.getUTCMonth() + 1).padStart(2, '0') +
    String(d.getUTCDate()).padStart(2, '0') +
    String(d.getUTCHours()).padStart(2, '0') +
    String(d.getUTCMinutes()).padStart(2, '0')
  );
}

/** Subtrai minutos de um timestamp YYYYMMDDHHmm em UTC. Usado para fallback de imagens ao vivo. */
export function subtractMinutesFromTimestamp12UTC(ts12: string, minutes: number): string {
  const d = new Date(Date.UTC(
    parseInt(ts12.slice(0, 4), 10),
    parseInt(ts12.slice(4, 6), 10) - 1,
    parseInt(ts12.slice(6, 8), 10),
    parseInt(ts12.slice(8, 10), 10),
    parseInt(ts12.slice(10, 12), 10)
  ));
  d.setUTCMinutes(d.getUTCMinutes() - minutes);
  return (
    d.getUTCFullYear().toString() +
    String(d.getUTCMonth() + 1).padStart(2, '0') +
    String(d.getUTCDate()).padStart(2, '0') +
    String(d.getUTCHours()).padStart(2, '0') +
    String(d.getUTCMinutes()).padStart(2, '0')
  );
}

/**
 * Dado um timestamp nominal (YYYYMMDDHHmm), retorna o mais próximo válido para o radar.
 */
export function getNearestRadarTimestamp(
  nominalTs12: string,
  station: CptecRadarStation
): string {
  const { interval, offset } = station.slug === 'chapeco'
    ? getChapecoFallbackConfigs(nominalTs12.slice(0, 10))[0]
    : { interval: station.updateIntervalMinutes ?? 6, offset: station.updateIntervalOffsetMinutes ?? 0 };
  const dateStr = nominalTs12.slice(0, 8);
  const h = parseInt(nominalTs12.slice(8, 10), 10);
  const m = parseInt(nominalTs12.slice(10, 12), 10);
  const totalMin = h * 60 + m;
  const snapped = Math.round((totalMin - offset) / interval) * interval + offset;
  const clamped = Math.max(0, Math.min(23 * 60 + 55, snapped));
  const nh = Math.floor(clamped / 60);
  const nm = clamped % 60;
  return `${dateStr}${String(nh).padStart(2, '0')}${String(nm).padStart(2, '0')}`;
}

/**
 * Gera timestamps de radar para um intervalo de datas (00:00 do dia inicial até 23:55 do dia final).
 * Usa as regras do radar (interval, offset) e fallback para Chapecó quando aplicável.
 * Retorna timestamps no formato YYYYMMDDHHmm (12 dígitos).
 */
export function generateRadarTimestampsForDateRange(
  startDate: string,
  endDate: string,
  station: CptecRadarStation
): string[] {
  const result: string[] = [];
  if (startDate > endDate) return result;

  const { interval, offset } = station.slug === 'chapeco'
    ? getChapecoFallbackConfigs(startDate)[0]
    : { interval: station.updateIntervalMinutes ?? 6, offset: station.updateIntervalOffsetMinutes ?? 0 };

  const start = new Date(startDate + 'T00:00:00Z');
  const end = new Date(endDate + 'T23:55:00Z');

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().slice(0, 10).replace(/-/g, '');
    for (let t = offset; t <= 23 * 60 + 55; t += interval) {
      const h = Math.floor(t / 60);
      const m = t % 60;
      result.push(`${dateStr}${String(h).padStart(2, '0')}${String(m).padStart(2, '0')}`);
    }
  }
  return result;
}

/**
 * Gera timestamps a cada 5 min para um intervalo de datas (timeline unificada para mosaico).
 */
export function generateUnifiedTimelineTimestamps(startDate: string, endDate: string): string[] {
  const result: string[] = [];
  if (startDate > endDate) return result;
  const start = new Date(startDate + 'T00:00:00Z');
  const end = new Date(endDate + 'T23:55:00Z');
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().slice(0, 10).replace(/-/g, '');
    for (let t = 0; t <= 23 * 60 + 55; t += 5) {
      const h = Math.floor(t / 60);
      const m = t % 60;
      result.push(`${dateStr}${String(h).padStart(2, '0')}${String(m).padStart(2, '0')}`);
    }
  }
  return result;
}

/**
 * Monta URL Argentina (WebMET) via HTTPS direto.
 * Padrao: https://webmet.ohmc.ar/media/radares/images/{CODE}/{YYYY}/{MM}/{DD}/{CODE}_{YYYYMMDDTHHmm}00Z_{VAR}_00.png
 */

/**
 * Monta URL SIPAM-HD via proxy /api/sipam/image.
 * Chamado quando radarSourceMode==='hd' para estações com sipamSlug.
 */

/**
 * Monta URL PNG direta Nowcasting para uma estação e timestamp.
 * Padrão: https://s{N}.cptec.inpe.br/radar/{org}/{slug}/{product}/{subtype}/{year}/{month}/R{id}_{ts12}.png
 * ts12 = YYYYMMDDHHmm
 */
export function buildNowcastingPngUrl(
  station: CptecRadarStation,
  ts12: string,
  productType: 'reflectividade' | 'velocidade' | 'vil' | 'waldvogel' = 'reflectividade',
  skipProxy = false
): string {
  let finalTs12 = ts12;

  const y = finalTs12.slice(0, 4);
  const m = finalTs12.slice(4, 6);

  let prod: string = station.product;
  let sub: string = station.subtype;
  let fileId = station.id;

  if (productType === 'vil') {
    prod = 'agua_liquida';
    sub = 'vil';
    fileId = station.vilId || station.id;
  } else if (productType === 'waldvogel') {
    prod = 'echotop';
    sub = 'waldvogel';
    fileId = station.waldvogelId || station.id;
  } else if (productType === 'velocidade') {
    prod = station.product;
    sub = station.product === 'cappi' ? 'ppivr' : 'ppivr';
    fileId = station.velocityId || station.id;
  }

  const server = (productType === 'velocidade' && station.velocityServer) ? station.velocityServer : station.server;
  
  // Constrói padrão da URL do CDN, ex: https://s1.cptec.inpe.br/radar/cemaden/saoroque/ppi/ppicz/2025/11/R12537563_202511071950.png
  return `https://${server}.cptec.inpe.br/radar/${station.org}/${station.slug}/${prod}/${sub}/${y}/${m}/${fileId}_${finalTs12}.png`;
}

/** Converte lat/lng para Web Mercator (EPSG:3857). */
export function latLngToWebMercator(lat: number, lng: number): { x: number; y: number } {
  const x = (lng * 20037508.34) / 180;
  let y = Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180);
  y = (y * 20037508.34) / 180;
  return { x, y };
}

/**
 * Extrai os últimos 4 dígitos do ID (ex.: R12554965 → 4965).
 */
function getSigmaLayerSuffix(id: string): string {
  const match = id.match(/R(\d+)/);
  if (!match) return '0000';
  const num = match[1];
  return num.slice(-4);
}

/**
 * Monta URL GetMap do SIGMA WMS para a estação e timestamp.
 */
export function buildSigmaWmsUrl(
  station: CptecRadarStation,
  timestamp: string,
  bounds: { north: number; south: number; east: number; west: number },
  width = 768,
  height = 768
): string {
  const ts12 = timestamp.slice(0, 12);
  const y = ts12.slice(0, 4);
  const m = ts12.slice(4, 6);
  const prod = station.sigmaProduct ?? station.product;
  const sub = station.sigmaSubtype ?? station.subtype;
  const imgPath = `/oper/share/radar/${station.org}/${station.slug}/${prod}/${sub}/${y}/${m}/${station.id}_${ts12}.png`;

  const sw = latLngToWebMercator(bounds.south, bounds.west);
  const ne = latLngToWebMercator(bounds.north, bounds.east);
  const bbox = `${sw.x},${sw.y},${ne.x},${ne.y}`;

  const suffix = getSigmaLayerSuffix(station.id);
  const params = new URLSearchParams({
    map: '/oper/share/webdsa/sigma.map',
    SERVICE: 'WMS',
    VERSION: '1.3.0',
    REQUEST: 'GetMap',
    FORMAT: 'image/png',
    TRANSPARENT: 'true',
    LAYERS: `img_${suffix}`,
    ['img_' + suffix]: imgPath,
    WIDTH: String(width),
    HEIGHT: String(height),
    CRS: 'EPSG:3857',
    STYLES: '',
    BBOX: bbox,
  });

  return `https://maps.cptec.inpe.br/mapserv?${params.toString()}`;
}

/**
 * Monta URL direta da imagem PNG no Nowcasting (fallback).
 * @deprecated Use buildNowcastingPngUrl com CptecRadarStation.
 */
export function buildNowcastingUrl(
  station: CptecRadarStation,
  timestamp: string,
  product = 'ppi',
  subtype = 'ppicz'
): string {
  const y = timestamp.slice(0, 4);
  const m = timestamp.slice(4, 6);
  const ts12 = timestamp.slice(0, 12);
  const filename = `${station.id}_${ts12}.png`;
  return `https://s2.cptec.inpe.br/radar/sdsc/${station.slug}/${product}/${subtype}/${y}/${m}/${filename}`;
}
