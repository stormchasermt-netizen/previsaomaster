'use client';

import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, Radio, Users, X, Home, MapPin, Layers, Radar, Check, Menu, Play, Pause, LayoutGrid, Square, AlertTriangle, Send, Link2, Upload, Search, Crosshair } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { updatePresence, removePresence, subscribeToPresence, type PresenceData } from '@/lib/presence';
import { subscribeToTodayReports, saveStormReport, type StormReport } from '@/lib/stormReportStore';
import { MAP_STYLE_DARK } from '@/lib/constants';
import {
  CPTEC_RADAR_STATIONS,
  getRadarImageBounds,
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
import { fetchRadarConfigs, type RadarConfig } from '@/lib/radarConfigStore';

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

export default function AoVivoPage() {
  const { user } = useAuth();
  const { addToast } = useToast();
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);

  const [mapReady, setMapReady] = useState(false);
  const [locationPermission, setLocationPermission] = useState<'unknown' | 'granted' | 'denied'>('unknown');
  const [myLocation, setMyLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [radarProductType, setRadarProductType] = useState<'reflectividade' | 'velocidade'>('reflectividade');
  const [radarMode, setRadarMode] = useState<'mosaico' | 'unico'>('mosaico');
  const [selectedRadar, setSelectedRadar] = useState<DisplayRadar | null>(null);
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
  /** Permite acessar a página sem localização (útil para celulares com problema de geo) */
  const [locationSkipped, setLocationSkipped] = useState(false);
  /** Radares cuja imagem mais recente não foi encontrada (ex: 404) */
  const [failedRadars, setFailedRadars] = useState<Set<string>>(new Set());
  /** Timestamp efetivo carregado por radar (quando usa fallback, difere do nominal) — para legenda */
  const [radarEffectiveTimestamps, setRadarEffectiveTimestamps] = useState<Record<string, string>>({});
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

  /** Desktop detection para split vertical */
  const [isDesktop, setIsDesktop] = useState(false);

  /** Storm Reports */
  const [stormReports, setStormReports] = useState<StormReport[]>([]);
  const stormReportMarkersRef = useRef<any[]>([]);
  const stormReportInfoWindowRef = useRef<any>(null);
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

  /** Máximo de minutos atrás: quando UTC já é dia seguinte (imagem mais recente) vs horário local, usar 24h; senão meia-noite até agora */
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
  }, [radarTimestamp]);

  const displayRadars = useMemo(() => {
    if (radarMode === 'mosaico') return allRadars;
    if (selectedRadar) return [selectedRadar];
    return allRadars.length > 0 ? [allRadars[0]] : [];
  }, [radarMode, selectedRadar, allRadars]);

  /** Legendas: nome do radar + horário local (ou efetivo após fallback) ou "sem imagem" */
  const radarTimeLegends = useMemo(() => {
    const nominalDate = new Date(Date.UTC(
      parseInt(radarTimestamp.slice(0, 4), 10),
      parseInt(radarTimestamp.slice(4, 6), 10) - 1,
      parseInt(radarTimestamp.slice(6, 8), 10),
      parseInt(radarTimestamp.slice(8, 10), 10),
      parseInt(radarTimestamp.slice(10, 12), 10)
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
      if (failedRadars.has(radarKey)) {
        return { name: dr.station.name, hhmm: 'sem imagem' };
      }
      const effectiveTs = radarEffectiveTimestamps[radarKey];
      if (effectiveTs) {
        return { name: dr.station.name, hhmm: formatLocal(effectiveTsToUtcDate(effectiveTs)) };
      }
      let ts: string;
      if (dr.type === 'cptec') {
        ts = getNearestRadarTimestamp(radarTimestamp, dr.station);
      } else {
        ts = getArgentinaRadarTimestamp(nominalDate, dr.station);
      }
      return { name: dr.station.name, hhmm: formatLocal(effectiveTsToUtcDate(ts)) };
    });
  }, [displayRadars, radarTimestamp, failedRadars, radarEffectiveTimestamps]);

  /** Título central do header: nome do radar + horário da última imagem (local) */
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
    if (displayRadars.length === 0) return { name: 'Modo Ao Vivo', time: '' };
    if (radarMode === 'mosaico') {
      const leg = radarTimeLegends[0];
      const times = radarTimeLegends.map((l) => l.hhmm).filter((h) => h !== 'sem imagem');
      const timeStr = times.length > 0 ? times[0] : 'sem imagem';
      return { name: 'Mosaico (todos)', time: timeStr };
    }
    const dr = displayRadars[0];
    const radarKey = dr.type === 'cptec' ? `cptec:${dr.station.slug}` : `argentina:${dr.station.id}`;
    const leg = radarTimeLegends.find((l) => l.name === dr.station.name);
    const timeStr = leg?.hhmm ?? '';
    return { name: dr.station.name, time: timeStr };
  }, [displayRadars, radarMode, radarTimeLegends]);

  const getBoundsForDisplayRadar = useCallback(
    (dr: DisplayRadar) => {
      if (dr.type === 'cptec') {
        const cfg = radarConfigs.find((c) => c.stationSlug === dr.station.slug);
        if (cfg)
          return { north: cfg.bounds.ne.lat, south: cfg.bounds.sw.lat, east: cfg.bounds.ne.lng, west: cfg.bounds.sw.lng };
        const b = getRadarImageBounds(dr.station);
        return { north: b.north, south: b.south, east: b.east, west: b.west };
      }
      const b = getArgentinaRadarBounds(dr.station);
      return { north: b.north, south: b.south, east: b.east, west: b.west };
    },
    [radarConfigs]
  );

  const requestLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setLocationPermission('denied');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setMyLocation({ lat, lng });
        setLocationPermission('granted');
      },
      () => setLocationPermission('denied'),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 }
    );
  }, []);

  useEffect(() => {
    if (!user) return;
    requestLocation();
  }, [user, requestLocation]);

  useEffect(() => {
    if (!user) return;
    presenceUnsubRef.current = subscribeToPresence(setOnlineUsers);
    return () => {
      presenceUnsubRef.current?.();
      presenceUnsubRef.current = null;
    };
  }, [user]);

  useEffect(() => {
    fetchRadarConfigs().then(setRadarConfigs).catch(() => {});
  }, []);

  useEffect(() => {
    fetchPrevotsForecasts().then(setPrevotsForecasts).catch(() => setPrevotsForecasts([]));
  }, []);

  useEffect(() => {
    if (!user || !mapInstanceRef.current || locationPermission !== 'granted' || !myLocation) return;
    const heartbeat = setInterval(() => {
      updatePresence(user.uid, {
        displayName: user.displayName || 'Usuário',
        photoURL: user.photoURL,
        userType: null,
        locationShared: true,
        lat: myLocation.lat,
        lng: myLocation.lng,
        page: 'ao-vivo',
      });
    }, 55_000);
    updatePresence(user.uid, {
      displayName: user.displayName || 'Usuário',
      photoURL: user.photoURL,
      userType: null,
      locationShared: true,
      lat: myLocation.lat,
      lng: myLocation.lng,
      page: 'ao-vivo',
    });
    return () => {
      clearInterval(heartbeat);
      removePresence(user.uid);
    };
  }, [user, myLocation, locationPermission]);

  useEffect(() => {
    setSliderMinutesAgo((prev) => Math.min(prev, maxSliderMinutesAgo));
  }, [maxSliderMinutesAgo]);

  /** Timestamp efetivo em UTC: base (3 min) + offset do slider. CPTEC usa UTC. */
  useEffect(() => {
    const base = 3 + sliderMinutesAgo;
    setRadarTimestamp(getNowMinusMinutesTimestamp12UTC(base));
  }, [sliderMinutesAgo]);

  useEffect(() => {
    if (sliderMinutesAgo !== 0) return;
    const i = setInterval(() => setRadarTimestamp(getNowMinusMinutesTimestamp12UTC(3)), 30_000);
    return () => clearInterval(i);
  }, [sliderMinutesAgo]);

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

  /** Inicializa mapa quando localização concedida OU quando usuário acessa sem localização (ex: celular com problema) */
  const canShowMap = locationPermission === 'granted' || locationSkipped;
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
          zoomControl: true,
          mapTypeControl: false,
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
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;
    let usersToShow = onlineUsers.filter((u) => u.locationShared && u.lat != null && u.lng != null);
    if (user && myLocation && !usersToShow.some((u) => u.uid === user.uid)) {
      usersToShow = [
        { uid: user.uid, displayName: user.displayName || 'Você', photoURL: user.photoURL, locationShared: true, lat: myLocation.lat, lng: myLocation.lng, lastSeen: null },
        ...usersToShow,
      ];
    }
    usersToShow.forEach((u) => {
      if (!u.locationShared || !u.lat || !u.lng) return;
      const isMe = u.uid === user?.uid;
      const initial = (u.displayName?.[0] ?? '?').toUpperCase();
      const color = isMe ? '#0ea5e9' : '#38bdf8';
      const svgContent = isMe
        ? `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">
          <circle cx="20" cy="20" r="6" fill="${color}" stroke="white" stroke-width="2"/>
          <circle cx="20" cy="20" r="12" fill="none" stroke="${color}" stroke-width="2"/>
          <line x1="20" y1="2" x2="20" y2="8" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/>
          <line x1="20" y1="32" x2="20" y2="38" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/>
          <line x1="2" y1="20" x2="8" y2="20" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/>
          <line x1="32" y1="20" x2="38" y2="20" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/>
        </svg>`
        : `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="44" viewBox="0 0 36 44">
          <circle cx="18" cy="18" r="17" fill="${color}" stroke="white" stroke-width="2"/>
          <text x="18" y="23" text-anchor="middle" fill="white" font-size="14" font-family="sans-serif" font-weight="bold">${initial}</text>
          <polygon points="11,33 25,33 18,43" fill="${color}"/>
        </svg>`;
      const marker = new google.maps.Marker({
        position: { lat: u.lat, lng: u.lng },
        map,
        icon: {
          url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svgContent)}`,
          scaledSize: new google.maps.Size(isMe ? 40 : 36, isMe ? 40 : 44),
          anchor: new google.maps.Point(isMe ? 20 : 18, isMe ? 20 : 43),
        },
        title: u.displayName,
        zIndex: isMe ? 999 : 100,
      });
      onlineUserMarkersRef.current.push(marker);
    });
    return () => {
      onlineUserMarkersRef.current.forEach((m) => m.setMap(null));
      onlineUserMarkersRef.current = [];
    };
  }, [onlineUsers, user?.uid, myLocation, mapReady]);

  const prevotsForecastToShow = prevotsForecasts.find((f) => f.date === prevotsForecastDate);

  useEffect(() => {
    prevotsPolygonsRef.current.forEach((p) => p.setMap(null));
    prevotsPolygonsRef.current = [];
    if (!mapInstanceRef.current || !mapReady || !prevotsOverlayVisible || !prevotsForecastToShow) return;
    const map = mapInstanceRef.current;
    (prevotsForecastToShow.polygons ?? [])
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
          clickable: false,
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

    stormReports.forEach((r) => {
      const icon = SYMBOLS[r.type] ?? SYMBOLS.ven;
      const marker = new g.maps.Marker({
        position: { lat: r.lat, lng: r.lng },
        map,
        icon,
        title: r.type === 'tor' ? 'Tornado' : r.type === 'gra' ? 'Granizo' : 'Vento',
        zIndex: 500,
      });

      const typeLabel = r.type === 'tor' ? 'Tornado' : r.type === 'gra' ? 'Granizo' : 'Vento';
      let contentHtml = `<div style="font-family:sans-serif;max-width:240px;color:#e2e8f0;">
        <p style="margin:0 0 4px;font-weight:700;font-size:13px;">${typeLabel}</p>`;
      if (r.detail) contentHtml += `<p style="margin:0 0 4px;font-size:12px;">${r.type === 'ven' ? 'Velocidade' : 'Tamanho'}: ${r.detail}</p>`;
      contentHtml += `<p style="margin:0 0 4px;font-size:11px;color:#94a3b8;">por ${r.displayName}</p>`;
      if (r.mediaUrl && r.mediaType === 'link') {
        contentHtml += `<a href="${r.mediaUrl}" target="_blank" rel="noopener" style="color:#22d3ee;font-size:12px;word-break:break-all;">Link do relato</a>`;
      } else if (r.mediaUrl && r.mediaType === 'file') {
        if (r.mediaUrl.match(/\.(mp4|webm|mov)/i)) {
          contentHtml += `<video src="${r.mediaUrl}" controls style="max-width:100%;border-radius:6px;margin-top:4px;" />`;
        } else {
          contentHtml += `<img src="${r.mediaUrl}" style="max-width:100%;border-radius:6px;margin-top:4px;cursor:pointer;" onclick="window.open('${r.mediaUrl}','_blank')" />`;
        }
      }
      contentHtml += `</div>`;

      const iw = new g.maps.InfoWindow({ content: contentHtml });
      marker.addListener('click', () => {
        stormReportInfoWindowRef.current?.close();
        iw.open(map, marker);
        stormReportInfoWindowRef.current = iw;
      });
      stormReportMarkersRef.current.push(marker);
    });

    return () => {
      stormReportMarkersRef.current.forEach((m) => m.setMap(null));
      stormReportMarkersRef.current = [];
    };
  }, [stormReports, mapReady, showReportsOnMap]);

  /** Cria overlays de radar para um determinado mapa e tipo de produto */
  const addRadarOverlays = useCallback((
    map: any,
    overlaysArr: any[],
    productType: 'reflectividade' | 'velocidade',
    radars: DisplayRadar[],
    timestamp: string,
    useFallback: boolean,
    opacity: number,
  ) => {
    const nominalDate = new Date(Date.UTC(
      parseInt(timestamp.slice(0, 4), 10),
      parseInt(timestamp.slice(4, 6), 10) - 1,
      parseInt(timestamp.slice(6, 8), 10),
      parseInt(timestamp.slice(8, 10), 10),
      parseInt(timestamp.slice(10, 12), 10)
    ));
    radars.forEach((dr) => {
      const radarKey = dr.type === 'cptec' ? `cptec:${dr.station.slug}` : `argentina:${dr.station.id}`;
      let urlsToTry: { url: string; ts12: string }[] = [];
      if (dr.type === 'cptec' && dr.station.slug === 'ipmet-bauru') {
        const IPMET_URL = 'https://us-central1-studio-4398873450-7cc8f.cloudfunctions.net/getRadarIPMet';
        urlsToTry = [{ url: IPMET_URL + `?t=${Date.now()}`, ts12: timestamp }];
      } else if (dr.type === 'cptec') {
        if (useFallback) {
          for (let back = 0; back <= 60; back += 6) {
            const baseTs = back === 0 ? timestamp : subtractMinutesFromTimestamp12UTC(timestamp, back);
            const ts12 = getNearestRadarTimestamp(baseTs, dr.station);
            urlsToTry.push({
              url: getProxiedRadarUrl(buildNowcastingPngUrl(dr.station, ts12, productType)),
              ts12,
            });
          }
        } else {
          const ts12 = getNearestRadarTimestamp(timestamp, dr.station);
          urlsToTry = [{ url: getProxiedRadarUrl(buildNowcastingPngUrl(dr.station, ts12, productType)), ts12 }];
        }
      } else {
        const tsArg = getArgentinaRadarTimestamp(nominalDate, dr.station);
        urlsToTry = [{
          url: getProxiedRadarUrl(buildArgentinaRadarPngUrl(dr.station, tsArg, productType)),
          ts12: tsArg,
        }];
      }
      const bounds = getBoundsForDisplayRadar(dr);
      const latLngBounds = new google.maps.LatLngBounds(
        { lat: bounds.south, lng: bounds.west },
        { lat: bounds.north, lng: bounds.east }
      );
      const ov = new google.maps.OverlayView();
      let divEl: HTMLDivElement | null = null;
      ov.onAdd = () => {
        divEl = document.createElement('div');
        divEl.style.cssText = 'position:absolute;pointer-events:none;';
        const img = document.createElement('img');
        img.className = 'pixelated-layer';
        img.style.cssText = `width:100%;height:100%;opacity:${opacity};object-fit:fill;`;
        let tryIndex = 0;
        const tryNext = () => {
          if (tryIndex >= urlsToTry.length) {
            setFailedRadars((prev) => new Set(prev).add(radarKey));
            if (divEl) divEl.style.display = 'none';
            return;
          }
          img.src = urlsToTry[tryIndex].url;
          tryIndex += 1;
        };
        img.onerror = tryNext;
        img.onload = () => {
          setRadarEffectiveTimestamps((prev) => ({
            ...prev,
            [radarKey]: urlsToTry[tryIndex - 1]?.ts12 ?? timestamp,
          }));
          setFailedRadars((prev) => {
            const next = new Set(prev);
            next.delete(radarKey);
            return next;
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
      overlaysArr.push(ov);
    });
  }, [getBoundsForDisplayRadar]);

  /** Overlays de radar no mapa principal (refletividade, ou produto único quando split=1) */
  useEffect(() => {
    setFailedRadars(new Set());
    setRadarEffectiveTimestamps({});
    radarOverlaysRef.current.forEach((ov) => (ov as any)?.setMap?.(null));
    radarOverlaysRef.current = [];
    if (!mapInstanceRef.current || displayRadars.length === 0) return;
    const product = splitCount === 2 ? 'reflectividade' : radarProductType;
    addRadarOverlays(
      mapInstanceRef.current,
      radarOverlaysRef.current,
      product,
      displayRadars,
      radarTimestamp,
      sliderMinutesAgo === 0,
      radarOpacity,
    );
    return () => {
      radarOverlaysRef.current.forEach((ov) => (ov as any)?.setMap?.(null));
      radarOverlaysRef.current = [];
    };
  }, [displayRadars, radarProductType, radarOpacity, radarTimestamp, sliderMinutesAgo, splitCount, addRadarOverlays]);

  /** Overlays de radar no mapa 2 (Doppler) — apenas quando split=2 */
  useEffect(() => {
    radarOverlays2Ref.current.forEach((ov) => (ov as any)?.setMap?.(null));
    radarOverlays2Ref.current = [];
    if (splitCount !== 2 || !map2InstanceRef.current || !map2Ready || displayRadars.length === 0) return;
    addRadarOverlays(
      map2InstanceRef.current,
      radarOverlays2Ref.current,
      'velocidade',
      displayRadars,
      radarTimestamp,
      sliderMinutesAgo === 0,
      radarOpacity,
    );
    return () => {
      radarOverlays2Ref.current.forEach((ov) => (ov as any)?.setMap?.(null));
      radarOverlays2Ref.current = [];
    };
  }, [displayRadars, radarOpacity, radarTimestamp, sliderMinutesAgo, splitCount, map2Ready, addRadarOverlays]);

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

  if (locationPermission !== 'granted' && !locationSkipped) {
    return (
      <div className="fixed inset-0 z-40 flex flex-col items-center justify-center bg-slate-950 text-white p-4">
        <div className="max-w-md text-center space-y-4">
          <MapPin className="w-16 h-16 text-cyan-400 mx-auto" />
          <h1 className="text-xl font-bold">Localização</h1>
          <p className="text-slate-400">
            O Modo Ao Vivo usa sua localização para exibir os radares próximos e posicionar você no mapa.
          </p>
          {locationPermission === 'denied' && (
            <p className="text-red-400 text-sm">Permissão negada. Ative a localização nas configurações do navegador.</p>
          )}
          <div className="flex flex-col gap-2">
            <button
              onClick={requestLocation}
              disabled={locationPermission === 'denied'}
              className="px-6 py-3 rounded-lg bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-900 font-semibold"
            >
              {locationPermission === 'unknown' ? 'Permitir localização' : 'Tentar novamente'}
            </button>
            <button
              onClick={() => setLocationSkipped(true)}
              className="px-6 py-3 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 font-medium text-sm"
            >
              Acessar sem localização
            </button>
          </div>
          <p className="text-[11px] text-slate-500">
            Se não conseguir entrar no celular, use &quot;Acessar sem localização&quot; para visualizar o mapa.
          </p>
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
        <header className="relative z-20 flex items-center gap-3 px-3 py-2.5 bg-[#0F131C]/80 backdrop-blur-md border-b border-white/10 flex-shrink-0 shadow-lg">
          <button
            type="button"
            onClick={() => setSideMenuOpen(true)}
            className="p-2 -ml-1 rounded-lg text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
            aria-label="Abrir menu"
          >
            <Menu className="w-6 h-6" />
          </button>
          <div className="flex-1 min-w-0 text-center">
            <p className="text-sm font-black tracking-wider text-white truncate uppercase">{headerTitle.name}</p>
            <p className="text-[10px] tracking-widest text-cyan-400/80 uppercase font-medium mt-0.5">
              {headerTitle.time ? `Última imagem: ${headerTitle.time} (local)` : 'Carregando…'}
            </p>
          </div>
          <button
            onClick={() => setShowReportsOnMap((v) => !v)}
            className={`relative p-2 rounded-lg transition-all transform hover:scale-105 ${showReportsOnMap ? 'text-amber-400 bg-amber-400/10' : 'text-slate-400 hover:text-white hover:bg-white/10'}`}
            title="Relatos de hoje"
          >
            <AlertTriangle className="w-5 h-5" />
            {stormReports.length > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-4 h-4 flex items-center justify-center text-[8px] font-bold bg-red-500 text-white rounded-full shadow-[0_0_8px_rgba(239,68,68,0.8)]">
                {stormReports.length}
              </span>
            )}
          </button>
          <Link href="/" className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-all transform hover:scale-105" aria-label="Voltar">
            <ChevronLeft className="w-5 h-5" />
          </Link>
        </header>

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
                  <input type="checkbox" checked={radarMode === 'mosaico'} onChange={() => { setRadarMode('mosaico'); setSelectedRadar(null); }} className="hidden" />
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
                  <motion.select
                    initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
                    value={selectedRadar ? (selectedRadar.type === 'cptec' ? `cptec:${selectedRadar.station.slug}` : `argentina:${selectedRadar.station.id}`) : allRadars[0] ? (allRadars[0].type === 'cptec' ? `cptec:${allRadars[0].station.slug}` : `argentina:${allRadars[0].station.id}`) : ''}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (!v) { setSelectedRadar(null); return; }
                      const [type, id] = v.split(':');
                      const s = type === 'cptec' ? allRadars.find((r) => r.type === 'cptec' && r.station.slug === id) : allRadars.find((r) => r.type === 'argentina' && r.station.id === id);
                      setSelectedRadar(s ?? null);
                    }}
                    className="w-full mt-3 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 outline-none transition-all"
                  >
                    {allRadars.map((r) => (
                      <option key={r.type === 'cptec' ? `cptec:${r.station.slug}` : `argentina:${r.station.id}`} value={r.type === 'cptec' ? `cptec:${r.station.slug}` : `argentina:${r.station.id}`}>
                        {r.station.name}
                      </option>
                    ))}
                  </motion.select>
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
                <label className="flex items-center gap-3 py-2 cursor-pointer group">
                  <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${prevotsOverlayVisible ? 'bg-emerald-500 border-emerald-500' : 'border-slate-500 group-hover:border-emerald-500/50'}`}>
                    {prevotsOverlayVisible && <Check className="w-3 h-3 text-black" />}
                  </div>
                  <input type="checkbox" checked={prevotsOverlayVisible} onChange={(e) => setPrevotsOverlayVisible(e.target.checked)} className="hidden" />
                  <span className="text-sm font-medium text-slate-300 group-hover:text-white transition-colors">Overlay Prevots</span>
                </label>
                {prevotsOverlayVisible && (
                  <motion.input
                    initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
                    type="date"
                    value={prevotsForecastDate}
                    onChange={(e) => setPrevotsForecastDate(e.target.value)}
                    className="mt-3 w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none transition-all"
                  />
                )}
              </div>
              {radarTimeLegends.length > 0 && (
                <div className="pt-4 border-t border-white/10">
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">Horário da última imagem</p>
                  <div className="space-y-1.5 max-h-32 overflow-y-auto pr-2 custom-scrollbar">
                    {radarTimeLegends.map(({ name, hhmm }) => (
                      <div key={name} className="text-xs flex justify-between items-center bg-black/20 px-2 py-1.5 rounded border border-white/5">
                        <span className="text-slate-300 truncate mr-2">{name}</span>
                        <span className={`font-bold tracking-wider ${hhmm === 'sem imagem' ? 'text-amber-400/90' : 'text-cyan-400'}`}>{hhmm}</span>
                      </div>
                    ))}
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
              </div>
            </>
          )}

          {/* UI sobreposta ao mapa (botões, slider, etc.) — posiciona sobre tudo */}
          <div className="absolute inset-0 pointer-events-none z-10">
          <div className="absolute left-2 top-2 pointer-events-auto flex flex-col gap-1">
            <button
              onClick={goToBrazil}
              className="w-10 h-10 rounded-lg bg-slate-900/95 border border-slate-600 text-slate-200 hover:bg-slate-800 shadow"
              title="Centralizar Brasil"
            >
              <Home className="w-5 h-5 mx-auto" />
            </button>
            <button
              onClick={refreshRadarNow}
              className="w-10 h-10 rounded-lg bg-slate-900/95 border border-slate-600 text-slate-200 hover:bg-slate-800 shadow"
              title="Atualizar imagens"
            >
              <svg className="w-5 h-5 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>

          {/* Botão Reportar — canto direito abaixo dos controles de zoom */}
          <div className="absolute right-2 top-[140px] pointer-events-auto">
            <button
              onClick={openReportPopup}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-500/90 hover:bg-amber-400 text-slate-900 font-semibold text-xs shadow-lg"
              title="Enviar relato"
            >
              <AlertTriangle className="w-4 h-4" />
              Reportar
            </button>
          </div>

          {showBaseMapGallery && (
            <div className="pointer-events-auto">
              <div className="fixed inset-0 z-30" onClick={() => setShowBaseMapGallery(false)} aria-hidden />
              <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-40 w-[min(20rem,95vw)] rounded-xl border border-slate-600 bg-slate-900 shadow-2xl p-4">
                <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Galeria de mapa base</div>
                <div className="grid grid-cols-2 gap-2">
                  {BASE_MAP_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => { setBaseMapId(opt.id); setShowBaseMapGallery(false); }}
                      className={`rounded-lg overflow-hidden border-2 text-left transition-all hover:border-cyan-500/50 ${baseMapId === opt.id ? 'border-cyan-500 ring-1 ring-cyan-500/30' : 'border-slate-600'}`}
                    >
                      <div className="aspect-[3/2] relative bg-slate-800">
                        {opt.previewType === 'static' && opt.staticMapType && getStaticMapPreviewUrl(opt.staticMapType) ? (
                          <img src={getStaticMapPreviewUrl(opt.staticMapType)} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full" style={{ backgroundColor: opt.placeholderBg }} />
                        )}
                        {baseMapId === opt.id && (
                          <div className="absolute top-1 right-1 rounded-full bg-cyan-500 p-0.5"><Check className="w-3 h-3 text-black" /></div>
                        )}
                      </div>
                      <div className="px-2 py-1.5 bg-slate-800/80 text-xs font-medium text-slate-200 truncate">{opt.label}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Slider de tempo: na parte inferior do mapa, acima da barra de ferramentas */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 w-[min(95vw,400px)] px-3 py-1.5 rounded-xl bg-slate-900/95 border border-slate-600 shadow-xl pointer-events-auto">
            {sliderMinutesAgo > 60 && (
              <p className="text-[9px] text-amber-400/90 mb-1 text-center">
                Voltar além de 1h se tornará recurso premium em breve.
              </p>
            )}
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-slate-500 flex-shrink-0 w-12">
                {sliderMinutesAgo >= maxSliderMinutesAgo
                  ? (maxSliderMinutesAgo >= 1440 ? '24h atrás' : '00:00')
                  : sliderMinutesAgo >= 60 ? `${Math.floor(sliderMinutesAgo / 60)}h` : `-${sliderMinutesAgo} min`}
              </span>
              <div className="flex-1 flex flex-col gap-0">
                <input
                  type="range"
                  min="0"
                  max={maxSliderMinutesAgo}
                  step="5"
                  value={maxSliderMinutesAgo - sliderMinutesAgo}
                  onChange={(e) => setSliderMinutesAgo(maxSliderMinutesAgo - parseInt(e.target.value, 10))}
                  className="w-full h-1.5 accent-cyan-500 cursor-pointer my-1"
                  title={sliderMinutesAgo === 0 ? 'Ao vivo' : sliderMinutesAgo >= maxSliderMinutesAgo ? (maxSliderMinutesAgo >= 1440 ? '24h atrás' : 'Meia-noite') : `${sliderMinutesAgo} min atrás`}
                />
                <div className="text-center leading-none">
                  <span className="text-[11px] font-semibold text-cyan-300">
                    {(() => {
                      const d = new Date(Date.UTC(
                        parseInt(radarTimestamp.slice(0, 4), 10),
                        parseInt(radarTimestamp.slice(4, 6), 10) - 1,
                        parseInt(radarTimestamp.slice(6, 8), 10),
                        parseInt(radarTimestamp.slice(8, 10), 10),
                        parseInt(radarTimestamp.slice(10, 12), 10)
                      ));
                      return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false });
                    })()}
                  </span>
                  <span className="text-[9px] text-slate-500 ml-1">(horário local)</span>
                </div>
              </div>
              <span className="text-[10px] text-slate-500 flex-shrink-0 w-10 text-right">Ao vivo</span>
            </div>
          </div>
          </div>{/* fecha div pointer-events-none */}
        </div>
      </div>

      {/* Popup de relato multi-etapa */}
      <AnimatePresence>
      {reportStep !== 'closed' && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" onClick={cancelReport} aria-hidden />
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

            {/* Etapa pick-map: instrução */}
            {reportStep === 'pick-map' && (
              <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="p-5 space-y-4 text-center">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold tracking-widest uppercase text-cyan-400">Clique no mapa</h3>
                  <button onClick={cancelReport} className="text-slate-400 hover:text-white transition-colors"><X className="w-4 h-4" /></button>
                </div>
                <div className="py-4">
                  <div className="relative flex items-center justify-center w-16 h-16 mx-auto mb-4">
                    <div className="absolute w-12 h-12 border border-cyan-500 rounded-full animate-ping opacity-50" />
                    <div className="w-6 h-6 border-2 border-cyan-400 rounded-full bg-black/50" />
                  </div>
                  <p className="text-slate-300 text-sm font-medium">Toque no local do mapa onde ocorreu o evento.</p>
                </div>
                <button
                  onClick={cancelReport}
                  className="w-full px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 text-slate-300 text-sm font-bold transition-colors"
                >
                  Cancelar
                </button>
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
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-2">Enviar mídia (opcional)</label>
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
                  disabled={reportSending}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-900 font-black text-sm uppercase tracking-wider shadow-[0_0_15px_rgba(245,158,11,0.4)] transition-all transform hover:scale-[1.02]"
                >
                  <Send className="w-4 h-4" />
                  {reportSending ? 'Enviando…' : 'Enviar relato'}
                </button>
              </motion.div>
            )}
          </motion.div>
        </>
      )}
      </AnimatePresence>

      {/* Barra de ferramentas inferior horizontal */}
      <div className="flex-shrink-0 flex items-center justify-around gap-2 px-2 py-1.5 bg-slate-900/95 border-t border-slate-700">
        <div className="relative">
          <button
            onClick={() => setShowOnlinePanel((v) => !v)}
            className={`flex flex-col items-center gap-0.5 p-2 rounded-lg transition-colors ${
              showOnlinePanel ? 'text-emerald-400 bg-slate-800' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}
            title="Usuários Online"
          >
            <div className="relative">
              <Users className="w-5 h-5" />
              {onlineUsers.length > 0 && (
                <span className="absolute -top-1 -right-2 w-3.5 h-3.5 flex items-center justify-center text-[8px] font-bold bg-emerald-500 text-white rounded-full">
                  {onlineUsers.length}
                </span>
              )}
            </div>
            <span className="text-[10px]">Online</span>
          </button>

          {showOnlinePanel && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setShowOnlinePanel(false)} aria-hidden />
              <div className="absolute bottom-full left-0 mb-2 z-40 w-56 max-h-[40vh] bg-slate-900/98 border border-emerald-500/40 rounded-lg shadow-2xl overflow-hidden flex flex-col">
                <div className="flex items-center justify-between px-3 py-2 bg-slate-800/80 border-b border-slate-700">
                  <span className="text-xs font-semibold text-emerald-400 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    Online ({onlineUsers.length})
                  </span>
                  <button onClick={() => setShowOnlinePanel(false)} className="text-slate-400 hover:text-white">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-slate-700/50">
                  {onlineUsers.length === 0 ? (
                    <p className="px-3 py-3 text-xs text-slate-500 text-center">Nenhum usuário online.</p>
                  ) : (
                    onlineUsers.map((u) => (
                      <div
                        key={u.uid}
                        className="flex items-center gap-2 px-3 py-2 hover:bg-slate-800/50 cursor-default"
                        onClick={() => {
                          if (u.locationShared && u.lat && u.lng && mapInstanceRef.current) {
                            mapInstanceRef.current.panTo({ lat: u.lat, lng: u.lng });
                            mapInstanceRef.current.setZoom(10);
                            setShowOnlinePanel(false);
                          }
                        }}
                      >
                        {u.photoURL ? (
                          <img src={u.photoURL} alt="" className="w-6 h-6 rounded-full object-cover border border-slate-600" />
                        ) : (
                          <div className="w-6 h-6 rounded-full bg-slate-600 flex items-center justify-center text-[10px] font-bold text-white">
                            {(u.displayName?.[0] ?? '?').toUpperCase()}
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-slate-200 truncate">
                            {u.displayName}
                            {u.uid === user?.uid && <span className="text-emerald-400 ml-1">(você)</span>}
                          </p>
                          {u.locationShared && <p className="text-[9px] text-slate-500">📍 no mapa</p>}
                        </div>
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
                      </div>
                    ))
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        <button
          onClick={goToMyLocation}
          className="flex flex-col items-center gap-0.5 p-2 rounded-lg text-slate-300 hover:bg-slate-800 hover:text-white"
          title="Minha localização"
        >
          <MapPin className="w-5 h-5" />
          <span className="text-[10px]">Localização</span>
        </button>
        <button
          onClick={() => setShowBaseMapGallery((v) => !v)}
          className="flex flex-col items-center gap-0.5 p-2 rounded-lg text-slate-300 hover:bg-slate-800 hover:text-white"
          title="Tipo de mapa"
        >
          <Layers className="w-5 h-5" />
          <span className="text-[10px]">Mapa base</span>
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
            className="flex flex-col items-center gap-0.5 p-2 rounded-lg text-slate-300 hover:bg-slate-800 hover:text-white min-w-[3rem]"
            title={animationPlaying ? 'Pausar animação' : 'Reproduzir animação'}
          >
            {animationPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
            <span className="text-[10px]">{animationPlaying ? 'Pausar' : 'Play'}</span>
          </button>
          {showAnimationMenu && !animationPlaying && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setShowAnimationMenu(false)} aria-hidden />
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 z-40 w-40 rounded-lg bg-slate-800 border border-slate-600 shadow-xl py-1">
                <p className="px-3 py-1.5 text-[10px] text-slate-500 uppercase">Duração da animação</p>
                {([60, 240, 1440] as const).map((mins) => (
                  <button
                    key={mins}
                    onClick={() => { setAnimationDuration(mins); setShowAnimationMenu(false); setAnimationPlaying(true); }}
                    className={`w-full px-3 py-2 text-left text-sm ${animationDuration === mins ? 'bg-cyan-500/30 text-cyan-200' : 'text-slate-300 hover:bg-slate-700'}`}
                  >
                    {mins === 60 ? '1 hora' : mins === 240 ? '4 horas' : '24 horas'}
                  </button>
                ))}
              </div>
            </>
          )}
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
                className="absolute bottom-full left-1/2 -translate-x-1/2 mb-3 z-40 w-48 rounded-xl bg-[#0F131C]/95 backdrop-blur-xl border border-white/10 shadow-[0_10px_40px_rgba(0,0,0,0.8)] py-2 overflow-hidden"
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
    </motion.div>
    </AnimatePresence>
  );
}
