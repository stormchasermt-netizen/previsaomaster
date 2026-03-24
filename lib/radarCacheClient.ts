/**
 * radarCacheClient.ts
 * 
 * Utilitário client-side para enviar imagens carregadas ao cache do Storage.
 * Fire-and-forget: não bloqueia o carregamento da UI.
 */

/**
 * Envia uma imagem de radar carregada para o cache no Storage (fire-and-forget).
 * Se a imagem já existir, a API retorna imediatamente sem sobrescrever.
 * 
 * @param imageUrl - URL original da imagem (CPTEC, Argentina, etc.)
 * @param radarId - Slug do radar (ex: 'santiago', 'argentina:RMA1')
 * @param ts12 - Timestamp YYYYMMDDHHmm
 * @param productType - 'reflectividade' | 'velocidade'
 */
export function cacheRadarImage(
  imageUrl: string,
  radarId: string,
  ts12: string,
  productType: 'reflectividade' | 'velocidade' = 'reflectividade'
): void {
  // Não tenta cachear URLs do próprio Storage (já está cacheado)
  if (imageUrl.includes('firebasestorage.googleapis.com')) return;
  // Não tenta cachear data: URLs
  if (imageUrl.startsWith('data:')) return;
  // Não tenta cachear URLs de proxy local (extrai a URL original)
  let actualUrl = imageUrl;
  if (imageUrl.includes('/api/radar-proxy?url=')) {
    try {
      const parsed = new URL(imageUrl, window.location.origin);
      actualUrl = parsed.searchParams.get('url') || imageUrl;
    } catch {
      // mantém a URL original
    }
  }

  // Fire-and-forget
  fetch('/api/radar-cache', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageUrl: actualUrl, radarId, ts12, productType }),
  }).catch(() => {
    // Silencioso — cache é best-effort
  });
}

/**
 * Retorna a URL pública esperada no Firebase Storage para a imagem de radar.
 * Utilizada como último fallback se a fonte primária (CPTEC/Redemet) falhar.
 */
export function getRadarBackupUrl(
  radarId: string,
  ts12: string,
  productType: 'reflectividade' | 'velocidade' = 'reflectividade'
): string {
  return `/api/radar-storage-fallback?radarId=${encodeURIComponent(radarId)}&ts12=${encodeURIComponent(ts12)}`;
}
