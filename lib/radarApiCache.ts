/**
 * Cache em memória para rotas de API (JSON) do radar (Storage, Redemet, etc).
 * Evita chamadas repetidas ao servidor durante a animação e elimina atrasos de rede
 * que causam perda de frames (quando fetch demora mais que o intervalo do player).
 */

const apiCache = new Map<string, any>();
const inFlight = new Map<string, Promise<any>>();

export async function fetchRadarApiCached(url: string, signal?: AbortSignal): Promise<any> {
  if (apiCache.has(url)) {
    return apiCache.get(url);
  }

  if (inFlight.has(url)) {
    return inFlight.get(url);
  }

  const promise = (async () => {
    try {
      const res = await fetch(url, { signal });
      const data = await res.json().catch(() => null);
      apiCache.set(url, data);
      return data;
    } catch (err) {
      if (signal?.aborted) throw err;
      // Se deu erro de rede (não abort), cacheia como null para não travar próximos frames tentando a mesma URL falha.
      apiCache.set(url, null);
      return null;
    } finally {
      inFlight.delete(url);
    }
  })();

  inFlight.set(url, promise);
  return promise;
}
