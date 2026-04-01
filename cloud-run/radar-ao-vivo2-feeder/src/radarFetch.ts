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
}

export const IPMET_URL = 'https://getradaripmet-kj7x6j3jsa-uc.a.run.app';
export const CLIMATEMPO_POA_LATEST = 'https://statics.climatempo.com.br/radar_poa/pngs/latest/radar_poa_1.png';

/**
 * Pastas no bucket `radar_ao_vivo_2` (GCS) — alinhado a lib/cptecRadarStations + ao-vivo-2.
 * Ordem alfabética para diffs estáveis.
 */
export const DEFAULT_SYNC_SLUGS = [
  'almeirim',
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

/**
 * Intervalo de atualização típico (minutos) para snap na grelha CPTEC — alinhado a lib/cptecRadarStations.
 */
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
  jaraguari: 10,
  natal: 10,
  maceio: 10,
  salvador: 10,
  petrolina: 10,
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

export async function fetchPngBuffer(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
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
 * (Passo 1 minuto evita buracos que o passo 5 min + 4 snaps criavam.)
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

export type CptecSyncedFile = {
  ts12: string;
  layer: CptecLayer;
  fileName: string;
  url: string;
  buffer: Buffer;
};

/**
 * Para cada ts12 na janela: descarrega PPI (ppicz) e, se ativo, Doppler (ppivr) com ID próprio.
 * Usa fallback de hosts s1/s2/s3/s0 no CDN.
 */
export async function downloadCptecImagesInWindow(
  station: CptecStation,
  slug: string,
  nowTs12: string,
  windowMinutes: number,
  options?: { fetchDoppler?: boolean }
): Promise<CptecSyncedFile[]> {
  const fetchDoppler = options?.fetchDoppler ?? process.env.CPTEC_FETCH_DOPPLER !== 'false';
  const primaryInterval = CPTEC_PRIMARY_INTERVAL_MIN[slug] ?? 6;
  const candidates = enumerateCptecTs12InWindow(nowTs12, windowMinutes, primaryInterval, 0);
  const out: CptecSyncedFile[] = [];

  for (const ts12 of candidates) {
    const ppi = await fetchCptecPngFromCdn(station, ts12, 'ppi');
    if (ppi) {
      out.push({
        ts12,
        layer: 'ppi',
        fileName: `${ts12}.png`,
        url: ppi.url,
        buffer: ppi.buffer,
      });
    }
    if (fetchDoppler && station.dopplerId) {
      const dop = await fetchCptecPngFromCdn(station, ts12, 'doppler');
      if (dop) {
        out.push({
          ts12,
          layer: 'doppler',
          fileName: `${ts12}-ppivr.png`,
          url: dop.url,
          buffer: dop.buffer,
        });
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
  const url = `${IPMET_URL}?t=${encodeURIComponent(nominalTs12)}`;
  const buf = await fetchPngBuffer(url);
  if (!buf) return null;
  return { buffer: buf, ts12: nominalTs12 };
}

export async function fetchClimatempoPoa(nominalTs12: string): Promise<{ buffer: Buffer; ts12: string } | null> {
  const url = `${CLIMATEMPO_POA_LATEST}?nocache=${encodeURIComponent(nominalTs12)}`;
  const buf = await fetchPngBuffer(url);
  if (!buf) return null;
  return { buffer: buf, ts12: nominalTs12 };
}
