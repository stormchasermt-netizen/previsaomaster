'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { ChevronLeft, Plus, Check, X, Radar, Loader2, Save, MapPin, Layers } from 'lucide-react';
import { MAP_STYLE_DARK } from '@/lib/constants';
import { CPTEC_RADAR_STATIONS, calculateRadarBounds, calculateRadarBoundsGeodesic, buildNowcastingPngUrl, getNowMinusMinutesTimestamp12UTC, getNearestRadarTimestamp, subtractMinutesFromTimestamp12UTC, type CptecRadarStation } from '@/lib/cptecRadarStations';
import { hasRedemetFallback, getRedemetArea, buildRedemetPngUrl } from '@/lib/redemetRadar';
import {
  ARGENTINA_RADAR_STATIONS,
  buildArgentinaRadarPngUrl,
  type ArgentinaRadarStation,
} from '@/lib/argentinaRadarStations';
import { fetchRadarConfigs, saveRadarConfig, buildRadarPngUrl, type RadarConfig } from '@/lib/radarConfigStore';

type SelectedStation = { type: 'cptec'; station: CptecRadarStation } | { type: 'argentina'; station: ArgentinaRadarStation } | null;

declare const google: any;

const BRAZIL_CENTER = { lat: -14.235, lng: -51.925 };

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

/** Contorna CORS: o CPTEC não envia Access-Control-Allow-Origin para imagens em outras origens. */
function getProxiedRadarUrl(url: string): string {
  if (typeof window === 'undefined') return url;
  return `/api/radar-proxy?url=${encodeURIComponent(url)}`;
}

function getStaticMapPreviewUrl(maptype: string): string {
  const key = typeof process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY === 'string'
    ? process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
    : '';
  if (!key || key.startsWith('COLE_SUA')) return '';
  return `https://maps.googleapis.com/maps/api/staticmap?center=-14,-52&zoom=4&size=180x120&maptype=${maptype}&key=${key}`;
}

/** Gera ts12 (YYYYMMDDHHmm) para "agora" arredondado ao último intervalo (6 ou 10 min) */
function getSampleTs12(intervalMinutes: number = 6): string {
  const now = new Date();
  const min = now.getUTCMinutes();
  const roundedMin = Math.floor(min / intervalMinutes) * intervalMinutes;
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours(), roundedMin, 0));
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const h = String(d.getUTCHours()).padStart(2, '0');
  const minStr = String(d.getUTCMinutes()).padStart(2, '0');
  return `${y}${m}${day}${h}${minStr}`;
}

/** Converte input datetime-local (YYYY-MM-DDTHH:mm) para ts12 (YYYYMMDDHHmm). Retorna null se inválido. */
function parseDateTimeToTs12(value: string): string | null {
  if (!value || value.trim() === '') return null;
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!match) return null;
  const [, y, m, d, h, min] = match;
  return `${y}${m}${d}${h}${min}`;
}

export default function AdminRadaresPage() {
  const { user } = useAuth();
  const { addToast } = useToast();
  const router = useRouter();
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const overlayRef = useRef<any>(null);
  const positionMarkerRef = useRef<any>(null);
  const lastDragCenterRef = useRef<{ lat: number; lng: number } | null>(null);

  const [configs, setConfigs] = useState<RadarConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [selectedStation, setSelectedStation] = useState<SelectedStation>(null);
  const [config, setConfig] = useState<RadarConfig | null>(null);
  const [urlTemplate, setUrlTemplate] = useState('');
  const [sampleUrl, setSampleUrl] = useState('');
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  /** URLs para tentar ao carregar a última imagem (CPTEC + REDEMET fallback). Usado ao selecionar radar. */
  const [previewUrlsToTry, setPreviewUrlsToTry] = useState<{ url: string; ts12: string }[]>([]);
  /** Centro da antena e raio em km — bounds são calculados automaticamente. */
  const [centerLat, setCenterLat] = useState<number>(0);
  const [centerLng, setCenterLng] = useState<number>(0);
  const [rangeKm, setRangeKm] = useState<number>(250);
  const [panelOpen, setPanelOpen] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [baseMapId, setBaseMapId] = useState<BaseMapId>('satellite');
  const [showBaseMapGallery, setShowBaseMapGallery] = useState(false);
  const [updateIntervalMinutes, setUpdateIntervalMinutes] = useState<number>(6);
  /** Data/hora para preview (YYYY-MM-DDTHH:mm). Vazio = usar "agora". Útil para imagens históricas. */
  const [previewDateTime, setPreviewDateTime] = useState<string>('');
  /** Minutos atrás para imagem ao vivo (0 = mais recente, até 60). Slider para gerar PNG. */
  const [previewMinutesAgo, setPreviewMinutesAgo] = useState(0);
  /** Rotação da imagem no overlay em graus (ex: -110, 1.5). Slider + input numérico. */
  const [rotationDegrees, setRotationDegrees] = useState<number>(0);
  /** Opacidade da imagem no overlay (0–1). Slider para ajustar durante edição. */
  const [previewOpacity, setPreviewOpacity] = useState<number>(0.75);
  /** Lat/lng durante arraste — atualiza os inputs em tempo real. null quando não está arrastando. */
  const [liveCenter, setLiveCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [radarSource, setRadarSource] = useState<'cptec' | 'redemet'>('cptec');

  // === ESTÚDIO DE RADAR ===
  // Bounding Box (Arrasto e estiramento nas 4 pontas em vez de só centro/raio)
  const [useCustomBounds, setUseCustomBounds] = useState(false);
  const [customBounds, setCustomBounds] = useState<{ north: number; south: number; east: number; west: number } | null>(null);

  // Chroma Key e Corte (Limpação da imagem)
  const [chromaKeyDeltaThreshold, setChromaKeyDeltaThreshold] = useState<number>(0);
  const [cropTop, setCropTop] = useState<number>(0);
  const [cropBottom, setCropBottom] = useState<number>(0);
  const [cropLeft, setCropLeft] = useState<number>(0);
  const [cropRight, setCropRight] = useState<number>(0);
  const [processedImageUrl, setProcessedImageUrl] = useState<string | null>(null);
  const [superRes, setSuperRes] = useState<boolean>(false);

  const loadConfigs = async () => {
    setLoading(true);
    try {
      const list = await fetchRadarConfigs();
      setConfigs(list);
    } catch (e: any) {
      addToast(`Erro ao carregar: ${e.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!user || (user.type !== 'admin' && user.type !== 'superadmin')) {
      router.push('/');
      return;
    }
    loadConfigs();
  }, [user, router]);

  useEffect(() => {
    if (!mapRef.current) return;
    let isMounted = true;
    const initMap = async () => {
      try {
        const { Map } = await google.maps.importLibrary('maps');
        if (!isMounted) return;
        const map = new Map(mapRef.current, {
          center: BRAZIL_CENTER,
          zoom: 4,
          disableDefaultUI: true,
          zoomControl: true,
          mapTypeId: 'satellite',
        });
        mapInstanceRef.current = map;
        setMapReady(true);
      } catch (err) {
        console.error(err);
      }
    };
    initMap();
    return () => { isMounted = false; };
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

  /** Bounds calculados a partir do centro e raio. IPMet usa geodesic (g_calc.fwd). */
  const bounds = React.useMemo(() => {
    const isIpmet = selectedStation?.type === 'cptec' && (selectedStation.station as CptecRadarStation).slug === 'ipmet-bauru';
    const calc = isIpmet && typeof calculateRadarBoundsGeodesic === 'function' ? calculateRadarBoundsGeodesic : calculateRadarBounds;
    return calc(centerLat, centerLng, rangeKm);
  }, [centerLat, centerLng, rangeKm, selectedStation]);

  const getArgentinaTsArgentina = (intervalMinutes: number): string => {
    const ts12 = getSampleTs12(intervalMinutes);
    return `${ts12.slice(0, 8)}T${ts12.slice(8, 10)}${ts12.slice(10, 12)}00Z`;
  };

  const IPMET_STATIC_URL = 'https://getradaripmet-kj7x6j3jsa-uc.a.run.app';

  /** Monta lista de URLs para buscar a última imagem (CPTEC + REDEMET fallback). */
  function buildLatestImageUrls(station: CptecRadarStation, template: string): { url: string; ts12: string }[] {
    const nominalTs = getNowMinusMinutesTimestamp12UTC(3);
    const urls: { url: string; ts12: string }[] = [];
    for (let back = 0; back <= 60; back += 6) {
      const baseTs = back === 0 ? nominalTs : subtractMinutesFromTimestamp12UTC(nominalTs, back);
      const ts12 = getNearestRadarTimestamp(baseTs, station);
      urls.push({
        url: getProxiedRadarUrl(buildRadarPngUrl(template, ts12)),
        ts12,
      });
    }
    if (hasRedemetFallback(station.slug)) {
      const area = getRedemetArea(station.slug)!;
      for (let back = 0; back <= 60; back += 6) {
        const baseTs = back === 0 ? nominalTs : subtractMinutesFromTimestamp12UTC(nominalTs, back);
        const ts12 = getNearestRadarTimestamp(baseTs, station);
        urls.push({
          url: getProxiedRadarUrl(buildRedemetPngUrl(area, ts12)),
          ts12,
        });
      }
    }
    return urls;
  }

  /** Abre o painel para configurar um radar CPTEC */
  const handleSelectStation = (station: CptecRadarStation, source: 'cptec' | 'redemet' = 'cptec') => {
    const slug = source === 'redemet' ? `${station.slug}-redemet` : station.slug;
    const existing = configs.find((c) => c.id === slug || c.stationSlug === slug);
    const interval = existing?.updateIntervalMinutes ?? station.updateIntervalMinutes ?? 10;
    
    setRadarSource(source);

    const isIpmet = station.slug === 'ipmet-bauru';
    let template: string;
    if (isIpmet) {
      template = existing?.urlTemplate || IPMET_STATIC_URL;
    } else if (source === 'redemet') {
      const area = getRedemetArea(station.slug)!;
      template = buildRedemetPngUrl(area, '{ts12}');
    } else {
      const ts12 = getSampleTs12(interval);
      const defaultUrl = buildNowcastingPngUrl(station, ts12);
      template =
        existing?.urlTemplate ||
        defaultUrl
          .replace(/\d{4}\/\d{2}\//, '{year}/{month}/')
          .replace(/_\d{12}(\.png)/, '_{ts12}$1');
    }

    const initialUrl = isIpmet ? IPMET_STATIC_URL : buildRadarPngUrl(template, getSampleTs12(interval));
    const urlsToTry = (isIpmet || source === 'redemet') ? [] : buildLatestImageUrls(station, template);
    setSelectedStation({ type: 'cptec', station });
    setConfig(existing || null);
    setUrlTemplate(template);
    setUpdateIntervalMinutes(interval);
    setSampleUrl(initialUrl);
    const hasValidCoords = existing && (existing.lat !== 0 || existing.lng !== 0);
    setCenterLat(hasValidCoords ? existing!.lat : station.lat);
    setCenterLng(hasValidCoords ? existing!.lng : station.lng);
    setRangeKm(existing?.rangeKm ?? station.rangeKm);
    setRotationDegrees(existing?.rotationDegrees ?? 0);
    setPreviewOpacity(existing?.opacity ?? 0.75);
    setPreviewImageUrl(isIpmet ? initialUrl : (source === 'redemet' ? getProxiedRadarUrl(initialUrl) : (urlsToTry[0]?.url ?? initialUrl)));
    setPreviewUrlsToTry(urlsToTry);
    setLoadingPreview(true);
    setLiveCenter(null);
    setUseCustomBounds(!!existing?.customBounds);
    setCustomBounds(existing?.customBounds || null);
    setChromaKeyDeltaThreshold(existing?.chromaKeyDeltaThreshold ?? 0);
    setCropTop(existing?.cropConfig?.top ?? 0);
    setCropBottom(existing?.cropConfig?.bottom ?? 0);
    setCropLeft(existing?.cropConfig?.left ?? 0);
    setCropRight(existing?.cropConfig?.right ?? 0);
    setSuperRes(existing?.superRes ?? false);
    setPreviewMinutesAgo(0);
    setPreviewDateTime('');
    setPanelOpen(true);
  };

  /** Monta URLs para radar Argentina (fallback de timestamps) */
  function buildArgentinaLatestUrls(station: ArgentinaRadarStation, template: string): { url: string; ts12: string }[] {
    const urls: { url: string; ts12: string }[] = [];
    const interval = station.updateIntervalMinutes ?? 10;
    for (let back = 0; back <= 60; back += 10) {
      const d = new Date(Date.now() - back * 60 * 1000);
      const mRounded = Math.floor(d.getUTCMinutes() / interval) * interval;
      const ts12 = d.getUTCFullYear().toString() +
        String(d.getUTCMonth() + 1).padStart(2, '0') +
        String(d.getUTCDate()).padStart(2, '0') +
        String(d.getUTCHours()).padStart(2, '0') +
        String(mRounded).padStart(2, '0');
      urls.push({
        url: getProxiedRadarUrl(buildRadarPngUrl(template, ts12)),
        ts12,
      });
    }
    return urls;
  }

  /** Abre o painel para configurar um radar Argentina */
  const handleSelectArgentinaStation = (station: ArgentinaRadarStation) => {
    const slug = `argentina:${station.id}`;
    const existing = configs.find((c) => c.stationSlug === slug);
    const interval = existing?.updateIntervalMinutes ?? station.updateIntervalMinutes ?? 10;
    const tsArg = getArgentinaTsArgentina(interval);
    const defaultUrl = buildArgentinaRadarPngUrl(station, tsArg, 'reflectividade');
    const template =
      existing?.urlTemplate ||
      defaultUrl
        .replace(/(\d{4})\/(\d{2})\/(\d{2})\//, '{year}/{month}/{day}/')
        .replace(/_\d{8}T\d{6}Z/, '_{tsArgentina}');

    const initialUrl = buildRadarPngUrl(template, getSampleTs12(interval));
    const urlsToTry = buildArgentinaLatestUrls(station, template);
    setSelectedStation({ type: 'argentina', station });
    setConfig(existing || null);
    setUrlTemplate(template);
    setUpdateIntervalMinutes(interval);
    setSampleUrl(initialUrl);
    const hasValidCoords = existing && (existing.lat !== 0 || existing.lng !== 0);
    setCenterLat(hasValidCoords ? existing!.lat : station.lat);
    setCenterLng(hasValidCoords ? existing!.lng : station.lng);
    setRangeKm(existing?.rangeKm ?? station.rangeKm);
    setRotationDegrees(existing?.rotationDegrees ?? 0);
    setPreviewOpacity(existing?.opacity ?? 0.75);
    setPreviewImageUrl(urlsToTry[0]?.url ?? initialUrl);
    setPreviewUrlsToTry(urlsToTry);
    setLoadingPreview(true);
    setLiveCenter(null);
    setUseCustomBounds(!!existing?.customBounds);
    setCustomBounds(existing?.customBounds || null);
    setChromaKeyDeltaThreshold(existing?.chromaKeyDeltaThreshold ?? 0);
    setCropTop(existing?.cropConfig?.top ?? 0);
    setCropBottom(existing?.cropConfig?.bottom ?? 0);
    setCropLeft(existing?.cropConfig?.left ?? 0);
    setCropRight(existing?.cropConfig?.right ?? 0);
    setSuperRes(existing?.superRes ?? false);
    setPreviewMinutesAgo(0);
    setPreviewDateTime('');
    setPanelOpen(true);
  };

  /** Gera URL de preview e carrega a imagem no mapa. Usa previewMinutesAgo (0–60) para "ao vivo" ou previewDateTime para data custom. */
  const handleGerarPng = () => {
    if (!selectedStation) return;
    let ts12: string;
    const customTs12 = parseDateTimeToTs12(previewDateTime);
    if (customTs12) {
      ts12 = customTs12;
    } else {
      const nominalTs = getNowMinusMinutesTimestamp12UTC(3 + previewMinutesAgo);
      if (selectedStation.type === 'cptec') {
        const station = selectedStation.station as CptecRadarStation;
        if (station.slug === 'ipmet-bauru') {
          ts12 = nominalTs;
        } else {
          ts12 = getNearestRadarTimestamp(nominalTs, station);
        }
      } else {
        const interval = (selectedStation.station as ArgentinaRadarStation).updateIntervalMinutes ?? 10;
        const m = parseInt(nominalTs.slice(10, 12), 10);
        const roundedM = Math.floor(m / interval) * interval;
        ts12 = nominalTs.slice(0, 10) + String(roundedM).padStart(2, '0');
      }
    }
    const isIpmet = selectedStation.type === 'cptec' && (selectedStation.station as CptecRadarStation).slug === 'ipmet-bauru';
    const url = isIpmet ? IPMET_STATIC_URL + `?t=${Date.now()}` : buildRadarPngUrl(urlTemplate, ts12);
    setSampleUrl(url);
    setPreviewUrlsToTry([]);
    setLoadingPreview(true);
    setPreviewImageUrl(isIpmet ? url : getProxiedRadarUrl(url));
    addToast('Carregando preview…', 'success');
  };

  /** Salva posição (lat/lng) após arrastar. Usado no fim do drag. */
  const handleSavePosition = useCallback(async (lat: number, lng: number) => {
    if (!selectedStation || !urlTemplate.trim()) return;
    setCenterLat(lat);
    setCenterLng(lng);
    const s = selectedStation.station;
    const slug: string = selectedStation.type === 'cptec'
      ? (s as CptecRadarStation).slug
      : `argentina:${(s as ArgentinaRadarStation).id}`;
    const id = (selectedStation.type === 'cptec' && radarSource === 'redemet') ? `${slug}-redemet` : slug;
    
    const isIpmet = selectedStation.type === 'cptec' && (s as CptecRadarStation).slug === 'ipmet-bauru';
    const computedBounds = isIpmet && typeof calculateRadarBoundsGeodesic === 'function'
      ? calculateRadarBoundsGeodesic(lat, lng, rangeKm)
      : calculateRadarBounds(lat, lng, rangeKm);
    setSaving(true);
    try {
      await saveRadarConfig({
        id,
        stationSlug: slug,
        name: s.name + (radarSource === 'redemet' ? ' (Redemet)' : ''),
        urlTemplate: urlTemplate.trim(),
        bounds: computedBounds,
        lat,
        lng,
        rangeKm,
        updateIntervalMinutes: updateIntervalMinutes,
        rotationDegrees: rotationDegrees,
        opacity: previewOpacity,
        customBounds: useCustomBounds && customBounds ? customBounds : undefined,
        chromaKeyDeltaThreshold: chromaKeyDeltaThreshold > 0 ? chromaKeyDeltaThreshold : undefined,
        cropConfig: (cropTop > 0 || cropBottom > 0 || cropLeft > 0 || cropRight > 0) ? { top: cropTop, bottom: cropBottom, left: cropLeft, right: cropRight } : undefined,
        superRes: superRes || undefined,
      });
      addToast('Posição salva automaticamente.', 'success');
      await loadConfigs();
    } catch (e: any) {
      addToast(`Erro ao salvar: ${e.message}`, 'error');
    } finally {
      setSaving(false);
    }
  }, [selectedStation, radarSource, urlTemplate, config, rangeKm, updateIntervalMinutes, rotationDegrees, previewOpacity, configs, addToast]);

  /** Marcador draggable do ícone de radar — arrastar apenas o ícone define lat/lng (o mapa não se move) */
  useEffect(() => {
    if (positionMarkerRef.current) {
      positionMarkerRef.current.setMap(null);
      positionMarkerRef.current = null;
    }
    if (!mapReady || !mapInstanceRef.current || !panelOpen || !selectedStation) return;
    const map = mapInstanceRef.current;
    const lat = liveCenter ? liveCenter.lat : centerLat;
    const lng = liveCenter ? liveCenter.lng : centerLng;
    const marker = new google.maps.Marker({
      map,
      position: { lat, lng },
      draggable: true,
      icon: {
        url: '/radar-icon.svg',
        scaledSize: new google.maps.Size(36, 36),
        anchor: new google.maps.Point(18, 18),
      },
      title: 'Arraste para posicionar',
      zIndex: 1000,
    });
    marker.addListener('dragend', () => {
      const pos = marker.getPosition();
      if (pos) {
        const newLat = pos.lat();
        const newLng = pos.lng();
        setCenterLat(newLat);
        setCenterLng(newLng);
        setLiveCenter(null);
        handleSavePosition(newLat, newLng);
      }
    });
    positionMarkerRef.current = marker;
    return () => {
      if (positionMarkerRef.current) {
        positionMarkerRef.current.setMap(null);
        positionMarkerRef.current = null;
      }
    };
  }, [mapReady, panelOpen, selectedStation, centerLat, centerLng, liveCenter, handleSavePosition]);

  // === LOCAL CANVAS PROCESSOR ===
  // Ativado sempre que os sliders do Estúdio mexerem.
  useEffect(() => {
    let active = true;
    if (!previewImageUrl) {
      setProcessedImageUrl(null);
      return;
    }
    const runFilter = async () => {
      try {
        let blob: Blob;
        try {
          const res = await fetch(previewImageUrl, { mode: 'cors' });
          if (!res.ok) throw new Error('CORS');
          blob = await res.blob();
        } catch {
          const res = await fetch(getProxiedRadarUrl(previewImageUrl));
          if (!res.ok) return;
          blob = await res.blob();
        }
        if (!active) return;
        
        const bitmap = await createImageBitmap(blob);
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();

        // 1. Cropping
        if (cropTop > 0) ctx.clearRect(0, 0, canvas.width, canvas.height * cropTop);
        if (cropBottom > 0) ctx.clearRect(0, canvas.height * (1 - cropBottom), canvas.width, canvas.height * cropBottom);
        if (cropLeft > 0) ctx.clearRect(0, 0, canvas.width * cropLeft, canvas.height);
        if (cropRight > 0) ctx.clearRect(canvas.width * (1 - cropRight), 0, canvas.width * cropRight, canvas.height);

        // 2. Chroma Key Saturation Delta
        if (chromaKeyDeltaThreshold > 0) {
          const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const d = imgData.data;
          for (let i = 0; i < d.length; i += 4) {
            if (d[i + 3] === 0) continue;
            const r = d[i], g = d[i + 1], b = d[i + 2];
            const max = Math.max(r, g, b);
            const min = Math.min(r, g, b);
            if (max - min < chromaKeyDeltaThreshold) {
              d[i + 3] = 0;
              continue;
            }
            // Remove as rodovias pre-calculadas como lixo sujo (mesma lógica Climatempo base)
            if (r > 130 && r < 210 && g > 110 && g < 190 && b < 100) { d[i+3] = 0; }
            if (r < 100 && g < 120 && b < 120 && (max-min) < 80) { d[i+3] = 0; }
          }
          ctx.putImageData(imgData, 0, 0);
        }
        
        // Se NENHUM filtro extra foi ativado, não force a renderização para economizar processamento
        if (chromaKeyDeltaThreshold === 0 && cropTop === 0 && cropBottom === 0 && cropLeft === 0 && cropRight === 0) {
          setProcessedImageUrl(null);
          return;
        }

        const dataUrl = canvas.toDataURL('image/png');
        if (active) setProcessedImageUrl(dataUrl);
      } catch (e) {
        console.error("Canvas Studio Filter Error:", e);
      }
    };
    runFilter();
    return () => { active = false; };
  }, [previewImageUrl, chromaKeyDeltaThreshold, cropTop, cropBottom, cropLeft, cropRight]);

  /** Overlay da imagem no mapa — arrastável, e Suporte a Rectangle Bounds */
  useEffect(() => {
    if (overlayRef.current) {
      (overlayRef.current as any).setMap?.(null);
      overlayRef.current = null;
    }
    if (!mapReady || !mapInstanceRef.current || !panelOpen || !selectedStation) return;

    const map = mapInstanceRef.current;
    const mapDiv = map.getDiv();
    const isIpmet = selectedStation?.type === 'cptec' && (selectedStation.station as CptecRadarStation).slug === 'ipmet-bauru';
    const calcBounds = isIpmet && typeof calculateRadarBoundsGeodesic === 'function' ? calculateRadarBoundsGeodesic : calculateRadarBounds;
    const defaultB = calcBounds(centerLat, centerLng, rangeKm);
    
    // Matriz Fonte de Origem
    const currentB = (useCustomBounds && customBounds) ? { 
       sw: { lat: customBounds.south, lng: customBounds.west }, 
       ne: { lat: customBounds.north, lng: customBounds.east } 
    } : defaultB;

    const latLngBounds = new google.maps.LatLngBounds(
      { lat: currentB.sw.lat, lng: currentB.sw.lng },
      { lat: currentB.ne.lat, lng: currentB.ne.lng }
    );

    let moveHandler: (e: MouseEvent) => void;
    let upHandler: () => void;

    const ov = new google.maps.OverlayView();
    let divEl: HTMLDivElement | null = null;
    let rectEl: any = null;

    if (useCustomBounds) {
      rectEl = new google.maps.Rectangle({
        bounds: latLngBounds,
        editable: true,
        draggable: true,
        map: map,
        fillOpacity: 0.05,
        strokeColor: '#facc15', // Yellow Box
        strokeWeight: 2,
        zIndex: 50
      });
      rectEl.addListener('bounds_changed', () => {
        const nb = rectEl.getBounds();
        if (!nb) return;
        setCustomBounds({
          north: nb.getNorthEast().lat(),
          south: nb.getSouthWest().lat(),
          east: nb.getNorthEast().lng(),
          west: nb.getSouthWest().lng()
        });
        if (divEl && ov.getProjection()) { // Forçar redesenho na hora do arrasto pra parecer liso
          const swP = ov.getProjection().fromLatLngToDivPixel(nb.getSouthWest());
          const neP = ov.getProjection().fromLatLngToDivPixel(nb.getNorthEast());
          if (swP && neP) {
            divEl.style.left = Math.min(swP.x, neP.x) + 'px';
            divEl.style.top = Math.min(swP.y, neP.y) + 'px';
            divEl.style.width = Math.abs(neP.x - swP.x) + 'px';
            divEl.style.height = Math.abs(neP.y - swP.y) + 'px';
          }
        }
      });
    }

    ov.onAdd = () => {
      divEl = document.createElement('div');
      divEl.style.cssText = `position:absolute;user-select:none;${useCustomBounds ? 'pointer-events:none;' : 'pointer-events:auto;cursor:grab;border:2px solid #22d3ee;'}`;
      
      if (!useCustomBounds) {
        divEl.addEventListener('mousedown', (e: MouseEvent) => {
          e.preventDefault(); e.stopPropagation();
          const proj = ov.getProjection();
          if (!proj) return;
          const rect = mapDiv.getBoundingClientRect();
          const offsetX = (e.clientX - rect.left) - proj.fromLatLngToDivPixel(new google.maps.LatLng(centerLat, centerLng))!.x;
          const offsetY = (e.clientY - rect.top) - proj.fromLatLngToDivPixel(new google.maps.LatLng(centerLat, centerLng))!.y;
          divEl!.style.cursor = 'grabbing';
  
          moveHandler = (e2: MouseEvent) => {
            const mx = e2.clientX - rect.left - offsetX;
            const my = e2.clientY - rect.top - offsetY;
            const pt = proj.fromDivPixelToLatLng(new google.maps.Point(mx, my));
            if (!pt || !divEl) return;
            setLiveCenter({ lat: pt.lat(), lng: pt.lng() });
          };
          upHandler = () => {
            divEl!.style.cursor = 'grab';
            document.removeEventListener('mousemove', moveHandler);
            document.removeEventListener('mouseup', upHandler);
            setLiveCenter(prev => { 
                if(prev) handleSavePosition(prev.lat, prev.lng); 
                return null; 
            });
          };
          document.addEventListener('mousemove', moveHandler);
          document.addEventListener('mouseup', upHandler);
        });
      }

      const inner = document.createElement('div');
      inner.style.cssText = 'width:100%;height:100%;position:relative;min-height:80px;pointer-events:none;';
      const urlsToTry = previewUrlsToTry;
      if (processedImageUrl || previewImageUrl || urlsToTry.length > 0) {
        const img = document.createElement('img');
        img.style.cssText = `width:100%;height:100%;opacity:${previewOpacity};object-fit:fill;transform-origin:center center;pointer-events:none;`;
        img.style.transform = `rotate(${rotationDegrees}deg)`;
        
        let tryIndex = 0;
        const tryNext = () => {
          if (urlsToTry.length > 0 && tryIndex < urlsToTry.length) {
            img.src = urlsToTry[tryIndex].url; tryIndex += 1; return;
          }
          setLoadingPreview(false);
        };
        img.onload = () => setLoadingPreview(false);
        img.onerror = tryNext;
        
        // Prioriza Processed (do Canvas) frente a preview estático da Rede.
        if (processedImageUrl) {
           img.src = processedImageUrl;
        } else if (urlsToTry.length > 0) {
          img.src = urlsToTry[0].url; tryIndex = 1;
        } else {
          img.src = (previewImageUrl || '').includes('getradaripmet') || (previewImageUrl || '').includes('cloudfunctions.net') ? (previewImageUrl || '') : getProxiedRadarUrl(previewImageUrl || '');
        }
        inner.appendChild(img);
      } else {
        const ph = document.createElement('div');
        ph.style.cssText = 'width:100%;height:100%;min-height:80px;background:rgba(34,211,238,0.1);';
        inner.appendChild(ph);
      }
      
      const centerIcon = document.createElement('img');
      centerIcon.src = '/radar-icon.svg';
      centerIcon.alt = 'Posição do radar';
      centerIcon.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:36px;height:36px;pointer-events:none;';
      centerIcon.setAttribute('aria-hidden', 'true');
      inner.appendChild(centerIcon);
      divEl.appendChild(inner);
      ov.getPanes()?.overlayMouseTarget?.appendChild(divEl);
    };
    
    ov.draw = () => {
      if (!divEl) return;
      const proj = ov.getProjection();
      if (!proj) return;
      
      // Override Bounding box se Rect estiver ativo!
      const activeBounds = rectEl ? rectEl.getBounds() : latLngBounds;
      const sw = proj.fromLatLngToDivPixel(activeBounds.getSouthWest());
      const ne = proj.fromLatLngToDivPixel(activeBounds.getNorthEast());
      if (!sw || !ne) return;
      divEl.style.left = Math.min(sw.x, ne.x) + 'px';
      divEl.style.top = Math.min(sw.y, ne.y) + 'px';
      divEl.style.width = Math.abs(ne.x - sw.x) + 'px';
      divEl.style.height = Math.abs(ne.y - sw.y) + 'px';
    };
    
    ov.onRemove = () => {
      if(moveHandler) document.removeEventListener('mousemove', moveHandler);
      if(upHandler) document.removeEventListener('mouseup', upHandler);
      divEl?.parentNode?.removeChild(divEl!);
      divEl = null;
    };
    
    ov.setMap(map);
    overlayRef.current = ov;

    // Apenas ajustar o zoom inicialmente quando o painel abrir. 
    // Como esse Hook roda com muita frequência por variações do mouse, vamos focar a câmera manual só no save.
    
    return () => {
      if(rectEl) rectEl.setMap(null);
      (ov as any).setMap?.(null);
      overlayRef.current = null;
    };
  }, [mapReady, panelOpen, selectedStation, previewImageUrl, processedImageUrl, previewUrlsToTry, centerLat, centerLng, rangeKm, rotationDegrees, previewOpacity, useCustomBounds]); // Removido customBounds daqui pois o listener cuida do drag contínuo

  /** Preencher centro e raio a partir da estação padrão */
  const handleUseStationDefaults = () => {
    if (!selectedStation) return;
    const s = selectedStation.station;
    setCenterLat(s.lat);
    setCenterLng(s.lng);
    setRangeKm(s.rangeKm);
    addToast('Centro e raio preenchidos da estação.', 'success');
  };

  const handleSave = async () => {
    if (!selectedStation || !urlTemplate.trim()) {
      addToast('Preencha a URL template e o centro da antena.', 'error');
      return;
    }
    const s = selectedStation.station;
    const slug: string = selectedStation.type === 'cptec'
      ? (s as CptecRadarStation).slug
      : `argentina:${(s as ArgentinaRadarStation).id}`;
    const id = (selectedStation.type === 'cptec' && radarSource === 'redemet') ? `${slug}-redemet` : slug;

    const isIpmet = selectedStation.type === 'cptec' && (s as CptecRadarStation).slug === 'ipmet-bauru';
    const computedBounds = isIpmet && typeof calculateRadarBoundsGeodesic === 'function'
      ? calculateRadarBoundsGeodesic(centerLat, centerLng, rangeKm)
      : calculateRadarBounds(centerLat, centerLng, rangeKm);
    setSaving(true);
    try {
      await saveRadarConfig({
        id,
        stationSlug: slug,
        name: s.name + (radarSource === 'redemet' ? ' (Redemet)' : ''),
        urlTemplate: urlTemplate.trim(),
        bounds: computedBounds,
        lat: centerLat,
        lng: centerLng,
        rangeKm,
        updateIntervalMinutes: updateIntervalMinutes,
        rotationDegrees: rotationDegrees,
        opacity: previewOpacity,
        customBounds: (useCustomBounds && customBounds) ? customBounds : undefined,
        chromaKeyDeltaThreshold: (chromaKeyDeltaThreshold ?? 0) > 0 ? chromaKeyDeltaThreshold : undefined,
        cropConfig: (cropTop > 0 || cropBottom > 0 || cropLeft > 0 || cropRight > 0) ? { top: cropTop, bottom: cropBottom, left: cropLeft, right: cropRight } : undefined,
        superRes: superRes || undefined,
      });
      addToast('Configuração salva.', 'success');
      await loadConfigs();
    } catch (e: any) {
      addToast(`Erro ao salvar: ${e.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    setSelectedStation(null);
    setConfig(null);
    setPanelOpen(false);
    setPreviewImageUrl(null);
    setLiveCenter(null);
  };

  return (
    <div className="fixed inset-0 flex flex-col bg-slate-950 text-white z-40">
      <header className="flex-shrink-0 flex items-center justify-between gap-3 px-4 py-2 bg-slate-900/90 border-b border-slate-700">
        <div className="flex items-center gap-3">
          <Link href="/admin" className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300">
            <ChevronLeft className="w-5 h-5" />
          </Link>
          <h1 className="text-base font-bold flex items-center gap-2">
            <Radar className="w-5 h-5 text-cyan-400" />
            Radares Meteorológicos (Admin)
          </h1>
        </div>
      </header>

      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 min-h-0 relative">
          <div ref={mapRef} className="absolute inset-0 w-full h-full" />

          {/* Botão e galeria de estilos de mapa */}
          <div className="absolute top-3 left-3 z-10">
            <button
              type="button"
              onClick={() => setShowBaseMapGallery((v) => !v)}
              className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-slate-900/95 border border-slate-600 text-slate-200 hover:bg-slate-800 shadow-lg"
            >
              <Layers className="w-4 h-4" />
              <span className="text-sm font-medium">Mapa base</span>
            </button>
            {showBaseMapGallery && (
              <>
                <div className="absolute inset-0 -z-10" aria-hidden onClick={() => setShowBaseMapGallery(false)} />
                <div className="absolute top-full left-0 mt-1 w-72 rounded-lg border border-slate-600 bg-slate-900 shadow-xl p-3 animate-in fade-in slide-in-from-top-2 duration-150">
                  <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
                    Estilo do mapa
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
                          className={`rounded-lg overflow-hidden border-2 text-left transition-all hover:border-cyan-500/50 ${
                            isSelected ? 'border-cyan-500 ring-1 ring-cyan-500/30' : 'border-slate-600'
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
                              <div className="absolute top-1 right-1 rounded-full bg-cyan-500 p-0.5">
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

          {loadingPreview && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/40 z-10">
              <Loader2 className="w-12 h-12 animate-spin text-cyan-400" />
            </div>
          )}
        </div>

        {/* Sidebar: lista de radares */}
        <aside className="flex-shrink-0 w-80 bg-slate-900 border-l border-slate-700 flex flex-col overflow-hidden">
          <div className="p-3 border-b border-slate-700">
            <h3 className="font-semibold text-slate-200">Radares CPTEC</h3>
            <p className="text-xs text-slate-500 mt-1">
              Selecione um radar para configurar a URL e o posicionamento no mapa.
            </p>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-4">
            {loading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
              </div>
            ) : (
              <>
                <div>
                  <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Radares CPTEC</h4>
                  <div className="grid gap-1">
                    {CPTEC_RADAR_STATIONS.map((station) => {
                      const saved = configs.find((c) => c.stationSlug === station.slug);
                      const isSelected = selectedStation?.type === 'cptec' && selectedStation.station.slug === station.slug;
                      return (
                        <button
                          key={station.slug}
                          type="button"
                          onClick={() => handleSelectStation(station)}
                          className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-left transition-colors ${
                            isSelected
                              ? 'bg-cyan-600/30 border border-cyan-500/50 text-cyan-200'
                              : 'bg-slate-800/50 hover:bg-slate-700 border border-slate-600 text-slate-300'
                          }`}
                        >
                          <Plus className="w-4 h-4 flex-shrink-0 text-slate-500" />
                          <span className="font-medium truncate">{station.name}</span>
                          {saved && (
                            <span title="Configurado"><Check className="w-4 h-4 flex-shrink-0 text-emerald-400 ml-auto" aria-label="Configurado" /></span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Radares Argentina (OHMC)</h4>
                  <div className="grid gap-1">
                    {ARGENTINA_RADAR_STATIONS.map((station) => {
                      const slug = `argentina:${station.id}`;
                      const saved = configs.find((c) => c.stationSlug === slug);
                      const isSelected = selectedStation?.type === 'argentina' && selectedStation.station.id === station.id;
                      return (
                        <button
                          key={station.id}
                          type="button"
                          onClick={() => handleSelectArgentinaStation(station)}
                          className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-left transition-colors ${
                            isSelected
                              ? 'bg-cyan-600/30 border border-cyan-500/50 text-cyan-200'
                              : 'bg-slate-800/50 hover:bg-slate-700 border border-slate-600 text-slate-300'
                          }`}
                        >
                          <Plus className="w-4 h-4 flex-shrink-0 text-slate-500" />
                          <span className="font-medium truncate">{station.name}</span>
                          {saved && (
                            <span title="Configurado"><Check className="w-4 h-4 flex-shrink-0 text-emerald-400 ml-auto" aria-label="Configurado" /></span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
        </aside>
      </div>

      {/* Painel de edição */}
      {panelOpen && selectedStation && (
        <>
          <div className="absolute inset-0 bg-black/50 z-20 pointer-events-none" aria-hidden />
          <div className="absolute top-0 right-0 bottom-0 w-full max-w-md bg-slate-900 border-l border-slate-700 shadow-2xl z-30 flex flex-col animate-in slide-in-from-right duration-200">
            <div className="flex items-center justify-between flex-shrink-0 p-3 border-b border-slate-700">
              <div className="flex flex-col">
                <h3 className="font-semibold text-slate-200 flex items-center gap-2">
                  <MapPin className="w-4 h-4" />
                  {selectedStation.station.name}
                  {selectedStation.type === 'argentina' && (
                    <span className="text-xs font-normal text-slate-500">(Argentina)</span>
                  )}
                </h3>
                {selectedStation.type === 'cptec' && hasRedemetFallback(selectedStation.station.slug) && (
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={() => handleSelectStation(selectedStation.station, 'cptec')}
                      className={`px-3 py-1 rounded text-xs font-bold transition-colors ${radarSource === 'cptec' ? 'bg-cyan-500 text-black' : 'bg-slate-800 text-slate-400 hover:text-slate-200'}`}
                    >
                      NORMAL (CPTEC)
                    </button>
                    <button
                      onClick={() => handleSelectStation(selectedStation.station, 'redemet')}
                      className={`px-3 py-1 rounded text-xs font-bold transition-colors ${radarSource === 'redemet' ? 'bg-cyan-500 text-black' : 'bg-slate-800 text-slate-400 hover:text-slate-200'}`}
                    >
                      HD (REDEMET)
                    </button>
                  </div>
                )}
              </div>
              <button type="button" onClick={handleClose} className="p-2 text-slate-400 hover:text-white rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
              <div>
                <label className="text-slate-400 text-sm block mb-1">URL do FTP / Nowcasting</label>
                <p className="text-xs text-slate-500 mb-2">
                  CPTEC: use {'{year}'}, {'{month}'}, {'{ts12}'}. Argentina: use {'{year}'}, {'{month}'}, {'{day}'}, {'{tsArgentina}'}.
                </p>
                <div className="flex gap-2">
                  <input
                    type="url"
                    value={urlTemplate}
                    onChange={(e) => setUrlTemplate(e.target.value)}
                    placeholder="https://s1.cptec.inpe.br/radar/sdcsc/chapeco/ppi/ppicz/2026/03/R12137761_202603162148.png"
                    className="flex-1 bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const t = urlTemplate
                        .replace(/\d{4}\/\d{2}\//, '{year}/{month}/')
                        .replace(/(\d{12})(\.png)/i, '{ts12}$2');
                      if (t !== urlTemplate) {
                        setUrlTemplate(t);
                        addToast('URL convertida para template.', 'success');
                      }
                    }}
                    className="px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs whitespace-nowrap"
                  >
                    Converter
                  </button>
                </div>
              </div>
              <div>
                <label className="text-slate-400 text-sm block mb-1">Intervalo de atualização (min)</label>
                <p className="text-xs text-slate-500 mb-2">
                  Santiago usa 10 min; demais radares usam 6 min.
                </p>
                <select
                  value={updateIntervalMinutes}
                  onChange={(e) => setUpdateIntervalMinutes(Number(e.target.value))}
                  className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm"
                >
                  <option value={5}>5 minutos</option>
                  <option value={6}>6 minutos</option>
                  <option value={10}>10 minutos (Santiago, Argentina)</option>
                </select>
              </div>
              <button
                type="button"
                onClick={handleGerarPng}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-medium"
              >
                {loadingPreview ? <Loader2 className="w-4 h-4 animate-spin" /> : <Radar className="w-4 h-4" />}
                Gerar imagem do ao vivo
              </button>
              <div>
                <label className="text-slate-400 text-sm block mb-1">Tempo da imagem (0–60 min atrás)</label>
                <p className="text-xs text-slate-500 mb-2">
                  Arraste para buscar imagens mais antigas. 0 = mais recente.
                </p>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={0}
                    max={60}
                    step={1}
                    value={previewMinutesAgo}
                    onChange={(e) => setPreviewMinutesAgo(Number(e.target.value))}
                    className="flex-1 h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                  />
                  <span className="text-sm font-mono text-cyan-400 min-w-[2.5rem]">{previewMinutesAgo} min</span>
                </div>
              </div>
              <div>
                <label className="text-slate-400 text-sm block mb-1">Data/hora do preview (opcional)</label>
                <p className="text-xs text-slate-500 mb-2">
                  Preencha para imagens históricas. Se vazio, usa o slider acima.
                </p>
                <div className="flex gap-2">
                  <input
                    type="datetime-local"
                    value={previewDateTime}
                    onChange={(e) => setPreviewDateTime(e.target.value)}
                    className="flex-1 bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setPreviewDateTime('');
                      setPreviewMinutesAgo(0);
                    }}
                    className="px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs whitespace-nowrap"
                  >
                    Limpar
                  </button>
                </div>
              </div>

              <div>
                <label className="text-slate-400 text-sm block mb-1">Rotacionar imagem (°)</label>
                <p className="text-xs text-slate-500 mb-2">
                  Arraste o slider ou digite o valor exato (ex: -110, 1.5) para alinhar com o mapa.
                </p>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={-360}
                    max={360}
                    step={0.5}
                    value={Math.max(-360, Math.min(360, rotationDegrees))}
                    onChange={(e) => setRotationDegrees(parseFloat(e.target.value))}
                    className="flex-1 h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                  />
                  <input
                    type="number"
                    min={-360}
                    max={360}
                    step={0.1}
                    value={rotationDegrees}
                    onChange={(e) => setRotationDegrees(parseFloat(e.target.value) || 0)}
                    className="w-20 bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm font-mono text-cyan-400"
                  />
                </div>
              </div>

              <div>
                <label className="text-slate-400 text-sm block mb-1">Opacidade da imagem</label>
                <p className="text-xs text-slate-500 mb-2">
                  Ajuste a transparência da imagem durante a edição para ver melhor o mapa de fundo.
                </p>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={0.1}
                    max={1}
                    step={0.05}
                    value={previewOpacity}
                    onChange={(e) => setPreviewOpacity(parseFloat(e.target.value))}
                    className="flex-1 h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                  />
                  <span className="text-sm font-mono text-cyan-400 min-w-[3rem]">{Math.round(previewOpacity * 100)}%</span>
                </div>
              </div>

              <div>
                <label className="text-slate-400 text-sm block mb-1">Centro da antena (lat, lng)</label>
                <p className="text-xs text-slate-500 mb-2">
                  Arraste a imagem no mapa para posicionar (o ponto central define lat/lng). Salvamento automático ao soltar.
                </p>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <input
                    type="number"
                    step="any"
                    placeholder="Latitude"
                    value={liveCenter ? liveCenter.lat : (centerLat || '')}
                    onChange={(e) => {
                      setLiveCenter(null);
                      setCenterLat(parseFloat(e.target.value) || 0);
                    }}
                    className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm"
                  />
                  <input
                    type="number"
                    step="any"
                    placeholder="Longitude"
                    value={liveCenter ? liveCenter.lng : (centerLng || '')}
                    onChange={(e) => {
                      setLiveCenter(null);
                      setCenterLng(parseFloat(e.target.value) || 0);
                    }}
                    className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleUseStationDefaults}
                  className="text-xs text-cyan-400 hover:text-cyan-300 mb-3"
                >
                  Preencher da estação ({selectedStation.station.rangeKm} km)
                </button>
              </div>
              <div>
                <label className="text-slate-400 text-sm block mb-1">Raio do feixe (km)</label>
                <p className="text-xs text-slate-500 mb-2">
                  Alcance do radar. Chapecó: 450 km · Santiago: 250 km.
                </p>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={50}
                    max={500}
                    step={10}
                    value={rangeKm}
                    onChange={(e) => setRangeKm(Number(e.target.value))}
                    className="flex-1 h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                  />
                  <span className="text-sm font-mono text-cyan-400 min-w-[3rem]">{rangeKm} km</span>
                </div>
              </div>
              <div>
                <label className="text-slate-400 text-sm block mb-1">Bounds (calculados, somente leitura)</label>
                <div className="grid grid-cols-2 gap-2 text-xs bg-slate-800/50 rounded px-3 py-2 border border-slate-700">
                  <div>
                    <span className="text-slate-500">NE</span>
                    <div className="font-mono text-slate-300">{bounds.ne.lat.toFixed(4)}, {bounds.ne.lng.toFixed(4)}</div>
                  </div>
                  <div>
                    <span className="text-slate-500">SW</span>
                    <div className="font-mono text-slate-300">{bounds.sw.lat.toFixed(4)}, {bounds.sw.lng.toFixed(4)}</div>
                  </div>
                </div>
              </div>

              {/* ==== SEÇÃO DO ESTÚDIO DE RADAR ==== */}
              <div className="border-t border-slate-700 pt-4 mt-2">
                <h4 className="font-semibold text-emerald-400 flex items-center gap-2 mb-3">
                  <Layers className="w-4 h-4" /> Canvas Studio Override
                </h4>

                <div className="mb-4">
                  <label className="flex items-center gap-2 text-sm text-slate-200 cursor-pointer">
                    <input 
                      type="checkbox" 
                      checked={useCustomBounds} 
                      onChange={(e) => {
                        setUseCustomBounds(e.target.checked);
                        if (e.target.checked && !customBounds) {
                          setCustomBounds({ north: bounds.ne.lat, south: bounds.sw.lat, east: bounds.ne.lng, west: bounds.sw.lng });
                        }
                      }}
                      className="rounded border-slate-600 bg-slate-800 text-cyan-500 focus:ring-cyan-500"
                    />
                    Ativar Mapeamento Livre (Custom Bounds)
                  </label>
                  <p className="text-xs text-slate-500 ml-6 mt-1">Gere uma <b>caixa amarela</b> no mapa. Arraste as quinas dela para esticar o radar independentemente do raio do feixe.</p>
                </div>

                <div className="mb-4">
                  <label className="text-slate-400 text-sm block mb-1">Corte de Saturação (Delta ChromaKey)</label>
                  <p className="text-xs text-slate-500 mb-2">Elimina cores neutras (terras, oceanos, legenda, ruas). Recomenda-se <b>60</b> ou mais para climatempo. (0 para Desligar).</p>
                  <div className="flex items-center gap-3">
                    <input type="range" min={0} max={200} step={5} value={chromaKeyDeltaThreshold} onChange={(e) => setChromaKeyDeltaThreshold(Number(e.target.value))} className="flex-1 h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-emerald-500" />
                    <span className="text-sm font-mono text-emerald-400 min-w-[2.5rem]">{chromaKeyDeltaThreshold}</span>
                  </div>
                </div>

                <div className="mb-2">
                  <label className="text-slate-400 text-sm block mb-1">Cropping Margem Inferior (0.0 até 1.0)</label>
                  <p className="text-xs text-slate-500 mb-2">Cortar pedaço da parte de baixo da imagem (ex: 0.25 corta um quarto da base).</p>
                  <div className="flex items-center gap-3">
                    <input type="range" min={0} max={0.5} step={0.01} value={cropBottom} onChange={(e) => setCropBottom(Number(e.target.value))} className="flex-1 h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-emerald-500" />
                    <span className="text-sm font-mono text-emerald-400 min-w-[2.5rem]">{cropBottom}</span>
                  </div>
                </div>

                <div className="mb-2">
                  <label className="text-slate-400 text-sm block mb-1">Cropping Margem Direita (0.0 até 1.0)</label>
                  <div className="flex items-center gap-3">
                    <input type="range" min={0} max={0.5} step={0.01} value={cropRight} onChange={(e) => setCropRight(Number(e.target.value))} className="flex-1 h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-emerald-500" />
                    <span className="text-sm font-mono text-emerald-400 min-w-[2.5rem]">{cropRight}</span>
                  </div>
                </div>

                <div className="mb-2">
                  <label className="text-slate-400 text-sm block mb-1">Cropping Margem Superior / Esquerda</label>
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-xs text-slate-500 w-8">Top</span>
                    <input type="range" min={0} max={0.5} step={0.01} value={cropTop} onChange={(e) => setCropTop(Number(e.target.value))} className="flex-1 h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-emerald-500" />
                    <span className="text-sm font-mono text-emerald-400 min-w-[2.5rem]">{cropTop}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-slate-500 w-8">Left</span>
                    <input type="range" min={0} max={0.5} step={0.01} value={cropLeft} onChange={(e) => setCropLeft(Number(e.target.value))} className="flex-1 h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-emerald-500" />
                    <span className="text-sm font-mono text-emerald-400 min-w-[2.5rem]">{cropLeft}</span>
                  </div>
                </div>

              </div>

              {/* Super Res — Doppler Velocity Denoising */}
              <div className="mt-4 p-3 rounded-lg border border-purple-500/30 bg-purple-900/20">
                <label className="flex items-center gap-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={superRes}
                    onChange={(e) => setSuperRes(e.target.checked)}
                    className="w-5 h-5 rounded accent-purple-500 cursor-pointer"
                  />
                  <div>
                    <span className="text-purple-300 font-bold text-sm">⚡ Super Res</span>
                    <p className="text-slate-400 text-xs mt-0.5">Pipeline de 3 estágios para limpar ruído do Doppler (velocidade). Aplica máscara de refletividade, remove clusters isolados e corrige outliers internos.</p>
                  </div>
                </label>
              </div>

              {/* ==== FIM ESTÚDIO ==== */}

              <div className="flex gap-2 pt-4">
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving || !bounds}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Salvar
                </button>
                <button type="button" onClick={handleClose} className="px-4 py-2 rounded-lg text-slate-400 hover:text-white border border-slate-600">
                  Fechar
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
