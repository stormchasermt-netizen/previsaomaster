/**
 * Pré-carrega URLs de imagens de radar (Storage + fallbacks) para animação fluida.
 * Espelha a ordem do motor em addRadarOverlaysMapLibre (Storage primeiro, depois link).
 */

import {
  type CptecRadarStation,
  buildNowcastingPngUrl,
  floorTimestampToInterval,
  subtractMinutesFromTimestamp12UTC,
  getNowMinusMinutesTimestamp12UTC,
} from '@/lib/cptecRadarStationsV2';

export type PreloadDisplayRadar = { type: 'cptec'; station: CptecRadarStation };

export type RadarProductPreload = 'reflectividade' | 'velocidade' | 'vil' | 'waldvogel';

/**
 * Busca URLs no Storage para animação
 */
async function fetchRadarStorageUrls(
  dr: PreloadDisplayRadar,
  exactTs12: string,
  productType: RadarProductPreload,
  signal?: AbortSignal,
  isPast?: boolean
): Promise<string[]> {
  // Desativando fallback para o storage na ao-vivo-2
  return [];
}

function proxied(url: string): string {
  if (typeof window === 'undefined') return url;
  if (url.startsWith('/api/')) return url;
  return `/api/radar-proxy?url=${encodeURIComponent(url)}`;
}

/** Timestamp nominal do frame (mesma base que radarTimestamp com slider no ao-vivo). */
export function getNominalTimestampForAnimationFrameStatic(
  minutesAgo: number,
  historicalTimestampOverride: string | null | undefined
): string {
  if (historicalTimestampOverride) {
    if (minutesAgo === 0) return historicalTimestampOverride;
    return subtractMinutesFromTimestamp12UTC(historicalTimestampOverride, minutesAgo);
  }
  return getNowMinusMinutesTimestamp12UTC(3 + minutesAgo);
}

export async function collectRadarPreloadUrls(
  dr: PreloadDisplayRadar,
  nominalTs12: string,
  productType: RadarProductPreload,
  radarSourceMode: 'super-res' | 'hd' = 'super-res',
  signal?: AbortSignal,
  isPast?: boolean
): Promise<string[]> {
  const urls: string[] = [];
  const exactTs12 = floorTimestampToInterval(
    nominalTs12,
    dr.station.updateIntervalMinutes ?? 10
  );

  const pushIf = (u: string | '') => {
    if (u && !urls.includes(u)) urls.push(u);
  };

  const storageUrls = await fetchRadarStorageUrls(dr, exactTs12, productType, signal, isPast);
  storageUrls.forEach((u) => pushIf(u));

  const cptecUrl = buildNowcastingPngUrl(dr.station, exactTs12, productType, false);
  pushIf(cptecUrl);

  return urls.map(proxied);
}

async function prefetchOne(url: string, signal?: AbortSignal): Promise<void> {
  try {
    const res = await fetch(url, { signal, cache: 'default' });
    await res.blob();
  } catch {
    /* ignora 404 / abort */
  }
}

export type PreloadAnimationOptions = {
  displayRadars: PreloadDisplayRadar[];
  minutesList: number[];
  products: RadarProductPreload[];
  historicalTimestampOverride: string | null | undefined;
  radarSourceMode: 'superres' | 'hd';
  onProgress: (ratio: number) => void;
  signal?: AbortSignal;
  concurrency?: number;
};

/** Aquece cache HTTP para todas as combinações (minuto × radar × produto). */
export async function preloadRadarAnimationFrames(opts: PreloadAnimationOptions): Promise<void> {
  const {
    displayRadars,
    minutesList,
    products,
    historicalTimestampOverride,
    radarSourceMode,
    onProgress,
    signal,
    concurrency = 6,
  } = opts;

  const tasks: string[] = [];
  const seen = new Set<string>();

  for (const m of minutesList) {
    const nominal = getNominalTimestampForAnimationFrameStatic(m, historicalTimestampOverride);
    for (const dr of displayRadars) {
      for (const product of products) {
        const isPast = m > 0 || !!historicalTimestampOverride;
        const urls = await collectRadarPreloadUrls(dr, nominal, product, radarSourceMode as any, signal, isPast);
        for (const u of urls) {
          if (!seen.has(u)) {
            seen.add(u);
            tasks.push(u);
          }
        }
      }
    }
  }

  const total = tasks.length;
  if (total === 0) {
    onProgress(1);
    return;
  }

  let idx = 0;
  let done = 0;
  const worker = async () => {
    while (idx < tasks.length) {
      const i = idx++;
      await prefetchOne(tasks[i], signal);
      done++;
      onProgress(done / total);
    }
  };

  const n = Math.min(concurrency, tasks.length);
  await Promise.all(Array.from({ length: n }, () => worker()));
  onProgress(1);
}
