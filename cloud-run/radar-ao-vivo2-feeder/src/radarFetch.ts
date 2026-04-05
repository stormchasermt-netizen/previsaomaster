/**
 * Fetch de imagens CPTEC / IPMet / Climatempo — alinhado a lib/cptecRadarStations.ts
 */

export const UNIVERSAL_FALLBACK_CONFIGS = [
  { interval: 10, offset: 0 },
  { interval: 7.5, offset: 0 },
  { interval: 6, offset: 0 },
  { interval: 5, offset: 0 },
] as const;

/** PPI = reflectividade (ppicz); Doppler = velocidade (ppivr) — IDs distintos no nome do ficheiro. */
export interface CptecStation {
  /** ID composto no CDN para PPI: R…_{YYYYMMDDHHmm}.png */
  id: string;
  /** ID para Doppler (ppivr). Omitir se o radar não publicar ppivr (ex. REDEMET, Belém). */
  dopplerId?: string;
  /** Segmento de URL no CDN (`…/radar/{org}/{slug}/ppi/…`). Pode diferir da pasta no GCS (ex. `riobranco` → `rio-branco`). */
  slug: string;
  org: string;
  server: string;
  sigmaConfig?: { cappi?: number; vento?: number };
  sipamSlug?: string;
}

export const IPMET_URL = 'https://getradaripmet-kj7x6j3jsa-uc.a.run.app';
export const CLIMATEMPO_POA_LATEST = 'https://statics.climatempo.com.br/radar_poa/pngs/latest/radar_poa_1.png';

/**
 * Pastas no bucket `radar_ao_vivo_2` (GCS) — alinhado a lib/cptecRadarStations + ao-vivo-2.
 * Ordem alfabética para diffs estáveis.
 */
export const DEFAULT_SYNC_SLUGS = [
  'sipam-belem',
  'sipam-boavista',
  'sipam-cruzeirodosul',
  'sipam-macapa',
  'sipam-manaus',
  'sipam-portovelho',
  'sipam-santarem',
  'sipam-saogabriel',
  'sipam-tabatinga',
  'sipam-tefe',
  'sipam-natal',
  'sipam-saoluis',
  'sipam-teresina',
  'almeirim',
  'almenara',
  'belem',
  'boavista',
  'cangucu',
  'chapeco',
  'climatempo-poa',
  'cruzeirodosul',
  'funceme-ceara',
  'funceme-fortaleza',
  'funceme-quixeramobim',
  'gama',
  'guaratiba',
  'ipmet-bauru',
  'jaraguari',
  'lontras',
  'macae',
  'macapa',
  'maceio',
  'manaus',
  'morroigreja',
  'natal',
  'petrolina',
  'picocouto',
  'picos',
  'portovelho',
  'riobranco',
  'salvador',
  'santarem',
  'santatereza',
  'santiago',
  'saofrancisco',
  'saogabriel',
  'saoluis',
  'saoroque',
  'tabatinga',
  'tefe',
  'tresmarias',
  'usp-itaituba',
  'vilhena',
  // --- Argentina (WebMET) ---
  'argentina-AR5',
  'argentina-AR7',
  'argentina-AR8',
  'argentina-RMA00',
  'argentina-RMA1',
  'argentina-RMA2',
  'argentina-RMA3',
  'argentina-RMA4',
  'argentina-RMA5',
  'argentina-RMA6',
  'argentina-RMA7',
  'argentina-RMA8',
  'argentina-RMA9',
  'argentina-RMA10',
  'argentina-RMA11',
  'argentina-RMA12',
  'argentina-RMA13',
  'argentina-RMA14',
  'argentina-RMA15',
  'argentina-RMA16',
  'argentina-RMA17',
  'argentina-RMA18',
  // --- REDEMET (DECEA) — pastas redemet-{codigo} no GCS, alinhado a /api/radar-redemet-find ---
  'redemet-be',
  'redemet-bv',
  'redemet-cn',
  'redemet-mn',
  'redemet-mo',
  'redemet-mq',
  'redemet-pc',
  'redemet-pl',
  'redemet-sg',
  'redemet-sl',
  'redemet-sn',
  'redemet-sr',
  'redemet-st',
  'redemet-ua',
  // --- Simepar ---
  'simepar-cascavel',
  // --- Sigma ---
  'sigma-santiago',
  'sigma-cangucu',
  'sigma-chapeco',
  'sigma-lontras',
  'sigma-morroigreja',
  'sigma-ipmet-prudente',
  'sigma-ipmet-bauru',
  'sigma-saoroque',
  'sigma-picocouto',
  'sigma-gama',
  'sigma-almenara',
  'sigma-saofrancisco',
  'sigma-tresmarias',
  'sigma-jaraguari',
  'sigma-natal',
  'sigma-maceio',
  'sigma-salvador',
  'sigma-petrolina',
  'sigma-portovelho',
  'sigma-cruzeirodosul',
  'sigma-tabatinga',
  'sigma-tefe',
  'sigma-saogabriel',
  'sigma-manaus',
  'sigma-boavista',
  'sigma-macapa',
  'sigma-santarem',
  'sigma-saoluis',
  'sigma-belem',
  'sigma-funceme-quixeramobim',
] as const;

/**
 * Pastas no GCS sem feed CPTEC neste serviço (IDs placeholder ou fonte externa).
 * O ciclo de sync ignora; o cleanup continua a apagar ficheiros antigos nestes prefixos.
 */
export const SLUGS_WITHOUT_CDN_SYNC = new Set<string>(['almeirim', 'picos', 'usp-itaituba']);

/** Metadados CPTEC — URL: https://{sN}.cptec.inpe.br/radar/{org}/{slug}/ppi/{ppicz|ppivr}/{YYYY}/{MM}/R{id}_{YYYYMMDDHHmm}.png */
export const CPTEC_STATIONS: Record<string, CptecStation> = {
  santiago: { id: 'R12558322', dopplerId: 'R12558323', slug: 'santiago', org: 'decea', server: 's1' },
  cangucu: { id: 'R12578316', dopplerId: 'R12577538', slug: 'cangucu', org: 'decea', server: 's1' },
  chapeco: { id: 'R12137761', dopplerId: 'R12137762', slug: 'chapeco', org: 'sdcsc', server: 's2' },
  lontras: { id: 'R12227759', dopplerId: 'R12227760', slug: 'lontras', org: 'sdcsc', server: 's1' },
  morroigreja: { id: 'R12544957', dopplerId: 'R12544956', slug: 'morroigreja', org: 'decea', server: 's2' },
  picocouto: { id: 'R12567564', dopplerId: 'R12567537', slug: 'picocouto', org: 'decea', server: 's1' },
  saoroque: { id: 'R12537563', dopplerId: 'R12537536', slug: 'saoroque', org: 'decea', server: 's1' },
  gama: { id: 'R12507565', dopplerId: 'R12507562', slug: 'gama', org: 'decea', server: 's1' },
  guaratiba: { id: 'R12957397', dopplerId: 'R12957398', slug: 'guaratiba', org: 'inea', server: 's1' },
  macae: { id: 'R12997399', dopplerId: 'R12997758', slug: 'macae', org: 'inea', server: 's1' },
  santatereza: { id: 'R12977393', dopplerId: 'R12977394', slug: 'santatereza', org: 'cemaden', server: 's1' },
  saofrancisco: { id: 'R12457387', dopplerId: 'R12457388', slug: 'saofrancisco', org: 'cemaden', server: 's1' },
  tresmarias: { id: 'R12477391', dopplerId: 'R12477392', slug: 'tresmarias', org: 'cemaden', server: 's1' },
  jaraguari: { id: 'R12277383', dopplerId: 'R12277384', slug: 'jaraguari', org: 'cemaden', server: 's1' },
  natal: { id: 'R12247379', dopplerId: 'R12247380', slug: 'natal', org: 'cemaden', server: 's1' },
  maceio: { id: 'R12447385', dopplerId: 'R12447386', slug: 'maceio', org: 'cemaden', server: 's1' },
  salvador: { id: 'R12467389', dopplerId: 'R12467390', slug: 'salvador', org: 'cemaden', server: 's1' },
  petrolina: { id: 'R12257381', dopplerId: 'R12257382', slug: 'petrolina', org: 'cemaden', server: 's1' },
  almenara: { id: 'R12897395', dopplerId: 'R12897396', slug: 'almenara', org: 'cemaden', server: 's1' },
  vilhena: { id: 'R102', slug: 'vilhena', org: 'redemet', server: 's1' },
  /** Pasta GCS `riobranco` — segmento de URL no CDN é `rio-branco`. */
  riobranco: { id: 'R104', slug: 'rio-branco', org: 'redemet', server: 's1' },
  portovelho: { id: 'R12797767', dopplerId: 'R12797370', slug: 'portovelho', org: 'sipam', server: 's1' },
  cruzeirodosul: { id: 'R12767583', dopplerId: 'R12767363', slug: 'cruzeirodosul', org: 'sipam', server: 's2' },
  tabatinga: { id: 'R12827598', dopplerId: 'R12827378', slug: 'tabatinga', org: 'sipam', server: 's1' },
  tefe: { id: 'R12837597', dopplerId: 'R12837377', slug: 'tefe', org: 'sipam', server: 's1' },
  saogabriel: { id: 'R12817594', dopplerId: 'R12817374', slug: 'saogabriel', org: 'sipam', server: 's1' },
  manaus: { id: 'R12787587', dopplerId: 'R12787367', slug: 'manaus', org: 'sipam', server: 's1' },
  boavista: { id: 'R12757581', dopplerId: 'R12757361', slug: 'boavista', org: 'sipam', server: 's1' },
  macapa: { id: 'R12777586', dopplerId: 'R12777366', slug: 'macapa', org: 'sipam', server: 's1' },
  santarem: { id: 'R12807592', dopplerId: 'R12807372', slug: 'santarem', org: 'sipam', server: 's1' },
  saoluis: { id: 'R12907765', dopplerId: 'R12907766', slug: 'saoluis', org: 'sipam', server: 's1' },
  belem: { id: 'R12800001', slug: 'belem', org: 'sipam', server: 's1' },
  'funceme-fortaleza': { id: 'R13851142', dopplerId: 'R13851143', slug: 'funceme-fortaleza', org: 'funceme', server: 's1' },
  'funceme-quixeramobim': { id: 'R13967017', dopplerId: 'R13967018', slug: 'funceme-quixeramobim', org: 'funceme', server: 's1' },
  'funceme-ceara': { id: 'RMT0100DS', slug: 'funceme-ceara', org: 'funceme', server: 's1' },
};
  if (CPTEC_STATIONS['santiago']) CPTEC_STATIONS['santiago'].sigmaConfig = { cappi: 4965, vento: 8323 };
  if (CPTEC_STATIONS['cangucu']) CPTEC_STATIONS['cangucu'].sigmaConfig = { cappi: 4962, vento: 7538 };
  if (CPTEC_STATIONS['chapeco']) CPTEC_STATIONS['chapeco'].sigmaConfig = { cappi: 2247, vento: 7762 };
  if (CPTEC_STATIONS['lontras']) CPTEC_STATIONS['lontras'].sigmaConfig = { cappi: 2244, vento: 7760 };
  if (CPTEC_STATIONS['morroigreja']) CPTEC_STATIONS['morroigreja'].sigmaConfig = { cappi: 4964, vento: 4956 };
  if (CPTEC_STATIONS['ipmet-prudente']) CPTEC_STATIONS['ipmet-prudente'].sigmaConfig = { cappi: 8335 };
  if (CPTEC_STATIONS['ipmet-bauru']) CPTEC_STATIONS['ipmet-bauru'].sigmaConfig = { cappi: 8335 };
  if (CPTEC_STATIONS['saoroque']) CPTEC_STATIONS['saoroque'].sigmaConfig = { cappi: 4960, vento: 7536 };
  if (CPTEC_STATIONS['picocouto']) CPTEC_STATIONS['picocouto'].sigmaConfig = { cappi: 4963, vento: 7537 };
  if (CPTEC_STATIONS['gama']) CPTEC_STATIONS['gama'].sigmaConfig = { cappi: 4961, vento: 7562 };
  if (CPTEC_STATIONS['almenara']) CPTEC_STATIONS['almenara'].sigmaConfig = { cappi: 4966, vento: 7396 };
  if (CPTEC_STATIONS['saofrancisco']) CPTEC_STATIONS['saofrancisco'].sigmaConfig = { cappi: 8345, vento: 7388 };
  if (CPTEC_STATIONS['tresmarias']) CPTEC_STATIONS['tresmarias'].sigmaConfig = { cappi: 5984, vento: 7392 };
  if (CPTEC_STATIONS['jaraguari']) CPTEC_STATIONS['jaraguari'].sigmaConfig = { cappi: 8344, vento: 7384 };
  if (CPTEC_STATIONS['natal']) CPTEC_STATIONS['natal'].sigmaConfig = { cappi: 8343, vento: 7380 };
  if (CPTEC_STATIONS['maceio']) CPTEC_STATIONS['maceio'].sigmaConfig = { cappi: 8325, vento: 7386 };
  if (CPTEC_STATIONS['salvador']) CPTEC_STATIONS['salvador'].sigmaConfig = { cappi: 8346, vento: 7390 };
  if (CPTEC_STATIONS['petrolina']) CPTEC_STATIONS['petrolina'].sigmaConfig = { cappi: 8342, vento: 7382 };
  if (CPTEC_STATIONS['portovelho']) CPTEC_STATIONS['portovelho'].sigmaConfig = { cappi: 2141, vento: 7370 };
  if (CPTEC_STATIONS['cruzeirodosul']) CPTEC_STATIONS['cruzeirodosul'].sigmaConfig = { cappi: 2138 };
  if (CPTEC_STATIONS['tabatinga']) CPTEC_STATIONS['tabatinga'].sigmaConfig = { cappi: 2144 };
  if (CPTEC_STATIONS['tefe']) CPTEC_STATIONS['tefe'].sigmaConfig = { cappi: 2258, vento: 7377 };
  if (CPTEC_STATIONS['saogabriel']) CPTEC_STATIONS['saogabriel'].sigmaConfig = { cappi: 2143, vento: 7374 };
  if (CPTEC_STATIONS['manaus']) CPTEC_STATIONS['manaus'].sigmaConfig = { cappi: 2140, vento: 7367 };
  if (CPTEC_STATIONS['boavista']) CPTEC_STATIONS['boavista'].sigmaConfig = { cappi: 2137, vento: 7361 };
  if (CPTEC_STATIONS['macapa']) CPTEC_STATIONS['macapa'].sigmaConfig = { cappi: 2255, vento: 7366 };
  if (CPTEC_STATIONS['santarem']) CPTEC_STATIONS['santarem'].sigmaConfig = { cappi: 2142, vento: 7372 };
  if (CPTEC_STATIONS['saoluis']) CPTEC_STATIONS['saoluis'].sigmaConfig = { cappi: 4967, vento: 7766 };
  if (CPTEC_STATIONS['belem']) CPTEC_STATIONS['belem'].sigmaConfig = { cappi: 2136 };
  if (CPTEC_STATIONS['funceme-quixeramobim']) CPTEC_STATIONS['funceme-quixeramobim'].sigmaConfig = { cappi: 7011, vento: 7018 };

/**
 * Intervalo de atualização típico (minutos) para snap na grelha CPTEC — alinhado a lib/cptecRadarStations.
 */
/**
 * IDs do portal Nowcasting (`/api/camadas/radar/{id}/imagens?nome=…`) — ver docs/radaresv2.txt.
 * Permite descarregar os timestamps reais (ex.: 09:11, 09:06) em vez de adivinhar com snap à grelha.
 */
export const NOWCASTING_RADAR_MAP: Record<string, { id: number; nome: string }> = {
  saofrancisco: { id: 8345, nome: 'São Francisco' },
  jaraguari: { id: 8344, nome: 'Jaraguari' },
  chapeco: { id: 2247, nome: 'Chapecó' },
  morroigreja: { id: 4964, nome: 'Morro da Igreja' },
  portovelho: { id: 1379, nome: 'Porto Velho' },
  macapa: { id: 1377, nome: 'Macapá' },
  santatereza: { id: 2169, nome: 'Santa Tereza' },
  tresmarias: { id: 5984, nome: 'Três Marias' },
  picocouto: { id: 4963, nome: 'Pico do Couto' },
  saoroque: { id: 4960, nome: 'São Roque' },
  santarem: { id: 1380, nome: 'Santarém' },
  guaratiba: { id: 2238, nome: 'Guaratiba' },
  natal: { id: 8343, nome: 'Natal' },
  'funceme-quixeramobim': { id: 7011, nome: 'Quixeramobim' },
  salvador: { id: 8346, nome: 'Salvador' },
  maceio: { id: 8325, nome: 'Maceió' },
  boavista: { id: 1375, nome: 'Boa Vista' },
  tabatinga: { id: 1382, nome: 'Tabatinga' },
  gama: { id: 1250, nome: 'Gama' },
  santiago: { id: 4965, nome: 'Santiago' },
  manaus: { id: 1378, nome: 'Manaus' },
  cruzeirodosul: { id: 1376, nome: 'Cruzeiro do Sul' },
  cangucu: { id: 4962, nome: 'Canguçu' },
  almenara: { id: 4966, nome: 'Almenara' },
  tefe: { id: 1383, nome: 'Tefé' },
  macae: { id: 2241, nome: 'Macaé' },
  belem: { id: 1374, nome: 'Belém' },
  petrolina: { id: 8342, nome: 'Petrolina' },
  'funceme-fortaleza': { id: 1136, nome: 'Fortaleza' },
  saogabriel: { id: 1381, nome: 'São Gabriel' },
  lontras: { id: 4961, nome: 'Lontras' },
  saoluis: { id: 1390, nome: 'São Luiz' },
};

export const CPTEC_PRIMARY_INTERVAL_MIN: Record<string, number> = {
  chapeco: 6,
  lontras: 10,
  santiago: 10,
  cangucu: 10,
  morroigreja: 10,
  saoroque: 10,
  gama: 10,
  guaratiba: 10,
  macae: 10,
  santatereza: 10,
  saofrancisco: 10,
  tresmarias: 10,
  picocouto: 10,
  jaraguari: 10,
  natal: 10,
  maceio: 10,
  salvador: 10,
  petrolina: 10,
  almenara: 10,
  vilhena: 10,
  riobranco: 10,
  portovelho: 10,
  cruzeirodosul: 12,
  tabatinga: 10,
  tefe: 10,
  saogabriel: 10,
  manaus: 10,
  boavista: 10,
  macapa: 10,
  santarem: 10,
  saoluis: 10,
  belem: 10,
  'funceme-fortaleza': 10,
  'funceme-quixeramobim': 10,
  'funceme-ceara': 15,
};

export function getNowTimestamp12UTC(): string {
  const d = new Date();
  return (
    d.getUTCFullYear().toString() +
    String(d.getUTCMonth() + 1).padStart(2, '0') +
    String(d.getUTCDate()).padStart(2, '0') +
    String(d.getUTCHours()).padStart(2, '0') +
    String(d.getUTCMinutes()).padStart(2, '0')
  );
}

export function subtractMinutesFromTs12(ts12: string, minutes: number): string {
  const d = new Date(
    Date.UTC(
      parseInt(ts12.slice(0, 4), 10),
      parseInt(ts12.slice(4, 6), 10) - 1,
      parseInt(ts12.slice(6, 8), 10),
      parseInt(ts12.slice(8, 10), 10),
      parseInt(ts12.slice(10, 12), 10)
    )
  );
  d.setUTCMinutes(d.getUTCMinutes() - minutes);
  return (
    d.getUTCFullYear().toString() +
    String(d.getUTCMonth() + 1).padStart(2, '0') +
    String(d.getUTCDate()).padStart(2, '0') +
    String(d.getUTCHours()).padStart(2, '0') +
    String(d.getUTCMinutes()).padStart(2, '0')
  );
}

/** Converte YYYYMMDDHHmm (UTC) para epoch ms. */
export function ts12ToUtcMs(ts12: string): number {
  const y = parseInt(ts12.slice(0, 4), 10);
  const mo = parseInt(ts12.slice(4, 6), 10) - 1;
  const d = parseInt(ts12.slice(6, 8), 10);
  const h = parseInt(ts12.slice(8, 10), 10);
  const min = parseInt(ts12.slice(10, 12), 10);
  return Date.UTC(y, mo, d, h, min, 0, 0);
}

function snapToInterval(ts12: string, interval: number, offset: number): string {
  const dateStr = ts12.slice(0, 8);
  const h = parseInt(ts12.slice(8, 10), 10);
  const m = parseInt(ts12.slice(10, 12), 10);
  const totalMin = h * 60 + m;
  const snapped = Math.round((totalMin - offset) / interval) * interval + offset;
  const clamped = Math.max(0, Math.min(23 * 60 + 55, snapped));
  const nh = Math.floor(clamped / 60);
  const nm = clamped % 60;
  return `${dateStr}${String(nh).padStart(2, '0')}${String(nm).padStart(2, '0')}`;
}

export type CptecLayer = 'ppi' | 'doppler';

export type CptecSyncedFile = {
  ts12: string;
  layer: CptecLayer;
  fileName: string;
  url: string;
  buffer: Buffer;
};

/** CDN CPTEC: pastas YYYY/MM e ficheiro R{identificador}_{YYYYMMDDHHmm}.png — PPI usa ppicz, Doppler ppivr. */
export function buildCptecPngUrl(station: CptecStation, ts12: string, layer: CptecLayer = 'ppi'): string {
  const y = ts12.slice(0, 4);
  const mo = ts12.slice(4, 6);
  const subtype = layer === 'ppi' ? 'ppicz' : 'ppivr';
  const fileId = layer === 'ppi' ? station.id : (station.dopplerId ?? station.id);
  return `https://${station.server}.cptec.inpe.br/radar/${station.org}/${station.slug}/ppi/${subtype}/${y}/${mo}/${fileId}_${ts12}.png`;
}

const CDN_SERVER_FALLBACKS = ['s1', 's2', 's3', 's0'] as const;

function uniqueServers(primary: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of [primary, ...CDN_SERVER_FALLBACKS]) {
    if (!seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}

/** Tenta o servidor do catálogo e depois s1/s2/s3/s0 (RadarFullv3 / CDN). */

const STORAGE_BUCKET = 'studio-4398873450-7cc8f.firebasestorage.app';
const RADAR_BACKUP_PREFIX = 'radar_backup';

let fallbackBucket: any;
function getFallbackBucket() {
  if (!fallbackBucket) {
    fallbackBucket = new Storage().bucket(STORAGE_BUCKET);
  }
  return fallbackBucket;
}

export async function checkFirebaseStorageFallback(slug: string, ts12: string, productType: 'reflectividade' | 'velocidade' = 'reflectividade'): Promise<{ buffer: Buffer, fileName: string, url: string } | null> {
  const y = ts12.slice(0, 4);
  const m = ts12.slice(4, 6);
  const d = ts12.slice(6, 8);
  const hh = ts12.slice(8, 10);
  const mm = ts12.slice(10, 12);
  const targetMin = parseInt(mm, 10);

  const isVel = productType === 'velocidade';
  const suffix = isVel ? '_vel.png' : '.png';
  const bucket = getFallbackBucket();

  try {
    const hourPrefix = `${RADAR_BACKUP_PREFIX}/${slug}/${y}/${m}/${d}${hh}`;
    let [files] = await bucket.getFiles({ prefix: hourPrefix, maxResults: 50 });
    let pngFiles = files.filter((f: any) => f.name.endsWith(suffix));

    if (pngFiles.length === 0) {
      const prevHour = String(Math.max(0, parseInt(hh, 10) - 1)).padStart(2, '0');
      const prevHourPrefix = `${RADAR_BACKUP_PREFIX}/${slug}/${y}/${m}/${d}${prevHour}`;
      [files] = await bucket.getFiles({ prefix: prevHourPrefix, maxResults: 50 });
      pngFiles = files.filter((f: any) => f.name.endsWith(suffix));
    }

    if (pngFiles.length === 0) {
      const dayPrefix = `${RADAR_BACKUP_PREFIX}/${slug}/${y}/${m}/${d}`;
      [files] = await bucket.getFiles({ prefix: dayPrefix, maxResults: 100 });
      pngFiles = files.filter((f: any) => f.name.endsWith(suffix));
    }

    if (pngFiles.length === 0) return null;

    let bestFile: any = null;
    let minDiff = Infinity;

    for (const file of pngFiles) {
      const basename = file.name.split('/').pop()?.replace('.png', '') ?? '';
      if (basename.length < 6) continue;

      const fileDay = parseInt(basename.slice(0, 2), 10);
      const fileHour = parseInt(basename.slice(2, 4), 10);
      const fileMin = parseInt(basename.slice(4, 6), 10);

      const targetTotalMin = parseInt(d, 10) * 1440 + parseInt(hh, 10) * 60 + targetMin;
      const fileTotalMin = fileDay * 1440 + fileHour * 60 + fileMin;
      const diff = Math.abs(fileTotalMin - targetTotalMin);

      if (diff < minDiff) {
        minDiff = diff;
        bestFile = file;
      }
    }

    if (!bestFile || minDiff > 10) return null; // 10 minutes tolerance

    const [buffer] = await bestFile.download();
    return { buffer, fileName: `${ts12}${isVel ? '-ppivr' : ''}.png`, url: 'firebase-fallback' };
  } catch (err) {
    console.error('checkFirebaseStorageFallback err:', err);
    return null;
  }
}

export async function checkIpmetStorageFallback(slug: string, ts12: string): Promise<{ buffer: Buffer, fileName: string, url: string } | null> {
  const y = ts12.slice(0, 4);
  const m = ts12.slice(4, 6);
  const d = ts12.slice(6, 8);
  const hh = ts12.slice(8, 10);
  const mm = ts12.slice(10, 12);
  const targetMin = parseInt(mm, 10);

  const bucket = getFallbackBucket();
  const prefixLegacyToday = `ipmet-bauru/${y}/${m}/${d}${hh}`;
  const prefixDayToday = `ipmet-bauru/${y}/${m}/${d}/${hh}`;

  try {
    let [files] = await bucket.getFiles({ prefix: prefixLegacyToday, maxResults: 50 });
    let pngFiles = files.filter((f: any) => f.name.endsWith('.png'));

    if (pngFiles.length === 0) {
      [files] = await bucket.getFiles({ prefix: prefixDayToday, maxResults: 50 });
      pngFiles = files.filter((f: any) => f.name.endsWith('.png'));
    }
    
    if (pngFiles.length === 0) return null;

    let bestFile: any = null;
    let minDiff = Infinity;

    for (const file of pngFiles) {
      const parts = file.name.split('/');
      const basename = parts[parts.length - 1].replace('.png', '');
      
      let fileH, fileMin;
      if (parts.length >= 5 && parts[parts.length - 2].length === 2 && !isNaN(Number(parts[parts.length - 2]))) {
        if (basename.length >= 4) {
          fileH = parseInt(basename.slice(0, 2), 10);
          fileMin = parseInt(basename.slice(2, 4), 10);
        }
      } else if (parts.length >= 4) {
        if (basename.length >= 6) {
          fileH = parseInt(basename.slice(2, 4), 10);
          fileMin = parseInt(basename.slice(4, 6), 10);
        }
      }

      if (fileH === undefined || fileMin === undefined) continue;

      const targetTotalMin = parseInt(hh, 10) * 60 + targetMin;
      const fileTotalMin = fileH * 60 + fileMin;
      const diff = Math.abs(fileTotalMin - targetTotalMin);

      if (diff < minDiff) {
        minDiff = diff;
        bestFile = file;
      }
    }

    if (!bestFile || minDiff > 10) return null;

    const [buffer] = await bestFile.download();
    return { buffer, fileName: `${ts12}.png`, url: 'firebase-fallback' };
  } catch (err) {
    console.error('checkIpmetStorageFallback err:', err);
    return null;
  }
}

export async function downloadIpmetImagesInWindow(
  slug: string,
  nowTs12: string,
  windowMinutes: number,
  options?: { checkExists?: (fileName: string) => Promise<boolean> }
): Promise<CptecSyncedFile[]> {
  const out: CptecSyncedFile[] = [];
  const maxImages = 12;
  
  let currentTs = nowTs12;
  const endMs = ts12ToUtcMs(nowTs12) - windowMinutes * 60 * 1000;

  while (out.length < maxImages && ts12ToUtcMs(currentTs) >= endMs) {
    const fileName = `${currentTs}.png`;
    let shouldDownload = true;

    if (options?.checkExists && (await options.checkExists(fileName))) {
      out.push({
        ts12: currentTs,
        layer: 'ppi',
        fileName,
        url: `gcs://${slug}/${fileName}`,
        buffer: Buffer.alloc(0),
      });
      shouldDownload = false;
    }

    if (shouldDownload) {
      let ipmet: any = await checkIpmetStorageFallback(slug, currentTs);
      if (!ipmet) {
         // if it's very recent, try live fetch
         const diff = Math.abs(ts12ToUtcMs(nowTs12) - ts12ToUtcMs(currentTs)) / 60000;
         if (diff < 20) {
           ipmet = await fetchIpmetImage(currentTs);
         }
      }
      if (ipmet) {
        out.push({
          ts12: currentTs,
          layer: 'ppi',
          fileName,
          url: ipmet.url || 'firebase-fallback',
          buffer: ipmet.buffer,
        });
      }
    }

    currentTs = subtractMinutesFromTs12(currentTs, 15);
  }
  return out;
}

export async function fetchCptecPngFromCdn(
  station: CptecStation,
  ts12: string,
  layer: CptecLayer
): Promise<{ url: string; buffer: Buffer } | null> {
  for (const srv of uniqueServers(station.server)) {
    const st = { ...station, server: srv };
    const url = buildCptecPngUrl(st, ts12, layer);
    const buffer = await fetchPngBuffer(url);
    if (buffer && buffer.length > 0) return { url, buffer };
  }
  return null;
}

export function normalizeCptecImageUrl(url: string): string {
  // Não reescrever HTTP para HTTPS no CPTEC, os certificados deles no s0..s3 
  // dão Timeout/Error frequentemente a partir do Cloud Run
  return url;
}

export async function fetchPngBuffer(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(normalizeCptecImageUrl(url), { signal: AbortSignal.timeout(20000) });
    if (!res.ok) return null;
    const arrayBuffer = await res.arrayBuffer();
    const buf = Buffer.from(arrayBuffer);
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (ct.includes('image')) return buf;
    if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return buf;
    return null;
  } catch {
    return null;
  }
}

export async function findWorkingCptecUrl(
  station: CptecStation,
  nominalTs12: string
): Promise<{ url: string; ts12: string } | null> {
  for (const { interval, offset } of UNIVERSAL_FALLBACK_CONFIGS) {
    const ts12 = snapToInterval(nominalTs12, interval, offset);
    const got = await fetchCptecPngFromCdn(station, ts12, 'ppi');
    if (got) return { url: got.url, ts12 };
  }
  for (let back = 6; back <= 60; back += 6) {
    const backTs = subtractMinutesFromTs12(nominalTs12, back);
    for (const { interval, offset } of UNIVERSAL_FALLBACK_CONFIGS) {
      const ts12 = snapToInterval(backTs, interval, offset);
      const got = await fetchCptecPngFromCdn(station, ts12, 'ppi');
      if (got) return { url: got.url, ts12 };
    }
  }
  return null;
}

/**
 * Gera candidatos ts12 únicos: percorre cada minuto até `windowMinutes` atrás e aplica snap ao intervalo do radar.
 * @deprecated Preferir enumerateMinuteTs12InWindow para CDN — o snap falha quando o CPTEC publica fora da grelha.
 */
export function enumerateCptecTs12InWindow(
  nowTs12: string,
  windowMinutes: number,
  primaryInterval: number,
  offset: number
): string[] {
  const seen = new Set<string>();
  for (let back = 0; back <= windowMinutes; back++) {
    const nominalTs = subtractMinutesFromTs12(nowTs12, back);
    const ts12 = snapToInterval(nominalTs, primaryInterval, offset);
    seen.add(ts12);
  }
  return [...seen].sort((a, b) => b.localeCompare(a));
}

/** Um minuto por passo (UTC), sem snap — alinha com ficheiros reais no CDN quando a API Nowcasting não está mapeada. */
export function enumerateMinuteTs12InWindow(nowTs12: string, windowMinutes: number): string[] {
  const out: string[] = [];
  for (let back = 0; back <= windowMinutes; back++) {
    out.push(subtractMinutesFromTs12(nowTs12, back));
  }
  return out;
}

type NowcastingImagem = {
  fileDate?: string;
  fileTime?: string;
  /** Caminho no servidor; o timestamp no nome do ficheiro costuma ser o correto. */
  filePath?: string;
  url?: string;
  /** Espelhos CDN — por vezes todos apontam para um único ficheiro antigo (bug do lado deles). Só usar se bater com o ts12. */
  urls?: string[];
  horario?: number;
};

type NowcastingProduto = {
  id: string;
  produto?: string;
  imagens?: NowcastingImagem[];
};

function fileDateTimeToTs12(fileDate: string, fileTime: string): string | null {
  const d = fileDate.replace(/-/g, '');
  if (d.length !== 8) return null;
  const t = fileTime.replace(/:/g, '');
  if (t.length < 4) return null;
  return d + t.slice(0, 4);
}

function ts12FromCptecFilename(pathOrUrl: string): string | null {
  const m = /_(\d{12})\.png$/i.exec(pathOrUrl);
  return m ? m[1] : null;
}

/**
 * A API Nowcasting devolve `fileDate`/`fileTime` corretos, mas o array `urls` pode repetir um PNG antigo
 * (ex.: todos `..._202604011500.png` quando o `filePath` é `..._202604011606.png`). Preferir `url` e `filePath`.
 */
function pickNowcastingImageUrl(img: NowcastingImagem, expectedTs12: string): string | null {
  const matchesTs = (raw: string | undefined): string | null => {
    if (!raw) return null;
    const u = normalizeCptecImageUrl(raw);
    const ts = ts12FromCptecFilename(u);
    return ts === expectedTs12 ? u : null;
  };

  const fromDirect = matchesTs(img.url);
  if (fromDirect) return fromDirect;

  if (img.filePath) {
    const cdnFromPath = img.filePath.replace(/^\/oper\/share/, 'https://s0.cptec.inpe.br');
    const fromPath = matchesTs(cdnFromPath);
    if (fromPath) return fromPath;
  }

  if (img.urls?.length) {
    for (const u of img.urls) {
      const ok = matchesTs(u);
      if (ok) return ok;
    }
  }

  return null;
}

/**
 * Lista de imagens a partir da API oficial (mesmos URLs que o site).
 * Filtra por janela temporal e pelos IDs PPI / Doppler do catálogo.
 */
export async function downloadCptecImagesFromNowcastingApi(
  station: CptecStation,
  nw: { id: number; nome: string },
  windowMinutes: number,
  options?: { fetchDoppler?: boolean; checkExists?: (fileName: string) => Promise<boolean> }
): Promise<CptecSyncedFile[]> {
  const fetchDoppler = options?.fetchDoppler ?? process.env.CPTEC_FETCH_DOPPLER !== 'false';
  const quantidade = 12; // Busca sempre só as últimas 12 da API (cobre a última 1 hora para radares de 5 min)
  const apiUrl = `https://nowcasting.cptec.inpe.br/api/camadas/radar/${nw.id}/imagens?quantidade=${quantidade}&nome=${encodeURIComponent(nw.nome)}`;
  let data: NowcastingProduto[];
  try {
    const res = await fetch(apiUrl, { signal: AbortSignal.timeout(25000) });
    if (!res.ok) return [];
    const json = (await res.json()) as unknown;
    if (!Array.isArray(json)) return [];
    data = json as NowcastingProduto[];
  } catch {
    return [];
  }

  // A janela deve ser calculada a partir do momento "agora" para não falhar com radares atrasados
  // Se quisermos ser lenientes, podemos considerar desde a imagem mais nova ATÉ X minutos atrás da imagem mais nova.
  // Contudo, se a imagem mais nova for muito antiga, talvez não queiramos varrer tudo. O bucket já tem.
  // Vamos apenas descarregar todas as imagens que estão dentro do JSON retornado e não estão no GCS.
  const seen = new Set<string>();
  const out: CptecSyncedFile[] = [];

  for (const prod of data) {
    let layer: CptecLayer | null = null;
    if (prod.id === station.id) layer = 'ppi';
    else if (fetchDoppler && station.dopplerId && prod.id === station.dopplerId) layer = 'doppler';
    else continue;

    for (const img of prod.imagens || []) {
      if (!img.fileDate || !img.fileTime) continue;
      const ts12 = fileDateTimeToTs12(img.fileDate, img.fileTime);
      if (!ts12 || ts12.length !== 12) continue;

      const key = `${layer}:${ts12}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const fileName = layer === 'ppi' ? `${ts12}.png` : `${ts12}-ppivr.png`;

      // Evitar download se já existir no bucket
      if (options?.checkExists && await options.checkExists(fileName)) {
        continue;
      }

      const imgUrl = pickNowcastingImageUrl(img, ts12);
      if (!imgUrl) continue;
      
      const buffer = await fetchPngBuffer(imgUrl);
      if (!buffer || buffer.length === 0) continue;

      out.push({
        ts12,
        layer,
        fileName,
        url: imgUrl,
        buffer,
      });
    }
  }

  return out.sort((a, b) => b.ts12.localeCompare(a.ts12));
}

/**
 * Para cada ts12 na janela: descarrega PPI (ppicz) e, se ativo, Doppler (ppivr) com ID próprio.
 * Usa fallback de hosts s1/s2/s3/s0 no CDN. Candidatos = um minuto por passo (sem snap).
 */
export async function downloadCptecImagesInWindow(
  station: CptecStation,
  slug: string,
  nowTs12: string,
  windowMinutes: number,
  options?: { fetchDoppler?: boolean; checkExists?: (fileName: string) => Promise<boolean> }
): Promise<CptecSyncedFile[]> {
  const fetchDoppler = options?.fetchDoppler ?? process.env.CPTEC_FETCH_DOPPLER !== 'false';
  const nw = NOWCASTING_RADAR_MAP[slug];
  if (nw && process.env.CPTEC_SKIP_NOWCASTING_API !== 'true') {
    const fromApi = await downloadCptecImagesFromNowcastingApi(station, nw, windowMinutes, { fetchDoppler, checkExists: options?.checkExists });
    if (fromApi.length > 0) return fromApi;
  }

  const candidates = enumerateMinuteTs12InWindow(nowTs12, windowMinutes);
  const out: CptecSyncedFile[] = [];

  for (const ts12 of candidates) {
    const ppiFileName = `${ts12}.png`;
    if (options?.checkExists && await options.checkExists(ppiFileName)) {
      // Já existe, não precisamos sacar o PPI
    } else {
      let ppi: any = await checkFirebaseStorageFallback(slug, ts12, 'reflectividade');
        if (!ppi) {
          const cdnPpi = await fetchCptecPngFromCdn(station, ts12, 'ppi');
          if (cdnPpi) ppi = { buffer: cdnPpi.buffer, fileName: ppiFileName, url: cdnPpi.url };
        }
      if (ppi) {
        out.push({
          ts12,
          layer: 'ppi',
          fileName: ppiFileName,
          url: ppi.url,
          buffer: ppi.buffer,
        });
      }
    }

    if (fetchDoppler && station.dopplerId) {
      const dopFileName = `${ts12}-ppivr.png`;
      if (options?.checkExists && await options.checkExists(dopFileName)) {
        // Já existe
      } else {
        let dop: any = await checkFirebaseStorageFallback(slug, ts12, 'velocidade');
          if (!dop) {
            const cdnDop = await fetchCptecPngFromCdn(station, ts12, 'doppler');
            if (cdnDop) dop = { buffer: cdnDop.buffer, fileName: dopFileName, url: cdnDop.url };
          }
        if (dop) {
          out.push({
            ts12,
            layer: 'doppler',
            fileName: dopFileName,
            url: dop.url,
            buffer: dop.buffer,
          });
        }
      }
    }
  }
  return out;
}

/** @deprecated usar downloadCptecImagesInWindow */
export async function listCptecImagesInWindow(
  station: CptecStation,
  nowTs12: string,
  windowMinutes: number,
  _stepMinutes: number
): Promise<{ ts12: string; url: string }[]> {
  const slug = station.slug;
  const rows = await downloadCptecImagesInWindow(station, slug, nowTs12, windowMinutes, {
    fetchDoppler: false,
  });
  return rows.map(({ ts12, url }) => ({ ts12, url }));
}

export async function fetchIpmetImage(nominalTs12: string): Promise<{ buffer: Buffer; ts12: string } | null> {
  let trueTs12 = '';
  try {
    const htmlReq = await fetch('https://www.ipmetradar.com.br/alerta/ppigis/index.php');
    if (htmlReq.ok) {
      const html = await htmlReq.text();
      const m = html.match(/var dado_inicial = (\d{14});/);
      if (m && m[1]) {
        trueTs12 = m[1].substring(0, 12);
      }
    }
  } catch (e) {
    console.error('Error fetching IPMet HTML for timestamp:', e);
  }

  if (!trueTs12) {
    console.log('[fetchIpmetImage] Could not extract true ts12, falling back to nominalTs12');
    trueTs12 = nominalTs12;
  }

  const url = `${IPMET_URL}?t=${encodeURIComponent(trueTs12)}`;
  const buf = await fetchPngBuffer(url);
  if (!buf) return null;
  return { buffer: buf, ts12: trueTs12 };
}

export async function fetchClimatempoPoa(nominalTs12: string): Promise<{ buffer: Buffer; ts12: string } | null> {
  const url = `${CLIMATEMPO_POA_LATEST}?nocache=${encodeURIComponent(nominalTs12)}`;
  const buf = await fetchPngBuffer(url);
  if (!buf) return null;
  return { buffer: buf, ts12: nominalTs12 };
}

export async function downloadArgentinaImagesInWindow(
  slug: string,
  nowTs12: string,
  windowMinutes: number,
  options?: { fetchDoppler?: boolean; checkExists?: (fileName: string) => Promise<boolean> }
): Promise<CptecSyncedFile[]> {
  const code = slug.replace('argentina-', '');
  const out: CptecSyncedFile[] = [];
  const fetchDoppler = options?.fetchDoppler ?? process.env.CPTEC_FETCH_DOPPLER !== 'false';

  // Gerar array de timestamps de 10 em 10 minutos para trs
  const nowMs = ts12ToUtcMs(nowTs12);
  const endMs = nowMs - windowMinutes * 60 * 1000;
  
  // Arredondar "now" para bloco de 10 min nativo (18:13 vira 18:10)
  const m = parseInt(nowTs12.slice(10, 12), 10);
  const offset = m % 10;
  const snappedNowMs = nowMs - offset * 60 * 1000;

  for (let t = snappedNowMs; t >= endMs; t -= 10 * 60 * 1000) {
    const d = new Date(t);
    const y = d.getUTCFullYear().toString();
    const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    const h = String(d.getUTCHours()).padStart(2, '0');
    const min = String(d.getUTCMinutes()).padStart(2, '0');

    const ts12 = `${y}${mo}${day}${h}${min}`;
    const tsArgUrl = `${y}${mo}${day}T${h}${min}00Z`;

    const checkAndDownload = async (prodType: 'COLMAX' | 'VRAD', suffix: string, layer: CptecLayer) => {
      const fileName = layer === 'ppi' ? `${ts12}.png` : `${ts12}-ppivr.png`;
      if (options?.checkExists && await options.checkExists(fileName)) {
        return; 
      }
      
      const url = `https://webmet.ohmc.ar/media/radares/images/${code}/${y}/${mo}/${day}/${code}_${tsArgUrl}_${prodType}_00.png`;
      const buffer = await fetchPngBuffer(url);
      if (buffer && buffer.length > 0) {
        out.push({
          ts12,
          layer,
          fileName,
          url,
          buffer,
        });
      }
    };

    // REFLETIVIDADE - PPI (COLMAX)
    await checkAndDownload('COLMAX', '.png', 'ppi');
    // DOPPLER (VRAD)
    if (fetchDoppler) {
      await checkAndDownload('VRAD', '-ppivr.png', 'doppler');
    }
  }

  return out.sort((a, b) => b.ts12.localeCompare(a.ts12));
}

// --- REDEMET (mesma resolução de URL que app/api/radar-redemet-find + lib/redemetRadar) ---

const REDEMET_PLOTA_URL = 'https://redemet.decea.mil.br/old/produtos/radares-meteorologicos/plota_radar.php';
const REDEMET_PRODUCTS_PAGE = 'https://redemet.decea.mil.br/old/produtos/radares-meteorologicos/';
const REDEMET_SITE_BASE = 'https://redemet.decea.mil.br/';
const REDEMET_ESTATICO_RADAR = 'https://estatico-redemet.decea.mil.br/radar';
const REDEMET_OLD_RADAR = 'https://redemet.decea.mil.br/old/radar';

const REDEMET_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const REDEMET_BROWSER_HEADERS: Record<string, string> = {
  'User-Agent': REDEMET_UA,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
  Pragma: 'no-cache',
};

function redemetExtractSessionCookie(headers: Headers): string {
  const getSetCookie = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  if (typeof getSetCookie === 'function') {
    const cookies = getSetCookie.call(headers);
    for (const c of cookies) {
      const m = c.match(/PHPSESSID=([^;]+)/);
      if (m) return `PHPSESSID=${m[1]}`;
    }
  }
  const setCookie = headers.get('set-cookie') ?? '';
  const match = setCookie.match(/PHPSESSID=([^;]+)/);
  return match ? `PHPSESSID=${match[1]}` : '';
}

function addMinutesToTs12Redemet(ts12: string, deltaMin: number): string {
  const d = new Date(
    Date.UTC(
      parseInt(ts12.slice(0, 4), 10),
      parseInt(ts12.slice(4, 6), 10) - 1,
      parseInt(ts12.slice(6, 8), 10),
      parseInt(ts12.slice(8, 10), 10),
      parseInt(ts12.slice(10, 12), 10)
    )
  );
  d.setUTCMinutes(d.getUTCMinutes() + deltaMin);
  return (
    d.getUTCFullYear().toString() +
    String(d.getUTCMonth() + 1).padStart(2, '0') +
    String(d.getUTCDate()).padStart(2, '0') +
    String(d.getUTCHours()).padStart(2, '0') +
    String(d.getUTCMinutes()).padStart(2, '0')
  );
}

/** Candidatos diretos maxcappi (estatico + old/radar), como em lib/redemetRadar.buildRedemetPngUrlsToTry — evita POST quando possível. */
function buildRedemetMaxcappiUrlCandidates(area: string, ts12: string, useHistoricalPath: boolean): string[] {
  const baseUrl = useHistoricalPath ? REDEMET_OLD_RADAR : REDEMET_ESTATICO_RADAR;
  const base = `${baseUrl}/${ts12.slice(0, 4)}/${ts12.slice(4, 6)}/${ts12.slice(6, 8)}/${area}/maxcappi/maps`;
  const offsets = useHistoricalPath ? [12, 6, 0, -6, -12] : [6, 0, -6];
  const secondsToTry = useHistoricalPath
    ? ['00', '03', '04', '05', '09', '10', '12', '15', '20', '22', '23', '24', '25', '26', '30', '32', '33', '35', '36', '37']
    : ['00', '22', '23', '24', '25', '30', '35', '36', '37', '05', '10', '15', '20'];
  const urls: string[] = [];
  for (const delta of offsets) {
    const ts = delta === 0 ? ts12 : addMinutesToTs12Redemet(ts12, delta);
    const hh = ts.slice(8, 10);
    const mm = ts.slice(10, 12);
    for (const ss of secondsToTry) {
      urls.push(`${base}/${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}--${hh}:${mm}:${ss}.png`);
    }
  }
  return urls;
}

async function fetchRedemetPngBuffer(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(20000),
      headers: {
        'User-Agent': REDEMET_UA,
        Referer: 'https://redemet.decea.mil.br/',
        Accept: 'image/avif,image/webp,image/png,image/*;q=0.8,*/*;q=0.5',
      },
    });
    if (!res.ok) return null;
    const arrayBuffer = await res.arrayBuffer();
    const buf = Buffer.from(arrayBuffer);
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (ct.includes('image')) return buf;
    if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return buf;
    return null;
  } catch {
    return null;
  }
}

/**
 * POST plota_radar.php com radar[]=maxcappi (igual /api/radar-redemet-find).
 */
async function findRedemetImageUrlViaPlota(area: string, ts12: string): Promise<string | null> {
  const y = ts12.slice(0, 4);
  const mo = ts12.slice(4, 6);
  const d = ts12.slice(6, 8);
  const hh = ts12.slice(8, 10);
  const mm = ts12.slice(10, 12);
  const datahora = `${d}/${mo}/${y} ${hh}:${mm}`;

  let sessionCookie = '';
  try {
    const pageRes = await fetch(REDEMET_PRODUCTS_PAGE, {
      method: 'GET',
      headers: REDEMET_BROWSER_HEADERS,
      redirect: 'follow',
      signal: AbortSignal.timeout(10_000),
    });
    sessionCookie = redemetExtractSessionCookie(pageRes.headers);
  } catch {
    /* sem cookie */
  }

  const postHeaders: Record<string, string> = {
    ...REDEMET_BROWSER_HEADERS,
    Referer: REDEMET_PRODUCTS_PAGE,
    Origin: 'https://redemet.decea.mil.br',
    'X-Requested-With': 'XMLHttpRequest',
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
  };
  if (sessionCookie) postHeaders['Cookie'] = sessionCookie;

  const params = new URLSearchParams();
  params.append('radar[]', 'maxcappi');
  params.append('datahora', datahora);
  params.append('coordenadaVis[]', '1');
  params.append('zoom', '1');
  params.append('animar', '0');
  params.append('radarNome', area);

  const res = await fetch(REDEMET_PLOTA_URL, {
    method: 'POST',
    headers: postHeaders,
    body: params.toString(),
    redirect: 'follow',
    signal: AbortSignal.timeout(12_000),
  });

  if (!res.ok) return null;

  const html = await res.text();

  const regex = new RegExp(`old/radar/.*?/${area}/.*?\\.png`);
  const match = html.match(regex);

  if (!match?.[0]) {
    const oldRegex = new RegExp(`carrega_radar\\s*\\(\\s*\\d+\\s*,\\s*'${area}'\\s*,\\s*'([^']+)'`);
    const oldMatch = html.match(oldRegex);
    if (!oldMatch?.[1]) return null;
    return `${REDEMET_SITE_BASE}${oldMatch[1]}`;
  }

  return `${REDEMET_SITE_BASE}${match[0]}`;
}

async function tryFetchRedemetImageForTs12(area: string, ts12: string): Promise<{ url: string; buffer: Buffer } | null> {
  // 1) Igual ao ao-vivo: POST plota_radar resolve o PNG real (incl. path old/radar).
  const plotaUrl = await findRedemetImageUrlViaPlota(area, ts12);
  if (plotaUrl) {
    const buf = await fetchRedemetPngBuffer(plotaUrl);
    if (buf && buf.length > 0) return { url: plotaUrl, buffer: buf };
  }

  // 2) Fallback: poucos GETs diretos maxcappi (estatico + old), como lib/redemetRadar — evita explosão de pedidos.
  const fallback = [
    ...buildRedemetMaxcappiUrlCandidates(area, ts12, false),
    ...buildRedemetMaxcappiUrlCandidates(area, ts12, true),
  ].slice(0, 48);
  const seen = new Set<string>();
  for (const u of fallback) {
    if (seen.has(u)) continue;
    seen.add(u);
    const buf = await fetchRedemetPngBuffer(u);
    if (buf && buf.length > 0) return { url: u, buffer: buf };
  }

  return null;
}

export function redemetSlugToAreaCode(slug: string): string | null {
  const m = /^redemet-([a-z]{2})$/.exec(slug);
  return m ? m[1] : null;
}

/** Descarrega PNGs REDEMET (reflectividade maxcappi) preservando no máximo 12 imagens únicas na janela — pasta GCS = slug (ex.: redemet-sg). */
export async function downloadRedemetImagesInWindow(
  slug: string,
  nowTs12: string,
  windowMinutes: number,
  options?: { checkExists?: (fileName: string) => Promise<boolean> }
): Promise<CptecSyncedFile[]> {
  const area = redemetSlugToAreaCode(slug);
  if (!area) return [];

  // Tenta a cada 5 minutos ao longo da janela, do mais recente para o mais antigo
  const out: CptecSyncedFile[] = [];
  const maxImages = 12;

  let currentTs = nowTs12;
  const endMs = ts12ToUtcMs(nowTs12) - windowMinutes * 60 * 1000;

  while (out.length < maxImages && ts12ToUtcMs(currentTs) >= endMs) {
    const fileName = `${currentTs}.png`;
    let shouldDownload = true;

    if (options?.checkExists && (await options.checkExists(fileName))) {
      // Se já existe no bucket, simulamos uma "descoberta" para não apagar e contar para as 12
      out.push({
        ts12: currentTs,
        layer: 'ppi',
        fileName,
        url: `gcs://${slug}/${fileName}`, // Placeholder url, file exists
        buffer: Buffer.alloc(0),
      });
      shouldDownload = false;
    }

    if (shouldDownload) {
      let got: any = await checkFirebaseStorageFallback(slug, currentTs, 'reflectividade');
        if (!got) {
          const live = await tryFetchRedemetImageForTs12(area, currentTs);
          if (live) got = { buffer: live.buffer, fileName: fileName, url: live.url };
        }
      if (got) {
        out.push({
          ts12: currentTs,
          layer: 'ppi',
          fileName,
          url: got.url,
          buffer: got.buffer,
        });
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    
    currentTs = subtractMinutesFromTs12(currentTs, 5);
  }

  return out.sort((a, b) => b.ts12.localeCompare(a.ts12));
}

// =========================================================================
// RAINVIEWER SOURCES (SIMEPAR / IPMET)
// =========================================================================

export const SIMEPAR_CASCAVEL_URL = 'https://data.rainviewer.com/images/BRSC3/';
export const IPMET_RAINVIEWER_URL = 'https://data.rainviewer.com/images/BRPB/';

import sharp from 'sharp';
import { Storage } from '@google-cloud/storage';

/**
 * Processa imagens Rainviewer (Simepar, IPMet, etc), filtra o mapa de fundo 
 * (deixando transparente) e converte para PNG.
 */
async function processRainviewerImage(
  urlPrefix: string,
  slug: string,
  nowTs12: string,
  windowMinutes: number,
  options?: { checkExists?: (fileName: string) => Promise<boolean> },
  prefixId: string = 'BRSC3'
): Promise<CptecSyncedFile[]> {
  const out: CptecSyncedFile[] = [];

  try {
    const res = await fetch(urlPrefix, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return out;
    const text = await res.text();
    
    // As imagens seguem o padrão PRE_YYYYMMDD_HHMM00_0_source.jpeg (em UTC) ou ..._2_map.png
    // Ex: BRSC3_20260403_230000_0_source.jpeg ou BRPB_20250801_130000_2_map.png
    const regex = new RegExp(`href="(${prefixId}_\\d{8}_\\d{4}00_[^"]+\\.(?:jpeg|png))"`, 'g');
    const matches = [...text.matchAll(regex)];
    const files = matches.map(m => m[1]);
    
    const endMs = ts12ToUtcMs(nowTs12) - windowMinutes * 60 * 1000;
    
    // Vamos iterar de trás para a frente (mais recentes primeiro)
    files.reverse();

    for (const file of files) {
      if (out.length >= 12) break; // Limite de 12 imagens

      const m = new RegExp(`${prefixId}_(\\d{8})_(\\d{4})00_`).exec(file);
      if (!m) continue;

      const ts12 = `${m[1]}${m[2]}`; // YYYYMMDDHHMM
      const tMs = ts12ToUtcMs(ts12);

      if (tMs < endMs) continue; // Muito antigo para a janela de sync

      const fileName = `${ts12}.png`;

      if (options?.checkExists && (await options.checkExists(fileName))) {
        out.push({
          ts12,
          layer: 'ppi',
          fileName,
          url: `gcs://${slug}/${fileName}`,
          buffer: Buffer.alloc(0),
        });
        continue;
      }

      // Download da imagem
      const imgRes = await fetch(`${urlPrefix}${file}`, { signal: AbortSignal.timeout(10000) });
      if (!imgRes.ok) continue;
      const arrayBuffer = await imgRes.arrayBuffer();
      
      // Aplicar filtro canvas/sharp para remover fundo
      const { data, info } = await sharp(arrayBuffer)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
        
      const { width, height, channels } = info;
      
      for (let i = 0; i < data.length; i += channels) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];

        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const delta = max - min;

        let keep = true;

        if (max < 100) {
          keep = false; // Cores escuras (terra, ruas do mapa)
        } else if (b > max * 0.8 && r < 80 && g < 110) {
          keep = false; // Água do mapa (azul escuro)
        } else if (delta < 20) {
          keep = false; // Escala de cinzentos (texto, linhas, bordas, branco puro)
        }

        // Cortar legendas e logos
        const y = Math.floor((i / channels) / width);
        if (y > height - 60) {
          keep = false; // Legenda inferior
        }

        if (!keep) {
          data[i + 3] = 0; // Torna transparente
        }
      }

      const outBuffer = await sharp(data, {
        raw: { width, height, channels }
      })
      .png()
      .toBuffer();

      out.push({
        ts12,
        layer: 'ppi',
        fileName,
        url: `${urlPrefix}${file}`,
        buffer: outBuffer,
      });
    }

  } catch (err) {
    console.error(`Erro a fazer fetch de ${slug} (Rainviewer):`, err);
  }

  return out.sort((a, b) => b.ts12.localeCompare(a.ts12));
}

export async function downloadSimeparImagesInWindow(
  slug: string,
  nowTs12: string,
  windowMinutes: number,
  options?: { checkExists?: (fileName: string) => Promise<boolean> }
): Promise<CptecSyncedFile[]> {
  if (slug !== 'simepar-cascavel') return [];
  return processRainviewerImage(SIMEPAR_CASCAVEL_URL, slug, nowTs12, windowMinutes, options, 'BRSC3');
}

export async function downloadIpmetRainviewerInWindow(
  slug: string,
  nowTs12: string,
  windowMinutes: number,
  options?: { checkExists?: (fileName: string) => Promise<boolean> }
): Promise<CptecSyncedFile[]> {
  if (slug !== 'ipmet-bauru') return [];
  return processRainviewerImage(IPMET_RAINVIEWER_URL, slug, nowTs12, windowMinutes, options, 'BRPB');
}


export async function downloadSigmaImagesInWindow(
  slug: string,
  nominalTs12: string,
  windowMinutes: number,
  options?: { checkExists?: (fileName: string) => Promise<boolean> }
): Promise<CptecSyncedFile[]> {
  const cptecSlug = slug.replace('sigma-', '');
  const station = CPTEC_STATIONS[cptecSlug] || Object.values(CPTEC_STATIONS).find(s => s.slug === cptecSlug);
  if (!station || !station.sigmaConfig) {
    return [];
  }

  const found: CptecSyncedFile[] = [];
  const nominalMs = ts12ToUtcMs(nominalTs12);
  const minMs = nominalMs - windowMinutes * 60 * 1000;

  // HISTORICAL FALLBACK
  if (Date.now() - nominalMs > 12 * 3600 * 1000) {
    let currentTs = nominalTs12;
    while (found.length < 12 && ts12ToUtcMs(currentTs) >= minMs) {
      if (station.sigmaConfig.cappi) {
        const fb = await checkFirebaseStorageFallback(slug, currentTs, 'reflectividade');
        if (fb) found.push({ ts12: currentTs, layer: 'ppi', fileName: fb.fileName, url: fb.url, buffer: fb.buffer });
      }
      if (station.sigmaConfig.vento) {
        const fbd = await checkFirebaseStorageFallback(slug, currentTs, 'velocidade');
        if (fbd) found.push({ ts12: currentTs, layer: 'doppler', fileName: fbd.fileName, url: fbd.url, buffer: fbd.buffer });
      }
      currentTs = subtractMinutesFromTs12(currentTs, 10);
    }
    return found;
  }


  const fetchProduct = async (codigo: number, layer: 'ppi' | 'doppler') => {
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 8000);
      const url = `https://sigma.cptec.inpe.br/logs/${codigo}/20`;
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(id);

      if (!res.ok) return;
      const data = await res.json() as any[];
      if (!Array.isArray(data)) return;

      for (const item of data) {
        if (!item.url) continue;
        
        const m = /_(\d{12})\.(png|jpg|jpeg|gif)$/i.exec(item.url);
        if (!m) continue;
        const ts12 = m[1];
        const tMs = ts12ToUtcMs(ts12);

        if (tMs >= minMs && tMs <= nominalMs) {
          const fileName = `${ts12}${layer === 'doppler' ? '-ppivr' : ''}.png`;
          if (options?.checkExists) {
            const exists = await options.checkExists(fileName);
            if (exists) continue;
          }

          const c2 = new AbortController();
          const id2 = setTimeout(() => c2.abort(), 15000);
          const imgRes = await fetch(item.url, { signal: c2.signal });
          clearTimeout(id2);
          if (imgRes.ok) {
            const buf = Buffer.from(await imgRes.arrayBuffer());
            found.push({ ts12, layer, fileName, url: item.url, buffer: buf });
          }
        }
      }
    } catch (e) {
      console.error(`Sigma fetch error for ${slug} / ${layer}:`, e);
    }
  };

  if (station.sigmaConfig.cappi) await fetchProduct(station.sigmaConfig.cappi, 'ppi');
  if (station.sigmaConfig.vento) await fetchProduct(station.sigmaConfig.vento, 'doppler');

  return found;
}

export async function downloadSipamImagesInWindow(
  slug: string,
  targetTs12: string,
  windowMinutes: number,
  sipamSlug: string
): Promise<CptecSyncedFile[]> {
  const images: CptecSyncedFile[] = [];

  const tMs = ts12ToUtcMs(targetTs12);
  const minMs = tMs - windowMinutes * 60 * 1000;

  // HISTORICAL FALLBACK
  if (Date.now() - tMs > 12 * 3600 * 1000) {
    let currentTs = targetTs12;
    while (images.length < 12 && ts12ToUtcMs(currentTs) >= minMs) {
      const fb = await checkFirebaseStorageFallback(slug, currentTs, 'reflectividade');
      if (fb) images.push({ ts12: currentTs, layer: 'ppi', fileName: fb.fileName, url: fb.url, buffer: fb.buffer });
      currentTs = subtractMinutesFromTs12(currentTs, 15);
    }
    return images;
  }

  try {
    const res = await fetch('https://apihidro.sipam.gov.br/radares/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://hidro.sipam.gov.br/',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const radars: any = await res.json();
    const radar = radars.find((r: any) => r.nomeRadar === sipamSlug);

    if (!radar || !radar.varreduras || radar.varreduras.length === 0) {
      return images;
    }

    const frames = radar.varreduras.map((v: string) => {
      const d = new Date(v);
      const ts12 = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}`;
      const sipamTs = `${d.getUTCFullYear()}_${String(d.getUTCMonth() + 1).padStart(2, '0')}_${String(d.getUTCDate()).padStart(2, '0')}_${String(d.getUTCHours()).padStart(2, '0')}_${String(d.getUTCMinutes()).padStart(2, '0')}_${String(d.getUTCSeconds()).padStart(2, '0')}`;
      return { ts12, sipamTs };
    });

    frames.sort((a: any, b: any) => b.ts12.localeCompare(a.ts12));

    const windowEnd = parseInt(targetTs12, 10);
    const validFrames = frames.filter((f: any) => parseInt(f.ts12, 10) <= windowEnd).slice(0, 12);

    for (const frame of validFrames) {
      const imgUrl = `https://siger.sipam.gov.br/radar/${sipamSlug}/dbz/${frame.sipamTs}.png`;
      const fileName = `${slug}_${frame.ts12}.png`;
      
      try {
        const imgRes = await fetch(imgUrl, {
          signal: AbortSignal.timeout(15000),
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': 'https://hidro.sipam.gov.br/'
          }
        });
        if (imgRes.ok) {
            const buf = Buffer.from(await imgRes.arrayBuffer());
            images.push({ buffer: buf, fileName, url: imgUrl, ts12: frame.ts12, layer: 'ppi' });
        } else {
            console.log(`[SIPAM] Falha ao baixar ${imgUrl}: ${imgRes.status}`);
        }
      } catch (e: any) {
        console.log(`[SIPAM] Falha ao baixar ${imgUrl}: ${e.message}`);
      }
    }
  } catch (e: any) {
    console.error(`[SIPAM] Erro ao buscar lista ${sipamSlug}: ${e.message}`);
  }

  return images;
}



export async function downloadUspImagesInWindow(
  slug: string,
  targetTs12: string,
  windowMinutes: number
): Promise<CptecSyncedFile[]> {
  const images: CptecSyncedFile[] = [];
  if (slug !== 'usp-starnet') return images;

  const nowMs = ts12ToUtcMs(targetTs12);
  const startMs = nowMs - windowMinutes * 60 * 1000;

  // Starnet loop X is 1 to 10. 10 is the most recent.
  // We need to fetch each image and read its Last-Modified header to get the real timestamp,
  // since the URL is generic. Or we can just use the current time and subtract ~5 mins per frame, 
  // but let's try to get Last-Modified.
  
  for (let i = 1; i <= 10; i++) {
    const imgUrl = `https://www.starnet.iag.usp.br/img_starnet/Radar_USP/pelletron_36km/loop/36km_loop_${i}.png`;
    try {
      const imgRes = await fetch(imgUrl, {
        signal: AbortSignal.timeout(10000),
      });
      if (imgRes.ok) {
        const lastModified = imgRes.headers.get('last-modified');
        let fileDate = new Date(); // fallback to roughly now if not provided
        if (lastModified) {
          fileDate = new Date(lastModified);
        } else {
          // Fallback: estimate time based on index (i=10 is newest, i=1 is oldest, 5 min intervals)
          fileDate = new Date(nowMs - (10 - i) * 5 * 60 * 1000);
        }
        
        const fileMs = fileDate.getTime();
        // check if it's within the window
        if (fileMs >= startMs && fileMs <= nowMs + 10 * 60 * 1000) {
          const ts12 = `${fileDate.getUTCFullYear()}${String(fileDate.getUTCMonth() + 1).padStart(2, '0')}${String(fileDate.getUTCDate()).padStart(2, '0')}${String(fileDate.getUTCHours()).padStart(2, '0')}${String(fileDate.getUTCMinutes()).padStart(2, '0')}`;
          const fileName = `${slug}_${ts12}.png`;
          const buf = Buffer.from(await imgRes.arrayBuffer());
          images.push({ buffer: buf, fileName, url: imgUrl, ts12, layer: 'ppi' });
        }
      }
    } catch (e: any) {
      console.log(`[USP] Falha ao baixar ${imgUrl}: ${e.message}`);
    }
  }

  images.sort((a, b) => b.ts12.localeCompare(a.ts12));
  return images;
}
