/**
 * radarFallback.ts
 * 
 * Orquestra a cascata de fallback para imagens de radar:
 * 1. Nowcasting/CPTEC (timeout 15s)
 * 2. Redemet/DECEA (se disponível)
 * 3. Firebase Storage (radar_backup)
 */

import { hasRedemetFallback, getRedemetArea } from './redemetRadar';
import { getNowMinusMinutesTimestamp12UTC } from './cptecRadarStations';

export type RadarSource = 'cptec' | 'redemet' | 'storage';

export interface FallbackResult {
  url: string | null;
  source: RadarSource;
  isCached: boolean;
  /** Diferença em minutos entre a imagem encontrada e o timestamp solicitado (para Storage) */
  diffMinutes?: number;
}

const NOWCASTING_TIMEOUT_MS = 15_000;

/**
 * Tenta carregar a imagem do Nowcasting com timeout.
 * Retorna true se a imagem existir (status 200 e content-type image).
 */
async function tryNowcasting(proxyUrl: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), NOWCASTING_TIMEOUT_MS);

    const res = await fetch(`/api/radar-exists?url=${encodeURIComponent(proxyUrl)}`, {
      cache: 'no-store',
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const data = await res.json().catch(() => ({}));
    return data.exists === true;
  } catch {
    return false;
  }
}

/**
 * Tenta buscar imagem via Redemet (plota_radar.php).
 * Retorna a URL da imagem se encontrada.
 */
async function tryRedemet(slug: string, ts12: string): Promise<string | null> {
  const area = getRedemetArea(slug);
  if (!area) return null;

  try {
    const res = await fetch(
      `/api/radar-redemet-find?area=${encodeURIComponent(area)}&ts12=${encodeURIComponent(ts12)}`,
      { cache: 'no-store' }
    );
    const data = await res.json().catch(() => ({}));
    return data.url || null;
  } catch {
    return null;
  }
}

/**
 * Tenta buscar imagem no Firebase Storage (radar_backup).
 * Retorna a URL e a diferença em minutos.
 */
async function tryStorage(radarId: string, ts12: string): Promise<{ url: string | null; diffMinutes?: number }> {
  try {
    const res = await fetch(
      `/api/radar-storage-fallback?radarId=${encodeURIComponent(radarId)}&ts12=${encodeURIComponent(ts12)}`,
      { cache: 'no-store' }
    );
    const data = await res.json().catch(() => ({}));
    return { url: data.url || null, diffMinutes: data.diffMinutes };
  } catch {
    return { url: null };
  }
}

/**
 * Executa a cascata de fallback completa para um radar.
 * 
 * @param nowcastingUrl - URL original do Nowcasting (já proxiada ou direta)
 * @param slug - Slug do radar CPTEC (ex: 'santiago', 'saoroque')
 * @param ts12 - Timestamp no formato YYYYMMDDHHmm
 * @param minutesAgo - Minutos atrás do ao vivo (0 = agora)
 */
export async function fetchWithFallback(
  nowcastingUrl: string,
  slug: string,
  ts12: string,
  minutesAgo: number = 0
): Promise<FallbackResult> {
  // 1. Tentar Nowcasting (timeout 15s)
  const nowcastingOk = await tryNowcasting(nowcastingUrl);
  if (nowcastingOk) {
    return { url: nowcastingUrl, source: 'cptec', isCached: false };
  }

  // 2. Tentar Redemet (se disponível para este radar)
  if (hasRedemetFallback(slug)) {
    const redemetUrl = await tryRedemet(slug, ts12);
    if (redemetUrl) {
      // Proxiar a URL do Redemet para evitar CORS
      const proxiedRedemet = `/api/radar-proxy?url=${encodeURIComponent(redemetUrl)}`;
      return { url: proxiedRedemet, source: 'redemet', isCached: false };
    }
  }

  // 3. Tentar Firebase Storage (última imagem cacheada)
  const storageResult = await tryStorage(slug, ts12);
  if (storageResult.url) {
    return {
      url: storageResult.url,
      source: 'storage',
      isCached: true,
      diffMinutes: storageResult.diffMinutes,
    };
  }

  // Nenhuma fonte disponível
  return { url: null, source: 'cptec', isCached: false };
}

/**
 * Verifica se o Nowcasting está offline.
 * Faz uma verificação rápida em um radar comum (Santiago) para detectar queda geral.
 */
export async function isNowcastingOffline(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);

    const testUrl = 'https://nowcasting.cptec.inpe.br/';
    const res = await fetch(`/api/radar-exists?url=${encodeURIComponent(testUrl)}`, {
      cache: 'no-store',
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const data = await res.json().catch(() => ({}));
    // Se o site principal não responde, o Nowcasting está offline
    return data.exists !== true;
  } catch {
    return true; // timeout = offline
  }
}
