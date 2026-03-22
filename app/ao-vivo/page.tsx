'use client';

import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Radio, Users, X, Home, MapPin, Layers, Radar, Check, Menu, Play, Pause, SkipBack, SkipForward, LayoutGrid, Square, AlertTriangle, Send, Link2, Upload, Search, Crosshair, Loader2, Save, Calendar, Info, Video, Maximize2, Minimize2, Instagram, Twitter, Zap } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { updatePresence, removePresence, subscribeToPresence, type PresenceData } from '@/lib/presence';
import { subscribeToTodayReports, saveStormReport, recordReportView, type StormReport } from '@/lib/stormReportStore';
import { MAP_STYLE_DARK, LOCATION_REQUEST_EXCLUDED_UIDS } from '@/lib/constants';
import {
  CPTEC_RADAR_STATIONS,
  getRadarImageBounds,
  calculateRadarBounds,
  IPMET_FIXED_BOUNDS,
  USP_STARNET_FIXED_BOUNDS,
  GET_RADAR_IPMET_URL,
  GET_RADAR_USP_URL,
  buildNowcastingPngUrl,
  getNearestRadarTimestamp,
  getNowMinusMinutesTimestamp12UTC,
  subtractMinutesFromTimestamp12UTC,
  type CptecRadarStation,
} from '@/lib/cptecRadarStations';
import { fetchPrevotsForecasts } from '@/lib/prevotsForecastStore';
import { PREVOTS_LEVEL_COLORS, type PrevotsForecast } from '@/lib/prevotsForecastData';
import {
  ARGENTINA_RADAR_STATIONS,
  buildArgentinaRadarPngUrl,
  getArgentinaRadarTimestamp,
  getArgentinaRadarBounds,
  type ArgentinaRadarStation,
} from '@/lib/argentinaRadarStations';
import { fetchRadarConfigs, saveRadarConfig, type RadarConfig } from '@/lib/radarConfigStore';
import { groupRadarsByLocation } from '@/lib/radarGrouping';
import { hasRedemetFallback, getRedemetArea } from '@/lib/redemetRadar';
import { getIpmetStorageUrlCandidates } from '@/lib/ipmetStorage';
import { filterRadarImageFromUrl, filterClimatempoRadarImage, filterDopplerSuperRes } from '@/lib/radarImageFilter';
import { cacheRadarImage } from '@/lib/radarCacheClient';
import { Room, RoomEvent, Track } from 'livekit-client';
import { recordVisit, subscribeToTodayVisitCount } from '@/lib/visitCounter';

type DisplayRadar = { type: 'cptec'; station: CptecRadarStation } | { type: 'argentina'; station: ArgentinaRadarStation };

type BaseMapId = 'dark' | 'light' | 'satellite' | 'hybrid' | 'roadmap' | 'terrain';

const BASE_MAP_OPTIONS: { id: BaseMapId; label: string; previewType: 'static' | 'placeholder'; staticMapType?: 'satellite' | 'hybrid' | 'roadmap' | 'terrain'; placeholderBg?: string }[] = [
  { id: 'satellite', label: 'Satélite', previewType: 'static', staticMapType: 'satellite' },
  { id: 'hybrid', label: 'Satélite com rótulos', previewType: 'static', staticMapType: 'hybrid' },
  { id: 'roadmap', label: 'Padrão (ruas)', previewType: 'static', staticMapType: 'roadmap' },
  { id: 'terrain', label: 'Terreno', previewType: 'static', staticMapType: 'terrain' },
  { id: 'dark', label: 'Escuro', previewType: 'placeholder', placeholderBg: '#1e293b' },
  { id: 'light', label: 'Claro', previewType: 'placeholder', placeholderBg: '#e2e8f0' },
];

function getStaticMapPreviewUrl(maptype: string): string {
  const key = typeof process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY === 'string' ? process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY : '';
  if (!key || key.startsWith('COLE_SUA')) return '';
  return `https://maps.googleapis.com/maps/api/staticmap?center=-14,-52&zoom=4&size=180x120&maptype=${maptype}&key=${key}`;
}

declare const google: any;

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
  return `/api/radar-proxy?url=${encodeURIComponent(url)}`;
}

/** Retorna [proxyUrl, directUrl] — fallback direto quando proxy retorna Backend Not Found (Firebase). */
function getRadarUrlsWithFallback(url: string): [string, string] {
  return [getProxiedRadarUrl(url), url];
}

/** Filtra minutos atrás para manter apenas os que têm imagem disponível (slider sem repetições, modo único). */
async function filterValidSliderMinutesAgo(
  dr: DisplayRadar,
  productType: 'reflectividade' | 'velocidade',
  maxMinutes: number,
  radarConfigs: RadarConfig[],
  signal?: AbortSignal
): Promise<number[]> {
  const configSlug = dr.type === 'cptec' ? dr.station.slug : `argentina:${dr.station.id}`;
  const cfg = radarConfigs.find((c) => c.stationSlug === configSlug);
  
  // Usa o intervalo configurado do radar (admin/radares) ao invés de step fixo
  const radarInterval = cfg?.updateIntervalMinutes ?? (dr.type === 'cptec' ? (dr.station.updateIntervalMinutes ?? 5) : 10);
  const step = Math.max(1, radarInterval);
  const candidates: number[] = [];
  for (let m = 0; m <= maxMinutes; m += step) candidates.push(m);
  if (candidates.length === 0) return [0];

  /** Climatempo POA só possui latest (sem histórico) */
  if (dr.type === 'cptec' && dr.station.slug === 'climatempo-poa') {
    return [0];
  }

  /** IPMET: imagens antigas estão no Storage; a mais recente (0) sempre existe no servidor. */
  if (dr.type === 'cptec' && dr.station.slug === 'ipmet-bauru') {
    const baseTs12 = getNowMinusMinutesTimestamp12UTC(3);
    const result: number[] = [0];

    try {
      const res = await fetch(`/api/ipmet-available-timestamps?ts12=${encodeURIComponent(baseTs12)}`, { cache: 'no-store', signal });
      const data = await res.json().catch(() => ({}));
      
      const timestamps: string[] = data.timestamps || [];
      if (timestamps.length > 0) {
        const y = parseInt(baseTs12.slice(0, 4), 10);
        const m = parseInt(baseTs12.slice(4, 6), 10) - 1;
        const d = parseInt(baseTs12.slice(6, 8), 10);
        const hh = parseInt(baseTs12.slice(8, 10), 10);
        const mm = parseInt(baseTs12.slice(10, 12), 10);
        const baseDateMs = Date.UTC(y, m, d, hh, mm);
        
        timestamps.forEach(ts => {
           const fy = parseInt(ts.slice(0, 4), 10);
           const fm = parseInt(ts.slice(4, 6), 10) - 1;
           const fd = parseInt(ts.slice(6, 8), 10);
           const fhh = parseInt(ts.slice(8, 10), 10);
           const fmm = parseInt(ts.slice(10, 12), 10);
           const fileDateMs = Date.UTC(fy, fm, fd, fhh, fmm);
           
           const diffMin = Math.round((baseDateMs - fileDateMs) / 60000);
           // Como estamos lidando com imagens históricas de até maxMinutes, filtramos:
           if (diffMin > 0 && diffMin <= maxMinutes) {
             result.push(diffMin);
           }
        });
      }
    } catch {
       // Se der erro, só exibe o Ao Vivo (0)
    }

    // A API retorna do mais recente pro mais antigo (diffMin será 14, 25, 36, ...)
    // Então o vetor "result" fica [0, 14, 25, 36]
    // A interface genérica espera que idx=0 seja o mais ANTIGO, e o final seja 0 (recente).
    // Ou seja: [60, 50, ..., 0]. Precisamos reverter.
    result.reverse();
    return result;
  }

  const BATCH = 12;
  const result: number[] = [];
  for (let i = 0; i < candidates.length; i += BATCH) {
    if (signal?.aborted) return candidates;
    const batch = candidates.slice(i, i + BATCH);
    const checks = await Promise.all(
      batch.map(async (minutesAgo) => {
        // Regra de busca: se não encontrar no horário padrão, procura nos próximos 10 minutos
        for (let windowOffset = 0; windowOffset < 10; windowOffset++) {
          let url: string;
          const searchMin = minutesAgo + windowOffset;
          if (dr.type === 'cptec') {
            const ts12 = getNowMinusMinutesTimestamp12UTC(3 + searchMin);
            url = buildNowcastingPngUrl(dr.station, ts12, productType);
          } else {
            const d = new Date(Date.now() - (3 + searchMin) * 60_000);
            const ts = getArgentinaRadarTimestamp(d, dr.station);
            url = buildArgentinaRadarPngUrl(dr.station, ts, productType);
          }
          try {
            const res = await fetch(`/api/radar-exists?url=${encodeURIComponent(url)}`, { cache: 'no-store', signal });
            const data = await res.json().catch(() => ({}));
            if (data.exists === true) return true;
          } catch {
            // continua para o próximo minuto da janela
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
const RADAR_ICON_AVAILABLE = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">' +
  '<circle cx="16" cy="16" r="14" fill="#22c55e" stroke="#15803d" stroke-width="1.5"/>' +
  '<path d="M16 8 L16 24 M10 14 L22 18 L10 22 Z" fill="white" stroke="white" stroke-width="0.8" stroke-linejoin="round"/>' +
  '</svg>'
);

/** Ícone radar indisponível: verde apagado com barra diagonal (sem imagem no horário). */
const RADAR_ICON_UNAVAILABLE = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">' +
  '<circle cx="16" cy="16" r="14" fill="#166534" fill-opacity="0.6" stroke="#14532d" stroke-width="1" stroke-opacity="0.7"/>' +
  '<path d="M16 9 L16 23 M11 14 L21 18 L11 22 Z" fill="white" fill-opacity="0.5" stroke="white" stroke-opacity="0.5" stroke-width="0.6"/>' +
  '<line x1="8" y1="8" x2="24" y2="24" stroke="#ef4444" stroke-width="2" stroke-linecap="round" opacity="0.9"/>' +
  '</svg>'
);

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
  const [baseMapId, setBaseMapId] = useState<BaseMapId>('dark');
  const [onlineUsers, setOnlineUsers] = useState<PresenceData[]>([]);
  const [radarConfigs, setRadarConfigs] = useState<RadarConfig[]>([]);
  /** Timestamp nominal em UTC: ~3 min atrás (CPTEC usa UTC nas imagens), atualizado a cada 30 s */
  const [radarTimestamp, setRadarTimestamp] = useState<string>(() => getNowMinusMinutesTimestamp12UTC(3));
  /** Minutos atrás no slider (0 = agora, até meia-noite de hoje). Usado para controle manual do tempo. */
  const [sliderMinutesAgo, setSliderMinutesAgo] = useState(0);
  /** Modo único: só horários com imagem (slider discreto). null = mosaico ou não carregado. */
  const [validSliderMinutesAgo, setValidSliderMinutesAgo] = useState<number[] | null>(null);
  const [sampledValue1, setSampledValue1] = useState<number | null>(null);
  const [sampledValue2, setSampledValue2] = useState<number | null>(null);

  /** Máximo de minutos atrás: live = meia-noite até agora */
  const maxSliderMinutesAgo = useMemo(() => {
    const now = new Date();
    const utcDateStr = now.toISOString().slice(0, 10);
    const localDateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const utcIsNextDay = utcDateStr > localDateStr;
    if (utcIsNextDay) {
      return 1440;
    }
    const startOfDayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
    return Math.max(60, Math.floor((now.getTime() - startOfDayUTC.getTime()) / 60_000));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [radarTimestamp]);

  // Controle de Animação
  const [isPlaying, setIsPlaying] = useState(false);
  const [animationSpeedMultiplier, setAnimationSpeedMultiplier] = useState(1);

  const toggleAnimationSpeed = useCallback(() => {
    setAnimationSpeedMultiplier((prev) => {
      if (prev === 1) return 2;
      if (prev === 2) return 5;
      return 1;
    });
  }, []);
  const playIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Lógica de Animação Automática (Play/Pause)
  useEffect(() => {
    if (isPlaying) {
      if (!playIntervalRef.current) {
        playIntervalRef.current = setInterval(() => {
          setSliderMinutesAgo((prev) => {
            if (validSliderMinutesAgo && validSliderMinutesAgo.length > 0) {
              // Modo único: usa timestamps validados
              const currentIndex = validSliderMinutesAgo.indexOf(prev);
              if (currentIndex < 0) return validSliderMinutesAgo[0]; 
              const nextIndex = currentIndex + 1;
              if (nextIndex >= validSliderMinutesAgo.length) {
                return validSliderMinutesAgo[0]; // Reset loop
              }
              return validSliderMinutesAgo[nextIndex];
            } else {
              // Modo mosaico: usa step fixo de 5 min
              const next = prev - 5;
              return next < 0 ? maxSliderMinutesAgo : next;
            }
          });
        }, 800 / animationSpeedMultiplier); // 800ms / multiplier por frame
      }
    } else {
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
        playIntervalRef.current = null;
      }
    }
    return () => {
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
        playIntervalRef.current = null;
      }
    };
  }, [isPlaying, validSliderMinutesAgo, maxSliderMinutesAgo, animationSpeedMultiplier]);

  const handleSkipBack = useCallback(() => {
    if (validSliderMinutesAgo && validSliderMinutesAgo.length > 0) {
      setSliderMinutesAgo((prev) => {
        const currentIndex = validSliderMinutesAgo.indexOf(prev);
        if (currentIndex <= 0) return validSliderMinutesAgo[0];
        return validSliderMinutesAgo[currentIndex - 1]; 
      });
    } else {
      // Mosaico/split: step fixo de 5 min (voltar = aumenta minutesAgo)
      setSliderMinutesAgo((prev) => Math.min(maxSliderMinutesAgo, prev + 5));
    }
  }, [validSliderMinutesAgo, maxSliderMinutesAgo]);

  const handleSkipForward = useCallback(() => {
    if (validSliderMinutesAgo && validSliderMinutesAgo.length > 0) {
      setSliderMinutesAgo((prev) => {
        const currentIndex = validSliderMinutesAgo.indexOf(prev);
        if (currentIndex >= validSliderMinutesAgo.length - 1) return validSliderMinutesAgo[validSliderMinutesAgo.length - 1];
        return validSliderMinutesAgo[currentIndex + 1]; 
      });
    } else {
      // Mosaico/split: step fixo de 5 min (avançar = diminui minutesAgo)
      setSliderMinutesAgo((prev) => Math.max(0, prev - 5));
    }
  }, [validSliderMinutesAgo, maxSliderMinutesAgo]);

  const [sliderValidVerifying, setSliderValidVerifying] = useState(false);
  /** Localização obrigatória para ao-vivo (presença em tempo real e posicionamento no mapa) */
  /** Radares cuja imagem mais recente não foi encontrada (ex: 404) */
  const [failedRadars, setFailedRadars] = useState<Set<string>>(new Set());
  /** Timestamp efetivo carregado por radar (quando usa fallback, difere do nominal) — para legenda */
  const [radarEffectiveTimestamps, setRadarEffectiveTimestamps] = useState<Record<string, string>>({});
  /** Fonte da imagem por radar: CPTEC ou REDEMET (quando usou fallback) */
  const [radarEffectiveSource, setRadarEffectiveSource] = useState<Record<string, 'cptec' | 'redemet'>>({});
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

  /** Imagens anteriores: data/hora selecionada. null = modo ao vivo. */
  const [historicalTimestampOverride, setHistoricalTimestampOverride] = useState<string | null>(null);
  const [showHistoricalPicker, setShowHistoricalPicker] = useState(false);
  const [historicalDate, setHistoricalDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [historicalTime, setHistoricalTime] = useState('12:00');

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
    const lat = center.lat();
    const lng = center.lng();

    // Encontrar o overlay que contém o centro
    for (let i = overlays.length - 1; i >= 0; i--) {
        const overlay = overlays[i];
        const bounds = overlay.getBounds();
        if (bounds.contains(center)) {
            // Tentar obter a imagem de dentro do overlay
            // GroundOverlay do Google Maps cria um DIV com uma imagem.
            // Precisamos acessar o elemento DOM real ou recarregar via canvas.
            // Como temos a URL do overlay, vamos carregar via canvas (cacheado pelo browser)
            const url = overlay.get('url') || overlay.getUrl?.();
            if (!url) continue;

            const img = new Image();
            img.crossOrigin = "anonymous";
            img.src = url;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                if (!ctx) return;
                ctx.drawImage(img, 0, 0);

                const ne = bounds.getNorthEast();
                const sw = bounds.getSouthWest();
                
                // Mapear lat/lng para x/y no canvas
                const x = ((lng - sw.lng()) / (ne.lng() - sw.lng())) * img.width;
                const y = ((ne.lat() - lat) / (ne.lat() - sw.lat())) * img.height;

                const pixel = ctx.getImageData(x, y, 1, 1).data;
                const val = findClosestValue(pixel[0], pixel[1], pixel[2], palette);
                setVal(val);
            };
            return;
        }
    }
    setVal(null);
  }, []);

  const handleSampleAll = useCallback(() => {
    samplePixelFromOverlays(mapInstanceRef.current, radarOverlaysRef.current, setSampledValue1, dBZ_COLORS);
    if (splitCount === 2) {
        samplePixelFromOverlays(map2InstanceRef.current, radarOverlays2Ref.current, setSampledValue2, VEL_COLORS);
    }
  }, [samplePixelFromOverlays, splitCount]);

  useEffect(() => {
    if (!mapReady) return;
    const l1 = mapInstanceRef.current.addListener('idle', handleSampleAll);
    const l2 = mapInstanceRef.current.addListener('zoom_changed', handleSampleAll);
    let l3: any, l4: any;
    if (map2Ready && map2InstanceRef.current) {
        l3 = map2InstanceRef.current.addListener('idle', handleSampleAll);
        l4 = map2InstanceRef.current.addListener('zoom_changed', handleSampleAll);
    }
    return () => {
        google.maps.event.removeListener(l1);
        google.maps.event.removeListener(l2);
        if (l3) google.maps.event.removeListener(l3);
        if (l4) google.maps.event.removeListener(l4);
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

  /** Todos os radares disponíveis (CPTEC + Argentina), ordenados por distância quando há localização */
  const allRadars = useMemo((): DisplayRadar[] => {
    const cptec: DisplayRadar[] = CPTEC_RADAR_STATIONS.map((s) => ({ type: 'cptec' as const, station: s }));
    const argentina: DisplayRadar[] = ARGENTINA_RADAR_STATIONS.map((s) => ({ type: 'argentina' as const, station: s }));
    const list = [...cptec, ...argentina];
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
  }, [myLocation]);


  const displayRadars = useMemo(() => {
    if (focusedRadarKey) {
      const dr = allRadars.find((r) => (r.type === 'cptec' ? `cptec:${r.station.slug}` : `argentina:${r.station.id}`) === focusedRadarKey);
      return dr ? [dr] : [];
    }
    if (radarMode === 'mosaico') return allRadars;
    if (selectedIndividualRadars.size === 0) return [];
    return allRadars.filter((r) => {
      const id = r.type === 'cptec' ? `cptec:${r.station.slug}` : `argentina:${r.station.id}`;
      return selectedIndividualRadars.has(id);
    });
  }, [focusedRadarKey, radarMode, selectedIndividualRadars, allRadars]);

  /** Legendas: nome do radar + horário local (ou efetivo após fallback) ou "sem imagem" */
  /** Timestamp efetivo: histórico (picker ajustado pelo slider) ou ao vivo */
  const effectiveRadarTimestamp = historicalTimestampOverride
    ? (sliderMinutesAgo > 0 ? subtractMinutesFromTimestamp12UTC(historicalTimestampOverride, sliderMinutesAgo) : historicalTimestampOverride)
    : radarTimestamp;

  const fetchSantiagoRedemet = useCallback(async () => {
    if (santiagoRedemetLoading) return;
    setSantiagoRedemetLoading(true);
    try {
      const ts12 = (historicalTimestampOverride && sliderMinutesAgo > 0) 
        ? subtractMinutesFromTimestamp12UTC(historicalTimestampOverride, sliderMinutesAgo)
        : effectiveRadarTimestamp;
      const res = await fetch(`/api/radar-redemet-find?area=sg&ts12=${ts12}`);
      const data = await res.json();
      if (data.url) {
        setSantiagoRedemetUrl(data.url);
        setRadarSourceMode('hd');
        addToast("Imagem Redemet encontrada para Santiago!", "success");
      } else {
        addToast("Nenhuma imagem Redemet encontrada para este horário.", "error");
      }
    } catch (err) {
      addToast("Erro ao buscar no Redemet.", "error");
    } finally {
      setSantiagoRedemetLoading(false);
    }
  }, [effectiveRadarTimestamp, santiagoRedemetLoading, addToast, historicalTimestampOverride, sliderMinutesAgo]);

  const radarTimeLegends = useMemo(() => {
    const nominalDate = new Date(Date.UTC(
      parseInt(effectiveRadarTimestamp.slice(0, 4), 10),
      parseInt(effectiveRadarTimestamp.slice(4, 6), 10) - 1,
      parseInt(effectiveRadarTimestamp.slice(6, 8), 10),
      parseInt(effectiveRadarTimestamp.slice(8, 10), 10),
      parseInt(effectiveRadarTimestamp.slice(10, 12), 10)
    ));
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
    return displayRadars.map((dr) => {
      const radarKey = dr.type === 'cptec' ? `cptec:${dr.station.slug}` : `argentina:${dr.station.id}`;
      const source = radarEffectiveSource[radarKey];
      if (failedRadars.has(radarKey)) {
        return { name: dr.station.name, hhmm: 'sem imagem', source: undefined as 'cptec' | 'redemet' | undefined };
      }
      const effectiveTs = radarEffectiveTimestamps[radarKey];
      if (effectiveTs) {
        return { name: dr.station.name, hhmm: formatLocal(effectiveTsToUtcDate(effectiveTs)), source };
      }
      let ts: string;
      if (dr.type === 'cptec') {
        ts = getNearestRadarTimestamp(effectiveRadarTimestamp, dr.station);
      } else {
        ts = getArgentinaRadarTimestamp(nominalDate, dr.station);
      }
      return { name: dr.station.name, hhmm: formatLocal(effectiveTsToUtcDate(ts)), source: undefined as 'cptec' | 'redemet' | undefined };
    });
  }, [displayRadars, effectiveRadarTimestamp, failedRadars, radarEffectiveTimestamps, radarEffectiveSource]);

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
      if (dr.type === 'cptec' && dr.station.slug === 'ipmet-bauru') {
        if (editMinutesAgo === 0) return GET_RADAR_IPMET_URL + `?t=${Date.now()}`;
        const candidates = getIpmetStorageUrlCandidates(ts);
        return candidates[0] ?? GET_RADAR_IPMET_URL;
      }
      if (dr.type === 'cptec' && dr.station.slug === 'usp-starnet') {
        return GET_RADAR_USP_URL + `?t=${Date.now()}`;
      }
      if (dr.type === 'cptec') {
        const ts12 = getNearestRadarTimestamp(ts, dr.station);
        return getProxiedRadarUrl(buildNowcastingPngUrl(dr.station, ts12, radarProductType));
      }
      const tsArg = getArgentinaRadarTimestamp(nominalDate, dr.station);
      return getProxiedRadarUrl(buildArgentinaRadarPngUrl(dr.station, tsArg, radarProductType));
    },
    [editMinutesAgo, radarProductType]
  );

  /** Template URL padrão para salvar (quando não há config) */
  const getDefaultUrlTemplate = useCallback((dr: DisplayRadar): string => {
    if (dr.type === 'cptec' && dr.station.slug === 'ipmet-bauru') {
      return GET_RADAR_IPMET_URL;
    }
    if (dr.type === 'cptec' && dr.station.slug === 'usp-starnet') {
      return GET_RADAR_USP_URL;
    }
    if (dr.type === 'cptec') {
      const ts12 = getNowMinusMinutesTimestamp12UTC(3);
      const url = buildNowcastingPngUrl(dr.station, ts12, 'reflectividade');
      return url.replace(/\d{4}\/\d{2}\//, '{year}/{month}/').replace(/_\d{12}(\.png)/, '_{ts12}$1');
    }
    const tsArg = `${getNowMinusMinutesTimestamp12UTC(3).slice(0, 8)}T${getNowMinusMinutesTimestamp12UTC(3).slice(8, 10)}${getNowMinusMinutesTimestamp12UTC(3).slice(10, 12)}00Z`;
    const url = buildArgentinaRadarPngUrl(dr.station, tsArg, 'reflectividade');
    return url.replace(/(\d{4})\/(\d{2})\/(\d{2})\//, '{year}/{month}/{day}/').replace(/_\d{8}T\d{6}Z/, '_{tsArgentina}');
  }, []);

  const handleOpenEditRadar = useCallback((dr: DisplayRadar) => {
    const cfg = radarConfigs.find((c) => c.stationSlug === (dr.type === 'cptec' ? dr.station.slug : `argentina:${dr.station.id}`));
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
    if (!editingRadar) return;
    const lat = overrideLat ?? (editLiveCenter ? editLiveCenter.lat : editCenterLat);
    const lng = overrideLng ?? (editLiveCenter ? editLiveCenter.lng : editCenterLng);
    const slug = editingRadar.type === 'cptec' ? editingRadar.station.slug : `argentina:${editingRadar.station.id}`;
    const cfg = radarConfigs.find((c) => c.stationSlug === slug);
    const urlTemplate = cfg?.urlTemplate ?? getDefaultUrlTemplate(editingRadar);
    const isFixedBounds = editingRadar.type === 'cptec' && (editingRadar.station.slug === 'ipmet-bauru' || editingRadar.station.slug === 'usp-starnet');
    const computedBounds = isFixedBounds
      ? (editingRadar.station.slug === 'ipmet-bauru' ? { ne: IPMET_FIXED_BOUNDS.ne, sw: IPMET_FIXED_BOUNDS.sw } : { ne: USP_STARNET_FIXED_BOUNDS.ne, sw: USP_STARNET_FIXED_BOUNDS.sw })
      : calculateRadarBounds(lat, lng, editRangeKm);
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
        updateIntervalMinutes: editingRadar.station.updateIntervalMinutes ?? 6,
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
    if (!editingRadar) return;
    setEditCenterLat(lat);
    setEditCenterLng(lng);
    await saveEditConfig(lat, lng);
    addToast('Posição salva automaticamente.', 'success');
  }, [editingRadar, saveEditConfig, addToast]);

  const getBoundsForDisplayRadar = useCallback(
    (dr: DisplayRadar) => {
      if (dr.type === 'cptec') {
        const isIpmet = dr.station.slug === 'ipmet-bauru';
        const isUspStarnet = dr.station.slug === 'usp-starnet';
        if (isIpmet) {
          return { north: IPMET_FIXED_BOUNDS.north, south: IPMET_FIXED_BOUNDS.south, east: IPMET_FIXED_BOUNDS.east, west: IPMET_FIXED_BOUNDS.west };
        }
        if (isUspStarnet) {
          return { north: USP_STARNET_FIXED_BOUNDS.north, south: USP_STARNET_FIXED_BOUNDS.south, east: USP_STARNET_FIXED_BOUNDS.east, west: USP_STARNET_FIXED_BOUNDS.west };
        }
        let configSlug = dr.station.slug;
        if (dr.station.slug === 'santiago' && typeof radarSourceMode !== 'undefined' && radarSourceMode === 'hd') {
          configSlug = 'santiago-redemet';
        }
        const cfg = radarConfigs.find((c) => c.id === configSlug || c.stationSlug === configSlug);
        if (cfg && (cfg.lat !== 0 || cfg.lng !== 0)) {
          const range = cfg.rangeKm ?? dr.station.rangeKm ?? 250;
          const b = calculateRadarBounds(cfg.lat, cfg.lng, range);
          return { north: b.ne.lat, south: b.sw.lat, east: b.ne.lng, west: b.sw.lng };
        }
        const b = getRadarImageBounds(dr.station);
        return { north: b.north, south: b.south, east: b.east, west: b.west };
      }
      
      const configSlug = `argentina:${dr.station.id}`;
      const cfg = radarConfigs.find((c) => c.stationSlug === configSlug);
      if (cfg && (cfg.lat !== 0 || cfg.lng !== 0)) {
        const range = cfg.rangeKm ?? dr.station.rangeKm ?? 480;
        const b = calculateRadarBounds(cfg.lat, cfg.lng, range);
        return { north: b.ne.lat, south: b.sw.lat, east: b.ne.lng, west: b.sw.lng };
      }

      const b = getArgentinaRadarBounds(dr.station);
      return { north: b.north, south: b.south, east: b.east, west: b.west };
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

  /** Modo único: verifica quais minutos têm imagem e filtra o slider. */
  useEffect(() => {
    if (radarMode !== 'unico' || displayRadars.length === 0) {
      setValidSliderMinutesAgo(null);
      setSliderValidVerifying(false);
      return;
    }
    const dr = displayRadars[0];
    const maxMin = Math.min(maxSliderMinutesAgo, 120);
    if (maxMin <= 0) {
      setValidSliderMinutesAgo([0]);
      setSliderValidVerifying(false);
      return;
    }
    setSliderValidVerifying(true);
    const ac = new AbortController();
    (async () => {
      const valid = await filterValidSliderMinutesAgo(dr, radarProductType, maxMin, radarConfigs, ac.signal);
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
  }, [radarMode, displayRadars, radarProductType, maxSliderMinutesAgo, radarConfigs]);

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
            participantIdentity: `viewer-${user?.uid ?? Date.now()}`,
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
      const g = (window as any).google;
      if (!g?.maps) {
        retryTimer = setTimeout(initMap, 150);
        return;
      }
      try {
        const { Map } = await g.maps.importLibrary('maps');
        if (!isMounted || !mapRef.current) return;
        const center = myLocation || BRAZIL_CENTER;
        const map = new Map(mapRef.current, {
          center,
          zoom: myLocation ? 8 : 4,
          mapTypeId: 'roadmap',
          styles: MAP_STYLE_DARK,
          disableDefaultUI: false,
          zoomControl: isDesktop,
          mapTypeControl: false,
          fullscreenControl: isDesktop,
          streetViewControl: isDesktop,
          rotateControl: isDesktop,
        });
        mapInstanceRef.current = map;
        setMapReady(true);
      } catch (err) {
        console.error('AoVivo init map error', err);
      }
    };
    initMap();
    return () => {
      isMounted = false;
      if (retryTimer) clearTimeout(retryTimer);
      mapInstanceRef.current = null;
      setMapReady(false);
    };
  }, [canShowMap, myLocation]);

  useEffect(() => {
    if (!mapInstanceRef.current || !mapReady) return;
    const map = mapInstanceRef.current;
    if (baseMapId === 'dark') {
      map.setMapTypeId('roadmap');
      map.setOptions({ styles: MAP_STYLE_DARK });
    } else if (baseMapId === 'light') {
      map.setMapTypeId('roadmap');
      map.setOptions({ styles: [] });
    } else {
      map.setMapTypeId(baseMapId);
      map.setOptions({ styles: [] });
    }
  }, [mapReady, baseMapId]);

  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current || !myLocation) return;
    mapInstanceRef.current.panTo(myLocation);
    mapInstanceRef.current.setZoom(8);
  }, [mapReady, myLocation]);

  /** Segundo mapa para split: cria/destrói conforme splitCount */
  useEffect(() => {
    if (splitCount !== 2 || !mapReady || !mapInstanceRef.current) {
      if (map2InstanceRef.current) {
        map2InstanceRef.current = null;
        setMap2Ready(false);
      }
      return;
    }
    if (!map2Ref.current) return;
    const g = (window as any).google;
    if (!g?.maps) return;
    const main = mapInstanceRef.current;
    const initMap2 = async () => {
      const { Map } = await g.maps.importLibrary('maps');
      if (!map2Ref.current) return;
      const map2 = new Map(map2Ref.current, {
        center: main.getCenter()?.toJSON?.() ?? { lat: -14, lng: -52 },
        zoom: main.getZoom() ?? 8,
        mapTypeId: main.getMapTypeId(),
        styles: main.get('styles') ?? MAP_STYLE_DARK,
        disableDefaultUI: true,
        zoomControl: false,
        mapTypeControl: false,
        fullscreenControl: false,
        streetViewControl: false,
        rotateControl: false,
      });
      map2InstanceRef.current = map2;
      setMap2Ready(true);
    };
    initMap2();
    return () => {
      map2InstanceRef.current = null;
      setMap2Ready(false);
    };
  }, [splitCount, mapReady]);

  /** Sincronização bidirecional entre map1 e map2 */
  useEffect(() => {
    if (!map2Ready || !map2InstanceRef.current || !mapInstanceRef.current) return;
    const map1 = mapInstanceRef.current;
    const map2 = map2InstanceRef.current;

    const syncFromMap1 = () => {
      if (syncingRef.current) return;
      syncingRef.current = true;
      const c = map1.getCenter();
      const z = map1.getZoom();
      if (c) map2.setCenter(c);
      if (z != null) map2.setZoom(z);
      syncingRef.current = false;
    };
    const syncFromMap2 = () => {
      if (syncingRef.current) return;
      syncingRef.current = true;
      const c = map2.getCenter();
      const z = map2.getZoom();
      if (c) map1.setCenter(c);
      if (z != null) map1.setZoom(z);
      syncingRef.current = false;
    };

    const l1c = map1.addListener('center_changed', syncFromMap1);
    const l1z = map1.addListener('zoom_changed', syncFromMap1);
    const l2c = map2.addListener('center_changed', syncFromMap2);
    const l2z = map2.addListener('zoom_changed', syncFromMap2);
    syncFromMap1();

    return () => {
      google.maps.event.removeListener(l1c);
      google.maps.event.removeListener(l1z);
      google.maps.event.removeListener(l2c);
      google.maps.event.removeListener(l2z);
    };
  }, [map2Ready]);

  /** Sincronizar estilo de mapa no map2 */
  useEffect(() => {
    if (!map2InstanceRef.current || !map2Ready) return;
    const map2 = map2InstanceRef.current;
    if (baseMapId === 'dark') {
      map2.setMapTypeId('roadmap');
      map2.setOptions({ styles: MAP_STYLE_DARK });
    } else if (baseMapId === 'light') {
      map2.setMapTypeId('roadmap');
      map2.setOptions({ styles: [] });
    } else {
      map2.setMapTypeId(baseMapId);
      map2.setOptions({ styles: [] });
    }
  }, [map2Ready, baseMapId]);

  useEffect(() => {
    onlineUserMarkersRef.current.forEach((m) => m.setMap(null));
    onlineUserMarkersRef.current = [];
    if (!mapInstanceRef.current || !google?.maps?.OverlayView) return;
    const map = mapInstanceRef.current;
    let usersToShow = onlineUsers.filter((u) => u.locationShared && u.lat != null && u.lng != null);
    if (user && myLocation && !usersToShow.some((u) => u.uid === user.uid)) {
      usersToShow = [
        { uid: user.uid, displayName: user.displayName || 'Você', photoURL: user.photoURL, locationShared: true, lat: myLocation.lat, lng: myLocation.lng, lastSeen: null, isLiveStreaming: isStreamingRef.current, liveRoomName: liveRoomNameRef.current },
        ...usersToShow,
      ];
    }
    usersToShow.forEach((u) => {
      if (!u.locationShared || !u.lat || !u.lng) return;
      const isMe = u.uid === user?.uid;
      const initial = (u.displayName?.[0] ?? '?').toUpperCase();
      const color = isMe ? '#0ea5e9' : '#38bdf8';
      const isLive = !!u.isLiveStreaming;
      const size = isMe ? 40 : 32;
      const height = 40;

      const displayName = u.displayName;
      class UserMarkerOverlay extends google.maps.OverlayView {
        div: HTMLDivElement | null = null;
        constructor(
          private position: { lat: number; lng: number },
          private opts: { color: string; size: number; height: number; initial: string; isMe: boolean; isLive: boolean; photoURL: string | null },
          private onClick: () => void
        ) {
          super();
        }
        onAdd() {
          const { color, size, height, initial, isMe, isLive, photoURL } = this.opts;
          const div = document.createElement('div');
          div.style.cssText = `position:absolute;cursor:pointer;transform:translate(-50%,-100%);pointer-events:auto;z-index:${isMe ? 999 : isLive ? 200 : 100}`;
          div.title = displayName + (isLive ? ' (ao vivo)' : '');
          div.innerHTML = `
            <div style="position:relative;width:${size}px;height:${height}px;display:flex;align-items:flex-end;justify-content:center">
              <div style="position:relative;width:${size}px;height:${size}px;border-radius:50%;overflow:hidden;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.4);background:${color}">
                ${photoURL
                  ? `<img src="${photoURL.replace(/"/g, '&quot;')}" alt="" style="width:100%;height:100%;object-fit:cover" onerror="this.style.display='none';var s=this.nextElementSibling;if(s)s.style.display='flex'"/>
                  <span style="display:none;position:absolute;inset:0;align-items:center;justify-content:center;font-size:11px;font-weight:bold;color:white">${initial}</span>`
                  : isMe
                    ? `<span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center"><span style="width:12px;height:12px;border-radius:50%;background:${color};border:2px solid white"></span></span>`
                    : `<span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:bold;color:white">${initial}</span>`
                }
                ${isLive ? `<span style="position:absolute;top:2px;right:2px;width:8px;height:8px;border-radius:50%;background:#ef4444;border:1.5px solid white"></span>` : ''}
              </div>
              <div style="position:absolute;bottom:0;left:50%;transform:translateX(-50%);width:0;height:0;border-left:8px solid transparent;border-right:8px solid transparent;border-top:10px solid ${color}"></div>
            </div>`;
          div.addEventListener('click', () => this.onClick());
          this.getPanes()!.overlayMouseTarget.appendChild(div);
          this.div = div;
        }
        draw() {
          if (!this.div) return;
          const projection = this.getProjection();
          if (!projection) return;
          const point = projection.fromLatLngToDivPixel(new google.maps.LatLng(this.position.lat, this.position.lng));
          if (point && this.div) {
            this.div.style.left = point.x + 'px';
            this.div.style.top = point.y + 'px';
          }
        }
        onRemove() {
          if (this.div?.parentNode) this.div.parentNode.removeChild(this.div);
          this.div = null;
        }
      }

      const overlay = new UserMarkerOverlay(
        { lat: u.lat!, lng: u.lng! },
        { color, size, height, initial, isMe, isLive, photoURL: u.photoURL ?? null },
        () => {
          if (u.isLiveStreaming && u.uid !== user?.uid && u.liveRoomName) {
            setLiveViewerUser(u);
            setLiveViewerOpen(true);
          } else if (u.lat && u.lng && mapInstanceRef.current) {
            mapInstanceRef.current.panTo({ lat: u.lat!, lng: u.lng! });
            mapInstanceRef.current.setZoom(12);
          }
        }
      );
      overlay.setMap(map);
      onlineUserMarkersRef.current.push(overlay);
    });
    return () => {
      onlineUserMarkersRef.current.forEach((m) => m.setMap(null));
      onlineUserMarkersRef.current = [];
    };
  }, [onlineUsers, user?.uid, myLocation, mapReady, isStreaming]);

  const prevotsForecastToShow = prevotsForecasts.find((f) => f.date === prevotsForecastDate);

  useEffect(() => {
    prevotsPolygonsRef.current.forEach((p) => p.setMap(null));
    prevotsPolygonsRef.current = [];
    if (!mapInstanceRef.current || !mapReady || !prevotsOverlayVisible || !prevotsForecastToShow) return;
    const map = mapInstanceRef.current;
    (prevotsForecastToShow.polygons ?? [])
      .filter((p) => p.level !== 0)
      .sort((a, b) => a.level - b.level)
      .forEach((poly) => {
        const ring = poly.coordinates[0];
        if (!ring || ring.length < 3) return;
        const path = ring.map(([lng, lat]) => ({ lat, lng }));
        const color = PREVOTS_LEVEL_COLORS[poly.level as 0 | 1 | 2 | 3 | 4];
        const gPoly = new google.maps.Polygon({
          paths: path,
          strokeColor: color,
          strokeWeight: 2,
          strokeOpacity: 0.9,
          fillColor: color,
          fillOpacity: 0.35,
          map,
          clickable: true,
        });

        gPoly.addListener('click', () => {
          setSelectedPrevotsLinks({
            xUrl: prevotsForecastToShow.xUrl,
            instagramUrl: prevotsForecastToShow.instagramUrl,
            date: prevotsForecastToShow.date,
          });
          setShowPrevotsDialog(true);
        });

        prevotsPolygonsRef.current.push(gPoly);
      });
    return () => {
      prevotsPolygonsRef.current.forEach((p) => p.setMap(null));
      prevotsPolygonsRef.current = [];
    };
  }, [mapReady, prevotsOverlayVisible, prevotsForecastToShow]);

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
    const configSlug = dr.type === 'cptec' ? dr.station.slug : `argentina:${dr.station.id}`;
    const cfg = radarConfigs.find((c) => c.stationSlug === configSlug);
    if (cfg && (cfg.lat !== 0 || cfg.lng !== 0)) return { lat: cfg.lat, lng: cfg.lng };
    return { lat: dr.station.lat, lng: dr.station.lng };
  }, [radarConfigs]);

  /** Cria ou recria marcadores de radar (não depende de failedRadars para evitar piscar) */
  useEffect(() => {
    radarMarkersRef.current.forEach((m) => m.setMap(null));
    radarMarkersRef.current = [];
    radarKeyToMarkerRef.current.clear();
    if (!mapInstanceRef.current || !mapReady || editingRadar) return;
    const map = mapInstanceRef.current;
    const g = (window as any).google;
    if (!g?.maps) return;

    const displayKeys = new Set(displayRadars.map((r) => r.type === 'cptec' ? `cptec:${r.station.slug}` : `argentina:${r.station.id}`));
    allRadars.forEach((dr) => {
      const radarKey = dr.type === 'cptec' ? `cptec:${dr.station.slug}` : `argentina:${dr.station.id}`;
      const isDisplayed = displayKeys.has(radarKey);
      const hasData = isDisplayed && !failedRadars.has(radarKey);
      const pos = getRadarCenter(dr);
      const marker = new g.maps.Marker({
        position: pos,
        map,
        icon: {
          url: hasData ? RADAR_ICON_AVAILABLE : RADAR_ICON_UNAVAILABLE,
          scaledSize: new g.maps.Size(28, 28),
          anchor: new g.maps.Point(14, 14),
        },
        title: dr.station.name,
        zIndex: focusedRadarKey === radarKey ? 600 : 400,
      });
      marker.addListener('click', () => {
        const isUnfocus = focusedRadarKey === radarKey;
        if (isUnfocus) {
          setFocusedRadarKey(null);
          setRadarMode('mosaico');
          setSelectedIndividualRadars(new Set());
        } else {
          setFocusedRadarKey(radarKey);
          setRadarMode('unico');
          setSelectedIndividualRadars(new Set([radarKey]));
        }
      });
      radarMarkersRef.current.push(marker);
      radarKeyToMarkerRef.current.set(radarKey, { marker, isDisplayed });
    });

    return () => {
      radarMarkersRef.current.forEach((m) => m.setMap(null));
      radarMarkersRef.current = [];
      radarKeyToMarkerRef.current.clear();
    };
  }, [mapReady, allRadars, displayRadars, radarConfigs, getRadarCenter, editingRadar, focusedRadarKey]);

  /** Atualiza ícones dos marcadores quando failedRadars muda (evita recriar = evita piscar) */
  useEffect(() => {
    const g = (window as any).google;
    if (!g?.maps) return;
    radarKeyToMarkerRef.current.forEach(({ marker, isDisplayed }, radarKey) => {
      const hasData = isDisplayed && !failedRadars.has(radarKey);
      marker.setIcon({
        url: hasData ? RADAR_ICON_AVAILABLE : RADAR_ICON_UNAVAILABLE,
        scaledSize: new g.maps.Size(28, 28),
        anchor: new g.maps.Point(14, 14),
      });
    });
  }, [failedRadars]);

  /** Renderiza marcadores dos relatos no mapa */
  useEffect(() => {
    stormReportMarkersRef.current.forEach((m) => m.setMap(null));
    stormReportMarkersRef.current = [];
    if (!mapInstanceRef.current || !mapReady || !showReportsOnMap || stormReports.length === 0) return;
    const map = mapInstanceRef.current;
    const g = (window as any).google;
    if (!g?.maps) return;

    const SYMBOLS: Record<string, any> = {
      tor: { path: 'M 0 0 L 6 -12 L -6 -12 Z', fillColor: '#ef4444', fillOpacity: 1, strokeColor: 'white', strokeWeight: 1.5, scale: 2 },
      gra: { path: g.maps.SymbolPath.CIRCLE, fillColor: '#22c55e', fillOpacity: 1, strokeColor: 'white', strokeWeight: 1.5, scale: 5 },
      ven: { path: 'M -4,-4 4,-4 4,4 -4,4 z', fillColor: '#3b82f6', fillOpacity: 1, strokeColor: 'white', strokeWeight: 1.5, scale: 1 },
    };

    const buildReportContent = (rep: StormReport, viewCount: number) => {
      const typeLabel = rep.type === 'tor' ? 'Tornado' : rep.type === 'gra' ? 'Granizo' : 'Vento';
      let html = `<div style="font-family:sans-serif;max-width:240px;color:#e2e8f0;">
        <p style="margin:0 0 4px;font-weight:700;font-size:13px;">${typeLabel}</p>`;
      if (rep.detail) html += `<p style="margin:0 0 4px;font-size:12px;">${rep.type === 'ven' ? 'Velocidade' : 'Tamanho'}: ${rep.detail}</p>`;
      html += `<p style="margin:0 0 4px;font-size:11px;color:#94a3b8;">por ${rep.displayName}</p>`;
      html += `<p style="margin:0 0 6px;font-size:10px;color:#64748b;">👁 ${viewCount} ${viewCount === 1 ? 'visualização' : 'visualizações'}</p>`;
      if (rep.mediaUrl && rep.mediaType === 'link') {
        html += `<a href="${rep.mediaUrl}" target="_blank" rel="noopener" style="color:#22d3ee;font-size:12px;word-break:break-all;">Link do relato</a>`;
      } else if (rep.mediaUrl && rep.mediaType === 'file') {
        if (rep.mediaUrl.match(/\.(mp4|webm|mov)/i)) {
          html += `<video src="${rep.mediaUrl}" controls style="max-width:100%;border-radius:6px;margin-top:4px;" />`;
        } else {
          html += `<div style="min-height:60px;background:#1e293b;border-radius:6px;margin-top:4px;overflow:hidden;display:flex;align-items:center;justify-content:center;"><img src="${rep.mediaUrl}" style="max-width:100%;border-radius:6px;cursor:pointer;" onclick="window.open('${rep.mediaUrl}','_blank')" onerror="this.onerror=null;this.style.display='none'" /></div>`;
        }
      }
      html += `</div>`;
      return html;
    };

    stormReports.forEach((r) => {
      const reportId = r.id;
      if (!reportId) return;
      const icon = SYMBOLS[r.type] ?? SYMBOLS.ven;
      const marker = new g.maps.Marker({
        position: { lat: r.lat, lng: r.lng },
        map,
        icon,
        title: r.type === 'tor' ? 'Tornado' : r.type === 'gra' ? 'Granizo' : 'Vento',
        zIndex: 500,
      });

      const iw = new g.maps.InfoWindow({ content: buildReportContent(r, 0) });
      marker.addListener('click', async () => {
        stormReportInfoWindowRef.current?.close();
        iw.open(map, marker);
        stormReportInfoWindowRef.current = iw;
        const viewCount = await recordReportView(reportId);
        iw.setContent(buildReportContent(r, viewCount));
      });
      stormReportMarkersRef.current.push(marker);
    });

    return () => {
      stormReportMarkersRef.current.forEach((m) => m.setMap(null));
      stormReportMarkersRef.current = [];
    };
  }, [stormReports, mapReady, showReportsOnMap]);

  /** Cria overlays de radar para um determinado mapa e tipo de produto.
   * Em LIVE (useFallback): cada radar busca individualmente a última imagem disponível conforme seu horário (CPTEC/REDEMET/Argentina).
   */
  const addRadarOverlays = useCallback((
    map: any,
    overlaysArr: any[],
    productType: 'reflectividade' | 'velocidade',
    radars: DisplayRadar[],
    timestamp: string,
    useFallback: boolean,
    opacity: number,
  ) => {
    /** Em LIVE: usa timestamp o mais fresco possível (1 min) para cada radar buscar sua própria última imagem. */
    const nominalTs = useFallback ? getNowMinusMinutesTimestamp12UTC(1) : timestamp;
    const nominalDate = new Date(Date.UTC(
      parseInt(nominalTs.slice(0, 4), 10),
      parseInt(nominalTs.slice(4, 6), 10) - 1,
      parseInt(nominalTs.slice(6, 8), 10),
      parseInt(nominalTs.slice(8, 10), 10),
      parseInt(nominalTs.slice(10, 12), 10)
    ));
    radars.forEach((dr) => {
      const radarKey = dr.type === 'cptec' ? `cptec:${dr.station.slug}` : `argentina:${dr.station.id}`;
      let configSlug = dr.type === 'cptec' ? dr.station.slug : `argentina:${dr.station.id}`;
      if (dr.type === 'cptec' && dr.station.slug === 'santiago' && radarSourceMode === 'hd') {
        configSlug = 'santiago-redemet';
      }
      const cfg = radarConfigs.find((c) => c.id === configSlug || c.stationSlug === configSlug);
      const rotationDeg = cfg?.rotationDegrees ?? 0;
      const effectiveOpacity = cfg?.opacity ?? opacity;
      type UrlEntry = { url: string; ts12: string; source: 'cptec' | 'redemet' };
      let urlsToTry: UrlEntry[] = [];
      let redemetFindPromise: Promise<string | null> | null = null;
      let ipmetStoragePromise: Promise<string | null> | null = null;
      let storageFallbackPromise: Promise<string | null> | null = null;
      // Preparar Storage fallback para todos radares CPTEC
      if (dr.type === 'cptec' && dr.station.slug !== 'ipmet-bauru' && dr.station.slug !== 'usp-starnet' && dr.station.slug !== 'climatempo-poa') {
        const fbTs12 = useFallback ? getNowMinusMinutesTimestamp12UTC(3) : timestamp;
        storageFallbackPromise = fetch(`/api/radar-storage-fallback?radarId=${encodeURIComponent(dr.station.slug)}&ts12=${encodeURIComponent(fbTs12)}`)
          .then(r => r.ok ? r.json() : null)
          .then(d => d?.url ?? null)
          .catch(() => null);
      }

      // Santiago manual override
      if (dr.type === 'cptec' && dr.station.slug === 'santiago' && santiagoRedemetUrl) {
         urlsToTry.push({ url: santiagoRedemetUrl, ts12: nominalTs, source: 'redemet' });
      }
      if (dr.type === 'cptec' && dr.station.slug === 'ipmet-bauru') {
        if (useFallback) {
          /** Sempre a imagem mais atual: busca do servidor IPMET */
          const IPMET_URL = GET_RADAR_IPMET_URL;
          urlsToTry = [{ url: IPMET_URL + `?t=${Date.now()}`, ts12: nominalTs, source: 'cptec' }];
        } else {
          /** Imagens antigas: busca no Firebase Storage (ipmet-bauru/YYYY/MM/HHMMSS.png) */
          ipmetStoragePromise = fetch(`/api/ipmet-storage-url?ts12=${encodeURIComponent(timestamp)}`)
            .then((r) => r.ok ? r.json() : null)
            .then((d) => d?.url ?? null)
            .catch(() => null);
        }
      } else if (dr.type === 'cptec' && dr.station.slug === 'usp-starnet') {
        const USP_URL = GET_RADAR_USP_URL + `?t=${Date.now()}`;
        urlsToTry = [{ url: USP_URL, ts12: nominalTs, source: 'cptec' }];
      } else if (dr.type === 'cptec') {
        const isHdMode = radarSourceMode === 'hd';
        if (useFallback) {
          if (!isHdMode) {
            const seenTs = new Set<string>();
            for (let back = 0; back <= 60; back += 6) {
              const baseTs = back === 0 ? nominalTs : subtractMinutesFromTimestamp12UTC(nominalTs, back);
              const ts12 = getNearestRadarTimestamp(baseTs, dr.station);
              if (seenTs.has(ts12)) continue;
              seenTs.add(ts12);
              const rawUrl = buildNowcastingPngUrl(dr.station, ts12, productType);
              const [proxyUrl, directUrl] = getRadarUrlsWithFallback(rawUrl);
              urlsToTry.push({ url: proxyUrl, ts12, source: 'cptec' });
              urlsToTry.push({ url: directUrl, ts12, source: 'cptec' });
            }
          }
          if (hasRedemetFallback(dr.station.slug)) {
            const area = getRedemetArea(dr.station.slug)!;
            const ts12ForRedemet = getNearestRadarTimestamp(nominalTs, dr.station);
            redemetFindPromise = fetch(`/api/radar-redemet-find?area=${area}&ts12=${ts12ForRedemet}&historical=false`)
              .then(r => r.ok ? r.json() : null)
              .then(d => {
                const u = d?.url ?? null;
                if (u) {
                  setRedemetAvailableKeys(prev => new Set(prev).add(radarKey));
                  setRedemetFoundUrls(prev => ({ ...prev, [radarKey]: u }));
                }
                return u;
              })
              .catch(() => null);
          }
        } else {
          if (!isHdMode) {
            const seenTs = new Set<string>();
            for (let back = 0; back <= 60; back += 6) {
              const baseTs = back === 0 ? timestamp : subtractMinutesFromTimestamp12UTC(timestamp, back);
              const ts12 = getNearestRadarTimestamp(baseTs, dr.station);
              if (seenTs.has(ts12)) continue;
              seenTs.add(ts12);
              const rawUrl = buildNowcastingPngUrl(dr.station, ts12, productType);
              const [proxyUrl, directUrl] = getRadarUrlsWithFallback(rawUrl);
              urlsToTry.push({ url: proxyUrl, ts12, source: 'cptec' });
              urlsToTry.push({ url: directUrl, ts12, source: 'cptec' });
            }
          }
          if (hasRedemetFallback(dr.station.slug)) {
            const area = getRedemetArea(dr.station.slug)!;
            const ts12ForRedemet = getNearestRadarTimestamp(timestamp, dr.station);
            redemetFindPromise = fetch(`/api/radar-redemet-find?area=${area}&ts12=${ts12ForRedemet}&historical=true`)
              .then(r => r.ok ? r.json() : null)
              .then(d => {
                const u = d?.url ?? null;
                if (u) {
                  setRedemetAvailableKeys(prev => new Set(prev).add(radarKey));
                  setRedemetFoundUrls(prev => ({ ...prev, [radarKey]: u }));
                }
                return u;
              })
              .catch(() => null);
          }
        }
      } else {
        const interval = dr.station.updateIntervalMinutes ?? 10;
        const seenTs = new Set<string>();
        if (useFallback) {
          for (let back = 0; back <= 60; back += interval) {
            const d = new Date(Date.now() - back * 60 * 1000);
            const tsArg = getArgentinaRadarTimestamp(d, dr.station);
            if (seenTs.has(tsArg)) continue;
            seenTs.add(tsArg);
            const rawUrl = buildArgentinaRadarPngUrl(dr.station, tsArg, productType);
            const [proxyUrl, directUrl] = getRadarUrlsWithFallback(rawUrl);
            urlsToTry.push({ url: proxyUrl, ts12: tsArg, source: 'cptec' });
            urlsToTry.push({ url: directUrl, ts12: tsArg, source: 'cptec' });
          }
        } else {
          /** Histórico Argentina: tenta horários próximos (intervalo do radar) */
          for (let back = 0; back <= 60; back += interval) {
            const d = new Date(nominalDate.getTime() - back * 60 * 1000);
            const tsArg = getArgentinaRadarTimestamp(d, dr.station);
            if (seenTs.has(tsArg)) continue;
            seenTs.add(tsArg);
            const rawUrl = buildArgentinaRadarPngUrl(dr.station, tsArg, productType);
            const [proxyUrl, directUrl] = getRadarUrlsWithFallback(rawUrl);
            urlsToTry.push({ url: proxyUrl, ts12: tsArg, source: 'cptec' });
            urlsToTry.push({ url: directUrl, ts12: tsArg, source: 'cptec' });
          }
        }
      }
      let bounds = cfg?.customBounds 
        ? { north: cfg.customBounds.north, south: cfg.customBounds.south, east: cfg.customBounds.east, west: cfg.customBounds.west } 
        : getBoundsForDisplayRadar(dr);

      // Removido fallback hardcoded de santiago hd pois agora usa config santiago-redemet
      const latLngBounds = new google.maps.LatLngBounds(
        { lat: bounds.south, lng: bounds.west },
        { lat: bounds.north, lng: bounds.east }
      );
      const ov = new google.maps.OverlayView();
      let divEl: HTMLDivElement | null = null;
      ov.onAdd = () => {
        divEl = document.createElement('div');
        divEl.style.cssText = 'position:absolute;pointer-events:none;overflow:hidden;display:none;';
        const img = document.createElement('img');
        img.className = 'pixelated-layer';
        const isUsp = dr.type === 'cptec' && dr.station.slug === 'usp-starnet';
        img.style.cssText = `width:100%;height:100%;opacity:${effectiveOpacity};object-fit:fill;transform-origin:center center;${isUsp ? 'mix-blend-mode:multiply;' : ''}`;
        if (rotationDeg !== 0) img.style.transform = `rotate(${rotationDeg}deg)`;
        let noiseFiltered = false;
        /** Evita flicker: mostra o overlay apenas após carregar e processar filtros */
        let isFullyProcessed = false;
        const markProcessed = () => {
          if (isFullyProcessed) return;
          isFullyProcessed = true;
          if (divEl) divEl.style.display = '';
        };

        const applyNoiseFilter = () => {
          if (noiseFiltered) return;
          noiseFiltered = true;
          const currentSrc = img.src;
          const isClimatempo = dr.type === 'cptec' && dr.station.slug === 'climatempo-poa';

          // Se o filtro de refletividade está desativado E é reflectividade, pula o filtro
          if (productType === 'reflectividade' && !reflectivityFilterEnabled) {
            markProcessed();
            return;
          }

          // Super Res: pipeline especial para Doppler (velocidade)
          if (productType === 'velocidade' && (cfg?.superRes || superResEnabled) && dr.type === 'cptec') {
            // Busca a URL de reflectividade (ppicz) do mesmo radar/timestamp para usar como máscara
            const loadedEntry = urlsToTry[tryIndex - 1];
            const refTs12 = loadedEntry?.ts12 ?? nominalTs;
            const refUrl = buildNowcastingPngUrl(dr.station as CptecRadarStation, refTs12, 'reflectividade');
            const [refProxy] = getRadarUrlsWithFallback(refUrl);
            
            filterDopplerSuperRes(currentSrc, refProxy).then((filteredSrc) => {
              if (filteredSrc && img.src === currentSrc) {
                img.onload = null;
                img.onerror = null;
                img.src = filteredSrc;
              }
              markProcessed();
            }).catch(() => { markProcessed(); });
            return;
          }

          const filterAction = isClimatempo 
            ? filterClimatempoRadarImage(currentSrc, cfg?.chromaKeyDeltaThreshold, cfg?.cropConfig) 
            : filterRadarImageFromUrl(currentSrc, cfg?.chromaKeyDeltaThreshold, cfg?.cropConfig);

          filterAction.then((filteredSrc) => {
            if (filteredSrc && img.src === currentSrc) {
              img.onload = null;
              img.onerror = null;
              img.src = filteredSrc;
            }
            markProcessed();
          }).catch(() => { markProcessed(); });
        };
        let tryIndex = 0;
        let redemetAttempted = false;
        const markFailed = () => {
          setFailedRadars((prev) => new Set(prev).add(radarKey));
          setRadarEffectiveSource((prev) => {
            const next = { ...prev };
            delete next[radarKey];
            return next;
          });
          if (divEl) divEl.style.display = 'none';
        };
        const showOverlay = () => { if (divEl) divEl.style.display = ''; };
        const onRedemetLoad = (ts12Val: string) => {
          setRadarEffectiveTimestamps((prev) => ({ ...prev, [radarKey]: ts12Val }));
          setRadarEffectiveSource((prev) => ({ ...prev, [radarKey]: 'redemet' }));
          setFailedRadars((prev) => { const next = new Set(prev); next.delete(radarKey); return next; });
          markProcessed();
        };
        let ipmetStorageAttempted = false;
        const tryNext = () => {
          if (tryIndex < urlsToTry.length) {
            img.src = urlsToTry[tryIndex].url;
            tryIndex += 1;
            return;
          }
          if (!ipmetStorageAttempted && ipmetStoragePromise) {
            ipmetStorageAttempted = true;
            ipmetStoragePromise.then((storageUrl) => {
              if (!storageUrl) { markFailed(); return; }
              img.onerror = () => markFailed();
              img.onload = () => {
                applyNoiseFilter();
                setRadarEffectiveTimestamps((prev) => ({ ...prev, [radarKey]: timestamp }));
                setRadarEffectiveSource((prev) => ({ ...prev, [radarKey]: 'cptec' }));
                setFailedRadars((prev) => { const next = new Set(prev); next.delete(radarKey); return next; });
                if (!(productType === 'velocidade' && (cfg?.superRes || superResEnabled) && dr.type === 'cptec')) {
                   markProcessed();
                }
              };
              img.src = storageUrl;
            });
            return;
          }
          if (!redemetAttempted && redemetFindPromise) {
            redemetAttempted = true;
            redemetFindPromise.then(redemetUrl => {
              if (!redemetUrl) {
                // Redemet também falhou → tentar Storage
                if (storageFallbackPromise) {
                  storageFallbackPromise.then(storageUrl => {
                    if (!storageUrl) { setNowcastingOffline(true); markFailed(); return; }
                    setNowcastingOffline(true);
                    img.onerror = () => markFailed();
                    img.onload = () => {
                      applyNoiseFilter();
                      setRadarEffectiveTimestamps((prev) => ({ ...prev, [radarKey]: timestamp }));
                      setRadarEffectiveSource((prev) => ({ ...prev, [radarKey]: 'cptec' }));
                      setFailedRadars((prev) => { const next = new Set(prev); next.delete(radarKey); return next; });
                      markProcessed();
                    };
                    img.src = storageUrl;
                  });
                } else {
                  markFailed();
                }
                return;
              }
              img.onerror = () => markFailed();
              img.onload = () => { applyNoiseFilter(); onRedemetLoad(timestamp); };
              img.src = getProxiedRadarUrl(redemetUrl);
            });
            return;
          }
          // Último recurso: Storage (sem Redemet disponível)
          if (storageFallbackPromise) {
            storageFallbackPromise.then(storageUrl => {
              if (!storageUrl) { setNowcastingOffline(true); markFailed(); return; }
              setNowcastingOffline(true);
              img.onerror = () => markFailed();
              img.onload = () => {
                applyNoiseFilter();
                setRadarEffectiveTimestamps((prev) => ({ ...prev, [radarKey]: timestamp }));
                setRadarEffectiveSource((prev) => ({ ...prev, [radarKey]: 'cptec' }));
                setFailedRadars((prev) => { const next = new Set(prev); next.delete(radarKey); return next; });
                markProcessed();
              };
              img.src = storageUrl;
            });
            return;
          }
          markFailed();
        };
        img.onerror = tryNext;
        img.onload = () => {
          const isDataUrl = img.src.startsWith('data:');
          if (isDataUrl) {
            markProcessed();
            return;
          }
          applyNoiseFilter();
          const loaded = urlsToTry[tryIndex - 1];
          const effectiveTs12 = loaded?.ts12 ?? timestamp;
          setRadarEffectiveTimestamps((prev) => ({
            ...prev,
            [radarKey]: effectiveTs12,
          }));
          if (loaded?.source) {
            setRadarEffectiveSource((prev) => ({ ...prev, [radarKey]: loaded.source }));
          }
          // Fire-and-forget: salvar imagem no Storage para cache
          let slug = dr.type === 'cptec' ? dr.station.slug : `argentina_${dr.station.id}`;
          if (loaded?.source === 'redemet') slug = `${slug}-redemet`;
          cacheRadarImage(img.src, slug, effectiveTs12, productType);
          setFailedRadars((prev) => {
            const next = new Set(prev);
            next.delete(radarKey);
            return next;
          });
          // Se não for Doppler ou Super Res não estiver ativo, aparece logo (o filtro Noise se aplica depois mas o flash é menor)
          // Mas para ser 100% flicker-free:
          if (!(productType === 'velocidade' && (cfg?.superRes || superResEnabled) && dr.type === 'cptec')) {
             markProcessed();
          }
        };
        divEl.appendChild(img);
        ov.getPanes()?.overlayLayer?.appendChild(divEl);
        tryNext();
      };
      ov.getBounds = () => latLngBounds;
      ov.draw = () => {
        if (!divEl) return;
        const proj = ov.getProjection();
        if (!proj) return;
        const sw = proj.fromLatLngToDivPixel(latLngBounds.getSouthWest());
        const ne = proj.fromLatLngToDivPixel(latLngBounds.getNorthEast());
        if (!sw || !ne) return;
        const w = Math.abs(ne.x - sw.x);
        const h = Math.abs(ne.y - sw.y);
        const left = Math.min(sw.x, ne.x);
        const top = Math.min(sw.y, ne.y);
        divEl.style.left = left + 'px';
        divEl.style.top = top + 'px';
        divEl.style.width = w + 'px';
        divEl.style.height = h + 'px';
      };
      ov.onRemove = () => { divEl?.parentNode?.removeChild(divEl); divEl = null; };
      ov.setMap(map);
      overlaysArr.push(ov);
    });
  }, [getBoundsForDisplayRadar, radarConfigs, radarSourceMode, superResEnabled, reflectivityFilterEnabled]);

  const useFallbackForOverlays = !historicalTimestampOverride && sliderMinutesAgo === 0;

  /** Overlays de radar no mapa principal. Quando editando um radar, exclui-o da lista (terá overlay editável separado) */
  useEffect(() => {
    setFailedRadars(new Set());
    setRadarEffectiveTimestamps({});
    setRadarEffectiveSource({});
    radarOverlaysRef.current.forEach((ov) => (ov as any)?.setMap?.(null));
    radarOverlaysRef.current = [];
    if (!mapInstanceRef.current || displayRadars.length === 0) return;
    const product = splitCount === 2 ? 'reflectividade' : radarProductType;
    const radarsToShow = editingRadar
      ? displayRadars.filter((dr) => dr.type !== editingRadar!.type || (dr.type === 'cptec' && editingRadar!.type === 'cptec' && dr.station.slug !== (editingRadar!.station as CptecRadarStation).slug) || (dr.type === 'argentina' && editingRadar!.type === 'argentina' && dr.station.id !== (editingRadar!.station as ArgentinaRadarStation).id))
      : displayRadars;
    if (radarsToShow.length === 0 && !editingRadar) return;
    addRadarOverlays(
      mapInstanceRef.current,
      radarOverlaysRef.current,
      product,
      radarsToShow.length > 0 ? radarsToShow : [],
      effectiveRadarTimestamp,
      useFallbackForOverlays,
      radarOpacity,
    );
    return () => {
      radarOverlaysRef.current.forEach((ov) => (ov as any)?.setMap?.(null));
      radarOverlaysRef.current = [];
    };
  }, [mapReady, displayRadars, radarProductType, radarOpacity, effectiveRadarTimestamp, useFallbackForOverlays, splitCount, addRadarOverlays, editingRadar, radarConfigs]);

  /** Overlay editável (arrastável) para posicionar o radar — apenas quando editingRadar está setado */
  useEffect(() => {
    if (editOverlayRef.current) {
      (editOverlayRef.current as any).setMap?.(null);
      editOverlayRef.current = null;
    }
    if (!mapReady || !mapInstanceRef.current || !editingRadar) return;

    const map = mapInstanceRef.current;
    const mapDiv = map.getDiv();
    const centerLat = editLiveCenter ? editLiveCenter.lat : editCenterLat;
    const centerLng = editLiveCenter ? editLiveCenter.lng : editCenterLng;
    const isIpmet = editingRadar.type === 'cptec' && editingRadar.station.slug === 'ipmet-bauru';
    const isUspStarnet = editingRadar.type === 'cptec' && editingRadar.station.slug === 'usp-starnet';
    const b = isIpmet ? { ne: IPMET_FIXED_BOUNDS.ne, sw: IPMET_FIXED_BOUNDS.sw }
      : isUspStarnet ? { ne: USP_STARNET_FIXED_BOUNDS.ne, sw: USP_STARNET_FIXED_BOUNDS.sw }
      : calculateRadarBounds(centerLat, centerLng, editRangeKm);
    const latLngBounds = new google.maps.LatLngBounds(
      { lat: b.sw.lat, lng: b.sw.lng },
      { lat: b.ne.lat, lng: b.ne.lng }
    );
    const imageUrl = getEditRadarImageUrl(editingRadar);
    const needsIpmetStorageFetch = isIpmet && editMinutesAgo > 0;

    let moveHandler: (e: MouseEvent) => void;
    let upHandler: () => void;

    const ov = new google.maps.OverlayView();
    let divEl: HTMLDivElement | null = null;
    ov.onAdd = () => {
      divEl = document.createElement('div');
      divEl.style.cssText = 'position:absolute;pointer-events:auto;cursor:grab;border:2px solid #22d3ee;user-select:none;';
      divEl.addEventListener('mousedown', (e: MouseEvent) => {
        e.preventDefault();
        const proj = ov.getProjection();
        if (!proj) return;
        const rect = mapDiv.getBoundingClientRect();
        const clickMapX = e.clientX - rect.left;
        const clickMapY = e.clientY - rect.top;
        const centerPixel = proj.fromLatLngToDivPixel(new google.maps.LatLng(centerLat, centerLng));
        if (!centerPixel) return;
        const offsetX = clickMapX - centerPixel.x;
        const offsetY = clickMapY - centerPixel.y;
        divEl!.style.cursor = 'grabbing';

        moveHandler = (e2: MouseEvent) => {
          const mx = e2.clientX - rect.left - offsetX;
          const my = e2.clientY - rect.top - offsetY;
          const pt = proj.fromDivPixelToLatLng(new google.maps.Point(mx, my));
          if (!pt || !divEl) return;
          const newLat = pt.lat();
          const newLng = pt.lng();
          lastEditDragRef.current = { lat: newLat, lng: newLng };
          setEditLiveCenter({ lat: newLat, lng: newLng });
          const editSlug = editingRadar.type === 'cptec' ? editingRadar.station.slug : null;
          const newB = editSlug === 'ipmet-bauru' ? { ne: IPMET_FIXED_BOUNDS.ne, sw: IPMET_FIXED_BOUNDS.sw }
            : editSlug === 'usp-starnet' ? { ne: USP_STARNET_FIXED_BOUNDS.ne, sw: USP_STARNET_FIXED_BOUNDS.sw }
            : calculateRadarBounds(newLat, newLng, editRangeKm);
          const newSw = proj.fromLatLngToDivPixel(new google.maps.LatLng(newB.sw.lat, newB.sw.lng));
          const newNe = proj.fromLatLngToDivPixel(new google.maps.LatLng(newB.ne.lat, newB.ne.lng));
          if (newSw && newNe) {
            divEl.style.left = Math.min(newSw.x, newNe.x) + 'px';
            divEl.style.top = Math.min(newSw.y, newNe.y) + 'px';
            divEl.style.width = Math.abs(newNe.x - newSw.x) + 'px';
            divEl.style.height = Math.abs(newNe.y - newSw.y) + 'px';
          }
        };
        upHandler = () => {
          divEl!.style.cursor = 'grab';
          document.removeEventListener('mousemove', moveHandler);
          document.removeEventListener('mouseup', upHandler);
          setEditLiveCenter(null);
          const last = lastEditDragRef.current;
          if (last) {
            setEditCenterLat(last.lat);
            setEditCenterLng(last.lng);
            handleSaveEditPosition(last.lat, last.lng);
          }
          lastEditDragRef.current = null;
        };
        document.addEventListener('mousemove', moveHandler);
        document.addEventListener('mouseup', upHandler);
      });

      const inner = document.createElement('div');
      inner.style.cssText = 'width:100%;height:100%;position:relative;min-height:60px;pointer-events:none;';
      const img = document.createElement('img');
      if (needsIpmetStorageFetch) {
        const ts = getNowMinusMinutesTimestamp12UTC(3 + editMinutesAgo);
        fetch(`/api/ipmet-storage-url?ts12=${encodeURIComponent(ts)}`)
          .then((r) => r.ok ? r.json() : null)
          .then((d) => { if (d?.url && img) img.src = d.url; })
          .catch(() => {});
      }
      img.src = needsIpmetStorageFetch ? '' : imageUrl;
      const isUspEdit = editingRadar.type === 'cptec' && editingRadar.station.slug === 'usp-starnet';
      img.style.cssText = `width:100%;height:100%;object-fit:fill;transform-origin:center center;${isUspEdit ? 'mix-blend-mode:multiply;' : ''}`;
      img.style.transform = `rotate(${editRotationDegrees}deg)`;
      inner.appendChild(img);
      const centerIcon = document.createElement('img');
      centerIcon.src = 'https://raw.githubusercontent.com/stormchasermt-netizen/main/ec772010815ceed0001897a8b99858f3993c34e0/2656046-200.png';
      centerIcon.alt = 'Posição do radar';
      centerIcon.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:28px;height:28px;pointer-events:none;';
      inner.appendChild(centerIcon);
      divEl.appendChild(inner);
      ov.getPanes()?.overlayLayer?.appendChild(divEl);
    };
    ov.getBounds = () => latLngBounds;
    ov.draw = () => {
      if (!divEl) return;
      const proj = ov.getProjection();
      if (!proj) return;
      const sw = proj.fromLatLngToDivPixel(latLngBounds.getSouthWest());
      const ne = proj.fromLatLngToDivPixel(latLngBounds.getNorthEast());
      if (!sw || !ne) return;
      divEl.style.left = Math.min(sw.x, ne.x) + 'px';
      divEl.style.top = Math.min(sw.y, ne.y) + 'px';
      divEl.style.width = Math.abs(ne.x - sw.x) + 'px';
      divEl.style.height = Math.abs(ne.y - sw.y) + 'px';
    };
    ov.onRemove = () => {
      document.removeEventListener('mousemove', moveHandler!);
      document.removeEventListener('mouseup', upHandler!);
      divEl?.parentNode?.removeChild(divEl!);
      divEl = null;
    };
    ov.setMap(map);
    editOverlayRef.current = ov;
    map.fitBounds(latLngBounds, { top: 120, right: 120, bottom: 120, left: 320 });

    return () => {
      (ov as any).setMap?.(null);
      editOverlayRef.current = null;
    };
  }, [mapReady, editingRadar, editCenterLat, editCenterLng, editRangeKm, editRotationDegrees, editLiveCenter, getEditRadarImageUrl, handleSaveEditPosition]);

  /** Overlays de radar no mapa 2 (Doppler) — apenas quando split=2 */
  useEffect(() => {
    radarOverlays2Ref.current.forEach((ov) => (ov as any)?.setMap?.(null));
    radarOverlays2Ref.current = [];
    if (splitCount !== 2 || !map2InstanceRef.current || !map2Ready || displayRadars.length === 0) return;
    const radars2 = editingRadar
      ? displayRadars.filter((dr) => dr.type !== editingRadar!.type || (dr.type === 'cptec' && editingRadar!.type === 'cptec' && dr.station.slug !== (editingRadar!.station as CptecRadarStation).slug) || (dr.type === 'argentina' && editingRadar!.type === 'argentina' && dr.station.id !== (editingRadar!.station as ArgentinaRadarStation).id))
      : displayRadars;
    addRadarOverlays(
      map2InstanceRef.current,
      radarOverlays2Ref.current,
      'velocidade',
      radars2,
      effectiveRadarTimestamp,
      useFallbackForOverlays,
      radarOpacity,
    );
    return () => {
      radarOverlays2Ref.current.forEach((ov) => (ov as any)?.setMap?.(null));
      radarOverlays2Ref.current = [];
    };
  }, [displayRadars, radarOpacity, effectiveRadarTimestamp, useFallbackForOverlays, splitCount, map2Ready, addRadarOverlays, editingRadar, radarConfigs]);

  const openReportPopup = () => setReportStep('location');

  const startPickMapLocation = useCallback(() => {
    setReportStep('pick-map');
    if (!mapInstanceRef.current) return;
    const g = (window as any).google;
    if (!g?.maps) return;
    if (mapClickListenerRef.current) g.maps.event.removeListener(mapClickListenerRef.current);
    mapClickListenerRef.current = mapInstanceRef.current.addListener('click', (e: any) => {
      const lat = e.latLng?.lat?.();
      const lng = e.latLng?.lng?.();
      if (lat != null && lng != null) {
        setReportLat(parseFloat(lat.toFixed(5)));
        setReportLng(parseFloat(lng.toFixed(5)));
        setReportStep('form');
        g.maps.event.removeListener(mapClickListenerRef.current);
        mapClickListenerRef.current = null;
      }
    });
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
    const g = (window as any).google;
    if (mapClickListenerRef.current && g?.maps) {
      g.maps.event.removeListener(mapClickListenerRef.current);
      mapClickListenerRef.current = null;
    }
  }, []);

  const refreshRadarNow = () => {
    setSliderMinutesAgo(0);
    setRadarTimestamp(getNowMinusMinutesTimestamp12UTC(3));
  };

  const goToBrazil = () => {
    mapInstanceRef.current?.panTo(BRAZIL_CENTER);
    mapInstanceRef.current?.setZoom(4);
  };

  const goToMyLocation = () => {
    if (myLocation) {
      mapInstanceRef.current?.panTo(myLocation);
      mapInstanceRef.current?.setZoom(10);
    }
  };


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
              <span className="hidden sm:inline">Última imagem: </span>{headerTitle.time ? `${headerTitle.time} (local)` : 'Carregando…'}
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
                    {groupRadarsByLocation(allRadars).map(({ country, state, radars }) => (
                      <div key={`${country}-${state}`} className="mb-3 last:mb-0">
                        <p className="text-[10px] font-semibold text-cyan-400/90 mb-1.5 px-1">{country} – {state}</p>
                        <div className="space-y-1">
                          {radars.map((r) => {
                            const id = r.type === 'cptec' ? `cptec:${r.station.slug}` : `argentina:${r.station.id}`;
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
                                      if (e.target.checked) next.add(id);
                                      else next.delete(id);
                                      return next;
                                    });
                                  }}
                                  className="hidden"
                                />
                                <span className="text-sm text-slate-300 truncate">{r.station.name}</span>
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
                              const d = new Date(y, m - 1, 1);
                              d.setMonth(d.getMonth() - 1);
                              setHistoricalDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
                            }}
                            className="p-1 rounded text-slate-400 hover:text-cyan-400 hover:bg-cyan-500/20 transition-colors"
                          >
                            <ChevronLeft className="w-4 h-4" />
                          </button>
                          <span className="text-[11px] font-bold text-cyan-300 uppercase tracking-wider capitalize">
                            {new Date(historicalDate + 'T12:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              const [y, m] = historicalDate.split('-').map(Number);
                              const nextFirst = new Date(y, m, 1);
                              const today = new Date();
                              today.setHours(23, 59, 59, 999);
                              if (nextFirst > today) return;
                              setHistoricalDate(`${nextFirst.getFullYear()}-${String(nextFirst.getMonth() + 1).padStart(2, '0')}-01`);
                            }}
                            className="p-1 rounded text-slate-400 hover:text-cyan-400 hover:bg-cyan-500/20 transition-colors disabled:opacity-40 disabled:pointer-events-none"
                            disabled={(() => {
                              const [y, m] = historicalDate.split('-').map(Number);
                              const nextFirst = new Date(y, m, 1);
                              return nextFirst > new Date();
                            })()}
                          >
                            <ChevronRight className="w-4 h-4" />
                          </button>
                        </div>
                        <div className="p-1.5">
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
                      const isEditing = editingRadar && dr && (editingRadar.type !== dr.type ? false : editingRadar.type === 'cptec' ? (editingRadar.station as CptecRadarStation).slug === (dr.station as CptecRadarStation).slug : (editingRadar.station as ArgentinaRadarStation).id === (dr.station as ArgentinaRadarStation).id);
                      return (
                        <div key={name} className="text-xs flex flex-col gap-1 bg-black/20 px-2 py-1.5 rounded border border-white/5">
                          <div className="flex justify-between items-center">
                            <span className="text-slate-300 truncate mr-2">{name}</span>
                            <span className={`font-bold tracking-wider flex-shrink-0 ${hhmm === 'sem imagem' ? 'text-amber-400/90' : 'text-cyan-400'}`}>
                              {hhmm}{source === 'redemet' ? ' (REDEMET)' : ''}
                            </span>
                          </div>
                          {dr && (
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
        <div ref={mapContainerRef} className={`flex-1 min-h-0 min-w-0 relative flex ${splitCount === 2 && isDesktop ? 'flex-row' : 'flex-col'}`}>
          {/* Mapa principal (ou metade no split) */}
          <div className={`relative ${splitCount === 2 ? (isDesktop ? 'w-1/2 h-full' : 'h-1/2') : 'flex-1'}`}>
            <div ref={mapRef} className="absolute inset-0 w-full h-full" />
            {splitCount === 2 && (
              <div className={`absolute z-10 bg-slate-900/80 px-3 py-1 pointer-events-none ${isDesktop ? 'top-0 left-0 right-0' : 'bottom-0 left-0 right-0'}`}>
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

          {/* Mapa secundário (Doppler) — somente no split */}
          {splitCount === 2 && (
            <>
              <div className={`${isDesktop ? 'w-px h-full' : 'h-px w-full'} bg-cyan-500/80 shadow-[0_0_8px_rgba(6,182,212,0.8)] flex-shrink-0 z-10`} />
              <div className={`relative ${isDesktop ? 'w-1/2 h-full' : 'h-1/2'}`}>
                <div ref={map2Ref} className="absolute inset-0 w-full h-full" />
                <div className={`absolute z-10 bg-slate-900/80 px-3 py-1 pointer-events-none ${isDesktop ? 'top-0 left-0 right-0' : 'bottom-0 left-0 right-0'}`}>
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
                <div className="absolute z-20 pointer-events-none" style={{ top: '28px', left: '8px' }}>
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
              </div>
            </>
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
            {redemetAvailableKeys.size > 0 && (
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
                  title="REDEMET HD (maior cobertura)"
                >
                  HD
                </button>
              </div>
            )}
            {focusedRadarKey === 'cptec:santiago' && failedRadars.has('cptec:santiago') && !santiagoRedemetUrl && (
              <button
                onClick={fetchSantiagoRedemet}
                disabled={santiagoRedemetLoading}
                className="mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/90 border border-amber-400/50 text-slate-900 font-bold text-[10px] uppercase tracking-wider backdrop-blur-md shadow-lg transition-all hover:scale-105 active:scale-95 disabled:opacity-50"
              >
                {santiagoRedemetLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Radar className="w-3.5 h-3.5" />}
                {t('live_show_redemet')} (Santiago)
              </button>
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
                        min={50}
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
                        {opt.previewType === 'static' && opt.staticMapType && getStaticMapPreviewUrl(opt.staticMapType) ? (
                          <img src={getStaticMapPreviewUrl(opt.staticMapType)} alt="" className="w-full h-full object-cover opacity-80" />
                        ) : (
                          <div className="w-full h-full opacity-50" style={{ backgroundColor: opt.placeholderBg }} />
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
                      ? (maxSliderMinutesAgo >= 1440 ? '-24h' : '00:00')
                      : sliderMinutesAgo >= 60 ? `-${Math.floor(sliderMinutesAgo / 60)}h` : `-${sliderMinutesAgo}m`}
                </span>
                <div className="flex-1 flex flex-col gap-0 relative">
                  <div className="absolute left-0 right-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-slate-800 overflow-hidden pointer-events-none">
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
                    title={sliderMinutesAgo === 0 ? 'Ao vivo' : sliderMinutesAgo >= maxSliderMinutesAgo ? (maxSliderMinutesAgo >= 1440 ? '24h atrás' : 'Meia-noite') : `${sliderMinutesAgo} min atrás`}
                  />
                  )}
                  <div className="text-center leading-none mt-1">
                    <span className="text-[10px] sm:text-sm font-black tracking-widest text-cyan-300 drop-shadow-[0_0_10px_rgba(6,182,212,0.9)]">
                      {(() => {
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
            <div className="flex justify-center items-center gap-4 py-1">
              <button
                onClick={() => { setIsPlaying(false); handleSkipBack(); }}
                title="Voltar 1 imagem"
                className="p-2 sm:p-2.5 bg-[#0A0E17]/80 backdrop-blur-md rounded-full border border-cyan-500/30 text-cyan-400 hover:text-white hover:bg-cyan-500/40 hover:border-cyan-400/80 transition-all hover:scale-110 shadow-lg"
              >
                <SkipBack className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>
              <button
                onClick={() => setIsPlaying(!isPlaying)}
                title={isPlaying ? "Pausar" : "Iniciar animação"}
                className={`p-3 sm:p-4 rounded-full border-2 transition-all hover:scale-110 shadow-[0_0_15px_rgba(6,182,212,0.3)] backdrop-blur-md ${
                  isPlaying 
                    ? 'bg-amber-500/90 border-amber-400/80 text-black hover:bg-amber-400' 
                    : 'bg-cyan-600 border-cyan-400 text-white hover:bg-cyan-500'
                }`}
              >
                {isPlaying ? <Pause className="w-5 h-5 sm:w-6 sm:h-6 fill-current" /> : <Play className="w-5 h-5 sm:w-6 sm:h-6 fill-current ml-1" />}
              </button>
              <button
                onClick={() => { setIsPlaying(false); handleSkipForward(); }}
                title="Avançar 1 imagem"
                className="p-2 sm:p-2.5 bg-[#0A0E17]/80 backdrop-blur-md rounded-full border border-cyan-500/30 text-cyan-400 hover:text-white hover:bg-cyan-500/40 hover:border-cyan-400/80 transition-all hover:scale-110 shadow-lg"
              >
                <SkipForward className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>
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
                  participantIdentity: user?.uid,
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
                      if (n === 4) {
                        addToast('Visualização com 4 imagens em breve!', 'info');
                        setShowSplitMenu(false);
                      } else {
                        setSplitCount(n);
                        setShowSplitMenu(false);
                      }
                    }}
                    className={`w-full px-4 py-2.5 text-left text-xs font-bold tracking-wider uppercase transition-colors ${splitCount === n ? 'bg-cyan-500/20 text-cyan-300' : 'text-slate-300 hover:bg-white/5 hover:text-white'}`}
                  >
                    {n} radar{n > 1 ? 's' : ''} {n === 2 ? '(Reflet. | Doppler)' : ''}
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
