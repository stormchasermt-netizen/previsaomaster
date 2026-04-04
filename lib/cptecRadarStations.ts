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
  // Radares DECEA/SDCSC (Sul)
  { id: 'R12558322', slug: 'santiago', name: 'Santiago', lat: -29.2045064, lng: -54.9406844, rangeKm: 250, org: 'decea', server: 's1', product: 'ppi', subtype: 'ppicz', velocityId: 'R12558323', vilId: 'R12558321', waldvogelId: 'R12554487', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -57.5513, minLat: -31.4619, maxLon: -52.2986, maxLat: -26.956 } },
  { id: 'R12578316', slug: 'cangucu', name: 'Canguçu', lat: -31.3821522, lng: -52.7126416, rangeKm: 250, org: 'decea', server: 's1', product: 'ppi', subtype: 'ppicz', velocityId: 'R12577538', vilId: 'R12578315', waldvogelId: 'R12574488', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -55.3873, minLat: -33.6406, maxLon: -50.0057, maxLat: -29.1325 } },
  { id: 'R12137761', slug: 'chapeco', name: 'Chapecó', lat: -27.03354, lng: -52.598625, rangeKm: 250, org: 'sdcsc', server: 's2', product: 'ppi', subtype: 'ppicz', velocityId: 'R12137762', vilId: 'R12132556', waldvogelId: 'R12134629', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -55.1672, minLat: -29.28548, maxLon: -50.03005, maxLat: -24.7816 } },
  { id: 'R12227759', slug: 'lontras', name: 'Lontras', lat: -27.214725, lng: -49.4559, rangeKm: 250, org: 'sdcsc', server: 's1', product: 'ppi', subtype: 'ppicz', velocityId: 'R12227760', vilId: 'R12222198', waldvogelId: 'R12224626', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -52.029, minLat: -29.46675, maxLon: -46.8827, maxLat: -24.9627 } },
  { id: 'R12544957', slug: 'morroigreja', name: 'Morro da Igreja', lat: -28.1078451, lng: -49.4719928, rangeKm: 250, org: 'decea', server: 's2', product: 'ppi', subtype: 'ppicz', velocityId: 'R12544956', vilId: 'R12544955', waldvogelId: 'R12544489', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -52.0632, minLat: -30.3648, maxLon: -46.8704, maxLat: -25.8599 } },

  { id: 'R12093557', slug: 'ipmet-bauru', name: 'IPMet Mosaico (PP/Bauru)', lat: -22.341270286631073, lng: -50.81852436342466, rangeKm: 240, org: 'ipmet', server: 's1', product: 'ppi', subtype: 'ppicz', updateIntervalMinutes: 15, updateIntervalOffsetMinutes: 0, bounds: { minLat: -28.9296, maxLat: -20.8215, minLon: -57.9939, maxLon: -49.0566 } },
  { id: 'POA', slug: 'climatempo-poa', name: 'Porto Alegre (Climatempo)', lat: -29.6, lng: -51.8, rangeKm: 250, org: 'cemaden', server: 's1', product: 'ppi', subtype: 'ppicz', updateIntervalMinutes: 5, updateIntervalOffsetMinutes: 0, bounds: { minLon: -58.0, minLat: -34.0, maxLon: -49.0, maxLat: -27.0 } },

  // DECEA - Sudeste/Centro-Oeste
  { id: 'R12537563', slug: 'saoroque', name: 'São Roque', lat: -23.598889, lng: -47.097778, rangeKm: 250, org: 'decea', server: 's1', product: 'ppi', subtype: 'ppicz', velocityId: 'R12537536', vilId: 'R12537542', waldvogelId: 'R12534843', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -49.6153, minLat: -25.8356, maxLon: -44.6369, maxLat: -21.3348 } },
  { id: 'R12567564', slug: 'picocouto', name: 'Pico do Couto', lat: -22.4466503, lng: -43.2971821, rangeKm: 250, org: 'decea', server: 's1', product: 'ppi', subtype: 'ppicz', velocityId: 'R12567537', vilId: 'R12567556', waldvogelId: 'R12564846', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -45.7583, minLat: -24.701, maxLon: -40.8262, maxLat: -20.2013 } },
  { id: 'R12507565', slug: 'gama', name: 'Gama', lat: -15.9648935, lng: -48.021985, rangeKm: 250, org: 'decea', server: 's1', product: 'ppi', subtype: 'ppicz', velocityId: 'R12507562', vilId: 'R12507561', waldvogelId: 'R12504490', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -50.3701, minLat: -18.2131, maxLon: -45.6527, maxLat: -13.7188 } },

  // INEA - Rio de Janeiro
  { id: 'R12957397', slug: 'guaratiba', name: 'Guaratiba', lat: -22.99324989, lng: -43.58794022, rangeKm: 250, org: 'inea', server: 's1', product: 'ppi', subtype: 'ppicz', velocityId: 'R12957398', vilId: 'R12952194', waldvogelId: 'R12954620', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -46.05399022, minLat: -25.24309989, maxLon: -41.12189022, maxLat: -20.74339989 } },
  { id: 'R12997399', slug: 'macae', name: 'Macaé', lat: -22.40584946, lng: -41.86047745, rangeKm: 250, org: 'inea', server: 's1', product: 'ppi', subtype: 'ppicz', velocityId: 'R12997758', vilId: 'R12992196', waldvogelId: 'R12994623', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -44.32652745, minLat: -24.65569946, maxLon: -39.39442745, maxLat: -20.15599946 } },

  // CEMADEN
  { id: 'R12977393', slug: 'santatereza', name: 'Santa Tereza', lat: -19.97280738, lng: -40.54523388, rangeKm: 250, org: 'cemaden', server: 's1', product: 'ppi', subtype: 'ppicz', velocityId: 'R12977394', vilId: 'R12972190', waldvogelId: 'R12974614', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -42.939214, minLat: -22.22030575, maxLon: -38.15125375, maxLat: -17.725309 } },
  { id: 'R12897395', slug: 'almenara', name: 'Almenara', lat: -16.18919963, lng: -40.647541, rangeKm: 250, org: 'cemaden', server: 's1', product: 'ppi', subtype: 'ppicz', velocityId: 'R12897396', vilId: 'R12892192', waldvogelId: 'R12894617', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -42.990238, minLat: -18.43678125, maxLon: -38.304844, maxLat: -13.941618 } },
  { id: 'R12457387', slug: 'saofrancisco', name: 'São Francisco', lat: -16.017361, lng: -44.69525, rangeKm: 250, org: 'cemaden', server: 's1', product: 'ppi', subtype: 'ppicz', velocityId: 'R12457388', vilId: 'R12452184', waldvogelId: 'R12454605', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -47.009944916, minLat: -18.237812042, maxLon: -42.335361481, maxLat: -13.748636246 } },
  { id: 'R12477391', slug: 'tresmarias', name: 'Três Marias', lat: -18.207222, lng: -45.460556, rangeKm: 250, org: 'cemaden', server: 's1', product: 'ppi', subtype: 'ppicz', velocityId: 'R12477392', vilId: 'R12472188', waldvogelId: 'R12474611', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -47.797908783, minLat: -20.43413353, maxLon: -43.067661285, maxLat: -15.945045471 } },
  { id: 'R12277383', slug: 'jaraguari', name: 'Jaraguari', lat: -20.27855, lng: -54.47396, rangeKm: 250, org: 'cemaden', server: 's1', product: 'ppi', subtype: 'ppicz', velocityId: 'R12277384', vilId: 'R12272180', waldvogelId: 'R12274497', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -56.837623596, minLat: -22.503732681, maxLon: -52.047153473, maxLat: -18.014743805 } },
  { id: 'R12247379', slug: 'natal', name: 'Natal', lat: -5.90448, lng: -35.25401, rangeKm: 250, org: 'cemaden', server: 's1', product: 'ppi', subtype: 'ppicz', velocityId: 'R12247380', vilId: 'R12242177', waldvogelId: 'R12244491', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -37.506313324, minLat: -8.141628265, maxLon: -32.989379883, maxLat: -3.65220499 } },
  { id: 'R12447385', slug: 'maceio', name: 'Maceió', lat: -9.551389, lng: -35.770833, rangeKm: 250, org: 'cemaden', server: 's1', product: 'ppi', subtype: 'ppicz', velocityId: 'R12447386', vilId: 'R12442182', waldvogelId: 'R12444600', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -38.036766052, minLat: -11.785545349, maxLon: -33.480552673, maxLat: -7.296182156 } },
  { id: 'R12467389', slug: 'salvador', name: 'Salvador', lat: -12.9025, lng: -38.326667, rangeKm: 250, org: 'cemaden', server: 's1', product: 'ppi', subtype: 'ppicz', velocityId: 'R12467390', vilId: 'R12462186', waldvogelId: 'R12464608', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -40.613765717, minLat: -15.134028435, maxLon: -36.004219055, maxLat: -10.644747734 } },
  { id: 'R12257381', slug: 'petrolina', name: 'Petrolina', lat: -9.367, lng: -40.573, rangeKm: 250, org: 'cemaden', server: 's1', product: 'ppi', subtype: 'ppicz', velocityId: 'R12257382', vilId: 'R12252178', waldvogelId: 'R12254494', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -42.838165283, minLat: -11.60140419, maxLon: -38.28440094, maxLat: -7.11203622 } },

  // Radares Exclusivos REDEMET (DECEA)
  { id: 'R102', slug: 'vilhena', name: 'Vilhena (REDEMET)', lat: -12.74, lng: -60.14, rangeKm: 400, org: 'redemet', server: 's1', product: 'ppi', subtype: 'ppicz', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0 },
  { id: 'R104', slug: 'rio-branco', name: 'Rio Branco (REDEMET)', lat: -9.97, lng: -67.82, rangeKm: 400, org: 'redemet', server: 's1', product: 'ppi', subtype: 'ppicz', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0 },

  // Radares Argentina (WebMET)
  { id: 'AR5', slug: 'argentina-AR5', name: 'Pergamino', lat: -33.94612, lng: -60.5626, rangeKm: 240, org: 'argentina', server: 'webmet', product: 'ppi', subtype: 'COLMAX', velocityId: 'argentina-AR5', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -63.22684965, minLat: -36.10942951, maxLon: -57.89835035, maxLat: -31.75583577 } },
  { id: 'AR7', slug: 'argentina-AR7', name: 'Paraná', lat: -31.84849, lng: -60.53724, rangeKm: 240, org: 'argentina', server: 'webmet', product: 'ppi', subtype: 'COLMAX', velocityId: 'argentina-AR7', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -63.13431164, minLat: -34.01253787, maxLon: -57.94016836, maxLat: -29.65949611 } },
  { id: 'AR8', slug: 'argentina-AR8', name: 'Anguil', lat: -36.53965, lng: -63.98984, rangeKm: 240, org: 'argentina', server: 'webmet', product: 'ppi', subtype: 'COLMAX', velocityId: 'argentina-AR8', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -66.74737734, minLat: -38.70201966, maxLon: -61.23230266, maxLat: -34.34767551 } },
  { id: 'RMA1', slug: 'argentina-RMA1', name: 'Córdoba', lat: -31.44138889, lng: -64.19194444, rangeKm: 240, org: 'argentina', server: 'webmet', product: 'ppi', subtype: 'COLMAX', velocityId: 'argentina-RMA1', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -66.67878, minLat: -33.535119, maxLon: -61.705059, maxLat: -29.29124 } },
  { id: 'RMA10', slug: 'argentina-RMA10', name: 'Espora', lat: -38.73426, lng: -62.16341, rangeKm: 240, org: 'argentina', server: 'webmet', product: 'ppi', subtype: 'COLMAX', velocityId: 'argentina-RMA10', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -64.99761839, minLat: -40.88681163, maxLon: -59.32920161, maxLat: -36.55001614 } },
  { id: 'RMA11', slug: 'argentina-RMA11', name: 'Termas de Río Hondo', lat: -27.5026, lng: -64.90575, rangeKm: 240, org: 'argentina', server: 'webmet', product: 'ppi', subtype: 'COLMAX', velocityId: 'argentina-RMA11', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -67.37346279, minLat: -29.6590762, maxLon: -62.43803721, maxLat: -25.32531973 } },
  { id: 'RMA2', slug: 'argentina-RMA2', name: 'Ezeiza', lat: -34.80082, lng: -58.51557, rangeKm: 240, org: 'argentina', server: 'webmet', product: 'ppi', subtype: 'COLMAX', velocityId: 'argentina-RMA2', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -61.19195837, minLat: -36.95030641, maxLon: -55.83918163, maxLat: -32.62384745 } },
  { id: 'RMA3', slug: 'argentina-RMA3', name: 'Las Lomitas', lat: -24.73028, lng: -60.55139, rangeKm: 240, org: 'argentina', server: 'webmet', product: 'ppi', subtype: 'COLMAX', velocityId: 'argentina-RMA3', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -62.95611203, minLat: -26.88760874, maxLon: -58.14666797, maxLat: -22.55452644 } },
  { id: 'RMA4', slug: 'argentina-RMA4', name: 'Resistencia', lat: -27.45167, lng: -59.05083, rangeKm: 240, org: 'argentina', server: 'webmet', product: 'ppi', subtype: 'COLMAX', velocityId: 'argentina-RMA4', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -61.51730349, minLat: -29.60816238, maxLon: -56.58435651, maxLat: -25.2744181 } },
  { id: 'RMA5', slug: 'argentina-RMA5', name: 'Bernardo de Irigoyen', lat: -26.27812, lng: -53.67085, rangeKm: 240, org: 'argentina', server: 'webmet', product: 'ppi', subtype: 'COLMAX', velocityId: 'argentina-RMA5', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -56.10963605, minLat: -28.43498, maxLon: -51.23206395, maxLat: -24.10151811 } },
  { id: 'RMA6', slug: 'argentina-RMA6', name: 'Mar del Plata', lat: -37.91306, lng: -57.52783, rangeKm: 240, org: 'argentina', server: 'webmet', product: 'ppi', subtype: 'COLMAX', velocityId: 'argentina-RMA6', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -60.3217477, minLat: -40.06141318, maxLon: -54.7339123, maxLat: -35.73402595 } },
  { id: 'RMA7', slug: 'argentina-RMA7', name: 'Neuquén', lat: -38.87662, lng: -68.14489, rangeKm: 240, org: 'argentina', server: 'webmet', product: 'ppi', subtype: 'COLMAX', velocityId: 'argentina-RMA7', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -70.97905389, minLat: -41.02461636, maxLon: -65.31072611, maxLat: -36.69690636 } },
  { id: 'RMA8', slug: 'argentina-RMA8', name: 'Mercedes', lat: -29.19591002, lng: -58.04485001, rangeKm: 240, org: 'argentina', server: 'webmet', product: 'ppi', subtype: 'COLMAX', velocityId: 'argentina-RMA8', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -60.55025935, minLat: -31.3473284, maxLon: -55.53944065, maxLat: -27.02227747 } },
  { id: 'RMA00', slug: 'argentina-RMA00', name: 'Bariloche', lat: -41.13944, lng: -71.14944, rangeKm: 240, org: 'argentina', server: 'webmet', product: 'ppi', subtype: 'COLMAX', velocityId: 'argentina-RMA00', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -72.93631171, minLat: -42.46293648, maxLon: -69.36256829, maxLat: -39.80270663 } },
  { id: 'RMA12', slug: 'argentina-RMA12', name: 'Las Grutas', lat: -40.77221, lng: -65.07604, rangeKm: 240, org: 'argentina', server: 'webmet', product: 'ppi', subtype: 'COLMAX', velocityId: 'argentina-RMA12', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -67.89996, minLat: -42.911537, maxLon: -62.25211, maxLat: -38.632874 } },
  { id: 'RMA9', slug: 'argentina-RMA9', name: 'Río Grande', lat: -53.78399, lng: -67.74426, rangeKm: 240, org: 'argentina', server: 'webmet', product: 'ppi', subtype: 'COLMAX', velocityId: 'argentina-RMA9', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -70.0463166, minLat: -55.10458756, maxLon: -65.4422034, maxLat: -52.44310397 } },
  { id: 'RMA15', slug: 'argentina-RMA15', name: 'Patquía', lat: -30.0308, lng: -66.8763, rangeKm: 240, org: 'argentina', server: 'webmet', product: 'ppi', subtype: 'COLMAX', velocityId: 'argentina-RMA15', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -69.3605, minLat: -32.1475, maxLon: -64.3725, maxLat: -27.848 } },
  { id: 'RMA16', slug: 'argentina-RMA16', name: 'Villa Reynolds', lat: -33.7182907, lng: -65.375463, rangeKm: 240, org: 'argentina', server: 'webmet', product: 'ppi', subtype: 'COLMAX', velocityId: 'argentina-RMA16', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -67.95, minLat: -35.875, maxLon: -62.77, maxLat: -31.581 } },
  { id: 'RMA14', slug: 'argentina-RMA14', name: 'Bolívar', lat: -36.189026, lng: -61.070413, rangeKm: 240, org: 'argentina', server: 'webmet', product: 'ppi', subtype: 'COLMAX', velocityId: 'argentina-RMA14', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -63.751666, minLat: -38.39444, maxLon: -58.238055, maxLat: -34.06 } },
  { id: 'RMA17', slug: 'argentina-RMA17', name: 'Alejandro Roca', lat: -33.3514, lng: -63.7036, rangeKm: 240, org: 'argentina', server: 'webmet', product: 'ppi', subtype: 'COLMAX', velocityId: 'argentina-RMA17', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -66.281474, minLat: -35.483375, maxLon: -61.125726, maxLat: -31.155556 } },
  { id: 'RMA13', slug: 'argentina-RMA13', name: 'Ituzaingó (Corrientes)', lat: -27.622289, lng: -56.841807, rangeKm: 240, org: 'argentina', server: 'webmet', product: 'ppi', subtype: 'COLMAX', velocityId: 'argentina-RMA13', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -59.21546, minLat: -29.67647, maxLon: -54.37738, maxLat: -25.44618 } },
  { id: 'RMA18', slug: 'argentina-RMA18', name: 'Santa Isabel (La Pampa)', lat: -36.223167, lng: -66.936389, rangeKm: 240, org: 'argentina', server: 'webmet', product: 'ppi', subtype: 'COLMAX', velocityId: 'argentina-RMA18', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -69.545614, minLat: -38.244328, maxLon: -64.177172, maxLat: -33.929631 } },

  // SIPAM - Norte/Centro-Oeste (Super Res = CPTEC/Nowcasting, HD = SIPAM via /api/sipam/image)
  { id: 'R12797767', slug: 'portovelho', name: 'Porto Velho', lat: -8.7075825, lng: -63.8892325, rangeKm: 500, org: 'sipam', server: 's1', product: 'ppi', subtype: 'ppicz', velocityId: 'R12797370', vilId: 'R12792393', waldvogelId: 'R12794665', sipamSlug: 'sbpv', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -66.1714, minLat: -10.951855, maxLon: -61.607065, maxLat: -6.46331 } },
  { id: 'R12767583', slug: 'cruzeirodosul', name: 'Cruzeiro do Sul', lat: -7.5884075, lng: -72.76509, rangeKm: 500, org: 'sipam', server: 's2', product: 'ppi', subtype: 'ppicz', velocityId: 'R12767363', vilId: 'R12762566', waldvogelId: 'R12764641', sipamSlug: 'sbcz', updateIntervalMinutes: 12, updateIntervalOffsetMinutes: 0, bounds: { minLon: -75.0391, minLat: -9.832245, maxLon: -70.49108, maxLat: -5.34457 } },
  { id: 'R12827598', slug: 'tabatinga', name: 'Tabatinga', lat: -4.2425575, lng: -69.93045, rangeKm: 500, org: 'sipam', server: 's1', product: 'ppi', subtype: 'ppicz', velocityId: 'R12827378', vilId: 'R12822578', waldvogelId: 'R12824659', sipamSlug: 'sbtt', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -72.1855, minLat: -6.485105, maxLon: -67.6754, maxLat: -2.00001 } },
  { id: 'R12837597', slug: 'tefe', name: 'Tefé', lat: -3.3672025, lng: -64.6886875, rangeKm: 500, org: 'sipam', server: 's1', product: 'ppi', subtype: 'ppicz', velocityId: 'R12837377', vilId: 'R12832572', waldvogelId: 'R12834650', sipamSlug: 'sbtf', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -66.9401, minLat: -5.609415, maxLon: -62.437275, maxLat: -1.12499 } },
  { id: 'R12817594', slug: 'saogabriel', name: 'São Gabriel da Cachoeira (AM)', lat: -0.139185, lng: -67.05253, rangeKm: 500, org: 'sipam', server: 's1', product: 'ppi', subtype: 'ppicz', velocityId: 'R12817374', vilId: 'R12812574', waldvogelId: 'R12814653', sipamSlug: 'sbua', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -69.2951, minLat: -2.38039, maxLon: -64.80996, maxLat: 2.10202 } },
  { id: 'R12787587', slug: 'manaus', name: 'Manaus', lat: -3.143476, lng: -59.986935, rangeKm: 500, org: 'sipam', server: 's1', product: 'ppi', subtype: 'ppicz', velocityId: 'R12787367', vilId: 'R12782570', waldvogelId: 'R12784647', sipamSlug: 'sbmn', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -62.2375, minLat: -5.385601, maxLon: -57.73637, maxLat: -0.901351 } },
  { id: 'R12757581', slug: 'boavista', name: 'Boa Vista', lat: 2.8479, lng: -60.695705, rangeKm: 500, org: 'sipam', server: 's1', product: 'ppi', subtype: 'ppicz', velocityId: 'R12757361', vilId: 'R12752564', waldvogelId: 'R12754638', sipamSlug: 'sbbv', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -62.9452, minLat: 0.60589, maxLon: -58.44621, maxLat: 5.08991 } },
  { id: 'R12777586', slug: 'macapa', name: 'Macapá', lat: 0.050085, lng: -51.0923775, rangeKm: 500, org: 'sipam', server: 's1', product: 'ppi', subtype: 'ppicz', velocityId: 'R12777366', vilId: 'R12772568', waldvogelId: 'R12774644', sipamSlug: 'sbmq', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -53.3348, minLat: -2.19112, maxLon: -48.849955, maxLat: 2.29129 } },
  { id: 'R12807592', slug: 'santarem', name: 'Santarém', lat: -2.424504, lng: -54.7945175, rangeKm: 500, org: 'sipam', server: 's1', product: 'ppi', subtype: 'ppicz', velocityId: 'R12807372', vilId: 'R12802579', waldvogelId: 'R12804662', sipamSlug: 'sbsn', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -57.0426, minLat: -4.666354, maxLon: -52.546435, maxLat: -0.182654 } },
  { id: 'R12907765', slug: 'saoluis', name: 'São Luís', lat: -2.595277, lng: -44.23476, rangeKm: 500, org: 'sipam', server: 's1', product: 'ppi', subtype: 'ppicz', velocityId: 'R12907766', vilId: 'R12902576', waldvogelId: 'R12904656', sipamSlug: 'sbsl', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -46.4834, minLat: -4.837192, maxLon: -41.98612, maxLat: -0.353362 } },
  { id: 'R12800001', slug: 'belem', name: 'Belém', lat: -1.4019665, lng: -48.45733, rangeKm: 500, org: 'sipam', server: 's1', product: 'ppi', subtype: 'ppicz', sipamSlug: 'sbbe', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -50.7025, minLat: -3.643424, maxLon: -46.21216, maxLat: 0.839491 } },

  // FUNCEME
  { id: 'R13851142', funcemeId: 'GMWR1000SST', slug: 'funceme-fortaleza', name: 'Fortaleza (FUNCEME)', lat: -3.7944, lng: -38.5575, rangeKm: 480, org: 'funceme', server: 's1', product: 'ppi', subtype: 'ppicz', velocityId: 'R13851143', vilId: 'R13851137', waldvogelId: 'R13851141', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -42.1691, minLat: -7.378549, maxLon: -34.94578, maxLat: -0.205189 } },
  { id: 'R13967017', funcemeId: 'DWSR92X', slug: 'funceme-quixeramobim', name: 'Quixeramobim (FUNCEME)', lat: -5.06917, lng: -39.2669, rangeKm: 400, org: 'funceme', server: 's1', product: 'ppi', subtype: 'ppicz', velocityId: 'R13967018', vilId: 'R13967012', waldvogelId: 'R13967016', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -42.8899, minLat: -8.6533, maxLon: -35.6439, maxLat: -1.47747 } },
  { id: 'RMT0100DS', funcemeId: 'RMT0100DS', slug: 'funceme-ceara', name: 'Ceará Mosaico (FUNCEME)', lat: -5.0691, lng: -39.2669, rangeKm: 600, org: 'funceme', server: 's1', product: 'ppi', subtype: 'ppicz', updateIntervalMinutes: 15, updateIntervalOffsetMinutes: 0, bounds: { minLon: -42.6806, minLat: -12.4827, maxLon: -35.8536, maxLat: -1.6557 } },

  // Fontes especiais (WMS/proxy)
  { id: 'USP', slug: 'usp-starnet', name: 'USP/StarNet (São Paulo)', lat: -23.5220, lng: -46.6181, rangeKm: 36, org: 'decea', server: 's1', product: 'ppi', subtype: 'ppicz', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0 },

  /**
   * Pastas em `radar_ao_vivo_2` (GCS) — slugs que não existiam antes; coords para bounds do ao-vivo-2 (mapa + PPI).
   * Alcance geodésico padrão quando não há bounds explícitos em getRadarImageBounds.
   */
  { id: 'R-AOVIVO2-ALMEIRIM', slug: 'almeirim', name: 'Almeirim (PA)', lat: -3.094, lng: -52.25, rangeKm: 250, org: 'sipam', server: 's1', product: 'ppi', subtype: 'ppicz', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0 },
  { id: 'R-AOVIVO2-PICOS', slug: 'picos', name: 'Picos (PI)', lat: -7.077, lng: -41.467, rangeKm: 250, org: 'cemaden', server: 's1', product: 'ppi', subtype: 'ppicz', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0 },
  { id: 'R-AOVIVO2-USP-ITAITUBA', slug: 'usp-itaituba', name: 'USP Itaituba (PA)', lat: -3.259, lng: -55.991, rangeKm: 250, org: 'decea', server: 's1', product: 'ppi', subtype: 'ppicz', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0 },

  // Radares Argentina (WebMET)
  { id: 'AR5', slug: 'argentina-AR5', name: 'Pergamino', lat: -33.94612, lng: -60.5626, rangeKm: 240, org: 'argentina', server: 'webmet', product: 'ppi', subtype: 'COLMAX', velocityId: 'argentina-AR5', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -63.22684965, minLat: -36.10942951, maxLon: -57.89835035, maxLat: -31.75583577 } },
  { id: 'AR7', slug: 'argentina-AR7', name: 'Paraná', lat: -31.84849, lng: -60.53724, rangeKm: 240, org: 'argentina', server: 'webmet', product: 'ppi', subtype: 'COLMAX', velocityId: 'argentina-AR7', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -63.13431164, minLat: -34.01253787, maxLon: -57.94016836, maxLat: -29.65949611 } },
  { id: 'AR8', slug: 'argentina-AR8', name: 'Anguil', lat: -36.53965, lng: -63.98984, rangeKm: 240, org: 'argentina', server: 'webmet', product: 'ppi', subtype: 'COLMAX', velocityId: 'argentina-AR8', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -66.74737734, minLat: -38.70201966, maxLon: -61.23230266, maxLat: -34.34767551 } },
  { id: 'RMA1', slug: 'argentina-RMA1', name: 'Córdoba', lat: -31.44138889, lng: -64.19194444, rangeKm: 240, org: 'argentina', server: 'webmet', product: 'ppi', subtype: 'COLMAX', velocityId: 'argentina-RMA1', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -66.67878, minLat: -33.535119, maxLon: -61.705059, maxLat: -29.29124 } },
  { id: 'RMA10', slug: 'argentina-RMA10', name: 'Espora', lat: -38.73426, lng: -62.16341, rangeKm: 240, org: 'argentina', server: 'webmet', product: 'ppi', subtype: 'COLMAX', velocityId: 'argentina-RMA10', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -64.99761839, minLat: -40.88681163, maxLon: -59.32920161, maxLat: -36.55001614 } },
  { id: 'RMA11', slug: 'argentina-RMA11', name: 'Termas de Río Hondo', lat: -27.5026, lng: -64.90575, rangeKm: 240, org: 'argentina', server: 'webmet', product: 'ppi', subtype: 'COLMAX', velocityId: 'argentina-RMA11', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -67.37346279, minLat: -29.6590762, maxLon: -62.43803721, maxLat: -25.32531973 } },
  { id: 'RMA2', slug: 'argentina-RMA2', name: 'Ezeiza', lat: -34.80082, lng: -58.51557, rangeKm: 240, org: 'argentina', server: 'webmet', product: 'ppi', subtype: 'COLMAX', velocityId: 'argentina-RMA2', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -61.19195837, minLat: -36.95030641, maxLon: -55.83918163, maxLat: -32.62384745 } },
  { id: 'RMA3', slug: 'argentina-RMA3', name: 'Las Lomitas', lat: -24.73028, lng: -60.55139, rangeKm: 240, org: 'argentina', server: 'webmet', product: 'ppi', subtype: 'COLMAX', velocityId: 'argentina-RMA3', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -62.95611203, minLat: -26.88760874, maxLon: -58.14666797, maxLat: -22.55452644 } },
  { id: 'RMA4', slug: 'argentina-RMA4', name: 'Resistencia', lat: -27.45167, lng: -59.05083, rangeKm: 240, org: 'argentina', server: 'webmet', product: 'ppi', subtype: 'COLMAX', velocityId: 'argentina-RMA4', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -61.51730349, minLat: -29.60816238, maxLon: -56.58435651, maxLat: -25.2744181 } },
  { id: 'RMA5', slug: 'argentina-RMA5', name: 'Bernardo de Irigoyen', lat: -26.27812, lng: -53.67085, rangeKm: 240, org: 'argentina', server: 'webmet', product: 'ppi', subtype: 'COLMAX', velocityId: 'argentina-RMA5', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -56.10963605, minLat: -28.43498, maxLon: -51.23206395, maxLat: -24.10151811 } },
  { id: 'RMA6', slug: 'argentina-RMA6', name: 'Mar del Plata', lat: -37.91306, lng: -57.52783, rangeKm: 240, org: 'argentina', server: 'webmet', product: 'ppi', subtype: 'COLMAX', velocityId: 'argentina-RMA6', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -60.3217477, minLat: -40.06141318, maxLon: -54.7339123, maxLat: -35.73402595 } },
  { id: 'RMA7', slug: 'argentina-RMA7', name: 'Neuquén', lat: -38.87662, lng: -68.14489, rangeKm: 240, org: 'argentina', server: 'webmet', product: 'ppi', subtype: 'COLMAX', velocityId: 'argentina-RMA7', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -70.97905389, minLat: -41.02461636, maxLon: -65.31072611, maxLat: -36.69690636 } },
  { id: 'RMA8', slug: 'argentina-RMA8', name: 'Mercedes', lat: -29.19591002, lng: -58.04485001, rangeKm: 240, org: 'argentina', server: 'webmet', product: 'ppi', subtype: 'COLMAX', velocityId: 'argentina-RMA8', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -60.55025935, minLat: -31.3473284, maxLon: -55.53944065, maxLat: -27.02227747 } },
  { id: 'RMA00', slug: 'argentina-RMA00', name: 'Bariloche', lat: -41.13944, lng: -71.14944, rangeKm: 240, org: 'argentina', server: 'webmet', product: 'ppi', subtype: 'COLMAX', velocityId: 'argentina-RMA00', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -72.93631171, minLat: -42.46293648, maxLon: -69.36256829, maxLat: -39.80270663 } },
  { id: 'RMA12', slug: 'argentina-RMA12', name: 'Las Grutas', lat: -40.77221, lng: -65.07604, rangeKm: 240, org: 'argentina', server: 'webmet', product: 'ppi', subtype: 'COLMAX', velocityId: 'argentina-RMA12', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -67.89996, minLat: -42.911537, maxLon: -62.25211, maxLat: -38.632874 } },
  { id: 'RMA9', slug: 'argentina-RMA9', name: 'Río Grande', lat: -53.78399, lng: -67.74426, rangeKm: 240, org: 'argentina', server: 'webmet', product: 'ppi', subtype: 'COLMAX', velocityId: 'argentina-RMA9', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -70.0463166, minLat: -55.10458756, maxLon: -65.4422034, maxLat: -52.44310397 } },
  { id: 'RMA15', slug: 'argentina-RMA15', name: 'Patquía', lat: -30.0308, lng: -66.8763, rangeKm: 240, org: 'argentina', server: 'webmet', product: 'ppi', subtype: 'COLMAX', velocityId: 'argentina-RMA15', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -69.3605, minLat: -32.1475, maxLon: -64.3725, maxLat: -27.848 } },
  { id: 'RMA16', slug: 'argentina-RMA16', name: 'Villa Reynolds', lat: -33.7182907, lng: -65.375463, rangeKm: 240, org: 'argentina', server: 'webmet', product: 'ppi', subtype: 'COLMAX', velocityId: 'argentina-RMA16', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -67.95, minLat: -35.875, maxLon: -62.77, maxLat: -31.581 } },
  { id: 'RMA14', slug: 'argentina-RMA14', name: 'Bolívar', lat: -36.189026, lng: -61.070413, rangeKm: 240, org: 'argentina', server: 'webmet', product: 'ppi', subtype: 'COLMAX', velocityId: 'argentina-RMA14', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -63.751666, minLat: -38.39444, maxLon: -58.238055, maxLat: -34.06 } },
  { id: 'RMA17', slug: 'argentina-RMA17', name: 'Alejandro Roca', lat: -33.3514, lng: -63.7036, rangeKm: 240, org: 'argentina', server: 'webmet', product: 'ppi', subtype: 'COLMAX', velocityId: 'argentina-RMA17', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -66.281474, minLat: -35.483375, maxLon: -61.125726, maxLat: -31.155556 } },
  { id: 'RMA13', slug: 'argentina-RMA13', name: 'Ituzaingó (Corrientes)', lat: -27.622289, lng: -56.841807, rangeKm: 240, org: 'argentina', server: 'webmet', product: 'ppi', subtype: 'COLMAX', velocityId: 'argentina-RMA13', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -59.21546, minLat: -29.67647, maxLon: -54.37738, maxLat: -25.44618 } },
  { id: 'RMA18', slug: 'argentina-RMA18', name: 'Santa Isabel (La Pampa)', lat: -36.223167, lng: -66.936389, rangeKm: 240, org: 'argentina', server: 'webmet', product: 'ppi', subtype: 'COLMAX', velocityId: 'argentina-RMA18', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -69.545614, minLat: -38.244328, maxLon: -64.177172, maxLat: -33.929631 } },

  // REDEMET-only (GCS redemet-{codigo}) — bounds/lat/lon do CSV radares Redemet (DECEA)
  { id: 'REDEMET-be', slug: 'redemet-be', name: 'Belém/PA (REDEMET)', lat: -1.406667, lng: -48.461389, rangeKm: 250, org: 'redemet', server: 'decea', product: 'ppi', subtype: 'maxcappi', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -50.6124, minLat: -3.5522, maxLon: -46.3272222222, maxLat: 0.7478 } },
  { id: 'REDEMET-bv', slug: 'redemet-bv', name: 'Boa Vista/RR (REDEMET)', lat: 2.844166667, lng: -60.70027777778, rangeKm: 250, org: 'redemet', server: 'decea', product: 'ppi', subtype: 'maxcappi', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -62.8548, minLat: 0.6957998116, maxLon: -58.5383974008, maxLat: 4.9983 } },
  { id: 'REDEMET-cn', slug: 'redemet-cn', name: 'Canguçu/RS (REDEMET)', lat: -31.404, lng: -52.701644, rangeKm: 250, org: 'redemet', server: 'decea', product: 'ppi', subtype: 'maxcappi', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -55.3873, minLat: -33.6425, maxLon: -50.0073, maxLat: -29.1325 } },
  { id: 'REDEMET-mn', slug: 'redemet-mn', name: 'Manaus/AM (REDEMET)', lat: -3.149216, lng: -59.991881, rangeKm: 400, org: 'redemet', server: 'decea', product: 'ppi', subtype: 'maxcappi', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -62.1475, minLat: -6.7180555556, maxLon: -57.8461111111, maxLat: 0.4505555556 } },
  { id: 'REDEMET-mo', slug: 'redemet-mo', name: 'Maceió/AL (REDEMET)', lat: -9.55129, lng: -35.77068, rangeKm: 250, org: 'redemet', server: 'decea', product: 'ppi', subtype: 'maxcappi', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -38.036766, minLat: -11.79153875, maxLon: -33.47447175, maxLat: -7.296182 } },
  { id: 'REDEMET-mq', slug: 'redemet-mq', name: 'Macapá/AP (REDEMET)', lat: -0.047222, lng: -51.097778, rangeKm: 400, org: 'redemet', server: 'decea', product: 'ppi', subtype: 'maxcappi', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -54.6794444444, minLat: -3.5119444444, maxLon: -47.5502777778, maxLat: 3.6388888889 } },
  { id: 'REDEMET-pc', slug: 'redemet-pc', name: 'Pico do Couto/RJ (REDEMET)', lat: -22.464278, lng: -43.297476, rangeKm: 250, org: 'redemet', server: 'decea', product: 'ppi', subtype: 'maxcappi', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -45.7583, minLat: -24.701, maxLon: -40.8262, maxLat: -20.2013 } },
  { id: 'REDEMET-pl', slug: 'redemet-pl', name: 'Petrolina/PE (REDEMET)', lat: -9.367, lng: -40.573, rangeKm: 250, org: 'redemet', server: 'decea', product: 'ppi', subtype: 'maxcappi', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -42.838165, minLat: -11.607397, maxLon: -38.27832025, maxLat: -7.112036 } },
  { id: 'REDEMET-sg', slug: 'redemet-sg', name: 'Santiago/RS (REDEMET)', lat: -29.225213, lng: -54.930257, rangeKm: 250, org: 'redemet', server: 'decea', product: 'ppi', subtype: 'maxcappi', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -57.5513, minLat: -31.4619453696, maxLon: -52.2986220527, maxLat: -26.956 } },
  { id: 'REDEMET-sl', slug: 'redemet-sl', name: 'São Luís/MA (REDEMET)', lat: -2.597222, lng: -44.2375, rangeKm: 400, org: 'redemet', server: 'decea', product: 'ppi', subtype: 'maxcappi', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -47.8166666667, minLat: -6.1666666667, maxLon: -40.6833333333, maxLat: 0.9833333333 } },
  { id: 'REDEMET-sn', slug: 'redemet-sn', name: 'Santarém/PA (REDEMET)', lat: -2.429722, lng: -54.798889, rangeKm: 250, org: 'redemet', server: 'decea', product: 'ppi', subtype: 'maxcappi', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -56.9522, minLat: -4.5765000922, maxLon: -52.6384982363, maxLat: -0.2744 } },
  { id: 'REDEMET-sr', slug: 'redemet-sr', name: 'São Roque/SP (REDEMET)', lat: -23.601915, lng: -47.094063, rangeKm: 250, org: 'redemet', server: 'decea', product: 'ppi', subtype: 'maxcappi', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -49.5836753845, minLat: -25.8431473784, maxLon: -44.6049841568, maxLat: -21.342464447 } },
  { id: 'REDEMET-st', slug: 'redemet-st', name: 'Santa Tereza/ES (REDEMET)', lat: -19.98887, lng: -40.5794, rangeKm: 250, org: 'redemet', server: 'decea', product: 'ppi', subtype: 'maxcappi', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -42.939214, minLat: -22.22030575, maxLon: -38.15125375, maxLat: -17.725309 } },
  { id: 'REDEMET-ua', slug: 'redemet-ua', name: 'São Gabriel da Cachoeira/AM (REDEMET)', lat: -0.143611, lng: -67.056944, rangeKm: 250, org: 'redemet', server: 'decea', product: 'ppi', subtype: 'maxcappi', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -69.2051, minLat: -2.2906000139, maxLon: -64.9017020167, maxLat: 2.0104 } },
  { id: 'BRSC3', slug: 'simepar-cascavel', name: 'Simepar - Cascavel (Mosaico)', lat: -24.8755, lng: -53.5252, rangeKm: 500, org: 'simepar', server: 'rainviewer', product: 'ppi', subtype: 'ppi', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: -57.149369633169535, minLat: -28.537878289124517, maxLon: -45.834686785981404, maxLat: -21.006712988730044 } },
];

/** URL da Cloud Function getRadarIPMet (proxy WMS mosaico estadual). */
export const GET_RADAR_IPMET_URL = 'https://getradaripmet-kj7x6j3jsa-uc.a.run.app';

/** URL da Cloud Function getRadarUSP (proxy pelletron 36km Capital/SP). Atualize após deploy se diferente. */
export const GET_RADAR_USP_URL = 'https://us-central1-studio-4398873450-7cc8f.cloudfunctions.net/getRadarUSP';

/**
 * Bounds fixos da imagem IPMet (Rainviewer / Mosaico)
 * Bounds para o produto PPI (raio de 450 km):
 * Latitude Mínima: -28.9296
 * Longitude Mínima: -57.9939
 * Latitude Máxima: -20.8215
 * Longitude Máxima: -49.0566
 */
export const IPMET_FIXED_BOUNDS = {
  north: -20.8215,
  south: -28.9296,
  east: -49.0566,
  west: -57.9939,
  ne: { lat: -20.8215, lng: -49.0566 },
  sw: { lat: -28.9296, lng: -57.9939 },
};

/**
 * Bounds fixos da imagem USP/StarNet (extent EPSG:4326 do mapa).
 * Fonte: ol.proj.transformExtent([-47.134155, -23.930042, -46.337808, -23.192604], ...)
 */
export const USP_STARNET_FIXED_BOUNDS = {
  north: -23.288351,
  south: -23.755570,
  east: -46.289584,
  west: -46.946592,
  ne: { lat: -23.288351, lng: -46.289584 },
  sw: { lat: -23.755570, lng: -46.946592 },
};

/**
 * Bounds fixos do Radar FUNCEME Fortaleza (GMWR1000SST).
 * Extraído do KML oficial: rangeGMWR1000SST.kml
 */
export const FUNCEME_FORTALEZA_FIXED_BOUNDS = {
  north: -2.753227,
  south: -5.032130,
  east: -37.323134,
  west: -39.592087,
  ne: { lat: -2.753227, lng: -37.323134 },
  sw: { lat: -5.032130, lng: -39.592087 },
};

/**
 * Bounds fixos do Radar FUNCEME Quixeramobim (RMT0100DS).
 * Extraído do KML oficial: rangeRMT0100DS.kml
 */
export const FUNCEME_QUIXERAMOBIM_FIXED_BOUNDS = {
  north: -1.688086,
  south: -8.449901,
  east: -35.895440,
  west: -42.638776,
  ne: { lat: -1.688086, lng: -35.895440 },
  sw: { lat: -8.449901, lng: -42.638776 },
};

/**
 * Bounds fixos dos Radares SIPAM-HD (Norte/Centro-Oeste).
 * Extraídos da API oficial: apihidro.sipam.gov.br/radares/
 * Chave = sipamSlug (nomeRadar)
 */
export const SIPAM_HD_FIXED_BOUNDS: Record<string, { north: number; south: number; east: number; west: number }> = {
  sbbe: { north: 0.85202, south: -3.67153, east: -46.21039, west: -50.70789 },
  sbbv: { north: 4.99792, south: 0.689, east: -58.5388, west: -62.8617 },
  sbcz: { north: -5.43696, south: -9.74925, east: -70.585, west: -74.9545 },
  sbmq: { north: 2.19931, south: -2.10811, east: -48.9421, west: -53.2517 },
  sbmn: { north: -0.99356, south: -5.3026, east: -57.829, west: -62.1539 },
  sbpv: { north: -6.55576, south: -10.868, east: -61.701, west: -66.0863 },
  sbsn: { north: -0.274719, south: -4.58335, east: -52.6389, west: -56.9591 },
  sbua: { north: 2.01003, south: -2.29739, east: -64.902, west: -69.2119 },
  sbsl: { north: -0.44544, south: -4.75419, east: -42.0786, west: -46.3999 },
  sbtt: { north: -2.09219, south: -6.4021, east: -67.768, west: -72.1017 },
  sbtf: { north: -1.21712, south: -5.52641, east: -62.5299, west: -66.8565 },
};


/**
 * Verifica se uma estação CPTEC do Norte tem versão HD via SIPAM.
 */
export function hasSipamHdFallback(slug: string): boolean {
  const st = CPTEC_RADAR_STATIONS.find(s => s.slug === slug);
  return !!st?.sipamSlug;
}

/**
 * Retorna o sipamSlug para uma estação (se existir).
 */
export function getSipamSlug(slug: string): string | undefined {
  return CPTEC_RADAR_STATIONS.find(s => s.slug === slug)?.sipamSlug;
}

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
  // Se a estação já tiver bounds definidos (ex: via override do admin, Redemet, Simepar, Ipmet), usá-los
  if (station.bounds) {
    return { 
      north: station.bounds.maxLat, 
      south: station.bounds.minLat, 
      east: station.bounds.maxLon, 
      west: station.bounds.minLon 
    };
  }
  
  if (station.slug === 'ipmet-bauru') {
    return { north: IPMET_FIXED_BOUNDS.north, south: IPMET_FIXED_BOUNDS.south, east: IPMET_FIXED_BOUNDS.east, west: IPMET_FIXED_BOUNDS.west };
  }
  if (station.slug === 'usp-starnet') {
    return { north: USP_STARNET_FIXED_BOUNDS.north, south: USP_STARNET_FIXED_BOUNDS.south, east: USP_STARNET_FIXED_BOUNDS.east, west: USP_STARNET_FIXED_BOUNDS.west };
  }
  
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
export function buildArgentinaRadarUrl(
  code: string,
  ts12: string,
  productType: 'reflectividade' | 'velocidade' | 'vil' | 'waldvogel' = 'reflectividade'
): string {
  if (productType === 'vil' || productType === 'waldvogel') return '';
  
  const y = ts12.slice(0, 4);
  const m = ts12.slice(4, 6);
  const d = ts12.slice(6, 8);
  const h = ts12.slice(8, 10);
  const min = ts12.slice(10, 12);
  
  let vari = 'TH'; // Reflectividade padrão
  if (productType === 'velocidade') vari = 'VRAD';
  
  // Argentina WebMET usa UTC nas imagens (mesmo padrão do CPTEC)
  return `https://webmet.ohmc.ar/media/radares/images/${code}/${y}/${m}/${d}/${code}_${y}${m}${d}T${h}${min}00Z_${vari}_00.png`;
}

/**
 * Monta URL SIPAM-HD via proxy /api/sipam/image.
 * Chamado quando radarSourceMode==='hd' para estações com sipamSlug.
 */
export function buildSipamHdPngUrl(
  sipamSlug: string,
  ts12: string,
  productType: 'reflectividade' | 'velocidade' = 'reflectividade'
): string {
  const sipamTs = `${ts12.slice(0,4)}_${ts12.slice(4,6)}_${ts12.slice(6,8)}_${ts12.slice(8,10)}_${ts12.slice(10,12)}_00`;
  const produto = productType === 'velocidade' ? 'rate' : 'dbz';
  return `/api/sipam/image?radar=${sipamSlug}&produto=${produto}&timestamp=${sipamTs}`;
}

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
  if (station.slug === 'chapeco' && !skipProxy) {
    const radarId = productType === 'velocidade' ? station.velocityId : station.id;
    return `/api/nowcasting/chapeco?radarId=${radarId}&timestamp=${ts12}`;
  }
  if (station.slug === 'usp-starnet') {
    if (productType === 'vil' || productType === 'waldvogel' || productType === 'velocidade') return '';
    return GET_RADAR_USP_URL + `?t=${ts12}`;
  }
  if (station.slug === 'ipmet-bauru') {
    return GET_RADAR_IPMET_URL + `?t=${ts12}`;
  }
  if (station.slug === 'climatempo-poa') {
    return `https://statics.climatempo.com.br/radar_poa/pngs/latest/radar_poa_1.png?nocache=${ts12}`;
  }
  let finalTs12 = ts12;
  // Chapecó (CDN direta): Os arquivos PNG na CDN S2 do CPTEC são gerados a cada 6 minutos exatos.
  // Arredonda para o múltiplo de 6 mais próximo: 1535→1536, 1540→1542, 1558→1600.
  if (station.slug === 'chapeco' && skipProxy) {
    const min = parseInt(ts12.slice(10, 12), 10);
    let nearest6 = Math.round(min / 6) * 6;
    let hour = parseInt(ts12.slice(8, 10), 10);
    if (nearest6 >= 60) {
      nearest6 = 0;
      hour = (hour + 1) % 24;
      // Se a hora virou de 23 para 0, incrementa o dia (caso raro; o parse da data cuida)
    }
    finalTs12 = ts12.slice(0, 8) + hour.toString().padStart(2, '0') + nearest6.toString().padStart(2, '0');
  }

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
    sub = station.product === 'cappi' ? 'ppivr' : 'ppivr'; // Usually ppivr for Both
    fileId = station.velocityId || station.id;
  }

  const server = (productType === 'velocidade' && station.velocityServer) ? station.velocityServer : station.server;
  let slug = station.slug;
  if (station.org === 'funceme' && slug.startsWith('funceme-')) {
    slug = slug.replace('funceme-', '');
  }
  return `https://${server}.cptec.inpe.br/radar/${station.org}/${slug}/${prod}/${sub}/${y}/${m}/${fileId}_${finalTs12}.png`;
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
