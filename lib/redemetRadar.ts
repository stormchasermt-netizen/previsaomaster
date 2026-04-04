/**
 * Mapeamento CPTEC slug → REDEMET/DECEA area para fallback de imagens de radar.
 * URL formato DECEA: https://estatico-redemet.decea.mil.br/radar/{YYYY}/{MM}/{DD}/{codigo}/maxcappi/maps/{YYYY}-{MM}-{DD}--{HH}:{mm}:{ss}.png
 */

/** Mapeamento CPTEC slug → REDEMET area (2 letras). Radares sem entrada não têm fallback REDEMET. */
const CPTEC_TO_REDEMET: Record<string, string> = {
  almenara: 'al',
  belem: 'be',
  boavista: 'bv',
  cangucu: 'cn',
  cruzeirodosul: 'cz',
  gama: 'ga',
  jaraguari: 'jr',
  morroigreja: 'mi',
  manaus: 'mn',
  macapa: 'mq',
  maceio: 'mo',
  natal: 'nt',
  picocouto: 'pc',
  petrolina: 'pl',
  portovelho: 'pv',
  saofrancisco: 'sf',
  santiago: 'sg',
  saoluis: 'sl',
  santarem: 'sn',
  saoroque: 'sr',
  salvador: 'sv',
  santatereza: 'st',
  tefe: 'tf',
  tresmarias: 'tm',
  tabatinga: 'tt',
  saogabriel: 'ua',
  vilhena: 'vh',
  'rio-branco': 'rb',
};

/** Radares sem fallback REDEMET. */
const NO_REDEMET: Set<string> = new Set([
  'chapeco', 'lontras', 'guaratiba', 'macae', 'ipmet-bauru', 'usp-starnet',
]);

/**
 * Verifica se o radar CPTEC tem fallback REDEMET (CDN maxcappi).
 * Usa a tabela oficial em docs/radaresv2.txt (REDEMET) + `CPTEC_TO_REDEMET`.
 * Radares em `NO_REDEMET` não tentam pasta DECEA (URL/produto incompatível ou outra fonte).
 */
export function hasRedemetFallback(slug: string): boolean {
  if (NO_REDEMET.has(slug)) return false;
  return slug in CPTEC_TO_REDEMET;
}

/**
 * Retorna o código REDEMET para o slug CPTEC, ou null se não houver.
 */
export function getRedemetArea(slug: string): string | null {
  return CPTEC_TO_REDEMET[slug] ?? null;
}

/** Pasta no bucket `riobranco` ↔ slug de catálogo `rio-branco`. */
export function bucketCatalogSlugFromBucketName(bucketSlug: string): string {
  if (bucketSlug === 'riobranco') return 'rio-branco';
  return bucketSlug;
}

/**
 * Prefixo GCS `redemet-sg` para o radar CPTEC cuja pasta no bucket é `santiago`, etc.
 * Retorna null se o radar não tiver par REDEMET no catálogo.
 */
export function getRedemetBucketSlugForCptecBucket(bucketSlug: string): string | null {
  const catalog = bucketCatalogSlugFromBucketName(bucketSlug);
  if (!hasRedemetFallback(catalog)) return null;
  const a = getRedemetArea(catalog);
  return a ? `redemet-${a}` : null;
}

const REDEMET_BASE = 'https://estatico-redemet.decea.mil.br/radar';
/** Path antigo REDEMET para imagens históricas (ex: 2018). redemet.decea.mil.br/old/radar/ */
const REDEMET_OLD_BASE = 'https://redemet.decea.mil.br/old/radar';

/**
 * Monta URL direta da imagem REDEMET/DECEA maxcappi.
 * Formato: https://estatico-redemet.decea.mil.br/radar/{YYYY}/{MM}/{DD}/{codigo}/maxcappi/maps/{YYYY}-{MM}-{DD}--{HH}:{mm}:{ss}.png
 */
export function buildRedemetPngUrl(area: string, ts12: string, seconds?: string): string {
  const y = ts12.slice(0, 4);
  const m = ts12.slice(4, 6);
  const d = ts12.slice(6, 8);
  const hh = ts12.slice(8, 10);
  const mm = ts12.slice(10, 12);
  const ss = seconds ?? '00';
  const pathPart = `${y}-${m}-${d}--${hh}:${mm}:${ss}`;
  return `${REDEMET_BASE}/${y}/${m}/${d}/${area}/maxcappi/maps/${pathPart}.png`;
}

/** Adiciona minutos a ts12 (YYYYMMDDHHmm). */
function addMinutesToTs12(ts12: string, deltaMin: number): string {
  const d = new Date(Date.UTC(
    parseInt(ts12.slice(0, 4), 10),
    parseInt(ts12.slice(4, 6), 10) - 1,
    parseInt(ts12.slice(6, 8), 10),
    parseInt(ts12.slice(8, 10), 10),
    parseInt(ts12.slice(10, 12), 10)
  ));
  d.setUTCMinutes(d.getUTCMinutes() + deltaMin);
  return d.getUTCFullYear().toString() +
    String(d.getUTCMonth() + 1).padStart(2, '0') +
    String(d.getUTCDate()).padStart(2, '0') +
    String(d.getUTCHours()).padStart(2, '0') +
    String(d.getUTCMinutes()).padStart(2, '0');
}

/**
 * Retorna array de URLs REDEMET para tentar, em ordem de probabilidade.
 * Padrão observado: arquivos com timestamp ~6 min após o nominal, segundos variáveis (22-37).
 * Tenta: +6 min (mais provável), exato, -6 min, cada um com vários segundos.
 * Histórico (plota_radar): timestamps variam por radar (04:16:23, 04:20:32…); offsets e segundos ampliados.
 * @param useHistoricalPath - Se true, usa redemet.decea.mil.br/old/radar (imagens históricas, ex: 2018)
 */
export function buildRedemetPngUrlsToTry(area: string, ts12: string, useHistoricalPath?: boolean): string[] {
  const baseUrl = useHistoricalPath ? REDEMET_OLD_BASE : REDEMET_BASE;
  const base = `${baseUrl}/${ts12.slice(0, 4)}/${ts12.slice(4, 6)}/${ts12.slice(6, 8)}/${area}/maxcappi/maps`;
  const offsets = useHistoricalPath ? [12, 6, 0, -6, -12] : [6, 0, -6];
  const secondsToTry = useHistoricalPath
    ? ['00', '03', '04', '05', '09', '10', '12', '15', '20', '22', '23', '24', '25', '26', '30', '32', '33', '35', '36', '37', '40', '43', '44', '45', '50', '55']
    : ['00', '22', '23', '24', '25', '30', '35', '36', '37', '05', '10', '15', '20', '40', '45', '50', '55'];
  const urls: string[] = [];
  for (const delta of offsets) {
    const ts = delta === 0 ? ts12 : addMinutesToTs12(ts12, delta);
    const hh = ts.slice(8, 10);
    const mm = ts.slice(10, 12);
    for (const ss of secondsToTry) {
      urls.push(`${base}/${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}--${hh}:${mm}:${ss}.png`);
    }
  }
  return urls;
}
