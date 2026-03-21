/**
 * Helpers para imagens IPMET no Firebase Storage.
 * Suporta duas estruturas:
 * - ipmet-bauru/{year}/{month}/{day}/{HHMMSS}.png (recomendado, evita colisão entre dias)
 * - ipmet-bauru/{year}/{month}/{HHMMSS}.png (legado)
 */

const STORAGE_BUCKET = 'studio-4398873450-7cc8f.firebasestorage.app';
const IPMET_STORAGE_PREFIX = 'ipmet-bauru';

/** Monta a URL pública do Storage para um arquivo IPMET (com dia no path). */
export function getIpmetStorageUrlWithDay(year: string, month: string, day: string, hhmmss: string): string {
  const path = `${IPMET_STORAGE_PREFIX}/${year}/${month}/${day}/${hhmmss}.png`;
  const encoded = encodeURIComponent(path);
  return `https://firebasestorage.googleapis.com/v0/b/${STORAGE_BUCKET}/o/${encoded}?alt=media`;
}

/** Monta a URL pública do Storage (legado, sem dia). */
export function getIpmetStorageUrl(year: string, month: string, hhmmss: string): string {
  const path = `${IPMET_STORAGE_PREFIX}/${year}/${month}/${hhmmss}.png`;
  const encoded = encodeURIComponent(path);
  return `https://firebasestorage.googleapis.com/v0/b/${STORAGE_BUCKET}/o/${encoded}?alt=media`;
}

/**
 * A partir de ts12 (YYYYMMDDHHmm), gera sugestões de HHMMSS para tentar.
 * IPMET pode gravar em intervalos irregulares (~11s); tentamos 00, 10, 20, 30, 40, 50.
 * Preferência: path com dia primeiro (evita colisão entre dias).
 */
export function getIpmetStorageUrlCandidates(ts12: string): string[] {
  const y = ts12.slice(0, 4);
  const m = ts12.slice(4, 6);
  const d = ts12.slice(6, 8);
  const hh = ts12.slice(8, 10);
  const mm = ts12.slice(10, 12);
  const base = `${hh}${mm}`;
  // Tenta todos os segundos possíveis (00-59) pois IPMET captura em intervalos irregulares
  const ssList: string[] = [];
  for (let s = 0; s < 60; s++) ssList.push(String(s).padStart(2, '0'));
  const result: string[] = [];
  for (const ss of ssList) {
    const hhmmss = `${base}${ss}`;
    result.push(getIpmetStorageUrlWithDay(y, m, d, hhmmss));
  }
  for (const ss of ssList) {
    const hhmmss = `${base}${ss}`;
    result.push(getIpmetStorageUrl(y, m, hhmmss));
  }
  return result;
}
