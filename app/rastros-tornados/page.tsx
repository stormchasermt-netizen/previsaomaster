'use client';

import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight, ChevronUp, Wind, Layers, Check, ExternalLink, X, ZoomIn, Search, Ruler, Calendar, Home, Filter, Info, MapPin, Flame, Loader2, Users, Bell, Play, Pause, Share2, ChevronDown, Radar, Target, Menu, Settings, RotateCcw, Save, Trash2, RefreshCw, Eye, DollarSign } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { BeforeAfterCompare } from '@/components/BeforeAfterCompare';
import { updatePresence, removePresence, subscribeToPresence, type PresenceData } from '@/lib/presence';
import MeteorologistCommentsPanel from './components/MeteorologistCommentsPanel';
import MeteorologistMapPinModal from './components/MeteorologistMapPinModal';
import RecentCommentPreview from './components/RecentCommentPreview';
import { db } from '@/lib/firebase';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { MAP_STYLE_DARK, LOCATION_REQUEST_EXCLUDED_UIDS } from '../../lib/constants';
import {
  TORNADO_TRACKS_DEMO,
  TORNADO_TRACK_COLORS,
  F_SCALE_ORDER,
  PREVOTS_LEVEL_COLORS,
  getTracksYears,
  getTracksIntensities,
  getMaxIntensity,
  meetsMinIntensity,
  getMonthFromDate,
  getSeasonFromDate,
  getTrackHeatmapPoints,
  inferCountryFromTrack,
  type TornadoTrack,
  SecondaryImage,
  type FScale,
  type Season,
} from '../../lib/tornadoTracksData';
import { fetchTornadoTracks, saveTornadoTrack, incrementTrackViews } from '../../lib/tornadoTracksStore';
import { fetchPrevotsForecastByDate } from '@/lib/prevotsForecastStore';
import type { PrevotsForecast } from '@/lib/prevotsForecastData';
import {
  CPTEC_RADAR_STATIONS,
  getTrackCentroid,
  findNearestRadar,
  findRadarsWithinRadius,
  getRadarImageBounds,
  buildSigmaWmsUrl,
  buildNowcastingPngUrl,
  getChapecoFallbackConfigs,
  generateRadarTimestampsForDateRange,
  generateUnifiedTimelineTimestamps,
  getNearestRadarTimestamp,
  calculateRadarBounds,
  calculateRadarBoundsGeodesic,
  type CptecRadarStation,
} from '../../lib/cptecRadarStations';
import {
  ARGENTINA_RADAR_STATIONS,
  findArgentinaRadarsWithinRadius,
  getArgentinaRadarBounds,
  buildArgentinaRadarPngUrl,
  getArgentinaRadarTimestamp,
  type ArgentinaRadarStation,
} from '../../lib/argentinaRadarStations';
import { fetchRadarConfigs, buildRadarPngUrl, type RadarConfig } from '../../lib/radarConfigStore';
import { hasRedemetFallback, getRedemetArea } from '../../lib/redemetRadar';
import { filterDopplerSuperRes, filterRadarImageFromUrl } from '../../lib/radarImageFilter';
import { cacheRadarImage, getRadarBackupUrl } from '../../lib/radarCacheClient';
import {
  fetchRastrosProfile,
  saveRastrosProfile,
  getRastrosUserTypeLabel,
  type RastrosUserProfile,
  type RastrosUserType,
} from '../../lib/rastrosProfileStore';
import { recordVisit, subscribeToTodayVisitCount } from '@/lib/visitCounter';

declare const google: any;

const RASTROS_USER_TYPES: { value: RastrosUserType; label: string }[] = [
  { value: 'meteorologista', label: 'Meteorologista' },
  { value: 'storm_chaser', label: 'Storm Chaser' },
  { value: 'observador', label: 'Observador' },
  { value: 'civil', label: 'Civil' },
];

const BRAZIL_CENTER = { lat: -14.235, lng: -51.925 };

/** Retorna [proxyUrl, directUrl] — fallback direto quando proxy retorna Backend Not Found (Firebase). */
export function getRadarUrlsWithFallback(url: string): [string, string] {
  if (typeof window === 'undefined') return [url, url];
  if (url.startsWith('/api/')) {
     // Se já é uma URL de API (proxy interno), não temos uma "directUrl" fácil sem reconstruir.
     // Mas podemos retornar a própria URL e uma tentativa de reconstrução se for Chapecó.
     return [url, url]; 
  }
  return [`/api/radar-proxy?url=${encodeURIComponent(url)}`, url];
}

/** Contorna CORS: imagens PNG do CPTEC não carregam em <img> cross-origin sem proxy. */
function getProxiedRadarUrl(url: string): string {
  if (typeof window === 'undefined') return url;
  // Se for uma URL relativa (começa com /), não precisa de proxy (CORS não se aplica)
  if (url.startsWith('/')) return url;
  return `/api/radar-proxy?url=${encodeURIComponent(url)}`;
}

/** Verifica se uma imagem de radar existe (probe para fallback automático). */
async function probeRadarImageExists(proxiedUrl: string): Promise<boolean> {
  try {
    const res = await fetch(proxiedUrl, { method: 'HEAD', cache: 'no-store' });
    if (res.ok) return true;
    if (res.status === 405) {
      const res2 = await fetch(proxiedUrl, { method: 'GET', cache: 'no-store' });
      return res2.ok;
    }
    return false;
  } catch {
    return false;
  }
}

/** Desfoque suave 5x5 no buffer de intensidade para eliminar bordas quadradas */
function blurIntensityBuffer(
  src: Float32Array,
  w: number,
  h: number,
  radius: number = 2
): Float32Array {
  const out = new Float32Array(src.length);
  const r = radius;
  const size = 2 * r + 1;
  const sigma = size / 3;
  const kernel: number[] = [];
  let sum = 0;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const g = Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
      kernel.push(g);
      sum += g;
    }
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0;
      let ki = 0;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const nx = Math.max(0, Math.min(w - 1, x + dx));
          const ny = Math.max(0, Math.min(h - 1, y + dy));
          v += src[ny * w + nx] * kernel[ki++];
        }
      }
      out[y * w + x] = v;
    }
  }
  return out;
}

/** Heatmap com gradiente suave (amarelo → laranja → vermelho), sem círculos discretos */
function createSmoothHeatmapOverlay(
  map: any,
  points: { lat: number; lng: number }[]
): { overlay: any; setPoints: (p: { lat: number; lng: number }[]) => void; remove: () => void } {
  const BUF_MAX = 800;
  const RADIUS_PX = 60;

  let pointsRef = points;

  class HeatmapOverlay extends google.maps.OverlayView {
    div: HTMLDivElement | null = null;
    canvas: HTMLCanvasElement | null = null;
    offscreen: HTMLCanvasElement | null = null;

    onAdd() {
      this.div = document.createElement('div');
      this.div.style.position = 'absolute';
      this.div.style.pointerEvents = 'none';
      this.div.style.left = '0';
      this.div.style.top = '0';
      this.getPanes()?.overlayLayer.appendChild(this.div);
      this.canvas = document.createElement('canvas');
      this.canvas.className = 'pixelated-layer';
      this.div.appendChild(this.canvas);
      this.offscreen = document.createElement('canvas');
    }

    draw() {
      const projection = this.getProjection();
      if (!this.div || !this.canvas || !this.offscreen || !projection) {
        return;
      }
      const mapInstance = this.getMap();
      if (!mapInstance?.getBounds) return;
      const bounds = mapInstance.getBounds();
      if (!bounds) return;

      const ne = projection.fromLatLngToDivPixel(bounds.getNorthEast());
      const sw = projection.fromLatLngToDivPixel(bounds.getSouthWest());
      const w = Math.round(Math.abs(ne.x - sw.x));
      const h = Math.round(Math.abs(sw.y - ne.y));
      if (w <= 0 || h <= 0) return;

      this.div.style.left = Math.min(ne.x, sw.x) + 'px';
      this.div.style.top = Math.min(ne.y, sw.y) + 'px';
      this.div.style.width = w + 'px';
      this.div.style.height = h + 'px';
      this.canvas.width = w;
      this.canvas.height = h;

      const bufW = Math.min(BUF_MAX, w);
      const bufH = Math.min(BUF_MAX, h);
      const scaleX = bufW / w;
      const scaleY = bufH / h;
      const offsetX = Math.min(ne.x, sw.x);
      const offsetY = Math.min(ne.y, sw.y);

      const intensity = new Float32Array(bufW * bufH);
      const radiusBuf = Math.max(3, Math.min(RADIUS_PX, Math.floor(Math.min(bufW, bufH) * 0.12)));
      const sigmaBuf = radiusBuf / 2;

      pointsRef.forEach((pt) => {
        const latLng = new google.maps.LatLng(pt.lat, pt.lng);
        const pixel = projection.fromLatLngToDivPixel(latLng);
        const px = pixel.x - offsetX;
        const py = pixel.y - offsetY;
        const bx = Math.round(px * scaleX);
        const by = Math.round(py * scaleY);
        for (let dy = -radiusBuf; dy <= radiusBuf; dy++) {
          for (let dx = -radiusBuf; dx <= radiusBuf; dx++) {
            const nx = bx + dx;
            const ny = by + dy;
            if (nx < 0 || nx >= bufW || ny < 0 || ny >= bufH) continue;
            const distSq = dx * dx + dy * dy;
            const g = Math.exp(-distSq / (2 * sigmaBuf * sigmaBuf));
            intensity[ny * bufW + nx] += g;
          }
        }
      });

      let maxV = 0;
      for (let idx = 0; idx < intensity.length; idx++) if (intensity[idx] > maxV) maxV = intensity[idx];
      if (maxV > 0) {
        for (let idx = 0; idx < intensity.length; idx++) intensity[idx] /= maxV;
      }

      const intensitySmoothed = blurIntensityBuffer(intensity, bufW, bufH, 2);
      maxV = 0;
      for (let idx = 0; idx < intensitySmoothed.length; idx++) if (intensitySmoothed[idx] > maxV) maxV = intensitySmoothed[idx];
      if (maxV > 0) {
        for (let idx = 0; idx < intensitySmoothed.length; idx++) intensitySmoothed[idx] /= maxV;
      }

      this.offscreen.width = bufW;
      this.offscreen.height = bufH;
      const ctxOff = this.offscreen.getContext('2d');
      const ctx = this.canvas.getContext('2d');
      if (!ctxOff || !ctx) return;
      const imgData = ctxOff.createImageData(bufW, bufH);
      const data = imgData.data;
      for (let y = 0; y < bufH; y++) {
        for (let x = 0; x < bufW; x++) {
          const t = intensitySmoothed[y * bufW + x];
          const idx = (y * bufW + x) * 4;
          if (t <= 0) {
            data[idx] = 0;
            data[idx + 1] = 0;
            data[idx + 2] = 0;
            data[idx + 3] = 0;
          } else {
            // Transparência → cores: alpha sobe bem suave para gradiente sem bordas duras
            const alpha = Math.pow(t, 0.5) * 235;
            const tNorm = t;
            let r: number, g: number, b: number;
            if (tNorm < 0.2) {
              const k = tNorm / 0.2;
              r = 254; g = 248; b = 160;
            } else if (tNorm < 0.45) {
              const k = (tNorm - 0.2) / 0.25;
              r = 253; g = 186 - k * 70; b = 116 - k * 50;
            } else if (tNorm < 0.75) {
              const k = (tNorm - 0.45) / 0.3;
              r = 249; g = 115 + k * 15; b = 22;
            } else {
              const k = (tNorm - 0.75) / 0.25;
              r = 220 + k * 35; g = 38; b = 38;
            }
            data[idx] = Math.round(r);
            data[idx + 1] = Math.round(g);
            data[idx + 2] = Math.round(b);
            data[idx + 3] = Math.round(alpha);
          }
        }
      }
      ctxOff.putImageData(imgData, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.globalAlpha = 0.9;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(this.offscreen, 0, 0, bufW, bufH, 0, 0, w, h);
      ctx.globalAlpha = 1;
    }

    onRemove() {
      if (this.div?.parentNode) this.div.parentNode.removeChild(this.div);
    }
  }

  const overlay = new HeatmapOverlay();
  overlay.setMap(map);
  const listener = map.addListener('idle', () => overlay.draw());
  return {
    overlay,
    setPoints(p: { lat: number; lng: number }[]) {
      pointsRef = p;
      overlay.draw();
    },
    remove() {
      google.maps.event.removeListener(listener);
      overlay.setMap(null);
    },
  };
}
const DEFAULT_ZOOM = 4;

type BaseMapId = 'satellite' | 'hybrid' | 'roadmap' | 'terrain' | 'dark' | 'light';

const BASE_MAP_OPTIONS: {
  id: BaseMapId;
  label: string;
  previewType: 'static' | 'placeholder';
  staticMapType?: 'satellite' | 'hybrid' | 'roadmap' | 'terrain';
  placeholderBg?: string;
}[] = [
  { id: 'satellite', label: 'Satélite', previewType: 'static', staticMapType: 'satellite' },
  { id: 'hybrid', label: 'Satélite com rótulos', previewType: 'static', staticMapType: 'hybrid' },
  { id: 'roadmap', label: 'Padrão (ruas)', previewType: 'static', staticMapType: 'roadmap' },
  { id: 'terrain', label: 'Terreno', previewType: 'static', staticMapType: 'terrain' },
  { id: 'dark', label: 'Escuro', previewType: 'placeholder', placeholderBg: '#1e293b' },
  { id: 'light', label: 'Claro', previewType: 'placeholder', placeholderBg: '#e2e8f0' },
];

function getStaticMapPreviewUrl(maptype: string): string {
  const key = typeof process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY === 'string'
    ? process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
    : '';
  if (!key || key.startsWith('COLE_SUA')) return '';
  return `https://maps.googleapis.com/maps/api/staticmap?center=-14,-52&zoom=4&size=180x120&maptype=${maptype}&key=${key}`;
}

export default function RastrosTornadosPage() {
  const { t } = useTranslation();
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => setIsMounted(true), []);
  const router = useRouter();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const polygonsRef = useRef<any[]>([]);
  const polygonGlowRef = useRef<any[]>([]);
  const prevotsPolygonsRef = useRef<any[]>([]);
  const polygonFillOpacitiesRef = useRef<number[]>([]);
  const trackPopupRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<any>(null);
  const measurePolylineRef = useRef<any>(null);
  const measureListenersRef = useRef<any[]>([]);
  const popupDragOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const popupDraggingRef = useRef(false);

  const [mapReady, setMapReady] = useState(false);
  const [tracks, setTracks] = useState<TornadoTrack[]>([]);
  const [tracksLoading, setTracksLoading] = useState(true);
  const [yearFilter, setYearFilter] = useState<string>('');
  const [intensityFilter, setIntensityFilter] = useState<string>('');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  /** Intervalo por calendário (Selecionar intervalo): 1º clique = início, 2º = fim */
  const [intervalStartDate, setIntervalStartDate] = useState<string | null>(null);
  const [intervalEndDate, setIntervalEndDate] = useState<string | null>(null);
  const [showIntervalCalendar, setShowIntervalCalendar] = useState(false);
  const [calendarSelectPhase, setCalendarSelectPhase] = useState<'start' | 'end'>('start');
  /** Modo radar na timeline: mosaico (todos) ou único (dropdown) */
  const [radarTimelineMode, setRadarTimelineMode] = useState<'mosaico' | 'unico'>('mosaico');
  const [radarTimelineStation, setRadarTimelineStation] = useState<CptecRadarStation | null>(null);
  const [showRadarTimelinePopup, setShowRadarTimelinePopup] = useState(false);
  /** Timestamps e índice do slider de radar (quando período ≤ 3 dias) */
  const [radarTimelineTimestamps, setRadarTimelineTimestamps] = useState<string[]>([]);
  const [radarTimelineIndex, setRadarTimelineIndex] = useState(0);
  const [calendarMonth, setCalendarMonth] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [selectedTrack, setSelectedTrack] = useState<TornadoTrack | null>(null);
  const [baseMapId, setBaseMapId] = useState<BaseMapId>('dark');
  const [showBaseMapGallery, setShowBaseMapGallery] = useState(false);
  const [measureMode, setMeasureMode] = useState(false);
  const [measurePoints, setMeasurePoints] = useState<{ lat: number; lng: number }[]>([]);
  const [measureDistanceKm, setMeasureDistanceKm] = useState<number | null>(null);
  const [showDateFilter, setShowDateFilter] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  /** Painéis da sidebar esquerda minimizáveis (desktop) */
  const [leftPanelRadarCollapsed, setLeftPanelRadarCollapsed] = useState(false);
  const [leftPanelOnlineCollapsed, setLeftPanelOnlineCollapsed] = useState(false);
  const [leftPanelLegendaCollapsed, setLeftPanelLegendaCollapsed] = useState(false);
  /** Sidebar esquerda inteira minimizada (mostra apenas barra de ícones) */
  const [leftSidebarCollapsed, setLeftSidebarCollapsed] = useState(false);
  /** No mobile: qual painel da esquerda está aberto (drawer) */
  const [mobileLeftPanel, setMobileLeftPanel] = useState<'none' | 'radar' | 'online' | 'legenda'>('none');
  const [mapViewMode, setMapViewMode] = useState<'tracks' | 'heatmap'>('tracks');
  const [chartTypeFilter, setChartTypeFilter] = useState<'all' | 'sig' | 'vio'>('all');
  const [trackImageOverlayVisible, setTrackImageOverlayVisible] = useState(false);
  const [overlayBeforeVisible, setOverlayBeforeVisible] = useState(false);
  const [overlayAfterVisible, setOverlayAfterVisible] = useState(false);
  const [showBeforeAfterDialog, setShowBeforeAfterDialog] = useState(false);
  const [overlayBeforeOpacity, setOverlayBeforeOpacity] = useState(0.75);
  const [overlayAfterOpacity, setOverlayAfterOpacity] = useState(0.75);
  const [visibleSecondaryImageIds, setVisibleSecondaryImageIds] = useState<string[]>([]);
  const [secondaryImageOpacities, setSecondaryImageOpacities] = useState<Record<string, number>>({});
  const [secondaryImageRotations, setSecondaryImageRotations] = useState<Record<string, number>>({});
  
  const [visibleNumericalModelIds, setVisibleNumericalModelIds] = useState<string[]>([]);
  const [numericalModelOpacities, setNumericalModelOpacities] = useState<Record<string, number>>({});
  const numericalOverlaysRef = useRef<Record<string, any>>({});
  const [polygonVisible, setPolygonVisible] = useState(true);
  const [polygonFillVisible, setPolygonFillVisible] = useState(true);
  const [prevotsOverlayVisible, setPrevotsOverlayVisible] = useState(false);
  /** Previsão Prevots da data do rastro selecionado (Admin); usado para overlay quando há overlay do dia */
  const [prevotsForecastForTrack, setPrevotsForecastForTrack] = useState<PrevotsForecast | null>(null);
  const [polygonStrokeWeight, setPolygonStrokeWeight] = useState(2.5);
  const [timelineEnabled, setTimelineEnabled] = useState(false);
  const [timelineIndex, setTimelineIndex] = useState(0);
  const [timelinePlaying, setTimelinePlaying] = useState(false);
  const [timelineSpeed, setTimelineSpeed] = useState<1 | 2 | 5>(1);
  /** Tempos exatos encontrados das imagens de radar na timeline, por slug */
  const [timelineFoundTimes, setTimelineFoundTimes] = useState<Record<string, string>>({});
  /** Radares selecionados para exibir na timeline (slugs) */
  const [timelineSelectedRadars, setTimelineSelectedRadars] = useState<Set<string>>(new Set());
  /** Tipo de produto na timeline: refletividade ou velocidade (Doppler) */
  const [timelineProductType, setTimelineProductType] = useState<'reflectividade' | 'velocidade'>('reflectividade');
  /** Menu de radares da timeline visível */
  const [showTimelineRadarMenu, setShowTimelineRadarMenu] = useState(false);
  const [dashboardCountry, setDashboardCountry] = useState<'all' | string>('all');
  const [newTrackNotifications, setNewTrackNotifications] = useState<TornadoTrack[]>([]);
  const [browserNotificationPermission, setBrowserNotificationPermission] = useState<NotificationPermission | 'unsupported'>('default');

  // Estados para o novo Painel de Informações do Tornado
  const [infoPanelGalleryIdx, setInfoPanelGalleryIdx] = useState(0);
  const [infoPanelSkewtUrl, setInfoPanelSkewtUrl] = useState<string | null>(null);

  const [shareFeedback, setShareFeedback] = useState('');
  const [popupDragging, setPopupDragging] = useState(false);
  const [trackPopupPosition, setTrackPopupPosition] = useState<{ x: number; y: number }>({ x: 16, y: 16 });
  /** Popup minimizado (barra compacta) — útil em celular */
  const [trackPopupMinimized, setTrackPopupMinimized] = useState(false);
  /** Menu de filtros no mobile (drawer) */
  const [showMobileFiltersMenu, setShowMobileFiltersMenu] = useState(false);
  /** Painel Eventos visível no mobile (overlay) */
  const [showMobileEventsPanel, setShowMobileEventsPanel] = useState(false);

  // GOES-16 IR player
  const [goesTimestamps, setGoesTimestamps] = useState<string[]>([]);
  const [goesFrameIdx, setGoesFrameIdx] = useState(0);
  const [goesLoading, setGoesLoading] = useState(false);
  const [goesError, setGoesError] = useState<string | null>(null);
  const [goesVisible, setGoesVisible] = useState(false);
  const [goesOpacity, setGoesOpacity] = useState(0.7);
  const [goesPlaying, setGoesPlaying] = useState(false);
  const [radarVisible, setRadarVisible] = useState(false);
  const [radarOpacity, setRadarOpacity] = useState(0.75);
  const [radarError, setRadarError] = useState<string | null>(null);
  /** Fonte da imagem carregada: CPTEC ou REDEMET (quando usou fallback) */
  const [radarImageSource, setRadarImageSource] = useState<'cptec' | 'redemet' | 'backup' | null>(null);
  /** Toggle HD (REDEMET) / Super Res (CPTEC) */
  const [radarSourceMode, setRadarSourceMode] = useState<'superres' | 'hd'>('superres');
  const [redemetFoundUrl, setRedemetFoundUrl] = useState<string | null>(null);
  const [cptecAvailable, setCptecAvailable] = useState(false);
  const [redemetAvailable, setRedemetAvailable] = useState(false);
  const [radarTimestamps, setRadarTimestamps] = useState<string[]>([]);
  const [radarFrameIdx, setRadarFrameIdx] = useState(0);
  const [radarLoading, setRadarLoading] = useState(false);
  const [radarPlaying, setRadarPlaying] = useState(false);
  
  // Arraste do Editor de Radar
  const radarEditDraggingRef = useRef(false);
  const radarEditDragOffsetRef = useRef({ x: 0, y: 0 });
  const radarEditRef = useRef<HTMLDivElement>(null);
  const [radarEditPosition, setRadarEditPosition] = useState<{ x: number; y: number }>({ x: 400, y: 100 });
  const [radarEditMinimized, setRadarEditMinimized] = useState(false);
  /** Estação selecionada (CPTEC ou Argentina); null se usar WMS. */
  const [radarStation, setRadarStation] = useState<CptecRadarStation | ArgentinaRadarStation | null>(null);
  /** Radares dentro de 350 km (CPTEC + Argentina, para dropdown) */
  const [radarsWithin300km, setRadarsWithin300km] = useState<(CptecRadarStation | ArgentinaRadarStation)[]>([]);
  /** Configurações de radar salvas (bounds, URL template) */
  const [radarConfigs, setRadarConfigs] = useState<RadarConfig[]>([]);
  /** Tipo de produto quando usando padrão Nowcasting PNG (radarStationId sem WMS). */
  const [radarProductType, setRadarProductType] = useState<'reflectividade' | 'velocidade'>('reflectividade');
  /** Super Res local toggle (filtro doppler) */
  const [superResEnabled, setSuperResEnabled] = useState(false);

  const [isRadarEditMode, setIsRadarEditMode] = useState(false);
  const [editRadarLat, setEditRadarLat] = useState<number>(0);
  const [editRadarLng, setEditRadarLng] = useState<number>(0);
  const [editRadarRangeKm, setEditRadarRangeKm] = useState<number>(250);
  const [editRadarRotation, setEditRadarRotation] = useState<number>(0);
  const [editRadarOpacity, setEditRadarOpacity] = useState<number>(0.75);
  const [editRadarChromaKey, setEditRadarChromaKey] = useState<number>(0);
  const [editRadarCropTop, setEditRadarCropTop] = useState<number>(0);
  const [editRadarCropBottom, setEditRadarCropBottom] = useState<number>(0);
  const [editRadarCropLeft, setEditRadarCropLeft] = useState<number>(0);
  const [editRadarCropRight, setEditRadarCropRight] = useState<number>(0);
  const [editRadarCustomBounds, setEditRadarCustomBounds] = useState<{ north: number; south: number; east: number; west: number } | null>(null);
  const [useEditCustomBounds, setUseEditCustomBounds] = useState(false);
  const [isSavingRadarEdit, setIsSavingRadarEdit] = useState(false);
  const [imageMappingMode, setImageMappingMode] = useState<'none' | 'before' | 'after'>('none');
  const imageRectRef = useRef<any>(null);
  const [isSavingImageBounds, setIsSavingImageBounds] = useState(false);

  const currentRadarId = radarStation ? ('slug' in radarStation ? radarStation.slug : `argentina:${radarStation.id}`) : selectedTrack?.radarWmsUrl;
  const currentOverrides = (currentRadarId && selectedTrack?.radarOverrides) ? selectedTrack.radarOverrides[currentRadarId] : {};

  // Auxiliar para parsing robusto de coordenadas (aceita ponto ou vírgula)
  const parseCoord = (val: string): number => {
    if (!val) return 0;
    const sanitized = val.toString().replace(',', '.').replace(/[^\d.-]/g, '');
    const num = parseFloat(sanitized);
    return isNaN(num) ? 0 : num;
  };
  const handleOpenRadarEdit = () => {
    if (!selectedTrack) return;
    
    setEditRadarLat(currentOverrides.lat ?? selectedTrack.radarLat ?? radarStation?.lat ?? 0);
    setEditRadarLng(currentOverrides.lng ?? selectedTrack.radarLng ?? radarStation?.lng ?? 0);
    setEditRadarRangeKm(currentOverrides.rangeKm ?? selectedTrack.radarRangeKm ?? radarStation?.rangeKm ?? 250);
    setEditRadarRotation(currentOverrides.rotation ?? selectedTrack.radarRotation ?? 0);
    setEditRadarOpacity(currentOverrides.opacity ?? selectedTrack.radarOpacity ?? radarOpacity);
    setEditRadarChromaKey(currentOverrides.chromaKey ?? selectedTrack.radarChromaKey ?? 0);
    setEditRadarCropTop(currentOverrides.cropTop ?? selectedTrack.radarCropTop ?? 0);
    setEditRadarCropBottom(currentOverrides.cropBottom ?? selectedTrack.radarCropBottom ?? 0);
    setEditRadarCropLeft(currentOverrides.cropLeft ?? selectedTrack.radarCropLeft ?? 0);
    setEditRadarCropRight(currentOverrides.cropRight ?? selectedTrack.radarCropRight ?? 0);
    setEditRadarCustomBounds(currentOverrides.customBounds ?? selectedTrack.radarCustomBounds ?? null);
    setUseEditCustomBounds(!!(currentOverrides.customBounds ?? selectedTrack.radarCustomBounds));
    
    setIsRadarEditMode(true);
    setRadarEditMinimized(false);
    
    // Posicionar o painel à direita ao abrir, se estiver muito longe
    const containerWidth = mapContainerRef.current?.getBoundingClientRect().width ?? window.innerWidth;
    const panelWidth = 384;
    setRadarEditPosition({ x: Math.max(16, containerWidth - panelWidth - 16), y: 80 });
  };

  const handleSaveRadarEdit = async () => {
    if (!selectedTrack || !user) return;
    setIsSavingRadarEdit(true);
    try {
      if (!currentRadarId) return;
      const updatedOverrides: Record<string, any> = { ...(selectedTrack.radarOverrides || {}) };
      updatedOverrides[currentRadarId] = {
        lat: editRadarLat,
        lng: editRadarLng,
        rangeKm: editRadarRangeKm,
        rotation: editRadarRotation,
        opacity: editRadarOpacity,
        chromaKey: editRadarChromaKey,
        cropTop: editRadarCropTop,
        cropBottom: editRadarCropBottom,
        cropLeft: editRadarCropLeft,
        cropRight: editRadarCropRight,
        customBounds: useEditCustomBounds && editRadarCustomBounds ? editRadarCustomBounds : null,
      };

      const updatedTrack: TornadoTrack = {
        ...selectedTrack,
        radarOverrides: updatedOverrides,
      };
      
      await saveTornadoTrack(updatedTrack, user.uid);
      
      setSelectedTrack(updatedTrack);
      setTracks(prev => prev.map(t => t.id === updatedTrack.id ? updatedTrack : t));
      setIsRadarEditMode(false);
      addToast('Configurações de radar salvas para este rastro.', 'success');
    } catch (e: any) {
      addToast(`Erro ao salvar: ${e.message}`, 'error');
    } finally {
      setIsSavingRadarEdit(false);
    }
  };

  // Gerenciamento do Marcador e Retângulo de Radar (Admin)
  useEffect(() => {
    if (!mapInstanceRef.current || !isRadarEditMode) {
      if (radarMarkerRef.current) { radarMarkerRef.current.setMap(null); radarMarkerRef.current = null; }
      if (radarRectRef.current) { radarRectRef.current.setMap(null); radarRectRef.current = null; }
      return;
    }

    const map = mapInstanceRef.current;

    // Criar ou Atualizar Marcador do Centro
    if (!radarMarkerRef.current) {
      radarMarkerRef.current = new google.maps.Marker({
        map,
        draggable: true,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          fillColor: '#22d3ee',
          fillOpacity: 1,
          strokeWeight: 2,
          strokeColor: '#0e7490',
          scale: 10,
        },
        title: 'Arraste para posicionar o radar',
        label: { text: 'R', color: '#ffffff', fontSize: '10px', fontWeight: 'bold' },
        zIndex: 2000,
      });

      radarMarkerRef.current.addListener('drag', () => {
        const pos = radarMarkerRef.current.getPosition();
        if (pos) {
          setEditRadarLat(pos.lat());
          setEditRadarLng(pos.lng());
        }
      });
    }
    radarMarkerRef.current.setPosition({ lat: editRadarLat, lng: editRadarLng });

    // Criar ou Atualizar Retângulo de Bounds
    if (useEditCustomBounds) {
      if (!radarRectRef.current) {
        const initialBounds = editRadarCustomBounds || (() => {
          const b = calculateRadarBounds(editRadarLat, editRadarLng, editRadarRangeKm);
          return { north: b.ne.lat, south: b.sw.lat, east: b.ne.lng, west: b.sw.lng };
        })();

        radarRectRef.current = new google.maps.Rectangle({
          map,
          bounds: { 
            north: initialBounds.north, 
            south: initialBounds.south, 
            east: initialBounds.east, 
            west: initialBounds.west 
          },
          editable: true,
          draggable: true,
          fillOpacity: 0.1,
          strokeColor: '#fbbf24',
          strokeWeight: 2,
          zIndex: 1900,
        });

        radarRectRef.current.addListener('bounds_changed', () => {
          const b = radarRectRef.current.getBounds();
          if (b) {
            setEditRadarCustomBounds({
              north: b.getNorthEast().lat(),
              south: b.getSouthWest().lat(),
              east: b.getNorthEast().lng(),
              west: b.getSouthWest().lng(),
            });
          }
        });
      }
    } else {
      if (radarRectRef.current) {
        radarRectRef.current.setMap(null);
        radarRectRef.current = null;
      }
    }

    return () => {
      // Opcional: não remover no cleanup se quisermos manter a instância viva entre renders curtos,
      // mas como o unmount do componente ou mudança de isRadarEditMode importa, tratamos no início do effect.
    };
  }, [isRadarEditMode, useEditCustomBounds, editRadarLat, editRadarLng]); 
  // Nota: tiramos editRadarCustomBounds da dep para evitar loop infinito com o listener de bounds_changed

  const clampRadarEditPosition = useCallback((x: number, y: number) => {
    const containerRect = mapContainerRef.current?.getBoundingClientRect();
    const panelEl = radarEditRef.current;
    const panelWidth = panelEl ? panelEl.getBoundingClientRect().width : 384;
    const panelHeight = panelEl ? panelEl.getBoundingClientRect().height : 500;
    const margin = 12;
    const containerWidth = containerRect?.width ?? window.innerWidth;
    const containerHeight = containerRect?.height ?? window.innerHeight;
    const maxX = Math.max(margin, containerWidth - panelWidth - margin);
    const maxY = Math.max(margin, containerHeight - panelHeight - margin);
    return {
      x: Math.min(Math.max(x, margin), maxX),
      y: Math.min(Math.max(y, margin), maxY),
    };
  }, []);

  const handleRadarEditPointerMove = useCallback((e: PointerEvent) => {
    if (!radarEditDraggingRef.current) return;
    e.preventDefault();
    const containerRect = mapContainerRef.current?.getBoundingClientRect();
    const pointerX = e.clientX - (containerRect?.left ?? 0);
    const pointerY = e.clientY - (containerRect?.top ?? 0);
    const nextX = pointerX - radarEditDragOffsetRef.current.x;
    const nextY = pointerY - radarEditDragOffsetRef.current.y;
    setRadarEditPosition(clampRadarEditPosition(nextX, nextY));
  }, [clampRadarEditPosition]);

  const stopRadarEditDrag = useCallback(() => {
    if (!radarEditDraggingRef.current) return;
    radarEditDraggingRef.current = false;
    document.body.style.userSelect = '';
    window.removeEventListener('pointermove', handleRadarEditPointerMove);
    window.removeEventListener('pointerup', stopRadarEditDrag);
    window.removeEventListener('pointercancel', stopRadarEditDrag);
  }, [handleRadarEditPointerMove]);

  const startRadarEditDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !radarEditRef.current) return;
    // Não arrastar se clicar em botões ou inputs
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('input')) return;
    
    e.preventDefault();
    const containerRect = mapContainerRef.current?.getBoundingClientRect();
    const containerLeft = containerRect?.left ?? 0;
    const containerTop = containerRect?.top ?? 0;
    const rect = radarEditRef.current.getBoundingClientRect();
    const panelLeft = rect.left - containerLeft;
    const panelTop = rect.top - containerTop;
    const pointerX = e.clientX - containerLeft;
    const pointerY = e.clientY - containerTop;
    
    radarEditDragOffsetRef.current = {
      x: pointerX - panelLeft,
      y: pointerY - panelTop,
    };
    radarEditDraggingRef.current = true;
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', handleRadarEditPointerMove);
    window.addEventListener('pointerup', stopRadarEditDrag);
    window.addEventListener('pointercancel', stopRadarEditDrag);
  };
  const radarMarkerRef = useRef<any>(null);
  const radarRectRef = useRef<any>(null);
  const goesOverlayRef = useRef<any>(null);
  const radarOverlayRef = useRef<any>(null);
  const radarTimelineOverlaysRef = useRef<any[]>([]);
  const goesPlayIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const radarPlayIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Online users / presença
  const { user, isLoading: authLoading } = useAuth();
  const { addToast } = useToast();
  const [showOnlineUsers, setShowOnlineUsers] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState<PresenceData[]>([]);
  const [shareLocation, setShareLocation] = useState(false);
  const [myLocation, setMyLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locationPermission, setLocationPermission] = useState<'unknown' | 'granted' | 'denied'>('unknown');
  /** Perfil Rastros (nome e tipo) — carregado do Firestore */
  const [rastrosProfile, setRastrosProfile] = useState<RastrosUserProfile | null>(null);
  const [rastrosProfileLoading, setRastrosProfileLoading] = useState(true);
  /** Modal de onboarding: localização, nome, tipo (exibido ao entrar se perfil incompleto) */
  const [showRastrosOnboarding, setShowRastrosOnboarding] = useState(false);
  const [onboardingDisplayName, setOnboardingDisplayName] = useState('');
  const [onboardingUserType, setOnboardingUserType] = useState<RastrosUserType>('civil');
  const presenceHeartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const presenceUnsubRef = useRef<(() => void) | null>(null);
  const onlineUserMarkersRef = useRef<any[]>([]);
  /** Visitas diárias do site (contador em tempo real) */
  const [todayVisitCount, setTodayVisitCount] = useState<number>(0);

  const [mapPinCoordinate, setMapPinCoordinate] = useState<{lat: number; lng: number} | null>(null);
  const [trackGeoPins, setTrackGeoPins] = useState<any[]>([]);
  const trackGeoPinMarkersRef = useRef<any[]>([]);

  const heatmapOverlayRef = useRef<{ overlay: any; setPoints: (p: { lat: number; lng: number }[]) => void; remove: () => void } | null>(null);
  const trackImageGroundOverlayRef = useRef<any>(null);
  const overlayBeforeRef = useRef<any>(null);
  const overlayAfterRef = useRef<any>(null);
  const secondaryOverlaysRef = useRef<Record<string, any>>({});
  const [tempBeforeImageBounds, setTempBeforeImageBounds] = useState<{ ne: { lat: number; lng: number }; sw: { lat: number; lng: number } } | null>(null);
  const [tempAfterImageBounds, setTempAfterImageBounds] = useState<{ ne: { lat: number; lng: number }; sw: { lat: number; lng: number } } | null>(null);
  const knownTrackIdsRef = useRef<Set<string>>(new Set());
  const initialTracksLoadedRef = useRef(false);

  const goToBrazil = () => {
    if (mapInstanceRef.current) {
      mapInstanceRef.current.panTo(BRAZIL_CENTER);
      mapInstanceRef.current.setZoom(DEFAULT_ZOOM);
    }
  };

  const buildTrackShareUrl = (trackId: string) => {
    if (typeof window === 'undefined') return `/rastros-tornados?track=${encodeURIComponent(trackId)}`;
    const url = new URL(window.location.href);
    url.searchParams.set('track', trackId);
    return url.toString();
  };

  const handleShareTrack = async (track: TornadoTrack) => {
    const url = buildTrackShareUrl(track.id);
    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({
          title: `Rastro ${track.date}`,
          text: `${track.locality || track.state} • ${track.date}`,
          url,
        });
        setShareFeedback('Link compartilhado.');
      } else if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        setShareFeedback('Link copiado.');
      } else {
        setShareFeedback(url);
      }
    } catch {
      setShareFeedback('Não foi possível compartilhar agora.');
    }
  };

  const clampPopupPosition = useCallback((x: number, y: number) => {
    const containerRect = mapContainerRef.current?.getBoundingClientRect();
    const popupEl = trackPopupRef.current;
    const popupWidth = popupEl ? popupEl.getBoundingClientRect().width : 384;
    const popupHeight = popupEl ? popupEl.getBoundingClientRect().height : 560;
    const margin = 12;
    const containerWidth = containerRect?.width ?? window.innerWidth;
    const containerHeight = containerRect?.height ?? window.innerHeight;
    const maxX = Math.max(margin, containerWidth - popupWidth - margin);
    const maxY = Math.max(margin, containerHeight - popupHeight - margin);
    return {
      x: Math.min(Math.max(x, margin), maxX),
      y: Math.min(Math.max(y, margin), maxY),
    };
  }, []);

  const handlePopupPointerMove = useCallback((e: PointerEvent) => {
    if (!popupDraggingRef.current) return;
    e.preventDefault();
    const containerRect = mapContainerRef.current?.getBoundingClientRect();
    const pointerX = e.clientX - (containerRect?.left ?? 0);
    const pointerY = e.clientY - (containerRect?.top ?? 0);
    const nextX = pointerX - popupDragOffsetRef.current.x;
    const nextY = pointerY - popupDragOffsetRef.current.y;
    setTrackPopupPosition(clampPopupPosition(nextX, nextY));
  }, [clampPopupPosition]);

  const stopPopupDrag = useCallback(() => {
    if (!popupDraggingRef.current) return;
    popupDraggingRef.current = false;
    setPopupDragging(false);
    document.body.style.userSelect = '';
    window.removeEventListener('pointermove', handlePopupPointerMove);
    window.removeEventListener('pointerup', stopPopupDrag);
    window.removeEventListener('pointercancel', stopPopupDrag);
  }, [handlePopupPointerMove]);

  const startPopupDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !trackPopupRef.current) return;
    e.preventDefault();
    const containerRect = mapContainerRef.current?.getBoundingClientRect();
    const containerLeft = containerRect?.left ?? 0;
    const containerTop = containerRect?.top ?? 0;
    const rect = trackPopupRef.current.getBoundingClientRect();
    const popupLeft = rect.left - containerLeft;
    const popupTop = rect.top - containerTop;
    const pointerX = e.clientX - containerLeft;
    const pointerY = e.clientY - containerTop;
    popupDragOffsetRef.current = {
      x: pointerX - popupLeft,
      y: pointerY - popupTop,
    };
    popupDraggingRef.current = true;
    setPopupDragging(true);
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', handlePopupPointerMove);
    window.addEventListener('pointerup', stopPopupDrag);
    window.addEventListener('pointercancel', stopPopupDrag);
  };

  const requestBrowserNotifications = async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setBrowserNotificationPermission('unsupported');
      return;
    }
    const permission = await Notification.requestPermission();
    setBrowserNotificationPermission(permission);
  };

  const refreshTracks = useCallback(async (silent: boolean = false) => {
    if (!silent) setTracksLoading(true);
    try {
      const list = await fetchTornadoTracks();
      const normalized = (list.length ? list : TORNADO_TRACKS_DEMO).map((t) => ({
        ...t,
        country: inferCountryFromTrack(t),
      }));
      setTracks(normalized);

      if (!initialTracksLoadedRef.current) {
        knownTrackIdsRef.current = new Set(normalized.map((t) => t.id));
        initialTracksLoadedRef.current = true;
        return;
      }

      const newItems = normalized.filter((t) => !knownTrackIdsRef.current.has(t.id));
      if (newItems.length > 0) {
        setNewTrackNotifications((prev) => {
          const merged = [...newItems, ...prev];
          const seen = new Set<string>();
          return merged.filter((t) => {
            if (seen.has(t.id)) return false;
            seen.add(t.id);
            return true;
          }).slice(0, 20);
        });

        if (
          typeof window !== 'undefined' &&
          'Notification' in window &&
          Notification.permission === 'granted'
        ) {
          const countText = newItems.length === 1 ? '1 novo rastro' : `${newItems.length} novos rastros`;
          const newest = newItems[0];
          new Notification(`Rastros de Tornados: ${countText}`, {
            body: `${newest.date} • ${newest.locality || newest.state}`,
          });
        }
      }
      knownTrackIdsRef.current = new Set(normalized.map((t) => t.id));
    } catch {
      setTracks(TORNADO_TRACKS_DEMO.map((t) => ({ ...t, country: inferCountryFromTrack(t) })));
    } finally {
      if (!silent) setTracksLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshTracks(false);
    const timer = setInterval(() => refreshTracks(true), 60_000);
    return () => clearInterval(timer);
  }, [refreshTracks]);

  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setBrowserNotificationPermission(Notification.permission);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || tracks.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    const idFromUrl = params.get('track');
    if (!idFromUrl) return;
    const found = tracks.find((t) => t.id === idFromUrl);
    if (found) setSelectedTrack(found);
  }, [tracks]);

  // Exigir login para acessar a página de rastros - CORREÇÃO: esperar carregar antes de chutar o balde
  useEffect(() => {
    if (!authLoading && !user) {
      // Preservar o track ID na URL para o login poder devolver se quisermos (ou apenas evitar o refresh se já logado)
      const currentParams = window.location.search;
      router.push(`/login${currentParams}`);
    }
  }, [user, authLoading, router]);

  // Posição inicial do popup de detalhes (canto superior direito)
  useEffect(() => {
    if (!selectedTrack) return;
    setTrackPopupMinimized(false);
    const popupWidth = 384;
    const margin = 16;
    const containerWidth = mapContainerRef.current?.getBoundingClientRect().width ?? window.innerWidth;
    const initial = clampPopupPosition(containerWidth - popupWidth - margin, margin);
    setTrackPopupPosition(initial);
  }, [selectedTrack, clampPopupPosition]);

  // Limpeza de listeners de arraste no unmount
  useEffect(() => {
    return () => {
      stopPopupDrag();
    };
  }, [stopPopupDrag]);

  const years = useMemo(() => getTracksYears(tracks), [tracks]);
  const intensities = useMemo(() => getTracksIntensities(tracks), [tracks]);

  const effectiveStartDate = intervalStartDate ?? startDate;
  const effectiveEndDate = intervalEndDate ?? endDate;

  const filteredTracks = useMemo(() => {
    return tracks.filter((t) => {
      const trackYear = t.date.slice(0, 4);
      if (yearFilter && trackYear !== yearFilter) return false;
      if (intensityFilter && !t.polygons.some((p) => p.intensity === intensityFilter)) return false;
      if (effectiveStartDate && t.date < effectiveStartDate) return false;
      if (effectiveEndDate && t.date > effectiveEndDate) return false;
      return true;
    });
  }, [tracks, yearFilter, intensityFilter, effectiveStartDate, effectiveEndDate]);

  /** Rastros filtrados só por ano e intensidade (para restrição de datas do radar histórico) */
  const tracksForRadarRestriction = useMemo(() => {
    return tracks.filter((t) => {
      const trackYear = t.date.slice(0, 4);
      if (yearFilter && trackYear !== yearFilter) return false;
      if (intensityFilter && !t.polygons.some((p) => p.intensity === intensityFilter)) return false;
      return true;
    });
  }, [tracks, yearFilter, intensityFilter]);

  /** Datas permitidas para radar histórico: ±1 dia de cada rastro */
  const allowedRadarDates = useMemo(() => {
    const set = new Set<string>();
    const addDays = (dateStr: string, delta: number): string => {
      const d = new Date(dateStr + 'T12:00:00Z');
      d.setUTCDate(d.getUTCDate() + delta);
      return d.toISOString().slice(0, 10);
    };
    tracksForRadarRestriction.forEach((t) => {
      for (let d = -1; d <= 1; d++) set.add(addDays(t.date, d));
    });
    return set;
  }, [tracksForRadarRestriction]);

  /** Verifica se intervalo [start, end] está inteiramente dentro de datas permitidas */
  const isIntervalAllowedForRadar = useCallback((start: string, end: string) => {
    if (start > end) return false;
    const addDays = (dateStr: string, delta: number): string => {
      const d = new Date(dateStr + 'T12:00:00Z');
      d.setUTCDate(d.getUTCDate() + delta);
      return d.toISOString().slice(0, 10);
    };
    for (let d = new Date(start + 'T12:00:00Z'); d <= new Date(end + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) {
      const dateStr = d.toISOString().slice(0, 10);
      if (!allowedRadarDates.has(dateStr)) return false;
    }
    return true;
  }, [allowedRadarDates]);

  const intervalDays = useMemo(() => {
    if (!intervalStartDate || !intervalEndDate || intervalStartDate > intervalEndDate) return 0;
    const a = new Date(intervalStartDate).getTime();
    const b = new Date(intervalEndDate).getTime();
    return Math.ceil((b - a) / (24 * 60 * 60 * 1000)) + 1;
  }, [intervalStartDate, intervalEndDate]);

  const showRadarTimelineSlider = intervalStartDate && intervalEndDate && intervalDays > 0 && intervalDays <= 3
    && isIntervalAllowedForRadar(intervalStartDate, intervalEndDate);

  /** Centroide dos rastros filtrados (para radares no raio) */
  const intervalCentroid = useMemo(() => {
    if (!filteredTracks.length) return null;
    let sumLat = 0; let sumLng = 0; let count = 0;
    filteredTracks.forEach((t) => {
      const c = getTrackCentroid(t);
      if (c) { sumLat += c.lat; sumLng += c.lng; count++; }
    });
    return count ? { lat: sumLat / count, lng: sumLng / count } : null;
  }, [filteredTracks]);

  const handleIntervalDayClick = useCallback((date: string) => {
    if (!allowedRadarDates.has(date)) return;
    if (calendarSelectPhase === 'start') {
      setIntervalStartDate(date);
      setCalendarSelectPhase('end');
    } else {
      const a = intervalStartDate!;
      const b = date;
      if (a <= b) {
        setIntervalEndDate(b);
      } else {
        setIntervalStartDate(b);
        setIntervalEndDate(a);
      }
      setShowIntervalCalendar(false);
    }
  }, [calendarSelectPhase, intervalStartDate, allowedRadarDates]);

  const intervalRadars = useMemo(() => {
    if (!showRadarTimelineSlider) return [];
    if (intervalStartDate && intervalStartDate < '2026-03-01') {
      return CPTEC_RADAR_STATIONS.filter(r => r.slug !== 'climatempo-poa');
    }
    return [...CPTEC_RADAR_STATIONS];
  }, [showRadarTimelineSlider, intervalStartDate]);

  /** Auto-selecionar todos os radares do intervalo por padrão */
  useEffect(() => {
    if (intervalRadars.length > 0) {
      setTimelineSelectedRadars(new Set(intervalRadars.map(r => r.slug)));
    } else {
      setTimelineSelectedRadars(new Set());
    }
  }, [intervalRadars]);

  /** Estação ativa para timeline: único = selecionada, mosaico = primeira do raio */
  const timelineActiveStation = radarTimelineMode === 'unico'
    ? radarTimelineStation ?? intervalRadars[0] ?? null
    : intervalRadars[0] ?? null;

  /** Timestamps do slider: unificado 5min (mosaico) ou por radar (único) */
  useEffect(() => {
    if ((!showRadarTimelineSlider && !timelineEnabled) || !intervalStartDate || !intervalEndDate) {
      setRadarTimelineTimestamps([]);
      setRadarTimelineIndex(0);
      return;
    }
    if (radarTimelineMode === 'mosaico') {
      const ts = generateUnifiedTimelineTimestamps(intervalStartDate, intervalEndDate);
      setRadarTimelineTimestamps(ts);
      setRadarTimelineIndex(0);
      return;
    }
    const station = radarTimelineStation ?? intervalRadars[0];
    if (!station) {
      setRadarTimelineTimestamps([]);
      return;
    }
    const ts = generateRadarTimestampsForDateRange(intervalStartDate, intervalEndDate, station);
    setRadarTimelineTimestamps(ts);
    setRadarTimelineIndex(0);
  }, [showRadarTimelineSlider, intervalStartDate, intervalEndDate, radarTimelineMode, radarTimelineStation, intervalRadars]);

  /** Setas do teclado: controlam o slider do radar (frame ou timeline). Captura no capture phase para prioridade sobre o mapa. */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const el = e.target as HTMLElement;
      const tag = el?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || el?.isContentEditable) return;
      e.preventDefault();
      e.stopPropagation();
      if (radarVisible && radarTimestamps.length > 1) {
        if (e.key === 'ArrowLeft') {
          setRadarFrameIdx((prev) => Math.min(radarTimestamps.length - 1, prev + 1));
        } else if (e.key === 'ArrowRight') {
          setRadarFrameIdx((prev) => Math.max(0, prev - 1));
        }
      } else if (showRadarTimelineSlider && radarTimelineTimestamps.length > 1) {
        const maxIdx = radarTimelineTimestamps.length - 1;
        if (e.key === 'ArrowLeft') {
          setRadarTimelineIndex((prev) => Math.max(0, prev - 1));
        } else if (e.key === 'ArrowRight') {
          setRadarTimelineIndex((prev) => Math.min(maxIdx, prev + 1));
        }
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [radarVisible, radarTimestamps.length, showRadarTimelineSlider, radarTimelineTimestamps.length]);

  const timelineDates = useMemo(
    () => Array.from(new Set(filteredTracks.map((t) => t.date))).sort((a, b) => a.localeCompare(b)),
    [filteredTracks]
  );

  const timelineCurrentDate = useMemo(() => {
    if (!timelineEnabled) return null;
    if (radarTimelineTimestamps.length > 0) {
      const ts = radarTimelineTimestamps[radarTimelineIndex];
      if (!ts) return null;
      return `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)} ${ts.slice(8, 10)}:${ts.slice(10, 12)}`;
    }
    if (timelineDates.length > 0) {
      return timelineDates[Math.min(timelineIndex, timelineDates.length - 1)];
    }
    return null;
  }, [timelineEnabled, radarTimelineTimestamps, radarTimelineIndex, timelineDates, timelineIndex]);

  const displayedTracks = useMemo(() => {
    if (!timelineEnabled || !timelineCurrentDate) return filteredTracks;
    return filteredTracks.filter((t) => {
      if (timelineCurrentDate.length > 10) { // YYYY-MM-DD HH:mm
        const d = timelineCurrentDate.slice(0, 10);
        const hm = timelineCurrentDate.slice(11);
        return t.date < d || (t.date === d && (t.time || '00:00') <= hm);
      }
      return t.date <= timelineCurrentDate;
    });
  }, [filteredTracks, timelineEnabled, timelineCurrentDate]);

  /** Rastros usados nos gráficos: filtro por tipo All (F0–F5) / Sig (F2+) / Vio (F4+) */
  const chartTracks = useMemo(() => {
    if (chartTypeFilter === 'all') return displayedTracks;
    if (chartTypeFilter === 'sig') return displayedTracks.filter((t) => meetsMinIntensity(t, 'F2'));
    return displayedTracks.filter((t) => meetsMinIntensity(t, 'F4'));
  }, [displayedTracks, chartTypeFilter]);

  const monthNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const seasonOrder: Season[] = ['Verão', 'Outono', 'Inverno', 'Primavera'];

  /** Frequência por mês (1–12) ao longo de todos os anos */
  const frequencyByMonth = useMemo(() => {
    const counts = new Array(12).fill(0);
    chartTracks.forEach((t) => {
      const m = getMonthFromDate(t.date);
      if (m >= 1 && m <= 12) counts[m - 1]++;
    });
    return counts;
  }, [chartTracks]);

  /** Frequência por estação */
  const frequencyBySeason = useMemo(() => {
    const counts: Record<Season, number> = { Verão: 0, Outono: 0, Inverno: 0, Primavera: 0 };
    chartTracks.forEach((t) => {
      const s = getSeasonFromDate(t.date);
      if (s) counts[s]++;
    });
    return seasonOrder.map((s) => ({ season: s, count: counts[s] }));
  }, [chartTracks]);

  const maxMonthCount = Math.max(1, ...frequencyByMonth);
  const maxSeasonCount = Math.max(1, ...frequencyBySeason.map((x) => x.count));

  const countriesInDashboard = useMemo(() => {
    const values = Array.from(new Set(chartTracks.map((t) => inferCountryFromTrack(t))));
    return values.sort((a, b) => a.localeCompare(b));
  }, [chartTracks]);

  const countryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    chartTracks.forEach((t) => {
      const c = inferCountryFromTrack(t);
      counts.set(c, (counts.get(c) || 0) + 1);
    });
    return Array.from(counts.entries())
      .map(([country, count]) => ({ country, count }))
      .sort((a, b) => b.count - a.count);
  }, [chartTracks]);

  const stateCountsByCountry = useMemo(() => {
    const base = dashboardCountry === 'all'
      ? chartTracks
      : chartTracks.filter((t) => inferCountryFromTrack(t) === dashboardCountry);
    const counts = new Map<string, number>();
    base.forEach((t) => {
      const key = (t.state || 'N/D').trim() || 'N/D';
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return Array.from(counts.entries())
      .map(([state, count]) => ({ state, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [chartTracks, dashboardCountry]);

  const maxStateCount = Math.max(1, ...stateCountsByCountry.map((x) => x.count));

  useEffect(() => {
    if (!countriesInDashboard.includes(dashboardCountry) && dashboardCountry !== 'all') {
      setDashboardCountry('all');
    }
  }, [countriesInDashboard, dashboardCountry]);

  useEffect(() => {
    if (!timelineDates.length) {
      setTimelineIndex(0);
      setTimelinePlaying(false);
      return;
    }
    setTimelineIndex((prev) => Math.min(prev, timelineDates.length - 1));
  }, [timelineDates.length]);

  // (handleTimelinePlay removido para não carregar todas as imagens de uma vez)

  useEffect(() => {
    if (!timelineEnabled || !timelinePlaying) return;
    const isDetailed = radarTimelineTimestamps.length > 0;
    const len = isDetailed ? radarTimelineTimestamps.length : timelineDates.length;
    if (len <= 1) return;

    const baseInterval = isDetailed ? 600 : 1200;
    const intervalMs = baseInterval / timelineSpeed;

    const timer = setInterval(() => {
      if (isDetailed) {
        setRadarTimelineIndex((prev) => {
          if (prev >= radarTimelineTimestamps.length - 1) {
            setTimelinePlaying(false);
            return prev;
          }
          return prev + 1;
        });
      } else {
        setTimelineIndex((prev) => {
          if (prev >= timelineDates.length - 1) {
            setTimelinePlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }
    }, intervalMs);
    return () => clearInterval(timer);
  }, [timelineEnabled, timelinePlaying, radarTimelineTimestamps.length, timelineDates.length, timelineSpeed]);

  useEffect(() => {
    if (!selectedTrack) return;
    if (!displayedTracks.some((t) => t.id === selectedTrack.id)) {
      setSelectedTrack(null);
    }
  }, [displayedTracks, selectedTrack]);

  // Reset do estado do painel de informações ao selecionar rastro
  useEffect(() => {
    setInfoPanelGalleryIdx(0);
    setInfoPanelSkewtUrl(selectedTrack?.skewts?.[0] || null);
  }, [selectedTrack?.id]);

  /** Busca previsão Prevots da data do rastro (Admin) para overlay quando houver overlay do dia */
  useEffect(() => {
    if (!selectedTrack?.date) {
      setPrevotsForecastForTrack(null);
      return;
    }
    fetchPrevotsForecastByDate(selectedTrack.date)
      .then(setPrevotsForecastForTrack)
      .catch(() => setPrevotsForecastForTrack(null));
  }, [selectedTrack?.date]);

  useEffect(() => {
    if (!shareFeedback) return;
    const timer = setTimeout(() => setShareFeedback(''), 2200);
    return () => clearTimeout(timer);
  }, [shareFeedback]);

  /** Centralizar mapa no rastro selecionado (bounds dos polígonos). */
  const zoomToTrack = useCallback(() => {
    if (!selectedTrack?.polygons?.length || !mapInstanceRef.current) return;
    const map = mapInstanceRef.current;
    const bounds = new google.maps.LatLngBounds();
    selectedTrack.polygons.forEach((poly) => {
      const ring = poly.coordinates[0];
      if (!ring) return;
      ring.forEach(([lng, lat]) => bounds.extend({ lat, lng }));
    });
    map.fitBounds(bounds, { top: 80, right: 24, bottom: 80, left: 24 });
  }, [selectedTrack]);

  // Auto-zoom ao selecionar rastro (útil para links compartilhados)
  useEffect(() => {
    if (selectedTrack && mapReady) {
      zoomToTrack();
    }
  }, [selectedTrack, mapReady, zoomToTrack]);

  const resetDateFilter = () => {
    setStartDate('');
    setEndDate('');
  };

  // ─── GOES-16 helpers (NASA GIBS WMS) ────────────────────────────────────────

  /** Retorna true se o rastro tem data >= 2017-12-18 (GOES-16 operacional). */
  const goesAvailable = (track: TornadoTrack) => track.date >= '2017-12-18';

  /**
   * Calcula bounds lat/lng do rastro com padding para contexto meteorológico.
   * Retorna null se o rastro não tiver polígonos.
   */
  const getGoesBounds = (track: TornadoTrack) => {
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    track.polygons.forEach((poly) => {
      poly.coordinates[0]?.forEach(([lng, lat]) => {
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
      });
    });
    if (!isFinite(minLat)) return null;
    // Padding de 3° (~300 km) para mostrar contexto meteorológico ao redor
    const pad = 3;
    return { north: maxLat + pad, south: minLat - pad, east: maxLng + pad, west: minLng - pad };
  };

  /**
   * Gera timestamps a cada 10 min para ±3h em torno da hora (se informada)
   * ou para o dia inteiro. Formato: "YYYYMMDDHHMMSS".
   */
  const generateGoesTimestamps = (track: TornadoTrack): string[] => {
    const dateStr = track.date.replace(/-/g, '');
    let startMin = 0;
    let endMin = 23 * 60 + 50;
    if (track.time) {
      const [hh, mm] = track.time.split(':').map(Number);
      const center = hh * 60 + mm;
      startMin = Math.max(0, center - 180);
      endMin = Math.min(23 * 60 + 50, center + 180);
    }
    const result: string[] = [];
    for (let t = startMin; t <= endMin; t += 10) {
      const h = Math.floor(t / 60);
      const m = t % 60;
      result.push(`${dateStr}${String(h).padStart(2, '0')}${String(m).padStart(2, '0')}00`);
    }
    return result;
  };

  /**
   * Gera timestamps para ±3h em torno da hora (radar Nowcasting).
   * Alinha ao grid do radar: Chapecó = 6 min a partir de XX:02; Santiago = 10 min a partir de XX:00.
   * Formato: "YYYYMMDDHHMMSS" (ts12 = primeiros 12 dígitos).
   */
  const generateRadarTimestamps = (
    track: TornadoTrack,
    intervalMinutes: number = 6,
    offsetMinutes: number = 0
  ): string[] => {
    const dateStr = track.date.replace(/-/g, '');
    const lastValidMin = 23 * 60 + 59;
    let startMin = 0;
    let endMin = lastValidMin;
    if (track.time) {
      const [hh, mm] = track.time.split(':').map(Number);
      const center = hh * 60 + mm;
      startMin = Math.max(0, center - 180);
      endMin = Math.min(lastValidMin, center + 180);
    }
    const findFirstValid = () => {
      for (let t = startMin; t <= Math.min(endMin, startMin + 60); t++) {
        const m = t % 60;
        if (m >= offsetMinutes && (m - offsetMinutes) % intervalMinutes === 0) return t;
      }
      return startMin;
    };
    const firstValid = findFirstValid();
    const result: string[] = [];
    for (let t = firstValid; t <= endMin; t += intervalMinutes) {
      const h = Math.floor(t / 60);
      const m = t % 60;
      result.push(`${dateStr}${String(h).padStart(2, '0')}${String(m).padStart(2, '0')}00`);
    }
    return result;
  };

  /** Índice do frame mais próximo ao horário do tornado. (Formato CPTEC: YYYYMMDDHHmm00) */
  const findClosestRadarFrameIdx = (ts: string[], trackTime: string | undefined): number => {
    if (!trackTime || !ts.length) return 0;
    const [hh, mm] = trackTime.split(':').map(Number);
    const center = hh * 60 + mm;
    let bestIdx = 0;
    let bestDiff = Infinity;
    ts.forEach((t, i) => {
      const th = parseInt(t.slice(8, 10), 10);
      const tm = parseInt(t.slice(10, 12), 10);
      const diff = Math.abs(th * 60 + tm - center);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestIdx = i;
      }
    });
    return bestIdx;
  };

  /** Índice do frame mais próximo ao horário do tornado. (Formato Argentina: YYYYMMDDTHHmm00Z) */
  const findClosestArgentinaFrameIdx = (ts: string[], trackTime: string | undefined): number => {
    if (!trackTime || !ts.length) return 0;
    const [hh, mm] = trackTime.split(':').map(Number);
    const center = hh * 60 + mm;
    let bestIdx = 0;
    let bestDiff = Infinity;
    ts.forEach((t, i) => {
      const th = parseInt(t.slice(9, 11), 10);
      const tm = parseInt(t.slice(11, 13), 10);
      const diff = Math.abs(th * 60 + tm - center);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestIdx = i;
      }
    });
    return bestIdx;
  };

  /**
   * Monta URL WMS da NASA GIBS para o timestamp e bounds do tornado.
   * CORS habilitado — sem proxy necessário.
   * Retorna imagem recortada exatamente na área do tornado.
   */
  const goesWmsUrl = (
    timestamp: string,
    bounds: { north: number; south: number; east: number; west: number }
  ) => {
    const time = `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}T${timestamp.slice(8, 10)}:${timestamp.slice(10, 12)}:00Z`;
    const { west, south, east, north } = bounds;
    return (
      `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi` +
      `?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap` +
      `&LAYERS=GOES-East_ABI_Band13_Clean_Infrared` +
      `&CRS=CRS:84&BBOX=${west},${south},${east},${north}` +
      `&WIDTH=512&HEIGHT=512&FORMAT=image/png&TIME=${time}`
    );
  };

  const latLngToWebMercator = (lat: number, lng: number) => {
    const x = (lng * 20037508.34) / 180;
    let y = Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180);
    y = (y * 20037508.34) / 180;
    return { x, y };
  };

  const buildRadarWmsUrl = (
    rawUrl: string,
    bounds: { north: number; south: number; east: number; west: number },
    width: number = 768,
    height: number = 768
  ) => {
    if (!rawUrl.trim()) return '';
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return '';
    }
    const crs = (url.searchParams.get('CRS') || url.searchParams.get('SRS') || 'EPSG:3857').toUpperCase();

    let bbox = `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`;
    if (crs.includes('3857')) {
      const sw = latLngToWebMercator(bounds.south, bounds.west);
      const ne = latLngToWebMercator(bounds.north, bounds.east);
      bbox = `${sw.x},${sw.y},${ne.x},${ne.y}`;
    }

    url.searchParams.set('SERVICE', 'WMS');
    url.searchParams.set('VERSION', url.searchParams.get('VERSION') || '1.3.0');
    url.searchParams.set('REQUEST', 'GetMap');
    url.searchParams.set('FORMAT', 'image/png');
    url.searchParams.set('TRANSPARENT', 'true');
    url.searchParams.set('BBOX', bbox);
    url.searchParams.set('WIDTH', String(width));
    url.searchParams.set('HEIGHT', String(height));
    if (url.searchParams.has('CRS')) url.searchParams.set('CRS', crs);
    if (url.searchParams.has('SRS')) url.searchParams.set('SRS', crs);
    return url.toString();
  };

  const replaceRadarTimestamp = (rawUrl: string, ts12: string) => {
    // Formato típico no SIGMA: ..._YYYYMMDDHHMM.png
    if (/\d{12}/.test(rawUrl)) return rawUrl.replace(/\d{12}/g, ts12);
    return rawUrl;
  };

  const getRadarFrameUrl = (
    rawUrl: string,
    timestamp14: string,
    bounds: { north: number; south: number; east: number; west: number }
  ) => {
    const ts12 = timestamp14.slice(0, 12);
    const withTs = replaceRadarTimestamp(rawUrl, ts12);
    return buildRadarWmsUrl(withTs, bounds, 768, 768);
  };

  const loadRadarTimestamps = (track: TornadoTrack) => {
    setRadarLoading(true);
    setRadarError(null);
    setRadarPlaying(false);
    setRadarTimestamps([]);
    setRadarFrameIdx(0);
    setRadarStation(null);
    setCptecAvailable(false);
    setRedemetAvailable(false);
    setRadarImageSource(null);

    if (track.radarWmsUrl?.trim()) {
      // WMS (SIGMA): usar URL cadastrada manualmente; bounds vêm do radar, não do rastro
      if (!track.time) {
        setRadarError('Defina o horário do tornado (UTC) para carregar radar ±3h.');
        setRadarLoading(false);
        return;
      }
      const wmsStation = track.radarStationId
        ? CPTEC_RADAR_STATIONS.find((s) => s.slug === track.radarStationId) ?? null
        : null;
      setRadarStation(wmsStation);
      const interval = wmsStation?.updateIntervalMinutes ?? 10;
      const offset = wmsStation?.updateIntervalOffsetMinutes ?? 0;
      const ts = generateRadarTimestamps(track, interval, offset);
      if (!ts.length) {
        setRadarError('Não foi possível gerar janelas de tempo para o radar.');
        setRadarLoading(false);
        return;
      }
      setRadarTimestamps(ts);
      setRadarFrameIdx(findClosestRadarFrameIdx(ts, track.time));
      setRadarsWithin300km([]);
      setRadarLoading(false);
      return;
    }

    // Radarreferência explícita sem WMS: usar padrão Nowcasting (ppicz/ppivr)
    if (track.radarStationId && track.time) {
      const station = CPTEC_RADAR_STATIONS.find((s) => s.slug === track.radarStationId);
      if (!station) {
        setRadarError(`Radar "${track.radarStationId}" não encontrado.`);
        setRadarLoading(false);
        return;
      }
      if (station.slug === 'chapeco') {
        (async () => {
          const configs = getChapecoFallbackConfigs(track.date);
          for (const { interval, offset } of configs) {
            const ts = generateRadarTimestamps(track, interval, offset);
            if (!ts.length) continue;
            const probeIdx = findClosestRadarFrameIdx(ts, track.time);
            const probeTs = ts[probeIdx];
            
            const probeTs12 = probeTs.slice(0, 12);
            const y = probeTs12.slice(0, 4);
            const m = probeTs12.slice(4, 6);
            const d = probeTs12.slice(6, 8);
            const h = probeTs12.slice(8, 10);
            const mn = probeTs12.slice(10, 12);
            const targetTimeEpoch = new Date(`${y}-${m}-${d}T${h}:${mn}:00Z`).getTime();
            const diffHours = (Date.now() - targetTimeEpoch) / (1000 * 60 * 60);

            let exists = false;
            if (diffHours <= 48 && diffHours >= -5) {
              const url = buildNowcastingPngUrl(station, probeTs12, 'reflectividade');
              exists = await probeRadarImageExists(getProxiedRadarUrl(url));
            } else {
              const directUrl = buildNowcastingPngUrl(station, probeTs12, 'reflectividade', true);
              exists = await probeRadarImageExists(getProxiedRadarUrl(directUrl));
              if (!exists) {
                const backupApiUrl = getRadarBackupUrl('chapeco', probeTs12, 'reflectividade');
                try {
                  const r = await fetch(backupApiUrl);
                  const data = r.ok ? await r.json() : null;
                  if (data?.url) exists = true;
                } catch {}
              }
            }

            if (exists) {
              setRadarStation(station);
              setRadarTimestamps(ts);
              setRadarFrameIdx(probeIdx);
              setRadarsWithin300km([]);
              setRadarLoading(false);
              return;
            }
          }
          setRadarError('Nenhuma imagem de radar encontrada para Chapecó (tentados 6min, 5min/00:00, 5min/00:02).');
          setRadarLoading(false);
        })();
        return;
      }
      const interval = station.updateIntervalMinutes ?? 6;
      const offset = station.updateIntervalOffsetMinutes ?? 0;
      const ts = generateRadarTimestamps(track, interval, offset);
      if (!ts.length) {
        setRadarError('Não foi possível gerar janelas de tempo para o radar.');
        setRadarLoading(false);
        return;
      }
      setRadarStation(station);
      setRadarTimestamps(ts);
      setRadarFrameIdx(findClosestRadarFrameIdx(ts, track.time));
      setRadarsWithin300km([]);

      // Prova proativa para Santiago e Morro da Igreja
      if (station.slug === 'santiago' || station.slug === 'morroigreja') {
        const probeIdx = findClosestRadarFrameIdx(ts, track.time);
        const probeTs12 = ts[probeIdx].slice(0, 12);
        const cptecUrl = buildNowcastingPngUrl(station, probeTs12, 'reflectividade');
        probeRadarImageExists(getProxiedRadarUrl(cptecUrl)).then(setCptecAvailable);
        const area = getRedemetArea(station.slug);
        if (area) {
          fetch(`/api/radar-redemet-find?area=${area}&ts12=${probeTs12}&historical=true`)
            .then(r => r.ok ? r.json() : null)
            .then(d => { if (d?.url) setRedemetAvailable(true); });
        }
      }

      setRadarLoading(false);
      return;
    }

    // Nowcasting PNG ou SIGMA: radares CPTEC + Argentina dentro de 350 km
    const centroid = getTrackCentroid(track);
    if (!centroid) {
      setRadarError('Rastro sem polígonos para calcular centro. Use WMS manual no Admin.');
      setRadarLoading(false);
      return;
    }
    let cptecRadars = findRadarsWithinRadius(centroid, 350);
    if (track.date < '2026-03-01') {
      cptecRadars = cptecRadars.filter(r => r.slug !== 'climatempo-poa');
    }
    const argentinaRadars = findArgentinaRadarsWithinRadius(centroid, 350);
    const radars: (CptecRadarStation | ArgentinaRadarStation)[] = [...cptecRadars, ...argentinaRadars];
    if (!radars.length) {
      setRadarError('Nenhum radar (CPTEC ou Argentina) no raio de 350 km.');
      setRadarLoading(false);
      return;
    }
    if (!track.time) {
      setRadarError('Defina o horário do tornado (UTC) para carregar radar ±3h.');
      setRadarLoading(false);
      return;
    }
    const preferred = track.radarStationId
      ? radars.find((r) => ('slug' in r ? r.slug === track.radarStationId : r.id === track.radarStationId))
      : radars[0];
    const station = preferred || radars[0];
    const isArgentina = !('slug' in station);
    if (isArgentina) {
      const argStation = station as ArgentinaRadarStation;
      const dateStr = track.date.replace(/-/g, '');
      let startMin = 0, endMin = 23 * 60 + 59;
      if (track.time) {
        const [hh, mm] = track.time.split(':').map(Number);
        const center = hh * 60 + mm;
        startMin = Math.max(0, center - 180);
        endMin = Math.min(23 * 60 + 59, center + 180);
      }
      const interval = argStation.updateIntervalMinutes;
      const argTs: string[] = [];
      for (let t = Math.floor(startMin / interval) * interval; t <= endMin; t += interval) {
        if (t < startMin) continue;
        const h = Math.floor(t / 60);
        const m = t % 60;
        const d = new Date(Date.UTC(
          parseInt(dateStr.slice(0, 4), 10),
          parseInt(dateStr.slice(4, 6), 10) - 1,
          parseInt(dateStr.slice(6, 8), 10),
          h, m, 0
        ));
        argTs.push(getArgentinaRadarTimestamp(d, argStation));
      }
      setRadarsWithin300km(radars);
      setRadarStation(argStation);
      setRadarTimestamps(argTs);
      setRadarFrameIdx(findClosestArgentinaFrameIdx(argTs, track.time));
      setRadarLoading(false);
      return;
    }
    if ((station as CptecRadarStation).slug === 'chapeco') {
      (async () => {
        const configs = getChapecoFallbackConfigs(track.date);
        for (const { interval, offset } of configs) {
          const ts = generateRadarTimestamps(track, interval, offset);
          if (!ts.length) continue;
          const probeIdx = findClosestRadarFrameIdx(ts, track.time);
          const probeTs = ts[probeIdx];

          const probeTs12 = probeTs.slice(0, 12);
          const y = probeTs12.slice(0, 4);
          const m = probeTs12.slice(4, 6);
          const d = probeTs12.slice(6, 8);
          const h = probeTs12.slice(8, 10);
          const mn = probeTs12.slice(10, 12);
          const targetTimeEpoch = new Date(`${y}-${m}-${d}T${h}:${mn}:00Z`).getTime();
          const diffHours = (Date.now() - targetTimeEpoch) / (1000 * 60 * 60);

          let exists = false;
          if (diffHours <= 48 && diffHours >= -5) {
            const url = buildNowcastingPngUrl(station, probeTs12, 'reflectividade');
            exists = await probeRadarImageExists(getProxiedRadarUrl(url));
          } else {
            const directUrl = buildNowcastingPngUrl(station, probeTs12, 'reflectividade', true);
            exists = await probeRadarImageExists(getProxiedRadarUrl(directUrl));
            if (!exists) {
              const backupApiUrl = getRadarBackupUrl('chapeco', probeTs12, 'reflectividade');
              try {
                const r = await fetch(backupApiUrl);
                const data = r.ok ? await r.json() : null;
                if (data?.url) exists = true;
              } catch {}
            }
          }

          if (exists) {
            setRadarsWithin300km(radars);
            setRadarStation(station);
            setRadarTimestamps(ts);
            setRadarFrameIdx(probeIdx);
            setRadarLoading(false);
            return;
          }
        }
        setRadarError('Nenhuma imagem de radar encontrada para Chapecó (tentados 6min, 5min/00:00, 5min/00:02).');
        setRadarsWithin300km(radars);
        setRadarLoading(false);
      })();
      return;
    }
    const radarCfgForInterval = preferred
      ? radarConfigs.find((c) => c.stationSlug === ('slug' in preferred ? preferred.slug : `argentina:${preferred.id}`))
      : null;
    const interval = radarCfgForInterval?.updateIntervalMinutes ?? preferred?.updateIntervalMinutes ?? 6;
    const offset = (preferred && 'slug' in preferred) ? (preferred.updateIntervalOffsetMinutes ?? 0) : 0;
    const ts = generateRadarTimestamps(track, interval, offset);
    if (!ts.length) {
      setRadarError('Não foi possível gerar janelas de tempo para o radar.');
      setRadarLoading(false);
      return;
    }
    setRadarsWithin300km(radars);
    setRadarStation(preferred || radars[0]);
    setRadarTimestamps(ts);
    const initialIdx = findClosestRadarFrameIdx(ts, track.time);
    setRadarFrameIdx(initialIdx);

    // Prova proativa para Santiago quando selecionado via centroid
    const st = preferred || radars[0];
    if (st && 'slug' in st && (st.slug === 'santiago' || st.slug === 'morroigreja')) {
      const probeTs12 = ts[initialIdx].slice(0, 12);
      const cptecUrl = buildNowcastingPngUrl(st as CptecRadarStation, probeTs12, 'reflectividade');
      probeRadarImageExists(getProxiedRadarUrl(cptecUrl)).then(setCptecAvailable);
      const area = getRedemetArea(st.slug);
      if (area) {
        fetch(`/api/radar-redemet-find?area=${area}&ts12=${probeTs12}&historical=true`)
          .then(r => r.ok ? r.json() : null)
          .then(d => { if (d?.url) setRedemetAvailable(true); });
      }
    }

    setRadarLoading(false);
  };

  /** Carrega os timestamps do GOES para o rastro (sem chamada de API externa). */
  const loadGoesTimestamps = (track: TornadoTrack) => {
    setGoesLoading(true);
    setGoesError(null);
    setGoesTimestamps([]);
    setGoesFrameIdx(0);
    setGoesPlaying(false);
    const timestamps = generateGoesTimestamps(track);
    if (timestamps.length === 0) {
      setGoesError('Não foi possível gerar timestamps para esta data.');
      setGoesLoading(false);
      return;
    }
    let idx = Math.floor(timestamps.length / 2);
    if (track.time) {
      const [hh, mm] = track.time.split(':').map(Number);
      const center = hh * 60 + mm;
      let bestDiff = Infinity;
      timestamps.forEach((ts, i) => {
        const d = Math.abs(parseInt(ts.slice(8, 10), 10) * 60 + parseInt(ts.slice(10, 12), 10) - center);
        if (d < bestDiff) { bestDiff = d; idx = i; }
      });
    }
    setGoesTimestamps(timestamps);
    setGoesFrameIdx(idx);
    setGoesLoading(false);
  };

  /** Formata timestamp "20231015143010" ou "20260324T005000Z" → "15/10/2023 14:30 UTC" */
  const formatGoesTimestamp = (ts: string) => {
    if (!ts) return '';
    // Remove T e Z para normalizar formato argentina ISO → YYYYMMDDHHMMSS
    const clean = ts.replace('T', '').replace('Z', '');
    return `${clean.slice(6, 8)}/${clean.slice(4, 6)}/${clean.slice(0, 4)} ${clean.slice(8, 10)}:${clean.slice(10, 12)} UTC`;
  };

  const clearMeasure = () => {
    if (measurePolylineRef.current) {
      measurePolylineRef.current.setMap(null);
      measurePolylineRef.current = null;
    }
    setMeasurePoints([]);
    setMeasureDistanceKm(null);
    setMeasureMode(false);
    measureListenersRef.current.forEach((ln) => google.maps.event.removeListener(ln));
    measureListenersRef.current = [];
  };

  const toggleMeasureMode = () => {
    if (measureMode) {
      clearMeasure();
    } else {
      clearMeasure();
      setMeasureMode(true);
    }
  };

  useEffect(() => {
    let isMounted = true;
    const initMap = async () => {
      if (!mapRef.current) return;
      try {
        // Garantir que o objeto google está disponível antes de tentar importar a biblioteca
        if (typeof window === 'undefined') return;
        
        const tryInit = async () => {
          if (!(window as any).google?.maps?.importLibrary) {
            // Se ainda não estiver pronto, espera um pouco
            setTimeout(tryInit, 200);
            return;
          }
          
          try {
            const { Map } = await google.maps.importLibrary('maps');
            if (!isMounted) return;
            const map = new Map(mapRef.current, {
              center: BRAZIL_CENTER,
              zoom: DEFAULT_ZOOM,
              disableDefaultUI: true,
              zoomControl: true,
              mapTypeId: 'roadmap',
              styles: MAP_STYLE_DARK,
            });
            console.log('RastrosTornados: Google Map initialized successfully.');
            mapInstanceRef.current = map;
            setMapReady(true);
          } catch (err) {
            console.error('Map importLibrary error:', err);
          }
        };
        
        console.log('RastrosTornados: Starting map initialization...');
        tryInit();
      } catch (err) {
        console.error('RastrosTornados init map error', err);
      }
    };
    initMap();
    return () => {
      isMounted = false;
    };
  }, [isMounted]);

  useEffect(() => {
    fetchRadarConfigs().then(setRadarConfigs).catch(() => {});
  }, []);

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
    if (!mapInstanceRef.current || !mapReady || mapViewMode !== 'tracks') {
      polygonsRef.current.forEach((p) => p.setMap(null));
      polygonsRef.current = [];
      prevotsPolygonsRef.current.forEach((p) => p.setMap(null));
      prevotsPolygonsRef.current = [];
    polygonFillOpacitiesRef.current = [];
    polygonGlowRef.current.forEach((p) => p.setMap(null));
    polygonGlowRef.current = [];
    return;
    }
    polygonsRef.current.forEach((p) => p.setMap(null));
    polygonsRef.current = [];
    polygonGlowRef.current.forEach((p) => p.setMap(null));
    polygonGlowRef.current = [];
    prevotsPolygonsRef.current.forEach((p) => p.setMap(null));
    prevotsPolygonsRef.current = [];
    polygonFillOpacitiesRef.current = [];

    const map = mapInstanceRef.current;
    const addTrackListeners = (obj: any, track: TornadoTrack) => {
      obj.addListener('click', () => {
        setSelectedTrack(track);
        const key = `viewed_track_${track.id}`;
        if (!sessionStorage.getItem(key)) {
          sessionStorage.setItem(key, '1');
          incrementTrackViews(track.id).catch(console.error);
        }
      });
    };

    const fillOpacityByF: Record<FScale, number> = {
      F0: 0.35, F1: 0.42, F2: 0.48, F3: 0.54, F4: 0.60, F5: 0.68,
    };
    const tracksToShow = selectedTrack ? [selectedTrack] : displayedTracks;
    tracksToShow.forEach((track) => {
      // Prevots: previsão do dia (Admin) ou polígonos do rastro. Ordem: prevots primeiro (por baixo), depois rastro, radar por cima
      const prevots = ((selectedTrack && prevotsForecastForTrack?.polygons?.length)
        ? prevotsForecastForTrack.polygons
        : (track.prevotsPolygons ?? [])).filter((p) => p.level !== 0);
      prevots
        .sort((a, b) => a.level - b.level)
        .forEach((poly) => {
          const ring = poly.coordinates[0];
          if (!ring || ring.length < 3) return;
          const path = ring.map(([lng, lat]) => ({ lat, lng }));
          const color = PREVOTS_LEVEL_COLORS[poly.level];
          const gPoly = new google.maps.Polygon({
            paths: path,
            strokeColor: color,
            strokeWeight: polygonStrokeWeight,
            strokeOpacity: 0.95,
            fillColor: color,
            fillOpacity: prevotsOverlayVisible && polygonFillVisible ? 0.35 : 0,
            map,
            clickable: true,
            visible: prevotsOverlayVisible,
          });
          addTrackListeners(gPoly, track);
          prevotsPolygonsRef.current.push(gPoly);
        });
      if (!track.polygons?.length) return;
      const isSelectedView = !!selectedTrack;
      const maxF = getMaxIntensity(track);

      track.polygons
        .sort((a, b) => F_SCALE_ORDER.indexOf(a.intensity) - F_SCALE_ORDER.indexOf(b.intensity))
        .forEach((poly) => {
          const ring = poly.coordinates[0];
          if (!ring || ring.length < 3) return;
          const path = ring.map(([lng, lat]) => ({ lat, lng }));
          
          // Se for a visão de 'todos os rastros' (nenhum selecionado), 
          // usaremos a cor do maxF para desenhar uma grande mancha sólida
          const color = isSelectedView 
            ? TORNADO_TRACK_COLORS[poly.intensity] 
            : (maxF ? TORNADO_TRACK_COLORS[maxF] : TORNADO_TRACK_COLORS[poly.intensity]);
            
          const origFill = isSelectedView 
            ? fillOpacityByF[poly.intensity] 
            : (maxF ? fillOpacityByF[maxF] : fillOpacityByF[poly.intensity]);
          // Glow: polígono atrás com contorno mais grosso e semi-transparente
          const glowPoly = new google.maps.Polygon({
            paths: path,
            strokeColor: color,
            strokeWeight: polygonStrokeWeight + 5,
            strokeOpacity: 0.4,
            fillColor: color,
            fillOpacity: 0,
            map,
            clickable: false,
            visible: polygonVisible,
          });
          polygonGlowRef.current.push(glowPoly);
          const gPoly = new google.maps.Polygon({
            paths: path,
            strokeColor: color,
            strokeWeight: polygonStrokeWeight,
            strokeOpacity: 0.95,
            fillColor: color,
            fillOpacity: polygonFillVisible ? origFill : 0,
            map,
            clickable: true,
            visible: polygonVisible,
          });
          addTrackListeners(gPoly, track);
          polygonsRef.current.push(gPoly);
          polygonFillOpacitiesRef.current.push(origFill);
        });
    });

    return () => {};
  }, [mapReady, displayedTracks, selectedTrack, mapViewMode, polygonStrokeWeight, prevotsOverlayVisible, prevotsForecastForTrack]);

  // Atualiza visibilidade dos polígonos (F) e glow sem recriá-los
  useEffect(() => {
    polygonsRef.current.forEach((p) => p.setVisible(polygonVisible));
    polygonGlowRef.current.forEach((p) => p.setVisible(polygonVisible));
  }, [polygonVisible]);

  // Atualiza visibilidade e preenchimento dos Prevots sem recriá-los
  useEffect(() => {
    prevotsPolygonsRef.current.forEach((p) => {
      p.setVisible(prevotsOverlayVisible);
      p.setOptions({ fillOpacity: prevotsOverlayVisible && polygonFillVisible ? 0.35 : 0 });
    });
  }, [prevotsOverlayVisible, polygonFillVisible]);

  // Atualiza preenchimento dos polígonos (F) sem recriá-los
  useEffect(() => {
    polygonsRef.current.forEach((p, i) =>
      p.setOptions({ fillOpacity: polygonFillVisible ? (polygonFillOpacitiesRef.current[i] ?? 0.4) : 0 })
    );
  }, [polygonFillVisible]);

  // Heatmap: gradiente suave (amarelo → laranja → vermelho), sem círculos
  useEffect(() => {
    if (!mapInstanceRef.current || !mapReady || mapViewMode !== 'heatmap') {
      if (heatmapOverlayRef.current) {
        heatmapOverlayRef.current.remove();
        heatmapOverlayRef.current = null;
      }
      return;
    }
    const map = mapInstanceRef.current;
    const points: { lat: number; lng: number }[] = [];
    displayedTracks.forEach((track) => {
      getTrackHeatmapPoints(track).forEach((pt) => points.push(pt));
    });
    const heatmapInstance = createSmoothHeatmapOverlay(map, points);
    heatmapOverlayRef.current = heatmapInstance;
    return () => {
      heatmapInstance.remove();
      heatmapOverlayRef.current = null;
    };
  }, [mapReady, mapViewMode, displayedTracks]);

  useEffect(() => {
    if (mapViewMode !== 'heatmap' || !heatmapOverlayRef.current) return;
    const points: { lat: number; lng: number }[] = [];
    displayedTracks.forEach((track) => {
      getTrackHeatmapPoints(track).forEach((pt) => points.push(pt));
    });
    heatmapOverlayRef.current.setPoints(points);
  }, [mapViewMode, displayedTracks]);

  // Ao trocar de rastro selecionado, desliga overlays de imagem e reseta controles
  useEffect(() => {
    setTrackImageOverlayVisible(false);
    setOverlayBeforeVisible(false);
    setOverlayAfterVisible(false);
    setShowBeforeAfterDialog(false);
    setOverlayBeforeOpacity(0.75);
    setOverlayAfterOpacity(0.75);
    setPolygonFillVisible(true);
    setGoesVisible(false);
    setGoesTimestamps([]);
    setGoesFrameIdx(0);
    setGoesPlaying(false);
    setGoesError(null);
    setVisibleSecondaryImageIds([]);
    setSecondaryImageOpacities({});
    setSecondaryImageRotations({});
    setVisibleNumericalModelIds([]);
    setNumericalModelOpacities({});
    setRadarVisible(false);
    setRadarOpacity(0.75);
    setRadarError(null);
    setRadarTimestamps([]);
    setRadarFrameIdx(0);
    setRadarStation(null);
    setRadarsWithin300km([]);
    setRadarLoading(false);
    setRadarPlaying(false);
    Object.values(secondaryOverlaysRef.current).forEach(ov => ov.setMap(null));
    secondaryOverlaysRef.current = {};
    Object.values(numericalOverlaysRef.current).forEach(ov => ov.setMap(null));
    numericalOverlaysRef.current = {};
    if (goesOverlayRef.current) {
      (goesOverlayRef.current as any).setMap?.(null);
      goesOverlayRef.current = null;
    }
    if (radarOverlayRef.current) {
      (radarOverlayRef.current as any).setMap?.(null);
      radarOverlayRef.current = null;
    }
    if (goesPlayIntervalRef.current) {
      clearInterval(goesPlayIntervalRef.current);
      goesPlayIntervalRef.current = null;
    }
    if (radarPlayIntervalRef.current) {
      clearInterval(radarPlayIntervalRef.current);
      radarPlayIntervalRef.current = null;
    }
  }, [selectedTrack?.id]);

  // Helpers para bounds e overlay de imagem (GeoTIFF/foto) — compatível com URLs Firebase
  const makeBounds = (b: { ne: { lat: number; lng: number }; sw: { lat: number; lng: number } }) => {
    const south = Math.min(b.sw.lat, b.ne.lat);
    const north = Math.max(b.sw.lat, b.ne.lat);
    const west = Math.min(b.sw.lng, b.ne.lng);
    const east = Math.max(b.sw.lng, b.ne.lng);
    return new google.maps.LatLngBounds(
      { lat: south, lng: west },
      { lat: north, lng: east }
    );
  };

  const createImageOverlayView = (
    url: string,
    bounds: any,
    map: any,
    opacity: number,
    rotation: number = 0,
    chromaKey: number = 0,
    crop: { top: number; bottom: number; left: number; right: number } = { top: 0, bottom: 0, left: 0, right: 0 }
  ) => {
    const ov = new google.maps.OverlayView();
    let divEl: HTMLDivElement | null = null;
    ov.onAdd = () => {
      divEl = document.createElement('div');
      divEl.style.cssText = 'position:absolute;pointer-events:none;border:none;overflow:hidden;';
      const img = document.createElement('img');
      img.src = url;
      img.loading = 'eager';
      (img as any).fetchPriority = 'high';

      let mixBlend = '';
      if (chromaKey > 0) mixBlend = 'mix-blend-mode: multiply;';

      let clipPath = '';
      if (crop.top > 0 || crop.bottom > 0 || crop.left > 0 || crop.right > 0) {
        clipPath = `clip-path: inset(${crop.top}% ${crop.right}% ${crop.bottom}% ${crop.left}%);`;
      }

      img.style.cssText = `width:100%;height:100%;opacity:${opacity};object-fit:fill;image-rendering:auto;image-rendering:smooth;transform:rotate(${rotation}deg);transform-origin:center;${mixBlend}${clipPath}`;
      divEl.appendChild(img);
      ov.getPanes()?.overlayLayer?.appendChild(divEl);
    };
    ov.draw = () => {
      if (!divEl) return;
      const proj = ov.getProjection();
      if (!proj) return;
      const sw = proj.fromLatLngToDivPixel(bounds.getSouthWest());
      const ne = proj.fromLatLngToDivPixel(bounds.getNorthEast());
      if (!sw || !ne) return;
      divEl.style.left   = Math.min(sw.x, ne.x) + 'px';
      divEl.style.top    = Math.min(sw.y, ne.y) + 'px';
      divEl.style.width  = Math.abs(ne.x - sw.x) + 'px';
      divEl.style.height = Math.abs(ne.y - sw.y) + 'px';
    };
    ov.onRemove = () => {
      divEl?.parentNode?.removeChild(divEl);
      divEl = null;
    };
    ov.setMap(map);
    return ov;
  };

  // Overlays: imagem do rastro (trackImage) + Antes/Depois (GeoTIFF com bounds)
  useEffect(() => {
    if (!selectedTrack || !mapInstanceRef.current || !google.maps?.OverlayView) {
      if (trackImageGroundOverlayRef.current) {
        trackImageGroundOverlayRef.current.setMap(null);
        trackImageGroundOverlayRef.current = null;
      }
      if (overlayBeforeRef.current) {
        (overlayBeforeRef.current as any).setMap?.(null);
        overlayBeforeRef.current = null;
      }
      if (overlayAfterRef.current) {
        (overlayAfterRef.current as any).setMap?.(null);
        overlayAfterRef.current = null;
      }
      Object.values(secondaryOverlaysRef.current).forEach(ov => (ov as any).setMap?.(null));
      secondaryOverlaysRef.current = {};
      Object.values(numericalOverlaysRef.current).forEach(ov => (ov as any).setMap?.(null));
      numericalOverlaysRef.current = {};
      setTrackImageOverlayVisible(false);
      setOverlayBeforeVisible(false);
      setOverlayAfterVisible(false);
      setVisibleSecondaryImageIds([]);
      setVisibleNumericalModelIds([]);
      return;
    }
    const map = mapInstanceRef.current;

    if (trackImageGroundOverlayRef.current) {
      trackImageGroundOverlayRef.current.setMap(null);
      trackImageGroundOverlayRef.current = null;
    }
    if (overlayBeforeRef.current) {
      (overlayBeforeRef.current as any).setMap?.(null);
      overlayBeforeRef.current = null;
    }
    if (overlayAfterRef.current) {
      (overlayAfterRef.current as any).setMap?.(null);
      overlayAfterRef.current = null;
    }
    Object.values(secondaryOverlaysRef.current).forEach(ov => (ov as any).setMap?.(null));
    secondaryOverlaysRef.current = {};
    Object.values(numericalOverlaysRef.current).forEach(ov => (ov as any).setMap?.(null));
    numericalOverlaysRef.current = {};

    const beforeUrl = selectedTrack.beforeImage?.trim();
    const afterUrl = selectedTrack.afterImage?.trim();
    
    // Bounds ativos: se estiver mapeando, usa os temporários; senão, os do rastro
    const activeBeforeBounds = (imageMappingMode === 'before' && tempBeforeImageBounds) 
      ? tempBeforeImageBounds 
      : selectedTrack.beforeImageBounds;
    const activeAfterBounds = (imageMappingMode === 'after' && tempAfterImageBounds) 
      ? tempAfterImageBounds 
      : selectedTrack.afterImageBounds;

    const hasBeforeBounds = activeBeforeBounds && beforeUrl;
    const hasAfterBounds = activeAfterBounds && afterUrl;

    if (trackImageOverlayVisible && selectedTrack.trackImage?.trim() && selectedTrack.trackImageBounds) {
      const bounds = makeBounds(selectedTrack.trackImageBounds);
      const overlay = createImageOverlayView(selectedTrack.trackImage.trim(), bounds, map, 0.75);
      trackImageGroundOverlayRef.current = overlay;
      map.fitBounds(bounds, { top: 60, right: 60, bottom: 60, left: 60 });
    }
    if (overlayBeforeVisible && hasBeforeBounds) {
      const bounds = makeBounds(activeBeforeBounds!);
      const overlay = createImageOverlayView(beforeUrl!, bounds, map, overlayBeforeOpacity);
      overlayBeforeRef.current = overlay;
      // Somente fitBounds inicial se não estiver mapeando
      if (imageMappingMode === 'none') {
        map.fitBounds(bounds, { top: 80, right: 80, bottom: 80, left: 80 });
      }
    }
    if (overlayAfterVisible && hasAfterBounds) {
      const bounds = makeBounds(activeAfterBounds!);
      const overlay = createImageOverlayView(afterUrl!, bounds, map, overlayAfterOpacity);
      overlayAfterRef.current = overlay;
      // Somente fitBounds inicial se não estiver mapeando
      if (imageMappingMode === 'none') {
        map.fitBounds(bounds, { top: 80, right: 80, bottom: 80, left: 80 });
      }
    }

    // Imagens secundárias
    (selectedTrack.secondaryAfterImages || []).forEach(img => {
      if (visibleSecondaryImageIds.includes(img.id) && img.url && img.bounds) {
        const bounds = makeBounds(img.bounds);
        const opacity = secondaryImageOpacities[img.id] ?? img.opacity ?? 0.75;
        const rotation = secondaryImageRotations[img.id] ?? img.rotation ?? 0;
        const overlay = createImageOverlayView(img.url, bounds, map, opacity, rotation);
        secondaryOverlaysRef.current[img.id] = overlay;
      }
    });

    // Modelos Numéricos
    (selectedTrack.numericalModels || []).forEach(img => {
      if (visibleNumericalModelIds.includes(img.id) && img.url && img.bounds) {
        const bounds = makeBounds(img.bounds);
        const opacity = numericalModelOpacities[img.id] ?? img.opacity ?? 0.75;
        const rotation = img.rotation ?? 0;
        const chroma = img.chromaKey ?? 0;
        const overlay = createImageOverlayView(img.url, bounds, map, opacity, rotation, chroma, {
          top: img.cropTop ?? 0,
          bottom: img.cropBottom ?? 0,
          left: img.cropLeft ?? 0,
          right: img.cropRight ?? 0
        });
        numericalOverlaysRef.current[img.id] = overlay;
      }
    });

    return () => {
      if (trackImageGroundOverlayRef.current) {
        (trackImageGroundOverlayRef.current as any).setMap?.(null);
        trackImageGroundOverlayRef.current = null;
      }
      if (overlayBeforeRef.current) {
        (overlayBeforeRef.current as any).setMap?.(null);
        overlayBeforeRef.current = null;
      }
      if (overlayAfterRef.current) {
        (overlayAfterRef.current as any).setMap?.(null);
        overlayAfterRef.current = null;
      }
      Object.values(secondaryOverlaysRef.current).forEach(ov => (ov as any).setMap?.(null));
      secondaryOverlaysRef.current = {};
      Object.values(numericalOverlaysRef.current).forEach(ov => (ov as any).setMap?.(null));
      numericalOverlaysRef.current = {};
    };
  }, [selectedTrack, trackImageOverlayVisible, overlayBeforeVisible, overlayAfterVisible, overlayBeforeOpacity, overlayAfterOpacity, visibleSecondaryImageIds, secondaryImageOpacities, secondaryImageRotations, visibleNumericalModelIds, numericalModelOpacities, imageMappingMode, tempBeforeImageBounds, tempAfterImageBounds]);

  // Gerenciamento do Retângulo de Mapeamento de Imagem (Main Page - Admin Only)
  useEffect(() => {
    if (!mapInstanceRef.current || !mapReady || imageMappingMode === 'none') {
      if (imageRectRef.current) {
        imageRectRef.current.setMap(null);
        imageRectRef.current = null;
      }
      return;
    }

    const map = mapInstanceRef.current;
    const isBefore = imageMappingMode === 'before';
    const currentBounds = isBefore 
      ? (tempBeforeImageBounds || selectedTrack?.beforeImageBounds) 
      : (tempAfterImageBounds || selectedTrack?.afterImageBounds);

    let initialBounds;
    if (currentBounds) {
      initialBounds = {
        north: Math.max(currentBounds.ne.lat, currentBounds.sw.lat),
        south: Math.min(currentBounds.ne.lat, currentBounds.sw.lat),
        east: Math.max(currentBounds.ne.lng, currentBounds.sw.lng),
        west: Math.min(currentBounds.ne.lng, currentBounds.sw.lng),
      };
    } else {
      const center = map.getCenter();
      const lat = center.lat();
      const lng = center.lng();
      const offset = 0.01;
      initialBounds = {
        north: lat + offset, south: lat - offset,
        east: lng + offset, west: lng - offset,
      };
    }

    if (imageRectRef.current) imageRectRef.current.setMap(null);

    const rect = new google.maps.Rectangle({
      bounds: initialBounds,
      editable: true,
      draggable: true,
      map: map,
      strokeColor: isBefore ? '#fbbf24' : '#10b981',
      strokeOpacity: 0.8,
      strokeWeight: 2,
      fillColor: isBefore ? '#fbbf24' : '#10b981',
      fillOpacity: 0.1,
      zIndex: 3000,
    });

    imageRectRef.current = rect;

    const updateTempBounds = () => {
      const b = rect.getBounds();
      if (!b) return;
      const ne = b.getNorthEast();
      const sw = b.getSouthWest();
      const newBounds = {
        ne: { lat: ne.lat(), lng: ne.lng() },
        sw: { lat: sw.lat(), lng: sw.lng() },
      };
      if (isBefore) setTempBeforeImageBounds(newBounds);
      else setTempAfterImageBounds(newBounds);
    };

    rect.addListener('bounds_changed', updateTempBounds);
    rect.addListener('dragend', updateTempBounds);

    map.fitBounds(initialBounds, { top: 100, right: 100, bottom: 100, left: 100 });

    return () => {
      if (imageRectRef.current) {
        imageRectRef.current.setMap(null);
        imageRectRef.current = null;
      }
    };
  }, [imageMappingMode, mapReady, selectedTrack?.id]);

  const handleSaveImageBounds = async () => {
    if (!selectedTrack || !user || imageMappingMode === 'none') return;
    setIsSavingImageBounds(true);
    try {
      const isBefore = imageMappingMode === 'before';
      const updatedBounds = isBefore ? tempBeforeImageBounds : tempAfterImageBounds;
      
      if (!updatedBounds) {
        setIsSavingImageBounds(false);
        return;
      }

      const updatedTrack: TornadoTrack = {
        ...selectedTrack,
        beforeImageBounds: isBefore ? updatedBounds : selectedTrack.beforeImageBounds,
        afterImageBounds: !isBefore ? updatedBounds : selectedTrack.afterImageBounds,
      };

      await saveTornadoTrack(updatedTrack, user.uid);
      
      setSelectedTrack(updatedTrack);
      setTracks(prev => prev.map(t => t.id === updatedTrack.id ? updatedTrack : t));
      setImageMappingMode('none');
      addToast('Limites da imagem salvos com sucesso.', 'success');
    } catch (e: any) {
      addToast(`Erro ao salvar limites: ${e.message}`, 'error');
    } finally {
      setIsSavingImageBounds(false);
    }
  };

  const toggleSecondaryImage = (id: string) => {
    setVisibleSecondaryImageIds(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id);
      return [...prev, id];
    });
  };

  const zoomToSecondaryImage = (img: SecondaryImage) => {
    if (!mapInstanceRef.current || !img.bounds) return;
    const bounds = makeBounds(img.bounds);
    mapInstanceRef.current.fitBounds(bounds, { top: 80, right: 80, bottom: 80, left: 80 });
    if (!visibleSecondaryImageIds.includes(img.id)) {
      toggleSecondaryImage(img.id);
    }
  };

  const toggleNumericalModel = (id: string) => {
    setVisibleNumericalModelIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  // GOES-16 overlay: desenha o frame atual recortado na área do tornado (NASA GIBS)
  useEffect(() => {
    if (goesOverlayRef.current) {
      (goesOverlayRef.current as any).setMap?.(null);
      goesOverlayRef.current = null;
    }
    if (!goesVisible || !goesTimestamps.length || !mapInstanceRef.current || !selectedTrack) return;
    const map = mapInstanceRef.current;
    const ts = goesTimestamps[goesFrameIdx];
    if (!ts) return;

    const bounds = getGoesBounds(selectedTrack);
    if (!bounds) return;

    const latLngBounds = new google.maps.LatLngBounds(
      { lat: bounds.south, lng: bounds.west },
      { lat: bounds.north, lng: bounds.east }
    );

    // Apenas no primeiro frame (goesFrameIdx inicial), dá zoom na área do tornado
    if (goesFrameIdx === 0 || goesTimestamps.indexOf(ts) === 0) {
      map.fitBounds(latLngBounds, { top: 60, right: 60, bottom: 60, left: 60 });
    }

    // NASA GIBS WMS — retorna imagem recortada exatamente nos bounds do tornado
    const url = goesWmsUrl(ts, bounds);
    const ov = new google.maps.OverlayView();
    let divEl: HTMLDivElement | null = null;
    ov.onAdd = () => {
      divEl = document.createElement('div');
      divEl.style.cssText = 'position:absolute;pointer-events:none;';
      const img = document.createElement('img');
      img.src = url;
      img.className = 'pixelated-layer';
      img.style.cssText = `width:100%;height:100%;opacity:${goesOpacity};object-fit:fill;`;
      img.onerror = () => { img.style.display = 'none'; };
      divEl.appendChild(img);
      ov.getPanes()?.overlayLayer?.appendChild(divEl);
    };
    ov.draw = () => {
      if (!divEl) return;
      const proj = ov.getProjection();
      if (!proj) return;
      const sw = proj.fromLatLngToDivPixel(latLngBounds.getSouthWest());
      const ne = proj.fromLatLngToDivPixel(latLngBounds.getNorthEast());
      if (!sw || !ne) return;
      divEl.style.left   = Math.min(sw.x, ne.x) + 'px';
      divEl.style.top    = Math.min(sw.y, ne.y) + 'px';
      divEl.style.width  = Math.abs(ne.x - sw.x) + 'px';
      divEl.style.height = Math.abs(ne.y - sw.y) + 'px';
    };
    ov.onRemove = () => { divEl?.parentNode?.removeChild(divEl); divEl = null; };
    ov.setMap(map);
    goesOverlayRef.current = ov;

    return () => {
      (ov as any).setMap?.(null);
      goesOverlayRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goesVisible, goesTimestamps, goesFrameIdx, goesOpacity]);

  // Radar CPTEC: WMS | PNG Nowcasting (com bounds do Admin) | SIGMA WMS
  useEffect(() => {
    if (radarOverlayRef.current) {
      (radarOverlayRef.current as any).setMap?.(null);
      radarOverlayRef.current = null;
    }
    if (!radarVisible || !mapInstanceRef.current || !selectedTrack || !radarTimestamps.length) return;

    const useWms = !!selectedTrack.radarWmsUrl?.trim();
    const isArgentinaRadar = radarStation && !('slug' in radarStation);
    let radarCfgSlug = radarStation
      ? (isArgentinaRadar ? `argentina:${radarStation.id}` : (radarStation as CptecRadarStation).slug)
      : null;
    if ((radarCfgSlug === 'santiago' || radarCfgSlug === 'morroigreja') && radarSourceMode === 'hd') {
      radarCfgSlug = `${radarCfgSlug}-redemet`;
    }
    const radarCfg = radarCfgSlug
      ? radarConfigs.find((c) => c.id === radarCfgSlug || c.stationSlug === radarCfgSlug)
      : null;
    /** Para radares PPI CPTEC (Chapecó, Santiago): sempre usar buildNowcastingPngUrl. */
    const useNowcastingPng = radarStation && !isArgentinaRadar && (radarStation as CptecRadarStation).product === 'ppi';
    const usePng = radarStation && !isArgentinaRadar && radarCfg?.urlTemplate && !useWms && (radarStation as CptecRadarStation).product !== 'ppi';
    const useSigma = radarStation && !isArgentinaRadar && !usePng && !useNowcastingPng && !useWms;
    const useArgentinaPng = isArgentinaRadar && radarStation;
    if (!useWms && !usePng && !useNowcastingPng && !useSigma && !useArgentinaPng) return;

    const map = mapInstanceRef.current;
    let bounds: { north: number; south: number; east: number; west: number };
    let url: string;

    const ts = radarTimestamps[radarFrameIdx];
    if (!ts) return;

    /** Bounds centrados no radar (lat/lng + rangeKm), não no rastro. */
    const getRadarBounds = () => {
      // Prioridade 1: Modo de Edição (Realtime)
      if (isRadarEditMode) {
        if (useEditCustomBounds && editRadarCustomBounds) {
          return editRadarCustomBounds;
        }
        const b = calculateRadarBounds(editRadarLat, editRadarLng, editRadarRangeKm);
        return { north: b.ne.lat, south: b.sw.lat, east: b.ne.lng, west: b.sw.lng };
      }

      // Prioridade 2: Overrides salvos no rastro
      const rBounds = currentOverrides.customBounds ?? selectedTrack.radarCustomBounds;
      if (rBounds) {
        return rBounds;
      }
      const rLat = currentOverrides.lat ?? selectedTrack.radarLat;
      const rLng = currentOverrides.lng ?? selectedTrack.radarLng;
      const rRange = currentOverrides.rangeKm ?? selectedTrack.radarRangeKm ?? radarStation?.rangeKm ?? 250;
      if (rLat !== undefined && rLng !== undefined) {
        const b = calculateRadarBounds(rLat, rLng, rRange);
        return { north: b.ne.lat, south: b.sw.lat, east: b.ne.lng, west: b.sw.lng };
      }

      if (radarStation && radarCfg) {
        if (radarCfg.customBounds) {
          return { north: radarCfg.customBounds.north, south: radarCfg.customBounds.south, east: radarCfg.customBounds.east, west: radarCfg.customBounds.west };
        }
        if (radarCfg.lat !== 0 || radarCfg.lng !== 0) {
          const range = radarCfg.rangeKm ?? radarStation.rangeKm ?? 250;
          const b = calculateRadarBounds(radarCfg.lat, radarCfg.lng, range);
          return { north: b.ne.lat, south: b.sw.lat, east: b.ne.lng, west: b.sw.lng };
        }
      }
      if (radarStation && !isArgentinaRadar) {
        const b = getRadarImageBounds(radarStation as CptecRadarStation);
        return { north: b.north, south: b.south, east: b.east, west: b.west };
      }
      if (radarStation && isArgentinaRadar) {
        const b = getArgentinaRadarBounds(radarStation as ArgentinaRadarStation);
        return { north: b.north, south: b.south, east: b.east, west: b.west };
      }
      return null;
    };

    type UrlWithSource = { url: string; source: 'cptec' | 'redemet' };
    let urlsToTry: UrlWithSource[] = [];
    let redemetFindPromise: Promise<string | null> | null = null;
    let hasRedemetFb = false;

    if (useArgentinaPng && radarStation) {
      const argStation = radarStation as ArgentinaRadarStation;
      const tsArg = ts;
      url = buildArgentinaRadarPngUrl(argStation, tsArg, radarProductType);
      bounds = getArgentinaRadarBounds(argStation);
      urlsToTry = [{ url: getProxiedRadarUrl(url), source: 'cptec' }];
    } else if (useNowcastingPng && radarStation) {
      const cptecStation = radarStation as CptecRadarStation;
      const ts12 = ts.slice(0, 12);
      const radarStationSlug = cptecStation.slug;

      // Always try the proxied CPTEC URL first
      const rawUrl = buildNowcastingPngUrl(cptecStation, ts12, radarProductType);
      const [proxyUrl, directUrl] = getRadarUrlsWithFallback(rawUrl);

      if (radarStationSlug === 'chapeco') {
        // Chapecó: 1º URL direta do servidor CPTEC (via proxy), 2º URL direta sem proxy, 3º API de metadados
        const directCptecUrl = buildNowcastingPngUrl(cptecStation, ts12, radarProductType, true);
        const [directProxy] = getRadarUrlsWithFallback(directCptecUrl);
        urlsToTry.push({ url: directProxy, source: 'cptec' });
        urlsToTry.push({ url: directCptecUrl, source: 'cptec' });
        
        // APENAS adiciona a API se não for histórico > 48h!
        const y = ts12.slice(0, 4);
        const m = ts12.slice(4, 6);
        const d = ts12.slice(6, 8);
        const h = ts12.slice(8, 10);
        const mn = ts12.slice(10, 12);
        const targetTimeEpoch = new Date(`${y}-${m}-${d}T${h}:${mn}:00Z`).getTime();
        const diffHours = (Date.now() - targetTimeEpoch) / (1000 * 60 * 60);

        if (diffHours <= 48 && diffHours >= -5) {
          urlsToTry.push({ url: proxyUrl, source: 'cptec' });
        }
      } else {
        urlsToTry.push({ url: proxyUrl, source: 'cptec' });
        if (directUrl && directUrl !== proxyUrl) {
          urlsToTry.push({ url: directUrl, source: 'cptec' });
        }
      }

      hasRedemetFb = hasRedemetFallback(radarStationSlug);
      bounds = getRadarBounds() ?? getRadarImageBounds(cptecStation);
      if (hasRedemetFb) {
        const area = getRedemetArea(radarStationSlug)!;
        redemetFindPromise = fetch(`/api/radar-redemet-find?area=${area}&ts12=${ts12}&historical=true`)
          .then(r => r.ok ? r.json() : null)
          .then(d => {
            const u = d?.url ?? null;
            if (u) setRedemetAvailable(true);
            return u;
          })
          .catch(() => null);
      }
    } else if (usePng && radarCfg) {
      const ts12 = ts.slice(0, 12);
      url = buildRadarPngUrl(radarCfg.urlTemplate, ts12);
      const cptecSt = radarStation && !isArgentinaRadar ? radarStation as CptecRadarStation : null;
      hasRedemetFb = !!cptecSt && hasRedemetFallback(cptecSt.slug);
      const isHdRadar = (cptecSt?.slug === 'santiago' || cptecSt?.slug === 'morroigreja');
      const hdSourceActive = radarSourceMode === 'hd' && isHdRadar;
      bounds = {
        north: radarCfg.bounds.ne.lat,
        south: radarCfg.bounds.sw.lat,
        east: radarCfg.bounds.ne.lng,
        west: radarCfg.bounds.sw.lng,
      };
      urlsToTry = radarSourceMode === 'hd' ? [] : [{ url: getProxiedRadarUrl(url), source: 'cptec' }];
      if (hasRedemetFb && cptecSt) {
        const area = getRedemetArea(cptecSt.slug)!;
        redemetFindPromise = fetch(`/api/radar-redemet-find?area=${area}&ts12=${ts12}&historical=true`)
          .then(r => r.ok ? r.json() : null)
          .then(d => {
            const u = d?.url ?? null;
            if (u) setRedemetAvailable(true);
            return u;
          })
          .catch(() => null);
      }
    } else if (useWms && selectedTrack.radarWmsUrl) {
      bounds = getRadarBounds() ?? getGoesBounds(selectedTrack)!;
      if (!bounds) {
        setRadarError('Defina "Radar preferido" no Editor para centralizar a imagem no radar.');
        return;
      }
      url = getRadarFrameUrl(selectedTrack.radarWmsUrl, ts, bounds);
      if (!url) {
        setRadarError('URL WMS inválida.');
        return;
      }
      urlsToTry = [{ url, source: 'cptec' }];
    } else if (useSigma && radarStation) {
      bounds = getRadarBounds()!;
      if (!bounds) {
        setRadarError('Não foi possível calcular bounds do radar.');
        return;
      }
      url = buildSigmaWmsUrl(radarStation, ts, bounds);
      urlsToTry = [{ url, source: 'cptec' }];
    } else {
      return;
    }

    setRadarError(null);
    setRadarImageSource(null);
    const latLngBounds = new google.maps.LatLngBounds(
      { lat: bounds.south, lng: bounds.west },
      { lat: bounds.north, lng: bounds.east }
    );

    const ov = new google.maps.OverlayView();
    let divEl: HTMLDivElement | null = null;
    ov.onAdd = () => {
      divEl = document.createElement('div');
      divEl.style.cssText = 'position:absolute;pointer-events:none;display:none;';
      const img = document.createElement('img');
      const currentOpacity = isRadarEditMode ? editRadarOpacity : (currentOverrides.opacity ?? selectedTrack.radarOpacity ?? radarOpacity);
      const currentRotation = isRadarEditMode ? editRadarRotation : (currentOverrides.rotation ?? selectedTrack.radarRotation ?? 0);
      
      img.className = 'pixelated-layer';
      img.style.cssText = `width:100%;height:100%;opacity:${currentOpacity};object-fit:fill;`;
      if (currentRotation !== 0) {
        img.style.transform = `rotate(${currentRotation}deg)`;
      }
      let tryIndex = 0;
      let redemetAttempted = false;
      let backupAttempted = false;
      const showError = () => {
        img.style.display = 'none';
        if (divEl) divEl.style.display = 'none';
        let errMsg = 'Falha ao carregar imagem.';
        if (useWms) errMsg = 'Falha ao carregar radar (WMS).';
        else if (useSigma) errMsg = 'Falha ao carregar radar (SIGMA).';
        else if (useNowcastingPng || usePng) {
          if (radarStation && 'slug' in radarStation && ((radarStation as any).slug === 'santiago' || (radarStation as any).slug === 'morroigreja')) {
            const stName = (radarStation as any).slug === 'santiago' ? 'Santiago' : 'Morro da Igreja';
            errMsg = `Falha ao carregar radar de ${stName} (${radarSourceMode === 'hd' ? 'HD/Redemet' : 'Super Res/CPTEC'}).`;
            if (cptecAvailable && redemetAvailable) {
              errMsg = `Falha ao carregar radar de ${stName} (ambas as fontes CPTEC/Redemet falharam).`;
            }
          } else {
            errMsg = 'Falha ao carregar imagem PNG (CPTEC/REDEMET).';
          }
        }
        setRadarError(errMsg);
        setRadarImageSource(null);
      };
      const showImage = () => {
        if (divEl) divEl.style.display = '';
      };
      const tryNext = () => {
        if (tryIndex < urlsToTry.length) {
          img.src = urlsToTry[tryIndex].url;
          tryIndex += 1;
          return;
        }
        if (!redemetAttempted && redemetFindPromise) {
          redemetAttempted = true;
          redemetFindPromise.then(redemetUrl => {
            if (!redemetUrl) { tryNext(); return; }
            img.onerror = () => tryNext();
            img.onload = () => {
              setRadarError(null);
              setRadarImageSource('redemet');
              setRedemetAvailable(true);
              showImage();
            };
            img.src = getProxiedRadarUrl(redemetUrl);
          });
          return;
        }
        if (!backupAttempted) {
          backupAttempted = true;
          if (radarCfgSlug) {
            const backupApiUrl = getRadarBackupUrl(radarCfgSlug, ts.slice(0, 12), radarProductType);
            fetch(backupApiUrl)
              .then(r => r.ok ? r.json() : null)
              .then(data => {
                if (data?.url) {
                  img.onerror = () => showError();
                  img.onload = () => {
                    setRadarError(null);
                    setRadarImageSource('backup');
                    showImage();
                  };
                  img.src = data.url;
                } else {
                  showError();
                }
              })
              .catch(() => showError());
            return;
          }
        }
        showError();
      };
      img.onerror = tryNext;
      img.onload = () => {
        setRadarError(null);
        const src = urlsToTry[tryIndex - 1]?.source ?? 'cptec';
        setRadarImageSource(src);
        if (src === 'cptec') setCptecAvailable(true);

        const currentChromaKey = isRadarEditMode ? editRadarChromaKey : (currentOverrides.chromaKey ?? selectedTrack.radarChromaKey ?? 0);
        const currentCrop = isRadarEditMode ? {
          top: editRadarCropTop,
          bottom: editRadarCropBottom,
          left: editRadarCropLeft,
          right: editRadarCropRight
        } : {
          top: currentOverrides.cropTop ?? selectedTrack.radarCropTop ?? 0,
          bottom: currentOverrides.cropBottom ?? selectedTrack.radarCropBottom ?? 0,
          left: currentOverrides.cropLeft ?? selectedTrack.radarCropLeft ?? 0,
          right: currentOverrides.cropRight ?? selectedTrack.radarCropRight ?? 0
        };

        const applyFilters = async () => {
          if (currentChromaKey > 0 || currentCrop.top > 0 || currentCrop.bottom > 0 || currentCrop.left > 0 || currentCrop.right > 0) {
            try {
              const filtered = await filterRadarImageFromUrl(img.src, currentChromaKey, currentCrop);
              if (filtered) {
                img.onload = () => showImage();
                img.src = filtered;
                return true;
              }
            } catch (e) {
              console.error('Filter error', e);
            }
          }
          return false;
        };

        const currentTs = radarTimestamps[radarFrameIdx];
        if (currentTs) {
          let radarSlug = radarStation && !isArgentinaRadar
            ? (radarStation as CptecRadarStation).slug
            : radarStation ? `argentina_${(radarStation as ArgentinaRadarStation).id}` : null;
          if (radarSlug && src === 'redemet') radarSlug = `${radarSlug}-redemet`;
          if (radarSlug) cacheRadarImage(img.src, radarSlug, currentTs.slice(0, 12), radarProductType);
        }

        if (radarProductType === 'velocidade' && superResEnabled && radarStation && !isArgentinaRadar) {
          const cptecSt = radarStation as CptecRadarStation;
          if (currentTs) {
            const refTs12 = currentTs.slice(0, 12);
            const refUrl = buildNowcastingPngUrl(cptecSt, refTs12, 'reflectividade');
            const refProxy = getProxiedRadarUrl(refUrl);
            filterDopplerSuperRes(img.src, refProxy).then((filteredSrc) => {
              if (filteredSrc) {
                img.onload = () => showImage();
                img.onerror = () => showImage();
                img.src = filteredSrc;
              } else {
                applyFilters().then(applied => { if (!applied) showImage(); });
              }
            }).catch(() => {
              applyFilters().then(applied => { if (!applied) showImage(); });
            });
            return;
          }
        }
        
        applyFilters().then(applied => {
          if (!applied) showImage();
        });
      };
      divEl.appendChild(img);
      ov.getPanes()?.overlayLayer?.appendChild(divEl);
      tryNext();
    };
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
    ov.onRemove = () => { divEl?.parentNode?.removeChild(divEl); divEl = null; };
    ov.setMap(map);
    radarOverlayRef.current = ov;

    return () => {
      (ov as any).setMap?.(null);
      radarOverlayRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [radarVisible, radarTimestamps, radarFrameIdx, radarOpacity, radarStation, radarSourceMode, radarProductType, superResEnabled, isRadarEditMode, editRadarLat, editRadarLng, editRadarRangeKm, editRadarRotation, editRadarOpacity, editRadarChromaKey, editRadarCropTop, editRadarCropBottom, editRadarCropLeft, editRadarCropRight, editRadarCustomBounds, useEditCustomBounds, selectedTrack, radarConfigs]);

  // Overlay de radar na timeline (quando período ≤ 3 dias)
  useEffect(() => {
    radarTimelineOverlaysRef.current.forEach((ov) => { (ov as any)?.setMap?.(null); });
    radarTimelineOverlaysRef.current = [];

    if (!showRadarTimelineSlider || !mapInstanceRef.current) return;
    const nominalTs = radarTimelineTimestamps[radarTimelineIndex];
    if (!nominalTs) return;

    const map = mapInstanceRef.current;
    const allStations = radarTimelineMode === 'mosaico' ? intervalRadars : (timelineActiveStation ? [timelineActiveStation] : []);
    const stations = allStations.filter(s => timelineSelectedRadars.has(s.slug));

    stations.forEach(async (station) => {
      const ts12 = radarTimelineMode === 'mosaico'
        ? getNearestRadarTimestamp(nominalTs, station)
        : nominalTs;
      
      const rawUrl = buildNowcastingPngUrl(station, ts12, timelineProductType);
      const [proxyUrl] = getRadarUrlsWithFallback(rawUrl);
      const hasRedemetFb = hasRedemetFallback(station.slug);
      
      let urlsToTry: { url: string, source: 'cptec' | 'redemet' | 'backup' }[] = [];

      if (station.slug === 'chapeco') {
        // Chapecó: 1º URL direta do CPTEC (via proxy), 2º URL direta sem proxy, 3º API
        const directUrl = buildNowcastingPngUrl(station, ts12, timelineProductType, true);
        const [directProxy] = getRadarUrlsWithFallback(directUrl);
        urlsToTry.push({ url: directProxy, source: 'cptec' });
        urlsToTry.push({ url: directUrl, source: 'cptec' });
        urlsToTry.push({ url: proxyUrl, source: 'cptec' });
      } else {
        urlsToTry.push({ url: proxyUrl, source: 'cptec' });
      }

      let usedSource: 'cptec' | 'redemet' | 'backup' = 'cptec';

      const checkRedemet = async () => {
        if (!hasRedemetFb) return null;
        const area = getRedemetArea(station.slug);
        const res = await fetch(`/api/radar-redemet-find?area=${area}&ts12=${ts12}&historical=true`).then(r => r.json()).catch(() => null);
        let foundTs = ts12;
        if (res?.url) {
          const m = res.url.match(/data=(\d{12})/);
          if (m) foundTs = m[1];
        }
        return res?.url ? { url: getProxiedRadarUrl(res.url), ts: foundTs } : null;
      };

      const checkBackup = async () => {
        const backupApiUrl = getRadarBackupUrl(station.slug, ts12, timelineProductType);
        const data = await fetch(backupApiUrl).then(r => r.ok ? r.json() : null).catch(() => null);
        let foundTs = ts12;
        if (data?.url && data.basename) {
          foundTs = ts12.slice(0, 6) + data.basename; // Concatena YYYYMM + DDHHMM
        }
        return data?.url ? { url: data.url, ts: foundTs } : null;
      };

      let finalUrl = '';
      let finalTs = ts12;
      
      // 1. Tenta URLs do CPTEC (Proxy e Direto)
      for (const entry of urlsToTry) {
        const ok = await probeRadarImageExists(entry.url);
        if (ok) {
          finalUrl = entry.url;
          finalTs = ts12;
          usedSource = 'cptec';
          break;
        }
      }

      // 2. Fallback para Redemet
      if (!finalUrl && hasRedemetFb) {
        const rData = await checkRedemet();
        if (rData) {
          finalUrl = rData.url;
          finalTs = rData.ts;
          usedSource = 'redemet';
        }
      }

      // 3. Fallback final para Storage Backup
      if (!finalUrl) {
        const bData = await checkBackup();
        if (bData) {
          finalUrl = bData.url;
          finalTs = bData.ts;
          usedSource = 'backup';
        }
      }

      if (!finalUrl) {
        setTimelineFoundTimes((prev) => {
          if (prev[station.slug]) {
            const next = { ...prev };
            delete next[station.slug];
            return next;
          }
          return prev;
        });
        return; // Nada encontrado
      }
      
      setTimelineFoundTimes((prev) => ({ ...prev, [station.slug]: finalTs }));

      let timelineCfgSlug = station.slug;
      if (usedSource === 'redemet') {
        timelineCfgSlug = `${timelineCfgSlug}-redemet`;
      }
      const cfg = radarConfigs.find((c) => c.id === timelineCfgSlug || c.stationSlug === timelineCfgSlug);
      const latLngBounds = cfg
        ? new google.maps.LatLngBounds(cfg.bounds.sw, cfg.bounds.ne)
        : (usedSource === 'redemet' ? getRadarImageBounds(station as CptecRadarStation, 400) : getRadarImageBounds(station as CptecRadarStation));

      const ov = new google.maps.GroundOverlay(finalUrl, latLngBounds);
      ov.setOpacity(radarOpacity);
      ov.setMap(map);
      radarTimelineOverlaysRef.current.push(ov);

      // Fire-and-forget: salvar imagem no Storage para arquivo histórico se veio do CPTEC ou Redemet
      if (usedSource !== 'backup') {
        let cacheSlug = station.slug;
        if (usedSource === 'redemet') cacheSlug = `${cacheSlug}-redemet`;
        cacheRadarImage(finalUrl, cacheSlug, ts12, timelineProductType);
      }
    });

    return () => {
      radarTimelineOverlaysRef.current.forEach((ov) => { (ov as any)?.setMap?.(null); });
      radarTimelineOverlaysRef.current = [];
    };
  }, [showRadarTimelineSlider, radarTimelineMode, radarTimelineIndex, radarTimelineTimestamps, intervalRadars, timelineActiveStation, timelineProductType, radarOpacity, radarConfigs, radarSourceMode, timelineSelectedRadars]);

  // Radar play/pause
  useEffect(() => {
    if (radarPlayIntervalRef.current) {
      clearInterval(radarPlayIntervalRef.current);
      radarPlayIntervalRef.current = null;
    }
    if (!radarPlaying || radarTimestamps.length === 0) return;
    radarPlayIntervalRef.current = setInterval(() => {
      setRadarFrameIdx((i) => (i + 1) % radarTimestamps.length);
    }, 700);
    return () => {
      if (radarPlayIntervalRef.current) clearInterval(radarPlayIntervalRef.current);
    };
  }, [radarPlaying, radarTimestamps.length]);

  useEffect(() => {
    if (!radarVisible && radarPlaying) setRadarPlaying(false);
  }, [radarVisible, radarPlaying]);

  // Pré-carregar imagens em background quando radar visível (Nowcasting CPTEC ou Argentina)
  useEffect(() => {
    if (!radarVisible || !radarStation || radarTimestamps.length === 0) return;
    const isArg = !('slug' in radarStation);
    if (isArg) {
      const preload = (url: string) => {
        const img = new Image();
        img.src = getProxiedRadarUrl(url);
      };
      for (const ts of radarTimestamps) {
        preload(buildArgentinaRadarPngUrl(radarStation as ArgentinaRadarStation, ts, 'reflectividade'));
        preload(buildArgentinaRadarPngUrl(radarStation as ArgentinaRadarStation, ts, 'velocidade'));
      }
    } else if ((radarStation as CptecRadarStation).product === 'ppi') {
      const preload = (url: string) => {
        const img = new Image();
        img.src = getProxiedRadarUrl(url);
      };
      for (const ts of radarTimestamps) {
        const ts12 = ts.slice(0, 12);
        preload(buildNowcastingPngUrl(radarStation as CptecRadarStation, ts12, 'reflectividade'));
        preload(buildNowcastingPngUrl(radarStation as CptecRadarStation, ts12, 'velocidade'));
      }
    }
  }, [radarVisible, radarStation, radarTimestamps]);

  // GOES play/pause
  useEffect(() => {
    if (goesPlayIntervalRef.current) {
      clearInterval(goesPlayIntervalRef.current);
      goesPlayIntervalRef.current = null;
    }
    if (!goesPlaying || goesTimestamps.length === 0) return;
    goesPlayIntervalRef.current = setInterval(() => {
      setGoesFrameIdx((i) => (i + 1) % goesTimestamps.length);
    }, 600);
    return () => {
      if (goesPlayIntervalRef.current) clearInterval(goesPlayIntervalRef.current);
    };
  }, [goesPlaying, goesTimestamps.length]);

  // ─── Perfil Rastros (nome + tipo) e onboarding ─────────────────────────────

  useEffect(() => {
    if (!user) {
      setRastrosProfile(null);
      setRastrosProfileLoading(false);
      setShowRastrosOnboarding(false);
      return;
    }
    let cancelled = false;
    setRastrosProfileLoading(true);
    fetchRastrosProfile(user.uid)
      .then((profile) => {
        if (cancelled) return;
        setRastrosProfile(profile);
        setRastrosProfileLoading(false);
        setOnboardingDisplayName(profile?.displayName?.trim() || user.displayName || '');
        setOnboardingUserType(profile?.userType ?? 'civil');
        if (!profile || !profile.userType) setShowRastrosOnboarding(true);
      })
      .catch(() => {
        if (!cancelled) {
          setRastrosProfile(null);
          setRastrosProfileLoading(false);
          setOnboardingDisplayName(user.displayName || '');
          setOnboardingUserType('civil');
          setShowRastrosOnboarding(true);
        }
      });
    return () => { cancelled = true; };
  }, [user?.uid]);

  // ─── Presença / Online Users ──────────────────────────────────────────────

  // Registra/atualiza presença enquanto o usuário estiver logado nesta página
  useEffect(() => {
    if (!user) return;

    const displayName = rastrosProfile?.displayName?.trim() || user.displayName || 'Usuário';
    const userType = rastrosProfile?.userType ?? null;

    const write = () =>
      updatePresence(user.uid, {
        displayName,
        photoURL: user.photoURL ?? null,
        userType,
        locationShared: shareLocation,
        lat: shareLocation && myLocation ? myLocation.lat : null,
        lng: shareLocation && myLocation ? myLocation.lng : null,
        page: 'rastros-tornados',
      });

    write();
    presenceHeartbeatRef.current = setInterval(write, 60_000);

    const handleUnload = () => removePresence(user.uid);
    window.addEventListener('beforeunload', handleUnload);

    return () => {
      if (presenceHeartbeatRef.current) clearInterval(presenceHeartbeatRef.current);
      window.removeEventListener('beforeunload', handleUnload);
      removePresence(user.uid);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, rastrosProfile?.displayName, rastrosProfile?.userType, shareLocation, myLocation]);

  // Subscreve à lista de usuários online (usado para contagem e painel)
  useEffect(() => {
    if (!user) {
      setOnlineUsers([]);
      return;
    }
    presenceUnsubRef.current = subscribeToPresence(setOnlineUsers);
    return () => {
      presenceUnsubRef.current?.();
      presenceUnsubRef.current = null;
    };
  }, [user]);

  // Rastreamento de visitas diárias e assinatura em tempo real
  useEffect(() => {
    if (user) recordVisit();
    const unsub = subscribeToTodayVisitCount(setTodayVisitCount);
    return unsub;
  }, [user]);

  const handleRastrosOnboardingSubmit = async () => {
    if (!user) return;
    const name = onboardingDisplayName.trim() || user.displayName || 'Usuário';
    const profile: RastrosUserProfile = { displayName: name, userType: onboardingUserType };
    await saveRastrosProfile(user.uid, profile);
    setRastrosProfile(profile);
    setShowRastrosOnboarding(false);
    if (locationPermission === 'unknown' && navigator.geolocation) requestLocation();
  };

  // Pede permissão de geolocalização e obtém posição
  const requestLocation = () => {
    if (user && LOCATION_REQUEST_EXCLUDED_UIDS.includes(user.uid)) return;
    if (!navigator.geolocation) {
      setLocationPermission('denied');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setMyLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocationPermission('granted');
        setShareLocation(true);
      },
      () => setLocationPermission('denied'),
      { enableHighAccuracy: true, timeout: 10_000 }
    );
  };

  // Atualiza marcadores de usuários online no mapa
  // Nossa localização: visível quando shareLocation estiver ativo (independente do painel Online)
  // Outros usuários: visíveis apenas quando o painel Online estiver aberto
  useEffect(() => {
    onlineUserMarkersRef.current.forEach((m) => m.setMap(null));
    onlineUserMarkersRef.current = [];
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;
    const showOthers = showOnlineUsers;

    let usersToShow = onlineUsers.filter((u) => {
      if (!u.locationShared || !u.lat || !u.lng) return false;
      const isMe = u.uid === user?.uid;
      return isMe ? shareLocation && !!myLocation : showOthers;
    });
    // Garantir que nossa localização apareça mesmo antes do presence propagar
    if (shareLocation && myLocation && user && !usersToShow.some((u) => u.uid === user.uid)) {
      usersToShow = [
        {
          uid: user.uid,
          displayName: rastrosProfile?.displayName ?? user.displayName ?? 'Você',
          photoURL: user.photoURL,
          userType: rastrosProfile?.userType ?? null,
          lat: myLocation.lat,
          lng: myLocation.lng,
          locationShared: true,
          lastSeen: null,
        },
        ...usersToShow,
      ];
    }

    usersToShow.forEach((u) => {
      if (!u.locationShared || !u.lat || !u.lng) return;
      const isMe = u.uid === user?.uid;
      const initial = (u.displayName?.[0] ?? '?').toUpperCase();
      const color = isMe ? '#0ea5e9' : '#38bdf8';
      // Ícone de alvo (target) para "eu"; pin com inicial para outros
      const svgContent = isMe ? `
        <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">
          <circle cx="20" cy="20" r="6" fill="${color}" stroke="white" stroke-width="2"/>
          <circle cx="20" cy="20" r="12" fill="none" stroke="${color}" stroke-width="2"/>
          <line x1="20" y1="2" x2="20" y2="8" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/>
          <line x1="20" y1="32" x2="20" y2="38" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/>
          <line x1="2" y1="20" x2="8" y2="20" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/>
          <line x1="32" y1="20" x2="38" y2="20" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/>
        </svg>` : `
        <svg xmlns="http://www.w3.org/2000/svg" width="36" height="44" viewBox="0 0 36 44">
          <circle cx="18" cy="18" r="17" fill="${color}" stroke="white" stroke-width="2"/>
          <text x="18" y="23" text-anchor="middle" fill="white" font-size="14" font-family="sans-serif" font-weight="bold">${initial}</text>
          <polygon points="11,33 25,33 18,43" fill="${color}"/>
        </svg>`;
      const icon = {
        url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svgContent)}`,
        scaledSize: isMe ? new google.maps.Size(40, 40) : new google.maps.Size(36, 44),
        anchor: isMe ? new google.maps.Point(20, 20) : new google.maps.Point(18, 43),
      };
      const marker = new google.maps.Marker({
        position: { lat: u.lat, lng: u.lng },
        map,
        icon,
        title: u.displayName,
        zIndex: isMe ? 999 : 100,
      });
      // Info window com nome
      const iw = new google.maps.InfoWindow({ content: `<span style="font-size:13px;font-weight:600">${u.displayName}</span>` });
      marker.addListener('click', () => iw.open(map, marker));
      onlineUserMarkersRef.current.push(marker);
    });

    return () => {
      onlineUserMarkersRef.current.forEach((m) => m.setMap(null));
      onlineUserMarkersRef.current = [];
    };
  }, [showOnlineUsers, onlineUsers, shareLocation, myLocation, user, rastrosProfile?.displayName, rastrosProfile?.userType, mapInstanceRef.current]);

  // Busca por localização: Places Autocomplete
  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current || !searchInputRef.current || !google.maps?.importLibrary) return;
    let isMounted = true;
    (async () => {
      try {
        const { Autocomplete } = await google.maps.importLibrary('places');
        if (!isMounted || !searchInputRef.current || !mapInstanceRef.current) return;
        const map = mapInstanceRef.current;
        const bounds = new google.maps.LatLngBounds(
          { lat: -34, lng: -74 },
          { lat: 5, lng: -34 }
        );
        const autocomplete = new Autocomplete(searchInputRef.current, {
          types: ['geocode'],
          bounds,
          fields: ['geometry', 'name'],
        });
        autocomplete.addListener('place_changed', () => {
          const place = autocomplete.getPlace();
          if (place.geometry?.location) {
            map.panTo(place.geometry.location);
            map.setZoom(12);
          }
        });
        autocompleteRef.current = autocomplete;
      } catch (e) {
        console.error('Places Autocomplete init error', e);
      }
    })();
    return () => { isMounted = false; };
  }, [mapReady]);

  // Régua: modo medir — clique no mapa adiciona pontos e desenha linha com distância
  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current) return;
    const map = mapInstanceRef.current;
    if (!measureMode) return;

    const clickHandler = (e: any) => {
      const lat = e.latLng.lat();
      const lng = e.latLng.lng();
      setMeasurePoints((prev) => {
        const next = [...prev, { lat, lng }];
        if (measurePolylineRef.current) measurePolylineRef.current.setMap(null);
        if (next.length >= 2) {
          const path = next.map((p) => new google.maps.LatLng(p.lat, p.lng));
          const poly = new google.maps.Polyline({
            path,
            strokeColor: '#22d3ee',
            strokeWeight: 3,
            strokeOpacity: 0.9,
            map,
          });
          measurePolylineRef.current = poly;
          if (google.maps.geometry?.spherical) {
            const meters = google.maps.geometry.spherical.computeLength(path);
            setMeasureDistanceKm(Math.round((meters / 1000) * 100) / 100);
          } else {
            setMeasureDistanceKm(null);
          }
        } else {
          setMeasureDistanceKm(null);
        }
        return next;
      });
    };

    const listener = map.addListener('click', clickHandler);
    measureListenersRef.current.push(listener);

    return () => {
      measureListenersRef.current.forEach((ln) => google.maps.event.removeListener(ln));
      measureListenersRef.current = [];
      if (measurePolylineRef.current) {
        measurePolylineRef.current.setMap(null);
        measurePolylineRef.current = null;
      }
    };
  }, [mapReady, measureMode]);

  // Listener para carregar os marcadores de comentários georreferenciados do banco
  useEffect(() => {
    if (!selectedTrack || !mapInstanceRef.current || !db) {
      setTrackGeoPins([]);
      return;
    }
    const isMeteorologist = (rastrosProfile?.userType as string) === 'admin' || rastrosProfile?.userType === 'meteorologista';
    if (!isMeteorologist) return;

    const q = query(
      collection(db as any, 'track_comments'),
      where('trackId', '==', selectedTrack.id),
      where('location', '!=', null)
    );
    const unsubscribe = onSnapshot(q, (snap) => {
      const pins: any[] = [];
      snap.forEach(doc => {
        const d = doc.data();
        if (d.location) pins.push({ id: doc.id, ...d });
      });
      setTrackGeoPins(pins);
    });
    return () => unsubscribe();
  }, [selectedTrack, rastrosProfile]);

  // Renderizar e limpar marcadores georreferenciados de Meteorologistas no Mapa
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    const g = (window as any).google;
    
    trackGeoPinMarkersRef.current.forEach(m => m.setMap(null));
    trackGeoPinMarkersRef.current = [];

    trackGeoPins.forEach(pin => {
      let marker;
      if (g.maps.marker?.AdvancedMarkerElement) {
        const el = document.createElement('div');
        el.innerHTML = '<div style="background-color: #0284c7; padding: 4px; border-radius: 50%; border: 2px solid white; cursor: pointer; display: flex; align-items: center; justify-content: center; width: 26px; height: 26px; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.5);"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></div>';
        
        marker = new g.maps.marker.AdvancedMarkerElement({
          position: pin.location,
          map,
          content: el,
          title: `Comentário de ${pin.userName}`,
        });
      } else {
        marker = new g.maps.Marker({
          position: pin.location,
          map,
          title: `Comentário de ${pin.userName}`,
          icon: 'https://maps.google.com/mapfiles/ms/icons/blue-dot.png'
        });
      }
      
      marker.addListener('click', () => {
        setSelectedTrack(t => t); // Just in case
        setSidebarCollapsed(false);
        setShowMobileEventsPanel(true);
      });
      
      trackGeoPinMarkersRef.current.push(marker);
    });

    return () => {
      trackGeoPinMarkersRef.current.forEach(m => m.setMap(null));
      trackGeoPinMarkersRef.current = [];
    };
  }, [trackGeoPins, mapReady]);

  // Listener global de clique no mapa para Meteorologistas adicionarem Pins
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || measureMode || isRadarEditMode) return;
    
    const isMeteorologist = (rastrosProfile?.userType as string) === 'admin' || rastrosProfile?.userType === 'meteorologista';
    if (!selectedTrack || !isMeteorologist) return;

    const listener = map.addListener('click', (e: any) => {
      const lat = e.latLng.lat();
      const lng = e.latLng.lng();
      setMapPinCoordinate({ lat, lng });
    });

    return () => {
      if (listener?.remove) listener.remove();
      else if (google?.maps?.event) google.maps.event.removeListener(listener);
    };
  }, [mapReady, selectedTrack, rastrosProfile, measureMode, isRadarEditMode]);

  if (!isMounted) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-[#0A0E17] text-slate-500">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-[#0A0E17] text-white overflow-hidden">
      {/* Modal de onboarding (localização, nome, tipo) — ao entrar em Rastros */}
      {showRastrosOnboarding && user && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-sm mx-4 bg-slate-900 border border-emerald-500/40 rounded-xl shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-slate-700">
              <h2 className="text-lg font-bold text-emerald-400 flex items-center gap-2">
                <Users className="w-5 h-5" />
                Bem-vindo ao Rastros de Tornados
              </h2>
              <p className="text-xs text-slate-400 mt-1">Configure como deseja aparecer para outros usuários online.</p>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase mb-1.5">Seu nome</label>
                <input
                  type="text"
                  value={onboardingDisplayName}
                  onChange={(e) => setOnboardingDisplayName(e.target.value)}
                  placeholder={user.displayName || 'Seu nome'}
                  className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase mb-1.5">O que você é?</label>
                <div className="grid grid-cols-2 gap-2">
                  {RASTROS_USER_TYPES.map(({ value, label }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setOnboardingUserType(value)}
                      className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                        onboardingUserType === value
                          ? 'bg-emerald-500/30 border-emerald-500 text-emerald-300'
                          : 'bg-slate-800 border border-slate-600 text-slate-300 hover:border-slate-500'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase mb-1.5">Localização (opcional)</label>
                {locationPermission === 'unknown' ? (
                  <button
                    type="button"
                    onClick={requestLocation}
                    className="w-full text-xs px-3 py-2 rounded-lg border border-sky-500/50 text-sky-400 hover:bg-sky-500/10 transition-colors flex items-center gap-2"
                  >
                    <MapPin className="w-4 h-4" />
                    Permitir localização no mapa
                  </button>
                ) : locationPermission === 'granted' ? (
                  <p className="text-xs text-emerald-400 flex items-center gap-1.5">✓ Localização permitida</p>
                ) : locationPermission === 'denied' ? (
                  <p className="text-xs text-slate-500">Permissão negada. Você pode alterar nas configurações do navegador.</p>
                ) : null}
              </div>
            </div>
            <div className="p-4 border-t border-slate-700 flex justify-end gap-2">
              <button
                type="button"
                onClick={handleRastrosOnboardingSubmit}
                className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-900 font-semibold text-sm transition-colors"
              >
                Entrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header — glassmorphism dark */}
      <header className="flex items-center gap-2 sm:gap-4 px-3 sm:px-4 py-2 bg-[#0A0E17]/90 backdrop-blur-xl border-b border-white/10 flex-shrink-0 min-h-[48px] shadow-lg">
        <Link href="/" className="inline-flex items-center gap-1 sm:gap-2 text-slate-400 hover:text-white flex-shrink-0">
          <ChevronLeft className="w-5 h-5" /> <span className="hidden sm:inline">Voltar</span>
        </Link>
        <h1 className="text-sm sm:text-base font-bold flex items-center gap-2 flex-shrink-0">
          <Wind className="w-4 h-4 sm:w-5 sm:h-5 text-amber-400 flex-shrink-0" />
          <span className="hidden sm:inline">Rastros de Tornados no Brasil</span>
          <span className="sm:hidden">Rastros</span>
        </h1>
        <div className="flex-1 min-w-0 flex justify-center px-2">
          <div className="flex w-full max-w-md">
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Buscar endereço ou lugar"
              className="flex-1 min-w-0 bg-slate-700 border border-slate-600 rounded-l-lg px-3 py-2 text-sm text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50"
            />
            <button
              type="button"
              onClick={() => searchInputRef.current?.focus()}
              className="flex items-center justify-center w-10 h-[38px] bg-amber-500 hover:bg-amber-400 text-slate-900 rounded-r-lg border border-amber-500 transition-colors flex-shrink-0"
              title="Buscar localização"
              aria-label="Buscar"
            >
              <Search className="w-5 h-5" />
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-slate-500 text-xs hidden sm:inline">{tracksLoading ? '…' : `${displayedTracks.length}`} rastros</span>
          <span className="text-slate-500 text-xs hidden md:inline border-l border-slate-600 pl-3" title="Visitas do site hoje">{todayVisitCount} visitas</span>
          <button
            type="button"
            onClick={() => setShowMobileEventsPanel((v) => !v)}
            className={`md:hidden flex items-center gap-1.5 px-2 py-1.5 rounded-lg border ${
              showMobileEventsPanel ? 'bg-amber-500/30 border-amber-500' : 'bg-amber-500/20 border-amber-500/50'
            } text-amber-300`}
            aria-label="Abrir Eventos"
          >
            <Info className="w-4 h-4" />
            <span className="text-xs font-medium">Eventos</span>
          </button>
        </div>
      </header>

      {/* Barra de navegação — glassmorphism. z-[60] quando calendário aberto para não ficar encoberto pelo mapa. */}
      <nav className={`flex flex-wrap items-center gap-1 sm:gap-2 px-3 sm:px-4 py-2 bg-[#0A0E17]/80 backdrop-blur-md border-b border-white/10 flex-shrink-0 ${showIntervalCalendar ? 'relative z-[60]' : ''}`}>
        <button
          type="button"
          onClick={() => setMobileLeftPanel(mobileLeftPanel === 'none' ? 'legenda' : 'none')}
          className={`md:hidden flex items-center gap-2 px-3 py-2 rounded-lg border flex-shrink-0 ${
            mobileLeftPanel !== 'none' ? 'bg-slate-600 border-slate-500 text-white' : 'bg-slate-700 border-slate-600 text-slate-200'
          }`}
          aria-label="Painéis (Radar, Online, Legenda)"
          title="Abrir painéis laterais"
        >
          <Layers className="w-4 h-4" />
          <span className="text-sm">Painéis</span>
        </button>
        <button
          type="button"
          onClick={() => setShowMobileFiltersMenu((v) => !v)}
          className="md:hidden flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-700 border border-slate-600 text-slate-200"
          aria-label="Filtros"
        >
          <Menu className="w-4 h-4" />
          Filtros
        </button>
        <div className={`flex flex-wrap items-center gap-2 ${showMobileFiltersMenu ? 'flex' : 'hidden'} md:flex`}>
          {/* Botão para ativar/desativar ícone de localização no mapa */}
          <button
            type="button"
            onClick={() => {
              if (locationPermission !== 'granted') {
                requestLocation();
              } else {
                setShareLocation((v) => !v);
              }
            }}
            className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-sm border transition-colors ${
              shareLocation
                ? 'bg-sky-500/20 border-sky-500/60 text-sky-300'
                : 'bg-slate-700 border-slate-600 text-slate-200 hover:bg-slate-600'
            }`}
            title={shareLocation ? 'Ocultar minha localização no mapa' : 'Exibir minha localização no mapa'}
          >
            <Target className="w-4 h-4" />
            <span className="sr-only md:not-sr-only">
              {shareLocation ? 'Localização visível' : 'Localização oculta'}
            </span>
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setShowIntervalCalendar((v) => !v);
                if (!showIntervalCalendar) {
                  setCalendarSelectPhase('start');
                  const d = new Date();
                  setCalendarMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
                }
              }}
              className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-sm border transition-colors ${
                intervalStartDate && intervalEndDate
                  ? 'bg-amber-500/20 border-amber-500/60 text-amber-300'
                  : 'bg-slate-700 border-slate-600 text-slate-200 hover:bg-slate-600'
              }`}
              title="Selecionar intervalo de datas"
            >
              <Calendar className="w-4 h-4" />
              <span>Selecionar intervalo</span>
              {intervalStartDate && intervalEndDate && (
                <span className="text-[10px] text-amber-400/80">
                  {intervalStartDate} → {intervalEndDate}
                </span>
              )}
            </button>
            {showIntervalCalendar && (
              <>
                <div
                  className="fixed inset-0 z-30"
                  aria-hidden
                  onClick={() => setShowIntervalCalendar(false)}
                />
                <div className="absolute top-full left-0 mt-1 z-40 w-72 max-w-[calc(100vw-1.5rem)] bg-slate-900 border border-slate-600 rounded-lg shadow-xl p-3">
                  <p className="text-xs text-slate-400 mb-2">
                    {calendarSelectPhase === 'start' ? '1º clique: data inicial' : '2º clique: data final'}
                  </p>
                  <p className="text-[10px] text-amber-500/90 mb-2">
                    Apenas datas ±3 dias de rastros registrados
                  </p>
                  <div className="flex items-center justify-between mb-2">
                    <button
                      type="button"
                      onClick={() => {
                        const [y, m] = calendarMonth.split('-').map(Number);
                        const d = new Date(y, m - 2, 1);
                        setCalendarMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
                      }}
                      className="p-1 text-slate-400 hover:text-white"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <span className="text-sm font-medium text-slate-200">
                      {(() => {
                        const [y, m] = calendarMonth.split('-').map(Number);
                        return new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
                      })()}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        const [y, m] = calendarMonth.split('-').map(Number);
                        const d = new Date(y, m, 1);
                        setCalendarMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
                      }}
                      className="p-1 text-slate-400 hover:text-white"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="grid grid-cols-7 gap-0.5 text-center text-xs">
                    {['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((day) => (
                      <div key={day} className="text-slate-500 py-1">{day}</div>
                    ))}
                    {(() => {
                      const [y, m] = calendarMonth.split('-').map(Number);
                      const first = new Date(y, m - 1, 1);
                      const last = new Date(y, m, 0);
                      const startPad = first.getDay();
                      const days: (string | null)[] = [];
                      for (let i = 0; i < startPad; i++) days.push(null);
                      for (let d = 1; d <= last.getDate(); d++) {
                        days.push(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
                      }
                      return days.map((date, i) => {
                        if (!date) return <div key={`pad-${i}`} />;
                        const isAllowed = allowedRadarDates.has(date);
                        const isStart = date === intervalStartDate;
                        const isEnd = date === intervalEndDate;
                        const isInRange = intervalStartDate && intervalEndDate && date >= intervalStartDate && date <= intervalEndDate;
                        return (
                          <button
                            key={date}
                            type="button"
                            onClick={() => handleIntervalDayClick(date)}
                            disabled={!isAllowed}
                            title={!isAllowed ? 'Disponível só ±3 dias de rastros' : undefined}
                            className={`py-1.5 rounded transition-colors ${
                              !isAllowed
                                ? 'text-slate-600 cursor-not-allowed opacity-50'
                                : isStart || isEnd
                                  ? 'bg-amber-500 text-slate-900 font-bold'
                                  : isInRange
                                    ? 'bg-amber-500/30 text-amber-200'
                                    : 'text-slate-300 hover:bg-slate-700'
                            }`}
                          >
                            {parseInt(date.slice(8), 10)}
                          </button>
                        );
                      });
                    })()}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setIntervalStartDate(null);
                      setIntervalEndDate(null);
                      setShowIntervalCalendar(false);
                    }}
                    className="mt-2 w-full py-1.5 text-xs bg-slate-700 hover:bg-slate-600 rounded text-slate-300"
                  >
                    Limpar intervalo
                  </button>
                </div>
              </>
            )}
          </div>
          <select
            value={yearFilter}
            onChange={(e) => setYearFilter(e.target.value)}
            className="bg-slate-700 border border-slate-600 rounded-lg px-2 py-1.5 text-sm text-white"
          >
            <option value="">Ano: Todos</option>
            {years.map((y) => (
              <option key={y} value={String(y)}>Ano: {y}</option>
            ))}
          </select>
          <select
            value={intensityFilter}
            onChange={(e) => setIntensityFilter(e.target.value)}
            className="bg-slate-700 border border-slate-600 rounded-lg px-2 py-1.5 text-sm text-white"
          >
            <option value="">F: Todas</option>
            {intensities.map((i) => (
              <option key={i} value={i}>F: {i}</option>
            ))}
          </select>
        </div>
        <div className="hidden md:flex flex-1" />
        <div className="flex items-center rounded-xl border border-white/10 overflow-hidden bg-black/30 flex-shrink-0">
          <button
            type="button"
            onClick={() => setMapViewMode('tracks')}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-bold uppercase tracking-wider transition-all ${
              mapViewMode === 'tracks' ? 'bg-cyan-500 text-slate-900 shadow-[0_0_12px_rgba(6,182,212,0.5)]' : 'text-slate-400 hover:bg-white/5 hover:text-white'
            }`}
            title="Exibir rastros (polígonos)"
          >
            <MapPin className="w-4 h-4" />
            <span className="hidden sm:inline">Rastros</span>
          </button>
          <button
            type="button"
            onClick={() => setMapViewMode('heatmap')}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-bold uppercase tracking-wider transition-all ${
              mapViewMode === 'heatmap' ? 'bg-cyan-500 text-slate-900 shadow-[0_0_12px_rgba(6,182,212,0.5)]' : 'text-slate-400 hover:bg-white/5 hover:text-white'
            }`}
            title="Exibir mapa de calor"
          >
            <Flame className="w-4 h-4" />
            <span className="hidden sm:inline">Heatmap</span>
          </button>
        </div>
        {user && (
          <button
            type="button"
            onClick={() => setShowOnlineUsers((v) => !v)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg border shadow transition-colors flex-shrink-0 ${
              showOnlineUsers ? 'bg-emerald-500/20 border-emerald-500/60 text-emerald-300' : 'bg-slate-700/80 border-slate-600 text-slate-200 hover:bg-slate-600'
            }`}
            title="Usuários online"
          >
            <Users className="w-4 h-4" />
            <span className="hidden sm:inline text-sm font-medium">Online</span>
            {onlineUsers.length > 0 && (
              <span className="text-xs font-bold bg-emerald-500 text-white rounded-full px-1.5 py-0.5 leading-none">{onlineUsers.length}</span>
            )}
          </button>
        )}
        <button type="button" onClick={() => setShowBaseMapGallery((v) => !v)} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-700/80 border border-slate-600 text-slate-200 hover:bg-slate-600 shadow flex-shrink-0">
          <Layers className="w-4 h-4" />
          <span className="text-sm font-medium hidden sm:inline">Mapa base</span>
        </button>
        <button
          type="button"
          onClick={toggleMeasureMode}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg border shadow transition-colors flex-shrink-0 ${
            measureMode ? 'bg-cyan-500/20 border-cyan-500/60 text-cyan-300' : 'bg-slate-700/80 border-slate-600 text-slate-200 hover:bg-slate-600'
          }`}
          title="Medir distância"
        >
          <Ruler className="w-4 h-4" />
          {measureDistanceKm != null && <span className="text-cyan-400 text-xs font-semibold">({measureDistanceKm} km)</span>}
        </button>
        <button
          type="button"
          onClick={() => { if (newTrackNotifications.length > 0) setNewTrackNotifications([]); else requestBrowserNotifications(); }}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg border shadow transition-colors flex-shrink-0 ${
            newTrackNotifications.length > 0 ? 'bg-amber-500/20 border-amber-500/60 text-amber-300' : 'bg-slate-700/80 border-slate-600 text-slate-200 hover:bg-slate-600'
          }`}
          title="Notificações"
        >
          <Bell className="w-4 h-4" />
          {newTrackNotifications.length > 0 && (
            <span className="text-xs font-bold bg-amber-500 text-slate-900 rounded-full px-1.5 py-0.5">{newTrackNotifications.length}</span>
          )}
        </button>
        <button type="button" onClick={() => setShowDateFilter((v) => !v)} className={`flex items-center gap-2 px-3 py-2 rounded-lg border flex-shrink-0 ${
          showDateFilter || startDate || endDate ? 'bg-amber-500/20 border-amber-500/60 text-amber-300' : 'bg-slate-700/80 border-slate-600 text-slate-200 hover:bg-slate-600'
        }`} title="Filtrar por data">
          <Filter className="w-4 h-4" />
          <span className="hidden sm:inline text-sm">Data</span>
        </button>
        {showDateFilter && (
          <div className="flex flex-wrap items-center gap-2">
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-white" />
            <span className="text-slate-500 text-xs">até</span>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-white" />
            <button type="button" onClick={resetDateFilter} className="px-2 py-1 text-xs bg-slate-600 hover:bg-slate-500 rounded text-slate-200">Redefinir</button>
          </div>
        )}
      </nav>

      {newTrackNotifications.length > 0 && (
        <div className="px-4 py-2 bg-amber-500/10 border-b border-amber-500/30 flex items-center justify-between gap-3">
          <div className="text-xs text-amber-200">
            <span className="font-semibold">{newTrackNotifications.length}</span>{' '}
            novo(s) rastro(s) detectado(s). Mais recente:{' '}
            <span className="font-mono">
              {newTrackNotifications[0]?.date} · {newTrackNotifications[0]?.locality || newTrackNotifications[0]?.state}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                const newest = newTrackNotifications[0];
                if (newest) {
                  setSelectedTrack(newest);
                  if (mapInstanceRef.current) {
                    mapInstanceRef.current.panTo(BRAZIL_CENTER);
                  }
                }
              }}
              className="text-xs px-2 py-1 rounded bg-amber-500 text-slate-900 hover:bg-amber-400"
            >
              Ver mais recente
            </button>
            <button
              type="button"
              onClick={() => setNewTrackNotifications([])}
              className="text-xs px-2 py-1 rounded bg-slate-700 text-slate-200 hover:bg-slate-600"
            >
              Marcar lidas
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-1 min-h-0 min-w-0 overflow-hidden">
        {/* Sidebar esquerda — Radar, Online, Legenda (minimizável no desktop, drawer no mobile) */}
        {mobileLeftPanel !== 'none' && (
          <div className="md:hidden fixed inset-0 z-40 bg-black/50" aria-hidden onClick={() => setMobileLeftPanel('none')} />
        )}
        <aside
          className={`
            flex flex-col bg-[#0A0E17]/95 backdrop-blur-xl border-r border-white/10 flex-shrink-0 overflow-hidden
            transition-[width] duration-200
            ${mobileLeftPanel === 'none' ? 'hidden' : 'flex fixed inset-y-0 left-0 z-50 w-[min(18rem,85vw)] shadow-2xl'}
            md:flex md:relative md:inset-auto md:z-auto md:shadow-none md:w-12
            ${!leftSidebarCollapsed ? 'md:!w-52 lg:!w-56' : 'md:!w-12'}
          `}
        >
          {leftSidebarCollapsed ? (
            <div className="hidden md:flex flex-col items-center py-3 gap-2">
              <button type="button" onClick={() => setLeftSidebarCollapsed(false)} className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800" title="Expandir painéis">
                <ChevronRight className="w-5 h-5" />
              </button>
              <button type="button" onClick={() => { setLeftPanelRadarCollapsed(false); setLeftSidebarCollapsed(false); }} className="p-2 rounded" title="Radar"><Radar className="w-5 h-5 text-cyan-400" /></button>
              <button type="button" onClick={() => { setLeftPanelOnlineCollapsed(false); setLeftSidebarCollapsed(false); }} className="p-2 rounded" title="Online"><Users className="w-5 h-5 text-emerald-400" /></button>
              <button type="button" onClick={() => { setLeftPanelLegendaCollapsed(false); setLeftSidebarCollapsed(false); }} className="p-2 rounded" title="Legenda"><Layers className="w-5 h-5 text-amber-400" /></button>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between px-3 py-2 border-b border-white/10 flex-shrink-0 bg-black/20">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                  {selectedTrack ? 'Informações do Tornado' : 'Painéis'}
                </span>
                <div className="flex items-center gap-1">
                  {selectedTrack && (
                    <button
                      type="button"
                      onClick={() => setSelectedTrack(null)}
                      className="p-1 rounded text-slate-400 hover:text-white transition-colors"
                      title="Fechar informações"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                  <button type="button" onClick={() => setLeftSidebarCollapsed(true)} className="hidden md:block p-1 rounded text-slate-400 hover:text-white" title="Minimizar">
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button type="button" onClick={() => setMobileLeftPanel('none')} className="md:hidden p-1 rounded text-slate-400 hover:text-white" title="Fechar">
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto p-2 sm:p-3 space-y-4">
                {selectedTrack ? (
                  <div className="space-y-4 pb-6">
                    {/* Galeria de Imagens */}
                    {selectedTrack.gallery && selectedTrack.gallery.length > 0 && (
                      <div className="relative group rounded-xl overflow-hidden bg-black/40 border border-white/10 aspect-video shadow-2xl">
                        <img
                          src={selectedTrack.gallery[infoPanelGalleryIdx]}
                          alt={`Imagem ${infoPanelGalleryIdx + 1}`}
                          className="w-full h-full object-cover transition-transform duration-500 hover:scale-110"
                        />
                        {selectedTrack.gallery.length > 1 && (
                          <>
                            <div className="absolute inset-y-0 left-0 flex items-center pl-2 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                onClick={() => setInfoPanelGalleryIdx(prev => (prev > 0 ? prev - 1 : selectedTrack.gallery!.length - 1))}
                                className="p-1.5 rounded-full bg-black/60 text-white hover:bg-black/80 backdrop-blur-sm border border-white/10"
                              >
                                <ChevronLeft className="w-4 h-4" />
                              </button>
                            </div>
                            <div className="absolute inset-y-0 right-0 flex items-center pr-2 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                onClick={() => setInfoPanelGalleryIdx(prev => (prev < selectedTrack.gallery!.length - 1 ? prev + 1 : 0))}
                                className="p-1.5 rounded-full bg-black/60 text-white hover:bg-black/80 backdrop-blur-sm border border-white/10"
                              >
                                <ChevronRight className="w-4 h-4" />
                              </button>
                            </div>
                            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1 px-2 py-1 rounded-full bg-black/40 backdrop-blur-md">
                              {selectedTrack.gallery.map((_, i) => (
                                <div
                                  key={i}
                                  className={`w-1.5 h-1.5 rounded-full transition-all ${i === infoPanelGalleryIdx ? 'bg-cyan-400 w-3' : 'bg-white/30'}`}
                                />
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    )}

                    {/* Informações Básicas */}
                    <div className="space-y-1">
                      <h3 className="text-lg font-bold text-white leading-tight">
                        {selectedTrack.locality ? `${selectedTrack.locality}, ` : ''}{selectedTrack.state}
                      </h3>
                      <div className="flex items-center gap-2 text-xs font-medium text-slate-400">
                        <Calendar className="w-3.5 h-3.5 text-cyan-400" />
                        <span>{selectedTrack.date}</span>
                        {selectedTrack.time && <span>• {selectedTrack.time}</span>}
                      </div>
                    </div>

                    {/* Vítimas e Prejuízo */}
                    <div className="grid grid-cols-2 gap-2">
                       <div className="bg-white/5 border border-white/10 rounded-xl p-2.5 shadow-sm">
                          <div className="flex items-center gap-2 mb-1">
                            <Users className="w-3.5 h-3.5 text-orange-400" />
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Vítimas</span>
                          </div>
                          <p className="text-base font-black text-white">{selectedTrack.victims ?? 0}</p>
                       </div>
                       <div className="bg-white/5 border border-white/10 rounded-xl p-2.5 shadow-sm">
                          <div className="flex items-center gap-2 mb-1">
                            <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Prejuízo</span>
                          </div>
                          <p className="text-sm font-bold text-white truncate" title={selectedTrack.damage || 'Não informado'}>
                            {selectedTrack.damage || 'N/D'}
                          </p>
                       </div>
                    </div>

                    {/* SkewTs */}
                    {selectedTrack.skewts && selectedTrack.skewts.length > 0 && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Skew-Ts (Radiossondagem)</span>
                          <span className="text-[10px] text-cyan-500 font-bold">{selectedTrack.skewts.length} disponíveis</span>
                        </div>
                        <div className="grid grid-cols-4 gap-1.5">
                          {selectedTrack.skewts.map((url, i) => {
                            // Extrair hora da URL se possível (ex: 00z, 12z)
                            const match = url.match(/(\d{2})z/i);
                            const label = match ? `${match[1]}Z` : `${i + 1}`;
                            return (
                              <button
                                key={i}
                                onClick={() => setInfoPanelSkewtUrl(url)}
                                className={`py-1.5 rounded-lg text-[10px] font-black transition-all border ${
                                  infoPanelSkewtUrl === url
                                    ? 'bg-cyan-500 border-cyan-400 text-black shadow-[0_0_12px_rgba(6,182,212,0.4)]'
                                    : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'
                                }`}
                              >
                                {label}
                              </button>
                            );
                          })}
                        </div>
                        {infoPanelSkewtUrl && (
                          <div className="relative rounded-xl overflow-hidden border border-white/10 bg-black shadow-lg aspect-square group">
                            <img
                              src={infoPanelSkewtUrl}
                              alt="SkewT"
                              className="w-full h-full object-contain cursor-zoom-in"
                              onClick={() => window.open(infoPanelSkewtUrl, '_blank')}
                            />
                            <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                onClick={() => window.open(infoPanelSkewtUrl, '_blank')}
                                className="p-1 px-2 rounded-md bg-black/60 text-[9px] font-bold text-white border border-white/20 flex items-center gap-1"
                              >
                                <ExternalLink className="w-3 h-3" /> Ampliar
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Modelagem Numérica */}
                    {selectedTrack.numericalModels && selectedTrack.numericalModels.length > 0 && (
                      <div className="space-y-2">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Modelagem Numérica</span>
                        <div className="space-y-2">
                          {selectedTrack.numericalModels.map((model, i) => {
                            const isVisible = !!secondaryOverlaysRef.current[`model_${i}`];
                            return (
                              <div key={i} className="bg-white/5 border border-white/10 rounded-xl p-3 space-y-3 shadow-md">
                                <div className="flex items-center justify-between">
                                  <span className="text-xs font-bold text-slate-200">{model.round} +{model.forecastHour}h</span>
                                  <button
                                    onClick={() => {
                                      const key = `model_${i}`;
                                      if (isVisible) {
                                        if (secondaryOverlaysRef.current[key]) {
                                          secondaryOverlaysRef.current[key].setMap(null);
                                          delete secondaryOverlaysRef.current[key];
                                        }
                                      } else {
                                        // Adicionar overlay no mapa
                                        if (mapInstanceRef.current && model.bounds) {
                                          const overlay = new google.maps.GroundOverlay(model.url, {
                                            north: model.bounds.ne.lat,
                                            south: model.bounds.sw.lat,
                                            east: model.bounds.ne.lng,
                                            west: model.bounds.sw.lng,
                                          });
                                          overlay.setMap(mapInstanceRef.current);
                                          overlay.setOpacity(0.7);
                                          secondaryOverlaysRef.current[key] = overlay;
                                        }
                                      }
                                      // Gatilho para re-render (hackish but effective in this file's context)
                                      setShareFeedback(isVisible ? 'Modelo removido' : 'Modelo ativado');
                                    }}
                                    className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-tighter transition-all ${
                                      isVisible
                                        ? 'bg-amber-500 text-black shadow-[0_0_12px_rgba(245,158,11,0.4)]'
                                        : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                                    }`}
                                  >
                                    {isVisible ? 'Ativo' : 'Sobrepor'}
                                  </button>
                                </div>
                                <div className="relative rounded-lg overflow-hidden border border-white/5 bg-black/40 aspect-[4/3] group">
                                  <img
                                    src={model.url}
                                    alt={`${model.round} +${model.forecastHour}h`}
                                    className="w-full h-full object-cover cursor-zoom-in"
                                    onClick={() => window.open(model.url, '_blank')}
                                  />
                                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors pointer-events-none" />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Links Externos */}
                    {selectedTrack.externalLinks && selectedTrack.externalLinks.length > 0 && (
                      <div className="space-y-2">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Fontes e Links</span>
                        <div className="grid grid-cols-1 gap-1.5">
                          {selectedTrack.externalLinks.map((link, i) => (
                            <a
                              key={i}
                              href={link.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center justify-between p-2.5 rounded-xl bg-white/5 border border-white/10 text-xs text-slate-300 hover:bg-white/10 hover:text-white transition-all group shadow-sm"
                            >
                              <span className="font-medium truncate mr-2">{link.label}</span>
                              <ExternalLink className="w-3.5 h-3.5 text-slate-500 group-hover:text-cyan-400 shrink-0" />
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    {/* Seção Radar — quando intervalo selecionado */}
                    {showRadarTimelineSlider && (
                      <div className="rounded-lg border border-slate-600 bg-slate-800/60 overflow-hidden">
                        <button
                          type="button"
                          onClick={() => setLeftPanelRadarCollapsed((v) => !v)}
                          className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-slate-700/50"
                        >
                          <span className="text-xs font-semibold text-cyan-300 flex items-center gap-1.5"><Radar className="w-4 h-4" />Radar</span>
                          <span className="text-slate-500">{leftPanelRadarCollapsed ? '+' : '−'}</span>
                        </button>
                        {!leftPanelRadarCollapsed && (
                          <div className="px-3 pb-3 space-y-2">
                            <button type="button" onClick={() => { setRadarTimelineMode('mosaico'); setRadarTimelineStation(null); }} className={`w-full text-left px-2 py-1.5 rounded text-xs font-medium ${radarTimelineMode === 'mosaico' ? 'bg-cyan-500/30 text-cyan-200' : 'text-slate-300 hover:bg-slate-700'}`}>Mosaico (todos)</button>
                            <button type="button" onClick={() => { setRadarTimelineMode('unico'); if (!radarTimelineStation && intervalRadars.length > 0) setRadarTimelineStation(intervalRadars[0]); }} className={`w-full text-left px-2 py-1.5 rounded text-xs font-medium ${radarTimelineMode === 'unico' ? 'bg-cyan-500/30 text-cyan-200' : 'text-slate-300 hover:bg-slate-700'}`}>Radar único</button>
                            {radarTimelineMode === 'unico' && (
                              <select value={radarTimelineStation?.slug ?? intervalRadars[0]?.slug ?? ''} onChange={(e) => { const s = intervalRadars.find((r) => r.slug === e.target.value); setRadarTimelineStation(s ?? null); }} className="w-full mt-1 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200">
                                {intervalRadars.map((r) => <option key={r.slug} value={r.slug}>{r.name}</option>)}
                              </select>
                            )}
                            <div className="flex gap-1 pt-1">
                              <button type="button" onClick={() => setRadarProductType('reflectividade')} className={`flex-1 px-2 py-1 rounded text-xs ${radarProductType === 'reflectividade' ? 'bg-cyan-500/40 text-cyan-200' : 'bg-slate-700 text-slate-300'}`}>Reflet.</button>
                              <button type="button" onClick={() => setRadarProductType('velocidade')} className={`flex-1 px-2 py-1 rounded text-xs ${radarProductType === 'velocidade' ? 'bg-cyan-500/40 text-cyan-200' : 'bg-slate-700 text-slate-300'}`}>Doppler</button>
                            </div>
                            {radarProductType === 'velocidade' && (
                              <label className="flex items-center gap-2 mt-1 cursor-pointer group">
                                <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors ${superResEnabled ? 'bg-emerald-500 border-emerald-500' : 'border-slate-500 group-hover:border-emerald-500/50'}`}>
                                  {superResEnabled && <Check className="w-2.5 h-2.5 text-black" />}
                                </div>
                                <input type="checkbox" checked={superResEnabled} onChange={() => setSuperResEnabled(!superResEnabled)} className="hidden" />
                                <span className="text-xs text-slate-300 group-hover:text-white">Super Res</span>
                              </label>
                            )}
                            {radarTimelineTimestamps.length > 0 && (
                              <div className="pt-2 border-t border-slate-600 space-y-1">
                                <input type="range" min={0} max={radarTimelineTimestamps.length - 1} value={radarTimelineIndex} onChange={(e) => setRadarTimelineIndex(parseInt(e.target.value, 10) || 0)} className="w-full accent-cyan-500" />
                                <span className="text-[10px] font-mono text-cyan-300 block">
                                  {radarTimelineTimestamps[radarTimelineIndex]?.slice(0, 8)} {radarTimelineTimestamps[radarTimelineIndex]?.slice(8, 10)}:{radarTimelineTimestamps[radarTimelineIndex]?.slice(10, 12)}
                                </span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                    {/* Seção Online */}
                    {user && (
                      <div className="rounded-lg border border-slate-600 bg-slate-800/60 overflow-hidden">
                        <button type="button" onClick={() => setLeftPanelOnlineCollapsed((v) => !v)} className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-slate-700/50">
                          <span className="text-xs font-semibold text-emerald-400 flex items-center gap-1.5"><Users className="w-4 h-4" />Online {onlineUsers.length > 0 && <span className="text-emerald-300">({onlineUsers.length})</span>}</span>
                          <span className="text-slate-500">{leftPanelOnlineCollapsed ? '+' : '−'}</span>
                        </button>
                        {!leftPanelOnlineCollapsed && (
                          <div className="px-3 pb-3 space-y-2 max-h-48 overflow-y-auto">
                            <button type="button" onClick={() => setShowOnlineUsers((v) => !v)} className={`w-full text-left px-2 py-1.5 rounded text-xs ${showOnlineUsers ? 'bg-emerald-500/30 text-emerald-200' : 'text-slate-300 hover:bg-slate-700'}`}>
                              {showOnlineUsers ? 'Ocultar painel no mapa' : 'Mostrar painel no mapa'}
                            </button>
                            {locationPermission !== 'granted' ? (
                              <button type="button" onClick={requestLocation} className="w-full text-xs px-2 py-1.5 rounded border border-sky-500/50 text-sky-400">📍 Compartilhar localização</button>
                            ) : (
                              <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                                <input type="checkbox" checked={shareLocation} onChange={(e) => setShareLocation(e.target.checked)} className="rounded accent-emerald-500" />
                                Exibir no mapa
                              </label>
                            )}
                            {onlineUsers.slice(0, 6).map((u) => (
                              <div key={u.uid} className="flex items-center gap-2 py-1 cursor-default" onClick={() => { if (u.locationShared && u.lat && u.lng && mapInstanceRef.current) { mapInstanceRef.current.panTo({ lat: u.lat, lng: u.lng }); mapInstanceRef.current.setZoom(10); setMobileLeftPanel('none'); } }}>
                                {u.photoURL ? <img src={u.photoURL} alt="" className="w-6 h-6 rounded-full" /> : <div className="w-6 h-6 rounded-full bg-slate-600 flex items-center justify-center text-[10px] font-bold">{(u.displayName?.[0] ?? '?').toUpperCase()}</div>}
                                <span className="text-xs text-slate-200 truncate">{u.displayName}{u.uid === user?.uid && ' (você)'}</span>
                              </div>
                            ))}
                            {onlineUsers.length === 0 && <p className="text-[10px] text-slate-500 py-1">Nenhum online</p>}
                          </div>
                        )}
                      </div>
                    )}
                    {/* Seção Legenda — blocos fixos F0→F5 */}
                    <div className="rounded-xl border border-white/10 bg-[#0A0E17]/80 backdrop-blur-sm overflow-hidden">
                      <button type="button" onClick={() => setLeftPanelLegendaCollapsed((v) => !v)} className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-white/5 transition-colors">
                        <span className="text-[10px] font-bold tracking-widest uppercase text-cyan-400 flex items-center gap-2"><Layers className="w-4 h-4" />Legenda</span>
                        <span className="text-slate-500 text-sm">{leftPanelLegendaCollapsed ? '+' : '−'}</span>
                      </button>
                      {!leftPanelLegendaCollapsed && (
                        <div className="px-3 pb-4 space-y-4">
                          <div>
                            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Escala F (Fujita)</div>
                            <div className="flex w-full rounded-lg overflow-hidden border border-white/10 shadow-[0_0_12px_rgba(6,182,212,0.2)]">
                              {F_SCALE_ORDER.map((f) => (
                                <div
                                  key={f}
                                  className="flex-1 h-4 min-w-0"
                                  style={{ backgroundColor: TORNADO_TRACK_COLORS[f] }}
                                  title={f}
                                />
                              ))}
                            </div>
                            <div className="flex justify-between mt-1.5">
                              {F_SCALE_ORDER.map((f) => (
                                <span key={f} className="text-[9px] font-bold text-slate-400 flex-1 text-center">{f}</span>
                              ))}
                            </div>
                          </div>
                          <div className="pt-3 border-t border-white/10">
                            <button
                              type="button"
                              onClick={() => setPrevotsOverlayVisible((v) => !v)}
                              className={`w-full text-left px-3 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${
                                prevotsOverlayVisible ? 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 shadow-[0_0_8px_rgba(16,185,129,0.2)]' : 'border border-white/10 text-slate-400 hover:text-slate-200 hover:bg-white/5'
                              }`}
                            >
                              <span className="inline-block w-3 h-3 rounded flex-shrink-0" style={{ backgroundColor: prevotsOverlayVisible ? PREVOTS_LEVEL_COLORS[1] : '#475569' }} />
                              {prevotsOverlayVisible ? 'Overlay Prevots ativo' : 'Overlay Prevots'}
                            </button>
                            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mt-2">Tempestades (0–4)</div>
                            <div className="grid grid-cols-2 gap-x-2 gap-y-1 mt-1">
                              {[0, 1, 2, 3, 4].map((lvl) => (
                                <div key={lvl} className="flex items-center gap-2">
                                  <span className="w-3 h-2 rounded flex-shrink-0 border border-white/10" style={{ backgroundColor: PREVOTS_LEVEL_COLORS[lvl as 0|1|2|3|4] }} />
                                  <span className="text-slate-400 text-[10px] font-medium">{lvl === 0 ? 'Tempestades' : `Nível ${lvl}`}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </aside>

        {/* Mapa — centro com timeline na base */}
        <div className="flex flex-col flex-1 min-h-0 min-w-0">
        <div ref={mapContainerRef} className="flex-1 min-h-0 min-w-0 relative bg-[#0A0E17]/60">
          <div ref={mapRef} className="absolute inset-0 w-full h-full" />

          {/* Botões verticais à esquerda do mapa — Home, Zoom */}
          <div className="absolute left-2 top-2 z-10 flex flex-col gap-1">
            <button
              type="button"
              onClick={goToBrazil}
              className="flex items-center justify-center w-10 h-10 rounded-lg bg-slate-900/95 border border-slate-600 text-slate-200 hover:bg-slate-800 shadow-lg"
              title="Centralizar no Brasil"
              aria-label="Centralizar no Brasil"
            >
              <Home className="w-5 h-5" />
            </button>
            {measureMode && (
              <div className="bg-slate-900/95 border border-slate-600 rounded-lg p-2 text-xs">
                <p className="text-slate-400 mb-1">Clique no mapa para marcar pontos.</p>
                {measureDistanceKm != null && (
                  <p className="text-cyan-400 font-semibold">Distância: {measureDistanceKm} km</p>
                )}
                <button
                  type="button"
                  onClick={clearMeasure}
                  className="mt-1 text-slate-400 hover:text-white underline"
                >
                  Limpar
                </button>
              </div>
            )}
          </div>

          {/* Popup ao clicar no rastro — glassmorphism + badge F em destaque */}
          {selectedTrack && (
            <div
              ref={trackPopupRef}
              className="absolute z-20 w-[min(24rem,calc(100vw-2rem))] max-w-sm bg-[#0A0E17]/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-[0_10px_40px_rgba(0,0,0,0.6)] overflow-hidden animate-in fade-in duration-200"
              style={{ left: `${trackPopupPosition.x}px`, top: `${trackPopupPosition.y}px` }}
            >
              <div
                className={`flex items-center justify-between px-4 py-3 bg-black/20 select-none ${popupDragging ? 'cursor-grabbing' : 'cursor-move'} ${trackPopupMinimized ? '' : 'border-b border-white/10'}`}
                onPointerDown={startPopupDrag}
              >
                {(() => {
                  const maxF = getMaxIntensity(selectedTrack);
                  return maxF ? (
                    <span
                      className="flex-shrink-0 font-black text-base px-3 py-1.5 rounded-lg mr-2"
                      style={{ color: '#0A0E17', backgroundColor: TORNADO_TRACK_COLORS[maxF], boxShadow: `0 0 16px ${TORNADO_TRACK_COLORS[maxF]}90` }}
                    >
                      {maxF}
                    </span>
                  ) : null;
                })()}
                <span className="text-xs font-bold text-cyan-400 truncate flex-1 min-w-0 uppercase tracking-wider">
                  {selectedTrack.date} {selectedTrack.locality ? `· ${selectedTrack.locality}` : ''}
                </span>
                {typeof selectedTrack.views === 'number' && (
                  <span className="flex items-center gap-1 text-[11px] text-slate-400 shrink-0 ml-1" title="Visualizações">
                    <Eye className="w-3.5 h-3.5" />
                    {selectedTrack.views}
                  </span>
                )}
                <div className="flex items-center gap-0.5 shrink-0 ml-2">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setTrackPopupMinimized((v) => !v); }}
                    onPointerDown={(e) => e.stopPropagation()}
                    className="p-1.5 text-slate-400 hover:text-amber-400 rounded touch-manipulation"
                    aria-label={trackPopupMinimized ? 'Expandir' : 'Minimizar'}
                    title={trackPopupMinimized ? 'Expandir' : 'Minimizar'}
                  >
                    {trackPopupMinimized ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedTrack(null)}
                    onPointerDown={(e) => e.stopPropagation()}
                    className="p-1.5 text-slate-400 hover:text-white rounded touch-manipulation"
                    aria-label="Fechar"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
              {!trackPopupMinimized && (
              <div className="p-3 text-sm space-y-2 max-h-[60vh] overflow-y-auto">
                <dl className="grid gap-1.5">
                  <div>
                    <dt className="text-slate-500 text-xs">Data</dt>
                    <dd className="text-slate-200 font-medium">{selectedTrack.date}</dd>
                  </div>
                  {(prevotsForecastForTrack?.polygons?.length || selectedTrack.prevotsPolygons?.length) ? (
                    <div className="pt-2 border-t border-slate-600">
                      <dt className="text-slate-500 text-xs mb-1">Overlay Prevots</dt>
                      <dd>
                        <button
                          type="button"
                          onClick={() => setPrevotsOverlayVisible((v) => !v)}
                          className={`text-xs font-medium px-2 py-1 rounded border transition-colors flex items-center gap-1.5 ${
                            prevotsOverlayVisible
                              ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                              : 'border-slate-600 text-emerald-400 hover:text-emerald-300'
                          }`}
                        >
                          <span className="w-2 h-2 rounded flex-shrink-0" style={{ backgroundColor: prevotsOverlayVisible ? PREVOTS_LEVEL_COLORS[1] : '#475569' }} />
                          {prevotsOverlayVisible ? 'Overlay ativo' : 'Mostrar overlay'}
                        </button>
                        <span className="text-slate-500 text-[10px] ml-1.5">
                          {prevotsForecastForTrack?.polygons?.length
                            ? `Previsão do dia (${prevotsForecastForTrack.polygons.length} polígonos)`
                            : 'Polígonos do rastro'}
                        </span>
                      </dd>
                    </div>
                  ) : null}
                  <div>
                    <dt className="text-slate-500 text-xs">Categoria máxima (escala F)</dt>
                    <dd className="flex flex-wrap gap-1">
                      {(() => {
                        const maxF = getMaxIntensity(selectedTrack);
                        return maxF ? (
                          <span
                            className="font-mono text-xs font-medium px-1.5 py-0.5 rounded"
                            style={{ color: TORNADO_TRACK_COLORS[maxF] || '#888', backgroundColor: `${TORNADO_TRACK_COLORS[maxF] || '#444'}20` }}
                          >
                            {maxF}
                          </span>
                        ) : null;
                      })()}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500 text-xs">Local</dt>
                    <dd className="text-slate-200">
                      {selectedTrack.locality ? `${selectedTrack.locality}, ` : ''}{selectedTrack.state}
                      <span className="text-slate-400"> · {inferCountryFromTrack(selectedTrack)}</span>
                    </dd>
                  </div>
                  {selectedTrack.description && (
                    <div>
                      <dt className="text-slate-500 text-xs">Descrição</dt>
                      <dd className="text-slate-300">{selectedTrack.description}</dd>
                    </div>
                  )}
                  {selectedTrack.source && (
                    <div>
                      <dt className="text-slate-500 text-xs">Fonte</dt>
                      <dd className="text-slate-400 text-xs">{selectedTrack.source}</dd>
                    </div>
                  )}
                </dl>
                {(selectedTrack.beforeImage?.trim() || selectedTrack.afterImage?.trim()) && (
                  <div className="pt-2 border-t border-slate-600 space-y-2">
                    <dt className="text-slate-500 text-xs">Imagens Antes / Depois</dt>
                    {selectedTrack.beforeImage?.trim() && (
                      <div className="space-y-1">
                        <div className="flex flex-wrap gap-2 items-center">
                          <a
                            href={selectedTrack.beforeImage}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300 underline"
                          >
                            <ExternalLink className="w-3 h-3" />
                            Antes
                          </a>
                          {selectedTrack.beforeImageBounds && (
                            <button
                              type="button"
                              onClick={() => setOverlayBeforeVisible((v) => !v)}
                              className={`text-xs font-medium px-2 py-0.5 rounded border transition-colors ${overlayBeforeVisible ? 'bg-amber-500/20 border-amber-500/50 text-amber-300' : 'border-slate-600 text-amber-400 hover:text-amber-300'}`}
                            >
                              {overlayBeforeVisible ? 'Remover overlay' : 'Ver Antes no mapa'}
                            </button>
                          )}
                          {user?.type === 'admin' && (
                            <div className="flex items-center gap-1.5 ml-auto">
                              {imageMappingMode === 'before' ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={handleSaveImageBounds}
                                    disabled={isSavingImageBounds}
                                    className="px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold flex items-center gap-1"
                                  >
                                    {isSavingImageBounds ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                                    Salvar
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => { setImageMappingMode('none'); setTempBeforeImageBounds(null); }}
                                    className="px-2 py-0.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 text-[10px] font-bold"
                                  >
                                    Cancelar
                                  </button>
                                </>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => { setImageMappingMode('before'); setOverlayBeforeVisible(true); }}
                                  disabled={imageMappingMode !== 'none'}
                                  className="px-2 py-0.5 rounded border border-amber-500/50 text-amber-400 hover:bg-amber-500/10 text-[10px] font-bold flex items-center gap-1 disabled:opacity-50"
                                >
                                  <Layers className="w-3 h-3" />
                                  Ajustar bounds
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                        {overlayBeforeVisible && selectedTrack.beforeImageBounds && (
                          <div className="flex items-center gap-2 text-xs text-slate-400">
                            <span className="shrink-0">Opacidade:</span>
                            <input
                              type="range" min={0} max={1} step={0.05}
                              value={overlayBeforeOpacity}
                              onChange={(e) => setOverlayBeforeOpacity(parseFloat(e.target.value))}
                              className="flex-1 accent-amber-500"
                            />
                            <span className="w-8 text-right shrink-0">{Math.round(overlayBeforeOpacity * 100)}%</span>
                          </div>
                        )}
                      </div>
                    )}
                    {selectedTrack.afterImage?.trim() && (
                      <div className="space-y-1">
                        <div className="flex flex-wrap gap-2 items-center">
                          <a
                            href={selectedTrack.afterImage}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300 underline"
                          >
                            <ExternalLink className="w-3 h-3" />
                            Depois
                          </a>
                          {selectedTrack.afterImageBounds && (
                            <button
                              type="button"
                              onClick={() => setOverlayAfterVisible((v) => !v)}
                              className={`text-xs font-medium px-2 py-0.5 rounded border transition-colors ${overlayAfterVisible ? 'bg-amber-500/20 border-amber-500/50 text-amber-300' : 'border-slate-600 text-amber-400 hover:text-amber-300'}`}
                            >
                              {overlayAfterVisible ? 'Remover overlay' : 'Ver Depois no mapa'}
                            </button>
                          )}
                          {user?.type === 'admin' && (
                            <div className="flex items-center gap-1.5 ml-auto">
                              {imageMappingMode === 'after' ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={handleSaveImageBounds}
                                    disabled={isSavingImageBounds}
                                    className="px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold flex items-center gap-1"
                                  >
                                    {isSavingImageBounds ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                                    Salvar
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => { setImageMappingMode('none'); setTempAfterImageBounds(null); }}
                                    className="px-2 py-0.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 text-[10px] font-bold"
                                  >
                                    Cancelar
                                  </button>
                                </>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => { setImageMappingMode('after'); setOverlayAfterVisible(true); }}
                                  disabled={imageMappingMode !== 'none'}
                                  className="px-2 py-0.5 rounded border border-emerald-500/50 text-emerald-400 hover:bg-emerald-500/10 text-[10px] font-bold flex items-center gap-1 disabled:opacity-50"
                                >
                                  <Layers className="w-3 h-3" />
                                  Ajustar bounds
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                        {overlayAfterVisible && selectedTrack.afterImageBounds && (
                          <div className="flex items-center gap-2 text-xs text-slate-400">
                            <span className="shrink-0">Opacidade:</span>
                            <input
                              type="range" min={0} max={1} step={0.05}
                              value={overlayAfterOpacity}
                              onChange={(e) => setOverlayAfterOpacity(parseFloat(e.target.value))}
                              className="flex-1 accent-amber-500"
                            />
                            <span className="w-8 text-right shrink-0">{Math.round(overlayAfterOpacity * 100)}%</span>
                          </div>
                        )}
                      </div>
                    )}
                    {(selectedTrack.beforeImage?.trim() && selectedTrack.afterImage?.trim()) && (
                      <button
                        type="button"
                        onClick={() => setShowBeforeAfterDialog(true)}
                        className="w-full text-xs font-medium px-2 py-1.5 rounded border border-emerald-500/50 text-emerald-300 hover:bg-emerald-500/10 transition-colors"
                      >
                        Abrir comparador Antes/Depois (slider)
                      </button>
                    )}
                  </div>
                )}
                {selectedTrack.trackImage?.trim() && (
                  <div className="pt-2 border-t border-slate-600">
                    <dt className="text-slate-500 text-xs mb-1">Imagem do rastro</dt>
                    <dd className="flex flex-wrap gap-2 items-center">
                      <a
                        href={selectedTrack.trackImage}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300 underline"
                      >
                        <ExternalLink className="w-3 h-3" />
                        Ver imagem
                      </a>
                      {selectedTrack.trackImageBounds && (
                        <button
                          type="button"
                          onClick={() => setTrackImageOverlayVisible((v) => !v)}
                          className="text-xs font-medium text-amber-400 hover:text-amber-300"
                        >
                          {trackImageOverlayVisible ? 'Remover overlay' : 'Sobrepor no mapa'}
                        </button>
                      )}
                    </dd>
                  </div>
                )}
                {(selectedTrack.radarStationId || selectedTrack.radarWmsUrl?.trim() || selectedTrack.polygons?.length) && (
                  <div className="pt-2 border-t border-slate-600 space-y-2">
                    <dt className="text-slate-500 text-xs">
                      Radar
                      {radarStation ? ` (${radarStation.name})` : selectedTrack.radarWmsUrl ? ' (WMS)' : ''}
                    </dt>
                    {radarsWithin300km.length > 1 && (
                      <div>
                        <label className="text-slate-500 text-xs block mb-1">Mais de um radar no raio — selecione:</label>
                        <select
                          value={radarStation ? ('slug' in radarStation ? radarStation.slug : `argentina:${radarStation.id}`) : ''}
                          onChange={async (e) => {
                            const val = e.target.value;
                            const s = radarsWithin300km.find((r) => ('slug' in r ? r.slug : `argentina:${r.id}`) === val);
                            if (!s) return;
                            if (!selectedTrack?.time) {
                              setRadarStation(s);
                              return;
                            }
                            const isArg = !('slug' in s);
                            if (isArg) {
                              const argStation = s as ArgentinaRadarStation;
                              const dateStr = selectedTrack.date.replace(/-/g, '');
                              const [hh, mm] = selectedTrack.time.split(':').map(Number);
                              const center = hh * 60 + mm;
                              const startMin = Math.max(0, center - 180);
                              const endMin = Math.min(23 * 60 + 59, center + 180);
                              const interval = argStation.updateIntervalMinutes;
                              const argTs: string[] = [];
                              for (let t = Math.floor(startMin / interval) * interval; t <= endMin; t += interval) {
                                if (t < startMin) continue;
                                const h = Math.floor(t / 60);
                                const m = t % 60;
                                const d = new Date(Date.UTC(
                                  parseInt(dateStr.slice(0, 4), 10),
                                  parseInt(dateStr.slice(4, 6), 10) - 1,
                                  parseInt(dateStr.slice(6, 8), 10),
                                  h, m, 0
                                ));
                                argTs.push(getArgentinaRadarTimestamp(d, argStation));
                              }
                              setRadarStation(argStation);
                              setRadarTimestamps(argTs);
                              setRadarFrameIdx(findClosestArgentinaFrameIdx(argTs, selectedTrack.time));
                              return;
                            }
                            if ((s as CptecRadarStation).slug === 'chapeco') {
                              setRadarLoading(true);
                              setRadarError(null);
                              const configs = getChapecoFallbackConfigs(selectedTrack.date);
                              let ok = false;
                              for (const { interval, offset } of configs) {
                                const ts = generateRadarTimestamps(selectedTrack, interval, offset);
                                if (!ts.length) continue;
                                const probeIdx = findClosestRadarFrameIdx(ts, selectedTrack.time);
                                const url = buildNowcastingPngUrl(s as CptecRadarStation, ts[probeIdx].slice(0, 12), 'reflectividade');
                                if (await probeRadarImageExists(getProxiedRadarUrl(url))) {
                                  setRadarStation(s);
                                  setRadarTimestamps(ts);
                                  setRadarFrameIdx(probeIdx);
                                  ok = true;
                                  break;
                                }
                              }
                              setRadarLoading(false);
                              if (!ok) setRadarError('Nenhuma imagem encontrada para Chapecó.');
                              return;
                            }
                            setRadarStation(s);
                            const cptecS = s as CptecRadarStation;
                            const interval = cptecS.updateIntervalMinutes ?? 6;
                            const offset = cptecS.updateIntervalOffsetMinutes ?? 0;
                            const ts = generateRadarTimestamps(selectedTrack, interval, offset);
                            if (ts.length > 0) {
                              setRadarTimestamps(ts);
                              setRadarFrameIdx(findClosestRadarFrameIdx(ts, selectedTrack.time));
                            }
                          }}
                          className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm text-slate-200"
                        >
                          {radarsWithin300km.map((r) => (
                            <option key={'slug' in r ? r.slug : r.id} value={'slug' in r ? r.slug : `argentina:${r.id}`}>{r.name}</option>
                          ))}
                        </select>
                      </div>
                    )}
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        type="button"
                        onClick={() => {
                          if (!radarTimestamps.length && selectedTrack) loadRadarTimestamps(selectedTrack);
                          setRadarVisible((v) => !v);
                          setRadarPlaying(false);
                        }}
                        className={`text-xs font-medium px-2 py-1 rounded border transition-colors ${
                          radarVisible
                            ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300'
                            : 'border-slate-600 text-cyan-400 hover:text-cyan-300'
                        }`}
                      >
                        {radarVisible ? 'Ocultar radar' : 'Mostrar radar'}
                      </button>
                      {selectedTrack.radarWmsUrl?.trim() && (
                        <a
                          href={selectedTrack.radarWmsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300 underline"
                        >
                          <ExternalLink className="w-3 h-3" />
                          Abrir WMS
                        </a>
                      )}
                      {radarStation && ('slug' in radarStation) && (
                        <a
                          href="https://sigma.cptec.inpe.br/radar/"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300 underline"
                        >
                          <ExternalLink className="w-3 h-3" />
                          Abrir SIGMA
                        </a>
                      )}
                      {radarStation && !('slug' in radarStation) && (
                        <a
                          href="https://webmet.ohmc.ar/"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300 underline"
                        >
                          <ExternalLink className="w-3 h-3" />
                          Abrir OHMC
                        </a>
                      )}
                    </div>
                    {radarLoading && (
                      <span className="text-xs text-slate-400 flex items-center gap-1">
                        <Loader2 className="w-3 h-3 animate-spin" /> Preparando timeline do radar…
                      </span>
                    )}
                    {radarTimestamps.length > 0 && (
                      <div className="space-y-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <button
                            type="button"
                            onClick={() => setRadarFrameIdx((i) => Math.max(0, i - 1))}
                            className="px-1.5 py-0.5 rounded border border-slate-600 text-slate-300 hover:bg-slate-700 text-xs"
                          >◀</button>
                          <button
                            type="button"
                            onClick={() => setRadarPlaying((v) => !v)}
                            className={`px-2 py-0.5 rounded border text-xs font-medium transition-colors ${radarPlaying ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300' : 'border-slate-600 text-slate-300 hover:bg-slate-700'}`}
                          >
                            {radarPlaying ? '⏸ Pausar' : '▶ Animar'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setRadarFrameIdx((i) => Math.min(radarTimestamps.length - 1, i + 1))}
                            className="px-1.5 py-0.5 rounded border border-slate-600 text-slate-300 hover:bg-slate-700 text-xs"
                          >▶</button>
                          <span className="text-xs text-cyan-300 font-mono ml-auto">
                            {formatGoesTimestamp(radarTimestamps[radarFrameIdx])}
                          </span>
                        </div>
                        {radarStation && radarTimestamps.length > 0 && (('product' in radarStation && radarStation.product === 'ppi') || !('slug' in radarStation)) && (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-slate-400 shrink-0">Produto:</span>
                            <button
                              type="button"
                              onClick={() => setRadarProductType('reflectividade')}
                              className={`px-2 py-0.5 rounded border text-xs transition-colors ${radarProductType === 'reflectividade' ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300' : 'border-slate-600 text-slate-400 hover:bg-slate-700'}`}
                            >
                              Reflectividade
                            </button>
                            <button
                              type="button"
                              onClick={() => setRadarProductType('velocidade')}
                              className={`px-2 py-0.5 rounded border text-xs transition-colors ${radarProductType === 'velocidade' ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300' : 'border-slate-600 text-slate-400 hover:bg-slate-700'}`}
                            >
                              Doppler
                            </button>
                          </div>
                        )}
                        <input
                          type="range" min={0} max={radarTimestamps.length - 1} step={1}
                          value={radarFrameIdx}
                          onChange={(e) => { setRadarPlaying(false); setRadarFrameIdx(parseInt(e.target.value)); }}
                          className="w-full accent-cyan-500"
                        />
                      </div>
                    )}
                    {radarVisible && (
                      <div className="flex items-center gap-2 text-xs text-slate-400">
                        <span className="shrink-0">Opacidade:</span>
                        <input
                          type="range" min={0} max={1} step={0.05}
                          value={radarOpacity}
                          onChange={(e) => setRadarOpacity(parseFloat(e.target.value))}
                          className="flex-1 accent-cyan-500"
                        />
                        <span className="w-8 text-right shrink-0">{Math.round(radarOpacity * 100)}%</span>
                      </div>
                    )}
                    {radarVisible && user?.type === 'admin' && (
                      <button
                        type="button"
                        onClick={handleOpenRadarEdit}
                        className="w-full flex items-center justify-center gap-2 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold transition-all shadow-lg shadow-cyan-900/20"
                      >
                        <Settings className="w-3.5 h-3.5" />
                        Editar radar
                      </button>
                    )}
                    {radarVisible && (cptecAvailable && redemetAvailable && radarStation && 'slug' in radarStation && (radarStation.slug === 'santiago' || radarStation.slug === 'morroigreja')) && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-slate-500 mr-1">Fonte:</span>
                        <button
                          type="button"
                          onClick={() => setRadarSourceMode('superres')}
                          className={`text-[10px] font-semibold px-2 py-0.5 rounded transition-colors ${
                            radarSourceMode === 'superres'
                              ? 'bg-cyan-500/25 border border-cyan-500/60 text-cyan-300'
                              : 'border border-slate-600 text-slate-400 hover:text-slate-300'
                          }`}
                        >
                          Super Res
                        </button>
                        <button
                          type="button"
                          onClick={() => setRadarSourceMode('hd')}
                          className={`text-[10px] font-semibold px-2 py-0.5 rounded transition-colors ${
                            radarSourceMode === 'hd'
                              ? 'bg-amber-500/25 border border-amber-500/60 text-amber-300'
                              : 'border border-slate-600 text-slate-400 hover:text-slate-300'
                          }`}
                        >
                          HD
                        </button>
                      </div>
                    )}
                    {radarError && <p className="text-xs text-red-400">{radarError}</p>}
                    {/* Super Res toggle (popup radar section) */}
                    {radarVisible && radarProductType === 'velocidade' && (
                      <label className="flex items-center gap-2 cursor-pointer group">
                        <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors ${superResEnabled ? 'bg-emerald-500 border-emerald-500' : 'border-slate-500 group-hover:border-emerald-500/50'}`}>
                          {superResEnabled && <Check className="w-2.5 h-2.5 text-black" />}
                        </div>
                        <input type="checkbox" checked={superResEnabled} onChange={() => setSuperResEnabled(!superResEnabled)} className="hidden" />
                        <span className="text-xs text-slate-300 group-hover:text-white">Super Res (remove ruido)</span>
                      </label>
                    )}
                    {radarImageSource && !radarError && !(cptecAvailable && redemetAvailable && radarStation && 'slug' in radarStation && (radarStation.slug === 'santiago' || radarStation.slug === 'morroigreja')) && (
                      <p className="text-xs text-slate-400">Fonte: {radarImageSource === 'backup' ? 'Firebase Storage (Backup)' : radarImageSource === 'cptec' ? 'CPTEC (Super Res)' : 'REDEMET (HD)'}</p>
                    )}
                  </div>
                )}
                {/* Satélite GOES-16 IR */}
                {goesAvailable(selectedTrack) && (
                  <div className="pt-2 border-t border-slate-600 space-y-2">
                    <dt className="text-slate-500 text-xs">Satélite GOES-16 IR</dt>
                    {!goesTimestamps.length && !goesLoading && !goesError && (
                      <button
                        type="button"
                        onClick={() => { loadGoesTimestamps(selectedTrack); setGoesVisible(true); }}
                        className="text-xs font-medium px-2 py-1 rounded border border-slate-600 text-sky-400 hover:text-sky-300 hover:border-sky-500 transition-colors"
                      >
                        🛰 Carregar imagens GOES
                      </button>
                    )}
                    {goesLoading && (
                      <span className="text-xs text-slate-400 flex items-center gap-1">
                        <Loader2 className="w-3 h-3 animate-spin" /> Carregando timestamps…
                      </span>
                    )}
                    {goesError && (
                      <p className="text-xs text-red-400">{goesError}</p>
                    )}
                    {goesTimestamps.length > 0 && (
                      <div className="space-y-2">
                        {/* Controles de playback */}
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <button
                            type="button"
                            onClick={() => setGoesFrameIdx((i) => Math.max(0, i - 1))}
                            className="px-1.5 py-0.5 rounded border border-slate-600 text-slate-300 hover:bg-slate-700 text-xs"
                          >◀</button>
                          <button
                            type="button"
                            onClick={() => setGoesPlaying((v) => !v)}
                            className={`px-2 py-0.5 rounded border text-xs font-medium transition-colors ${goesPlaying ? 'bg-sky-500/20 border-sky-500/50 text-sky-300' : 'border-slate-600 text-slate-300 hover:bg-slate-700'}`}
                          >
                            {goesPlaying ? '⏸ Pausar' : '▶ Animar'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setGoesFrameIdx((i) => Math.min(goesTimestamps.length - 1, i + 1))}
                            className="px-1.5 py-0.5 rounded border border-slate-600 text-slate-300 hover:bg-slate-700 text-xs"
                          >▶</button>
                          <button
                            type="button"
                            onClick={() => { setGoesVisible((v) => !v); setGoesPlaying(false); }}
                            className={`px-2 py-0.5 rounded border text-xs transition-colors ml-auto ${goesVisible ? 'bg-sky-500/20 border-sky-500/50 text-sky-300' : 'border-slate-600 text-slate-400'}`}
                          >
                            {goesVisible ? 'Ocultar' : 'Mostrar'}
                          </button>
                        </div>
                        {/* Timestamp atual */}
                        <p className="text-xs text-sky-300 font-mono">
                          {formatGoesTimestamp(goesTimestamps[goesFrameIdx])}
                          <span className="text-slate-500 ml-1">({goesFrameIdx + 1}/{goesTimestamps.length})</span>
                        </p>
                        {/* Slider de frames */}
                        <input
                          type="range" min={0} max={goesTimestamps.length - 1} step={1}
                          value={goesFrameIdx}
                          onChange={(e) => { setGoesPlaying(false); setGoesFrameIdx(parseInt(e.target.value)); }}
                          className="w-full accent-sky-500"
                        />
                        {/* Opacidade */}
                        {goesVisible && (
                          <div className="flex items-center gap-2 text-xs text-slate-400">
                            <span className="shrink-0">Opacidade:</span>
                            <input
                              type="range" min={0} max={1} step={0.05}
                              value={goesOpacity}
                              onChange={(e) => setGoesOpacity(parseFloat(e.target.value))}
                              className="flex-1 accent-sky-500"
                            />
                            <span className="w-8 text-right shrink-0">{Math.round(goesOpacity * 100)}%</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Imagens Secundárias / Zoom */}
                {(selectedTrack.secondaryAfterImages?.length ?? 0) > 0 && (
                  <div className="pt-2 border-t border-slate-600 space-y-2">
                    <dt className="text-slate-500 text-xs">Imagens de Zoom / Detalhes</dt>
                    <div className="space-y-2">
                      {selectedTrack.secondaryAfterImages!.map((img, idx) => {
                        const isVisible = visibleSecondaryImageIds.includes(img.id);
                        const opacity = secondaryImageOpacities[img.id] ?? img.opacity ?? 0.8;
                        const rotation = secondaryImageRotations[img.id] ?? img.rotation ?? 0;
                        return (
                          <div key={img.id} className="bg-slate-800/80 rounded p-2 border border-slate-700 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <a href={img.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300 underline truncate">
                                <ExternalLink className="w-3 h-3 shrink-0" />
                                {img.description || `Zoom #${idx + 1}`}
                              </a>
                              
                              <label className="inline-flex items-center gap-1.5 text-slate-300 text-[10px] cursor-pointer shrink-0">
                                <input 
                                  type="checkbox" 
                                  checked={isVisible} 
                                  onChange={(e) => setVisibleSecondaryImageIds(prev => e.target.checked ? [...prev, img.id] : prev.filter(id => id !== img.id))} 
                                  className="rounded border-slate-500 bg-slate-900 text-emerald-500" 
                                />
                                Ver no mapa
                              </label>
                            </div>
                            {isVisible && (
                              <div className="flex items-center justify-between gap-3 pt-1">
                                <div className="flex items-center gap-2 flex-1">
                                  <span className="text-[10px] text-slate-400 shrink-0">Opacid:</span>
                                  <input
                                    type="range" min={0} max={1} step={0.05}
                                    value={opacity}
                                    onChange={(e) => setSecondaryImageOpacities(prev => ({ ...prev, [img.id]: parseFloat(e.target.value) }))}
                                    className="flex-1 accent-amber-500"
                                  />
                                </div>
                                <div className="flex items-center gap-2 w-24">
                                  <span className="text-[10px] text-slate-400 shrink-0">Rot(º):</span>
                                  <input
                                    type="number" step="0.1"
                                    value={rotation}
                                    onChange={(e) => setSecondaryImageRotations(prev => ({ ...prev, [img.id]: parseFloat(e.target.value) }))}
                                    className="w-full bg-slate-900 border border-slate-700 rounded px-1 py-0.5 text-xs text-center text-slate-300"
                                  />
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Controles do polígono */}
                {selectedTrack.polygons?.length > 0 && (
                  <div className="pt-2 border-t border-slate-600 space-y-2">
                    <dt className="text-slate-500 text-xs">Polígono do rastro</dt>
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        type="button"
                        onClick={() => setPolygonVisible((v) => !v)}
                        className={`text-xs font-medium px-2 py-1 rounded border transition-colors ${polygonVisible ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300' : 'border-slate-600 text-slate-400 hover:text-slate-200'}`}
                      >
                        {polygonVisible ? 'Ocultar polígono' : 'Mostrar polígono'}
                      </button>
                      {polygonVisible && (
                        <button
                          type="button"
                          onClick={() => setPolygonFillVisible((v) => !v)}
                          className={`text-xs font-medium px-2 py-1 rounded border transition-colors ${!polygonFillVisible ? 'bg-slate-500/30 border-slate-400/50 text-slate-200' : 'border-slate-600 text-slate-400 hover:text-slate-200'}`}
                        >
                          {polygonFillVisible ? 'Apenas linhas' : 'Com preenchimento'}
                        </button>
                      )}
                    </div>
                    {polygonVisible && (
                      <div className="flex items-center gap-2 text-xs text-slate-400">
                        <span className="shrink-0">Espessura:</span>
                        <input
                          type="range" min={0.5} max={8} step={0.5}
                          value={polygonStrokeWeight}
                          onChange={(e) => setPolygonStrokeWeight(parseFloat(e.target.value))}
                          className="flex-1 accent-cyan-500"
                        />
                        <span className="w-6 text-right shrink-0">{polygonStrokeWeight}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
              )}
              {!trackPopupMinimized && (
              <div className="px-3 py-2 border-t border-slate-600 bg-slate-800/50 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={zoomToTrack}
                  className="flex items-center gap-1.5 text-xs font-medium text-amber-400 hover:text-amber-300"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                  Centralizar no mapa
                </button>
                <button
                  type="button"
                  onClick={() => selectedTrack && handleShareTrack(selectedTrack)}
                  className="flex items-center gap-1.5 text-xs font-medium text-cyan-400 hover:text-cyan-300"
                >
                  <Share2 className="w-3.5 h-3.5" />
                  Compartilhar rastro
                </button>
                {shareFeedback && (
                  <span className="text-[10px] text-slate-300 ml-auto">{shareFeedback}</span>
                )}
              </div>
              )}
            </div>
          )}

          {showBeforeAfterDialog && selectedTrack?.beforeImage?.trim() && selectedTrack?.afterImage?.trim() && (
            <div className="absolute bottom-3 left-3 z-30 w-[min(72rem,calc(100%-1.5rem))] pointer-events-none">
              <div className="bg-slate-900/95 border border-slate-700 rounded-xl shadow-2xl overflow-hidden pointer-events-auto">
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700 bg-slate-800">
                  <h3 className="text-sm font-semibold text-emerald-300">
                    Comparador Antes/Depois
                  </h3>
                  <button
                    type="button"
                    onClick={() => setShowBeforeAfterDialog(false)}
                    className="p-1 rounded text-slate-400 hover:text-white"
                    aria-label="Fechar comparador"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="p-3">
                  <BeforeAfterCompare
                    beforeUrl={selectedTrack.beforeImage.trim()}
                    afterUrl={selectedTrack.afterImage.trim()}
                    beforeLabel="Antes"
                    afterLabel="Depois"
                    className="w-full max-h-[56vh]"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Botão Galeria de Mapa Base */}
          <div className="absolute top-2 right-2 z-10">
            <button
              type="button"
              onClick={() => setShowBaseMapGallery((v) => !v)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-900/95 border border-slate-600 text-slate-200 hover:bg-slate-800 shadow-lg"
            >
              <Layers className="w-4 h-4" />
              <span className="text-sm font-medium">Mapa base</span>
            </button>
            {showBaseMapGallery && (
              <>
                <div className="absolute inset-0 -z-10" aria-hidden onClick={() => setShowBaseMapGallery(false)} />
                <div className="absolute top-full right-0 mt-1 w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-slate-600 bg-slate-900 shadow-xl p-3 animate-in fade-in slide-in-from-top-2 duration-150">
                  <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
                    Galeria de mapa base
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {BASE_MAP_OPTIONS.map((opt) => {
                      const isSelected = baseMapId === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => {
                            setBaseMapId(opt.id);
                            setShowBaseMapGallery(false);
                          }}
                          className={`rounded-lg overflow-hidden border-2 text-left transition-all hover:border-amber-500/50 ${
                            isSelected ? 'border-amber-500 ring-1 ring-amber-500/30' : 'border-slate-600'
                          }`}
                        >
                          <div className="aspect-[3/2] relative bg-slate-800">
                            {opt.previewType === 'static' && opt.staticMapType ? (
                              getStaticMapPreviewUrl(opt.staticMapType) ? (
                                <img
                                  src={getStaticMapPreviewUrl(opt.staticMapType)}
                                  alt=""
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-slate-500">
                                  <Layers className="w-8 h-8" />
                                </div>
                              )
                            ) : (
                              <div
                                className="w-full h-full"
                                style={{ backgroundColor: opt.placeholderBg }}
                              />
                            )}
                            {isSelected && (
                              <div className="absolute top-1 right-1 rounded-full bg-amber-500 p-0.5">
                                <Check className="w-3 h-3 text-black" />
                              </div>
                            )}
                          </div>
                          <div className="px-2 py-1.5 bg-slate-800/80 text-xs font-medium text-slate-200 truncate">
                            {opt.label}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Painel Usuários Online */}
          {showOnlineUsers && user && (
            <div className="absolute bottom-2 left-2 sm:bottom-16 z-20 w-[calc(100vw-1rem)] sm:w-64 max-w-64 max-h-[45vh] sm:max-h-none bg-slate-900/98 border border-emerald-500/40 rounded-lg shadow-2xl overflow-hidden flex flex-col">
              <div className="flex items-center justify-between px-3 py-2 bg-slate-800/80 border-b border-slate-700">
                <span className="text-xs font-semibold text-emerald-400 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  Online ({onlineUsers.length})
                </span>
                <button type="button" onClick={() => setShowOnlineUsers(false)} className="text-slate-400 hover:text-white">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Minha localização */}
              <div className="px-3 py-2 border-b border-slate-700 space-y-1.5">
                {locationPermission !== 'granted' ? (
                  <button
                    type="button"
                    onClick={requestLocation}
                    className="w-full text-xs px-2 py-1.5 rounded border border-sky-500/50 text-sky-400 hover:bg-sky-500/10 transition-colors"
                  >
                    📍 Compartilhar minha localização
                  </button>
                ) : (
                  <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={shareLocation}
                      onChange={(e) => setShareLocation(e.target.checked)}
                      className="rounded accent-emerald-500"
                    />
                    Exibir minha localização no mapa
                  </label>
                )}
                {locationPermission === 'denied' && (
                  <p className="text-xs text-red-400">Permissão negada pelo navegador.</p>
                )}
              </div>

              {/* Lista de usuários */}
              <div className="flex-1 min-h-0 max-h-36 sm:max-h-56 overflow-y-auto divide-y divide-slate-700/50">
                {onlineUsers.length === 0 ? (
                  <p className="px-3 py-3 text-xs text-slate-500 text-center">Nenhum usuário online agora.</p>
                ) : (
                  onlineUsers.map((u) => (
                    <div
                      key={u.uid}
                      className="flex items-center gap-2 px-3 py-2 hover:bg-slate-800/50 transition-colors cursor-default"
                      onClick={() => {
                        if (u.locationShared && u.lat && u.lng && mapInstanceRef.current) {
                          mapInstanceRef.current.panTo({ lat: u.lat, lng: u.lng });
                          mapInstanceRef.current.setZoom(10);
                        }
                      }}
                    >
                      {/* Avatar */}
                      {u.photoURL ? (
                        <img src={u.photoURL} alt={u.displayName} className="w-7 h-7 rounded-full object-cover flex-shrink-0 border border-slate-600" />
                      ) : (
                        <div className="w-7 h-7 rounded-full bg-slate-600 flex items-center justify-center flex-shrink-0 text-xs font-bold text-white">
                          {(u.displayName?.[0] ?? '?').toUpperCase()}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-slate-200 truncate">
                          {u.displayName}
                          {u.uid === user.uid && <span className="text-emerald-400 ml-1">(você)</span>}
                        </p>
                        <p className="text-slate-500 text-[10px]">
                          {u.userType ? getRastrosUserTypeLabel(u.userType) : '—'}
                          {u.locationShared && ' · 📍 localização visível'}
                        </p>
                      </div>
                      {/* Indicador online */}
                      <span className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" />
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

        </div>

        {/* Timeline — slider teal neon */}
        <div className="flex-shrink-0 px-4 py-3 bg-[#0A0E17]/90 backdrop-blur-xl border-t border-white/10 shadow-[0_-4px_20px_rgba(0,0,0,0.4)]">
          <div className="flex flex-col sm:flex-row items-center gap-3 max-w-2xl mx-auto">
            <span className="text-xs font-bold text-slate-400 shrink-0 uppercase tracking-wider">
              {timelineCurrentDate ? `${timelineCurrentDate.replace(/(\d{4})-(\d{2})-(\d{2})/, '$3/$2/$1')}` : 'Selecione datas'}
            </span>
            <div className="flex items-center gap-3 flex-1 w-full">
              <button
                type="button"
                onClick={() => { setTimelineEnabled((v) => !v); setTimelinePlaying(false); }}
                className={`px-3 py-2 rounded-xl text-xs font-bold uppercase tracking-wider shrink-0 transition-all ${timelineEnabled ? 'bg-cyan-500 text-slate-900 shadow-[0_0_15px_rgba(6,182,212,0.5)]' : 'bg-white/5 border border-white/10 text-slate-400 hover:text-white hover:border-cyan-500/30'}`}
              >
                Timeline
              </button>
              {timelineEnabled && (
                <>
                  <button type="button" onClick={() => setTimelinePlaying((v) => !v)} className="p-2 rounded-xl bg-white/5 hover:bg-cyan-500/20 border border-white/10 text-slate-300 hover:text-cyan-400 shrink-0 transition-all" title={timelinePlaying ? 'Pausar' : 'Reproduzir'}>
                    {timelinePlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  </button>
                  {/* Botão para abrir menu de radares da timeline */}
                  <button type="button" onClick={() => setShowTimelineRadarMenu(v => !v)} className={`p-2 rounded-xl border shrink-0 transition-all ${showTimelineRadarMenu ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-400' : 'bg-white/5 border-white/10 text-slate-300 hover:text-cyan-400 hover:bg-cyan-500/10'}`} title="Radares e Doppler">
                    <Radar className="w-4 h-4" />
                  </button>
                  <select
                    value={timelineSpeed}
                    onChange={(e) => setTimelineSpeed(Number(e.target.value) as 1 | 2 | 5)}
                    className="bg-transparent text-slate-300 text-[10px] font-bold outline-none cursor-pointer hover:text-cyan-400 transition-colors"
                  >
                    <option value={1} className="bg-slate-900">1x</option>
                    <option value={2} className="bg-slate-900">2x</option>
                    <option value={5} className="bg-slate-900">5x</option>
                  </select>
                  <input
                    type="range"
                    min={0}
                    max={Math.max(0, radarTimelineTimestamps.length > 0 ? radarTimelineTimestamps.length - 1 : timelineDates.length - 1)}
                    step={1}
                    value={Math.min(radarTimelineTimestamps.length > 0 ? radarTimelineIndex : timelineIndex, Math.max(0, radarTimelineTimestamps.length > 0 ? radarTimelineTimestamps.length - 1 : timelineDates.length - 1))}
                    onChange={(e) => {
                      setTimelinePlaying(false);
                      const idx = parseInt(e.target.value, 10) || 0;
                      if (radarTimelineTimestamps.length > 0) setRadarTimelineIndex(idx);
                      else setTimelineIndex(idx);
                    }}
                    className="flex-1 h-2 rounded-full bg-slate-800 accent-cyan-500 [&::-webkit-slider-thumb]:shadow-[0_0_10px_rgba(6,182,212,0.8)] cursor-pointer"
                    disabled={radarTimelineTimestamps.length > 0 ? radarTimelineTimestamps.length <= 1 : timelineDates.length <= 1}
                  />
                  <span className="text-[10px] text-cyan-400 font-bold font-mono min-w-[80px] text-center drop-shadow-[0_0_6px_rgba(6,182,212,0.6)]">{timelineCurrentDate || '--'}</span>
                </>
              )}
            </div>
          </div>
        </div>
        </div>


        {/* Menu de radares da timeline */}
        {showTimelineRadarMenu && timelineEnabled && (
          <div className="absolute top-16 left-4 z-[1000] bg-[#0F1629]/95 border border-white/10 rounded-2xl p-4 w-64 max-h-[60vh] overflow-y-auto shadow-[0_0_30px_rgba(0,0,0,0.5)] backdrop-blur-xl">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-white uppercase tracking-wider">Radares da Timeline</h3>
              <button type="button" onClick={() => setShowTimelineRadarMenu(false)} className="text-slate-500 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex gap-1 mb-3">
              <button type="button" onClick={() => setTimelineProductType('reflectividade')} className={`flex-1 px-2 py-1.5 rounded-lg text-[10px] font-bold uppercase transition-all ${timelineProductType === 'reflectividade' ? 'bg-cyan-500 text-slate-900' : 'bg-white/5 text-slate-400 hover:text-white border border-white/10'}`}>Reflet.</button>
              <button type="button" onClick={() => setTimelineProductType('velocidade')} className={`flex-1 px-2 py-1.5 rounded-lg text-[10px] font-bold uppercase transition-all ${timelineProductType === 'velocidade' ? 'bg-purple-500 text-white' : 'bg-white/5 text-slate-400 hover:text-white border border-white/10'}`}>Doppler</button>
            </div>
            <div className="flex gap-1 mb-2">
              <button type="button" onClick={() => setTimelineSelectedRadars(new Set(intervalRadars.map(r => r.slug)))} className="flex-1 text-[9px] text-cyan-400 hover:text-cyan-300 font-bold">Todos</button>
              <button type="button" onClick={() => setTimelineSelectedRadars(new Set())} className="flex-1 text-[9px] text-slate-500 hover:text-slate-300 font-bold">Nenhum</button>
            </div>
            <div className="space-y-1">
              {intervalRadars.map(r => (
                <label key={r.slug} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/5 cursor-pointer transition-colors">
                  <input
                    type="checkbox"
                    checked={timelineSelectedRadars.has(r.slug)}
                    onChange={(e) => {
                      setTimelineSelectedRadars(prev => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(r.slug);
                        else next.delete(r.slug);
                        return next;
                      });
                    }}
                    className="w-3.5 h-3.5 rounded accent-cyan-500 cursor-pointer"
                  />
                  <div className="flex flex-col">
                    <span className="text-xs text-slate-300">{r.name}</span>
                    {timelineSelectedRadars.has(r.slug) && (
                      <span className="text-[10px] text-teal-400/80 font-mono -mt-0.5">
                        {timelineFoundTimes[r.slug] 
                          ? `${timelineFoundTimes[r.slug].substring(6,8)}/${timelineFoundTimes[r.slug].substring(4,6)} ${timelineFoundTimes[r.slug].substring(8,10)}:${timelineFoundTimes[r.slug].substring(10,12)}` 
                          : 'Buscando...'}
                      </span>
                    )}
                  </div>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Backdrop para fechar painel Eventos no mobile */}
        {showMobileEventsPanel && (
          <div
            className="md:hidden fixed inset-0 z-40 bg-black/50"
            aria-hidden
            onClick={() => setShowMobileEventsPanel(false)}
          />
        )}
        {/* Barra lateral Eventos — glassmorphism */}
        <aside
          className={`
            flex flex-col bg-[#0A0E17]/95 backdrop-blur-xl border-l border-white/10
            ${showMobileEventsPanel ? 'flex' : 'hidden'} md:flex
            fixed inset-y-0 right-0 z-50 w-[min(20rem,85vw)] shadow-2xl
            md:relative md:inset-auto md:z-auto md:shadow-none md:w-12 md:max-w-xs
            md:flex-shrink-0 md:transition-[width] md:duration-200
            ${sidebarCollapsed ? 'md:!w-12' : 'md:!w-full'}
          `}
        >
          {sidebarCollapsed ? (
            <div className="flex flex-col items-center py-4 gap-2">
              <button
                type="button"
                onClick={() => setSidebarCollapsed(false)}
                className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
                title="Expandir Eventos"
                aria-label="Expandir Eventos"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <span className="text-[10px] text-slate-500 uppercase tracking-wider" style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}>
                Eventos
              </span>
            </div>
          ) : (
            selectedTrack ? (
              <MeteorologistCommentsPanel
                trackId={selectedTrack.id}
                currentUser={user}
                userRole={user?.type === 'admin' ? 'admin' : (rastrosProfile?.userType || null)}
                onClose={() => { setSidebarCollapsed(true); setShowMobileEventsPanel(false); }}
                isMobile={showMobileEventsPanel}
                onFlyToLocation={(lat, lng) => {
                  mapInstanceRef.current?.panTo({ lat, lng });
                  mapInstanceRef.current?.setZoom(14);
                }}
              />
            ) : (
            <>
              <div className="flex items-center justify-between flex-shrink-0 p-3 border-b border-white/10">
                <h3 className="font-bold text-cyan-400 text-xs uppercase tracking-widest flex items-center gap-2">
                  <Info className="w-4 h-4" />
                  Eventos
                </h3>
                <button
                  type="button"
                  onClick={() => { setSidebarCollapsed(true); setShowMobileEventsPanel(false); }}
                  className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 md:block"
                  title="Fechar"
                  aria-label="Fechar"
                >
                  <X className="w-5 h-5 md:hidden" />
                  <ChevronRight className="w-5 h-5 hidden md:block" />
                </button>
              </div>
              <p className="flex-shrink-0 px-3 py-2 text-slate-500 text-xs border-b border-slate-700">
                Clique em um rastro no mapa para ver detalhes. Passe o mouse para comparar Antes/Depois (se houver imagens).
              </p>

              {/* Gráficos de frequência — tema teal/neon */}
              <div className="flex-shrink-0 border-b border-white/10 p-4 space-y-4 bg-[#0A0E17]/40">
                <div className="flex items-center gap-2 text-cyan-400 text-[10px] font-bold uppercase tracking-widest">
                  Frequência por período
                </div>
                <div className="flex rounded-xl border border-white/10 overflow-hidden bg-black/30">
                  {(['all', 'sig', 'vio'] as const).map((key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setChartTypeFilter(key)}
                      className={`flex-1 px-2 py-2 text-xs font-bold uppercase tracking-wider transition-all ${
                        chartTypeFilter === key ? 'bg-cyan-500 text-slate-900 shadow-[0_0_12px_rgba(6,182,212,0.5)]' : 'text-slate-400 hover:bg-white/5 hover:text-white'
                      }`}
                    >
                      {key === 'all' ? 'Todos' : key === 'sig' ? 'Sig (F2+)' : 'Vio (F4+)'}
                    </button>
                  ))}
                </div>
                <div>
                  <div className="text-slate-500 text-[10px] font-bold uppercase tracking-widest mb-2">
                    Por mês (Jan–Dez)
                  </div>
                  <div className="flex gap-0.5 items-end">
                    {frequencyByMonth.map((count, i) => (
                      <div
                        key={i}
                        className="flex-1 min-w-0 flex flex-col items-center gap-0.5"
                        title={`${monthNames[i]}: ${count}`}
                      >
                        <div className="h-12 w-full flex flex-col justify-end">
                          <div
                            className="w-full rounded-t transition-all shadow-[0_0_8px_rgba(6,182,212,0.3)]"
                            style={{ height: `${Math.max((count / maxMonthCount) * 100, count ? 4 : 0)}%`, background: 'linear-gradient(to top, rgba(6,182,212,0.5), rgba(34,211,238,0.9))' }}
                          />
                        </div>
                        <span className="text-[9px] text-slate-500 font-medium truncate w-full text-center">{monthNames[i]}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500 text-[10px] font-bold uppercase tracking-widest mb-2">
                    Por estação
                  </div>
                  <div className="flex items-end gap-1 h-14 w-full">
                    {frequencyBySeason.map(({ season, count }) => (
                      <div
                        key={season}
                        className="flex-1 min-w-0 flex flex-col items-center gap-0.5"
                        title={`${season}: ${count}`}
                      >
                        <div className="h-12 w-full flex flex-col justify-end">
                          <div
                            className="w-full rounded-t transition-all shadow-[0_0_8px_rgba(6,182,212,0.3)]"
                            style={{ height: `${Math.max((count / maxSeasonCount) * 100, count ? 4 : 0)}%`, background: 'linear-gradient(to top, rgba(6,182,212,0.5), rgba(34,211,238,0.9))' }}
                          />
                        </div>
                        <span className="text-[9px] text-slate-500 font-medium truncate w-full text-center">{season}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="pt-4 border-t border-white/10 space-y-3">
                  <div className="text-slate-500 text-[10px] font-bold uppercase tracking-widest">
                    País / Estados mais ativos
                  </div>
                  <select
                    value={dashboardCountry}
                    onChange={(e) => setDashboardCountry(e.target.value)}
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 outline-none"
                  >
                    <option value="all">Todos os países</option>
                    {countriesInDashboard.map((country) => (
                      <option key={country} value={country}>
                        {country}
                      </option>
                    ))}
                  </select>
                  <div className="space-y-2">
                    {countryCounts.slice(0, 4).map((c) => (
                      <div key={c.country} className="flex items-center justify-between text-[10px] text-slate-300">
                        <span className="truncate font-medium">{c.country}</span>
                        <span className="font-bold text-cyan-400">{c.count}</span>
                      </div>
                    ))}
                  </div>
                  <div className="space-y-1.5">
                    {stateCountsByCountry.length === 0 ? (
                      <p className="text-[10px] text-slate-500">Sem rastros para este país.</p>
                    ) : (
                      stateCountsByCountry.map((s) => (
                        <div key={s.state} className="flex items-center gap-2">
                          <span className="w-10 text-[10px] text-slate-400 truncate font-medium">{s.state}</span>
                          <div className="flex-1 h-2 rounded-full bg-slate-800 overflow-hidden border border-white/5">
                            <div
                              className="h-full rounded-full transition-all bg-gradient-to-r from-cyan-600 to-cyan-400 shadow-[0_0_6px_rgba(6,182,212,0.4)]"
                              style={{ width: `${Math.max((s.count / maxStateCount) * 100, 8)}%` }}
                            />
                          </div>
                          <span className="w-5 text-right text-[10px] font-bold text-cyan-400">{s.count}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto p-2">
                {tracksLoading ? (
                  <div className="flex justify-center py-6 text-slate-500 text-sm">Carregando…</div>
                ) : (
                  <ul className="space-y-2">
                    {displayedTracks.map((t) => {
                      const maxF = getMaxIntensity(t);
                      return (
                        <li key={t.id}>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedTrack(t);
                              const key = `viewed_track_${t.id}`;
                              if (!sessionStorage.getItem(key)) {
                                sessionStorage.setItem(key, '1');
                                incrementTrackViews(t.id).catch(console.error);
                              }
                            }}
                            className="w-full text-left rounded-xl p-3 bg-[#0A0E17]/60 hover:bg-white/5 border border-white/10 hover:border-cyan-500/30 transition-all group"
                          >
                            <div className="flex items-start gap-3">
                              {maxF && (
                                <span
                                  className="flex-shrink-0 font-black text-sm px-2.5 py-1 rounded-lg border border-white/10 shadow-lg"
                                  style={{ color: '#0A0E17', backgroundColor: TORNADO_TRACK_COLORS[maxF] || '#888', boxShadow: `0 0 12px ${TORNADO_TRACK_COLORS[maxF] || '#444'}80` }}
                                >
                                  {maxF}
                                </span>
                              )}
                              <div className="flex-1 min-w-0">
                                <h3 className="font-bold text-white text-sm">{t.date}</h3>
                                <span className="mx-1 text-slate-500">·</span>
                                <span className="text-slate-300 text-sm">{t.locality || t.state}</span>
                                <span className="ml-2 text-[10px] text-slate-500 uppercase font-medium">
                                  {inferCountryFromTrack(t)}
                                </span>
                                {(t.beforeImage?.trim() && t.afterImage?.trim()) && (
                                  <span className="ml-2 text-[10px] text-emerald-400">Antes/Depois</span>
                                )}
                                {(typeof t.views === 'number') && (
                                  <span className="ml-2 text-[10px] text-slate-400 inline-flex items-center gap-1" title="Visualizações">
                                    <Eye className="w-3 h-3" />
                                    {t.views}
                                  </span>
                                )}
                              </div>
                            </div>
                            <RecentCommentPreview trackId={t.id} />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {!tracksLoading && displayedTracks.length === 0 && (
                  <p className="text-slate-500 text-sm py-4">Nenhum rastro nos filtros.</p>
                )}
              </div>
            </>
            )
          )}
        </aside>
      </div>

      {/* Painel de Edição de Radar (Admin) - Floating and Draggable */}
      {isRadarEditMode && selectedTrack && (
        <div 
          ref={radarEditRef}
          style={{ left: radarEditPosition.x, top: radarEditPosition.y }}
          className={`fixed z-[100] w-[320px] sm:w-[384px] overflow-hidden flex flex-col shadow-2xl bg-slate-900 border border-slate-700 rounded-2xl transition-shadow duration-200 ${radarEditDraggingRef.current ? 'shadow-cyan-500/20 ring-1 ring-cyan-500/30' : ''}`}
        >
          <div 
            onPointerDown={startRadarEditDrag}
            className="flex items-center justify-between p-3 sm:p-4 border-b border-slate-800 bg-slate-800/50 cursor-move"
          >
            <div className="flex items-center gap-2">
              <Radar className="w-4 h-4 sm:w-5 h-5 text-cyan-400" />
              <h3 className="font-bold text-white text-xs sm:text-sm">Editar Radar (Rastro)</h3>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => setRadarEditMinimized(!radarEditMinimized)} className="p-1 hover:bg-slate-700 rounded-full transition-colors text-slate-400 hover:text-white" title={radarEditMinimized ? "Expandir" : "Minimizar"}>
                {radarEditMinimized ? <ChevronDown className="w-4 h-4 sm:w-5 h-5" /> : <ChevronUp className="w-4 h-4 sm:w-5 h-5" />}
              </button>
              <button onClick={() => setIsRadarEditMode(false)} className="p-1 hover:bg-slate-700 rounded-full transition-colors text-slate-400 hover:text-white" title="Fechar">
                <X className="w-4 h-4 sm:w-5 h-5" />
              </button>
            </div>
          </div>
          
          {!radarEditMinimized && (
            <>
              <div className="flex-1 overflow-y-auto p-4 space-y-5 custom-scrollbar bg-slate-900/50 max-h-[70vh]">
                <div className="space-y-4">
                   <div className="space-y-2">
                     <div className="flex justify-between text-xs text-slate-400 uppercase tracking-wider font-semibold">
                       <span>Rotação</span>
                       <span className="text-cyan-400 font-mono">{editRadarRotation}°</span>
                     </div>
                     <input type="range" min={-180} max={180} step={0.5} value={editRadarRotation} onChange={e => setEditRadarRotation(parseFloat(e.target.value))} className="w-full accent-cyan-500" />
                   </div>

                   <div className="space-y-2">
                     <div className="flex justify-between text-xs text-slate-400 uppercase tracking-wider font-semibold">
                       <span>Opacidade</span>
                       <span className="text-cyan-400 font-mono">{Math.round(editRadarOpacity * 100)}%</span>
                     </div>
                     <input type="range" min={0} max={1} step={0.01} value={editRadarOpacity} onChange={e => setEditRadarOpacity(parseFloat(e.target.value))} className="w-full accent-cyan-500" />
                   </div>

                   <div className="space-y-2">
                     <div className="flex justify-between text-xs text-slate-400 uppercase tracking-wider font-semibold mb-1">
                       <span>Centro da Antena</span>
                       <button 
                        onClick={() => {
                          setEditRadarLat(radarStation?.lat || 0);
                          setEditRadarLng(radarStation?.lng || 0);
                        }}
                        className="text-[10px] text-cyan-500 hover:underline"
                       >Resetar p/ padrão</button>
                     </div>
                     <div className="grid grid-cols-2 gap-2">
                       <div className="space-y-1">
                         <span className="text-[10px] text-slate-500 uppercase">Latitude</span>
                         <input type="text" value={editRadarLat} onChange={e => setEditRadarLat(parseCoord(e.target.value))} className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-cyan-300" />
                       </div>
                       <div className="space-y-1">
                         <span className="text-[10px] text-slate-500 uppercase">Longitude</span>
                         <input type="text" value={editRadarLng} onChange={e => setEditRadarLng(parseCoord(e.target.value))} className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-cyan-300" />
                       </div>
                     </div>
                   </div>

                   <div className="space-y-2">
                     <div className="flex justify-between text-xs text-slate-400 uppercase tracking-wider font-semibold">
                       <span>Raio do Radar (km)</span>
                       <span className="text-cyan-400 font-mono">{editRadarRangeKm} km</span>
                     </div>
                     <input type="range" min={50} max={1000} step={1} value={editRadarRangeKm} onChange={e => setEditRadarRangeKm(parseInt(e.target.value))} className="w-full accent-cyan-500" />
                   </div>

                   <div className="pt-2 border-t border-slate-800">
                     <div className="flex items-center justify-between mb-2">
                        <div className="flex flex-col">
                          <span className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Mapeamento Livre</span>
                          <span className="text-[10px] text-slate-500">Desenhar área manualmente no mapa</span>
                        </div>
                        <input type="checkbox" checked={useEditCustomBounds} onChange={e => setUseEditCustomBounds(e.target.checked)} className="w-4 h-4 accent-cyan-500" />
                     </div>
                   </div>

                   <div className="pt-2 border-t border-slate-800">
                     <div className="flex items-center justify-between mb-2">
                       <span className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Saturação Chroma Key</span>
                       <span className="text-cyan-400 font-mono">{editRadarChromaKey}</span>
                     </div>
                     <input type="range" min={0} max={255} step={1} value={editRadarChromaKey} onChange={e => setEditRadarChromaKey(parseInt(e.target.value))} className="w-full accent-cyan-500" />
                   </div>

                   <div className="space-y-3 pt-2 border-t border-slate-800">
                     <span className="text-xs text-slate-400 uppercase tracking-wider font-semibold block mb-1">Recortes das Bordas</span>
                     <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                        <div className="space-y-1">
                          <div className="flex justify-between items-center">
                            <span className="text-[10px] text-slate-500 uppercase">Topo</span>
                            <span className="text-[10px] text-cyan-500">{Math.round(editRadarCropTop * 100)}%</span>
                          </div>
                          <input type="range" min={0} max={1} step={0.01} value={editRadarCropTop} onChange={e => setEditRadarCropTop(parseFloat(e.target.value))} className="w-full accent-cyan-500" />
                        </div>
                        <div className="space-y-1">
                          <div className="flex justify-between items-center">
                            <span className="text-[10px] text-slate-500 uppercase">Base</span>
                            <span className="text-[10px] text-cyan-500">{Math.round(editRadarCropBottom * 100)}%</span>
                          </div>
                          <input type="range" min={0} max={1} step={0.01} value={editRadarCropBottom} onChange={e => setEditRadarCropBottom(parseFloat(e.target.value))} className="w-full accent-cyan-500" />
                        </div>
                        <div className="space-y-1">
                          <div className="flex justify-between items-center">
                            <span className="text-[10px] text-slate-500 uppercase">Esquerda</span>
                            <span className="text-[10px] text-cyan-500">{Math.round(editRadarCropLeft * 100)}%</span>
                          </div>
                          <input type="range" min={0} max={1} step={0.01} value={editRadarCropLeft} onChange={e => setEditRadarCropLeft(parseFloat(e.target.value))} className="w-full accent-cyan-500" />
                        </div>
                        <div className="space-y-1">
                          <div className="flex justify-between items-center">
                            <span className="text-[10px] text-slate-500 uppercase">Direita</span>
                            <span className="text-[10px] text-cyan-500">{Math.round(editRadarCropRight * 100)}%</span>
                          </div>
                          <input type="range" min={0} max={1} step={0.01} value={editRadarCropRight} onChange={e => setEditRadarCropRight(parseFloat(e.target.value))} className="w-full accent-cyan-500" />
                        </div>
                     </div>
                   </div>
                </div>
              </div>

              <div className="p-4 border-t border-slate-800 bg-slate-800/50 flex items-center gap-3 mt-auto">
                <button
                  onClick={() => setIsRadarEditMode(false)}
                  className="flex-1 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm font-semibold transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSaveRadarEdit}
                  disabled={isSavingRadarEdit}
                  className="flex-1 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-semibold transition-all shadow-lg shadow-cyan-900/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isSavingRadarEdit ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Salvar
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Modal de Pin de Meteorologista no Mapa */}
      {mapPinCoordinate && selectedTrack && (user?.type === 'admin' || rastrosProfile?.userType === 'meteorologista') && (
        <MeteorologistMapPinModal
          trackId={selectedTrack.id}
          lat={mapPinCoordinate.lat}
          lng={mapPinCoordinate.lng}
          currentUser={user}
          userRole={user?.type === 'admin' ? 'admin' : (rastrosProfile?.userType || 'civil')}
          onClose={() => setMapPinCoordinate(null)}
        />
      )}
    </div>
  );
// Sync marker: 2026-03-22 16:50
}
