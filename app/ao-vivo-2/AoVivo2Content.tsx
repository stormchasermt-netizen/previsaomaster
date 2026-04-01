'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, Play, Pause, SkipBack, SkipForward } from 'lucide-react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { CPTEC_RADAR_STATIONS, getRadarImageBounds, type CptecRadarStation } from '@/lib/cptecRadarStations';
import { filterClimatempoRadarImage } from '@/lib/radarImageFilter';

const MAPTILER_KEY = 'WyOGmI7ufyBLH3G7aX9o';
const SAT_STYLE = `https://api.maptiler.com/maps/hybrid-v4/style.json?key=${MAPTILER_KEY}`;

/** Mesmos URLs que em app/ao-vivo/page.tsx */
const RADAR_ICON_AVAILABLE =
  'https://raw.githubusercontent.com/stormchasermt-netizen/previsaomaster/7e352d326e59aa65efc40ce2979d5a078a393dc4/radar-icon-svg-download-png-8993769.webp';
const RADAR_ICON_UNAVAILABLE =
  'https://raw.githubusercontent.com/stormchasermt-netizen/previsaomaster/7e352d326e59aa65efc40ce2979d5a078a393dc4/radar-icon-svg-download-png-8993769.webp';

export type RadarProductMode = 'ppi' | 'doppler';

function findCptecBySlug(slug: string): CptecRadarStation | undefined {
  return CPTEC_RADAR_STATIONS.find((s) => s.slug === slug);
}

function imageCoordinatesFromBounds(bounds: ReturnType<typeof getRadarImageBounds>): [
  [number, number],
  [number, number],
  [number, number],
  [number, number],
] {
  return [
    [bounds.west, bounds.north],
    [bounds.east, bounds.north],
    [bounds.east, bounds.south],
    [bounds.west, bounds.south],
  ];
}

function absoluteUrl(path: string): string {
  if (typeof window === 'undefined') return path;
  if (path.startsWith('http')) return path;
  return `${window.location.origin}${path}`;
}

function extractTsFromFilename(name: string, product: RadarProductMode): string | null {
  if (product === 'ppi') {
    const m = name.match(/^(\d{12})\.(png|jpg|jpeg|gif)$/i);
    return m ? m[1] : null;
  }
  const m = name.match(/^(\d{12})-ppivr\.(png|jpg|jpeg|gif)$/i);
  return m ? m[1] : null;
}

/** Horários extraídos só de nomes de ficheiro válidos (o que existe no cache listado). */
function collectSortedTimesFromImages(
  imgs: { name: string; url: string }[],
  product: RadarProductMode
): string[] {
  const set = new Set<string>();
  for (const im of imgs) {
    const ts = extractTsFromFilename(im.name, product);
    if (ts) set.add(ts);
  }
  return Array.from(set).sort();
}

const ONE_HOUR_MS = 60 * 60 * 1000;
const SYNC_TOLERANCE_MS = 10 * 60 * 1000;

function ts12ToUtcMs(ts: string): number {
  const y = +ts.slice(0, 4);
  const mo = +ts.slice(4, 6) - 1;
  const d = +ts.slice(6, 8);
  const h = +ts.slice(8, 10);
  const mi = +ts.slice(10, 12);
  return Date.UTC(y, mo, d, h, mi, 0, 0);
}

/** Último ts (ordenado asc) com tsMs <= targetMs; null se não houver. */
function lastTsAtOrBefore(sortedTs: string[], targetMs: number): string | null {
  let best: string | null = null;
  let bestMs = -Infinity;
  for (const ts of sortedTs) {
    const ms = ts12ToUtcMs(ts);
    if (ms <= targetMs && ms >= bestMs) {
      bestMs = ms;
      best = ts;
    }
  }
  return best;
}

/** Entre os ts ordenados, escolhe o mais próximo de targetMs dentro de ±tolMs. */
function pickClosestWithinTolerance(sortedTs: string[], targetMs: number, tolMs: number): string | null {
  let best: string | null = null;
  let bestDiff = Infinity;
  for (const ts of sortedTs) {
    const ms = ts12ToUtcMs(ts);
    const diff = Math.abs(ms - targetMs);
    if (diff <= tolMs && diff < bestDiff) {
      bestDiff = diff;
      best = ts;
    }
  }
  return best;
}

type MosaicSyncFrame = {
  masterTs: string;
  /** URL da imagem a mostrar por radar (já com sticky / hold aplicados). */
  urlBySlug: Record<string, string>;
};

type MosaicSyncPlan = {
  leaderSlug: string;
  masterTimes: string[];
  frames: MosaicSyncFrame[];
};

/**
 * Mosaico: última hora de dados (até o ts mais recente no bucket), timeline = instantes do radar com mais imagens nessa janela;
 * outros radares: match ±10 min ao instante líder; senão mantêm a imagem já mostrada (ou a mais recente ≤ instante no 1.º frame).
 */
function buildMosaicSyncPlan(
  imagesByStation: Record<string, { name: string; url: string }[]>,
  slugs: string[],
  product: RadarProductMode
): MosaicSyncPlan | null {
  const lookups: Record<string, Map<string, { name: string; url: string }>> = {};
  const allTs: string[] = [];
  for (const slug of slugs) {
    lookups[slug] = buildTsLookup(imagesByStation[slug] || [], product);
    for (const ts of lookups[slug].keys()) allTs.push(ts);
  }
  if (allTs.length === 0) return null;

  const tMaxMs = Math.max(...allTs.map(ts12ToUtcMs));
  const tMinMs = tMaxMs - ONE_HOUR_MS;

  const tsInHour: Record<string, string[]> = {};
  let bestSlug = slugs[0];
  let bestCount = -1;
  for (const slug of slugs) {
    const sorted = Array.from(lookups[slug].keys()).sort();
    const inWin = sorted.filter((ts) => {
      const ms = ts12ToUtcMs(ts);
      return ms >= tMinMs && ms <= tMaxMs;
    });
    tsInHour[slug] = inWin;
    if (inWin.length > bestCount) {
      bestCount = inWin.length;
      bestSlug = slug;
    }
  }

  const masterTimes = tsInHour[bestSlug] || [];
  if (masterTimes.length === 0) return null;

  const lastUrl: Record<string, string> = {};
  const frames: MosaicSyncFrame[] = [];

  for (const masterTs of masterTimes) {
    const targetMs = ts12ToUtcMs(masterTs);
    const urlBySlug: Record<string, string> = {};

    for (const slug of slugs) {
      const map = lookups[slug];
      const sorted = tsInHour[slug];

      if (slug === bestSlug) {
        const img = map.get(masterTs);
        if (img) {
          urlBySlug[slug] = img.url;
          lastUrl[slug] = img.url;
        }
        continue;
      }

      const match = pickClosestWithinTolerance(sorted, targetMs, SYNC_TOLERANCE_MS);
      if (match !== null) {
        const img = map.get(match)!;
        urlBySlug[slug] = img.url;
        lastUrl[slug] = img.url;
      } else if (lastUrl[slug]) {
        urlBySlug[slug] = lastUrl[slug];
      } else {
        const holdTs = lastTsAtOrBefore(sorted, targetMs);
        if (holdTs !== null) {
          const img = map.get(holdTs)!;
          urlBySlug[slug] = img.url;
          lastUrl[slug] = img.url;
        }
      }
    }

    frames.push({ masterTs, urlBySlug });
  }

  return { leaderSlug: bestSlug, masterTimes, frames };
}

function buildTsLookup(
  imgs: { name: string; url: string }[],
  product: RadarProductMode
): Map<string, { name: string; url: string }> {
  const m = new Map<string, { name: string; url: string }>();
  for (const im of imgs) {
    const ts = extractTsFromFilename(im.name, product);
    if (ts) m.set(ts, im);
  }
  return m;
}

function mergeFitBounds(slugs: string[]): [[number, number], [number, number]] | null {
  const stations = slugs.map((s) => findCptecBySlug(s)).filter(Boolean) as CptecRadarStation[];
  if (stations.length === 0) return null;
  let w = Infinity,
    e = -Infinity,
    s = Infinity,
    n = -Infinity;
  for (const st of stations) {
    const b = getRadarImageBounds(st);
    w = Math.min(w, b.west);
    e = Math.max(e, b.east);
    s = Math.min(s, b.south);
    n = Math.max(n, b.north);
  }
  return [
    [w, s],
    [e, n],
  ];
}

function sourceId(slug: string) {
  return `radar-aovivo2-src-${slug}`;
}
function layerId(slug: string) {
  return `radar-aovivo2-layer-${slug}`;
}

export default function AoVivo2Content() {
  const [stations, setStations] = useState<string[]>([]);
  const [product, setProduct] = useState<RadarProductMode>('ppi');
  const [imagesByStation, setImagesByStation] = useState<Record<string, { name: string; url: string }[]>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [playSpeed] = useState(300);

  const [focusedSlug, setFocusedSlug] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const radarMarkersRef = useRef<maplibregl.Marker[]>([]);
  const preloadedUrlsRef = useRef<Set<string>>(new Set());
  const layerUpdateGenerationRef = useRef(0);
  const timelineJumpToLatestRef = useRef(true);
  const prevTimelineLenRef = useRef(0);

  const stationsWithBounds = useMemo(
    () => stations.filter((s) => Boolean(findCptecBySlug(s))).sort(),
    [stations]
  );

  const lookups = useMemo(() => {
    const out: Record<string, Map<string, { name: string; url: string }>> = {};
    for (const slug of Object.keys(imagesByStation)) {
      out[slug] = buildTsLookup(imagesByStation[slug] || [], product);
    }
    return out;
  }, [imagesByStation, product]);

  /** Mosaico: última hora + sincronização (radar líder, ±10 min, sticky). */
  const mosaicSync = useMemo(() => {
    if (focusedSlug) return null;
    return buildMosaicSyncPlan(imagesByStation, stationsWithBounds, product);
  }, [focusedSlug, imagesByStation, product, stationsWithBounds]);

  /**
   * Slider: foco = todos os instantes daquele radar; mosaico = instantes do radar líder na última hora.
   */
  const timelineTimes = useMemo(() => {
    if (focusedSlug) {
      return collectSortedTimesFromImages(imagesByStation[focusedSlug] || [], product);
    }
    return mosaicSync?.masterTimes ?? [];
  }, [focusedSlug, imagesByStation, product, mosaicSync]);

  const safeIndex = timelineTimes.length > 0 ? Math.min(currentIndex, timelineTimes.length - 1) : 0;
  const currentTs = timelineTimes[safeIndex] ?? null;

  const mosaicFrameAtIndex = useMemo(() => {
    if (focusedSlug || !mosaicSync?.frames.length) return null;
    const i = Math.min(safeIndex, mosaicSync.frames.length - 1);
    return mosaicSync.frames[i] ?? null;
  }, [focusedSlug, mosaicSync, safeIndex]);

  const hasAnyStationImages = useMemo(
    () => Object.values(imagesByStation).some((imgs) => imgs.length > 0),
    [imagesByStation]
  );

  const displaySlugs = useMemo(() => {
    if (focusedSlug) return [focusedSlug].filter((s) => stationsWithBounds.includes(s));
    return stationsWithBounds;
  }, [focusedSlug, stationsWithBounds]);

  useEffect(() => {
    setIsLoading(true);
    setError(null);
    fetch('/api/radar-ao-vivo2?action=listStations')
      .then(async (r) => {
        const data = (await r.json()) as { stations?: string[]; error?: string };
        if (!r.ok) throw new Error(data.error || `Erro ${r.status} ao listar pastas`);
        setStations(data.stations || []);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    if (stationsWithBounds.length === 0) {
      setImagesByStation({});
      setCurrentIndex(0);
      timelineJumpToLatestRef.current = true;
      return;
    }

    setIsLoading(true);
    setError(null);
    timelineJumpToLatestRef.current = true;

    const productParam = product === 'doppler' ? 'doppler' : 'ppi';

    Promise.all(
      stationsWithBounds.map((slug) =>
        fetch(`/api/radar-ao-vivo2?action=listImages&station=${encodeURIComponent(slug)}&product=${productParam}`)
          .then(async (r) => {
            const data = (await r.json()) as { images?: { name: string; url: string }[]; error?: string };
            if (!r.ok) throw new Error(data.error || slug);
            return { slug, images: data.images || [] };
          })
          .catch(() => ({ slug, images: [] as { name: string; url: string }[] }))
      )
    )
      .then((rows) => {
        const next: Record<string, { name: string; url: string }[]> = {};
        for (const { slug, images } of rows) next[slug] = images;
        setImagesByStation(next);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setIsLoading(false));
  }, [stationsWithBounds, product]);

  /** Novo produto ou dados recarregados: ir para o último frame disponível na timeline derivada. */
  useEffect(() => {
    if (!timelineJumpToLatestRef.current) return;
    if (timelineTimes.length === 0) {
      setCurrentIndex(0);
      return;
    }
    setCurrentIndex(timelineTimes.length - 1);
    timelineJumpToLatestRef.current = false;
  }, [timelineTimes]);

  /** Ao mudar o foco (ou voltar ao mosaico), alinha no último instante da timeline atual (derivada por radar ou união). */
  useEffect(() => {
    if (timelineTimes.length === 0) {
      setCurrentIndex(0);
      return;
    }
    setCurrentIndex(timelineTimes.length - 1);
  }, [focusedSlug]);

  /** Só ajusta índice quando a timeline encolhe (evita sobrescrever “último frame” ao passar de 0 → N). */
  useEffect(() => {
    const len = timelineTimes.length;
    if (len === 0) {
      setCurrentIndex(0);
      prevTimelineLenRef.current = 0;
      return;
    }
    if (prevTimelineLenRef.current > len) {
      setCurrentIndex((i) => Math.min(i, len - 1));
    }
    prevTimelineLenRef.current = len;
  }, [timelineTimes.length]);

  /** Mapa: uma vez com vista Brasil; depois fit bounds */
  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container) return;

    if (mapRef.current) return;

    const map = new maplibregl.Map({
      container,
      style: SAT_STYLE,
      center: [-51, -22],
      zoom: 4,
    });
    map.on('load', () => setMapReady(true));
    mapRef.current = map;

    return () => {
      setMapReady(false);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  /** Ajusta enquadramento */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const slugs = focusedSlug ? [focusedSlug] : stationsWithBounds;
    const b = mergeFitBounds(slugs);
    if (!b) return;
    map.fitBounds(b, { padding: focusedSlug ? 56 : 80, duration: 500 });
  }, [mapReady, focusedSlug, stationsWithBounds]);

  /** Marcadores (ícones como ao-vivo-1) */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    radarMarkersRef.current.forEach((m) => m.remove());
    radarMarkersRef.current = [];

    for (const slug of stationsWithBounds) {
      const st = findCptecBySlug(slug);
      if (!st) continue;
      const hasAny = (imagesByStation[slug]?.length ?? 0) > 0;

      const el = document.createElement('div');
      el.className = 'w-8 h-8 cursor-pointer';
      if (hasAny) {
        el.innerHTML = `
          <div class="relative flex items-center justify-center w-full h-full transition-transform hover:scale-125">
            <div class="absolute inset-0 rounded-full bg-cyan-500/20 animate-ping" style="animation-duration: 2.5s;"></div>
            <img src="${RADAR_ICON_AVAILABLE}" alt="Radar On" class="w-8 h-8 object-contain drop-shadow-[0_0_8px_rgba(34,211,238,0.8)]" />
          </div>
        `;
      } else {
        el.innerHTML = `
          <div class="relative flex items-center justify-center w-full h-full opacity-50 transition-transform hover:scale-110 grayscale">
            <img src="${RADAR_ICON_UNAVAILABLE}" alt="Radar Off" class="w-8 h-8 object-contain" />
          </div>
        `;
      }

      const marker = new maplibregl.Marker({ element: el }).setLngLat([st.lng, st.lat]).addTo(map);
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        setFocusedSlug((prev) => (prev === slug ? null : slug));
      });
      radarMarkersRef.current.push(marker);
    }

    return () => {
      radarMarkersRef.current.forEach((m) => m.remove());
      radarMarkersRef.current = [];
    };
  }, [mapReady, stationsWithBounds, imagesByStation, focusedSlug]);

  /** Camadas raster por radar — troca com raster-fade-duration para transição suave */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    if (focusedSlug && !currentTs) return;
    if (!focusedSlug && !mosaicFrameAtIndex) return;

    const gen = ++layerUpdateGenerationRef.current;

    const applyLayer = (slug: string, url: string | null) => {
      const st = findCptecBySlug(slug);
      if (!st) return;
      const bounds = getRadarImageBounds(st);
      const coordinates = imageCoordinatesFromBounds(bounds);
      const sid = sourceId(slug);
      const lid = layerId(slug);

      if (!url) {
        if (map.getLayer(lid)) {
          map.setPaintProperty(lid, 'raster-opacity', 0);
        }
        return;
      }

      const run = (finalUrl: string) => {
        if (gen !== layerUpdateGenerationRef.current) return;
        const apply = () => {
          if (gen !== layerUpdateGenerationRef.current) return;
          const src = map.getSource(sid) as maplibregl.ImageSource | undefined;
          if (src && typeof src.updateImage === 'function') {
            src.updateImage({ url: finalUrl, coordinates });
            if (map.getLayer(lid)) {
              map.setPaintProperty(lid, 'raster-opacity', 0.88);
              map.setLayoutProperty(lid, 'visibility', 'visible');
            }
          } else {
            if (map.getLayer(lid)) map.removeLayer(lid);
            if (map.getSource(sid)) map.removeSource(sid);
            map.addSource(sid, { type: 'image', url: finalUrl, coordinates });
            map.addLayer({
              id: lid,
              type: 'raster',
              source: sid,
              paint: {
                'raster-opacity': 0.88,
                'raster-fade-duration': 200,
              },
            });
          }
        };
        if (!map.isStyleLoaded()) map.once('load', apply);
        else apply();
      };

      void (async () => {
        const base = absoluteUrl(url);
        if (slug === 'climatempo-poa') {
          const filtered = await filterClimatempoRadarImage(base);
          if (gen !== layerUpdateGenerationRef.current) return;
          run(filtered ?? base);
        } else {
          run(base);
        }
      })();
    };

    for (const slug of stationsWithBounds) {
      const inDisplay = displaySlugs.includes(slug);
      if (!inDisplay) {
        const lid = layerId(slug);
        if (map.getLayer(lid)) map.setPaintProperty(lid, 'raster-opacity', 0);
        continue;
      }
      const rawUrl = focusedSlug
        ? lookups[slug]?.get(currentTs!)?.url
        : mosaicFrameAtIndex?.urlBySlug[slug];
      applyLayer(slug, rawUrl ?? null);
    }
  }, [mapReady, currentTs, lookups, displaySlugs, stationsWithBounds, focusedSlug, mosaicFrameAtIndex]);

  /** Pré-carrega frames vizinhos (como modelo numérico — menos flicker) */
  useEffect(() => {
    if (timelineTimes.length === 0) return;
    const si = safeIndex;
    const n = timelineTimes.length;
    const indices = [si, (si + 1) % n, (si - 1 + n) % n];
    const urls = new Set<string>();
    if (focusedSlug) {
      for (const idx of indices) {
        const ts = timelineTimes[idx];
        if (!ts) continue;
        for (const slug of displaySlugs) {
          const u = lookups[slug]?.get(ts)?.url;
          if (u) urls.add(absoluteUrl(u));
        }
      }
    } else if (mosaicSync?.frames.length) {
      for (const idx of indices) {
        const f = mosaicSync.frames[idx];
        if (!f) continue;
        for (const u of Object.values(f.urlBySlug)) {
          urls.add(absoluteUrl(u));
        }
      }
    }
    urls.forEach((u) => {
      if (preloadedUrlsRef.current.has(u)) return;
      preloadedUrlsRef.current.add(u);
      const im = new window.Image();
      im.src = u;
    });
  }, [safeIndex, timelineTimes, displaySlugs, lookups, focusedSlug, mosaicSync?.frames]);

  useEffect(() => {
    if (!isPlaying || timelineTimes.length < 2) return;
    const t = setInterval(() => {
      setCurrentIndex((i) => {
        const n = timelineTimes.length;
        const si = Math.min(i, n - 1);
        return (si + 1) % n;
      });
    }, playSpeed);
    return () => clearInterval(t);
  }, [isPlaying, timelineTimes.length, playSpeed]);

  const togglePlay = () => setIsPlaying((p) => !p);
  const prevFrame = () => {
    setIsPlaying(false);
    setCurrentIndex((i) => {
      const n = timelineTimes.length;
      if (n === 0) return 0;
      const si = Math.min(i, n - 1);
      return (si - 1 + n) % n;
    });
  };
  const nextFrame = () => {
    setIsPlaying(false);
    setCurrentIndex((i) => {
      const n = timelineTimes.length;
      if (n === 0) return 0;
      const si = Math.min(i, n - 1);
      return (si + 1) % n;
    });
  };

  const showEmptyBucketHelp = stations.length === 0 && !isLoading && !error;
  const formatTsLabel = (ts: string) => {
    if (ts.length !== 12) return ts;
    return `${ts.slice(8, 10)}:${ts.slice(10, 12)}`;
  };

  const clearFocusButton = (
    <button
      type="button"
      onClick={() => setFocusedSlug(null)}
      className={`text-xs px-2 py-1 rounded border ${
        focusedSlug
          ? 'border-amber-500 text-amber-300 bg-amber-950/50 hover:bg-amber-900/50'
          : 'border-slate-700 text-slate-600 cursor-default'
      }`}
      disabled={!focusedSlug}
    >
      Mosaico (todos)
    </button>
  );

  return (
    <div className="flex flex-col h-[100dvh] bg-slate-950 text-white">
      <header className="flex items-center justify-between px-4 py-2 border-b border-slate-700 shrink-0 z-10">
        <Link href="/" className="flex items-center gap-2 text-slate-300 hover:text-white text-sm font-medium">
          <ChevronLeft className="w-5 h-5" />
          Início
        </Link>
        <h1 className="text-sm font-bold tracking-wide text-cyan-400">Ao vivo — cache (v2)</h1>
        <div className="w-20" />
      </header>

      <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-slate-800 shrink-0 bg-slate-900/90">
        <span className="text-xs text-slate-400 font-semibold">Produto</span>
        <div className="flex rounded-lg border border-slate-600 overflow-hidden">
          <button
            type="button"
            onClick={() => setProduct('ppi')}
            className={`px-3 py-1.5 text-xs font-bold ${
              product === 'ppi' ? 'bg-cyan-700 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            Refletividade
          </button>
          <button
            type="button"
            onClick={() => setProduct('doppler')}
            className={`px-3 py-1.5 text-xs font-bold border-l border-slate-600 ${
              product === 'doppler' ? 'bg-cyan-700 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            Doppler
          </button>
        </div>
        {clearFocusButton}
        {focusedSlug && (
          <span className="text-xs text-amber-300">
            Foco: <strong>{findCptecBySlug(focusedSlug)?.name ?? focusedSlug}</strong> — clique no ícone de novo para voltar ao mosaico
          </span>
        )}
      </div>

      <div className="flex-1 relative min-h-0">
        {error && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60 p-4 text-center text-red-300 text-sm max-w-lg mx-auto">
            {error}
          </div>
        )}
        {isLoading && stations.length === 0 && !error && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-950/80">
            <div className="animate-spin rounded-full h-10 w-10 border-2 border-cyan-500 border-t-transparent" />
          </div>
        )}

        {showEmptyBucketHelp && (
          <div className="absolute inset-0 z-10 flex items-center justify-center p-6">
            <div className="max-w-md rounded-lg border border-slate-600 bg-slate-900/95 p-6 text-center text-slate-300 text-sm space-y-3">
              <p className="font-semibold text-cyan-400">Bucket vazio ou sem pastas</p>
              <p>
                Crie no GCS <code className="text-white">radar_ao_vivo_2</code> uma pasta por radar. Refletividade:{' '}
                <code className="text-cyan-300">chapeco/20251107120000.png</code> — Doppler:{' '}
                <code className="text-cyan-300">chapeco/20251107120000-ppivr.png</code>
              </p>
            </div>
          </div>
        )}

        {!showEmptyBucketHelp && !error && <div ref={mapContainerRef} className="absolute inset-0 w-full h-full" />}

        {isLoading && stations.length > 0 && (
          <div className="absolute inset-0 z-[5] flex items-center justify-center bg-slate-950/40 pointer-events-none">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-cyan-500 border-t-transparent" />
          </div>
        )}

        {timelineTimes.length === 0 && stationsWithBounds.length > 0 && !isLoading && !error && (
          <div className="absolute bottom-16 left-4 right-4 z-10 rounded-lg bg-black/70 border border-slate-600 p-4 text-sm text-slate-200">
            {!focusedSlug && hasAnyStationImages ? (
              <>
                Nenhuma imagem {product === 'ppi' ? 'PPI' : 'Doppler (-ppivr)'} na <strong className="text-white">última hora</strong> (relativa ao ficheiro mais recente no bucket) para montar o mosaico sincronizado.
              </>
            ) : (
              <>
                Nenhuma imagem {product === 'ppi' ? 'PPI' : 'Doppler (-ppivr)'} nas pastas do bucket para os radares listados.
              </>
            )}
          </div>
        )}
      </div>

      {timelineTimes.length > 0 && (
        <div className="border-t border-slate-700 bg-slate-900 shrink-0">
          <div className="overflow-x-auto border-b border-slate-800">
            <div className="flex w-max min-w-full">
              <div className="w-9 shrink-0 flex items-center justify-center py-1 text-[9px] font-bold text-slate-500 border-r border-slate-700 bg-slate-800/80 sticky left-0 z-[1]">
                UTC
              </div>
              {timelineTimes.map((ts, idx) => (
                <button
                  key={ts}
                  type="button"
                  onClick={() => {
                    setCurrentIndex(idx);
                    setIsPlaying(false);
                  }}
                  className={`w-[22px] shrink-0 text-center py-1 text-[10px] font-mono border-r border-slate-700 last:border-0 transition-colors ${
                    idx === safeIndex
                      ? 'bg-cyan-800 text-white font-bold'
                      : 'text-slate-400 hover:bg-slate-800 hover:text-cyan-200'
                  }`}
                >
                  {formatTsLabel(ts)}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-center gap-4 py-3 border-t border-slate-800">
            <button type="button" onClick={prevFrame} className="p-2 rounded-full bg-slate-800 hover:bg-slate-700" aria-label="Anterior">
              <SkipBack className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={togglePlay}
              className="p-3 rounded-full bg-cyan-700 hover:bg-cyan-600"
              aria-label={isPlaying ? 'Pausar' : 'Play'}
            >
              {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6 pl-0.5" />}
            </button>
            <button type="button" onClick={nextFrame} className="p-2 rounded-full bg-slate-800 hover:bg-slate-700" aria-label="Próximo">
              <SkipForward className="w-5 h-5" />
            </button>
            <span className="text-xs text-slate-500 font-mono">
              {safeIndex + 1} / {timelineTimes.length}
              {currentTs && (
                <span className="ml-2 text-cyan-400">
                  {currentTs.replace(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/, '$3/$2 $4:$5')}
                </span>
              )}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
