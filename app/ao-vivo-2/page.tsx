'use client';

import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Radio, Users, X, Home, MapPin, Layers, Radar, Check, Menu, Play, Pause, SkipBack, SkipForward, LayoutGrid, Square, AlertTriangle, Send, Link2, Upload, Search, Crosshair, Loader2, Save, Calendar, Info, Video, Maximize2, Minimize2, Instagram, Twitter, Zap, Eye, Pencil } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { updatePresence, removePresence, subscribeToPresence, type PresenceData } from '@/lib/presence';
import { subscribeToTodayReports, saveStormReport, recordReportView, type StormReport } from '@/lib/stormReportStore';
import {
  MAP_STYLE_DARK,
  MAP_STYLE_WHITE,
  MAP_STYLE_MIDNIGHT,
  MAP_STYLE_CLEAN_DARK,
  LOCATION_REQUEST_EXCLUDED_UIDS
} from '@/lib/constants';
import {
  type CptecRadarStation,
  CPTEC_RADAR_STATIONS,
  getRadarImageBounds,
  calculateRadarBounds,
  buildNowcastingPngUrl,
  getNearestRadarTimestamp,
  getNowMinusMinutesTimestamp12UTC,
  subtractMinutesFromTimestamp12UTC,
  floorTimestampToInterval,
} from '@/lib/cptecRadarStationsV2';
import { fetchPrevotsForecasts } from '@/lib/prevotsForecastStore';
import { PREVOTS_LEVEL_COLORS, type PrevotsForecast } from '@/lib/prevotsForecastData';
import { fetchRadarConfigs, saveRadarConfig, type RadarConfig } from '@/lib/radarConfigStore';
import { hasRedemetFallback, getRedemetArea } from '@/lib/redemetRadar';
import { getIpmetStorageUrlCandidates } from '@/lib/ipmetStorage';
import { filterRadarImageFromUrl, filterClimatempoRadarImage, filterDopplerSuperRes } from '@/lib/radarImageFilter';
import { fetchRadarApiCached } from '@/lib/radarApiCache';
import { collectRadarPreloadUrls, preloadRadarAnimationFrames, type RadarProductPreload } from '@/lib/radarAnimationPreload';
import { Room, RoomEvent, Track } from 'livekit-client';
import { recordVisit, subscribeToTodayVisitCount } from '@/lib/visitCounter';
import { fetchAllRadarViews, incrementRadarViews } from '@/lib/radarViewsStore';

import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

type DisplayRadar = { type: 'cptec'; station: CptecRadarStation };

type BaseMapId = 'satellite' | 'streets' | 'topo' | 'toner';

// Re-implementação da função groupRadarsByLocation para DisplayRadar simples
function groupRadarsByLocation(radars: DisplayRadar[]) {
  const groups = new Map<string, DisplayRadar[]>();
  radars.forEach(r => {
    // Organiza todos no Brasil por enquanto, pode ser melhorado
    const key = `Brasil-CPTEC`; 
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  });
  return Array.from(groups.entries()).map(([k, v]) => ({
    country: k.split('-')[0],
    state: k.split('-')[1],
    radars: v
  }));
}

const MAPTILER_KEY = 'WyOGmI7ufyBLH3G7aX9o';

const BASE_MAP_OPTIONS: { id: BaseMapId; label: string; styleUrl: string; previewUrl: string }[] = [
  { 
    id: 'satellite', 
    label: 'Satélite', 
    styleUrl: `https://api.maptiler.com/maps/hybrid-v4/style.json?key=${MAPTILER_KEY}`,
    previewUrl: `https://raw.githubusercontent.com/stormchasermt-netizen/previsaomaster/289c0229e6b781ea1c1a5c4161b6fe2da53fe1ee/Captura%20de%20tela%202026-03-30%20212709.png`
  },
  { 
    id: 'streets', 
    label: 'Ruas', 
    styleUrl: `https://api.maptiler.com/maps/streets-v4/style.json?key=${MAPTILER_KEY}`,
    previewUrl: `https://raw.githubusercontent.com/stormchasermt-netizen/previsaomaster/289c0229e6b781ea1c1a5c4161b6fe2da53fe1ee/Captura%20de%20tela%202026-03-30%20212655.png`
  },
  { 
    id: 'topo', 
    label: 'Relevos', 
    styleUrl: `https://api.maptiler.com/maps/topo-v4/style.json?key=${MAPTILER_KEY}`,
    previewUrl: `https://raw.githubusercontent.com/stormchasermt-netizen/previsaomaster/289c0229e6b781ea1c1a5c4161b6fe2da53fe1ee/Captura%20de%20tela%202026-03-30%20212638.png`
  },
  { 
    id: 'toner', 
    label: 'Branco', 
    styleUrl: `https://api.maptiler.com/maps/toner-v2/style.json?key=${MAPTILER_KEY}`,
    previewUrl: `https://raw.githubusercontent.com/stormchasermt-netizen/previsaomaster/289c0229e6b781ea1c1a5c4161b6fe2da53fe1ee/Captura%20de%20tela%202026-03-30%20212551.png`
  },
];

/** Revolução WebGL - Dashboard purificado */

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function getProxiedRadarUrl(url: string): string {
  if (typeof window === 'undefined') return url;
  if (url.startsWith('/api/')) return url;
  return `/api/radar-proxy?url=${encodeURIComponent(url)}`;
}

/** Texto seguro para HTML em popups (evita quebra por aspas / XSS). */
function escapeHtmlForPopup(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Retorna [proxyUrl, directUrl] — fallback direto quando proxy retorna Backend Not Found (Firebase). */
function getRadarUrlsWithFallback(url: string): [string, string] {
  return [getProxiedRadarUrl(url), url];
}

/** Sonda CPTEC (radar-exists) — sem /api/radar-frame (evita cadeia API no servidor). */
async function probeRadarImageExists(
  dr: DisplayRadar,
  ts12: string,
  productType: 'reflectividade' | 'velocidade' | 'vil' | 'waldvogel',
  slugParam: string,
  signal?: AbortSignal,
  isHistorical: boolean = false
): Promise<boolean> {
  const url = buildNowcastingPngUrl(dr.station, ts12, productType, true);
  const res = await fetch(`/api/radar-exists?url=${encodeURIComponent(url)}`, { cache: 'no-store', signal });
  const data = await res.json().catch(() => ({}));
  if (data.exists === true) return true;

  return false;
}

/** Filtra minutos atrás usando hora de referência (ao vivo ou histórico) + CPTEC. */
async function filterValidSliderMinutesAgo(
  dr: DisplayRadar,
  productType: 'reflectividade' | 'velocidade' | 'vil' | 'waldvogel',
  maxMinutes: number,
  radarConfigs: RadarConfig[],
  referenceTs12: string,
  isHistorical: boolean,
  signal?: AbortSignal
): Promise<number[]> {
  const configSlug = dr.station.slug;
  const cfg = radarConfigs.find((c) => c.stationSlug === configSlug);

  const radarInterval = cfg?.updateIntervalMinutes ?? (dr.station.updateIntervalMinutes ?? 10);
  const step = Math.max(1, radarInterval);
  const candidates: number[] = [];
  for (let m = 0; m <= maxMinutes; m += step) candidates.push(m);
  if (candidates.length === 0) return [0];

  /** Chapecó (CPTEC Nowcasting): busca frames reais da API */
  if (dr.station.slug === 'chapeco' && !isHistorical) {
    const radarId = productType === 'velocidade' ? dr.station.velocityId : dr.station.id;
    try {
      const res = await fetch(`/api/nowcasting/chapeco/frames?radarId=${encodeURIComponent(radarId || dr.station.id)}`, { cache: 'no-store', signal });
      const data = await res.json().catch(() => ({ frames: [] }));
      const frames: { ts12: string; datahora: string }[] = data.frames || [];
      if (frames.length === 0) return [0];
      const baseTs12 = referenceTs12;
      const baseY = parseInt(baseTs12.slice(0, 4), 10);
      const baseM = parseInt(baseTs12.slice(4, 6), 10) - 1;
      const baseD = parseInt(baseTs12.slice(6, 8), 10);
      const baseHH = parseInt(baseTs12.slice(8, 10), 10);
      const baseMM = parseInt(baseTs12.slice(10, 12), 10);
      const baseDateMs = Date.UTC(baseY, baseM, baseD, baseHH, baseMM);
      const result: number[] = [];
      frames.forEach(f => {
        const fy = parseInt(f.ts12.slice(0, 4), 10);
        const fm = parseInt(f.ts12.slice(4, 6), 10) - 1;
        const fd = parseInt(f.ts12.slice(6, 8), 10);
        const fhh = parseInt(f.ts12.slice(8, 10), 10);
        const fmm = parseInt(f.ts12.slice(10, 12), 10);
        const fileDateMs = Date.UTC(fy, fm, fd, fhh, fmm);
        const diffMin = Math.round((baseDateMs - fileDateMs) / 60000);
        if (diffMin >= 0 && diffMin <= maxMinutes) result.push(diffMin);
      });
      result.sort((a, b) => b - a);
      return result.length > 0 ? result : [0];
    } catch {
      return [0];
    }
  }

  /** SIPAM-HD: busca frames reais da API SIPAM (quando HD ativo e estação tem sipamSlug) */
  if (dr.type === 'cptec' && dr.station.sipamSlug && !isHistorical) {
    try {
      const res = await fetch(`/api/sipam/frames?radar=${encodeURIComponent(dr.station.sipamSlug)}`, { cache: 'no-store', signal });
      const data = await res.json().catch(() => ({ frames: [] }));
      const frames: { ts12: string; datahora: string }[] = data.frames || [];
      if (frames.length === 0) return [0];
      const baseTs12 = referenceTs12;
      const baseY = parseInt(baseTs12.slice(0, 4), 10);
      const baseM = parseInt(baseTs12.slice(4, 6), 10) - 1;
      const baseD = parseInt(baseTs12.slice(6, 8), 10);
      const baseHH = parseInt(baseTs12.slice(8, 10), 10);
      const baseMM = parseInt(baseTs12.slice(10, 12), 10);
      const baseDateMs = Date.UTC(baseY, baseM, baseD, baseHH, baseMM);
      const result: number[] = [];
      frames.forEach(f => {
        const fy = parseInt(f.ts12.slice(0, 4), 10);
        const fm = parseInt(f.ts12.slice(4, 6), 10) - 1;
        const fd = parseInt(f.ts12.slice(6, 8), 10);
        const fhh = parseInt(f.ts12.slice(8, 10), 10);
        const fmm = parseInt(f.ts12.slice(10, 12), 10);
        const fileDateMs = Date.UTC(fy, fm, fd, fhh, fmm);
        const diffMin = Math.round((baseDateMs - fileDateMs) / 60000);
        if (diffMin >= 0 && diffMin <= maxMinutes) result.push(diffMin);
      });
      result.sort((a, b) => b - a);
      return result.length > 0 ? result : [0];
    } catch {
      return [0];
    }
  }

  const slugParam = dr.type === 'cptec' ? dr.station.slug : `argentina:${dr.station.id}`;
  const BATCH = 6;
  const result: number[] = [];
  for (let i = 0; i < candidates.length; i += BATCH) {
    if (signal?.aborted) return candidates;
    const batch = candidates.slice(i, i + BATCH);
    const checks = await Promise.all(
      batch.map(async (minutesAgo) => {
        for (let windowOffset = 0; windowOffset < 10; windowOffset++) {
          const searchMin = minutesAgo + windowOffset;
          const ts12 = subtractMinutesFromTimestamp12UTC(referenceTs12, searchMin);
          try {
            if (await probeRadarImageExists(dr, ts12, productType, slugParam, signal, isHistorical)) return true;
          } catch {
            /* próximo offset */
          }
          if (signal?.aborted) break;
        }
        return false;
      })
    );
    batch.forEach((m, j) => { if (checks[j]) result.push(m); });
  }
  // Retornamos em ordem decrescente (mais antigo primeiro -> mais recente no final)
  result.reverse();
  return result.length > 0 ? result : [0];
}

/** Ícone radar disponível: verde forte com símbolo de antena (modelo imagem 1). */
const RADAR_ICON_AVAILABLE = 'https://raw.githubusercontent.com/stormchasermt-netizen/previsaomaster/7e352d326e59aa65efc40ce2979d5a078a393dc4/radar-icon-svg-download-png-8993769.webp';

/** Ícone radar indisponível: verde apagado com barra diagonal (sem imagem no horário). */
const RADAR_ICON_UNAVAILABLE = 'https://raw.githubusercontent.com/stormchasermt-netizen/previsaomaster/7e352d326e59aa65efc40ce2979d5a078a393dc4/radar-icon-svg-download-png-8993769.webp';

const dBZ_COLORS = [
  { hex: '#8B8589', val: -30 },
  { hex: '#F5F5DC', val: -20 },
  { hex: '#E5E4E2', val: -10 },
  { hex: '#0000FF', val: 0 },
  { hex: '#00FFFF', val: 10 },
  { hex: '#00FF00', val: 20 },
  { hex: '#006400', val: 30 },
  { hex: '#FFFF00', val: 40 },
  { hex: '#FFA500', val: 50 },
  { hex: '#8B0000', val: 60 },
  { hex: '#800080', val: 70 },
  { hex: '#00CED1', val: 80 },
  { hex: '#000000', val: 90 },
];

const VEL_COLORS = [
  { hex: '#FF69B4', val: -60 },
  { hex: '#00008B', val: -50 },
  { hex: '#00FFFF', val: -40 },
  { hex: '#E0FFFF', val: -30 },
  { hex: '#00FF00', val: -20 },
  { hex: '#006400', val: -10 },
  { hex: '#A9A9A9', val: 0 },
  { hex: '#8B0000', val: 10 },
  { hex: '#FF0000', val: 20 },
  { hex: '#FFA500', val: 30 },
  { hex: '#FFFF00', val: 40 },
  { hex: '#808000', val: 50 },
  { hex: '#002200', val: 60 },
];

function hexToRgb(hex: string) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { r, g, b };
}

function findClosestValue(r: number, g: number, b: number, palette: { hex: string; val: number }[]) {
  if (r === 0 && g === 0 && b === 0) return null; // Transparent or black background (usually 0 outside data)
  let minDiff = Infinity;
  let closestVal: number | null = null;
  for (const item of palette) {
    const rgb = hexToRgb(item.hex);
    const diff = Math.sqrt(Math.pow(r - rgb.r, 2) + Math.pow(g - rgb.g, 2) + Math.pow(b - rgb.b, 2));
    if (diff < minDiff) {
      minDiff = diff;
      closestVal = item.val;
    }
  }
  return minDiff < 60 ? closestVal : null; // Threshold to avoid matching noise
}

export default function AoVivoPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { addToast } = useToast();
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const recentNowcastingSuccessRef = useRef<number>(0);
  const mapContainerRef = useRef<HTMLDivElement>(null);

  const [mapReady, setMapReady] = useState(false);
  const [locationPermission, setLocationPermission] = useState<'unknown' | 'granted' | 'denied'>('unknown');
  /** Tipo de erro para mensagem mais específica: denied | timeout | unavailable */
  const [locationErrorType, setLocationErrorType] = useState<'denied' | 'timeout' | 'unavailable' | null>(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const [myLocation, setMyLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [radarProductType, setRadarProductType] = useState<'reflectividade' | 'velocidade'>('reflectividade');
  const [radarMode, setRadarMode] = useState<'mosaico' | 'unico'>('mosaico');
  /** Modo individual: Set de IDs ativados (cptec:slug | argentina:id) */
  const [selectedIndividualRadars, setSelectedIndividualRadars] = useState<Set<string>>(new Set());
  /** Quando setado, filtra para mostrar apenas esse radar (clicou no ícone do mapa). null = mosaico/lista */
  const [focusedRadarKey, setFocusedRadarKey] = useState<string | null>(null);
  const [radarOpacity, setRadarOpacity] = useState(0.75);
  const [showOnlinePanel, setShowOnlinePanel] = useState(false);
  const [showBaseMapGallery, setShowBaseMapGallery] = useState(false);
  const [baseMapId, setBaseMapId] = useState<BaseMapId>('satellite');
  const [onlineUsers, setOnlineUsers] = useState<PresenceData[]>([]);
  const [radarConfigs, setRadarConfigs] = useState<RadarConfig[]>([]);
  /** Timestamp nominal em UTC: ~3 min atrás (CPTEC usa UTC nas imagens), atualizado a cada 30 s */
  const [radarTimestamp, setRadarTimestamp] = useState<string>(() => getNowMinusMinutesTimestamp12UTC(3));
  /** Minutos atrás no slider (0 = agora, até meia-noite de hoje). Usado para controle manual do tempo. */
  const [sliderMinutesAgo, setSliderMinutesAgo] = useState(0);
  /** Slider visual para debounce */
  const [uiSliderMinutesAgo, setUiSliderMinutesAgo] = useState(0);
  /** Modo único: só horários com imagem (slider discreto). null = mosaico ou não carregado. */
  const [validSliderMinutesAgo, setValidSliderMinutesAgo] = useState<number[] | null>(null);
  /** Imagens anteriores: data/hora selecionada. null = modo ao vivo. */
  const [historicalTimestampOverride, setHistoricalTimestampOverride] = useState<string | null>(null);
  const [historicalDate, setHistoricalDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [historicalTime, setHistoricalTime] = useState('12:00');
  const [sampledValue1, setSampledValue1] = useState<number | null>(null);
  const [sampledValue2, setSampledValue2] = useState<number | null>(null);
  const [sampledValue3, setSampledValue3] = useState<number | null>(null);
  const [sampledValue4, setSampledValue4] = useState<number | null>(null);
  const [showCrosshair, setShowCrosshair] = useState(false);
  const cachedImageDataMap = useRef(new Map<string, { img: HTMLImageElement, canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D }>());
  
  // Instância única do Worker — crachás (reqId) evitam trocar imagem entre radares e permitem fallback em cadeia
  const radarWorkerRef = useRef<Worker | null>(null);
  const workerCallbacks = useRef(new Map<string, (url: string | null, err?: string) => void>());
  useEffect(() => {
    const worker = new Worker(new URL('../../workers/radarFilter.worker.ts', import.meta.url));
    worker.onmessage = (e: MessageEvent<{ id?: string; url?: string; error?: string }>) => {
      const { id, url, error } = e.data || {};
      if (id && workerCallbacks.current.has(id)) {
        const callback = workerCallbacks.current.get(id);
        if (callback) callback(url ?? null, error);
        workerCallbacks.current.delete(id);
      }
    };
    radarWorkerRef.current = worker;
    return () => {
      workerCallbacks.current.clear();
      worker.terminate();
      radarWorkerRef.current = null;
    };
  }, []);

  const [radarViewsRecord, setRadarViewsRecord] = useState<Record<string, number>>({});
  const [calendarMode, setCalendarMode] = useState<'days' | 'months' | 'years'>('days');
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
    fetchAllRadarViews().then(setRadarViewsRecord).catch(console.error);
  }, []);

  /** Máximo de minutos atrás: travado em 60 min (1 h) — mosaico, individual e histórico */
  const maxSliderMinutesAgo = useMemo(() => 60, [historicalTimestampOverride]);

  // Controle de Animação
  const [isPlaying, setIsPlaying] = useState(false);
  /** Pré-carrega todas as imagens do intervalo antes de iniciar o play (cache quente, sem atraso frame a frame). */
  const [animationPreloading, setAnimationPreloading] = useState(false);
  const [animationPreloadProgress, setAnimationPreloadProgress] = useState(0);
  const animationPreloadAbortRef = useRef<AbortController | null>(null);
  const [animationSpeedMultiplier, setAnimationSpeedMultiplier] = useState(1);

  const toggleAnimationSpeed = useCallback(() => {
    setAnimationSpeedMultiplier((prev) => {
      if (prev === 1) return 2;
      if (prev === 2) return 5;
      return 1;
    });
  }, []);
  const playIntervalRef = useRef<NodeJS.Timeout | null>(null);
  /** Geração atual de overlays para evitar Race Conditions */
  const overlayGenerationRef = useRef(0);
  /** Controla quantos workers/requests ainda estão rodando (para a animação esperar) */
  const pendingRadarRequestsRef = useRef(0);

  const preloadedFramesRef = useRef<Map<string, string>>(new Map());
  const isPreloadingRef = useRef<Set<string>>(new Set());

  // Função auxiliar para aplicar o estilo correto a qualquer instância de mapa
  const applyBaseMapStyle = useCallback((mapInstance: any) => {
    if (!mapInstance) return;
    const selectedMap = BASE_MAP_OPTIONS.find((opt) => opt.id === baseMapId) || BASE_MAP_OPTIONS[0];
    mapInstance.setStyle(selectedMap.styleUrl, { diff: false });
  }, [baseMapId]);

  // Procura o índice do valor mais próximo disponível no array de tempos válidos
  const getClosestValidIndex = useCallback((target: number, validArr: number[]) => {
    let closestIdx = 0;
    let minDiff = Infinity;
    validArr.forEach((val, idx) => {
      const diff = Math.abs(val - target);
      if (diff < minDiff) {
        minDiff = diff;
        closestIdx = idx;
      }
    });
    return closestIdx;
  }, []);

  // Lógica de Animação Automática (Play/Pause)
  useEffect(() => {
    if (!isPlaying) {
      if (playIntervalRef.current) {
        clearTimeout(playIntervalRef.current);
        playIntervalRef.current = null;
      }
      return;
    }

    let isMounted = true;
    
    const tick = () => {
      if (!isMounted || !isPlaying) return;

      // Só avança se não houver radares carregando e já passou do tempo de fade (350ms)
      if (pendingRadarRequestsRef.current > 0) {
        playIntervalRef.current = setTimeout(tick, 150);
        return;
      }

      setSliderMinutesAgo((prev) => {
        if (validSliderMinutesAgo && validSliderMinutesAgo.length > 0) {
          const currentIndex = getClosestValidIndex(prev, validSliderMinutesAgo);
          const nextIndex = currentIndex + 1;
          if (nextIndex >= validSliderMinutesAgo.length) {
            return validSliderMinutesAgo[0]; // Reset loop
          }
          return validSliderMinutesAgo[nextIndex];
        } else {
          const next = prev - 5;
          if (next < 0) return maxSliderMinutesAgo;
          return next;
        }
      });

      playIntervalRef.current = setTimeout(tick, 800 / animationSpeedMultiplier);
    };

    playIntervalRef.current = setTimeout(tick, 800 / animationSpeedMultiplier);

    return () => {
      isMounted = false;
      if (playIntervalRef.current) {
        clearTimeout(playIntervalRef.current);
        playIntervalRef.current = null;
      }
    };
  }, [isPlaying, validSliderMinutesAgo, maxSliderMinutesAgo, animationSpeedMultiplier, getClosestValidIndex]);

  const handleSkipBack = useCallback(() => {
    if (validSliderMinutesAgo && validSliderMinutesAgo.length > 0) {
      setSliderMinutesAgo((prev) => {
        const currentIndex = getClosestValidIndex(prev, validSliderMinutesAgo);
        if (currentIndex <= 0) return validSliderMinutesAgo[0];
        return validSliderMinutesAgo[currentIndex - 1]; 
      });
    } else {
      setSliderMinutesAgo((prev) => Math.min(maxSliderMinutesAgo, prev + 5));
    }
  }, [validSliderMinutesAgo, maxSliderMinutesAgo, getClosestValidIndex]);

  const handleSkipForward = useCallback(() => {
    if (validSliderMinutesAgo && validSliderMinutesAgo.length > 0) {
      setSliderMinutesAgo((prev) => {
        const currentIndex = getClosestValidIndex(prev, validSliderMinutesAgo);
        if (currentIndex >= validSliderMinutesAgo.length - 1) return validSliderMinutesAgo[validSliderMinutesAgo.length - 1];
        return validSliderMinutesAgo[currentIndex + 1]; 
      });
    } else {
      setSliderMinutesAgo((prev) => Math.max(0, prev - 5));
    }
  }, [validSliderMinutesAgo, maxSliderMinutesAgo, getClosestValidIndex]);

  const [sliderValidVerifying, setSliderValidVerifying] = useState(false);
  /** Localização obrigatória para ao-vivo (presença em tempo real e posicionamento no mapa) */
  /** Radares cuja imagem mais recente não foi encontrada (ex: 404) */
  const [failedRadars, setFailedRadars] = useState<Set<string>>(new Set());
  /** Timestamp efetivo carregado por radar (quando usa fallback, difere do nominal) — para legenda */
  const [radarEffectiveTimestamps, setRadarEffectiveTimestamps] = useState<Record<string, string>>({});
  /** Fonte da imagem por radar: CPTEC ou REDEMET (quando usou fallback) */
  const [radarEffectiveSource, setRadarEffectiveSource] = useState<Record<string, 'cptec' | 'redemet' | 'storage' | 'funceme' | 'argentina'>>({});
  /** Toggle HD (REDEMET) / Super Res (CPTEC) */
  const [radarSourceMode, setRadarSourceMode] = useState<'superres' | 'hd'>('superres');
  /** Super Res local toggle (filtro doppler ativado pelo usuario no sidebar) */
  const [superResEnabled, setSuperResEnabled] = useState(false);
  /** Radar keys que têm imagem REDEMET disponível */
  const [redemetAvailableKeys, setRedemetAvailableKeys] = useState<Set<string>>(new Set());
  /** URLs REDEMET encontradas por radarKey */
  const [redemetFoundUrls, setRedemetFoundUrls] = useState<Record<string, string>>({});
  /**urls de busca do redemet para santiago */
  const [santiagoRedemetUrl, setSantiagoRedemetUrl] = useState<string | null>(null);
  const [santiagoRedemetLoading, setSantiagoRedemetLoading] = useState(false);

  /** Nowcasting offline: detectado quando muitos radares falham ao carregar */
  const [nowcastingOffline, setNowcastingOffline] = useState(false);
  const [minimizedNowcastingOffline, setMinimizedNowcastingOffline] = useState(false);
  /** Filtro de ruído de refletividade ativo (Super Res refletividade) — default: true */
  const [reflectivityFilterEnabled, setReflectivityFilterEnabled] = useState(true);
  /** Overlay de limites municipais */
  const [showMunicipios, setShowMunicipios] = useState(false);
  const municipiosDataLayerRef = useRef<any>(null);
  /** Menu lateral aberto (hambúrguer) */
  const [sideMenuOpen, setSideMenuOpen] = useState(false);
  /** Split: 1 = painel único, 2 = Refletividade|Doppler lado a lado, 4 = grade 2x2 (simplificado por ora) */
  const [splitCount, setSplitCount] = useState<1 | 2 | 4>(1);
  /** Animação: tocando ou pausada */
  const [animationPlaying, setAnimationPlaying] = useState(false);
  /** Duração da animação em minutos (60 / 240 / 1440) */
  const [animationDuration, setAnimationDuration] = useState<60 | 240 | 1440>(60);
  /** Menu de animação (1h/4h/24h) aberto */
  const [showAnimationMenu, setShowAnimationMenu] = useState(false);
  /** Menu de split (1/2/4) aberto */
  const [showSplitMenu, setShowSplitMenu] = useState(false);
  /** Overlay Prevots (previsões criadas no Admin) */
  const [prevotsOverlayVisible, setPrevotsOverlayVisible] = useState(false);
  const [prevotsForecasts, setPrevotsForecasts] = useState<PrevotsForecast[]>([]);
  const [prevotsForecastDate, setPrevotsForecastDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const prevotsPolygonsRef = useRef<any[]>([]);
  
  // Prevots Dialog state
  const [showPrevotsDialog, setShowPrevotsDialog] = useState(false);
  const [selectedPrevotsLinks, setSelectedPrevotsLinks] = useState<{ xUrl?: string; instagramUrl?: string; date: string } | null>(null);

  const [showHistoricalPicker, setShowHistoricalPicker] = useState(false);

  /** Modo edição de radar: posicionar, rotacionar, raio. null = não editando. */
  const [editingRadar, setEditingRadar] = useState<DisplayRadar | null>(null);
  const [editMinutesAgo, setEditMinutesAgo] = useState(0);
  const [editCenterLat, setEditCenterLat] = useState(0);
  const [editCenterLng, setEditCenterLng] = useState(0);
  const [editRangeKm, setEditRangeKm] = useState(250);
  const [editRotationDegrees, setEditRotationDegrees] = useState(0);
  const [editLiveCenter, setEditLiveCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const editOverlayRef = useRef<any>(null);

  // ---- Drawing tool ----
  const [drawingMode, setDrawingMode] = useState(false);
  const drawingCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawingRef = useRef(false);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);

  // Drawing canvas logic
  useEffect(() => {
    const canvas = drawingCanvasRef.current;
    if (!canvas) return;
    if (!drawingMode) {
      canvas.style.pointerEvents = 'none';
      return;
    }
    canvas.style.pointerEvents = 'auto';
    // Resize canvas to match parent
    const container = canvas.parentElement;
    if (container) {
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 3;

    const getPos = (e: MouseEvent | TouchEvent) => {
      const rect = canvas.getBoundingClientRect();
      if ('touches' in e) {
        const t = e.touches[0];
        return { x: t.clientX - rect.left, y: t.clientY - rect.top };
      }
      return { x: (e as MouseEvent).clientX - rect.left, y: (e as MouseEvent).clientY - rect.top };
    };
    const onDown = (e: MouseEvent | TouchEvent) => {
      // Only draw with left mouse button (button 0)
      if ('button' in e && (e as MouseEvent).button !== 0) return;
      isDrawingRef.current = true;
      lastPosRef.current = getPos(e);
    };
    const onMove = (e: MouseEvent | TouchEvent) => {
      if (!isDrawingRef.current || !lastPosRef.current) return;
      e.preventDefault();
      const pos = getPos(e);
      ctx.beginPath();
      ctx.moveTo(lastPosRef.current.x, lastPosRef.current.y);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
      lastPosRef.current = pos;
    };
    const onUp = () => {
      isDrawingRef.current = false;
      lastPosRef.current = null;
    };
    // Let wheel events (scroll zoom) pass through to the map
    const onWheel = (_e: WheelEvent) => {
      canvas.style.pointerEvents = 'none';
      requestAnimationFrame(() => { canvas.style.pointerEvents = 'auto'; });
    };
    // Let middle/right click pass through to the map (pan)
    const onMouseDownFilter = (e: MouseEvent) => {
      if (e.button !== 0) {
        // Non-left click: let it reach the map for dragging
        canvas.style.pointerEvents = 'none';
        const restore = () => {
          canvas.style.pointerEvents = 'auto';
          window.removeEventListener('mouseup', restore);
        };
        window.addEventListener('mouseup', restore);
      }
    };
    canvas.addEventListener('mousedown', onMouseDownFilter, true);
    canvas.addEventListener('mousedown', onDown);
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mouseup', onUp);
    canvas.addEventListener('mouseleave', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: true });
    canvas.addEventListener('touchstart', onDown, { passive: false });
    canvas.addEventListener('touchmove', onMove, { passive: false });
    canvas.addEventListener('touchend', onUp);
    canvas.addEventListener('touchcancel', onUp);
    return () => {
      canvas.removeEventListener('mousedown', onMouseDownFilter, true);
      canvas.removeEventListener('mousedown', onDown);
      canvas.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('mouseup', onUp);
      canvas.removeEventListener('mouseleave', onUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('touchstart', onDown);
      canvas.removeEventListener('touchmove', onMove);
      canvas.removeEventListener('touchend', onUp);
      canvas.removeEventListener('touchcancel', onUp);
    };
  }, [drawingMode]);
  const lastEditDragRef = useRef<{ lat: number; lng: number } | null>(null);

  /** Desktop detection para split vertical */
  const [isDesktop, setIsDesktop] = useState(false);

  /** Storm Reports */
  const [stormReports, setStormReports] = useState<StormReport[]>([]);
  const [todayVisitCount, setTodayVisitCount] = useState(0);
  const stormReportMarkersRef = useRef<any[]>([]);
  const stormReportInfoWindowRef = useRef<any>(null);
  const radarMarkersRef = useRef<any[]>([]);
  const radarKeyToMarkerRef = useRef<Map<string, { marker: any; isDisplayed: boolean }>>(new Map());
  const [showReportsOnMap, setShowReportsOnMap] = useState(true);

  /** Report popup flow */
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
  const mapClickListenerRef = useRef<any>(null);

  const radarOverlaysRef = useRef<any[]>([]);
  /** Segundo mapa (Doppler) no modo split */
  const map2Ref = useRef<HTMLDivElement>(null);
  const map2InstanceRef = useRef<any>(null);
  const [map2Ready, setMap2Ready] = useState(false);
  const radarOverlays2Ref = useRef<any[]>([]);
  /** Map 3 (VIL) no modo 4-split */
  const map3Ref = useRef<HTMLDivElement>(null);
  const map3InstanceRef = useRef<any>(null);
  const [map3Ready, setMap3Ready] = useState(false);
  const radarOverlays3Ref = useRef<any[]>([]);
  /** Map 4 (Waldvogel) no modo 4-split */
  const map4Ref = useRef<HTMLDivElement>(null);
  const map4InstanceRef = useRef<any>(null);
  const [map4Ready, setMap4Ready] = useState(false);
  const radarOverlays4Ref = useRef<any[]>([]);

  const syncingRef = useRef(false);
  const onlineUserMarkersRef = useRef<any[]>([]);
  const presenceUnsubRef = useRef<(() => void) | null>(null);

  /** Transmissão ao vivo: preview local, estado, stream */
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [streamLoading, setStreamLoading] = useState(false);
  const localStreamRef = useRef<MediaStream | null>(null);
  const liveRoomNameRef = useRef<string | null>(null);
  const liveKitRoomRef = useRef<Room | null>(null);
  const isStreamingRef = useRef(false);
  const localPreviewVideoRef = useRef<HTMLVideoElement | null>(null);
  const liveViewerVideoRef = useRef<HTMLVideoElement | null>(null);
  const liveViewerRoomRef = useRef<Room | null>(null);
  const [liveViewerLoading, setLiveViewerLoading] = useState(false);
  const [liveViewerError, setLiveViewerError] = useState<string | null>(null);
  isStreamingRef.current = isStreaming;

  const samplePixelFromOverlays = useCallback((map: any, overlays: any[], setVal: (v: number | null) => void, palette: any[]) => {
    if (!map || overlays.length === 0) {
      setVal(null);
      return;
    }
    const center = map.getCenter();
    const lat = center.lat;
    const lng = center.lng;

    for (let i = overlays.length - 1; i >= 0; i--) {
        const overlay = overlays[i];
        const bounds = overlay.getBounds();
        if (bounds.contains(center)) {
            const url = overlay.get('url') || overlay.getUrl?.();
            if (!url) continue;

            // Busca do cache para não recriar o canvas toda hora que mover o mapa
            let cache = cachedImageDataMap.current.get(url);
            
            if (!cache) {
                // Cria uma única vez para esta URL
                const img = new Image();
                img.crossOrigin = "anonymous";
                img.src = url;
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    canvas.width = img.width;
                    canvas.height = img.height;
                    //willReadFrequently flag melhora absurdamente a performance de amostragem
                    const ctx = canvas.getContext('2d', { willReadFrequently: true }); 
                    if (!ctx) return;
                    ctx.drawImage(img, 0, 0);
                    cachedImageDataMap.current.set(url, { img, canvas, ctx });
                    
                    // LIMITADOR DE MEMÓRIA (Impede crash em celulares e PCs fracos)
                    if (cachedImageDataMap.current.size > 50) {
                      // Apaga o item mais antigo (o Map() do JS mantém a ordem de inserção)
                      const firstKey = cachedImageDataMap.current.keys().next().value;
                      if (firstKey) cachedImageDataMap.current.delete(firstKey);
                    }
                    
                    // Chama a si mesmo novamente para ler agora que está no cache
                    samplePixelFromOverlays(map, overlays, setVal, palette);
                };
                return;
            }

            // No MapLibre, as coordenadas são propriedades diretas (.lat, .lng)
            const ne = bounds.getNorthEast();
            const sw = bounds.getSouthWest();
            const x = ((lng - sw.lng) / (ne.lng - sw.lng)) * cache.img.width;
            const y = ((ne.lat - lat) / (ne.lat - sw.lat)) * cache.img.height;

            try {
                const pixel = cache.ctx.getImageData(x, y, 1, 1).data;
                const val = findClosestValue(pixel[0], pixel[1], pixel[2], palette);
                setVal(val);
            } catch (e) {
                setVal(null);
            }
            return;
        }
    }
    setVal(null);
  }, []);

  const handleSampleAll = useCallback(() => {
    samplePixelFromOverlays(mapInstanceRef.current, radarOverlaysRef.current, setSampledValue1, dBZ_COLORS);
    if (splitCount >= 2 && map2InstanceRef.current) {
        samplePixelFromOverlays(map2InstanceRef.current, radarOverlays2Ref.current, setSampledValue2, VEL_COLORS);
    }
    if (splitCount === 4 && map3InstanceRef.current) {
        samplePixelFromOverlays(map3InstanceRef.current, radarOverlays3Ref.current, setSampledValue3, dBZ_COLORS);
    }
    if (splitCount === 4 && map4InstanceRef.current) {
        samplePixelFromOverlays(map4InstanceRef.current, radarOverlays4Ref.current, setSampledValue4, dBZ_COLORS);
    }
  }, [samplePixelFromOverlays, splitCount]);

  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current) return;
    const map1 = mapInstanceRef.current;
    const map2 = map2InstanceRef.current;

    map1.on('idle', handleSampleAll);
    map1.on('zoom', handleSampleAll);

    if (map2Ready && map2) {
        map2.on('idle', handleSampleAll);
        map2.on('zoom', handleSampleAll);
    }

    return () => {
        map1.off('idle', handleSampleAll);
        map1.off('zoom', handleSampleAll);
        if (map2) {
            map2.off('idle', handleSampleAll);
            map2.off('zoom', handleSampleAll);
        }
    };
  }, [mapReady, map2Ready, handleSampleAll]);

  // Atualizar valores quando os overlays mudarem (animação)
  useEffect(() => {
    handleSampleAll();
  }, [sliderMinutesAgo, radarTimestamp, handleSampleAll]);

  /** Modal de visualização: usuário transmitindo ao vivo */
  const [liveViewerUser, setLiveViewerUser] = useState<PresenceData | null>(null);
  const [liveViewerOpen, setLiveViewerOpen] = useState(false);
  const [liveViewerFullscreen, setLiveViewerFullscreen] = useState(false);

  const BRAZIL_CENTER = { lat: -14.235, lng: -51.925 };

  const allAvailableRadars: DisplayRadar[] = useMemo(() => {
    return CPTEC_RADAR_STATIONS.map(s => ({ type: 'cptec', station: s }));
  }, []);

  /** Todos os radares disponíveis (CPTEC + Argentina), ordenados por distância quando há localização */
  const allRadars = useMemo((): DisplayRadar[] => {
    let list = [...allAvailableRadars];
    
    // Ocultar POA caso a data de histórico seja menor que 01/03/2026
    if (historicalTimestampOverride && historicalDate && historicalDate < '2026-03-01') {
      list = list.filter((r) => !(r.type === 'cptec' && r.station.slug === 'climatempo-poa'));
    }

    if (myLocation) {
      list.sort((a, b) => {
        const latA = a.station.lat;
        const lngA = a.station.lng;
        const latB = b.station.lat;
        const lngB = b.station.lng;
        return haversineKm(myLocation!.lat, myLocation!.lng, latA, lngA) - haversineKm(myLocation!.lat, myLocation!.lng, latB, lngB);
      });
    }
    return list;
  }, [myLocation, historicalTimestampOverride, historicalDate, allAvailableRadars]);


  const displayRadars = useMemo(() => {
    if (focusedRadarKey) {
      const dr = allRadars.find((r) => `cptec:${r.station.slug}` === focusedRadarKey);
      return dr ? [dr] : [];
    }
    if (radarMode === 'mosaico') return allRadars;
    if (selectedIndividualRadars.size === 0) return [];
    return allRadars.filter((r) => {
                            const id = `cptec:${r.station.slug}`;
      return selectedIndividualRadars.has(id);
    });
  }, [focusedRadarKey, radarMode, selectedIndividualRadars, allRadars]);

  /** Legendas: nome do radar + horário local (ou efetivo após fallback) ou "sem imagem" */
  /** Timestamp efetivo: histórico (picker ajustado pelo slider) ou ao vivo */
  const effectiveRadarTimestamp = historicalTimestampOverride
    ? (sliderMinutesAgo > 0 ? subtractMinutesFromTimestamp12UTC(historicalTimestampOverride, sliderMinutesAgo) : historicalTimestampOverride)
    : radarTimestamp;

  const radarTimeLegends = useMemo(() => {
    if (!isMounted || displayRadars.length === 0) return [];
    const effectiveTsToUtcDate = (ts12: string) => {
      if (ts12.length !== 12) return new Date();
      return new Date(Date.UTC(
        parseInt(ts12.substring(0, 4), 10),
        parseInt(ts12.substring(4, 6), 10) - 1,
        parseInt(ts12.substring(6, 8), 10),
        parseInt(ts12.substring(8, 10), 10),
        parseInt(ts12.substring(10, 12), 10)
      ));
    };
    return displayRadars.map((dr) => {
      const radarKey = `cptec:${dr.station.slug}`;
      const source = radarEffectiveSource[radarKey];
      if (failedRadars.has(radarKey)) {
        return { name: dr.station.name, hhmm: 'sem imagem', source: undefined as any };
      }
      const anchorTs = radarEffectiveTimestamps[radarKey];
      const formatLocal = (d: Date) => {
        return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      };
      if (anchorTs) {
        let currentFrameTs = anchorTs;
        if (sliderMinutesAgo > 0) {
           currentFrameTs = subtractMinutesFromTimestamp12UTC(anchorTs, sliderMinutesAgo);
           currentFrameTs = floorTimestampToInterval(currentFrameTs, dr.station.updateIntervalMinutes ?? 10);
        }
        return { name: dr.station.name, hhmm: formatLocal(effectiveTsToUtcDate(currentFrameTs)), source };
      }
      let ts: string;
      ts = getNearestRadarTimestamp(effectiveRadarTimestamp, dr.station);
      return { name: dr.station.name, hhmm: formatLocal(effectiveTsToUtcDate(ts)), source: undefined as any };
    });
  }, [isMounted, displayRadars, effectiveRadarTimestamp, failedRadars, radarEffectiveTimestamps, radarEffectiveSource, sliderMinutesAgo]);

  /** Título central do header: nome do radar + horário da última imagem (local).
   * Em LIVE mosaico: cada radar tem seu próprio horário → mostra "Ao vivo"; detalhe no menu lateral.
   */
  const headerTitle = useMemo(() => {
    const formatLocal = (d: Date) =>
      `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const effectiveTsToUtcDate = (ts: string) => {
      const y = parseInt(ts.slice(0, 4), 10);
      const m = parseInt(ts.slice(4, 6), 10) - 1;
      const d = parseInt(ts.slice(6, 8), 10);
      const h = ts.includes('T') ? parseInt(ts.slice(9, 11), 10) : parseInt(ts.slice(8, 10), 10);
      const min = ts.includes('T') ? parseInt(ts.slice(11, 13), 10) : parseInt(ts.slice(10, 12), 10);
      return new Date(Date.UTC(y, m, d, h, min));
    };
    if (displayRadars.length === 0) return { name: radarMode === 'unico' ? 'Radar Individual (selecione)' : 'Modo Ao Vivo', time: '' };
    if (radarMode === 'mosaico') {
      if (sliderMinutesAgo === 0 && !historicalTimestampOverride) {
        return { name: 'Mosaico (todos)', time: 'Ao vivo' };
      }
      const times = radarTimeLegends.map((l) => l.hhmm).filter((h) => h !== 'sem imagem');
      const timeStr = times.length > 0 ? times[0] : 'sem imagem';
      return { name: 'Mosaico (todos)', time: timeStr };
    }
    const dr = displayRadars[0];
    const leg = radarTimeLegends.find((l) => l.name === dr.station.name);
    const timeStr = leg?.hhmm ?? '';
    const nameStr = displayRadars.length > 1 ? `${displayRadars.length} radares` : dr.station.name;
    return { name: nameStr, time: timeStr };
  }, [displayRadars, radarMode, radarTimeLegends, sliderMinutesAgo, historicalTimestampOverride]);

  /** Monta URL da imagem para o radar em edição (baseado em editMinutesAgo) */
  const getEditRadarImageUrl = useCallback(
    (dr: DisplayRadar): string => {
      const ts = getNowMinusMinutesTimestamp12UTC(3 + editMinutesAgo);
      const nominalDate = new Date(Date.UTC(
        parseInt(ts.slice(0, 4), 10),
        parseInt(ts.slice(4, 6), 10) - 1,
        parseInt(ts.slice(6, 8), 10),
        parseInt(ts.slice(8, 10), 10),
        parseInt(ts.slice(10, 12), 10)
      ));
      const ts12 = getNearestRadarTimestamp(ts, dr.station);
      return getProxiedRadarUrl(buildNowcastingPngUrl(dr.station, ts12, radarProductType));
    },
    [editMinutesAgo, radarProductType]
  );

  const getDefaultUrlTemplate = useCallback((dr: DisplayRadar): string => {
    const ts12 = getNowMinusMinutesTimestamp12UTC(3);
    const product = radarProductType || 'reflectividade';
    const url = buildNowcastingPngUrl(dr.station, ts12, product);
    return url.replace(/\d{4}\/\d{2}\//, '{year}/{month}/').replace(/_\d{12}(\.png)/, '_{ts12}$1');
  }, [radarProductType]);

  const handleOpenEditRadar = useCallback((dr: DisplayRadar) => {
    if (user?.type !== 'admin') {
      addToast('Apenas administradores podem configurar radares.', 'info');
      return;
    }
    const cfg = radarConfigs.find((c) => c.stationSlug === dr.station.slug);
    setEditingRadar(dr);
    setEditMinutesAgo(0);
    setEditCenterLat(cfg?.lat ?? dr.station.lat);
    setEditCenterLng(cfg?.lng ?? dr.station.lng);
    setEditRangeKm(cfg?.rangeKm ?? dr.station.rangeKm ?? 250);
    setEditRotationDegrees(cfg?.rotationDegrees ?? 0);
    setEditLiveCenter(null);
  }, [radarConfigs]);

  const handleCloseEditRadar = useCallback(() => {
    setEditingRadar(null);
    setEditLiveCenter(null);
  }, []);

  const saveEditConfig = useCallback(async (overrideLat?: number, overrideLng?: number) => {
    if (!editingRadar || user?.type !== 'admin') return;
    const lat = overrideLat ?? (editLiveCenter ? editLiveCenter.lat : editCenterLat);
    const lng = overrideLng ?? (editLiveCenter ? editLiveCenter.lng : editCenterLng);
    const slug = editingRadar.station.slug;
    const cfg = radarConfigs.find((c) => c.stationSlug === slug);
    const urlTemplate = cfg?.urlTemplate ?? getDefaultUrlTemplate(editingRadar);
    
    // Bounds calculados baseados no range
    const computedBounds = calculateRadarBounds(lat, lng, editRangeKm);
    
    setEditSaving(true);
    try {
      await saveRadarConfig({
        id: cfg?.id ?? slug,
        stationSlug: slug,
        name: editingRadar.station.name,
        urlTemplate,
        bounds: computedBounds,
        lat,
        lng,
        rangeKm: editRangeKm,
        updateIntervalMinutes: editingRadar.station.updateIntervalMinutes ?? 10,
        rotationDegrees: editRotationDegrees,
      });
      addToast('Configuração salva.', 'success');
      setEditCenterLat(lat);
      setEditCenterLng(lng);
      await fetchRadarConfigs().then(setRadarConfigs);
    } catch (e: any) {
      addToast(`Erro ao salvar: ${e.message}`, 'error');
    } finally {
      setEditSaving(false);
    }
  }, [editingRadar, radarConfigs, editCenterLat, editCenterLng, editLiveCenter, editRangeKm, editRotationDegrees, getDefaultUrlTemplate, addToast]);

  const handleSaveEditPosition = useCallback(async (lat: number, lng: number) => {
    if (!editingRadar || user?.type !== 'admin') return;
    setEditCenterLat(lat);
    setEditCenterLng(lng);
    await saveEditConfig(lat, lng);
    addToast('Posição salva automaticamente.', 'success');
  }, [editingRadar, saveEditConfig, addToast]);

  const getBoundsForDisplayRadar = useCallback(
    (dr: DisplayRadar, source?: string) => {
      let configSlug = dr.station.slug;
      
      const cfg = radarConfigs.find((c) => c.id === configSlug || c.stationSlug === configSlug);
      if (cfg?.customBounds) {
        return { north: cfg.customBounds.north, south: cfg.customBounds.south, east: cfg.customBounds.east, west: cfg.customBounds.west };
      }

      const isDefaultPosition = !cfg || (cfg.lat === dr.station.lat && cfg.lng === dr.station.lng);

      if (isDefaultPosition) {
          if (dr.station.bounds) {
            return { 
              north: dr.station.bounds.maxLat, 
              south: dr.station.bounds.minLat, 
              east: dr.station.bounds.maxLon, 
              west: dr.station.bounds.minLon 
            };
          }
          const b = getRadarImageBounds(dr.station);
          return { north: b.north, south: b.south, east: b.east, west: b.west };
      }

      if (cfg && (cfg.lat !== 0 || cfg.lng !== 0)) {
        const range = cfg.rangeKm ?? dr.station.rangeKm ?? 250;
        const b = calculateRadarBounds(cfg.lat, cfg.lng, range);
        return { north: b.ne.lat, south: b.sw.lat, east: b.ne.lng, west: b.sw.lng };
      }

      const b2 = getRadarImageBounds(dr.station);
      return { north: b2.north, south: b2.south, east: b2.east, west: b2.west };
    },
    [radarConfigs]
  );

  const requestLocation = useCallback(() => {
    if (user && LOCATION_REQUEST_EXCLUDED_UIDS.includes(user.uid)) return;
    if (!navigator.geolocation) {
      setLocationPermission('denied');
      setLocationErrorType('unavailable');
      return;
    }
    setLocationLoading(true);
    setLocationErrorType(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setMyLocation({ lat, lng });
        setLocationPermission('granted');
        setLocationErrorType(null);
        setLocationLoading(false);
      },
      (err) => {
        setLocationLoading(false);
        setLocationPermission('denied');
        // GeolocationPositionError: 1=PERMISSION_DENIED, 2=POSITION_UNAVAILABLE, 3=TIMEOUT
        if (err.code === 1) setLocationErrorType('denied');
        else if (err.code === 3) setLocationErrorType('timeout');
        else setLocationErrorType('unavailable');
      },
      // Primeira tentativa: alta precisão. Se falhar, o usuário pode tentar novamente (com fallback mais tolerante)
      { enableHighAccuracy: true, timeout: 30_000, maximumAge: 120_000 }
    );
  }, [user]);

  useEffect(() => {
    if (!user) return;
    if (LOCATION_REQUEST_EXCLUDED_UIDS.includes(user.uid)) return;
    requestLocation();
  }, [user, requestLocation]);

  /** Permissions API: detecta quando o usuário altera permissão nas configurações do navegador */
  useEffect(() => {
    if (!navigator.permissions?.query) return;
    let result: PermissionStatus | null = null;
    let listener: (() => void) | null = null;
    navigator.permissions.query({ name: 'geolocation' }).then((r) => {
      result = r;
      listener = () => {
        if (r.state === 'granted') requestLocation();
        else if (r.state === 'denied') setLocationPermission('denied');
      };
      r.addEventListener('change', listener);
      if (r.state === 'granted') requestLocation();
    }).catch(() => {});
    return () => {
      if (result && listener) result.removeEventListener('change', listener);
    };
  }, [requestLocation]);

  useEffect(() => {
    if (!user) return;
    presenceUnsubRef.current = subscribeToPresence(setOnlineUsers);
    return () => {
      presenceUnsubRef.current?.();
      presenceUnsubRef.current = null;
    };
  }, [user]);

  /** Visitas do dia: registrar e assinar contador */
  useEffect(() => {
    if (user) recordVisit();
    const unsub = subscribeToTodayVisitCount(setTodayVisitCount);
    return unsub;
  }, [user]);

  useEffect(() => {
    fetchRadarConfigs().then(setRadarConfigs).catch(() => {});
  }, []);

  useEffect(() => {
    fetchPrevotsForecasts().then(setPrevotsForecasts).catch(() => setPrevotsForecasts([]));
  }, []);

  /** Presença com localização (usuários que compartilham) */
  useEffect(() => {
    if (!user || !mapInstanceRef.current || locationPermission !== 'granted' || !myLocation) return;
    if (LOCATION_REQUEST_EXCLUDED_UIDS.includes(user.uid)) return; // Excluídos usam o useEffect abaixo
    const heartbeat = setInterval(() => {
      updatePresence(user.uid, {
        displayName: user.displayName || 'Usuário',
        photoURL: user.photoURL,
        userType: null,
        locationShared: true,
        lat: myLocation.lat,
        lng: myLocation.lng,
        page: 'ao-vivo',
        isLiveStreaming: isStreamingRef.current,
        liveRoomName: liveRoomNameRef.current,
      });
    }, 90_000);
    updatePresence(user.uid, {
      displayName: user.displayName || 'Usuário',
      photoURL: user.photoURL,
      userType: null,
      locationShared: true,
      lat: myLocation.lat,
      lng: myLocation.lng,
      page: 'ao-vivo',
      isLiveStreaming: isStreamingRef.current,
      liveRoomName: liveRoomNameRef.current,
    });
    return () => {
      clearInterval(heartbeat);
      removePresence(user.uid);
    };
  }, [user, myLocation, locationPermission]);

  /** Presença sem localização (usuários excluídos da requisição de localização) */
  useEffect(() => {
    if (!user || !LOCATION_REQUEST_EXCLUDED_UIDS.includes(user.uid)) return;
    const heartbeat = setInterval(() => {
      updatePresence(user.uid, {
        displayName: user.displayName || 'Usuário',
        photoURL: user.photoURL,
        userType: null,
        locationShared: false,
        lat: null,
        lng: null,
        page: 'ao-vivo',
        isLiveStreaming: isStreamingRef.current,
        liveRoomName: liveRoomNameRef.current,
      });
    }, 90_000);
    updatePresence(user.uid, {
      displayName: user.displayName || 'Usuário',
      photoURL: user.photoURL,
      userType: null,
      locationShared: false,
      lat: null,
      lng: null,
      page: 'ao-vivo',
      isLiveStreaming: isStreamingRef.current,
      liveRoomName: liveRoomNameRef.current,
    });
    return () => {
      clearInterval(heartbeat);
      removePresence(user.uid);
    };
  }, [user]);

  useEffect(() => {
    setSliderMinutesAgo((prev) => Math.min(prev, maxSliderMinutesAgo));
  }, [maxSliderMinutesAgo]);

  /** Modo único ou radar focado: verifica quais minutos têm imagem e filtra o slider. */
  useEffect(() => {
    const isSingleRadar = radarMode === 'unico' || (!!focusedRadarKey && displayRadars.length === 1);
    if (!isSingleRadar || displayRadars.length === 0) {
      setValidSliderMinutesAgo(null);
      setSliderValidVerifying(false);
      return;
    }
    const dr = displayRadars[0];
    const maxMin = Math.min(maxSliderMinutesAgo, 60);
    if (maxMin <= 0) {
      setValidSliderMinutesAgo([0]);
      setSliderValidVerifying(false);
      return;
    }
    setSliderValidVerifying(true);
    const ac = new AbortController();
    (async () => {
      const productForTimeline = splitCount === 2 ? 'velocidade' : radarProductType;
      const baseTs12 = historicalTimestampOverride || getNowMinusMinutesTimestamp12UTC(3);
      const isHistorical = !!historicalTimestampOverride;
      const valid = await filterValidSliderMinutesAgo(dr, productForTimeline, maxMin, radarConfigs, baseTs12, isHistorical, ac.signal);
      if (!ac.signal.aborted) {
        setValidSliderMinutesAgo(valid);
        setSliderMinutesAgo((prev) => {
          if (valid.length === 0) return 0;
          const nearest = valid.reduce((a, b) => Math.abs(b - prev) < Math.abs(a - prev) ? b : a);
          return nearest;
        });
        setSliderValidVerifying(false);
      }
    })();
    return () => ac.abort();
  }, [radarMode, focusedRadarKey, displayRadars, radarProductType, maxSliderMinutesAgo, radarConfigs, splitCount, historicalTimestampOverride]);

  useEffect(() => () => {
    animationPreloadAbortRef.current?.abort();
  }, []);

  const handlePlayPauseClick = useCallback(async () => {
    if (animationPreloading) {
      animationPreloadAbortRef.current?.abort();
      setAnimationPreloading(false);
      return;
    }
    if (isPlaying) {
      setIsPlaying(false);
      return;
    }
    if (displayRadars.length === 0) return;

    const minutesList =
      validSliderMinutesAgo && validSliderMinutesAgo.length > 0
        ? validSliderMinutesAgo
        : Array.from({ length: Math.floor(maxSliderMinutesAgo / 5) + 1 }, (_, i) => i * 5);

    const products: RadarProductPreload[] =
      splitCount >= 2 ? ['reflectividade', 'velocidade', 'vil', 'waldvogel'] : [radarProductType];

    const ac = new AbortController();
    animationPreloadAbortRef.current = ac;
    setAnimationPreloading(true);
    setAnimationPreloadProgress(0);

    try {
      await preloadRadarAnimationFrames({
        displayRadars,
        minutesList,
        products,
        historicalTimestampOverride,
        radarSourceMode,
        onProgress: setAnimationPreloadProgress,
        signal: ac.signal,
      });
    } catch {
      /* abort */
    } finally {
      setAnimationPreloading(false);
    }

    if (ac.signal.aborted) return;

    if (sliderMinutesAgo === 0) {
      if (validSliderMinutesAgo && validSliderMinutesAgo.length > 0) {
        setSliderMinutesAgo(validSliderMinutesAgo[0]);
      } else {
        setSliderMinutesAgo(60);
      }
    }
    setIsPlaying(true);
  }, [
    animationPreloading,
    isPlaying,
    displayRadars,
    validSliderMinutesAgo,
    maxSliderMinutesAgo,
    splitCount,
    radarProductType,
    historicalTimestampOverride,
    radarSourceMode,
    sliderMinutesAgo,
  ]);

  /** Setas do teclado: controlam o slider de tempo do radar (evita mover o mapa). Captura no capture phase para ter prioridade sobre o mapa. */
  useEffect(() => {
    const step = 5;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const el = e.target as HTMLElement;
      const tag = el?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || el?.isContentEditable) return;
      e.preventDefault();
      e.stopPropagation();
      if (validSliderMinutesAgo && validSliderMinutesAgo.length > 1) {
        const idx = validSliderMinutesAgo.indexOf(sliderMinutesAgo);
        const i = idx < 0 ? 0 : idx;
        // Como o array agora está ordenado do MAIS ANTIGO [0] para o MAIS RECENTE [max],
        // Seta Direita (avançar) -> vai para mais recente (index + 1)
        // Seta Esquerda (voltar) -> vai para mais antigo (index - 1)
        if (e.key === 'ArrowLeft') {
          setSliderMinutesAgo(validSliderMinutesAgo[Math.max(i - 1, 0)] ?? 0);
        } else if (e.key === 'ArrowRight') {
          setSliderMinutesAgo(validSliderMinutesAgo[Math.min(i + 1, validSliderMinutesAgo.length - 1)] ?? 0);
        }
      } else {
        if (e.key === 'ArrowLeft') {
          setSliderMinutesAgo((prev) => Math.min(maxSliderMinutesAgo, prev + step));
        } else if (e.key === 'ArrowRight') {
          setSliderMinutesAgo((prev) => Math.max(0, prev - step));
        }
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [maxSliderMinutesAgo, validSliderMinutesAgo, sliderMinutesAgo]);

  /** Anexa o stream local ao vídeo de preview quando transmitindo */
  useEffect(() => {
    const video = localPreviewVideoRef.current;
    const stream = localStreamRef.current;
    if (video && stream) {
      video.srcObject = stream;
    }
    return () => {
      if (video) video.srcObject = null;
    };
  }, [isStreaming]);

  /** Cleanup: para o stream ao sair da página */
  useEffect(() => {
    return () => {
      liveKitRoomRef.current?.disconnect(true);
      liveKitRoomRef.current = null;
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
      liveViewerRoomRef.current?.disconnect(true);
      liveViewerRoomRef.current = null;
    };
  }, []);

  /** Conecta ao LiveKit e exibe o stream do usuário transmitindo */
  useEffect(() => {
    if (!liveViewerOpen || !liveViewerUser?.liveRoomName || liveViewerUser.uid === user?.uid) {
      if (!liveViewerOpen) {
        liveViewerRoomRef.current?.disconnect(true);
        liveViewerRoomRef.current = null;
        if (liveViewerVideoRef.current) liveViewerVideoRef.current.srcObject = null;
      }
      return;
    }
    const roomName = liveViewerUser.liveRoomName;
    setLiveViewerError(null);
    setLiveViewerLoading(true);
    let cancelled = false;
    (async () => {
      try {
        const tokenRes = await fetch('/api/livekit-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            roomName,
            participantName: user?.displayName || 'Visualizador',
            participantIdentity: user?.uid ? `viewer-${user.uid}` : `viewer-${Date.now()}`,
          }),
        });
        if (!tokenRes.ok) {
          const errData = await tokenRes.json().catch(() => ({}));
          throw new Error(errData.error || 'Falha ao obter token');
        }
        const { token, url } = await tokenRes.json();
        if (cancelled) return;
        const room = new Room();
        liveViewerRoomRef.current = room;
        room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
          const videoEl = liveViewerVideoRef.current;
          if (videoEl && track.kind === Track.Kind.Video) {
            track.attach(videoEl);
          }
        });
        await room.connect(url, token);
        if (cancelled) { room.disconnect(true); return; }
        setLiveViewerLoading(false);
        const participants = Array.from(room.remoteParticipants.values());
        if (participants.length === 0) {
          room.on(RoomEvent.ParticipantConnected, (participant) => {
            participant.trackPublications.forEach((pub) => {
              if (pub.track && pub.kind === Track.Kind.Video) {
                const videoEl = liveViewerVideoRef.current;
                if (videoEl) pub.track.attach(videoEl);
              }
            });
          });
        } else {
          for (const p of participants) {
            const pubs = Array.from(p.trackPublications.values());
            for (const pub of pubs) {
              if (pub.track && pub.kind === Track.Kind.Video) {
                const videoEl = liveViewerVideoRef.current;
                if (videoEl) pub.track.attach(videoEl);
                break;
              }
            }
          }
        }
      } catch (err: any) {
        if (!cancelled) {
          setLiveViewerError(err?.message || 'Erro ao conectar');
          setLiveViewerLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      liveViewerRoomRef.current?.disconnect(true);
      liveViewerRoomRef.current = null;
      if (liveViewerVideoRef.current) liveViewerVideoRef.current.srcObject = null;
    };
  }, [liveViewerOpen, liveViewerUser?.uid, liveViewerUser?.liveRoomName, user?.uid, user?.displayName]);

  /** Timestamp efetivo em UTC: modo live = agora - (3 + slider); modo histórico = derivado do effectiveRadarTimestamp */
  useEffect(() => {
    if (historicalTimestampOverride) return;
    const base = 3 + sliderMinutesAgo;
    setRadarTimestamp(getNowMinusMinutesTimestamp12UTC(base));
  }, [sliderMinutesAgo, historicalTimestampOverride]);

  useEffect(() => {
    if (historicalTimestampOverride || sliderMinutesAgo !== 0) return;
    const i = setInterval(() => setRadarTimestamp(getNowMinusMinutesTimestamp12UTC(3)), 30_000);
    return () => clearInterval(i);
  }, [sliderMinutesAgo, historicalTimestampOverride]);

  /** Animação: avança slider para trás no tempo (6 min a cada ~2s; 60 min ≈ 20s, 4h ≈ 80s) */
  useEffect(() => {
    if (!animationPlaying) return;
    const stepMinutes = 6;
    const interval = 2000;
    const i = setInterval(() => {
      setSliderMinutesAgo((prev) => {
        const next = prev + stepMinutes;
        if (next >= animationDuration) {
          setAnimationPlaying(false);
          return animationDuration;
        }
        return next;
      });
    }, interval);
    return () => clearInterval(i);
  }, [animationPlaying, animationDuration]);

  /** Inicializa mapa quando localização é concedida ou quando usuário está excluído da requisição */
  const locationExcluded = user ? LOCATION_REQUEST_EXCLUDED_UIDS.includes(user.uid) : false;
  const canShowMap = locationPermission === 'granted' || locationExcluded;

  useEffect(() => {
    if (!canShowMap) return;
    let isMounted = true;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const initMap = async () => {
      if (!mapRef.current) return;
      if (typeof window === 'undefined') return;
      const map = new maplibregl.Map({
        container: mapRef.current!,
        style: BASE_MAP_OPTIONS.find(o => o.id === baseMapId)?.styleUrl || BASE_MAP_OPTIONS[0].styleUrl,
        center: [-51.925, -14.235], // [lng, lat]
        zoom: 4,
        attributionControl: false
      });
      mapInstanceRef.current = map;

      map.on('load', () => {
        setMapReady(true);
      });
    };
    initMap();
    return () => {
      isMounted = false;
      if (retryTimer) clearTimeout(retryTimer);
      mapInstanceRef.current = null;
      setMapReady(false);
    };
  }, [canShowMap, myLocation]);

  /** Segundo mapa (Doppler) para split=2 ou 4 */
  useEffect(() => {
    if ((splitCount !== 2 && splitCount !== 4) || !mapReady || !mapInstanceRef.current) {
      if (map2InstanceRef.current) { map2InstanceRef.current = null; setMap2Ready(false); }
      return;
    }
    if (!map2Ref.current) return;
    const g = (window as any).google;
    if (!g?.maps) return;
    const main = mapInstanceRef.current;
    
    const initMap2 = async () => {
      if (map2Ref.current && !map2InstanceRef.current && mapInstanceRef.current) {
        const m2 = new maplibregl.Map({
          container: map2Ref.current!,
          style: BASE_MAP_OPTIONS.find(o => o.id === baseMapId)?.styleUrl || BASE_MAP_OPTIONS[0].styleUrl,
          center: mapInstanceRef.current.getCenter(),
          zoom: mapInstanceRef.current.getZoom(),
          attributionControl: false
        });
        map2InstanceRef.current = m2;
        m2.on('load', () => setMap2Ready(true));
      }
    };
    initMap2();
    return () => {
      map2InstanceRef.current = null; setMap2Ready(false);
    };
  }, [splitCount, mapReady]);

  useEffect(() => {
    if ((splitCount !== 2 && splitCount !== 4) || !map2Ready || !map2InstanceRef.current || !showCrosshair) {
       setSampledValue2(null);
       return;
    }
  }, [splitCount, map2Ready, showCrosshair]);

  useEffect(() => {
    if (!mapInstanceRef.current || !mapReady) return;
    const map = mapInstanceRef.current;
    
    const styleUrl = BASE_MAP_OPTIONS.find(o => o.id === baseMapId)?.styleUrl || BASE_MAP_OPTIONS[0].styleUrl;

    map.setStyle(styleUrl, { diff: false });
    
    // Sync style with other split maps
    const extraMaps = [map2InstanceRef.current, map3InstanceRef.current, map4InstanceRef.current].filter(Boolean);
    extraMaps.forEach(m => m.setStyle(styleUrl, { diff: false }));
  }, [mapReady, baseMapId]);

  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current || !myLocation) return;
    mapInstanceRef.current.flyTo({ center: [myLocation.lng, myLocation.lat], zoom: 8 });
  }, [mapReady, myLocation]);

  useEffect(() => {
    if (splitCount !== 4 || !map3Ready || !map3InstanceRef.current || !showCrosshair) {
       setSampledValue3(null);
       return;
    }
  }, [splitCount, map3Ready, showCrosshair]);

  /** Mapas extras para split=4: cria/destrói conforme splitCount */
  useEffect(() => {
    if (splitCount !== 4 || !mapReady || !mapInstanceRef.current) {
      if (map3InstanceRef.current) { map3InstanceRef.current = null; setMap3Ready(false); }
      if (map4InstanceRef.current) { map4InstanceRef.current = null; setMap4Ready(false); }
      return;
    }
    if (!map3Ref.current || !map4Ref.current) return;
    const g = (window as any).google;
    if (!g?.maps) return;
    const main = mapInstanceRef.current;
    
    const initExtraMaps = async () => {
      if (map3Ref.current && !map3InstanceRef.current && mapInstanceRef.current) {
        const m3 = new maplibregl.Map({
          container: map3Ref.current!,
          style: BASE_MAP_OPTIONS.find(o => o.id === baseMapId)?.styleUrl || BASE_MAP_OPTIONS[0].styleUrl,
          center: mapInstanceRef.current.getCenter(),
          zoom: mapInstanceRef.current.getZoom(),
          attributionControl: false
        });
        map3InstanceRef.current = m3;
        m3.on('load', () => setMap3Ready(true));
      }
      if (map4Ref.current && !map4InstanceRef.current && mapInstanceRef.current) {
        const m4 = new maplibregl.Map({
          container: map4Ref.current!,
          style: BASE_MAP_OPTIONS.find(o => o.id === baseMapId)?.styleUrl || BASE_MAP_OPTIONS[0].styleUrl,
          center: mapInstanceRef.current.getCenter(),
          zoom: mapInstanceRef.current.getZoom(),
          attributionControl: false
        });
        map4InstanceRef.current = m4;
        m4.on('load', () => setMap4Ready(true));
      }
    };
    initExtraMaps();
    return () => {
      map3InstanceRef.current = null; setMap3Ready(false);
      map4InstanceRef.current = null; setMap4Ready(false);
    };
  }, [splitCount, mapReady]);

  /** Sincronização multi-mapa (1, 2, 3, 4) */
  useEffect(() => {
    const maps = [mapInstanceRef.current, map2InstanceRef.current, map3InstanceRef.current, map4InstanceRef.current].filter(Boolean);
    if (maps.length < 2) return;
    const syncAll = (sourceMap: any) => {
      if (syncingRef.current) return;
      syncingRef.current = true;
      const center = sourceMap.getCenter();
      const zoom = sourceMap.getZoom();
      maps.forEach(m => { if (m !== sourceMap) { m.setCenter(center); m.setZoom(zoom); } });
      syncingRef.current = false;
    };
    maps.forEach(m => m.on('move', () => syncAll(m)));
    return () => maps.forEach(m => { try { m.off('move'); } catch(e){} });
  }, [mapReady, map2Ready, map3Ready, map4Ready]);

  /** Marcadores de Usuários Online (WebGL) */
  useEffect(() => {
    onlineUserMarkersRef.current.forEach((m) => m.remove());
    onlineUserMarkersRef.current = [];
    if (!mapInstanceRef.current || !mapReady) return;
    const map = mapInstanceRef.current;
    onlineUsers.forEach((u) => {
      if (!u.locationShared || !u.lat || !u.lng) return;
      const el = document.createElement('div');
      el.className = 'w-8 h-8 rounded-full border-2 border-white shadow-lg overflow-hidden bg-sky-500 cursor-pointer transition-transform hover:scale-110';
      el.style.backgroundImage = `url(${u.photoURL || 'https://starlight-temp.s3.amazonaws.com/user-placeholder.png'})`;
      el.style.backgroundSize = 'cover';
      const marker = new maplibregl.Marker({ element: el }).setLngLat([u.lng, u.lat]).addTo(map);
      marker.getElement().addEventListener('click', () => {
        if (u.isLiveStreaming && u.uid !== user?.uid && u.liveRoomName) {
          setLiveViewerUser(u); setLiveViewerOpen(true);
        } else {
          map.flyTo({ center: [u.lng!, u.lat!], zoom: 12 });
        }
      });
      onlineUserMarkersRef.current.push(marker);
    });
  }, [mapReady, onlineUsers]);

  /** Alertas Prevots (GeoJSON nativo WebGL) */
  useEffect(() => {
    if (!mapInstanceRef.current || !mapReady) return;
    const map = mapInstanceRef.current;
    const layerId = 'prevots-alerts';
    if (map.getLayer(layerId)) map.removeLayer(layerId);
    if (map.getSource(layerId)) map.removeSource(layerId);

    const forecast = prevotsForecasts.find(f => f.date === prevotsForecastDate);
    if (!prevotsOverlayVisible || !forecast || !forecast.polygons) return;

    map.addSource(layerId, {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: forecast.polygons.map(p => ({
          type: 'Feature',
          properties: { level: p.level },
          geometry: { type: 'Polygon', coordinates: p.coordinates }
        }))
      }
    });

    map.addLayer({
      id: layerId,
      type: 'fill',
      source: layerId,
      paint: {
        'fill-color': [
          'match', ['get', 'level'],
          1, '#ffff00', 2, '#ffa500', 3, '#ff0000', 4, '#ff00ff', '#ffffff'
        ],
        'fill-opacity': 0.4
      }
    });
  }, [mapReady, prevotsOverlayVisible, prevotsForecastDate]);

  /** Detecta desktop (>= 1024px) para split vertical */
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    setIsDesktop(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  /** Inscrição real-time nos relatos de hoje */
  useEffect(() => {
    if (!user) return;
    const unsub = subscribeToTodayReports(setStormReports);
    return () => unsub();
  }, [user]);

  /** Ícones de radar no mapa — clicar filtra para mostrar só esse radar */
  const getRadarCenter = useCallback((dr: DisplayRadar): { lat: number; lng: number } => {
    const configSlug = dr.station.slug;
    const cfg = radarConfigs.find((c) => c.stationSlug === configSlug);
    if (cfg && (cfg.lat !== 0 || cfg.lng !== 0)) return { lat: cfg.lat, lng: cfg.lng };
    return { lat: dr.station.lat, lng: dr.station.lng };
  }, [radarConfigs]);

  /** Ícones de radar no mapa (WebGL) - Estilo Profissional */
  useEffect(() => {
    radarMarkersRef.current.forEach((m) => m.remove());
    radarMarkersRef.current = [];
    if (!mapInstanceRef.current || !mapReady || editingRadar) return;
    const map = mapInstanceRef.current;

    allRadars.forEach((dr) => {
      const radarKey = dr.type === 'cptec' ? `cptec:${dr.station.slug}` : `argentina:${dr.station.id}`;
      const isDisplayed = displayRadars.some(r => (r.type === 'cptec' ? `cptec:${r.station.slug}` : `argentina:${r.station.id}`) === radarKey);
      const hasData = !failedRadars.has(radarKey);
      const pos = getRadarCenter(dr);

      // CORREÇÃO: Largura e Altura OBRIGATÓRIAS na tag raiz para o Mapbox/MapLibre centralizar perfeitamente.
      const el = document.createElement('div');
      el.className = 'w-8 h-8 cursor-pointer';

      // Design Moderno: Imagem SVG customizada com efeito claro ou escuro
      if (hasData) {
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

      const marker = new maplibregl.Marker({ element: el }).setLngLat([pos.lng, pos.lat]).addTo(map);
      marker.getElement().addEventListener('click', () => {
        const isUnfocus = focusedRadarKey === radarKey;
        if (isUnfocus) {
          setFocusedRadarKey(null); setRadarMode('mosaico'); setSelectedIndividualRadars(new Set());
        } else {
          setFocusedRadarKey(radarKey); setRadarMode('unico'); setSelectedIndividualRadars(new Set([radarKey]));
        }
      });
      radarMarkersRef.current.push(marker);
    });
  }, [mapReady, allRadars, displayRadars, failedRadars, focusedRadarKey, editingRadar, getRadarCenter]);

  /** Relatos de Tempestade (WebGL) */
  useEffect(() => {
    stormReportMarkersRef.current.forEach((m) => m.remove());
    stormReportMarkersRef.current = [];
    if (!mapInstanceRef.current || !mapReady || !showReportsOnMap) return;
    const map = mapInstanceRef.current;

    stormReports.forEach((r) => {
      const el = document.createElement('div');
      el.className = `w-6 h-6 rotate-45 border-2 border-white shadow-xl cursor-pointer hover:scale-125 transition-transform ${r.type === 'tor' ? 'bg-red-600' : r.type === 'gra' ? 'bg-emerald-500' : 'bg-blue-500'}`;
      el.style.pointerEvents = 'auto';

      const detailHtml = escapeHtmlForPopup(r.detail?.trim() || '—');
      const nameHtml = escapeHtmlForPopup(r.displayName || '');
      const mediaHtml =
        r.mediaUrl && /^https?:\/\//i.test(r.mediaUrl)
          ? `<p class="mt-2 text-xs"><a href="${escapeHtmlForPopup(r.mediaUrl)}" target="_blank" rel="noopener noreferrer" class="text-cyan-600 underline font-semibold">Abrir mídia</a></p>`
          : '';

      const popup = new maplibregl.Popup({
        offset: 25,
        closeButton: true,
        closeOnClick: true,
        maxWidth: '320px',
        className: 'storm-report-popup',
      }).setHTML(
        `<div class="p-2 text-slate-800"><p class="font-bold">${r.type.toUpperCase()}: ${detailHtml}</p><p class="text-[10px] font-normal mt-1">por ${nameHtml}</p>${mediaHtml}</div>`
      );

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([r.lng, r.lat])
        .setPopup(popup)
        .addTo(map);

      // MapLibre v5 abre o popup via map click quando o target é o marcador; em alguns layouts isso não dispara.
      // Clique direto no ícone garante toggle do popup.
      const onMarkerClick = (e: MouseEvent) => {
        e.stopPropagation();
        marker.togglePopup();
      };
      el.addEventListener('click', onMarkerClick, { capture: true });

      stormReportMarkersRef.current.push(marker);
    });
  }, [mapReady, stormReports, showReportsOnMap]);

  const addRadarOverlaysMapLibre = useCallback(
    (
      map: any,
      productType: 'reflectividade' | 'velocidade' | 'vil' | 'waldvogel',
      radars: DisplayRadar[],
      timestamp: string,
      opacity: number
    ) => {
      if (!map) return;
      const style = map.getStyle();
      if (!style || !style.layers) return;
      
      const activeKeys = new Set(radars.map(r => r.type === 'cptec' ? `cptec:${r.station.slug}` : `argentina:${r.station.id}`));

      radars.forEach((dr) => {
        const radarKey = dr.type === 'cptec' ? `cptec:${dr.station.slug}` : `argentina:${dr.station.id}`;
        const radarInterval = dr.type === 'cptec' ? (dr.station.updateIntervalMinutes ?? 10) : 10;
        const exactTs12 = floorTimestampToInterval(timestamp, radarInterval);
        
        const activeFrameKey = `${radarKey}-${productType}-${exactTs12}`;

        style.layers.forEach((layer: any) => {
          if (layer.id.startsWith(`lyr-${radarKey}-${productType}-`)) {
            if (layer.id === `lyr-${activeFrameKey}`) {
              map.setPaintProperty(layer.id, 'raster-opacity', opacity);
            } else {
              map.setPaintProperty(layer.id, 'raster-opacity', 0);
            }
          }
        });
      });
      
      // Hide layers from inactive radars
      style.layers.forEach((layer: any) => {
        const match = layer.id.match(/^lyr-(cptec:[^-]+|argentina:[^-]+)-/);
        if (match && !activeKeys.has(match[1])) {
          map.setPaintProperty(layer.id, 'raster-opacity', 0);
        }
      });
    },
    []
  );

  const effectiveTimestampRef = useRef(effectiveRadarTimestamp);
  const radarOpacityRef = useRef(radarOpacity);
  useEffect(() => { effectiveTimestampRef.current = effectiveRadarTimestamp; }, [effectiveRadarTimestamp]);
  useEffect(() => { radarOpacityRef.current = radarOpacity; }, [radarOpacity]);

  /** MOTOR DE PRELOAD SILENCIOSO (ZERO FLICKER) */
  useEffect(() => {
    const minutesList = validSliderMinutesAgo && validSliderMinutesAgo.length > 0
      ? validSliderMinutesAgo
      : Array.from({ length: Math.floor((maxSliderMinutesAgo || 60) / 5) + 1 }, (_, i) => i * 5);

    if (!mapReady || minutesList.length === 0 || displayRadars.length === 0) return;

    const baseTs12 = historicalTimestampOverride || getNowMinusMinutesTimestamp12UTC(3);
    
    const activeProducts: ('reflectividade'|'velocidade'|'vil'|'waldvogel')[] = [];
    if (splitCount === 1) {
      activeProducts.push(radarProductType);
    } else if (splitCount === 2) {
      activeProducts.push('reflectividade', 'velocidade');
    } else if (splitCount === 4) {
      activeProducts.push('reflectividade', 'velocidade', 'vil', 'waldvogel');
    }

    const getMapForProduct = (prod: string) => {
      if (splitCount === 1) return mapInstanceRef.current;
      if (prod === 'reflectividade') return mapInstanceRef.current;
      if (prod === 'velocidade') return map2InstanceRef.current;
      if (prod === 'vil') return map3InstanceRef.current;
      if (prod === 'waldvogel') return map4InstanceRef.current;
      return mapInstanceRef.current;
    };

    minutesList.forEach((minutesAgo) => {
      displayRadars.forEach((dr) => {
        const radarKey = dr.type === 'cptec' ? `cptec:${dr.station.slug}` : `argentina:${dr.station.id}`;
        const radarInterval = dr.type === 'cptec' ? (dr.station.updateIntervalMinutes ?? 10) : 10;
        const targetTs12 = subtractMinutesFromTimestamp12UTC(baseTs12, minutesAgo);
        const exactTs12 = floorTimestampToInterval(targetTs12, radarInterval);
        const isPast = minutesAgo > 0 || !!historicalTimestampOverride;

        activeProducts.forEach((product) => {
          const map = getMapForProduct(product);
          if (!map) return;

          const frameKey = `${radarKey}-${product}-${exactTs12}`;

          if (isPreloadingRef.current.has(frameKey) || preloadedFramesRef.current.has(frameKey)) return;
          isPreloadingRef.current.add(frameKey);

          collectRadarPreloadUrls(dr, exactTs12, product, radarSourceMode as any, undefined, isPast)
            .then(urls => {
              const tryLoad = async () => {
                for (const u of urls) {
                  try {
                    const processedUrl = await new Promise<string>((resolve, reject) => {
                      if (!radarWorkerRef.current) return reject();
                      const reqId = Math.random().toString(36).substring(2);
                      workerCallbacks.current.set(reqId, (pUrl, err) => {
                        if (err || !pUrl) reject(err); else resolve(pUrl);
                      });
                      radarWorkerRef.current.postMessage({
                        id: reqId, imageUrl: getProxiedRadarUrl(u), type: dr.type === 'cptec' ? dr.station.slug : 'argentina', product
                      });
                    });

                    preloadedFramesRef.current.set(frameKey, processedUrl);

                    const sourceStr = 'cptec';

                    const sourceId = `src-${frameKey}`;
                    const layerId = `lyr-${frameKey}`;
                    const bounds = getBoundsForDisplayRadar(dr, sourceStr);
                    const coords: [[number,number],[number,number],[number,number],[number,number]] = [
                      [bounds.west, bounds.north], [bounds.east, bounds.north],
                      [bounds.east, bounds.south], [bounds.west, bounds.south]
                    ];

                    if (!map.getSource(sourceId)) {
                      map.addSource(sourceId, { type: 'image', url: processedUrl, coordinates: coords });
                      
                      const activeExactTs12 = floorTimestampToInterval(effectiveTimestampRef.current, radarInterval);
                      const initialOpacity = (exactTs12 === activeExactTs12) ? radarOpacityRef.current : 0;

                      map.addLayer({
                        id: layerId,
                        type: 'raster',
                        source: sourceId,
                        paint: {
                          'raster-opacity': initialOpacity,
                          'raster-fade-duration': 400
                        }
                      });
                    }
                    break; // Sucesso, não tenta próxima URL
                  } catch (e) {
                    // falhou, tenta próxima
                  }
                }
              };
              tryLoad();
            })
            .catch(() => {});
        });
      });
    });
  }, [mapReady, validSliderMinutesAgo, maxSliderMinutesAgo, displayRadars, radarProductType, splitCount, radarSourceMode, historicalTimestampOverride, getBoundsForDisplayRadar]);

  /** Central de Renderização de Radares (Motor de Alta Performance - Mapa 1) */
  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current || displayRadars.length === 0) return;
    const product = (splitCount >= 2) ? 'reflectividade' : radarProductType;
    const radarsToShow = editingRadar
      ? displayRadars.filter((dr) => dr.station.slug !== editingRadar.station.slug)
      : displayRadars;
    
    const isPast = sliderMinutesAgo > 0 || !!historicalTimestampOverride;

    overlayGenerationRef.current += 1;
    addRadarOverlaysMapLibre(
      mapInstanceRef.current,
      product,
      radarsToShow.length > 0 ? radarsToShow : [],
      effectiveRadarTimestamp,
      radarOpacity
    );
  }, [mapReady, displayRadars, radarProductType, radarOpacity, effectiveRadarTimestamp, splitCount, addRadarOverlaysMapLibre, editingRadar, radarConfigs, sliderMinutesAgo, historicalTimestampOverride, baseMapId]);

  /** Overlays Mapas Secundários (Doppler, VIL, Waldvogel - WebGL) */
  useEffect(() => {
    const configs: { ref: React.MutableRefObject<any[]>, map: any, ready: boolean, product: 'reflectividade' | 'velocidade' | 'vil' | 'waldvogel' }[] = [
      { ref: radarOverlays2Ref, map: map2InstanceRef.current, ready: map2Ready, product: 'velocidade' },
      { ref: radarOverlays3Ref, map: map3InstanceRef.current, ready: map3Ready, product: 'vil' },
      { ref: radarOverlays4Ref, map: map4InstanceRef.current, ready: map4Ready, product: 'waldvogel' }
    ];

    configs.forEach(({ ref, map, ready, product }) => {
      if (!ready || !map || displayRadars.length === 0 || (splitCount !== 2 && splitCount !== 4)) return;

      const radars = editingRadar
        ? displayRadars.filter((dr) => dr.station.slug !== editingRadar.station.slug)
        : displayRadars;

      const isPast = sliderMinutesAgo > 0 || !!historicalTimestampOverride;

      addRadarOverlaysMapLibre(
        map,
        product as 'reflectividade' | 'velocidade' | 'vil' | 'waldvogel',
        radars,
        effectiveRadarTimestamp,
        radarOpacity
      );
    });
  }, [map2Ready, map3Ready, map4Ready, displayRadars, effectiveRadarTimestamp, radarOpacity, splitCount, addRadarOverlaysMapLibre, editingRadar, radarConfigs, sliderMinutesAgo, historicalTimestampOverride, baseMapId]);

  /** Editor de Posição de Radar (Desativado temporariamente para estabilização WebGL) */
  useEffect(() => {
    // Bloco administrativo aguardando migração nativa MapLibre
  }, [mapReady, editingRadar]);

  const openReportPopup = () => setReportStep('location');

  const startPickMapLocation = useCallback(() => {
    setReportStep('pick-map');
    if (!mapInstanceRef.current) return;
    
    const clickHandler = (e: any) => {
      const { lat, lng } = e.lngLat;
      if (lat != null && lng != null) {
        setReportLat(parseFloat(lat.toFixed(5)));
        setReportLng(parseFloat(lng.toFixed(5)));
        setReportStep('form');
        mapInstanceRef.current?.off('click', clickHandler);
        mapClickListenerRef.current = null;
      }
    };

    if (mapClickListenerRef.current) {
      mapInstanceRef.current.off('click', mapClickListenerRef.current);
    }
    mapInstanceRef.current.on('click', clickHandler);
    mapClickListenerRef.current = clickHandler;
  }, []);

  const searchCityForReport = useCallback(async () => {
    if (!reportCitySearch.trim()) return;
    const g = (window as any).google;
    if (!g?.maps) return;
    try {
      const { Geocoder } = await g.maps.importLibrary('geocoding');
      const geocoder = new Geocoder();
      const res = await geocoder.geocode({ address: reportCitySearch });
      if (res.results?.[0]) {
        const loc = res.results[0].geometry.location;
        setReportLat(parseFloat(loc.lat().toFixed(5)));
        setReportLng(parseFloat(loc.lng().toFixed(5)));
        setReportStep('form');
      } else {
        addToast('Cidade não encontrada', 'info');
      }
    } catch {
      addToast('Erro ao buscar cidade', 'info');
    }
  }, [reportCitySearch, addToast]);

  const submitReport = useCallback(async () => {
    if (!user || reportLat == null || reportLng == null) return;
    const hasMedia = reportMediaFile || (reportMediaMode === 'link' && reportMediaLink?.trim());
    if (!hasMedia) {
      addToast('Adicione uma foto, link ou vídeo para confirmar o relato', 'info');
      return;
    }
    setReportSending(true);
    try {
      const d = new Date();
      const dateISO = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      await saveStormReport(
        {
          userId: user.uid,
          displayName: user.displayName || 'Usuário',
          lat: reportLat,
          lng: reportLng,
          type: reportType,
          detail: reportType !== 'tor' ? reportDetail || undefined : undefined,
          mediaType: reportMediaMode === 'link' && reportMediaLink ? 'link' : reportMediaFile ? 'file' : undefined,
          mediaUrl: reportMediaMode === 'link' && reportMediaLink ? reportMediaLink : undefined,
          dateISO,
        },
        reportMediaMode === 'file' ? reportMediaFile : null,
      );
      addToast('Relato enviado com sucesso!', 'success');
      setReportStep('closed');
      setReportLat(null);
      setReportLng(null);
      setReportDetail('');
      setReportMediaFile(null);
      setReportMediaLink('');
      setReportCitySearch('');
    } catch (err) {
      console.error('Erro ao enviar relato:', err);
      addToast('Erro ao enviar relato', 'info');
    } finally {
      setReportSending(false);
    }
  }, [user, reportLat, reportLng, reportType, reportDetail, reportMediaMode, reportMediaFile, reportMediaLink, addToast]);

  const cancelReport = useCallback(() => {
    setReportStep('closed');
    setReportLat(null);
    setReportLng(null);
    setReportDetail('');
    setReportMediaFile(null);
    setReportMediaLink('');
    setReportCitySearch('');
    if (mapClickListenerRef.current && mapInstanceRef.current) {
      mapInstanceRef.current.off('click', mapClickListenerRef.current);
      mapClickListenerRef.current = null;
    }
  }, []);

  const refreshRadarNow = () => {
    setSliderMinutesAgo(0);
    setRadarTimestamp(getNowMinusMinutesTimestamp12UTC(3));
  };

  const goToBrazil = () => {
    mapInstanceRef.current?.flyTo({ center: BRAZIL_CENTER, zoom: 4 });
  };

  const goToMyLocation = () => {
    if (myLocation) {
      mapInstanceRef.current?.flyTo({ center: [myLocation.lng, myLocation.lat], zoom: 10 });
    }
  };



  /** Trava de Hidratação e Segurança Padrão Ouro (V11.7) */
  if (!isMounted) return null;

  if (!user) {
    return (
      <div className="fixed inset-0 z-40 flex flex-col items-center justify-center bg-slate-950 text-white">
        <p className="text-slate-400 mb-4">Faça login para acessar o Modo Ao Vivo.</p>
        <Link href="/login" className="px-4 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-900 font-semibold">
          Entrar
        </Link>
      </div>
    );
  }

  if (locationPermission !== 'granted' && !locationExcluded) {
    return (
      <div className="fixed inset-0 z-40 flex flex-col items-center justify-center bg-slate-950 text-white p-4">
        <div className="max-w-md text-center space-y-4">
          <MapPin className="w-16 h-16 text-cyan-400 mx-auto" />
          <h1 className="text-xl font-bold">Localização obrigatória</h1>
          <p className="text-slate-400">
            O Modo Ao Vivo exige que você compartilhe sua localização para funcionar. Sua posição é usada para:
          </p>
          <ul className="text-left text-slate-400 text-sm space-y-2 list-disc list-inside">
            <li>Exibir radares próximos a você</li>
            <li>Posicionar você no mapa junto aos outros usuários online</li>
            <li>Permitir que todos vejam quem está acompanhando em tempo real</li>
          </ul>
          {locationPermission === 'denied' && (
            <div className="text-red-400 text-sm space-y-1">
              {locationErrorType === 'denied' && (
                <p>Permissão negada. Ative a localização nas configurações do navegador e clique em &quot;Tentar novamente&quot;.</p>
              )}
              {locationErrorType === 'timeout' && (
                <p>O tempo esgotou. Verifique se o GPS está ativado, saia de locais fechados e tente novamente.</p>
              )}
              {locationErrorType === 'unavailable' && (
                <p>Localização indisponível. Verifique se o GPS está ativado no dispositivo e tente novamente.</p>
              )}
              {!locationErrorType && (
                <p>Não foi possível obter sua localização. Tente novamente.</p>
              )}
            </div>
          )}
          <p className="text-slate-500 text-xs">Use sempre a mesma URL (ex: previsasomaster.com). www e sem www são tratados como sites diferentes.</p>
          <button
            onClick={requestLocation}
            disabled={locationLoading}
            className="px-6 py-3 rounded-lg bg-cyan-500 hover:bg-cyan-400 disabled:opacity-60 disabled:cursor-not-allowed text-slate-900 font-semibold flex items-center justify-center gap-2"
          >
            {locationLoading && <Loader2 className="w-5 h-5 animate-spin" />}
            {locationLoading ? 'Obtendo localização...' : locationPermission === 'unknown' ? 'Permitir localização' : 'Tentar novamente'}
          </button>
        </div>
      </div>
    );
  }


  return (
    <AnimatePresence mode="wait">
      <motion.div 
        initial={{ opacity: 0, scale: 1.02 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.4 }}
        className="fixed inset-0 z-40 flex flex-col bg-slate-950 text-white overflow-hidden"
      >
        {/* Fundo de Mapa Topográfico (Grid) para quando o mapa estiver carregando */}
        <div 
          className="absolute inset-0 z-0 pointer-events-none opacity-20"
          style={{
            backgroundImage: `linear-gradient(to right, rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.05) 1px, transparent 1px)`,
            backgroundSize: '40px 40px'
          }}
        />

        {/* Header: Menu | Título central (radar + horário) */}
        <header className="relative z-20 flex items-center justify-between px-2 sm:px-3 py-1.5 sm:py-2.5 bg-[#0F131C]/80 backdrop-blur-md border-b border-white/10 flex-shrink-0 shadow-lg">
          <div className="flex items-center gap-1.5 sm:gap-3">
            <button
              type="button"
              onClick={() => setSideMenuOpen(true)}
              className="p-1 sm:p-2 -ml-1 rounded-lg text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
              aria-label="Abrir menu"
            >
              <Menu className="w-5 h-5 sm:w-6 sm:h-6" />
            </button>
            {/* Visitas do dia */}
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-slate-500/15 border border-slate-500/30 whitespace-nowrap">
              <span className="text-xs font-bold text-slate-300 tabular-nums">{todayVisitCount}</span>
              <span className="text-[9px] sm:text-[10px] text-slate-400/80 uppercase tracking-wider hidden sm:inline">visitas hoje</span>
            </div>
            {/* Contador de visitantes online */}
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 whitespace-nowrap">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
              </span>
              <span className="text-xs font-bold text-emerald-300 tabular-nums">{onlineUsers.length}</span>
              <span className="text-[9px] sm:text-[10px] text-emerald-400/80 uppercase tracking-wider hidden sm:inline">online</span>
            </div>
          </div>
          <div className="flex-1 min-w-0 text-center flex flex-col items-center justify-center -ml-2 sm:-ml-0">
            <p className="text-[10px] sm:text-sm font-black tracking-wider text-white truncate uppercase max-w-[120px] sm:max-w-none">{headerTitle.name}</p>
            <p className="text-[9px] sm:text-[10px] tracking-widest text-cyan-400/80 uppercase font-medium mt-0 sm:mt-0.5 max-w-[130px] sm:max-w-none truncate">
              <span className="hidden sm:inline">Última imagem: </span>
              {isMounted && headerTitle.time ? `${headerTitle.time} (local)` : !isMounted ? '--:--' : 'Carregando…'}
            </p>
            {focusedRadarKey && (
              <button
                type="button"
                onClick={() => {
                  setFocusedRadarKey(null);
                  setRadarMode('mosaico');
                  setSelectedIndividualRadars(new Set());
                }}
                className="mt-1 sm:mt-1.5 text-[8px] sm:text-[10px] px-2 py-0.5 sm:py-1 rounded bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30 border border-cyan-500/40"
              >
                Ver mosaico
              </button>
            )}
          </div>
          <div className="flex items-center gap-1 sm:gap-2">
            <button
              onClick={() => setShowReportsOnMap((v) => !v)}
              className={`relative p-1.5 sm:p-2 rounded-lg transition-all transform hover:scale-105 ${showReportsOnMap ? 'text-amber-400 bg-amber-400/10' : 'text-slate-400 hover:text-white hover:bg-white/10'}`}
              title="Relatos de hoje"
            >
              <AlertTriangle className="w-4 h-4 sm:w-5 sm:h-5" />
              {stormReports.length > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 sm:w-4 sm:h-4 flex items-center justify-center text-[7px] sm:text-[8px] font-bold bg-red-500 text-white rounded-full shadow-[0_0_8px_rgba(239,68,68,0.8)]">
                  {stormReports.length}
                </span>
              )}
            </button>
            <Link href="/" className="p-1.5 sm:p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-all transform hover:scale-105" aria-label="Voltar">
              <ChevronLeft className="w-4 h-4 sm:w-5 sm:h-5" />
            </Link>
          </div>
        </header>

        {/* Banner de alerta: Nowcasting offline */}
        <AnimatePresence>
          {nowcastingOffline && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.3 }}
              className={`relative z-20 bg-amber-500/20 border-b border-amber-500/40 px-4 flex items-center justify-between gap-3 flex-shrink-0 overflow-hidden ${minimizedNowcastingOffline ? 'py-1' : 'py-2'}`}
            >
              <div 
                className="flex items-center gap-2 text-amber-300 font-semibold cursor-pointer select-none overflow-hidden"
                onClick={() => isDesktop ? null : setMinimizedNowcastingOffline(!minimizedNowcastingOffline)}
              >
                <AlertTriangle className={`flex-shrink-0 ${minimizedNowcastingOffline ? 'w-3 h-3' : 'w-4 h-4'}`} />
                <span className={`${minimizedNowcastingOffline ? 'text-[9px]' : 'text-xs sm:text-sm'}`}>
                  {minimizedNowcastingOffline ? 'Nowcasting offline (Storage ativo)' : 'Os servidores do Nowcasting estão fora do ar. Imagens do Storage estão sendo utilizadas.'}
                </span>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {!minimizedNowcastingOffline && redemetAvailableKeys.size > 0 && (
                  <button
                    onClick={() => setRadarSourceMode('hd')}
                    className="px-3 py-1 rounded-full text-[10px] sm:text-xs font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 hover:bg-cyan-500/30 transition-colors whitespace-nowrap"
                  >
                    {t('live_show_redemet')}
                  </button>
                )}
                {!minimizedNowcastingOffline && (
                  <button
                    onClick={toggleAnimationSpeed}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#0A0E17]/80 border border-white/10 text-slate-400 shadow-lg transition-all hover:text-white hover:border-cyan-500/40"
                    title={t('live_animation_speed')}
                  >
                    <span className="font-bold text-[10px] uppercase">{t('live_animation_speed')}: {animationSpeedMultiplier}x</span>
                  </button>
                )}
                <button
                  onClick={() => setMinimizedNowcastingOffline(!minimizedNowcastingOffline)}
                  className="p-1 rounded text-amber-400/60 hover:text-amber-300 transition-colors sm:hidden"
                  aria-label={minimizedNowcastingOffline ? "Expandir" : "Minimizar"}
                >
                  {minimizedNowcastingOffline ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-4 h-4" />}
                </button>
                <button
                  onClick={() => setNowcastingOffline(false)}
                  className="p-1 rounded text-amber-400/60 hover:text-amber-300 transition-colors"
                  aria-label="Fechar alerta"
                >
                  <X className={`${minimizedNowcastingOffline ? 'w-3 h-3' : 'w-4 h-4'}`} />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Menu lateral (drawer) */}
        <AnimatePresence>
          {sideMenuOpen && (
            <>
              <motion.div 
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" 
                aria-hidden 
                onClick={() => setSideMenuOpen(false)} 
              />
              <motion.aside 
                initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }} transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                className="fixed inset-y-0 left-0 z-50 w-[min(18rem,85vw)] bg-[#0F131C]/95 backdrop-blur-xl border-r border-white/10 shadow-2xl flex flex-col overflow-hidden"
              >
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
              <span className="font-bold tracking-wider text-cyan-300 uppercase text-xs">Configurações</span>
              <button onClick={() => setSideMenuOpen(false)} className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/10 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-5">
              <div>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">Fonte de dados</p>
                <label className="flex items-center gap-3 py-2 cursor-pointer group">
                  <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${radarMode === 'mosaico' ? 'bg-cyan-500 border-cyan-500' : 'border-slate-500 group-hover:border-cyan-500/50'}`}>
                    {radarMode === 'mosaico' && <Check className="w-3 h-3 text-black" />}
                  </div>
                  <input type="checkbox" checked={radarMode === 'mosaico'} onChange={() => setRadarMode('mosaico')} className="hidden" />
                  <span className="text-sm font-medium text-slate-300 group-hover:text-white transition-colors">Mosaico</span>
                </label>
                <label className="flex items-center gap-3 py-2 cursor-pointer group">
                  <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${radarMode === 'unico' ? 'bg-cyan-500 border-cyan-500' : 'border-slate-500 group-hover:border-cyan-500/50'}`}>
                    {radarMode === 'unico' && <Check className="w-3 h-3 text-black" />}
                  </div>
                  <input type="checkbox" checked={radarMode === 'unico'} onChange={() => setRadarMode('unico')} className="hidden" />
                  <span className="text-sm font-medium text-slate-300 group-hover:text-white transition-colors">Radar Individual</span>
                </label>
              {radarMode === 'unico' && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
                    className="mt-3 max-h-64 overflow-y-auto rounded-lg border border-white/10 bg-black/40 p-2 custom-scrollbar"
                  >
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2 px-1">Ative os radares desejados</p>
                    {groupRadarsByLocation(allAvailableRadars).map(({ country, state, radars }) => (
                      <div key={`${country}-${state}`} className="mb-3 last:mb-0">
                        <p className="text-[10px] font-semibold text-cyan-400/90 mb-1.5 px-1">{country} – {state}</p>
                        <div className="space-y-1">
                          {radars.map((r) => {
                            const id = `cptec:${r.station.slug}`;
                            const checked = selectedIndividualRadars.has(id);
                            return (
                              <label key={id} className="flex items-center gap-3 py-1.5 px-2 rounded cursor-pointer hover:bg-white/5 transition-colors">
                                <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${checked ? 'bg-cyan-500 border-cyan-500' : 'border-slate-500'}`}>
                                  {checked && <Check className="w-3 h-3 text-black" />}
                                </div>
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) => {
                                    setSelectedIndividualRadars((prev) => {
                                      const next = new Set(prev);
                                      if (e.target.checked) {
                                        next.add(id);
                                        const key = `viewed_radar_${id}`;
                                        if (!sessionStorage.getItem(key)) {
                                          sessionStorage.setItem(key, '1');
                                          incrementRadarViews(id).catch(console.error);
                                        }
                                      } else next.delete(id);
                                      return next;
                                    });
                                  }}
                                  className="hidden"
                                />
                                <span className="text-sm text-slate-300 truncate">{r.station.name}</span>
                                <span className="ml-auto text-[10px] text-slate-500 inline-flex items-center gap-1" title="Visualizações">
                                  <Eye className="w-3 h-3" />
                                  {radarViewsRecord[id] || 0}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </motion.div>
              )}
            </div>
              <div>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">Tipo do radar</p>
                <div className="flex gap-2 p-1 bg-black/40 rounded-xl border border-white/5">
              <button
                onClick={() => setRadarProductType('reflectividade')}
                    className={`flex-1 px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${radarProductType === 'reflectividade' ? 'bg-cyan-500 text-black shadow-[0_0_15px_rgba(6,182,212,0.4)]' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}
              >
                Refletividade
              </button>
              <button
                onClick={() => setRadarProductType('velocidade')}
                    className={`flex-1 px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${radarProductType === 'velocidade' ? 'bg-emerald-500 text-black shadow-[0_0_15px_rgba(16,185,129,0.4)]' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}
              >
                Doppler
              </button>
            </div>
              </div>
              {/* Removed Super Res toggle from sidebar */}
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-3">Opacidade</label>
              <input
                type="range"
                min="0.3"
                max="1"
                step="0.05"
                value={radarOpacity}
                onChange={(e) => setRadarOpacity(parseFloat(e.target.value))}
                  className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-500 hover:accent-cyan-400 transition-all"
              />
            </div>
              {/* Toggle Mira (Crosshair) */}
            <div className="flex items-center justify-between p-3 bg-slate-800/40 rounded-lg hover:bg-slate-800/60 transition-colors">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-500/20 rounded-md">
                  <Crosshair className="w-5 h-5 text-blue-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-100">Mira de Precisão</p>
                  <p className="text-xs text-slate-400">Dados reais sob o cursor</p>
                </div>
              </div>
              <button
                onClick={() => setShowCrosshair(!showCrosshair)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                    showCrosshair ? 'bg-blue-600' : 'bg-slate-600'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      showCrosshair ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {/* Toggle Limites Municipais */}
              <div>
                <label className="flex items-center gap-3 py-2 cursor-pointer group">
                  <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${showMunicipios ? 'bg-amber-500 border-amber-500' : 'border-slate-500 group-hover:border-amber-500/50'}`}>
                    {showMunicipios && <Check className="w-3 h-3 text-black" />}
                  </div>
                  <input type="checkbox" checked={showMunicipios} onChange={() => setShowMunicipios(!showMunicipios)} className="hidden" />
                  <span className="text-sm font-medium text-slate-300 group-hover:text-white transition-colors">Limites Municipais</span>
                </label>
              </div>
              <div>
                <p className="text-[10px] font-bold text-amber-400/90 mb-2 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                  Este recurso se tornará premium em breve.
                </p>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                  Imagens anteriores
                  <span title="Busca imagens de todos os radares na data/hora selecionada (ou só o radar individual). Cada radar usa a imagem mais próxima disponível.">
                    <Info className="w-3 h-3 text-slate-500 flex-shrink-0 cursor-help" />
                  </span>
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowHistoricalPicker((p) => !p)}
                    className="flex-1 py-2.5 px-3 rounded-lg bg-black/40 border border-white/10 hover:border-cyan-500/40 text-left text-sm text-slate-300 hover:text-cyan-300 transition-all flex items-center justify-between"
                  >
                    <span>
                      {historicalTimestampOverride
                        ? `${historicalDate} ${historicalTime} (UTC)`
                        : 'Clique aqui.'}
                    </span>
                    <Calendar className="w-4 h-4 flex-shrink-0 opacity-60" />
                  </button>
                  {historicalTimestampOverride && (
                    <button
                      type="button"
                      onClick={() => {
                        setHistoricalTimestampOverride(null);
                        setRadarTimestamp(getNowMinusMinutesTimestamp12UTC(3));
                        setSliderMinutesAgo(0);
                        setShowHistoricalPicker(false);
                      }}
                      className="py-2 px-3 rounded-lg bg-emerald-600/80 hover:bg-emerald-500 text-white text-xs font-bold shrink-0"
                      title="Voltar ao ao vivo"
                    >
                      LIVE
                    </button>
                  )}
                </div>
                {showHistoricalPicker && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="mt-3 overflow-hidden"
                  >
                    <div className="rounded-xl border border-white/10 bg-[#0A0E17]/80 overflow-hidden shadow-inner flex">
                      {/* Calendário (esquerda) */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between px-3 py-2 border-b border-white/10 bg-cyan-500/10">
                          <button
                            type="button"
                            onClick={() => {
                              const [y, m] = historicalDate.split('-').map(Number);
                              if (calendarMode === 'days') {
                                const d = new Date(y, m - 1, 1);
                                d.setMonth(d.getMonth() - 1);
                                setHistoricalDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
                              } else if (calendarMode === 'months') {
                                setHistoricalDate(`${y - 1}-${String(m).padStart(2, '0')}-01`);
                              } else if (calendarMode === 'years') {
                                setHistoricalDate(`${y - 10}-01-01`);
                              }
                            }}
                            className="p-1 rounded text-slate-400 hover:text-cyan-400 hover:bg-cyan-500/20 transition-colors"
                          >
                            <ChevronLeft className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (calendarMode === 'days') setCalendarMode('months');
                              else if (calendarMode === 'months') setCalendarMode('years');
                              else setCalendarMode('days');
                            }}
                            className="text-[11px] font-bold text-cyan-300 uppercase tracking-wider hover:bg-cyan-500/20 px-2 py-0.5 rounded transition-colors"
                          >
                            {calendarMode === 'days' && new Date(historicalDate + 'T12:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
                            {calendarMode === 'months' && new Date(historicalDate + 'T12:00:00').getFullYear()}
                            {calendarMode === 'years' && `${Math.floor(new Date(historicalDate + 'T12:00:00').getFullYear() / 10) * 10} - ${Math.floor(new Date(historicalDate + 'T12:00:00').getFullYear() / 10) * 10 + 9}`}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const [y, m] = historicalDate.split('-').map(Number);
                              if (calendarMode === 'days') {
                                const nextFirst = new Date(y, m, 1);
                                const today = new Date();
                                today.setHours(23, 59, 59, 999);
                                if (nextFirst <= today) {
                                  setHistoricalDate(`${nextFirst.getFullYear()}-${String(nextFirst.getMonth() + 1).padStart(2, '0')}-01`);
                                }
                              } else if (calendarMode === 'months') {
                                const nextY = y + 1;
                                if (nextY <= new Date().getFullYear()) {
                                  setHistoricalDate(`${nextY}-${String(m).padStart(2, '0')}-01`);
                                }
                              } else if (calendarMode === 'years') {
                                const nextY = y + 10;
                                if (nextY <= new Date().getFullYear() + 9) {
                                  setHistoricalDate(`${nextY}-01-01`);
                                }
                              }
                            }}
                            className="p-1 rounded text-slate-400 hover:text-cyan-400 hover:bg-cyan-500/20 transition-colors disabled:opacity-40 disabled:pointer-events-none"
                            disabled={(() => {
                              const [y, m] = historicalDate.split('-').map(Number);
                              if (calendarMode === 'days') {
                                const nextFirst = new Date(y, m, 1);
                                return nextFirst > new Date();
                              } else if (calendarMode === 'months') {
                                return y + 1 > new Date().getFullYear();
                              } else if (calendarMode === 'years') {
                                return y + 10 > new Date().getFullYear() + 9;
                              }
                              return false;
                            })()}
                          >
                            <ChevronRight className="w-4 h-4" />
                          </button>
                        </div>
                        <div className="p-1.5">
                          {calendarMode === 'days' && (
                            <>
                              <div className="grid grid-cols-7 gap-0 text-center text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                                {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((d) => (
                                  <span key={d} className="py-0.5">{d}</span>
                                ))}
                              </div>
                              <div className="grid grid-cols-7 gap-0.5">
                                {(() => {
                                  const [y, m] = historicalDate.split('-').map(Number);
                                  const first = new Date(y, m - 1, 1);
                                  const startPad = first.getDay();
                                  const daysInMonth = new Date(y, m, 0).getDate();
                                  const today = new Date();
                                  today.setHours(0, 0, 0, 0);
                                  const cells: (number | null)[] = [];
                                  for (let i = 0; i < startPad; i++) cells.push(null);
                                  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
                                  return cells.map((day, i) => {
                                    if (day === null) return <div key={`e-${i}`} className="aspect-square" />;
                                    const cellDate = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                                    const isSelected = cellDate === historicalDate;
                                    const isToday = cellDate === `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
                                    const isFuture = new Date(cellDate) > today;
                                    return (
                                      <button
                                        key={cellDate}
                                        type="button"
                                        onClick={() => !isFuture && setHistoricalDate(cellDate)}
                                        disabled={isFuture}
                                        className={`aspect-square rounded text-[11px] font-semibold transition-all ${
                                          isFuture
                                            ? 'text-slate-600 cursor-not-allowed'
                                            : isSelected
                                              ? 'bg-cyan-500 text-black shadow-[0_0_8px_rgba(6,182,212,0.4)]'
                                              : isToday
                                                ? 'bg-white/10 text-cyan-300 ring-1 ring-cyan-500/50 hover:bg-white/15'
                                                : 'text-slate-300 hover:bg-cyan-500/20 hover:text-cyan-300'
                                        }`}
                                      >
                                        {day}
                                      </button>
                                    );
                                  });
                                })()}
                              </div>
                            </>
                          )}
                          {calendarMode === 'months' && (
                            <div className="grid grid-cols-3 gap-1 p-2">
                              {Array.from({ length: 12 }, (_, i) => {
                                const y = parseInt(historicalDate.split('-')[0], 10);
                                const cellDate = new Date(y, i, 1);
                                const isFuture = cellDate > new Date();
                                const currentM = parseInt(historicalDate.split('-')[1], 10) - 1;
                                return (
                                  <button
                                    key={i}
                                    type="button"
                                    onClick={() => {
                                      setHistoricalDate(`${y}-${String(i + 1).padStart(2, '0')}-01`);
                                      setCalendarMode('days');
                                    }}
                                    disabled={isFuture}
                                    className={`py-2 rounded text-[10px] font-bold uppercase transition-all ${i === currentM ? 'bg-cyan-500 text-black shadow-[0_0_8px_rgba(6,182,212,0.4)]' : isFuture ? 'text-slate-600 cursor-not-allowed' : 'text-slate-300 bg-white/5 hover:bg-cyan-500/20 hover:text-cyan-300'}`}
                                  >
                                    {new Date(2000, i, 1).toLocaleDateString('pt-BR', { month: 'short' })}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                          {calendarMode === 'years' && (
                            <div className="grid grid-cols-3 gap-1 p-2">
                              {(() => {
                                const currentY = parseInt(historicalDate.split('-')[0], 10);
                                const startY = Math.floor(currentY / 10) * 10 - 1;
                                return Array.from({ length: 12 }, (_, i) => {
                                  const y = startY + i;
                                  const isFuture = y > new Date().getFullYear();
                                  return (
                                    <button
                                      key={y}
                                      type="button"
                                      onClick={() => {
                                        setHistoricalDate(`${y}-01-01`);
                                        setCalendarMode('months');
                                      }}
                                      disabled={isFuture}
                                      className={`py-2 rounded text-[10px] font-bold transition-all ${y === currentY ? 'bg-cyan-500 text-black shadow-[0_0_8px_rgba(6,182,212,0.4)]' : isFuture ? 'text-slate-600 cursor-not-allowed' : 'text-slate-300 bg-white/5 hover:bg-cyan-500/20 hover:text-cyan-300'}`}
                                    >
                                      {y}
                                    </button>
                                  );
                                });
                              })()}
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const t = new Date();
                            setHistoricalDate(`${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`);
                          }}
                          className="w-full py-1 text-[9px] font-medium text-cyan-400/80 hover:text-cyan-300 hover:bg-cyan-500/10 transition-colors border-t border-white/5"
                        >
                          Ir para hoje
                        </button>
                      </div>
                      {/* Horários (direita) */}
                      <div className="w-[72px] flex-shrink-0 border-l border-white/10 flex flex-col">
                        <div className="px-2 py-2 border-b border-white/10 bg-cyan-500/10 text-center">
                          <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">UTC</span>
                        </div>
                        <div className="flex-1 overflow-y-auto custom-scrollbar max-h-[220px]">
                          {Array.from({ length: 288 }, (_, i) => {
                            const h = Math.floor(i * 5 / 60);
                            const m = (i * 5) % 60;
                            const t = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
                            const isSelected = historicalTime === t;
                            return (
                              <button
                                key={t}
                                type="button"
                                onClick={() => {
                                  setHistoricalTime(t);
                                  const [y, mo, d] = historicalDate.split('-').map(Number);
                                  const ts12 = `${y}${String(mo).padStart(2, '0')}${String(d).padStart(2, '0')}${String(h).padStart(2, '0')}${String(m).padStart(2, '0')}`;
                                  setHistoricalTimestampOverride(ts12);
                                  setSliderMinutesAgo(0);
                                }}
                                className={`w-full py-1.5 px-2 text-center text-[11px] font-mono transition-colors ${
                                  isSelected
                                    ? 'bg-cyan-500/30 text-cyan-200 font-bold'
                                    : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                                }`}
                              >
                                {t}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                    {historicalTimestampOverride && (
                      <button
                        type="button"
                        onClick={() => {
                          setHistoricalTimestampOverride(null);
                          setRadarTimestamp(getNowMinusMinutesTimestamp12UTC(3));
                          setSliderMinutesAgo(0);
                          setShowHistoricalPicker(false);
                        }}
                        className="w-full mt-2 py-2 rounded-lg bg-emerald-600/80 hover:bg-emerald-500 text-white font-bold text-xs"
                      >
                        Voltar ao vivo
                      </button>
                    )}
                  </motion.div>
                )}
              </div>
              {/* Removed Prevots inline toggle */}
              {radarTimeLegends.length > 0 && (
                <div className="pt-4 border-t border-white/10">
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">Horário da última imagem</p>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto pr-2 custom-scrollbar">
                    {radarTimeLegends.map(({ name, hhmm, source }, i) => {
                            const dr = displayRadars[i];
                            const isEditing = editingRadar && dr && (editingRadar.station.slug === dr.station.slug);
                            return (
                        <div key={name} className="text-xs flex flex-col gap-1 bg-black/20 px-2 py-1.5 rounded border border-white/5">
                          <div className="flex justify-between items-center">
                            <span className="text-slate-300 truncate mr-2">{name}</span>
                            <span className={`font-bold tracking-wider flex-shrink-0 ${hhmm === 'sem imagem' ? 'text-amber-400/90' : 'text-cyan-400'}`}>
                              {hhmm}{source === 'redemet' ? ' (REDEMET)' : ''}
                            </span>
                          </div>
                          {dr && user?.type === 'admin' && (
                            <button
                              type="button"
                              onClick={() => handleOpenEditRadar(dr)}
                              className={`text-[10px] px-2 py-1 rounded font-medium transition-colors ${isEditing ? 'bg-cyan-500/30 text-cyan-300 border border-cyan-500/50' : 'bg-white/5 hover:bg-cyan-500/20 text-slate-400 hover:text-cyan-300 border border-white/10'}`}
                            >
                              {isEditing ? 'Editando…' : 'Gerar imagem do ao vivo'}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </motion.aside>
        </>
      )}
      </AnimatePresence>

      <div className="flex flex-1 min-h-0 min-w-0 overflow-hidden">
        <div ref={mapContainerRef} className={`flex-1 min-h-0 min-w-0 relative ${
          splitCount === 4 
            ? 'grid grid-cols-2 grid-rows-2' 
            : (splitCount === 2 && isDesktop ? 'flex flex-row' : 'flex flex-col')
        }`}>
          {/* Mapa 1 (Refletividade) */}
          <div className={`relative ${splitCount === 4 ? 'w-full h-full' : (splitCount === 2 ? (isDesktop ? 'w-1/2 h-full' : 'h-1/2') : 'flex-1')}`}>
            <div ref={mapRef} className="absolute inset-0 w-full h-full" />
            {(splitCount === 2 || splitCount === 4) && (
              <div className="absolute z-10 top-0 left-0 right-0 bg-slate-900/80 px-3 py-1 pointer-events-none">
                <span className="text-[10px] font-semibold text-cyan-300">Refletividade</span>
              </div>
            )}
            {/* Mira (Crosshair) */}
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center z-20">
              <div className="relative">
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-5 h-px bg-white/70 shadow-[0_0_2px_rgba(0,0,0,0.8)]" />
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-5 w-px bg-white/70 shadow-[0_0_2px_rgba(0,0,0,0.8)]" />
              </div>
            </div>
            {/* Canvas de Desenho Livre */}
            <canvas
              ref={drawingCanvasRef}
              className="absolute inset-0 w-full h-full z-[2]"
              style={{ pointerEvents: drawingMode ? 'auto' : 'none', cursor: drawingMode ? 'crosshair' : 'default' }}
            />
            {/* Leitura de Valor */}
            <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-black/60 px-2 py-0.5 rounded text-[10px] text-white font-mono z-30">
              {t('live_value_reading')}: {sampledValue1 !== null ? `${sampledValue1} dBZ` : '--'}
            </div>
            {/* Legenda de cores — dBZ (Refletividade) */}
            {(splitCount === 2 || radarProductType === 'reflectividade') && (
              <div className="absolute z-20 top-2 left-2 pointer-events-none sm:top-3 sm:left-3" style={splitCount === 2 ? { top: '28px' } : undefined}>
                <div className="bg-white/90 backdrop-blur-sm rounded-lg shadow-lg px-2 py-1.5 flex items-center gap-1.5">
                  <span className="text-[10px] sm:text-xs font-bold text-slate-700 shrink-0">dBZ</span>
                  <div className="flex flex-col items-center">
                    <div className="h-3 sm:h-4 rounded-sm overflow-hidden flex" style={{ width: 'clamp(120px, 25vw, 220px)' }}>
                      <div className="flex-1" style={{ background: '#8B8589' }} />
                      <div className="flex-1" style={{ background: '#F5F5DC' }} />
                      <div className="flex-1" style={{ background: '#E5E4E2' }} />
                      <div className="flex-1" style={{ background: '#0000FF' }} />
                      <div className="flex-1" style={{ background: '#00FFFF' }} />
                      <div className="flex-1" style={{ background: '#00FF00' }} />
                      <div className="flex-1" style={{ background: '#006400' }} />
                      <div className="flex-1" style={{ background: '#FFFF00' }} />
                      <div className="flex-1" style={{ background: '#FFA500' }} />
                      <div className="flex-1" style={{ background: '#8B0000' }} />
                      <div className="flex-1" style={{ background: '#800080' }} />
                      <div className="flex-1" style={{ background: '#00CED1' }} />
                      <div className="flex-1" style={{ background: '#000000' }} />
                    </div>
                    <div className="flex justify-between w-full mt-0.5 px-0.5">
                      {['-30','-20','-10','0','10','20','30','40','50','60','70','80','90'].map((v) => (
                        <span key={v} className="text-[6px] sm:text-[7px] text-slate-600 font-semibold leading-none">{v}</span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
            {splitCount !== 2 && radarProductType === 'velocidade' && (
              <div className="absolute z-20 top-2 left-2 pointer-events-none sm:top-3 sm:left-3">
                <div className="bg-white/90 backdrop-blur-sm rounded-lg shadow-lg px-2 py-1.5 flex items-center gap-1.5">
                  <span className="text-[10px] sm:text-xs font-bold text-slate-700 shrink-0">m/s</span>
                  <div className="flex flex-col items-center">
                    <div className="h-3 sm:h-4 rounded-sm overflow-hidden flex" style={{ width: 'clamp(120px, 25vw, 220px)' }}>
                      <div className="flex-1" style={{ background: '#FF69B4' }} />
                      <div className="flex-1" style={{ background: '#00008B' }} />
                      <div className="flex-1" style={{ background: '#00FFFF' }} />
                      <div className="flex-1" style={{ background: '#E0FFFF' }} />
                      <div className="flex-1" style={{ background: '#00FF00' }} />
                      <div className="flex-1" style={{ background: '#006400' }} />
                      <div className="flex-1" style={{ background: '#A9A9A9' }} />
                      <div className="flex-1" style={{ background: '#8B0000' }} />
                      <div className="flex-1" style={{ background: '#FF0000' }} />
                      <div className="flex-1" style={{ background: '#FFA500' }} />
                      <div className="flex-1" style={{ background: '#FFFF00' }} />
                      <div className="flex-1" style={{ background: '#808000' }} />
                      <div className="flex-1" style={{ background: '#002200' }} />
                    </div>
                    <div className="flex justify-between w-full mt-0.5 px-0.5">
                      {['-60','-50','-40','-30','-20','-10','0','10','20','30','40','50','60'].map((v) => (
                        <span key={v} className="text-[6px] sm:text-[7px] text-slate-600 font-semibold leading-none">{v}</span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Botão Prevots e DatePicker */}
          <div className="absolute right-2 top-[70px] pointer-events-auto flex flex-col items-end gap-2">
            <button
              onClick={() => setPrevotsOverlayVisible(!prevotsOverlayVisible)}
              className={`group/prevots flex items-center gap-1.5 px-3 py-2.5 rounded-xl font-black text-xs uppercase tracking-wider transition-all duration-200 hover:scale-105 ${
                prevotsOverlayVisible 
                  ? 'bg-emerald-500/90 text-slate-900 shadow-[0_0_20px_rgba(16,185,129,0.3)] hover:bg-emerald-400' 
                  : 'bg-[#0A0E17]/80 text-slate-400 border border-white/10 shadow-lg hover:text-white hover:border-emerald-500/40'
              }`}
              title="Alternar Overlay Prevots"
            >
              <Layers className="w-4 h-4 transition-transform group-hover/prevots:scale-110" />
              Prevots
            </button>
            <AnimatePresence>
              {prevotsOverlayVisible && (
                <motion.input
                  initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}
                  type="date"
                  value={prevotsForecastDate}
                  onChange={(e) => setPrevotsForecastDate(e.target.value)}
                  className="bg-[#0A0E17]/90 backdrop-blur-md border border-emerald-500/50 rounded-lg px-3 py-2 text-sm text-emerald-100 focus:border-emerald-400 outline-none shadow-xl pointer-events-auto"
                />
              )}
            </AnimatePresence>
          </div>

          {/* Mapa 2 (Doppler) */}
          {(splitCount === 2 || splitCount === 4) && (
            <>
              {splitCount === 2 && <div className={`${isDesktop ? 'w-px h-full' : 'h-px w-full'} bg-cyan-500/80 shadow-[0_0_8px_rgba(6,182,212,0.8)] flex-shrink-0 z-10`} />}
              <div className={`relative ${splitCount === 4 ? 'w-full h-full border-l border-cyan-500/30' : (isDesktop ? 'w-1/2 h-full' : 'h-1/2')}`}>
                <div ref={map2Ref} className="absolute inset-0 w-full h-full" />
                <div className="absolute z-10 top-0 left-0 right-0 bg-slate-900/80 px-3 py-1 pointer-events-none">
                  <span className="text-[10px] font-semibold text-emerald-300">Doppler (Velocidade)</span>
                </div>
                {/* Mira (Crosshair) 2 */}
                <div className="absolute inset-0 pointer-events-none flex items-center justify-center z-20">
                  <div className="relative">
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-5 h-px bg-white/70 shadow-[0_0_2px_rgba(0,0,0,0.8)]" />
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-5 w-px bg-white/70 shadow-[0_0_2px_rgba(0,0,0,0.8)]" />
                  </div>
                </div>
                {/* Leitura de Valor 2 */}
                <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-black/60 px-2 py-0.5 rounded text-[10px] text-white font-mono z-30">
                  {t('live_value_reading')}: {sampledValue2 !== null ? `${sampledValue2} m/s` : '--'}
                </div>
              </div>
            </>
          )}

          {/* Mapa 3 (VIL) — apenas no split=4 */}
          {splitCount === 4 && (
            <div className="relative w-full h-full border-t border-cyan-500/30">
              <div ref={map3Ref} className="absolute inset-0 w-full h-full" />
              <div className="absolute z-10 top-0 left-0 right-0 bg-slate-900/80 px-3 py-1 pointer-events-none">
                <span className="text-[10px] font-semibold text-amber-300">VIL (Água Líquida)</span>
              </div>
              {/* Leitura de Valor 3 */}
              <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-black/60 px-2 py-0.5 rounded text-[10px] text-white font-mono z-30">
                VIL: {sampledValue3 !== null ? `${sampledValue3} kg/m²` : '--'}
              </div>
              {/* Legenda VIL */}
              <div className="absolute z-20 pointer-events-none" style={{ top: '28px', left: '8px' }}>
                <div className="bg-white/90 backdrop-blur-sm rounded-lg shadow-lg px-2 py-1.5 flex items-center gap-1.5">
                  <span className="text-[10px] sm:text-xs font-bold text-slate-700 shrink-0">kg/m²</span>
                  <div className="flex flex-col items-center">
                    <div className="h-3 sm:h-4 rounded-sm overflow-hidden flex" style={{ width: 'clamp(100px, 20vw, 180px)' }}>
                      <div className="flex-1" style={{ background: '#F5F5DC' }} />
                      <div className="flex-1" style={{ background: '#00FFFF' }} />
                      <div className="flex-1" style={{ background: '#00FF00' }} />
                      <div className="flex-1" style={{ background: '#FFFF00' }} />
                      <div className="flex-1" style={{ background: '#FFA500' }} />
                      <div className="flex-1" style={{ background: '#FF0000' }} />
                      <div className="flex-1" style={{ background: '#8B0000' }} />
                    </div>
                    <div className="flex justify-between w-full mt-0.5 px-0.5">
                      {['0','10','25','40','55','70','85'].map((v) => (
                        <span key={v} className="text-[6px] sm:text-[7px] text-slate-600 font-semibold leading-none">{v}</span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Mapa 4 (Waldvogel) — apenas no split=4 */}
          {splitCount === 4 && (
            <div className="relative w-full h-full border-t border-l border-cyan-500/30">
              <div ref={map4Ref} className="absolute inset-0 w-full h-full" />
              <div className="absolute z-10 top-0 left-0 right-0 bg-slate-900/80 px-3 py-1 pointer-events-none">
                <span className="text-[10px] font-semibold text-purple-300">Waldvogel (Echo Top)</span>
              </div>
              {/* Leitura de Valor 4 */}
              <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-black/60 px-2 py-0.5 rounded text-[10px] text-white font-mono z-30">
                ET: {sampledValue4 !== null ? `${sampledValue4} km` : '--'}
              </div>
              {/* Legenda Waldvogel */}
              <div className="absolute z-20 pointer-events-none" style={{ top: '28px', left: '8px' }}>
                <div className="bg-white/90 backdrop-blur-sm rounded-lg shadow-lg px-2 py-1.5 flex items-center gap-1.5">
                  <span className="text-[10px] sm:text-xs font-bold text-slate-700 shrink-0">km</span>
                  <div className="flex flex-col items-center">
                    <div className="h-3 sm:h-4 rounded-sm overflow-hidden flex" style={{ width: 'clamp(100px, 20vw, 180px)' }}>
                      <div className="flex-1" style={{ background: '#B0C4DE' }} />
                      <div className="flex-1" style={{ background: '#4682B4' }} />
                      <div className="flex-1" style={{ background: '#32CD32' }} />
                      <div className="flex-1" style={{ background: '#FFFF00' }} />
                      <div className="flex-1" style={{ background: '#FF8C00' }} />
                      <div className="flex-1" style={{ background: '#FF0000' }} />
                      <div className="flex-1" style={{ background: '#8B0000' }} />
                    </div>
                    <div className="flex justify-between w-full mt-0.5 px-0.5">
                      {['0','3','6','9','12','15','18'].map((v) => (
                        <span key={v} className="text-[6px] sm:text-[7px] text-slate-600 font-semibold leading-none">{v}</span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* UI sobreposta ao mapa (botões, slider, etc.) — posiciona sobre tudo */}
          <div className="absolute inset-0 pointer-events-none z-10">
          <div className="absolute left-2 top-2 pointer-events-auto flex flex-col gap-2">
            <button
              onClick={goToBrazil}
              className="group/btn w-10 h-10 rounded-xl bg-[#0A0E17]/80 backdrop-blur-md border border-white/10 text-slate-400 shadow-lg transition-all duration-200 hover:scale-110 hover:text-white hover:border-cyan-500/40 hover:shadow-[0_0_15px_rgba(6,182,212,0.3)] flex items-center justify-center"
              title="Centralizar Brasil"
            >
              <Home className="w-5 h-5 transition-transform group-hover/btn:scale-110" />
            </button>
            <button
              onClick={refreshRadarNow}
              className="group/btn w-10 h-10 rounded-xl bg-[#0A0E17]/80 backdrop-blur-md border border-white/10 text-slate-400 shadow-lg transition-all duration-200 hover:scale-110 hover:text-white hover:border-cyan-500/40 hover:shadow-[0_0_15px_rgba(6,182,212,0.3)] flex items-center justify-center"
              title="Atualizar imagens"
            >
              <svg className="w-5 h-5 transition-transform group-hover/btn:rotate-180 duration-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
            {/* Botão Super Res / Normal (Refletividade) */}
            <button
              onClick={() => setReflectivityFilterEnabled(prev => !prev)}
              className={`text-[9px] sm:text-[10px] font-bold px-2.5 py-1.5 rounded-xl backdrop-blur-md shadow-lg transition-all duration-200 border ${
                reflectivityFilterEnabled
                  ? 'bg-cyan-500/20 border-cyan-400/50 text-cyan-200 hover:bg-cyan-500/30'
                  : 'bg-amber-500/20 border-amber-400/50 text-amber-200 hover:bg-amber-500/30'
              }`}
              title={reflectivityFilterEnabled ? 'Clique para desativar filtro de ruído (Normal)' : 'Clique para ativar filtro de ruído (Super Res)'}
            >
              {reflectivityFilterEnabled ? '✨ Super Res' : '📡 Normal'}
            </button>
            {(redemetAvailableKeys.size > 0 || displayRadars.some(dr => dr.type === 'cptec' && dr.station.sipamSlug)) && (
              <div className="flex gap-1 mt-1">
                <button
                  onClick={() => setRadarSourceMode('superres')}
                  className={`text-[10px] font-bold px-2 py-1 rounded-lg backdrop-blur-md shadow-lg transition-all duration-200 ${
                    radarSourceMode === 'superres'
                      ? 'bg-cyan-500/30 border border-cyan-400/60 text-cyan-200'
                      : 'bg-[#0A0E17]/80 border border-white/10 text-slate-400 hover:text-white'
                  }`}
                  title="CPTEC Nowcasting (Super Res)"
                >
                  Super Res
                </button>
                <button
                  onClick={() => setRadarSourceMode('hd')}
                  className={`text-[10px] font-bold px-2 py-1 rounded-lg backdrop-blur-md shadow-lg transition-all duration-200 ${
                    radarSourceMode === 'hd'
                      ? 'bg-amber-500/30 border border-amber-400/60 text-amber-200'
                      : 'bg-[#0A0E17]/80 border border-white/10 text-slate-400 hover:text-white'
                  }`}
                  title="HD (REDEMET / SIPAM — maior resolução)"
                >
                  HD
                </button>
              </div>
            )}
          </div>

          {/* Botões do lado direito (Reportar e Super Res) */}
          <div className="absolute z-50 right-2 top-[140px] pointer-events-auto flex flex-col gap-2 items-end">
            {(splitCount === 2 || radarProductType === 'velocidade') && (
              <button
                onClick={() => setSuperResEnabled(!superResEnabled)}
                className={`group/sres flex items-center gap-1.5 px-3 py-2 rounded-xl border transition-all duration-200 shadow-lg ${
                  superResEnabled 
                    ? 'bg-emerald-500 border-emerald-400 text-slate-900 shadow-[0_0_15px_rgba(16,185,129,0.4)]' 
                    : 'bg-[#0A0E17]/80 border-white/10 text-slate-400 hover:text-emerald-400 hover:border-emerald-500/50'
                }`}
                title="Super Res: Filtro de precisão Doppler"
              >
                <Zap className={`w-4 h-4 transition-transform group-hover/sres:scale-110 ${superResEnabled ? 'fill-current' : ''}`} />
                <span className="font-bold text-[10px] uppercase tracking-wider">Super Res</span>
                {superResEnabled && <Check className="w-3 h-3" />}
              </button>
            )}

            <button
              onClick={openReportPopup}
              className="group/report flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-amber-500/90 text-slate-900 font-black text-xs uppercase tracking-wider shadow-[0_0_20px_rgba(245,158,11,0.3)] transition-all duration-200 hover:scale-105 hover:bg-amber-400 hover:shadow-[0_0_25px_rgba(245,158,11,0.5)]"
              title="Enviar relato"
            >
              <AlertTriangle className="w-4 h-4 transition-transform group-hover/report:scale-110" />
              Reportar
            </button>
          </div>

          {/* Painel de edição de radar — arrastar, rotacionar, raio */}
          <AnimatePresence>
            {editingRadar && (
              <motion.div
                initial={{ opacity: 0, x: 40 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 40 }}
                className="pointer-events-auto fixed right-2 top-24 bottom-24 z-30 w-72 rounded-xl border border-cyan-500/30 bg-[#0A0E17]/95 backdrop-blur-xl shadow-xl overflow-hidden flex flex-col"
              >
                <div className="flex items-center justify-between px-3 py-2 border-b border-white/10 flex-shrink-0">
                  <span className="text-sm font-bold text-cyan-300 truncate">{editingRadar.station.name}</span>
                  <button onClick={handleCloseEditRadar} className="p-1 rounded text-slate-400 hover:text-white">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-3 space-y-4">
                  <button
                    type="button"
                    onClick={() => setEditMinutesAgo(0)}
                    className="w-full py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium flex items-center justify-center gap-2"
                  >
                    <Radar className="w-4 h-4" />
                    Gerar imagem do ao vivo
                  </button>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-1">Tempo da imagem (0–60 min atrás)</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min={0}
                        max={60}
                        step={1}
                        value={editMinutesAgo}
                        onChange={(e) => setEditMinutesAgo(Number(e.target.value))}
                        className="flex-1 h-2 bg-slate-700 rounded-lg accent-cyan-500"
                      />
                      <span className="text-xs font-mono text-cyan-400 w-8">{editMinutesAgo} min</span>
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-1">Rotação (°)</label>
                    <input
                      type="range"
                      min={-360}
                      max={360}
                      step={0.5}
                      value={editRotationDegrees}
                      onChange={(e) => setEditRotationDegrees(parseFloat(e.target.value))}
                      onMouseUp={() => saveEditConfig()}
                      onTouchEnd={() => saveEditConfig()}
                      className="w-full h-2 bg-slate-700 rounded-lg accent-cyan-500"
                    />
                    <span className="text-xs font-mono text-cyan-400">{editRotationDegrees}°</span>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-1">Raio (km)</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min={10}
                        max={500}
                        step={10}
                        value={editRangeKm}
                        onChange={(e) => setEditRangeKm(Number(e.target.value))}
                        onMouseUp={() => saveEditConfig()}
                        onTouchEnd={() => saveEditConfig()}
                        className="flex-1 h-2 bg-slate-700 rounded-lg accent-cyan-500"
                      />
                      <span className="text-xs font-mono text-cyan-400 w-12">{editRangeKm} km</span>
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-1">Centro (lat, lng) — arraste ou digite</label>
                    <div className="grid grid-cols-2 gap-2 text-xs font-mono mb-1">
                      <div>
                        <span className="text-slate-500 block mb-0.5">Lat</span>
                        <input
                          type="number"
                          step="any"
                          value={editLiveCenter ? editLiveCenter.lat : editCenterLat}
                          onChange={(e) => {
                            setEditLiveCenter(null);
                            const v = parseFloat(e.target.value);
                            if (!Number.isNaN(v)) setEditCenterLat(v);
                          }}
                          onBlur={() => saveEditConfig()}
                          onKeyDown={(e) => { if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); } }}
                          className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-cyan-400 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 focus:outline-none"
                        />
                      </div>
                      <div>
                        <span className="text-slate-500 block mb-0.5">Lng</span>
                        <input
                          type="number"
                          step="any"
                          value={editLiveCenter ? editLiveCenter.lng : editCenterLng}
                          onChange={(e) => {
                            setEditLiveCenter(null);
                            const v = parseFloat(e.target.value);
                            if (!Number.isNaN(v)) setEditCenterLng(v);
                          }}
                          onBlur={() => saveEditConfig()}
                          onKeyDown={(e) => { if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); } }}
                          className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-cyan-400 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 focus:outline-none"
                        />
                      </div>
                    </div>
                    {editSaving && <span className="text-[10px] text-amber-400 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Salvando…</span>}
                  </div>
                  <button
                    type="button"
                    onClick={() => saveEditConfig()}
                    disabled={editSaving}
                    className="w-full py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-bold flex items-center justify-center gap-2"
                  >
                    {editSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    Salvar
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {showBaseMapGallery && (
            <div className="pointer-events-auto">
              <div className="fixed inset-0 z-30" onClick={() => setShowBaseMapGallery(false)} aria-hidden />
              <motion.div 
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                className="fixed bottom-24 left-1/2 -translate-x-1/2 z-40 w-[min(20rem,95vw)] rounded-2xl border border-white/10 bg-[#0A0E17]/95 backdrop-blur-xl shadow-[0_10px_40px_rgba(0,0,0,0.8)] p-4"
              >
                <div className="text-[10px] font-bold text-cyan-400 uppercase tracking-widest mb-3">Galeria de mapa base</div>
                  <div className="grid grid-cols-2 gap-2">
                  {BASE_MAP_OPTIONS.map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                      onClick={() => { setBaseMapId(opt.id); setShowBaseMapGallery(false); }}
                      className={`rounded-xl overflow-hidden border-2 text-left transition-all duration-200 hover:scale-[1.03] ${baseMapId === opt.id ? 'border-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.3)]' : 'border-white/5 hover:border-white/20'}`}
                    >
                      <div className="aspect-[3/2] relative bg-black/40">
                        {opt.previewUrl ? (
                          <img src={opt.previewUrl} alt="" className="w-full h-full object-cover opacity-80" />
                        ) : (
                          <div className="w-full h-full opacity-50 bg-[#1e293b]" />
                        )}
                        {baseMapId === opt.id && (
                          <div className="absolute top-1 right-1 rounded-full bg-cyan-400 p-0.5"><Check className="w-3 h-3 text-black" /></div>
                        )}
                                </div>
                      <div className="px-2 py-1.5 bg-[#0A0E17]/90 text-[10px] font-bold uppercase tracking-wider text-slate-300 truncate">{opt.label}</div>
                    </button>
                  ))}
                </div>
              </motion.div>
            </div>
          )}

          {/* Slider de tempo e botões de play — Otimizados para mobile e desktop */}
          <div className={`absolute bottom-4 left-1/2 -translate-x-1/2 w-[min(95vw,400px)] pointer-events-auto flex flex-col gap-2 z-10 ${!isDesktop ? 'hidden' : ''}`}>
            {/* Bloco do Slider de tempo */}
            <div className="w-full px-3 py-2 sm:px-4 sm:py-3 rounded-xl sm:rounded-2xl bg-[#0A0E17]/90 backdrop-blur-xl border border-cyan-500/20 shadow-[0_0_30px_rgba(6,182,212,0.15),0_8px_32px_rgba(0,0,0,0.6)] group/slider">
              {sliderMinutesAgo > 60 && !validSliderMinutesAgo && (
                <p className="text-[8px] sm:text-[9px] text-amber-400/90 mb-1.5 sm:mb-2 text-center font-bold tracking-wider uppercase">
                  Voltar além de 1h se tornará recurso premium em breve.
                </p>
              )}
              {sliderValidVerifying && (
                <div className="flex items-center gap-1.5 sm:gap-2 text-[10px] sm:text-xs text-slate-400 mb-1.5 sm:mb-2 justify-center">
                  <Loader2 className="w-3 h-3 sm:w-3.5 sm:h-3.5 animate-spin flex-shrink-0" />
                  Verificando imagens disponíveis…
                </div>
              )}
              <div className="flex items-center gap-2 sm:gap-3">
                <span className="text-[9px] sm:text-[10px] font-black tracking-widest text-slate-500 flex-shrink-0 w-10 sm:w-12 uppercase">
                  {historicalTimestampOverride
                    ? `-${sliderMinutesAgo >= 60 ? `${Math.floor(sliderMinutesAgo / 60)}h${sliderMinutesAgo % 60 ? String(sliderMinutesAgo % 60).padStart(2, '0') : ''}` : `${sliderMinutesAgo}m`}`
                    : sliderMinutesAgo >= maxSliderMinutesAgo
                      ? '-1h'
                      : sliderMinutesAgo >= 60 ? `-${Math.floor(sliderMinutesAgo / 60)}h` : `-${sliderMinutesAgo}m`}
                </span>
                <div className="flex-1 flex flex-col gap-0 relative group/slider">
                  {/* Ticks de Cronologia (Padrão Ouro) */}
                  <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-1 px-1 flex justify-between items-center pointer-events-none opacity-40 group-hover/slider:opacity-70 transition-opacity">
                    {validSliderMinutesAgo && validSliderMinutesAgo.map((_, idx) => (
                      <div key={idx} className="w-[2px] h-[2px] rounded-full bg-cyan-500 shadow-[0_0_5px_rgba(6,182,212,0.5)]" />
                    ))}
                  </div>

                  <div className="absolute left-0 right-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-slate-800/50 overflow-hidden pointer-events-none">
                    <div 
                      className="h-full bg-gradient-to-r from-cyan-600 via-cyan-400 to-cyan-300 rounded-full shadow-[0_0_12px_rgba(6,182,212,0.8)] transition-all duration-150"
                      style={{ width: validSliderMinutesAgo && validSliderMinutesAgo.length > 1
                        ? `${(Math.max(0, validSliderMinutesAgo.indexOf(sliderMinutesAgo)) / Math.max(1, validSliderMinutesAgo.length - 1)) * 100}%`
                        : `${((maxSliderMinutesAgo - sliderMinutesAgo) / maxSliderMinutesAgo) * 100}%` }}
                    />
                  </div>
                  {validSliderMinutesAgo && validSliderMinutesAgo.length > 1 && !sliderValidVerifying ? (
                    <input
                      type="range"
                      min="0"
                      max={validSliderMinutesAgo.length - 1}
                      step="1"
                      value={Math.max(0, validSliderMinutesAgo.indexOf(sliderMinutesAgo))}
                      onChange={(e) => {
                        setIsPlaying(false);
                        const val = parseInt(e.target.value, 10);
                        setSliderMinutesAgo(validSliderMinutesAgo[val] ?? 0);
                      }}
                      className="relative z-10 w-full h-4 appearance-none bg-transparent cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 sm:[&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-3 sm:[&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-cyan-400 [&::-webkit-slider-thumb]:shadow-[0_0_12px_rgba(6,182,212,0.9)] [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-cyan-300 [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:hover:scale-125 [&::-moz-range-thumb]:w-3 sm:[&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-3 sm:[&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-cyan-400 [&::-moz-range-thumb]:shadow-[0_0_12px_rgba(6,182,212,0.9)] [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-cyan-300 [&::-moz-range-track]:bg-transparent [&::-webkit-slider-runnable-track]:bg-transparent"
                      title={sliderMinutesAgo === 0 ? 'Ao vivo' : `${sliderMinutesAgo} min atrás`}
                    />
                  ) : (
                  <input
                    type="range"
                    min="0"
                    max={maxSliderMinutesAgo}
                    step={historicalTimestampOverride ? 6 : 5}
                    value={maxSliderMinutesAgo - sliderMinutesAgo}
                    onChange={(e) => {
                      setIsPlaying(false);
                      setSliderMinutesAgo(maxSliderMinutesAgo - parseInt(e.target.value, 10));
                    }}
                    disabled={sliderValidVerifying}
                    className="relative z-10 w-full h-4 appearance-none bg-transparent cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 sm:[&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-3 sm:[&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-cyan-400 [&::-webkit-slider-thumb]:shadow-[0_0_12px_rgba(6,182,212,0.9)] [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-cyan-300 [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:hover:scale-125 [&::-moz-range-thumb]:w-3 sm:[&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-3 sm:[&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-cyan-400 [&::-moz-range-thumb]:shadow-[0_0_12px_rgba(6,182,212,0.9)] [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-cyan-300 [&::-moz-range-track]:bg-transparent [&::-webkit-slider-runnable-track]:bg-transparent"
                    title={sliderMinutesAgo === 0 ? 'Ao vivo' : sliderMinutesAgo >= maxSliderMinutesAgo ? '1 h atrás' : `${sliderMinutesAgo} min atrás`}
                  />
                  )}
                  <div className="text-center leading-none mt-1">
                    <span className="text-[10px] sm:text-sm font-black tracking-widest text-cyan-300 drop-shadow-[0_0_10px_rgba(6,182,212,0.9)]">
                      {(() => {
                        if (!isMounted) return "--:--";
                        const ts = effectiveRadarTimestamp;
                        const d = new Date(Date.UTC(
                          parseInt(ts.slice(0, 4), 10),
                          parseInt(ts.slice(4, 6), 10) - 1,
                          parseInt(ts.slice(6, 8), 10),
                          parseInt(ts.slice(8, 10), 10),
                          parseInt(ts.slice(10, 12), 10)
                        ));
                        return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false });
                      })()}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => setAnimationSpeedMultiplier((prev) => (prev === 1 ? 2 : prev === 2 ? 5 : 1))}
                  className="px-2 py-0.5 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 text-[9px] sm:text-[10px] font-bold text-white transition-all flex items-center justify-center shrink-0"
                >
                  {animationSpeedMultiplier}x
                </button>
                <span className={`text-[8px] sm:text-[10px] font-black tracking-widest flex-shrink-0 w-12 sm:w-14 text-right uppercase ${
                  historicalTimestampOverride
                    ? 'text-amber-400'
                    : sliderMinutesAgo === 0 ? 'text-emerald-400 drop-shadow-[0_0_6px_rgba(16,185,129,0.7)]' : 'text-slate-600'
                }`}>
                  {historicalTimestampOverride
                    ? `${historicalTimestampOverride.slice(8, 10)}:${historicalTimestampOverride.slice(10, 12)}`
                    : sliderMinutesAgo === 0 ? '● LIVE' : 'Ao vivo'}
                </span>
              </div>
            </div>

            {/* Bloco de Botões de Controle da Animação */}
            <div className="flex flex-col items-center gap-1.5 py-1">
              <div className="flex justify-center items-center gap-4">
                <button
                  onClick={() => { setIsPlaying(false); handleSkipBack(); }}
                  title="Voltar 1 imagem"
                  disabled={animationPreloading}
                  className="p-2 sm:p-2.5 bg-[#0A0E17]/80 backdrop-blur-md rounded-full border border-cyan-500/30 text-cyan-400 hover:text-white hover:bg-cyan-500/40 hover:border-cyan-400/80 transition-all hover:scale-110 shadow-lg disabled:opacity-40 disabled:pointer-events-none"
                >
                  <SkipBack className="w-4 h-4 sm:w-5 sm:h-5" />
                </button>
                <button
                  type="button"
                  onClick={() => void handlePlayPauseClick()}
                  disabled={sliderValidVerifying}
                  title={
                    animationPreloading ? 'Cancelar preparação' : isPlaying ? 'Pausar' : 'Iniciar animação (pré-carrega imagens)'
                  }
                  className={`p-3 sm:p-4 rounded-full border-2 transition-all hover:scale-110 shadow-[0_0_15px_rgba(6,182,212,0.3)] backdrop-blur-md ${
                    animationPreloading
                      ? 'bg-cyan-800/90 border-cyan-500/80 text-white hover:bg-cyan-700'
                      : isPlaying
                        ? 'bg-amber-500/90 border-amber-400/80 text-black hover:bg-amber-400'
                        : 'bg-cyan-600 border-cyan-400 text-white hover:bg-cyan-500'
                  } ${sliderValidVerifying ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  {animationPreloading ? (
                    <Loader2 className="w-5 h-5 sm:w-6 sm:h-6 animate-spin" />
                  ) : isPlaying ? (
                    <Pause className="w-5 h-5 sm:w-6 sm:h-6 fill-current" />
                  ) : (
                    <Play className="w-5 h-5 sm:w-6 sm:h-6 fill-current ml-1" />
                  )}
                </button>
                <button
                  onClick={() => { setIsPlaying(false); handleSkipForward(); }}
                  title="Avançar 1 imagem"
                  disabled={animationPreloading}
                  className="p-2 sm:p-2.5 bg-[#0A0E17]/80 backdrop-blur-md rounded-full border border-cyan-500/30 text-cyan-400 hover:text-white hover:bg-cyan-500/40 hover:border-cyan-400/80 transition-all hover:scale-110 shadow-lg disabled:opacity-40 disabled:pointer-events-none"
                >
                  <SkipForward className="w-4 h-4 sm:w-5 sm:h-5" />
                </button>
              </div>
              {animationPreloading && (
                <div className="w-full max-w-[220px] mx-auto px-2">
                  <div className="h-1 rounded-full bg-slate-700/80 overflow-hidden">
                    <div
                      className="h-full bg-cyan-400 transition-[width] duration-150 ease-out"
                      style={{ width: `${Math.round(animationPreloadProgress * 100)}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-center text-slate-400 mt-1">Preparando imagens da animação…</p>
                </div>
              )}
            </div>
          </div>
          </div>{/* fecha div pointer-events-none */}
        </div>
      </div>

      {/* Popup de relato multi-etapa */}
      <AnimatePresence>
      {reportStep !== 'closed' && (
        <>
          {reportStep !== 'pick-map' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" onClick={cancelReport} aria-hidden />
          )}
          {reportStep === 'pick-map' ? (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="fixed z-50 bottom-24 left-4 right-4 mx-auto max-w-md rounded-xl bg-[#0F131C]/95 backdrop-blur-xl border border-white/10 shadow-lg p-4 flex items-center justify-between gap-4"
            >
              <p className="text-slate-300 text-sm font-medium flex items-center gap-2">
                <MapPin className="w-4 h-4 text-cyan-400" />
                Toque no mapa para selecionar o local
              </p>
              <button onClick={cancelReport} className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-slate-200 text-sm font-bold shrink-0">
                Cancelar
              </button>
            </motion.div>
          ) : (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, x: '-50%', y: '-50%' }}
            animate={{ opacity: 1, scale: 1, x: '-50%', y: '-50%' }}
            exit={{ opacity: 0, scale: 0.95, x: '-50%', y: '-50%' }}
            className="fixed z-50 top-1/2 left-1/2 w-[min(22rem,92vw)] rounded-2xl bg-[#0F131C]/95 backdrop-blur-xl border border-white/10 shadow-[0_10px_40px_rgba(0,0,0,0.8)] overflow-hidden"
          >
            {/* Etapa 1: Escolher localização */}
            {reportStep === 'location' && (
              <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold tracking-widest uppercase text-cyan-400">Localização do relato</h3>
                  <button onClick={cancelReport} className="text-slate-400 hover:text-white transition-colors"><X className="w-4 h-4" /></button>
                </div>
                <button
                  onClick={() => {
                    if (myLocation) {
                      setReportLat(parseFloat(myLocation.lat.toFixed(5)));
                      setReportLng(parseFloat(myLocation.lng.toFixed(5)));
                      setReportStep('form');
                    } else {
                      addToast('Localização não disponível', 'info');
                    }
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/20 text-cyan-300 text-sm font-bold transition-all transform hover:scale-[1.02]"
                >
                  <Crosshair className="w-5 h-5 flex-shrink-0" />
                  Usar minha localização atual
                </button>
                <button
                  onClick={startPickMapLocation}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 text-slate-200 text-sm font-bold transition-all transform hover:scale-[1.02]"
                >
                  <MapPin className="w-5 h-5 flex-shrink-0" />
                  Outra localização (clicar no mapa)
                </button>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={reportCitySearch}
                    onChange={(e) => setReportCitySearch(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && searchCityForReport()}
                    placeholder="Buscar cidade…"
                    className="flex-1 bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-slate-200 placeholder:text-slate-500 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 outline-none transition-all"
                  />
                  <button
                    onClick={searchCityForReport}
                    className="px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 text-slate-200 transition-colors"
                  >
                    <Search className="w-4 h-4" />
                  </button>
                </div>
              </motion.div>
            )}

            {/* Etapa 2: Formulário */}
            {reportStep === 'form' && (
              <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold tracking-widest uppercase text-cyan-400">Dados do relato</h3>
                  <button onClick={cancelReport} className="text-slate-400 hover:text-white transition-colors"><X className="w-4 h-4" /></button>
                          </div>

                <div className="flex gap-3 text-[10px] font-mono text-slate-400 bg-black/20 p-2 rounded-lg border border-white/5">
                  <span>Lat: {reportLat}</span>
                  <span>Lon: {reportLng}</span>
                          </div>

                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-2">Tipo de relato</label>
                  <div className="flex gap-2">
                    {([['ven', 'Vento', '#3b82f6'], ['gra', 'Granizo', '#22c55e'], ['tor', 'Tornado', '#ef4444']] as const).map(([val, lbl, clr]) => (
                      <button
                        key={val}
                        onClick={() => { setReportType(val); setReportDetail(''); }}
                        className={`flex-1 px-2 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all transform hover:scale-105 border ${
                          reportType === val ? 'border-white/20 text-white shadow-lg' : 'border-white/5 text-slate-400 hover:text-white hover:bg-white/5'
                        }`}
                        style={reportType === val ? { backgroundColor: `${clr}40`, boxShadow: `0 0 15px ${clr}40` } : undefined}
                      >
                        {lbl}
                        </button>
                    ))}
                  </div>
                </div>

                {reportType === 'ven' && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-2">Velocidade estimada (km/h)</label>
                    <input
                      type="text"
                      value={reportDetail}
                      onChange={(e) => setReportDetail(e.target.value)}
                      placeholder="Ex: 90 km/h"
                      className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-slate-200 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
                    />
                  </motion.div>
                )}
                {reportType === 'gra' && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-2">Tamanho estimado</label>
                    <input
                      type="text"
                      value={reportDetail}
                      onChange={(e) => setReportDetail(e.target.value)}
                      placeholder="Ex: 3 cm"
                      className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-slate-200 focus:border-green-500 focus:ring-1 focus:ring-green-500 outline-none transition-all"
                    />
                  </motion.div>
                )}

                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-2">Enviar mídia (obrigatório: foto, link ou vídeo)</label>
                  <div className="flex gap-2 mb-3 bg-black/20 p-1 rounded-xl border border-white/5">
                    <button
                      onClick={() => setReportMediaMode('file')}
                      className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${
                        reportMediaMode === 'file' ? 'bg-white/10 text-white shadow-md' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      <Upload className="w-3.5 h-3.5" />
                      Arquivo
                    </button>
                    <button
                      onClick={() => setReportMediaMode('link')}
                      className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${
                        reportMediaMode === 'link' ? 'bg-white/10 text-white shadow-md' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      <Link2 className="w-3.5 h-3.5" />
                      Link
                    </button>
                  </div>
                  {reportMediaMode === 'file' && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                      <input
                        type="file"
                        accept="image/*,video/*"
                        onChange={(e) => setReportMediaFile(e.target.files?.[0] ?? null)}
                        className="w-full text-xs text-slate-300 file:mr-3 file:px-4 file:py-2 file:rounded-lg file:border-0 file:bg-white/10 file:text-white file:text-xs file:font-bold file:cursor-pointer file:transition-colors hover:file:bg-white/20"
                      />
                      {reportMediaFile && <p className="text-[10px] text-cyan-400 mt-2 truncate font-medium">{reportMediaFile.name}</p>}
                    </motion.div>
                  )}
                  {reportMediaMode === 'link' && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                      <input
                        type="url"
                        value={reportMediaLink}
                        onChange={(e) => setReportMediaLink(e.target.value)}
                        placeholder="https://..."
                        className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-slate-200 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 outline-none transition-all"
                      />
                    </motion.div>
                  )}
                </div>

                <button
                  onClick={submitReport}
                  disabled={reportSending || (!reportMediaFile && !(reportMediaMode === 'link' && reportMediaLink?.trim()))}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed text-slate-900 font-black text-sm uppercase tracking-wider shadow-[0_0_15px_rgba(245,158,11,0.4)] transition-all transform hover:scale-[1.02]"
                >
                  <Send className="w-4 h-4" />
                  {reportSending ? 'Enviando…' : 'Enviar relato'}
                </button>
              </motion.div>
            )}
          </motion.div>
          )}
        </>
      )}
      </AnimatePresence>

      {/* Barra de ferramentas inferior horizontal */}
      <div className="flex-shrink-0 flex items-center justify-around gap-1 px-2 py-2 bg-[#0A0E17]/90 backdrop-blur-xl border-t border-white/10 relative z-20 shadow-[0_-4px_20px_rgba(0,0,0,0.4)]">
        {/* Botão Ao vivo - transmissão */}
        <button
          onClick={async () => {
            if (isStreaming) {
              liveKitRoomRef.current?.disconnect(true);
              liveKitRoomRef.current = null;
              localStreamRef.current?.getTracks().forEach((t) => t.stop());
              localStreamRef.current = null;
              setIsStreaming(false);
              liveRoomNameRef.current = null;
              if (user) {
                await updatePresence(user.uid, {
                  displayName: user.displayName || 'Usuário',
                  photoURL: user.photoURL,
                  userType: null,
                  locationShared: !!myLocation,
                  lat: myLocation?.lat ?? null,
                  lng: myLocation?.lng ?? null,
                  page: 'ao-vivo',
                  isLiveStreaming: false,
                  liveRoomName: null,
                });
              }
              addToast('Transmissão encerrada.', 'info');
              return;
            }
            setStreamError(null);
            setStreamLoading(true);
            try {
              const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
              localStreamRef.current = stream;
              const roomName = `live-${user?.uid ?? 'anon'}`;
              liveRoomNameRef.current = roomName;

              const tokenRes = await fetch('/api/livekit-token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  roomName,
                  participantName: user?.displayName || 'Transmissor',
                  participantIdentity: user?.uid ?? `anon-${Date.now()}`,
                }),
              });
              if (!tokenRes.ok) {
                const errData = await tokenRes.json().catch(() => ({}));
                throw new Error(errData.error || 'Falha ao obter token LiveKit');
              }
              const { token, url } = await tokenRes.json();

              const room = new Room();
              liveKitRoomRef.current = room;
              await room.connect(url, token);
              for (const track of stream.getTracks()) {
                await room.localParticipant.publishTrack(track, { name: track.kind });
              }

              setIsStreaming(true);
              if (user && myLocation) {
                await updatePresence(user.uid, {
                  displayName: user.displayName || 'Usuário',
                  photoURL: user.photoURL,
                  userType: null,
                  locationShared: true,
                  lat: myLocation.lat,
                  lng: myLocation.lng,
                  page: 'ao-vivo',
                  isLiveStreaming: true,
                  liveRoomName: roomName,
                });
              }
              addToast('Transmissão ao vivo iniciada! Outros podem clicar no seu ícone para assistir.', 'success');
            } catch (err: any) {
              localStreamRef.current?.getTracks().forEach((t) => t.stop());
              localStreamRef.current = null;
              liveKitRoomRef.current = null;
              setStreamError(err?.message || 'Erro ao acessar câmera');
              addToast(err?.message || 'Permissão de câmera negada ou LiveKit não configurado.', 'error');
            } finally {
              setStreamLoading(false);
            }
          }}
          disabled={streamLoading}
          className={`group/tab flex flex-col items-center gap-1 p-2.5 rounded-xl transition-all duration-200 relative ${
            isStreaming ? 'text-red-400' : 'text-slate-500 hover:text-white'
          }`}
          title={isStreaming ? 'Encerrar transmissão' : 'Transmitir ao vivo'}
        >
          {isStreaming && (
            <motion.div layoutId="liveGlow" className="absolute inset-0 rounded-xl bg-red-500/20 border border-red-500/40" />
          )}
          <div className="relative z-10 flex items-center justify-center">
            {streamLoading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <>
                <Video className="w-5 h-5" />
                {isStreaming && (
                  <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                )}
              </>
            )}
          </div>
          <span className="relative z-10 text-[9px] font-bold tracking-widest uppercase">
            {isStreaming ? 'Ao vivo' : 'Ao vivo'}
          </span>
        </button>

        <div className="relative">
          <button
            onClick={() => setShowOnlinePanel((v) => !v)}
            className={`group/tab flex flex-col items-center gap-1 p-2.5 rounded-xl transition-all duration-200 relative ${
              showOnlinePanel ? 'text-emerald-400' : 'text-slate-500 hover:text-white'
            }`}
            title="Usuários Online"
          >
            {showOnlinePanel && (
              <motion.div layoutId="bottomBarGlow" className="absolute inset-0 rounded-xl bg-emerald-400/10 border border-emerald-400/20" />
            )}
            <div className="relative z-10 transition-transform duration-200 group-hover/tab:scale-110 group-hover/tab:-translate-y-0.5">
              <Users className="w-5 h-5" />
              {onlineUsers.length > 0 && (
                <span className="absolute -top-1.5 -right-2.5 w-4 h-4 flex items-center justify-center text-[8px] font-black bg-emerald-500 text-white rounded-full shadow-[0_0_8px_rgba(16,185,129,0.8)]">
                  {onlineUsers.length}
                </span>
            )}
          </div>
            <span className="relative z-10 text-[9px] font-bold tracking-widest uppercase">Online</span>
          </button>

          <AnimatePresence>
          {showOnlinePanel && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setShowOnlinePanel(false)} aria-hidden />
              <motion.div 
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
                className="absolute bottom-full left-0 mb-3 z-40 w-64 max-h-[40vh] bg-[#0A0E17]/95 backdrop-blur-xl border border-emerald-500/20 rounded-2xl shadow-[0_10px_40px_rgba(0,0,0,0.8)] overflow-hidden flex flex-col"
              >
                <div className="flex items-center justify-between px-4 py-3 bg-black/20 border-b border-white/5">
                  <span className="text-[10px] font-bold tracking-widest uppercase text-emerald-400 flex items-center gap-2">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
                    </span>
                  Online ({onlineUsers.length})
                </span>
                  <button onClick={() => setShowOnlinePanel(false)} className="text-slate-400 hover:text-white transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>
                <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-white/5">
                {onlineUsers.length === 0 ? (
                    <p className="px-4 py-6 text-xs text-slate-500 text-center font-medium">Nenhum usuário online.</p>
                ) : (
                  onlineUsers.map((u) => (
                    <div
                      key={u.uid}
                        className="flex items-center gap-3 px-4 py-3 hover:bg-white/5 cursor-pointer transition-colors"
                      onClick={() => {
                        if (u.isLiveStreaming && u.uid !== user?.uid && u.liveRoomName) {
                          setLiveViewerUser(u);
                          setLiveViewerOpen(true);
                          setShowOnlinePanel(false);
                        } else if (u.locationShared && u.lat && u.lng && mapInstanceRef.current) {
                          mapInstanceRef.current.panTo({ lat: u.lat, lng: u.lng });
                          mapInstanceRef.current.setZoom(10);
                            setShowOnlinePanel(false);
                        }
                      }}
                    >
                      <div className="relative w-7 h-7 rounded-full overflow-hidden bg-slate-700 flex items-center justify-center border border-white/10 shrink-0">
                        {u.photoURL ? (
                          <>
                            <img
                              src={u.photoURL}
                              alt=""
                              className="absolute inset-0 w-full h-full object-cover"
                              onError={(e) => {
                                e.currentTarget.onerror = null;
                                e.currentTarget.style.display = 'none';
                                const fb = e.currentTarget.nextElementSibling as HTMLElement;
                                if (fb) fb.classList.remove('hidden');
                              }}
                            />
                            <div className="hidden absolute inset-0 flex items-center justify-center text-[10px] font-bold text-white">
                              {(u.displayName?.[0] ?? '?').toUpperCase()}
                            </div>
                          </>
                        ) : (
                          <span className="text-[10px] font-bold text-white">{(u.displayName?.[0] ?? '?').toUpperCase()}</span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold text-slate-200 truncate">
                          {u.displayName}
                            {u.uid === user?.uid && <span className="text-emerald-400 ml-1 font-medium">(você)</span>}
                        </p>
                          {u.locationShared && <p className="text-[9px] text-slate-500 mt-0.5">📍 no mapa</p>}
                          {u.isLiveStreaming && <p className="text-[9px] text-red-400 mt-0.5 font-medium">● Ao vivo</p>}
                      </div>
                        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 shadow-[0_0_5px_rgba(16,185,129,0.8)] ${u.isLiveStreaming ? 'bg-red-500' : 'bg-emerald-400'}`} />
                    </div>
                  ))
                )}
              </div>
              </motion.div>
            </>
          )}
          </AnimatePresence>
        </div>

        {/* Botão GPS com efeito ping */}
          <button
          onClick={goToMyLocation}
          className="group/tab flex flex-col items-center gap-1 p-2.5 rounded-xl text-slate-500 hover:text-cyan-400 transition-all duration-200 relative"
          title="Minha localização"
        >
          <div className="relative z-10 transition-transform duration-200 group-hover/tab:scale-110 group-hover/tab:-translate-y-0.5">
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="absolute w-7 h-7 rounded-full border border-cyan-500/40 animate-ping opacity-30" />
              <span className="absolute w-5 h-5 rounded-full border border-cyan-500/30 animate-[ping_2s_ease-in-out_infinite_0.5s] opacity-20" />
              </span>
            <MapPin className="w-5 h-5 relative z-10 drop-shadow-[0_0_4px_rgba(6,182,212,0.5)]" />
          </div>
          <span className="relative z-10 text-[9px] font-bold tracking-widest uppercase">GPS</span>
        </button>

        {/* Botão Lápis — Desenho livre */}
        <button
          onClick={() => {
            if (drawingMode) {
              // Limpar canvas e desativar
              const canvas = drawingCanvasRef.current;
              if (canvas) {
                const ctx = canvas.getContext('2d');
                if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
              }
              setDrawingMode(false);
            } else {
              setDrawingMode(true);
            }
          }}
          className={`group/tab flex flex-col items-center gap-1 p-2.5 rounded-xl transition-all duration-200 relative ${drawingMode ? 'text-sky-400' : 'text-slate-500 hover:text-white'}`}
          title={drawingMode ? 'Apagar desenho' : 'Desenhar no mapa'}
        >
          {drawingMode && (
            <motion.div layoutId="bottomBarGlow" className="absolute inset-0 rounded-xl bg-sky-400/10 border border-sky-400/20" />
          )}
          <div className="relative z-10 transition-transform duration-200 group-hover/tab:scale-110 group-hover/tab:-translate-y-0.5">
            <Pencil className="w-5 h-5" />
          </div>
          <span className="relative z-10 text-[9px] font-bold tracking-widest uppercase">{drawingMode ? 'Apagar' : 'Lápis'}</span>
        </button>

        <button
          onClick={() => setShowBaseMapGallery((v) => !v)}
          className={`group/tab flex flex-col items-center gap-1 p-2.5 rounded-xl transition-all duration-200 relative ${showBaseMapGallery ? 'text-cyan-400' : 'text-slate-500 hover:text-white'}`}
          title="Tipo de mapa"
        >
          {showBaseMapGallery && (
            <motion.div layoutId="bottomBarGlow" className="absolute inset-0 rounded-xl bg-cyan-400/10 border border-cyan-400/20" />
          )}
          <div className="relative z-10 transition-transform duration-200 group-hover/tab:scale-110 group-hover/tab:-translate-y-0.5">
            <Layers className="w-5 h-5" />
          </div>
          <span className="relative z-10 text-[9px] font-bold tracking-widest uppercase">Mapa</span>
          </button>

        <div className="relative">
          <button
            onClick={() => {
              if (animationPlaying) {
                setAnimationPlaying(false);
                setShowAnimationMenu(false);
              } else {
                setShowAnimationMenu((v) => !v);
              }
            }}
            className={`group/tab ${!isDesktop ? 'hidden' : 'flex'} flex-col items-center gap-1 p-2.5 rounded-xl min-w-[3rem] transition-all duration-200 relative ${animationPlaying ? 'text-amber-400' : showAnimationMenu ? 'text-cyan-400' : 'text-slate-500 hover:text-white'}`}
            title={animationPlaying ? 'Pausar animação' : 'Reproduzir animação'}
          >
            {(animationPlaying || showAnimationMenu) && (
              <motion.div layoutId="bottomBarGlow" className={`absolute inset-0 rounded-xl border ${animationPlaying ? 'bg-amber-400/10 border-amber-400/20' : 'bg-cyan-400/10 border-cyan-400/20'}`} />
            )}
            <div className="relative z-10 transition-transform duration-200 group-hover/tab:scale-110 group-hover/tab:-translate-y-0.5">
              {animationPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
        </div>
            <span className="relative z-10 text-[9px] font-bold tracking-widest uppercase">{animationPlaying ? 'Pausar' : 'Play'}</span>
          </button>
          <AnimatePresence>
          {showAnimationMenu && !animationPlaying && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setShowAnimationMenu(false)} aria-hidden />
              <motion.div 
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
                className="absolute bottom-full left-1/2 -translate-x-1/2 mb-3 z-40 w-44 rounded-xl bg-[#0A0E17]/95 backdrop-blur-xl border border-white/10 shadow-[0_10px_40px_rgba(0,0,0,0.8)] py-2 overflow-hidden"
              >
                <p className="px-4 py-2 text-[9px] font-bold text-cyan-400 uppercase tracking-widest bg-black/20 mb-1">Duração</p>
                {([60, 240, 1440] as const).map((mins) => (
                  <button
                    key={mins}
                    onClick={() => { setAnimationDuration(mins); setShowAnimationMenu(false); setAnimationPlaying(true); }}
                    className={`w-full px-4 py-2.5 text-left text-xs font-bold tracking-wider uppercase transition-all ${animationDuration === mins ? 'bg-cyan-500/20 text-cyan-300' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}
                  >
                    {mins === 60 ? '1 hora' : mins === 240 ? '4 horas' : '24 horas'}
                  </button>
                ))}
              </motion.div>
            </>
          )}
          </AnimatePresence>
      </div>
        <div className="relative">
          <button
            onClick={() => setShowSplitMenu((v) => !v)}
            className={`flex flex-col items-center gap-1 p-2 rounded-xl transition-all transform hover:scale-105 relative ${showSplitMenu || splitCount > 1 ? 'text-cyan-400 bg-cyan-400/10' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}
            title="Divisão de tela"
          >
            {(showSplitMenu || splitCount > 1) && (
              <motion.div layoutId="activeTabIndicator" className="absolute top-0 left-1/4 right-1/4 h-[2px] bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)] rounded-b-full" />
            )}
            {splitCount === 1 ? <Square className="w-5 h-5" /> : <LayoutGrid className="w-5 h-5" />}
            <span className="text-[9px] font-bold tracking-widest uppercase">Split</span>
          </button>
          <AnimatePresence>
          {showSplitMenu && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setShowSplitMenu(false)} aria-hidden />
              <motion.div 
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
                className="absolute bottom-full left-1/2 md:left-1/2 -translate-x-1/2 mb-3 z-40 w-48 max-w-[90vw] rounded-xl bg-[#0F131C]/95 backdrop-blur-xl border border-white/10 shadow-[0_10px_40px_rgba(0,0,0,0.8)] py-2 overflow-hidden"
              >
                <p className="px-4 py-2 text-[9px] font-bold text-cyan-400 uppercase tracking-widest bg-black/20 mb-1">Telas</p>
                {([1, 2, 4] as const).map((n) => (
                  <button
                    key={n}
                    onClick={() => {
                      setSplitCount(n);
                      setShowSplitMenu(false);
                    }}
                    className={`w-full px-4 py-2.5 text-left text-xs font-bold tracking-wider uppercase transition-colors ${splitCount === n ? 'bg-cyan-500/20 text-cyan-300' : 'text-slate-300 hover:bg-white/5 hover:text-white'}`}
                  >
                    {n} radar{n > 1 ? 's' : ''} {n === 2 ? '(Reflet. | Doppler)' : n === 4 ? '(Multi-Produto)' : ''}
                  </button>
                ))}
              </motion.div>
            </>
          )}
          </AnimatePresence>
    </div>
      </div>

      {/* Preview local quando transmitindo */}
      {isStreaming && (
        <div className="fixed bottom-20 left-3 z-30 w-28 aspect-video rounded-xl overflow-hidden border-2 border-red-500/60 shadow-[0_0_20px_rgba(239,68,68,0.3)] bg-black">
          <video
            ref={(el) => {
              localPreviewVideoRef.current = el;
              if (el && localStreamRef.current) el.srcObject = localStreamRef.current;
            }}
            autoPlay
            muted
            playsInline
            className="w-full h-full object-cover"
          />
          <div className="absolute bottom-0 left-0 right-0 py-1 px-2 bg-red-500/80 text-[9px] font-bold text-white text-center uppercase tracking-wider">
            Ao vivo
          </div>
        </div>
      )}

      {/* Modal de visualização da transmissão de outro usuário */}
      <AnimatePresence>
        {liveViewerOpen && liveViewerUser && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm"
              onClick={() => setLiveViewerOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className={`fixed z-50 bg-slate-900 border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col ${
                liveViewerFullscreen ? 'inset-4 md:inset-8' : 'bottom-24 left-4 right-4 md:left-auto md:right-4 md:w-96'
              }`}
            >
              <div className="flex items-center justify-between px-4 py-3 bg-black/40 border-b border-white/10">
                <div className="flex items-center gap-3">
                  <div className="relative w-8 h-8 rounded-full overflow-hidden bg-slate-600 flex items-center justify-center shrink-0">
                    {liveViewerUser.photoURL ? (
                      <>
                        <img
                          src={liveViewerUser.photoURL}
                          alt=""
                          className="absolute inset-0 w-full h-full object-cover"
                          onError={(e) => {
                            e.currentTarget.onerror = null;
                            e.currentTarget.style.display = 'none';
                            const fb = e.currentTarget.nextElementSibling as HTMLElement;
                            if (fb) fb.classList.remove('hidden');
                          }}
                        />
                        <div className="hidden absolute inset-0 flex items-center justify-center text-sm font-bold text-white">
                          {(liveViewerUser.displayName?.[0] ?? '?').toUpperCase()}
                        </div>
                      </>
                    ) : (
                      <span className="text-sm font-bold text-white">{(liveViewerUser.displayName?.[0] ?? '?').toUpperCase()}</span>
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-bold text-white">{liveViewerUser.displayName}</p>
                    <p className="text-[10px] text-red-400 font-medium uppercase tracking-wider">● Ao vivo</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setLiveViewerFullscreen((v) => !v)}
                    className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
                    title={liveViewerFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
                  >
                    {liveViewerFullscreen ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
                  </button>
                  <button
                    onClick={() => {
                      liveViewerRoomRef.current?.disconnect(true);
                      liveViewerRoomRef.current = null;
                      if (liveViewerVideoRef.current) liveViewerVideoRef.current.srcObject = null;
                      setLiveViewerOpen(false);
                      setLiveViewerUser(null);
                      setLiveViewerLoading(false);
                      setLiveViewerError(null);
                    }}
                    className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>
              <div className="flex-1 min-h-[200px] flex items-center justify-center bg-black relative">
                {liveViewerLoading && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 z-10">
                    <Loader2 className="w-12 h-12 text-cyan-400 animate-spin mb-4" />
                    <p className="text-slate-400 text-sm">Conectando à transmissão...</p>
                  </div>
                )}
                {liveViewerError && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 z-10 p-6">
                    <Video className="w-16 h-16 text-red-500/50 mx-auto mb-4" />
                    <p className="text-red-400 text-sm font-medium mb-2">Erro ao conectar</p>
                    <p className="text-slate-500 text-xs text-center max-w-[260px]">{liveViewerError}</p>
                  </div>
                )}
                <video
                  ref={liveViewerVideoRef}
                  autoPlay
                  playsInline
                  muted={false}
                  className="w-full h-full object-contain"
                />
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showPrevotsDialog && selectedPrevotsLinks && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm pointer-events-auto"
            onClick={() => setShowPrevotsDialog(false)}
          >
            <motion.div
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-slate-900 border border-slate-700 shadow-2xl rounded-2xl w-full max-w-sm overflow-hidden"
            >
              <div className="flex items-center justify-between p-4 border-b border-slate-700 bg-slate-800/50">
                <div className="flex items-center gap-2">
                  <Layers className="w-5 h-5 text-emerald-400" />
                  <h3 className="font-bold text-slate-100">Publicação da Prevots</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setShowPrevotsDialog(false)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-5 space-y-4">
                <p className="text-sm text-slate-300 font-medium">
                  Acompanhe os detalhes e notas meteorológicas para a previsão do dia <strong className="text-white">{selectedPrevotsLinks.date.split('-').reverse().join('/')}</strong> nos canais oficiais:
                </p>
                <div className="space-y-3 pt-2">
                  {selectedPrevotsLinks.instagramUrl ? (
                    <a
                      href={selectedPrevotsLinks.instagramUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 w-full p-3 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white font-bold transition-all shadow-lg hover:shadow-pink-500/25"
                    >
                      <Instagram className="w-5 h-5" />
                      Visualizar no Instagram
                    </a>
                  ) : (
                    <div className="flex items-center gap-3 w-full p-3 rounded-xl bg-slate-800 text-slate-500 font-bold border border-slate-700 cursor-not-allowed">
                      <Instagram className="w-5 h-5 opacity-50" />
                      Sem link do Instagram
                    </div>
                  )}
                  
                  {selectedPrevotsLinks.xUrl ? (
                    <a
                      href={selectedPrevotsLinks.xUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 w-full p-3 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-600 text-white font-bold transition-all shadow-lg"
                    >
                      <Twitter className="w-5 h-5 fill-current" />
                      Visualizar no X (Twitter)
                    </a>
                  ) : (
                    <div className="flex items-center gap-3 w-full p-3 rounded-xl bg-slate-800 text-slate-500 font-bold border border-slate-700 cursor-not-allowed">
                      <Twitter className="w-5 h-5 opacity-50" />
                      Sem link do X
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </motion.div>
    </AnimatePresence>
  );
}
