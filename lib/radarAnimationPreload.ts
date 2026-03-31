/**
 * Pré-carrega URLs de imagens de radar (Storage + fallbacks) para animação fluida.
 * Espelha a ordem do motor em addRadarOverlaysMapLibre (Storage primeiro, depois link).
 */

import {
  type CptecRadarStation,
  buildNowcastingPngUrl,
  buildSipamHdPngUrl,
  floorTimestampToInterval,
  getNearestRadarTimestamp,
  subtractMinutesFromTimestamp12UTC,
  getNowMinusMinutesTimestamp12UTC,
} from '@/lib/cptecRadarStations';
import type { ArgentinaRadarStation } from '@/lib/argentinaRadarStations';
import { buildArgentinaRadarPngUrl, getArgentinaRadarTimestamp } from '@/lib/argentinaRadarStations';
import { getRedemetArea, hasRedemetFallback } from '@/lib/redemetRadar';

export type PreloadDisplayRadar =
  | { type: 'cptec'; station: CptecRadarStation }
  | { type: 'argentina'; station: ArgentinaRadarStation };

export type RadarProductPreload = 'reflectividade' | 'velocidade' | 'vil' | 'waldvogel';

/**
 * Busca URLs no Storage para animação: tenta vários IDs (slug, id FUNCEME, sipamSlug)
 * e, para IPMET, a rota dedicada (layout ipmet-bauru/ fora de radar_backup/).
 */
async function fetchRadarStorageUrls(
  dr: PreloadDisplayRadar,
  exactTs12: string,
  productType: RadarProductPreload,
  signal?: AbortSignal,
  isPast?: boolean
): Promise<string[]> {
  const found = new Set<string>();
  const slug = dr.type === 'cptec' ? dr.station.slug : `argentina:${dr.station.id}`;
  const radarIds = Array.from(new Set<string>([slug]));

  if (dr.type === 'cptec') {
    const s = dr.station;
    if (s.org === 'funceme') {
      radarIds.push(s.id);
      if (s.funcemeId) radarIds.push(s.funcemeId);
    }
    if (s.sipamSlug) {
      radarIds.push(s.sipamSlug);
    }
  }

  for (const radarId of radarIds) {
    try {
      const maxDiff = 15; // Pré-carregamento sempre de animação (preciso)
      const res = await fetch(
        `/api/radar-storage-fallback?radarId=${encodeURIComponent(radarId)}&ts12=${encodeURIComponent(exactTs12)}&productType=${productType}&maxDiff=${maxDiff}`,
        { signal }
      );
      const data = await res.json().catch(() => null);
      if (data?.url) found.add(data.url);
    } catch {
      /* abort */
    }
  }

  if (dr.type === 'cptec' && dr.station.slug === 'ipmet-bauru') {
    try {
      const maxDiff = 15;
      const res = await fetch(`/api/ipmet-storage-url?ts12=${encodeURIComponent(exactTs12)}&maxDiff=${maxDiff}`, { signal });
      const data = await res.json().catch(() => null);
      if (data?.url) found.add(data.url);
    } catch {
      /* abort */
    }
  }

  return Array.from(found);
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

/** Lista URLs a aquecer no cache (Storage + fontes públicas), na ordem de tentativa do overlay. */
export async function collectRadarPreloadUrls(
  dr: PreloadDisplayRadar,
  nominalTs12: string,
  productType: RadarProductPreload,
  radarSourceMode: 'superres' | 'hd',
  signal?: AbortSignal,
  isPast?: boolean
): Promise<string[]> {
  const urls: string[] = [];
  const slug = dr.type === 'cptec' ? dr.station.slug : `argentina:${dr.station.id}`;
  const radarInterval =
    dr.type === 'cptec'
      ? dr.station.updateIntervalMinutes ?? 10
      : (dr.station as ArgentinaRadarStation).updateIntervalMinutes;
  const exactTs12 = floorTimestampToInterval(nominalTs12, radarInterval);
  const targetDate = new Date(
    Date.UTC(
      parseInt(exactTs12.slice(0, 4), 10),
      parseInt(exactTs12.slice(4, 6), 10) - 1,
      parseInt(exactTs12.slice(6, 8), 10),
      parseInt(exactTs12.slice(8, 10), 10),
      parseInt(exactTs12.slice(10, 12), 10)
    )
  );
  const isHistorical = Date.now() - targetDate.getTime() > 48 * 60 * 60 * 1000;

  const pushIf = (u: string | '') => {
    if (u && !urls.includes(u)) urls.push(u);
  };

  const storageUrls = await fetchRadarStorageUrls(dr, exactTs12, productType, signal, isPast);
  storageUrls.forEach((u) => pushIf(u));

  if (['usp-starnet', 'ipmet-bauru', 'climatempo-poa'].includes(slug) && dr.type === 'cptec') {
    if (!isPast) pushIf(buildNowcastingPngUrl(dr.station, exactTs12, productType, true));
    return urls.map(proxied);
  }

  if (isHistorical) {
    if (dr.type === 'argentina') {
      const argTs = getArgentinaRadarTimestamp(targetDate, dr.station);
      pushIf(buildArgentinaRadarPngUrl(dr.station, argTs, productType));
      return urls.map(proxied);
    }
    if (dr.type === 'cptec' && getRedemetArea(slug)) {
      const st = dr.station as CptecRadarStation;
      const area = getRedemetArea(st.slug);
      if (area) {
        const tsRed = getNearestRadarTimestamp(nominalTs12, st);
        try {
          const res = await fetch(
            `/api/radar-redemet-find?area=${encodeURIComponent(area)}&ts12=${encodeURIComponent(tsRed)}&historical=true`,
            { signal }
          );
          const data = await res.json().catch(() => null);
          if (data?.url) pushIf(data.url);
        } catch {
          /* ignore */
        }
      }
      return urls.map(proxied);
    }
    return urls.map(proxied);
  }

  if (dr.type === 'argentina') {
    const argTs = getArgentinaRadarTimestamp(targetDate, dr.station);
    pushIf(buildArgentinaRadarPngUrl(dr.station, argTs, productType));
    return urls.map(proxied);
  }

  if (dr.type === 'cptec' && dr.station.slug === 'chapeco') {
    const radarId = productType === 'velocidade' ? dr.station.velocityId || dr.station.id : dr.station.id;
    pushIf(`/api/nowcasting/chapeco?radarId=${radarId}&timestamp=${exactTs12}`);
    const st = dr.station;
    const wantRedemet = radarSourceMode === 'hd' || (hasRedemetFallback(st.slug) && productType === 'reflectividade');
    const area = wantRedemet ? getRedemetArea(st.slug) : null;
    if (area) {
      const tsRed = getNearestRadarTimestamp(nominalTs12, st);
      try {
        const res = await fetch(
          `/api/radar-redemet-find?area=${encodeURIComponent(area)}&ts12=${encodeURIComponent(tsRed)}`,
          { signal }
        );
        const data = await res.json().catch(() => null);
        if (data?.url) pushIf(data.url);
      } catch {
        /* ignore */
      }
    }
    return urls.map(proxied);
  }

  if (dr.type === 'cptec' && dr.station.org === 'funceme') {
    if (!isPast) {
      const funcemeId = (dr.station as CptecRadarStation).funcemeId || dr.station.id;
      pushIf(`/api/funceme/image?radar=${encodeURIComponent(funcemeId)}&produto=${productType}&timestamp=${exactTs12}`);
    }
    return urls.map(proxied);
  }

  if (dr.type === 'cptec' && radarSourceMode === 'hd' && dr.station.sipamSlug) {
    if (!isPast) {
      const ns = getNearestRadarTimestamp(nominalTs12, dr.station);
      const sipProd = productType === 'velocidade' ? 'velocidade' : 'reflectividade';
      pushIf(buildSipamHdPngUrl(dr.station.sipamSlug, ns, sipProd));
      const st = dr.station;
      const wantRedemet = hasRedemetFallback(st.slug) && productType === 'reflectividade';
      const area = wantRedemet ? getRedemetArea(st.slug) : null;
      if (area) {
        const tsRed = getNearestRadarTimestamp(nominalTs12, st);
        try {
          const res = await fetch(
            `/api/radar-redemet-find?area=${encodeURIComponent(area)}&ts12=${encodeURIComponent(tsRed)}`,
            { signal }
          );
          const data = await res.json().catch(() => null);
          if (data?.url) pushIf(data.url);
        } catch {
          /* ignore */
        }
      }
    }
    return urls.map(proxied);
  }

  if (radarSourceMode !== 'hd') {
    if (!(isPast && dr.type === 'cptec' && (dr.station as CptecRadarStation).org === 'sipam')) {
      pushIf(buildNowcastingPngUrl(dr.station, exactTs12, productType, true));
      if (dr.type === 'cptec') {
        const st = dr.station as CptecRadarStation;
        if (st.org === 'funceme' && !isPast) {
          const funcemeId = st.funcemeId || st.id;
          pushIf(`/api/funceme/image?radar=${encodeURIComponent(funcemeId)}&produto=${productType}&timestamp=${exactTs12}`);
        }
        const wantRedemet = hasRedemetFallback(st.slug) && productType === 'reflectividade';
        const area = wantRedemet ? getRedemetArea(st.slug) : null;
        if (area) {
          const tsRed = getNearestRadarTimestamp(nominalTs12, st);
          try {
            const res = await fetch(
              `/api/radar-redemet-find?area=${encodeURIComponent(area)}&ts12=${encodeURIComponent(tsRed)}`,
              { signal }
            );
            const data = await res.json().catch(() => null);
            if (data?.url) pushIf(data.url);
          } catch {
            /* ignore */
          }
        }
      }
    }
    return urls.map(proxied);
  }

  if (dr.type === 'cptec') {
    if (!(isPast && (dr.station as CptecRadarStation).org === 'sipam')) {
      const st = dr.station as CptecRadarStation;
      const wantRedemet = radarSourceMode === 'hd' || (hasRedemetFallback(st.slug) && productType === 'reflectividade');
      const area = wantRedemet ? getRedemetArea(st.slug) : null;
      if (area) {
        const tsRed = getNearestRadarTimestamp(nominalTs12, st);
        try {
          const res = await fetch(
            `/api/radar-redemet-find?area=${encodeURIComponent(area)}&ts12=${encodeURIComponent(tsRed)}`,
            { signal }
          );
          const data = await res.json().catch(() => null);
          if (data?.url) pushIf(data.url);
        } catch {
          /* ignore */
        }
      }
    }
  }
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
        const urls = await collectRadarPreloadUrls(dr, nominal, product, radarSourceMode, signal, isPast);
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
