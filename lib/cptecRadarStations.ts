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
  /** Organização/origem: decea, sdcsc, inea, cemaden, sipam, funceme, sipam-hd */
  org: 'decea' | 'sdcsc' | 'inea' | 'cemaden' | 'sipam' | 'funceme' | 'sipam-hd';
  /** Slug SIPAM para radares HD (usado nas URLs siger.sipam.gov.br). Ex: 'sbbv' */
  sipamSlug?: string;
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
}

/**
 * Lista completa de radares CPTEC/Nowcasting.
 * URL: https://s{N}.cptec.inpe.br/radar/{org}/{slug}/ppi/{ppicz|ppivr}/{ano}/{mes}/{idtip}_{YYYYMMDDHHmm}.png
 */
export const CPTEC_RADAR_STATIONS: CptecRadarStation[] = [
  // Radares DECEA/SDCSC (Sul)
  { id: 'R12558322', slug: 'santiago', name: 'Santiago', lat: -29.183, lng: -54.867, rangeKm: 400, org: 'decea', server: 's1', product: 'ppi', subtype: 'ppicz', sigmaProduct: 'cappi', sigmaSubtype: 'cappi3km', velocityId: 'R12558323', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0 },
  { id: 'R12137761', slug: 'chapeco', name: 'Chapecó', lat: -27.04879621266378, lng: -52.60375894804104, rangeKm: 450, org: 'sdcsc', server: 's2', product: 'ppi', subtype: 'ppicz', sigmaProduct: 'cappi', sigmaSubtype: 'cappi3km', velocityServer: 's3', velocityId: 'R12137762', updateIntervalMinutes: 6, updateIntervalOffsetMinutes: 0 },
  { id: 'R12227759', slug: 'lontras', name: 'Lontras', lat: -27.23109712981659, lng: -49.461747790379526, rangeKm: 250, org: 'sdcsc', server: 's1', product: 'ppi', subtype: 'ppicz', sigmaProduct: 'cappi', sigmaSubtype: 'cappi3km', velocityId: 'R12227760', updateIntervalMinutes: 5, updateIntervalOffsetMinutes: 0 },
  { id: 'R12544957', slug: 'morroigreja', name: 'Morro da Igreja', lat: -28.12, lng: -49.49, rangeKm: 400, org: 'decea', server: 's2', product: 'ppi', subtype: 'ppicz', sigmaProduct: 'cappi', sigmaSubtype: 'cappi3km', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0 },

  { id: 'R12093557', slug: 'ipmet-bauru', name: 'IPMet Mosaico (PP/Bauru)', lat: -22.116, lng: -51.385, rangeKm: 240, org: 'sdcsc', server: 's1', product: 'ppi', subtype: 'ppicz', sigmaProduct: 'ppi', sigmaSubtype: 'ppicz', updateIntervalMinutes: 15, updateIntervalOffsetMinutes: 0 }, // Unificado como mosaico centralizado em Prudente no mapa
  { id: 'POA', slug: 'climatempo-poa', name: 'Porto Alegre (Climatempo)', lat: -29.6, lng: -51.8, rangeKm: 250, org: 'cemaden', server: 's1', product: 'ppi', subtype: 'ppicz', updateIntervalMinutes: 5, updateIntervalOffsetMinutes: 0 },

  // DECEA - Sudeste
  { id: 'R12537563', slug: 'saoroque', name: 'São Roque', lat: -23.53, lng: -47.13, rangeKm: 250, org: 'decea', server: 's1', product: 'ppi', subtype: 'ppicz', sigmaProduct: 'cappi', sigmaSubtype: 'cappi3km', velocityId: 'R12537536', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0 },
  { id: 'R12567564', slug: 'picocouto', name: 'Pico do Couto', lat: -22.95, lng: -43.25, rangeKm: 250, org: 'decea', server: 's1', product: 'ppi', subtype: 'ppicz', velocityId: 'R12567537', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0 },
  { id: 'R12504961', slug: 'gama', name: 'Gama', lat: -15.94, lng: -48.05, rangeKm: 250, org: 'decea', server: 's1', product: 'ppi', subtype: 'ppicz', velocityId: 'R12507562', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0 },

  // INEA - Rio de Janeiro
  { id: 'R12957397', slug: 'guaratiba', name: 'Guaratiba', lat: -23.04, lng: -43.61, rangeKm: 250, org: 'inea', server: 's1', product: 'ppi', subtype: 'ppicz', velocityId: 'R12957398' },
  { id: 'R12992241', slug: 'macae', name: 'Macaé', lat: -22.37, lng: -41.79, rangeKm: 250, org: 'inea', server: 's1', product: 'ppi', subtype: 'ppicz', velocityId: 'R12997758' },

  // CEMADEN
  { id: 'R12977393', slug: 'santatereza', name: 'Santa Tereza', lat: -19.94, lng: -40.60, rangeKm: 250, org: 'cemaden', server: 's1', product: 'ppi', subtype: 'ppicz', velocityId: 'R12977394' },
  { id: 'R12894966', slug: 'almenara', name: 'Almenara', lat: -16.18, lng: -40.69, rangeKm: 250, org: 'cemaden', server: 's1', product: 'ppi', subtype: 'ppicz', velocityId: 'R12897396' },
  { id: 'R12457387', slug: 'saofrancisco', name: 'São Francisco', lat: -15.95, lng: -44.86, rangeKm: 250, org: 'cemaden', server: 's1', product: 'ppi', subtype: 'ppicz', velocityId: 'R12457388' },
  { id: 'R12477391', slug: 'tresmarias', name: 'Três Marias', lat: -18.21, lng: -45.23, rangeKm: 250, org: 'cemaden', server: 's1', product: 'ppi', subtype: 'ppicz', velocityId: 'R12477392' },
  { id: 'R12277383', slug: 'jaraguari', name: 'Jaraguari', lat: -20.14, lng: -54.40, rangeKm: 250, org: 'cemaden', server: 's1', product: 'ppi', subtype: 'ppicz', velocityId: 'R12277384' },
  { id: 'R12247379', slug: 'natal', name: 'Natal', lat: -5.81, lng: -35.21, rangeKm: 250, org: 'cemaden', server: 's1', product: 'ppi', subtype: 'ppicz', velocityId: 'R12247380' },
  { id: 'R12447385', slug: 'maceio', name: 'Maceió', lat: -9.67, lng: -35.73, rangeKm: 250, org: 'cemaden', server: 's1', product: 'ppi', subtype: 'ppicz', velocityId: 'R12447386' },
  { id: 'R12467389', slug: 'salvador', name: 'Salvador', lat: -12.97, lng: -38.51, rangeKm: 250, org: 'cemaden', server: 's1', product: 'ppi', subtype: 'ppicz', velocityId: 'R12467390' },

  // SIPAM - Norte/Centro-Oeste
  { id: 'R12792141', slug: 'portovelho', name: 'Porto Velho', lat: -8.76, lng: -63.90, rangeKm: 250, org: 'sipam', server: 's1', product: 'ppi', subtype: 'ppicz', velocityId: 'R12797370' },
  { id: 'R12767583', slug: 'cruzeirodosul', name: 'Cruzeiro do Sul', lat: -7.63, lng: -72.67, rangeKm: 250, org: 'sipam', server: 's1', product: 'ppi', subtype: 'ppicz', velocityId: 'R12767363' },
  { id: 'R12827598', slug: 'tabatinga', name: 'Tabatinga', lat: -4.25, lng: -69.94, rangeKm: 250, org: 'sipam', server: 's1', product: 'ppi', subtype: 'ppicz', velocityId: 'R12827378' },
  { id: 'R12837597', slug: 'tefe', name: 'Tefé', lat: -3.35, lng: -64.71, rangeKm: 250, org: 'sipam', server: 's1', product: 'ppi', subtype: 'ppicz', velocityId: 'R12837377' },
  { id: 'R12817594', slug: 'saogabriel', name: 'São Gabriel da Cachoeira (AM)', lat: -0.13, lng: -67.09, rangeKm: 250, org: 'sipam', server: 's1', product: 'ppi', subtype: 'ppicz', velocityId: 'R12817374' },
  { id: 'R12787587', slug: 'manaus', name: 'Manaus', lat: -3.15, lng: -60.02, rangeKm: 250, org: 'sipam', server: 's1', product: 'ppi', subtype: 'ppicz', velocityId: 'R12787367' },
  { id: 'R12757581', slug: 'boavista', name: 'Boa Vista', lat: 2.82, lng: -60.67, rangeKm: 250, org: 'sipam', server: 's1', product: 'ppi', subtype: 'ppicz', velocityId: 'R12757361' },
  { id: 'R12777586', slug: 'macapa', name: 'Macapá', lat: 0.03, lng: -51.07, rangeKm: 250, org: 'sipam', server: 's1', product: 'ppi', subtype: 'ppicz', velocityId: 'R12777366' },
  // Santarém - Ref/Doppler ids pendentes (sipam/santarem)
  { id: 'R12800000', slug: 'santarem', name: 'Santarém', lat: -2.44, lng: -54.71, rangeKm: 250, org: 'sipam', server: 's1', product: 'ppi', subtype: 'ppicz' },

  // Quixeramobim e Fortaleza (FUNCEME) — bounds extraídos dos KML oficiais
  { id: 'GMWR1000SST', slug: 'funceme-fortaleza', name: 'Fortaleza (FUNCEME)', lat: -3.893, lng: -38.458, rangeKm: 250, org: 'funceme', server: 's1', product: 'ppi', subtype: 'prsf', updateIntervalMinutes: 5, updateIntervalOffsetMinutes: 0 },
  { id: 'RMT0100DS', slug: 'funceme-quixeramobim', name: 'Quixeramobim (FUNCEME)', lat: -5.069, lng: -39.267, rangeKm: 350, org: 'funceme', server: 's1', product: 'ppi', subtype: 'prsf', updateIntervalMinutes: 5, updateIntervalOffsetMinutes: 0 },

  // Fontes especiais (WMS/proxy)
  { id: 'USP', slug: 'usp-starnet', name: 'USP/StarNet (São Paulo)', lat: -23.561, lng: -46.736, rangeKm: 85, org: 'decea', server: 's1', product: 'ppi', subtype: 'ppicz', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0 },

  // SIPAM-HD (Norte do Brasil) — Radares via apihidro.sipam.gov.br com bounds exatos
  { id: 'sipam-sbbe', slug: 'sipam-belem', name: 'Belém (HD)', lat: -1.4084, lng: -48.46128, rangeKm: 250, org: 'sipam-hd', server: 's1', product: 'ppi', subtype: 'ppicz', sipamSlug: 'sbbe', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0 },
  { id: 'sipam-sbbv', slug: 'sipam-boavista', name: 'Boa Vista (HD)', lat: 2.84421, lng: -60.7002, rangeKm: 250, org: 'sipam-hd', server: 's1', product: 'ppi', subtype: 'ppicz', sipamSlug: 'sbbv', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0 },
  { id: 'sipam-sbcz', slug: 'sipam-cruzeirodosul', name: 'Cruzeiro do Sul (HD)', lat: -7.59553, lng: -72.7697, rangeKm: 250, org: 'sipam-hd', server: 's1', product: 'ppi', subtype: 'ppicz', sipamSlug: 'sbcz', updateIntervalMinutes: 12, updateIntervalOffsetMinutes: 0 },
  { id: 'sipam-sbmq', slug: 'sipam-macapa', name: 'Macapá (HD)', lat: -0.045597, lng: -51.0969, rangeKm: 250, org: 'sipam-hd', server: 's1', product: 'ppi', subtype: 'ppicz', sipamSlug: 'sbmq', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0 },
  { id: 'sipam-sbmn', slug: 'sipam-manaus', name: 'Manaus (HD)', lat: -3.14889, lng: -59.9914, rangeKm: 250, org: 'sipam-hd', server: 's1', product: 'ppi', subtype: 'ppicz', sipamSlug: 'sbmn', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0 },
  { id: 'sipam-sbpv', slug: 'sipam-portovelho', name: 'Porto Velho (HD)', lat: -8.71514, lng: -63.8838, rangeKm: 250, org: 'sipam-hd', server: 's1', product: 'ppi', subtype: 'ppicz', sipamSlug: 'sbpv', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0 },
  { id: 'sipam-sbsn', slug: 'sipam-santarem', name: 'Santarém (HD)', lat: -2.42964, lng: -54.799, rangeKm: 250, org: 'sipam-hd', server: 's1', product: 'ppi', subtype: 'ppicz', sipamSlug: 'sbsn', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0 },
  { id: 'sipam-sbua', slug: 'sipam-saogabriel', name: 'São Gabriel (HD)', lat: -0.143677, lng: -67.057, rangeKm: 250, org: 'sipam-hd', server: 's1', product: 'ppi', subtype: 'ppicz', sipamSlug: 'sbua', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0 },
  { id: 'sipam-sbsl', slug: 'sipam-saoluis', name: 'São Luís (HD)', lat: -2.60048, lng: -44.2393, rangeKm: 250, org: 'sipam-hd', server: 's1', product: 'ppi', subtype: 'ppicz', sipamSlug: 'sbsl', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0 },
  { id: 'sipam-sbtt', slug: 'sipam-tabatinga', name: 'Tabatinga (HD)', lat: -4.24839, lng: -69.935, rangeKm: 250, org: 'sipam-hd', server: 's1', product: 'ppi', subtype: 'ppicz', sipamSlug: 'sbtt', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0 },
  { id: 'sipam-sbtf', slug: 'sipam-tefe', name: 'Tefé (HD)', lat: -3.3727, lng: -64.6932, rangeKm: 250, org: 'sipam-hd', server: 's1', product: 'ppi', subtype: 'ppicz', sipamSlug: 'sbtf', updateIntervalMinutes: 12, updateIntervalOffsetMinutes: 0 },
];

/** URL da Cloud Function getRadarIPMet (proxy WMS mosaico estadual). */
export const GET_RADAR_IPMET_URL = 'https://getradaripmet-kj7x6j3jsa-uc.a.run.app';

/** URL da Cloud Function getRadarUSP (proxy pelletron 36km Capital/SP). Atualize após deploy se diferente. */
export const GET_RADAR_USP_URL = 'https://us-central1-studio-4398873450-7cc8f.cloudfunctions.net/getRadarUSP';

/**
 * Bounds fixos da imagem IPMet (BBOX do getRadarIPMet Cloud Function).
 * A imagem WMS sempre usa BBOX=-26.5,-54.0,-18.5,-46.0 — usar estes valores
 * garante que Admin Radar e ao-vivo mostrem a mesma posição/extensão.
 */
export const IPMET_FIXED_BOUNDS = {
  north: -18.5,
  south: -26.5,
  east: -46.0,
  west: -54.0,
  ne: { lat: -18.5, lng: -46.0 },
  sw: { lat: -26.5, lng: -54.0 },
};

/**
 * Bounds fixos da imagem USP/StarNet (extent EPSG:4326 do mapa).
 * Fonte: ol.proj.transformExtent([-47.134155, -23.930042, -46.337808, -23.192604], ...)
 */
export const USP_STARNET_FIXED_BOUNDS = {
  north: -23.192604,
  south: -23.930042,
  east: -46.337808,
  west: -47.134155,
  ne: { lat: -23.192604, lng: -46.337808 },
  sw: { lat: -23.930042, lng: -47.134155 },
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
 * Mapeamento CPTEC slug → SIPAM-HD slug para fallback automático.
 * Quando CPTEC/Nowcasting (Super Res) não tem imagem recente,
 * o sistema usa a versão HD do SIPAM.
 */
export const SIPAM_HD_FALLBACK_MAP: Record<string, string> = {
  portovelho: 'sipam-portovelho',
  cruzeirodosul: 'sipam-cruzeirodosul',
  tabatinga: 'sipam-tabatinga',
  tefe: 'sipam-tefe',
  saogabriel: 'sipam-saogabriel',
  manaus: 'sipam-manaus',
  boavista: 'sipam-boavista',
  macapa: 'sipam-macapa',
  santarem: 'sipam-santarem',
};

/**
 * Verifica se uma estação CPTEC do Norte tem versão HD via SIPAM.
 */
export function hasSipamHdFallback(slug: string): boolean {
  return slug in SIPAM_HD_FALLBACK_MAP;
}

/**
 * Retorna a estação SIPAM-HD correspondente (se existir).
 */
export function getSipamHdStation(cptecSlug: string): CptecRadarStation | undefined {
  const sipamSlug = SIPAM_HD_FALLBACK_MAP[cptecSlug];
  if (!sipamSlug) return undefined;
  return CPTEC_RADAR_STATIONS.find(s => s.slug === sipamSlug);
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
 * Monta URL PNG direta Nowcasting para uma estação e timestamp.
 * Padrão: https://s{N}.cptec.inpe.br/radar/{org}/{slug}/{product}/{subtype}/{year}/{month}/R{id}_{ts12}.png
 * ts12 = YYYYMMDDHHmm
 */
export function buildNowcastingPngUrl(
  station: CptecRadarStation,
  ts12: string,
  productType: 'reflectividade' | 'velocidade' = 'reflectividade'
): string {
  if (station.org === 'sipam-hd' && station.sipamSlug) {
    // Converter ts12 (YYYYMMDDHHmm) para formato SIPAM (YYYY_MM_DD_HH_mm_00)
    const sipamTs = `${ts12.slice(0,4)}_${ts12.slice(4,6)}_${ts12.slice(6,8)}_${ts12.slice(8,10)}_${ts12.slice(10,12)}_00`;
    const produto = productType === 'velocidade' ? 'rate' : 'dbz';
    return `/api/sipam/image?radar=${station.sipamSlug}&produto=${produto}&timestamp=${sipamTs}`;
  }
  if (station.slug === 'chapeco') {
    const radarId = productType === 'velocidade' ? station.velocityId : station.id;
    return `/api/nowcasting/chapeco?radarId=${radarId}&timestamp=${ts12}`;
  }
  if (station.org === 'funceme') {
    return `/api/funceme/image?radar=${station.id}&timestamp=${ts12}`;
  }
  if (station.slug === 'climatempo-poa') {
    return `https://statics.climatempo.com.br/radar_poa/pngs/latest/radar_poa_1.png?nocache=${ts12}`;
  }
  const y = ts12.slice(0, 4);
  const m = ts12.slice(4, 6);
  const sub =
    productType === 'velocidade'
      ? station.product === 'cappi'
        ? 'cappi3km'
        : 'ppivr'
      : station.subtype;
  const server = productType === 'velocidade' && station.velocityServer ? station.velocityServer : station.server;
  const fileId = productType === 'velocidade' && station.velocityId ? station.velocityId : station.id;
  return `https://${server}.cptec.inpe.br/radar/${station.org}/${station.slug}/${station.product}/${sub}/${y}/${m}/${fileId}_${ts12}.png`;
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
