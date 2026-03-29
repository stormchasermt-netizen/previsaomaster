/**
 * Pré-carrega imagens de radar no browser para reduzir flash ao animar (mosaico / único).
 * Usar antes de avançar o slider quando quiser sincronizar todos os radares.
 */
export function preloadRadarImage(url: string): Promise<void> {
  if (!url || url.includes('undefined')) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const img = new Image();
    // Não forçar crossOrigin: imagens via /api/radar-proxy são same-origin.
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('preload failed'));
    img.src = url;
  });
}

export async function preloadRadarImages(urls: string[], opts?: { concurrency?: number }): Promise<void> {
  const list = urls.filter(Boolean);
  const conc = Math.max(1, opts?.concurrency ?? 8);
  let i = 0;
  const workers = Array.from({ length: Math.min(conc, list.length) }, async () => {
    while (i < list.length) {
      const idx = i++;
      try {
        await preloadRadarImage(list[idx]);
      } catch {
        /* ignora falha isolada */
      }
    }
  });
  await Promise.all(workers);
}
