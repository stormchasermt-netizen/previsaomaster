'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ChevronLeft,
  ChevronUp,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Columns2,
  Sparkles,
  Navigation,
  Zap,
  X,
  Menu,
  Layers,
  Check,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { db, storage } from '@/lib/firebase';
import { collection, addDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { fetchPrevotsForecasts } from '@/lib/prevotsForecastStore';
import { PREVOTS_LEVEL_COLORS, type PrevotsForecast } from '@/lib/prevotsForecastData';
import { AlertTriangle, MapPin, Crosshair, Search, Image as ImageIcon, Link as LinkIcon, Camera, FileText, CheckCircle2, ShieldAlert, Info } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { CPTEC_RADAR_STATIONS, getRadarImageBounds, type CptecRadarStation } from '@/lib/cptecRadarStations';
import { hasRedemetFallback, getRedemetBucketSlugForCptecBucket } from '@/lib/redemetRadar';
import { hasSigmaFallback, getSigmaBucketSlugForCptecBucket } from '@/lib/cptecRadarStations';
import {
  filterClimatempoRadarImage,
  filterReflectivitySuperRes,
  filterDopplerPurpleGreenNeighborSuperRes,
  filterRadarImageCircularMask,
} from '@/lib/radarImageFilter';
import { fetchRadarConfigs, type RadarConfig } from '@/lib/radarConfigStore';

const MAPTILER_KEY = 'WyOGmI7ufyBLH3G7aX9o';
const SAT_STYLE = `https://api.maptiler.com/maps/hybrid-v4/style.json?key=${MAPTILER_KEY}`;

type BaseMapId = 'satellite' | 'streets' | 'topo' | 'toner';

const BASE_MAP_OPTIONS: { id: BaseMapId; label: string; styleUrl: string; previewUrl: string }[] = [
  { 
    id: 'satellite', 
    label: 'Satélite', 
    styleUrl: `https://api.maptiler.com/maps/hybrid-v4/style.json?key=${MAPTILER_KEY}`,
    previewUrl: `https://raw.githubusercontent.com/stormchasermt-netizen/previsaomaster/4ce82048c73c1c91976331a5861911842755bbf4/Captura%20de%20tela%202026-03-30%20212709.png`
  },
  { 
    id: 'streets', 
    label: 'Ruas', 
    styleUrl: `https://api.maptiler.com/maps/streets-v4/style.json?key=${MAPTILER_KEY}`,
    previewUrl: `https://raw.githubusercontent.com/stormchasermt-netizen/previsaomaster/4ce82048c73c1c91976331a5861911842755bbf4/Captura%20de%20tela%202026-03-30%20212655.png`
  },
  { 
    id: 'topo', 
    label: 'Relevos', 
    styleUrl: `https://api.maptiler.com/maps/topo-v4/style.json?key=${MAPTILER_KEY}`,
    previewUrl: `https://raw.githubusercontent.com/stormchasermt-netizen/previsaomaster/4ce82048c73c1c91976331a5861911842755bbf4/Captura%20de%20tela%202026-03-30%20212638.png`
  },
  { 
    id: 'toner', 
    label: 'Branco', 
    styleUrl: `https://api.maptiler.com/maps/toner-v2/style.json?key=${MAPTILER_KEY}`,
    previewUrl: `https://raw.githubusercontent.com/stormchasermt-netizen/previsaomaster/4ce82048c73c1c91976331a5861911842755bbf4/Captura%20de%20tela%202026-03-30%20212551.png`
  },
];

/** Mesmos URLs que em app/ao-vivo/page.tsx */
const RADAR_ICON_AVAILABLE =
  'https://raw.githubusercontent.com/stormchasermt-netizen/previsaomaster/78c82d9eb9f723ed65805e819046d598ace4a36e/radar-icon-svg-download-png-8993769.webp';
const RADAR_ICON_UNAVAILABLE =
  'https://raw.githubusercontent.com/stormchasermt-netizen/previsaomaster/78c82d9eb9f723ed65805e819046d598ace4a36e/radar-icon-svg-download-png-8993769.webp';

export type RadarProductMode = 'ppi' | 'doppler';

/** Pasta no GCS pode ser `riobranco`; no catálogo CPTEC o slug é `rio-branco`. */
function bucketSlugToCatalogSlug(slug: string): string {
  if (slug.startsWith('redemet-')) return bucketSlugToCatalogSlug(slug.replace('redemet-', ''));
  if (slug.startsWith('sigma-')) return bucketSlugToCatalogSlug(slug.replace('sigma-', ''));
  if (slug === 'riobranco') return 'rio-branco';
  return slug;
}

function findCptecBySlug(slug: string, radarConfigs?: RadarConfig[]): CptecRadarStation & { iconLat?: number, iconLng?: number, maskRadiusKm?: number } | undefined {
  const base = CPTEC_RADAR_STATIONS.find((s) => s.slug === bucketSlugToCatalogSlug(slug));
  if (!base) return undefined;

  if (radarConfigs) {
    let targetConfigId = base.slug;
    if (slug.startsWith('redemet-')) targetConfigId = base.slug + '-redemet';
    else if (slug.startsWith('sigma-')) targetConfigId = base.slug + '-sigma';

    let config = radarConfigs.find(c => c.id === targetConfigId);
    if (!config) {
      // Fallback para a config padrão da base CPTEC se não houver config específica da fonte
      config = radarConfigs.find(c => c.id === base.slug);
    }

    if (config) {
      const merged = { ...base, iconLat: base.lat, iconLng: base.lng, maskRadiusKm: base.rangeKm };
      const isIpmet = base.slug === 'ipmet-bauru' || base.slug === 'ipmet-prudente';
      
      // O ícone do IPMet nunca deve sair do lugar, mesmo que o centro da máscara mude.
      if (!isIpmet) {
        if (config.lat !== undefined && config.lat !== 0) merged.iconLat = config.lat;
        if (config.lng !== undefined && config.lng !== 0) merged.iconLng = config.lng;
      }
      
      // A máscara (ou o cálculo de bounds/corte) usa as configurações ajustadas pelo admin.
      if (config.lat !== undefined && config.lat !== 0) merged.lat = config.lat;
      if (config.lng !== undefined && config.lng !== 0) merged.lng = config.lng;

      if (config.rangeKm !== undefined && config.rangeKm !== 0) merged.rangeKm = config.rangeKm;
      if (config.maskRadiusKm !== undefined && config.maskRadiusKm !== 0) merged.maskRadiusKm = config.maskRadiusKm;
      
      if (config.customBounds && config.customBounds.north) {
        merged.bounds = {
          maxLat: config.customBounds.north,
          minLat: config.customBounds.south,
          maxLon: config.customBounds.east,
          minLon: config.customBounds.west
        };
      } else if (config.bounds && config.bounds.ne) {
        merged.bounds = {
          maxLat: config.bounds.ne.lat,
          minLat: config.bounds.sw.lat,
          maxLon: config.bounds.ne.lng,
          minLon: config.bounds.sw.lng
        };
      }
      return merged;
    }
  }

  return { ...base, iconLat: base.lat, iconLng: base.lng };
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
/** CPTEC/Nowcasting no bucket: considerar “recente” se o PNG mais novo não for mais antigo que isto (UTC no nome). */
const CPTEC_PPI_RECENT_MAX_AGE_MS = 90 * 60 * 1000;

function getNewestPpiTsMs(imgs: { name: string }[]): number | null {
  let best = -1;
  for (const im of imgs) {
    const ts = extractTsFromFilename(im.name, 'ppi');
    if (ts) best = Math.max(best, ts12ToUtcMs(ts));
  }
  return best >= 0 ? best : null;
}

function isCptecPpiRecent(imgs: { name: string }[], maxAgeMs: number): boolean {
  const newest = getNewestPpiTsMs(imgs);
  if (newest === null) return false;
  return Date.now() - newest <= maxAgeMs;
}

export type FocusedRadarSourceMode = 'auto' | 'cptec' | 'redemet' | 'sigma';

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
    const allTsSet = new Set<string>();

    for (const slug of slugs) {
      lookups[slug] = buildTsLookup(imagesByStation[slug] || [], product);
      for (const ts of lookups[slug].keys()) {
        allTsSet.add(ts);
      }
    }
    
    if (allTsSet.size === 0) return null;
  
    // Timeline contendo TODOS os timestamps únicos encontrados na última hora em todos os radares
    const allTs = Array.from(allTsSet);
    const tMaxMs = Math.max(...allTs.map(ts12ToUtcMs));
    const tMinMs = tMaxMs - ONE_HOUR_MS;
  
    const masterTimes = allTs
      .filter((ts) => {
        const ms = ts12ToUtcMs(ts);
        return ms >= tMinMs && ms <= tMaxMs;
      })
      .sort();

    if (masterTimes.length === 0) return null;
  
    const lastUrl: Record<string, string> = {};
    const frames: MosaicSyncFrame[] = [];
  
    for (const masterTs of masterTimes) {
      const targetMs = ts12ToUtcMs(masterTs);
      const urlBySlug: Record<string, string> = {};
  
      for (const slug of slugs) {
        const map = lookups[slug];
        const allSlugTs = Array.from(map.keys()).sort();
        
        // Verifica se há correspondência exata ou próxima (dentro da tolerância)
        const match = pickClosestWithinTolerance(allSlugTs, targetMs, SYNC_TOLERANCE_MS);
        
        if (match !== null) {
          const img = map.get(match)!;
          urlBySlug[slug] = img.url;
          lastUrl[slug] = img.url;
        } else if (lastUrl[slug]) {
          // Mantém a última imagem exibida para este radar neste passe de animação
          urlBySlug[slug] = lastUrl[slug];
        } else {
          // Busca a última imagem historicamente válida antes do targetMs
          const holdTs = lastTsAtOrBefore(allSlugTs, targetMs);
          if (holdTs !== null) {
            const img = map.get(holdTs)!;
            urlBySlug[slug] = img.url;
            lastUrl[slug] = img.url;
          }
        }
      }
  
      frames.push({ masterTs, urlBySlug });
    }
  
    return { leaderSlug: 'union', masterTimes, frames };
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

function mergeFitBounds(
  slugs: string[],
  getStationForBounds: (slug: string) => CptecRadarStation | undefined
): [[number, number], [number, number]] | null {
  const stations = slugs.map((s) => getStationForBounds(s)).filter(Boolean) as CptecRadarStation[];
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

type MapPanel = 'single' | 'left' | 'right';

function sourceId(slug: string, panel: MapPanel = 'single') {
  if (panel === 'single') return `radar-aovivo2-src-${slug}`;
  return `radar-aovivo2-src-${slug}-${panel}`;
}
function layerId(slug: string, panel: MapPanel = 'single') {
  if (panel === 'single') return `radar-aovivo2-layer-${slug}`;
  return `radar-aovivo2-layer-${slug}-${panel}`;
}

/** Mesmo instante: URL Doppler mais próximo ao ts alvo (±10 min). */
function dopplerUrlForTs(
  lookup: Map<string, { name: string; url: string }>,
  ts: string
): string | null {
  const exact = lookup.get(ts);
  if (exact) return exact.url;
  const sorted = Array.from(lookup.keys()).sort();
  const targetMs = ts12ToUtcMs(ts);
  const match = pickClosestWithinTolerance(sorted, targetMs, SYNC_TOLERANCE_MS);
  if (match) return lookup.get(match)!.url;
  const hold = lastTsAtOrBefore(sorted, targetMs);
  return hold ? lookup.get(hold)!.url : null;
}

/** Legenda Doppler típica (velocidade radial), −60 … +60 m/s. */
const DOPPLER_LEGEND_GRADIENT_MS = `linear-gradient(90deg,
  #ff2fd8 0%, #b020c8 4%, #401090 8%, #000080 12%, #0060c8 16%, #00c8e8 20%, #40ffa0 24%,
  #2a3828 50%,
  #5c2018 58%, #e01010 64%, #ff6010 70%, #ffd800 78%, #a0c010 88%, #101010 100%)`;
const DOPPLER_LEGEND_TICKS_MS = [-60, -50, -40, -30, -20, -10, 0, 10, 20, 30, 40, 50, 60];

export default function AoVivo2Content() {

  const myLocation = null;

  const cancelReport = () => {
    setReportStep('closed');
    setReportLat(null);
    setReportLng(null);
    setReportType('ven');
    setReportDetail('');
    setReportMediaMode('file');
    setReportMediaFile(null);
    setReportMediaLink('');
    setReportCitySearch('');
  };

  const startPickMapLocation = () => {
    setReportStep('pick-map');
    const map = splitScreen ? mapSplitLeftRef.current : mapSingleRef.current;
    if (map) {
      map.getCanvas().style.cursor = 'crosshair';
      map.once('click', (e) => {
        setReportLat(parseFloat(e.lngLat.lat.toFixed(5)));
        setReportLng(parseFloat(e.lngLat.lng.toFixed(5)));
        setReportStep('form');
        map.getCanvas().style.cursor = '';
      });
    }
  };

  const searchCityForReport = async () => {
    if (!reportCitySearch.trim()) return;
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(reportCitySearch)}`);
      const data = await res.json();
      if (data && data.length > 0) {
        setReportLat(parseFloat(data[0].lat));
        setReportLng(parseFloat(data[0].lon));
        setReportStep('form');
      } else {
        if (typeof addToast === 'function') addToast('Cidade não encontrada', 'info');
      }
    } catch {
      if (typeof addToast === 'function') addToast('Erro ao buscar cidade', 'error');
    }
  };

  const submitReport = async () => {
    if (!user || reportLat == null || reportLng == null) return;
    const hasMedia = reportMediaFile || (reportMediaMode === 'link' && reportMediaLink?.trim());
    if (reportType === 'tor' && !hasMedia) {
      if (typeof addToast === 'function') addToast('Tornados e Nuvens Funis requerem foto ou vídeo.', 'error');
      return;
    }
    setReportSending(true);
    try {
      const payload = {
        userId: user.uid,
        lat: reportLat,
        lng: reportLng,
        type: reportType,
        detail: reportType !== 'tor' ? reportDetail || undefined : undefined,
        mediaType: reportMediaMode === 'link' && reportMediaLink ? 'link' : reportMediaFile ? 'file' : undefined,
        mediaUrl: reportMediaMode === 'link' && reportMediaLink ? reportMediaLink : undefined,
        createdAt: new Date(),
        status: 'pending',
      };

      if (reportMediaMode === 'file' && reportMediaFile) {
        const fileRef = ref(storage, `reports/${Date.now()}_${reportMediaFile.name}`);
        await uploadBytes(fileRef, reportMediaFile);
        payload.mediaUrl = await getDownloadURL(fileRef);
      }

      await addDoc(collection(db, 'storm_reports'), payload);
      if (typeof addToast === 'function') addToast('Relato enviado com sucesso! Aguardando moderação.', 'success');
      cancelReport();
    } catch (e) {
      if (typeof addToast === 'function') addToast('Erro ao enviar relato.', 'error');
      console.error(e);
    } finally {
      setReportSending(false);
    }
  };


  const { user } = useAuth();
  const { addToast } = useToast();

  const [prevotsOverlayVisible, setPrevotsOverlayVisible] = useState(false);
  const [prevotsForecasts, setPrevotsForecasts] = useState<PrevotsForecast[]>([]);
  const [prevotsForecastDate, setPrevotsForecastDate] = useState(() => {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  });
  const [showPrevotsDialog, setShowPrevotsDialog] = useState(false);
  const [selectedPrevotsLinks, setSelectedPrevotsLinks] = useState<{ xUrl?: string; instagramUrl?: string; date: string } | null>(null);

  const [reportStep, setReportStep] = useState<'closed' | 'location' | 'pick-map' | 'form'>('closed');
  const [reportLat, setReportLat] = useState<number | null>(null);
  const [reportLng, setReportLng] = useState<number | null>(null);
  const [reportType, setReportType] = useState<'ven' | 'gra' | 'tor'>('ven');
  const [reportDetail, setReportDetail] = useState('');
  const [reportMediaMode, setReportMediaMode] = useState<'file' | 'link'>('file');
  const [reportMediaFile, setReportMediaFile] = useState<File | null>(null);
  const [reportMediaLink, setReportMediaLink] = useState('');
  const [reportCitySearch, setReportCitySearch] = useState('');
  const [reportSending, setReportSending] = useState(false);

  useEffect(() => {
    fetchPrevotsForecasts().then(setPrevotsForecasts).catch(() => setPrevotsForecasts([]));
  }, []);

  // Injectar CSS para renderização "crocante" dos radares (pixel-perfect zoom)
  useEffect(() => {
    const style = document.createElement('style');
    style.innerHTML = `
      /* Renderização pixelada no canvas do mapa */
      .maplibregl-canvas, .mapboxgl-canvas {
        image-rendering: pixelated !important;
        image-rendering: crisp-edges !important;
        image-rendering: -moz-crisp-edges !important;
        -ms-interpolation-mode: nearest-neighbor !important;
      }
    `;
    document.head.appendChild(style);
    return () => {
      document.head.removeChild(style);
    };
  }, []);

  // Carregar RadarConfigs (admin overrides) do Firestore
  useEffect(() => {
    fetchRadarConfigs().then(configs => {
      setRadarConfigs(configs);
    }).catch(err => {
      console.error("Erro ao carregar RadarConfigs", err);
    });
  }, []);

  const [stations, setStations] = useState<string[]>([]);
  const [radarConfigs, setRadarConfigs] = useState<RadarConfig[]>([]);
  const [product, setProduct] = useState<RadarProductMode>('ppi');
  const [imagesByStationPpi, setImagesByStationPpi] = useState<Record<string, { name: string; url: string }[]>>({});
  const [imagesByStationDoppler, setImagesByStationDoppler] = useState<
    Record<string, { name: string; url: string }[]>
  >({});
  /** PPI na pasta `redemet-xx` do bucket, indexado pelo slug CPTEC (`santiago` → imagens de `redemet-sg`). */
  const [imagesRedemetPpiByCptec, setImagesRedemetPpiByCptec] = useState<
    Record<string, { name: string; url: string }[]>
  >({});
  const [imagesSigmaPpiByCptec, setImagesSigmaPpiByCptec] = useState<
    Record<string, { name: string; url: string }[]>
  >({});
  const [imagesSigmaDopplerByCptec, setImagesSigmaDopplerByCptec] = useState<
    Record<string, { name: string; url: string }[]>
  >({});
  /** Com radar em foco e par CPTEC+REDEMET: escolha de fonte (Automático = recente no CPTEC senão REDEMET). */
  const [focusedRadarSource, setFocusedRadarSource] = useState<FocusedRadarSourceMode>('auto');
  /** `null` = sempre o último instante da timeline (abertura / “ao vivo”); número = frame fixo após interação. */
  const [timelineCursor, setTimelineCursor] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [animationSpeedMultiplier, setAnimationSpeedMultiplier] = useState(1);

  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const [focusedSlug, setFocusedSlug] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  /** MapLibre: após `load` o estilo pode ainda animar; `idle` garante que raster/imagens aplicam no 1.º mosaico. */
  const [mapRasterIdle, setMapRasterIdle] = useState(false);
  const [splitScreen, setSplitScreen] = useState(false);
  const [superResMode, setSuperResMode] = useState(false);
  const [bottomPanelExpanded, setBottomPanelExpanded] = useState(true);

  const [baseMapId, setBaseMapId] = useState<BaseMapId>('streets');
  const [showBaseMapGallery, setShowBaseMapGallery] = useState(false);

  const mapContainerSingleRef = useRef<HTMLDivElement | null>(null);
  const mapContainerSplitLeftRef = useRef<HTMLDivElement | null>(null);
  const mapContainerSplitRightRef = useRef<HTMLDivElement | null>(null);
  const mapSingleRef = useRef<maplibregl.Map | null>(null);
  const mapSplitLeftRef = useRef<maplibregl.Map | null>(null);
  const mapSplitRightRef = useRef<maplibregl.Map | null>(null);
  const radarMarkersRef = useRef<maplibregl.Marker[]>([]);
  const preloadedUrlsRef = useRef<Set<string>>(new Set());
  const layerUpdateGenerationRef = useRef(0);
  const prevTimelineLenRef = useRef(0);

  const stationsWithBounds = useMemo(
    () => {
      const baseSlugs = new Set<string>();
      for (const s of stations) {
        const base = bucketSlugToCatalogSlug(s);
        if (Boolean(findCptecBySlug(base, radarConfigs))) {
          baseSlugs.add(base);
        }
      }
      return Array.from(baseSlugs).sort();
    },
    [stations, radarConfigs]
  );

  const ppiSourceBySlug = useMemo(() => {
    const out: Record<string, 'cptec' | 'redemet' | 'sigma'> = {};
    for (const slug of stationsWithBounds) {
      const catalog = bucketSlugToCatalogSlug(slug);
      const cptec = imagesByStationPpi[slug] ?? [];
      const red = imagesRedemetPpiByCptec[slug] ?? [];
      const sig = imagesSigmaPpiByCptec[slug] ?? [];
      const hasRed = hasRedemetFallback(catalog) && red.length > 0;
      const hasSig = hasSigmaFallback(catalog) && sig.length > 0;

      let src: 'cptec' | 'redemet' | 'sigma';
      if (focusedSlug === slug && focusedRadarSource !== 'auto') {
        src = focusedRadarSource;
        if (src === 'cptec' && cptec.length === 0) {
          if (hasRed) src = 'redemet';
          else if (hasSig) src = 'sigma';
        }
        if (src === 'redemet' && !hasRed) {
          if (hasSig) src = 'sigma';
          else src = 'cptec';
        }
        if (src === 'sigma' && !hasSig) {
          if (hasRed) src = 'redemet';
          else src = 'cptec';
        }
      } else {
        if (isCptecPpiRecent(cptec, CPTEC_PPI_RECENT_MAX_AGE_MS)) {
          src = 'cptec';
        } else if (hasRed) {
          src = 'redemet';
        } else if (hasSig) {
          src = 'sigma';
        } else {
          src = 'cptec';
        }
      }
      out[slug] = src;
    }
    return out;
  }, [
    stationsWithBounds,
    imagesByStationPpi,
    imagesRedemetPpiByCptec,
    imagesSigmaPpiByCptec,
    focusedSlug,
    focusedRadarSource,
  ]);

  const effectivePpiImagesBySlug = useMemo(() => {
    const out: Record<string, { name: string; url: string }[]> = {};
    for (const slug of stationsWithBounds) {
      const src = ppiSourceBySlug[slug];
      const cptec = imagesByStationPpi[slug] ?? [];
      const red = imagesRedemetPpiByCptec[slug] ?? [];
      const sig = imagesSigmaPpiByCptec[slug] ?? [];
      out[slug] = src === 'sigma' ? sig : (src === 'redemet' ? red : cptec);
    }
    return out;
  }, [stationsWithBounds, ppiSourceBySlug, imagesByStationPpi, imagesRedemetPpiByCptec, imagesSigmaPpiByCptec]);

  const effectiveDopplerImagesBySlug = useMemo(() => {
    const out: Record<string, { name: string; url: string }[]> = {};
    for (const slug of stationsWithBounds) {
      // Usamos a mesma lógica de source do PPI para o Doppler para manter sincronia
      const src = ppiSourceBySlug[slug] === 'sigma' ? 'sigma' : 'cptec';
      const cptec = imagesByStationDoppler[slug] ?? [];
      const sig = imagesSigmaDopplerByCptec[slug] ?? [];
      out[slug] = src === 'sigma' && sig.length > 0 ? sig : cptec;
    }
    return out;
  }, [stationsWithBounds, ppiSourceBySlug, imagesByStationDoppler, imagesSigmaDopplerByCptec]);

  const lookupsPpi = useMemo(() => {
    const out: Record<string, Map<string, { name: string; url: string }>> = {};
    for (const slug of stationsWithBounds) {
      out[slug] = buildTsLookup(effectivePpiImagesBySlug[slug] || [], 'ppi');
    }
    return out;
  }, [stationsWithBounds, effectivePpiImagesBySlug]);

  const lookupsDoppler = useMemo(() => {
    const out: Record<string, Map<string, { name: string; url: string }>> = {};
    for (const slug of Object.keys(effectiveDopplerImagesBySlug)) {
      out[slug] = buildTsLookup(effectiveDopplerImagesBySlug[slug] || [], 'doppler');
    }
    return out;
  }, [effectiveDopplerImagesBySlug]);

  const lookups = useMemo(
    () => (product === 'ppi' ? lookupsPpi : lookupsDoppler),
    [product, lookupsPpi, lookupsDoppler]
  );

  const imagesByStationActive =
    product === 'ppi' ? effectivePpiImagesBySlug : effectiveDopplerImagesBySlug;

  /** Mosaico (modo produto único): última hora + sincronização. */
  const mosaicSync = useMemo(() => {
    if (focusedSlug) return null;
    return buildMosaicSyncPlan(imagesByStationActive, stationsWithBounds, product);
  }, [focusedSlug, imagesByStationActive, product, stationsWithBounds]);

  /** Mosaico PPI e Doppler (para ecrã dividido). */
  const mosaicSyncPpi = useMemo(() => {
    if (focusedSlug) return null;
    return buildMosaicSyncPlan(effectivePpiImagesBySlug, stationsWithBounds, 'ppi');
  }, [focusedSlug, effectivePpiImagesBySlug, stationsWithBounds]);

  const mosaicSyncDop = useMemo(() => {
    if (focusedSlug) return null;
    return buildMosaicSyncPlan(effectiveDopplerImagesBySlug, stationsWithBounds, 'doppler');
  }, [focusedSlug, effectiveDopplerImagesBySlug, stationsWithBounds]);

  /**
   * Slider: dividido = mesma timeline (PPI como referência no mosaico; foco = união de instantes);
   * único = instantes do produto selecionado.
   */
  const timelineTimes = useMemo(() => {
    if (splitScreen) {
      if (focusedSlug) {
        const ppi = collectSortedTimesFromImages(effectivePpiImagesBySlug[focusedSlug] || [], 'ppi');
        const dop = collectSortedTimesFromImages(imagesByStationDoppler[focusedSlug] || [], 'doppler');
        return Array.from(new Set([...ppi, ...dop])).sort();
      }
      return mosaicSyncPpi?.masterTimes ?? [];
    }
    if (focusedSlug) {
      return collectSortedTimesFromImages(imagesByStationActive[focusedSlug] || [], product);
    }
    return mosaicSync?.masterTimes ?? [];
  }, [
    splitScreen,
    focusedSlug,
    imagesByStationDoppler,
    imagesByStationActive,
    effectivePpiImagesBySlug,
    product,
    mosaicSync,
    mosaicSyncPpi,
  ]);

  const safeIndex =
    timelineTimes.length === 0
      ? 0
      : timelineCursor === null
        ? timelineTimes.length - 1
        : Math.min(timelineCursor, timelineTimes.length - 1);
  const currentTs = timelineTimes[safeIndex] ?? null;

  const mosaicFrameAtIndex = useMemo(() => {
    if (focusedSlug || !mosaicSync?.frames.length) return null;
    const i = Math.min(safeIndex, mosaicSync.frames.length - 1);
    return mosaicSync.frames[i] ?? null;
  }, [focusedSlug, mosaicSync, safeIndex]);

  const mosaicFramePpiAtIndex = useMemo(() => {
    if (focusedSlug || !mosaicSyncPpi?.frames.length) return null;
    const i = Math.min(safeIndex, mosaicSyncPpi.frames.length - 1);
    return mosaicSyncPpi.frames[i] ?? null;
  }, [focusedSlug, mosaicSyncPpi, safeIndex]);

  const mosaicFrameDopAtIndex = useMemo(() => {
    if (focusedSlug || !mosaicSyncPpi?.frames.length) return null;
    const i = Math.min(safeIndex, mosaicSyncPpi.masterTimes.length - 1);
    const masterTs = mosaicSyncPpi.masterTimes[i];
    if (!mosaicSyncDop?.frames.length) return null;
    const byTs = mosaicSyncDop.frames.find((f) => f.masterTs === masterTs);
    if (byTs) return byTs;
    const j = Math.min(safeIndex, mosaicSyncDop.frames.length - 1);
    return mosaicSyncDop.frames[j] ?? null;
  }, [focusedSlug, mosaicSyncPpi, mosaicSyncDop, safeIndex]);

  const hasAnyStationImages = useMemo(
    () =>
      Object.values(imagesByStationPpi).some((imgs) => imgs.length > 0) ||
      Object.values(imagesByStationDoppler).some((imgs) => imgs.length > 0) ||
      Object.values(imagesRedemetPpiByCptec).some((imgs) => imgs.length > 0) ||
      Object.values(imagesSigmaPpiByCptec).some((imgs) => imgs.length > 0) ||
      Object.values(imagesSigmaDopplerByCptec).some((imgs) => imgs.length > 0),
    [imagesByStationPpi, imagesByStationDoppler, imagesRedemetPpiByCptec, imagesSigmaPpiByCptec, imagesSigmaDopplerByCptec]
  );

  const isDataReady = useMemo(
    () => hasAnyStationImages,
    [hasAnyStationImages]
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
      setImagesByStationPpi({});
      setImagesByStationDoppler({});
      setImagesRedemetPpiByCptec({});
      setImagesSigmaPpiByCptec({});
      setImagesSigmaDopplerByCptec({});
      setTimelineCursor(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    const fetchStationProduct = (slug: string, prod: 'ppi' | 'doppler') =>
      fetch(
        `/api/radar-ao-vivo2?action=listImages&station=${encodeURIComponent(slug)}&product=${prod}`
      )
        .then(async (r) => {
          const data = (await r.json()) as { images?: { name: string; url: string }[]; error?: string };
          if (!r.ok) throw new Error(data.error || slug);
          return { slug, prod, images: data.images || [] };
        })
        .catch(() => ({ slug, prod, images: [] as { name: string; url: string }[] }));

    Promise.all(
      stationsWithBounds.flatMap((slug) => [fetchStationProduct(slug, 'ppi'), fetchStationProduct(slug, 'doppler')])
    )
      .then((rows) => {
        const nextPpi: Record<string, { name: string; url: string }[]> = {};
        const nextDop: Record<string, { name: string; url: string }[]> = {};
        for (const row of rows) {
          if (row.prod === 'ppi') nextPpi[row.slug] = row.images;
          else nextDop[row.slug] = row.images;
        }
        setImagesByStationPpi(nextPpi);
        setImagesByStationDoppler(nextDop);

        const redTasks = stationsWithBounds
          .map((slug) => {
            const catalog = bucketSlugToCatalogSlug(slug);
            if (!hasRedemetFallback(catalog)) return null;
            const rs = getRedemetBucketSlugForCptecBucket(slug);
            if (!rs) return null;
            return fetchStationProduct(rs, 'ppi').then((row) => ({
              cptecSlug: slug,
              images: row.images,
            }));
          })
          .filter((x): x is Promise<{ cptecSlug: string; images: { name: string; url: string }[] }> => x != null);

        const sigTasks = stationsWithBounds
          .map((slug) => {
            const catalog = bucketSlugToCatalogSlug(slug);
            if (!hasSigmaFallback(catalog)) return null;
            const rs = getSigmaBucketSlugForCptecBucket(slug);
            if (!rs) return null;
            return Promise.all([
              fetchStationProduct(rs, 'ppi').catch(() => ({ images: [] })),
              fetchStationProduct(rs, 'doppler').catch(() => ({ images: [] }))
            ]).then(([ppiRow, dopRow]) => ({
              cptecSlug: slug,
              imagesPpi: ppiRow.images,
              imagesDop: dopRow.images,
            }));
          })
          .filter((x): x is Promise<{ cptecSlug: string; imagesPpi: { name: string; url: string }[], imagesDop: { name: string; url: string }[] }> => x != null);

        return Promise.all([Promise.all(redTasks), Promise.all(sigTasks)]);
      })
      .then(([redRows, sigRows]) => {
        const nextRed: Record<string, { name: string; url: string }[]> = {};
        if (redRows) {
          for (const r of redRows) {
            nextRed[r.cptecSlug] = r.images;
          }
        }
        setImagesRedemetPpiByCptec(nextRed);

        const nextSigPpi: Record<string, { name: string; url: string }[]> = {};
        const nextSigDop: Record<string, { name: string; url: string }[]> = {};
        if (sigRows) {
          for (const r of sigRows) {
            nextSigPpi[r.cptecSlug] = r.imagesPpi;
            nextSigDop[r.cptecSlug] = r.imagesDop;
          }
        }
        setImagesSigmaPpiByCptec(nextSigPpi);
        setImagesSigmaDopplerByCptec(nextSigDop);

        setTimelineCursor(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setIsLoading(false));
  }, [stationsWithBounds]);

  /** Ao mudar foco, produto ou modo dividido: voltar ao último instante disponível. */
  useEffect(() => {
    setTimelineCursor(null);
  }, [focusedSlug, product, splitScreen]);

  /** Novo radar em foco: voltar ao modo Automático (CPTEC recente senão REDEMET). */
  useEffect(() => {
    setFocusedRadarSource('auto');
  }, [focusedSlug]);

  /** Quando a timeline encolhe, mantém índice válido (se não estiver em modo “ao vivo”). */
  useEffect(() => {
    const len = timelineTimes.length;
    if (len === 0) {
      setTimelineCursor(null);
      prevTimelineLenRef.current = 0;
      return;
    }
    if (prevTimelineLenRef.current > len) {
      setTimelineCursor((c) => (c === null ? null : Math.min(c, len - 1)));
    }
    prevTimelineLenRef.current = len;
  }, [timelineTimes.length]);

  /** Mapa único ou par sincronizado (PPI | Doppler). */
  useEffect(() => {
    if (splitScreen) {
      const leftEl = mapContainerSplitLeftRef.current;
      const rightEl = mapContainerSplitRightRef.current;
      if (!leftEl || !rightEl || mapSplitLeftRef.current) return;

      let silent = false;
      const mapL = new maplibregl.Map({
        container: leftEl,
        style: BASE_MAP_OPTIONS.find(o => o.id === baseMapId)?.styleUrl || BASE_MAP_OPTIONS[0].styleUrl,
        center: [-51, -22],
        zoom: 4,
      });
      const mapR = new maplibregl.Map({
        container: rightEl,
        style: BASE_MAP_OPTIONS.find(o => o.id === baseMapId)?.styleUrl || BASE_MAP_OPTIONS[0].styleUrl,
        center: [-51, -22],
        zoom: 4,
      });
      mapSplitLeftRef.current = mapL;
      mapSplitRightRef.current = mapR;

      mapL.on('move', () => {
        if (silent) return;
        silent = true;
        mapR.jumpTo({
          center: mapL.getCenter(),
          zoom: mapL.getZoom(),
          bearing: mapL.getBearing(),
          pitch: mapL.getPitch(),
        });
        silent = false;
      });
      mapR.on('move', () => {
        if (silent) return;
        silent = true;
        mapL.jumpTo({
          center: mapR.getCenter(),
          zoom: mapR.getZoom(),
          bearing: mapR.getBearing(),
          pitch: mapR.getPitch(),
        });
        silent = false;
      });

      let loads = 0;
      const onLoad = () => {
        loads += 1;
        if (loads === 2) {
          mapL.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
          setMapReady(true);
        }
      };
      mapL.on('load', onLoad);
      mapR.on('load', onLoad);

      let idleCount = 0;
      const onFirstIdle = () => {
        idleCount += 1;
        if (idleCount === 2) setMapRasterIdle(true);
      };
      mapL.once('idle', onFirstIdle);
      mapR.once('idle', onFirstIdle);

      return () => {
        setMapReady(false);
        setMapRasterIdle(false);
        mapL.remove();
        mapR.remove();
        mapSplitLeftRef.current = null;
        mapSplitRightRef.current = null;
      };
    }

    const container = mapContainerSingleRef.current;
    if (!container || mapSingleRef.current) return;

    const map = new maplibregl.Map({
      container,
      style: BASE_MAP_OPTIONS.find(o => o.id === baseMapId)?.styleUrl || BASE_MAP_OPTIONS[0].styleUrl,
      center: [-51, -22],
      zoom: 4,
    });
    map.on('load', () => {
      setMapReady(true);
      map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
      map.once('idle', () => {
        setMapRasterIdle(true);
      });
    });
    mapSingleRef.current = map;

    return () => {
      setMapReady(false);
      setMapRasterIdle(false);
      map.remove();
      mapSingleRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [splitScreen]);

  /** Ajusta enquadramento */
  useEffect(() => {
    const slugs = focusedSlug ? [focusedSlug] : stationsWithBounds;
    const b = mergeFitBounds(slugs, (slug) => {
      const redSlug = getRedemetBucketSlugForCptecBucket(slug);
      const src = ppiSourceBySlug[slug];
      if (src === 'redemet' && redSlug) return findCptecBySlug(redSlug, radarConfigs);
      return findCptecBySlug(slug, radarConfigs);
    });
    if (!b) return;
    const pad = superResMode ? (focusedSlug ? 36 : 52) : focusedSlug ? 56 : 80;
    const opts = { padding: pad, duration: 500 };
    if (splitScreen) {
      const mapL = mapSplitLeftRef.current;
      const mapR = mapSplitRightRef.current;
      if (!mapL || !mapR || !mapReady) return;
      mapL.fitBounds(b, opts);
      mapR.fitBounds(b, opts);
      return;
    }
    const map = mapSingleRef.current;
    if (!map || !mapReady) return;
    map.fitBounds(b, opts);
  }, [mapReady, focusedSlug, stationsWithBounds, superResMode, splitScreen, ppiSourceBySlug, radarConfigs]);

  useEffect(() => {
    if (!mapReady) return;
    const updateStyle = (map: maplibregl.Map | null) => {
      if (!map) return;
      const opt = BASE_MAP_OPTIONS.find((o) => o.id === baseMapId);
      if (opt) {
        setMapRasterIdle(false);
        map.setStyle(opt.styleUrl);
        map.once('idle', () => setMapRasterIdle(true));
      }
    };
    if (splitScreen) {
      updateStyle(mapSplitLeftRef.current);
      updateStyle(mapSplitRightRef.current);
    } else {
      updateStyle(mapSingleRef.current);
    }
  }, [baseMapId, mapReady, splitScreen]);

  /** Marcadores (ícones como ao-vivo-1) */
  useEffect(() => {
    if (!mapReady) return;

    radarMarkersRef.current.forEach((m) => m.remove());
    radarMarkersRef.current = [];

    const addMarkersToMap = (map: maplibregl.Map) => {
      for (const slug of stationsWithBounds) {
        const st = findCptecBySlug(slug, radarConfigs);
        if (!st) continue;
        const hasAny =
          (imagesByStationPpi[slug]?.length ?? 0) > 0 ||
          (imagesRedemetPpiByCptec[slug]?.length ?? 0) > 0 ||
          (imagesSigmaPpiByCptec[slug]?.length ?? 0) > 0 ||
          (imagesSigmaDopplerByCptec[slug]?.length ?? 0) > 0 ||
          (imagesByStationDoppler[slug]?.length ?? 0) > 0;

        const createMarker = (lat: number, lng: number, title: string) => {
          const el = document.createElement('div');
          el.className = 'w-8 h-8 cursor-pointer group relative';
          if (hasAny) {
            el.innerHTML = `
            <div class="relative flex items-center justify-center w-full h-full transition-transform hover:scale-125">
              <div class="absolute inset-0 rounded-full bg-cyan-500/20 animate-ping" style="animation-duration: 2.5s;"></div>
              <img src="${RADAR_ICON_AVAILABLE}" alt="Radar On" class="w-8 h-8 object-contain drop-shadow-[0_0_8px_rgba(34,211,238,0.8)]" />
              <div class="absolute -top-8 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 bg-slate-900/90 text-cyan-50 text-[10px] px-2 py-1 rounded whitespace-nowrap pointer-events-none border border-slate-700 z-50 transition-opacity">${title}</div>
            </div>
          `;
          } else {
            el.innerHTML = `
            <div class="relative flex items-center justify-center w-full h-full opacity-50 transition-transform hover:scale-110 grayscale">
              <img src="${RADAR_ICON_UNAVAILABLE}" alt="Radar Off" class="w-8 h-8 object-contain" />
              <div class="absolute -top-8 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 bg-slate-900/90 text-slate-300 text-[10px] px-2 py-1 rounded whitespace-nowrap pointer-events-none border border-slate-700 z-50 transition-opacity">${title}</div>
            </div>
          `;
          }

          const marker = new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map);
          el.addEventListener('click', (e) => {
            e.stopPropagation();
            setFocusedSlug((prev) => (prev === slug ? null : slug));
          });
          radarMarkersRef.current.push(marker);
        };

        const iconLat = (st as any).iconLat ?? st.lat;
        const iconLng = (st as any).iconLng ?? st.lng;
        createMarker(iconLat, iconLng, st.name);

        if (st.aliases) {
          for (const alias of st.aliases) {
            createMarker(alias.lat, alias.lng, alias.name);
          }
        }
      }
    };

    if (splitScreen) {
      const mapL = mapSplitLeftRef.current;
      const mapR = mapSplitRightRef.current;
      if (!mapL || !mapR) return;
      addMarkersToMap(mapL);
      addMarkersToMap(mapR);
    } else {
      const map = mapSingleRef.current;
      if (!map) return;
      addMarkersToMap(map);
    }

    return () => {
      radarMarkersRef.current.forEach((m) => m.remove());
      radarMarkersRef.current = [];
    };
  }, [
    mapReady,
    stationsWithBounds,
    imagesByStationPpi,
    imagesRedemetPpiByCptec,
    imagesSigmaPpiByCptec,
    imagesSigmaDopplerByCptec,
    imagesByStationDoppler,
    focusedSlug,
    splitScreen,
    radarConfigs,
  ]);

  
  useEffect(() => {
    const renderPrevots = (map: maplibregl.Map | null, prefix: string) => {
      if (!map || !mapReady) return;
      const sourceId = `prevots-source-${prefix}`;
      const fillLayerId = `prevots-fill-${prefix}`;
      const lineLayerId = `prevots-line-${prefix}`;

      if (!prevotsOverlayVisible) {
        if (map.getLayer(fillLayerId)) map.removeLayer(fillLayerId);
        if (map.getLayer(lineLayerId)) map.removeLayer(lineLayerId);
        if (map.getSource(sourceId)) map.removeSource(sourceId);
        return;
      }

      const activeForecast = prevotsForecasts.find(f => f.date === prevotsForecastDate);
      if (!activeForecast) {
        if (map.getLayer(fillLayerId)) map.removeLayer(fillLayerId);
        if (map.getLayer(lineLayerId)) map.removeLayer(lineLayerId);
        if (map.getSource(sourceId)) map.removeSource(sourceId);
        return;
      }

      const features: GeoJSON.Feature<GeoJSON.Polygon>[] = activeForecast.polygons.map((p) => {
        const c = PREVOTS_LEVEL_COLORS[p.level];
        const hex = `#${c.slice(2, 8)}`;
        return {
          type: 'Feature',
          properties: { color: hex },
          geometry: {
            type: 'Polygon',
            coordinates: [p.coordinates.map(c => [c[1], c[0]])] // MapLibre wants [lng, lat]
          }
        };
      });

      const geojsonData: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features
      };

      if (map.getSource(sourceId)) {
        (map.getSource(sourceId) as maplibregl.GeoJSONSource).setData(geojsonData);
      } else {
        map.addSource(sourceId, { type: 'geojson', data: geojsonData });
        map.addLayer({
          id: fillLayerId,
          type: 'fill',
          source: sourceId,
          paint: {
            'fill-color': ['get', 'color'],
            'fill-opacity': 0.3
          }
        });
        map.addLayer({
          id: lineLayerId,
          type: 'line',
          source: sourceId,
          paint: {
            'line-color': ['get', 'color'],
            'line-width': 2
          }
        });
      }
    };

    if (splitScreen) {
      renderPrevots(mapSplitLeftRef.current, 'left');
      renderPrevots(mapSplitRightRef.current, 'right');
    } else {
      renderPrevots(mapSingleRef.current, 'single');
    }
  }, [prevotsOverlayVisible, prevotsForecasts, prevotsForecastDate, mapReady, splitScreen]);

  /** Camadas raster por radar — troca com raster-fade-duration para transição suave */
  useEffect(() => {
    if (!mapReady || !mapRasterIdle) return;

    if (splitScreen) {
      if (focusedSlug && !currentTs) return;
      if (!focusedSlug && !mosaicFramePpiAtIndex) return;
    } else {
      if (focusedSlug && !currentTs) return;
      if (!focusedSlug && !mosaicFrameAtIndex) return;
    }

    const gen = ++layerUpdateGenerationRef.current;

    const applyLayerToMap = (
      map: maplibregl.Map,
      panel: MapPanel,
      slug: string,
      url: string | null,
      kind: 'ppi' | 'doppler'
    ) => {
      const boundsStation =
        kind === 'doppler'
          ? (() => {
              const ss = getSigmaBucketSlugForCptecBucket(slug);
              // if sigma is selected for doppler
              // effectiveDopplerImagesBySlug determines source. Since we forced it to match ppiSourceBySlug
              if (ppiSourceBySlug[slug] === 'sigma' && ss) return findCptecBySlug(ss, radarConfigs) ?? findCptecBySlug(slug, radarConfigs);
              return findCptecBySlug(slug, radarConfigs);
            })()
          : (() => {
              const src = ppiSourceBySlug[slug];
              const rs = getRedemetBucketSlugForCptecBucket(slug);
              const ss = getSigmaBucketSlugForCptecBucket(slug);
              if (src === 'redemet' && rs) return findCptecBySlug(rs, radarConfigs) ?? findCptecBySlug(slug, radarConfigs);
              if (src === 'sigma' && ss) return findCptecBySlug(ss, radarConfigs) ?? findCptecBySlug(slug, radarConfigs);
              return findCptecBySlug(slug, radarConfigs);
            })();
      if (!boundsStation) return;
      const bounds = getRadarImageBounds(boundsStation);
      let coordinates = imageCoordinatesFromBounds(bounds);
      
      const config = radarConfigs.find(c => c.id === slug) || radarConfigs.find(c => c.stationSlug === boundsStation.slug);
      const targetOpacity = (config?.opacity !== undefined && config?.opacity !== null) ? config.opacity : (superResMode ? 0.95 : 0.88);

      if (config?.rotationDegrees) {
        // Rotate the 4 corners around the center
        const cx = (bounds.west + bounds.east) / 2;
        const cy = (bounds.north + bounds.south) / 2;
        const angleRad = (config.rotationDegrees * Math.PI) / 180;
        const cos = Math.cos(angleRad);
        const sin = Math.sin(angleRad);
        
        coordinates = coordinates.map(([x, y]) => {
          const dx = x - cx;
          const dy = y - cy;
          return [
            cx + dx * cos - dy * sin,
            cy + dx * sin + dy * cos
          ];
        }) as [[number, number], [number, number], [number, number], [number, number]];
      }

      const sid = sourceId(slug, panel);
      const lid = layerId(slug, panel);

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
              map.setPaintProperty(lid, 'raster-opacity', targetOpacity);
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
                'raster-opacity': targetOpacity,
                'raster-fade-duration': 200,
                'raster-resampling': 'nearest',
              },
            });
          }
        };
        if (!map.isStyleLoaded()) map.once('load', apply);
        else apply();
      };

      void (async () => {
        let nextUrl = absoluteUrl(url);
        if (slug === 'climatempo-poa') {
          const filtered = await filterClimatempoRadarImage(nextUrl);
          if (gen !== layerUpdateGenerationRef.current) return;
          nextUrl = filtered ?? nextUrl;
        }
        const mRadius = boundsStation.maskRadiusKm;
        if (mRadius !== undefined && mRadius < boundsStation.rangeKm || slug === 'ipmet-bauru' || slug === 'ipmet-prudente') {
          const radiusToUse = mRadius ?? boundsStation.rangeKm;
          const masked = await filterRadarImageCircularMask(nextUrl, boundsStation.lat, boundsStation.lng, radiusToUse, bounds);
          if (gen !== layerUpdateGenerationRef.current) return;
          nextUrl = masked ?? nextUrl;
        }
        if (superResMode) {
          if (kind === 'ppi') {
            const sr = await filterReflectivitySuperRes(nextUrl);
            if (gen !== layerUpdateGenerationRef.current) return;
            if (sr) nextUrl = sr;
          } else {
            const sr = await filterDopplerPurpleGreenNeighborSuperRes(nextUrl);
            if (gen !== layerUpdateGenerationRef.current) return;
            if (sr) nextUrl = sr;
          }
        }
        run(nextUrl);
      })();
    };

    const runForSlug = (
      map: maplibregl.Map,
      panel: MapPanel,
      slug: string,
      rawUrl: string | null,
      kind: 'ppi' | 'doppler'
    ) => {
      applyLayerToMap(map, panel, slug, rawUrl, kind);
    };

    if (splitScreen) {
      const mapL = mapSplitLeftRef.current;
      const mapR = mapSplitRightRef.current;
      if (!mapL || !mapR) return;

      for (const slug of stationsWithBounds) {
        const inDisplay = displaySlugs.includes(slug);
        if (!inDisplay) {
          if (mapL.getLayer(layerId(slug, 'left'))) mapL.setPaintProperty(layerId(slug, 'left'), 'raster-opacity', 0);
          if (mapR.getLayer(layerId(slug, 'right')))
            mapR.setPaintProperty(layerId(slug, 'right'), 'raster-opacity', 0);
          continue;
        }
        let urlPpi: string | null = null;
        let urlDop: string | null = null;
        if (focusedSlug && currentTs) {
          urlPpi = lookupsPpi[slug]?.get(currentTs)?.url ?? null;
          urlDop = dopplerUrlForTs(lookupsDoppler[slug] ?? new Map(), currentTs);
        } else {
          urlPpi = mosaicFramePpiAtIndex?.urlBySlug[slug] ?? null;
          urlDop = mosaicFrameDopAtIndex?.urlBySlug[slug] ?? null;
        }
        runForSlug(mapL, 'left', slug, urlPpi, 'ppi');
        runForSlug(mapR, 'right', slug, urlDop, 'doppler');
      }
      return;
    }

    const map = mapSingleRef.current;
    if (!map) return;

    for (const slug of stationsWithBounds) {
      const inDisplay = displaySlugs.includes(slug);
      if (!inDisplay) {
        const lid = layerId(slug, 'single');
        if (map.getLayer(lid)) map.setPaintProperty(lid, 'raster-opacity', 0);
        continue;
      }
      const rawUrl = focusedSlug
        ? lookups[slug]?.get(currentTs!)?.url
        : mosaicFrameAtIndex?.urlBySlug[slug];
      const kind: 'ppi' | 'doppler' = product === 'ppi' ? 'ppi' : 'doppler';
      applyLayerToMap(map, 'single', slug, rawUrl ?? null, kind);
    }
  }, [
    mapReady,
    mapRasterIdle,
    splitScreen,
    currentTs,
    lookups,
    lookupsPpi,
    lookupsDoppler,
    displaySlugs,
    stationsWithBounds,
    focusedSlug,
    mosaicFrameAtIndex,
    mosaicFramePpiAtIndex,
    mosaicFrameDopAtIndex,
    superResMode,
    product,
    ppiSourceBySlug,
    radarConfigs,
  ]);

  /** Pré-carrega frames vizinhos (como modelo numérico — menos flicker) */
  useEffect(() => {
    if (timelineTimes.length === 0) return;
    const si = safeIndex;
    const n = timelineTimes.length;
    const indices = [si, (si + 1) % n, (si - 1 + n) % n];
    const urls = new Set<string>();
    if (splitScreen) {
      if (focusedSlug) {
        for (const idx of indices) {
          const ts = timelineTimes[idx];
          if (!ts) continue;
          for (const slug of displaySlugs) {
            const uP = lookupsPpi[slug]?.get(ts)?.url;
            const uD = dopplerUrlForTs(lookupsDoppler[slug] ?? new Map(), ts);
            if (uP) urls.add(absoluteUrl(uP));
            if (uD) urls.add(absoluteUrl(uD));
          }
        }
      } else if (mosaicSyncPpi?.frames.length && mosaicSyncDop?.frames.length) {
        for (const idx of indices) {
          const fp = mosaicSyncPpi.frames[idx];
          const fd = mosaicSyncDop.frames[idx];
          if (!fp || !fd) continue;
          for (const u of Object.values(fp.urlBySlug)) urls.add(absoluteUrl(u));
          for (const u of Object.values(fd.urlBySlug)) urls.add(absoluteUrl(u));
        }
      }
    } else if (focusedSlug) {
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
  }, [
    safeIndex,
    timelineTimes,
    displaySlugs,
    lookups,
    lookupsPpi,
    lookupsDoppler,
    focusedSlug,
    mosaicSync?.frames,
    splitScreen,
    mosaicSyncPpi?.frames,
    mosaicSyncDop?.frames,
  ]);

  useEffect(() => {
    if (!isPlaying || timelineTimes.length < 2) return;
    const t = setInterval(() => {
      setTimelineCursor((prev) => {
        const n = timelineTimes.length;
        const si = prev === null ? n - 1 : Math.min(prev, n - 1);
        return (si + 1) % n;
      });
    }, 800 / animationSpeedMultiplier);
    return () => clearInterval(t);
  }, [isPlaying, timelineTimes.length, animationSpeedMultiplier]);

  const togglePlay = () => setIsPlaying((p) => !p);
  const prevFrame = () => {
    setIsPlaying(false);
    setTimelineCursor((prev) => {
      const n = timelineTimes.length;
      if (n === 0) return null;
      const si = prev === null ? n - 1 : Math.min(prev, n - 1);
      return (si - 1 + n) % n;
    });
  };
  const nextFrame = () => {
    setIsPlaying(false);
    setTimelineCursor((prev) => {
      const n = timelineTimes.length;
      if (n === 0) return null;
      const si = prev === null ? n - 1 : Math.min(prev, n - 1);
      return (si + 1) % n;
    });
  };

  const showEmptyBucketHelp = stations.length === 0 && !isLoading && !error;

  const stationTitle = focusedSlug
    ? (findCptecBySlug(focusedSlug, radarConfigs)?.name ?? focusedSlug)
    : 'Brasil — mosaico';
  const productLabel = splitScreen
    ? 'PPI + Doppler (mesmo instante)'
    : product === 'ppi'
      ? 'Refletividade (PPI)'
      : 'Velocidade radial (Doppler)';

  const fullDateTimeLabel =
    currentTs && currentTs.length === 12
      ? (() => {
          const d = new Date(
            Date.UTC(
              parseInt(currentTs.slice(0, 4), 10),
              parseInt(currentTs.slice(4, 6), 10) - 1,
              parseInt(currentTs.slice(6, 8), 10),
              parseInt(currentTs.slice(8, 10), 10),
              parseInt(currentTs.slice(10, 12), 10)
            )
          );
          return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' });
        })()
      : '—';

  const flyToUserLocation = () => {
    const map = splitScreen ? mapSplitLeftRef.current : mapSingleRef.current;
    if (!map || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        map.flyTo({
          center: [pos.coords.longitude, pos.coords.latitude],
          zoom: Math.max(map.getZoom(), 8),
          duration: 1200,
        });
      },
      () => {},
      { enableHighAccuracy: true, timeout: 12000 }
    );
  };

  const dbzLegendTicks = [-30, 0, 10, 20, 30, 40, 50, 60, 70, 80, 90];

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden bg-slate-900 text-slate-900">
      {error && (
        <div className="absolute inset-0 z-[40] flex items-center justify-center bg-black/70 p-4 text-center text-red-200 text-sm max-w-lg mx-auto pointer-events-auto">
          {error}
        </div>
      )}
      {isLoading && stations.length === 0 && !error && (
        <div className="absolute inset-0 z-[35] flex items-center justify-center bg-slate-950/90 pointer-events-auto">
          <div className="animate-spin rounded-full h-10 w-10 border-2 border-sky-500 border-t-transparent" />
        </div>
      )}

      {showEmptyBucketHelp && (
        <div className="absolute inset-0 z-[30] flex items-center justify-center p-6 pointer-events-auto">
          <div className="max-w-md rounded-2xl border border-white/10 bg-white/95 p-6 text-center text-slate-600 text-sm space-y-3 shadow-xl">
            <p className="font-semibold text-sky-700">Bucket vazio ou sem pastas</p>
            <p>
              Crie no GCS <code className="text-slate-800">radar_ao_vivo_2</code> uma pasta por radar. Refletividade:{' '}
              <code className="text-sky-800">chapeco/20251107120000.png</code> — Doppler:{' '}
              <code className="text-sky-800">chapeco/20251107120000-ppivr.png</code>
            </p>
          </div>
        </div>
      )}

      {!showEmptyBucketHelp && !error && (
        <>
          {splitScreen ? (
            <div className="absolute inset-0 z-0 flex min-h-0 w-full">
              <div ref={mapContainerSplitLeftRef} className="relative h-full min-h-0 min-w-0 flex-1" />
              <div className="w-px shrink-0 bg-teal-500/70" aria-hidden />
              <div ref={mapContainerSplitRightRef} className="relative h-full min-h-0 min-w-0 flex-1" />
            </div>
          ) : (
            <div ref={mapContainerSingleRef} className="absolute inset-0 z-0 h-full w-full" />
          )}
        </>
      )}

      {isLoading && stations.length > 0 && (
        <div className="absolute inset-0 z-[15] flex items-center justify-center bg-slate-950/35 pointer-events-none">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-sky-500 border-t-transparent" />
        </div>
      )}

        {/* UI flutuante (MapLibre GL — mesmo ecossistema Mapbox) */}
      {!showEmptyBucketHelp && (
        <div className="absolute inset-0 z-20 pointer-events-none">
          {/* Menu Dropdown - Canto Esquerdo */}
          <div className="absolute left-3 top-3 flex items-start gap-3 pointer-events-auto sm:left-4 sm:top-4 z-50">
            {/* Hambúrguer Menu original */}
            <div className="flex flex-col gap-2 relative">
              <button
                type="button"
                onClick={() => setIsMenuOpen((v) => !v)}
                className="flex h-[60px] w-[60px] items-center justify-center transition-all z-50 hover:scale-105 hover:shadow-[0_0_20px_rgba(56,189,248,0.8)] rounded-full overflow-hidden shadow-lg bg-[#0f172a] border border-white/10"
                title="Menu de Ferramentas"
              >
                <img 
                  src="https://raw.githubusercontent.com/stormchasermt-netizen/previsaomaster/d74421978486f01e69b68cafcc5e311b5f407b59/%C3%8Dcone%20de%20trov%C3%A3o%20em%20fundo%20transparente.png" 
                  alt="Menu" 
                  className="h-full w-full object-cover scale-[1.35]"
                />
              </button>

              <div className={`flex flex-col gap-2 transition-all duration-300 origin-top overflow-hidden ${isMenuOpen ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0 pointer-events-none'}`}>
                <Link
                  href="/"
                  className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/95 text-slate-700 shadow-lg ring-1 ring-black/5 transition hover:bg-white"
                  title="Início"
                >
                  <ChevronLeft className="h-5 w-5" />
                </Link>
                <button
                  type="button"
                  onClick={() => setPrevotsOverlayVisible(!prevotsOverlayVisible)}
                  className={`flex h-11 w-auto px-3 items-center justify-center rounded-xl shadow-lg ring-1 ring-black/5 transition ${
                    prevotsOverlayVisible ? 'bg-[#ff00ff] text-white shadow-[0_0_15px_rgba(255,0,255,0.4)]' : 'bg-white/95 text-slate-700 hover:bg-white'
                  }`}
                  title="Alternar Prevots"
                >
                  <ShieldAlert className="h-5 w-5 mr-2" />
                  <span className="font-bold text-sm">Prevots</span>
                </button>
                <button
                  type="button"
                  onClick={() => setReportStep('location')}
                  className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-500/90 text-slate-900 shadow-[0_0_15px_rgba(245,158,11,0.3)] transition hover:bg-amber-400 hover:scale-105"
                  title="Enviar relato"
                >
                  <AlertTriangle className="h-5 w-5" />
                </button>

                <button
                  type="button"
                  onClick={() => setSuperResMode((v) => !v)}
                  title="Super Res — refletividade: remove ruído branco/cinza. Doppler: remove roxo isolado junto de verde (±2 px), preservando interfaces verde↔vermelho (couplets)."
                  className={`flex min-h-[3.25rem] w-11 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1.5 text-center shadow-lg ring-1 ring-black/5 transition ${
                    superResMode ? 'bg-sky-600 text-white' : 'bg-white/95 text-slate-700 hover:bg-white'
                  }`}
                >
                  <Sparkles className="h-4 w-4 shrink-0" />
                  <span className="max-w-full text-[6px] font-bold leading-[1.1]">
                    <span className="block">Super</span>
                    <span className="block">Res</span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setSplitScreen((s) => !s)}
                  className={`flex h-11 w-11 items-center justify-center rounded-xl shadow-lg ring-1 ring-black/5 transition ${
                    splitScreen ? 'bg-sky-600 text-white' : 'bg-white/95 text-slate-700 hover:bg-white'
                  }`}
                  title={splitScreen ? 'Desativar Visão Dupla' : 'Ativar Visão Dupla'}
                >
                  <Columns2 className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={flyToUserLocation}
                  className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/95 text-slate-700 shadow-lg ring-1 ring-black/5 transition hover:bg-white"
                  title="Minha Localização"
                >
                  <Navigation className="h-5 w-5" />
                </button>
                {!splitScreen && (
                  <button
                    type="button"
                    title="Produto (atalho)"
                    onClick={() => setProduct((p) => (p === 'ppi' ? 'doppler' : 'ppi'))}
                    className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/95 text-amber-600 shadow-lg ring-1 ring-black/5 transition hover:bg-white"
                  >
                    <Zap className="h-5 w-5" />
                  </button>
                )}
                {!splitScreen && (
                  <div className="flex flex-col overflow-hidden rounded-xl bg-white/95 shadow-lg ring-1 ring-black/5 mb-2">
                    <button
                      type="button"
                      onClick={() => setProduct('ppi')}
                      className={`px-2.5 py-2 text-[10px] font-bold uppercase tracking-wide ${
                        product === 'ppi' ? 'bg-sky-600 text-white' : 'text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      PPI
                    </button>
                    <button
                      type="button"
                      onClick={() => setProduct('doppler')}
                      className={`border-t border-slate-200 px-2.5 py-2 text-[10px] font-bold uppercase tracking-wide ${
                        product === 'doppler' ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      Dop
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Galeria de Mapa Base - Canto Direito */}
          <div className="absolute right-3 top-3 flex items-start gap-3 pointer-events-auto sm:right-4 sm:top-4 z-50">
            {/* Base Map Picker */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowBaseMapGallery((v) => !v)}
                className={`flex h-[60px] w-[60px] items-center justify-center rounded-full transition-all hover:scale-105 shadow-lg border border-white/10 ${showBaseMapGallery ? 'bg-cyan-600 text-white shadow-[0_0_20px_rgba(56,189,248,0.5)]' : 'bg-[#0f172a] text-slate-300 hover:text-white'}`}
                title="Tipo de mapa"
              >
                <Layers className="h-6 w-6" />
              </button>
              <AnimatePresence>
                {showBaseMapGallery && (
                  <>
                    <div className="fixed inset-0 z-[49] cursor-default" onClick={() => setShowBaseMapGallery(false)} aria-hidden />
                    <motion.div
                      initial={{ opacity: 0, y: -10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -10, scale: 0.95 }}
                      transition={{ duration: 0.2 }}
                      className="absolute right-0 top-full mt-2 z-[60] grid w-[280px] grid-cols-2 gap-2 rounded-2xl bg-[#0F131C]/95 p-3 shadow-2xl ring-1 ring-white/10 backdrop-blur-xl sm:w-[320px]"
                    >
                      {BASE_MAP_OPTIONS.map((opt) => (
                        <button
                          key={opt.id}
                          onClick={() => {
                            setBaseMapId(opt.id);
                            setShowBaseMapGallery(false);
                          }}
                          className={`group relative flex aspect-video flex-col overflow-hidden rounded-xl border text-left transition-all ${
                            baseMapId === opt.id
                              ? 'border-cyan-500 ring-2 ring-cyan-500/30'
                              : 'border-white/10 hover:border-white/30'
                          }`}
                        >
                          <img
                            src={opt.previewUrl}
                            alt={opt.label}
                            className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                            loading="lazy"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-[#0F131C]/90 via-[#0F131C]/20 to-transparent" />
                          
                          {baseMapId === opt.id && (
                            <div className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-cyan-500 text-slate-950 shadow-sm">
                              <Check className="h-3 w-3" strokeWidth={3} />
                            </div>
                          )}
                          
                          <span className="absolute bottom-1.5 left-2 right-2 truncate text-[11px] font-medium text-white drop-shadow-md sm:bottom-2 sm:left-2.5 sm:text-xs">
                            {opt.label}
                          </span>
                        </button>
                      ))}
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Legenda — centro superior (dividido: PPI + Doppler m/s) */}
          <div
            className={`pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 sm:top-4 ${
              splitScreen ? 'w-[min(98vw,720px)]' : 'w-[min(96vw,520px)]'
            }`}
          >
            {splitScreen ? (
              <div className="flex gap-2 sm:gap-3">
                <div className="min-w-0 flex-1 rounded-2xl bg-white/95 px-2 py-2 shadow-lg ring-1 ring-black/5 sm:px-3 sm:py-2.5">
                  <div className="mb-1 flex items-center justify-between gap-1">
                    <span className="text-[10px] font-bold text-slate-900 sm:text-[11px]">dBZ</span>
                    <span className="text-[8px] text-slate-600 sm:text-[9px]">Refletividade</span>
                  </div>
                  <div
                    className="h-3 w-full rounded-md shadow-inner"
                    style={{
                      background:
                        'linear-gradient(90deg,#6b6b6b 0%,#00c8ff 8%,#00ff66 22%,#ffff00 38%,#ff9900 52%,#ff0000 66%,#ff00ff 80%,#ffffff 100%)',
                    }}
                  />
                  <div className="mt-1 flex justify-between text-[7px] font-medium tabular-nums text-slate-700 sm:text-[8px]">
                    {dbzLegendTicks.map((t) => (
                      <span key={t}>{t}</span>
                    ))}
                  </div>
                </div>
                <div className="min-w-0 flex-1 rounded-2xl bg-white/95 px-2 py-2 shadow-lg ring-1 ring-black/5 sm:px-3 sm:py-2.5">
                  <div className="mb-1 flex items-center justify-between gap-1">
                    <span className="text-[10px] font-bold text-slate-900 sm:text-[11px]">m/s</span>
                    <span className="text-[8px] text-slate-600 sm:text-[9px]">Doppler</span>
                  </div>
                  <div
                    className="h-3 w-full rounded-md shadow-inner"
                    style={{ background: DOPPLER_LEGEND_GRADIENT_MS }}
                  />
                  <div className="mt-1 flex justify-between text-[7px] font-medium tabular-nums text-slate-700 sm:text-[8px]">
                    {DOPPLER_LEGEND_TICKS_MS.map((t) => (
                      <span key={t} className="max-w-[2rem] truncate sm:max-w-none">
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl bg-white/95 px-3 py-2 shadow-lg ring-1 ring-black/5 sm:px-4 sm:py-2.5">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-[11px] font-bold text-slate-800">{product === 'ppi' ? 'dBZ' : 'm/s'}</span>
                  <span className="text-[9px] text-slate-500">
                    {product === 'ppi' ? 'Refletividade' : 'Doppler (aprox.)'}
                  </span>
                </div>
                {product === 'ppi' ? (
                  <>
                    <div
                      className="h-3 w-full rounded-md shadow-inner"
                      style={{
                        background:
                          'linear-gradient(90deg,#6b6b6b 0%,#00c8ff 8%,#00ff66 22%,#ffff00 38%,#ff9900 52%,#ff0000 66%,#ff00ff 80%,#ffffff 100%)',
                      }}
                    />
                    <div className="mt-1 flex justify-between text-[8px] font-medium tabular-nums text-slate-600 sm:text-[9px]">
                      {dbzLegendTicks.map((t) => (
                        <span key={t}>{t}</span>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    <div
                      className="h-3 w-full rounded-md shadow-inner"
                      style={{ background: DOPPLER_LEGEND_GRADIENT_MS }}
                    />
                    <div className="mt-1 flex justify-between text-[8px] font-medium tabular-nums text-slate-600 sm:text-[9px]">
                      {DOPPLER_LEGEND_TICKS_MS.map((t) => (
                        <span key={t}>{t}</span>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Aviso sem timeline */}
          {timelineTimes.length === 0 && stationsWithBounds.length > 0 && !isLoading && !error && (
            <div className="absolute bottom-28 left-1/2 z-10 w-[min(calc(100%-2rem),28rem)] -translate-x-1/2 rounded-2xl bg-white/95 p-4 text-sm text-slate-700 shadow-lg ring-1 ring-black/5 pointer-events-auto sm:bottom-32">
              {!focusedSlug && hasAnyStationImages ? (
                <>
                  Nenhuma imagem{' '}
                  {splitScreen ? 'PPI ou Doppler (-ppivr)' : product === 'ppi' ? 'PPI' : 'Doppler (-ppivr)'} na{' '}
                  <strong className="text-slate-900">última hora</strong> para o mosaico sincronizado.
                </>
              ) : (
                <>
                  Nenhuma imagem{' '}
                  {splitScreen ? 'PPI ou Doppler (-ppivr)' : product === 'ppi' ? 'PPI' : 'Doppler (-ppivr)'} nas pastas do bucket para os radares listados.
                </>
              )}
            </div>
          )}

          {/* Barra inferior — vidro escuro + texto branco (legível sobre o mapa) */}
          {timelineTimes.length > 0 && (
            <div className="absolute bottom-4 left-1/2 z-30 w-[min(96vw,560px)] -translate-x-1/2 pointer-events-auto sm:bottom-6">
              <div className="rounded-[28px] border border-white/15 bg-slate-950/75 px-3 py-3 shadow-[0_8px_40px_rgba(0,0,0,0.45)] backdrop-blur-md sm:px-5 sm:py-4">
                <div className="flex flex-wrap items-center gap-3 sm:gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <p className="min-w-0 truncate text-[11px] font-semibold text-white sm:text-sm">
                        {stationTitle}
                      </p>
                      {(focusedSlug && (hasRedemetFallback(bucketSlugToCatalogSlug(focusedSlug)) || hasSigmaFallback(bucketSlugToCatalogSlug(focusedSlug)))) && (
                        <select
                          value={focusedRadarSource}
                          onChange={(e) => {
                            setFocusedRadarSource(e.target.value as FocusedRadarSourceMode);
                            setTimelineCursor(null);
                          }}
                          className="pointer-events-auto max-w-[10rem] shrink-0 rounded-lg border border-white/25 bg-slate-900/90 px-2 py-1 text-[10px] font-semibold text-white ring-1 ring-white/10 sm:max-w-[12rem] sm:text-xs"
                          title="Fonte do radar"
                          aria-label="Fonte do radar (CPTEC, REDEMET ou SIGMA)"
                        >
                          <option value="auto">Automático</option>
                          <option value="cptec">CPTEC</option>
                          {hasRedemetFallback(bucketSlugToCatalogSlug(focusedSlug)) && <option value="redemet">REDEMET</option>}
                          {hasSigmaFallback(bucketSlugToCatalogSlug(focusedSlug)) && <option value="sigma">SIGMA</option>}
                        </select>
                      )}
                    </div>
                    <p className="truncate text-[10px] text-white/75">{productLabel}</p>
                    <p className="font-mono text-[11px] text-white sm:text-xs">{fullDateTimeLabel}</p>
                  </div>

                  <div className="flex flex-shrink-0 items-center gap-2 sm:gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setIsPlaying(false);
                        prevFrame();
                      }}
                      title="Anterior"
                      className="flex h-10 w-10 items-center justify-center rounded-full bg-sky-600 text-white shadow-md transition hover:bg-sky-700 sm:h-11 sm:w-11"
                    >
                      <SkipBack className="h-5 w-5" />
                    </button>
                    <button
                      type="button"
                      onClick={togglePlay}
                      title={isPlaying ? 'Pausar' : 'Reproduzir'}
                      className="flex h-12 w-12 items-center justify-center rounded-full bg-sky-600 text-white shadow-md transition hover:bg-sky-700 sm:h-14 sm:w-14"
                    >
                      {isPlaying ? <Pause className="h-6 w-6" /> : <Play className="h-6 w-6 pl-0.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsPlaying(false);
                        nextFrame();
                      }}
                      title="Seguinte"
                      className="flex h-10 w-10 items-center justify-center rounded-full bg-sky-600 text-white shadow-md transition hover:bg-sky-700 sm:h-11 sm:w-11"
                    >
                      <SkipForward className="h-5 w-5" />
                    </button>
                  </div>

                  <div className="ml-auto flex flex-shrink-0 items-center gap-1 sm:gap-2">
                    <button
                      type="button"
                      onClick={() => setBottomPanelExpanded((e) => !e)}
                      title={bottomPanelExpanded ? 'Ocultar linha do tempo' : 'Mostrar linha do tempo'}
                      className="flex h-9 w-9 items-center justify-center rounded-full text-white/85 transition hover:bg-white/15 hover:text-white"
                    >
                      <ChevronUp
                        className={`h-5 w-5 transition-transform ${bottomPanelExpanded ? '' : 'rotate-180'}`}
                      />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (focusedSlug) setFocusedSlug(null);
                      }}
                      title={focusedSlug ? 'Voltar ao mosaico' : 'Mosaico ativo'}
                      className={`flex h-9 w-9 items-center justify-center rounded-full transition ${
                        focusedSlug
                          ? 'text-white/90 hover:bg-white/15'
                          : 'cursor-default text-white/35'
                      }`}
                      disabled={!focusedSlug}
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>
                </div>

                {bottomPanelExpanded && (
                  <div className="mt-3 border-t border-white/25 pt-3">
                    <div className="mb-2 flex items-center justify-between gap-2 text-[10px] text-white/90">
                      <span>
                        {timelineTimes.length - 1 - safeIndex === 0
                          ? 'Instante atual'
                          : `−${(timelineTimes.length - 1 - safeIndex) * 5} min (aprox.)`}
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setAnimationSpeedMultiplier((prev) => (prev === 1 ? 2 : prev === 2 ? 5 : 1))
                          }
                          className="rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-bold text-white ring-1 ring-white/25"
                        >
                          {animationSpeedMultiplier}×
                        </button>
                        <span
                          className={
                            safeIndex === timelineTimes.length - 1
                              ? 'font-bold text-emerald-300'
                              : 'text-white/60'
                          }
                        >
                          {safeIndex === timelineTimes.length - 1 ? '● Ao vivo' : 'Histórico'}
                        </span>
                      </div>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max={timelineTimes.length - 1}
                      step="1"
                      value={safeIndex}
                      onChange={(e) => {
                        setIsPlaying(false);
                        setTimelineCursor(parseInt(e.target.value, 10));
                      }}
                      className="h-3 w-full cursor-pointer accent-sky-400 [color-scheme:dark]"
                    />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
