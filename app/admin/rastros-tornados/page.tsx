'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { BeforeAfterCompare } from '@/components/BeforeAfterCompare';
import { ChevronLeft, ChevronRight, Trash2, Edit, Wind, Loader2, PlusCircle, List, X, Layers, Check, Filter, Search, Upload } from 'lucide-react';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '@/lib/firebase';
import { MAP_STYLE_DARK } from '@/lib/constants';
import { fetchTornadoTracks, saveTornadoTrack, deleteTornadoTrack } from '@/lib/tornadoTracksStore';
import {
  TORNADO_TRACK_COLORS,
  F_SCALE_ORDER,
  previousFScale,
  isPolygonWithinRing,
  PREVOTS_LEVEL_COLORS,
  PREVOTS_LEVEL_ORDER,
  type TornadoTrack,
  type TornadoDamagePolygon,
  type PrevotsPolygon,
  type PrevotsLevel,
  type FScale,
  type NumericalModelImage,
  getMaxIntensity,
} from '@/lib/tornadoTracksData';
import { CPTEC_RADAR_STATIONS } from '@/lib/cptecRadarStations';
import { BRASIL_GEOJSON_URL, getBrazilPolygons, clipPolygonToBrazil, type BrazilForClip } from '@/lib/brazilClip';

declare const google: any;

/** Definições proj4 para projeções comuns no Brasil (evita roundtrip à rede) */
const COMMON_PROJ4_DEFS: Record<number, string> = {
  32721: '+proj=utm +zone=21 +south +datum=WGS84 +units=m +no_defs',
  32722: '+proj=utm +zone=22 +south +datum=WGS84 +units=m +no_defs',
  32723: '+proj=utm +zone=23 +south +datum=WGS84 +units=m +no_defs',
  32724: '+proj=utm +zone=24 +south +datum=WGS84 +units=m +no_defs',
  32725: '+proj=utm +zone=25 +south +datum=WGS84 +units=m +no_defs',
  31981: '+proj=utm +zone=21 +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
  31982: '+proj=utm +zone=22 +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
  31983: '+proj=utm +zone=23 +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
  31984: '+proj=utm +zone=24 +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
  31985: '+proj=utm +zone=25 +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
  3857:  '+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +wktext +no_defs',
  900913: '+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +wktext +no_defs',
  4674: '+proj=longlat +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +no_defs',
  4618: '+proj=longlat +ellps=aust_SA +no_defs',
  29191: '+proj=utm +zone=21 +south +ellps=aust_SA +towgs84=-66.87,4.37,-38.52,0,0,0,0 +units=m +no_defs',
  29192: '+proj=utm +zone=22 +south +ellps=aust_SA +towgs84=-66.87,4.37,-38.52,0,0,0,0 +units=m +no_defs',
  29193: '+proj=utm +zone=23 +south +ellps=aust_SA +towgs84=-66.87,4.37,-38.52,0,0,0,0 +units=m +no_defs',
};

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

function getStaticMapPreviewUrl(maptype: string): string {
  const key = typeof process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY === 'string'
    ? process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
    : '';
  if (!key || key.startsWith('COLE_SUA')) return '';
  return `https://maps.googleapis.com/maps/api/staticmap?center=-14,-52&zoom=4&size=180x120&maptype=${maptype}&key=${key}`;
}

export default function AdminRastrosTornadosPage() {
  const { user } = useAuth();
  const { addToast } = useToast();
  const router = useRouter();
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const drawingManagerRef = useRef<any>(null);
  const prevotsDrawingManagerRef = useRef<any>(null);
  const polygonsOnMapRef = useRef<any[]>([]);
  const prevotsPolygonsOnMapRef = useRef<any[]>([]);
  const allTracksPolygonsRef = useRef<any[]>([]);
  const overlayBeforeRef = useRef<any>(null);
  const overlayAfterRef = useRef<any>(null);
  const [mapSearchQuery, setMapSearchQuery] = useState('');
  const [mapSearching, setMapSearching] = useState(false);

  const [tracks, setTracks] = useState<TornadoTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [drawMode, setDrawMode] = useState(false);
  const [drawIntensity, setDrawIntensity] = useState<FScale>('F0');

  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [country, setCountry] = useState('Brasil');
  const [state, setState] = useState('');
  const [locality, setLocality] = useState('');
  const [description, setDescription] = useState('');
  const [source, setSource] = useState('');
  const [radarWmsUrl, setRadarWmsUrl] = useState('');
  const [radarStationId, setRadarStationId] = useState('');
  const [beforeImage, setBeforeImage] = useState('');
  const [afterImage, setAfterImage] = useState('');
  const [beforeImageBounds, setBeforeImageBounds] = useState<{ ne: { lat: number; lng: number }; sw: { lat: number; lng: number } } | null>(null);
  const [afterImageBounds, setAfterImageBounds] = useState<{ ne: { lat: number; lng: number }; sw: { lat: number; lng: number } } | null>(null);
  const [showOverlayBefore, setShowOverlayBefore] = useState(false);
  const [showOverlayAfter, setShowOverlayAfter] = useState(false);
  const [overlayBeforeOpacity, setOverlayBeforeOpacity] = useState(0.75);
  const [overlayAfterOpacity, setOverlayAfterOpacity] = useState(0.75);
  const [beforeImageUploading, setBeforeImageUploading] = useState(false);
  const [afterImageUploading, setAfterImageUploading] = useState(false);
  const [showBeforeAfterDialog, setShowBeforeAfterDialog] = useState(false);
  const beforeImageFileInputRef = useRef<HTMLInputElement>(null);
  const afterImageFileInputRef = useRef<HTMLInputElement>(null);
  const [trackImage, setTrackImage] = useState('');
  const [trackImageBounds, setTrackImageBounds] = useState<{ ne: { lat: number; lng: number }; sw: { lat: number; lng: number } } | null>(null);
  const [polygons, setPolygons] = useState<TornadoDamagePolygon[]>([]);
  const [prevotsPolygons, setPrevotsPolygons] = useState<PrevotsPolygon[]>([]);
  const [drawPrevotsMode, setDrawPrevotsMode] = useState(false);
  const [drawPrevotsLevel, setDrawPrevotsLevel] = useState<PrevotsLevel>(1);
  const [brazilBoundary, setBrazilBoundary] = useState<BrazilForClip | null>(null);
  const [isMounted, setIsMounted] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [baseMapId, setBaseMapId] = useState<BaseMapId>('satellite');
  const [showBaseMapGallery, setShowBaseMapGallery] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');
  const [appliedStartDate, setAppliedStartDate] = useState('');
  const [appliedEndDate, setAppliedEndDate] = useState('');
  const [imageMappingMode, setImageMappingMode] = useState<string>('none');
  const [secondaryAfterImages, setSecondaryAfterImages] = useState<any[]>([]);
  const [secondaryUploadingId, setSecondaryUploadingId] = useState<string | null>(null);
  const [activeSecondaryId, setActiveSecondaryId] = useState<string | null>(null);
  const secondaryImageFileInputRef = useRef<HTMLInputElement>(null);
  const [showSecondaryOnMap, setShowSecondaryOnMap] = useState<Record<string, boolean>>({});
  const [secondaryOpacities, setSecondaryOpacities] = useState<Record<string, number>>({});
  const secondaryOverlaysRef = useRef<Record<string, any>>({});
  
  const [numericalModels, setNumericalModels] = useState<NumericalModelImage[]>([]);
  const [numericalUploadingId, setNumericalUploadingId] = useState<string | null>(null);
  const [activeNumericalId, setActiveNumericalId] = useState<string | null>(null);
  const numericalImageFileInputRef = useRef<HTMLInputElement>(null);
  const [showNumericalOnMap, setShowNumericalOnMap] = useState<Record<string, boolean>>({});
  const [numericalOpacities, setNumericalOpacities] = useState<Record<string, number>>({});
  const numericalOverlaysRef = useRef<Record<string, any>>({});
  const skewtFileInputRef = useRef<HTMLInputElement>(null);
  const galleryFileInputRef = useRef<HTMLInputElement>(null);
  
  // States para Radar Override Local
  const [radarOverrides, setRadarOverrides] = useState<Record<string, any>>({});
  const rectInstanceRef = useRef<any>(null);

  // Novos campos para Painel de Informações
  const [skewts, setSkewts] = useState<string[]>([]);
  const [victims, setVictims] = useState<number | string>('');
  const [damage, setDamage] = useState('');
  const [gallery, setGallery] = useState<string[]>([]);
  const [externalLinks, setExternalLinks] = useState<{ label: string; url: string }[]>([]);
  
  const [skewtUploading, setSkewtUploading] = useState(false);
  const [galleryUploading, setGalleryUploading] = useState(false);

  // Auxiliar para parsing robusto de coordenadas (aceita ponto ou vírgula)
  const parseCoord = (val: string): number => {
    if (!val) return 0;
    const sanitized = val.toString().replace(',', '.').replace(/[^\d.-]/g, '');
    const num = parseFloat(sanitized);
    return isNaN(num) ? 0 : num;
  };

  const filteredTracks = React.useMemo(() => {
    if (!appliedStartDate && !appliedEndDate) return tracks;
    return tracks.filter((t) => {
      if (appliedStartDate && t.date < appliedStartDate) return false;
      if (appliedEndDate && t.date > appliedEndDate) return false;
      return true;
    });
  }, [tracks, appliedStartDate, appliedEndDate]);

  const applyDateFilter = () => {
    setAppliedStartDate(filterStartDate);
    setAppliedEndDate(filterEndDate);
  };

  const resetDateFilter = () => {
    setFilterStartDate('');
    setFilterEndDate('');
    setAppliedStartDate('');
    setAppliedEndDate('');
  };

  const loadTracks = async () => {
    setLoading(true);
    try {
      const list = await fetchTornadoTracks();
      setTracks(list);
    } catch (e: any) {
      addToast(`Erro ao carregar: ${e.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setIsMounted(true);
    if (!user || (user.type !== 'admin' && user.type !== 'superadmin')) {
      router.push('/');
      return;
    }
    loadTracks();
  }, [user, router]);

  useEffect(() => {
    if (!mapRef.current) return;
    let isMounted = true;
    const initMap = async () => {
      try {
        if (typeof window === 'undefined') return;

        const tryInit = async () => {
          if (!(window as any).google?.maps?.importLibrary) {
            setTimeout(tryInit, 200);
            return;
          }

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
            console.log('Admin: Google Map initialized successfully.');
            mapInstanceRef.current = map;
            setMapReady(true);
          } catch (err) {
            console.error('Admin map importLibrary error:', err);
          }
        };

        console.log('Admin: Starting map initialization...');
        tryInit();
      } catch (err) {
        console.error('Admin init map error:', err);
      }
    };
    initMap();
    return () => { isMounted = false; };
  }, [isMounted]);

  useEffect(() => {
    fetch(BRASIL_GEOJSON_URL)
      .then((r) => r.json())
      .then((data) => setBrazilBoundary(getBrazilPolygons(data)))
      .catch((e) => console.warn('Falha ao carregar limite do Brasil:', e));
  }, []);

  /** Pesquisa no mapa: aceita lat,lon (ex: -26.62, -49.71) ou endereço (Geocoder) */
  const handleMapSearch = () => {
    const map = mapInstanceRef.current;
    if (!map || !mapReady) return;
    const q = mapSearchQuery.trim();
    if (!q) return;

    // Regex melhorado: aceita ponto ou vírgula como separador decimal
    const latLonMatch = q.match(/^\s*(-?\d+[.,]?\d*)\s*[,;\s]\s*(-?\d+[.,]?\d*)\s*$/);
    if (latLonMatch) {
      const lat = parseCoord(latLonMatch[1]);
      const lng = parseCoord(latLonMatch[2]);
      if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
        map.panTo({ lat, lng });
        map.setZoom(14);
        addToast(`Centralizado em ${lat.toFixed(4)}, ${lng.toFixed(4)}`, 'success');
        return;
      }
    }

    setMapSearching(true);
    const geocoder = new google.maps.Geocoder();
    const bounds = new google.maps.LatLngBounds(
      { lat: -34, lng: -74 },
      { lat: 5, lng: -34 }
    );
    geocoder.geocode({ address: q, bounds }, (results: any[] | null, status: string) => {
      setMapSearching(false);
      if (status !== 'OK' || !results?.[0]?.geometry?.location) {
        addToast('Endereço não encontrado. Tente lat,lon (ex: -26.62, -49.71).', 'error');
        return;
      }
      const loc = results[0].geometry.location;
      const lat = typeof loc.lat === 'function' ? loc.lat() : loc.lat;
      const lng = typeof loc.lng === 'function' ? loc.lng() : loc.lng;
      map.panTo({ lat: Number(lat), lng: Number(lng) });
      map.setZoom(14);
      addToast('Local encontrado.', 'success');
    });
  };

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

  // Overlays "Antes" e "Depois" em edição — OverlayView com img para carregar URLs (ex.: Firebase)
  useEffect(() => {
    if (!mapInstanceRef.current || !mapReady || !google.maps.OverlayView) return;
    const map = mapInstanceRef.current;

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

    const createImageOverlay = (
      url: string, 
      bounds: any, 
      opacity: number, 
      rotation: number = 0,
      chromaKey: number = 0,
      crop: { top: number; bottom: number; left: number; right: number } = { top: 0, bottom: 0, left: 0, right: 0 }
    ) => {
      const ov = new google.maps.OverlayView() as any;
      ov._url = url;
      ov._bounds = bounds;
      let divEl: HTMLDivElement | null = null;
      ov.onAdd = () => {
        divEl = document.createElement('div');
        divEl.style.cssText = 'position:absolute;pointer-events:none;border:none;overflow:hidden;';
        const img = document.createElement('img');
        img.src = url;
        img.loading = 'eager';
        (img as any).fetchPriority = 'high';
        
        let mixBlend = '';
        if (chromaKey > 0) mixBlend = 'mix-blend-mode: multiply;'; // fallback simples para modelos numéricos claros
        
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
        const sw = proj.fromLatLngToDivPixel(ov._bounds.getSouthWest());
        const ne = proj.fromLatLngToDivPixel(ov._bounds.getNorthEast());
        if (!sw || !ne) return;
        divEl.style.left   = Math.min(sw.x, ne.x) + 'px';
        divEl.style.top    = Math.min(sw.y, ne.y) + 'px';
        divEl.style.width  = Math.abs(ne.x - sw.x) + 'px';
        divEl.style.height = Math.abs(ne.y - sw.y) + 'px';
      };
      ov.update = (newBounds: any, newOpacity: number, newRotation: number = 0, newChromaKey: number = 0, newCrop: any = { top: 0, bottom: 0, left: 0, right: 0 }) => {
        ov._bounds = newBounds;
        if (divEl) {
          const img = divEl.querySelector('img');
          if (img) {
            let mixBlend = newChromaKey > 0 ? 'mix-blend-mode: multiply;' : '';
            let clipPath = (newCrop.top > 0 || newCrop.bottom > 0 || newCrop.left > 0 || newCrop.right > 0) ? `clip-path: inset(${newCrop.top}% ${newCrop.right}% ${newCrop.bottom}% ${newCrop.left}%);` : '';
            img.style.cssText = `width:100%;height:100%;opacity:${newOpacity};object-fit:fill;image-rendering:auto;image-rendering:smooth;transform:rotate(${newRotation}deg);transform-origin:center;${mixBlend}${clipPath}`;
          }
        }
        ov.draw();
      };
      ov.onRemove = () => {
        divEl?.parentNode?.removeChild(divEl);
        divEl = null;
      };
      ov.setMap(map);
      return ov;
    };

    if (!panelOpen) return;

    const beforeUrl = beforeImage?.trim();
    const afterUrl = afterImage?.trim();

    if (showOverlayBefore && beforeUrl && beforeImageBounds) {
      const bounds = makeBounds(beforeImageBounds);
      if (overlayBeforeRef.current && (overlayBeforeRef.current as any)._url === beforeUrl) {
         (overlayBeforeRef.current as any).update(bounds, overlayBeforeOpacity);
      } else {
         if (overlayBeforeRef.current) (overlayBeforeRef.current as any).setMap(null);
         const overlay = createImageOverlay(beforeUrl, bounds, overlayBeforeOpacity);
         overlayBeforeRef.current = overlay;
         map.fitBounds(bounds, { top: 80, right: 80, bottom: 80, left: 80 });
      }
    } else {
      if (overlayBeforeRef.current) {
         (overlayBeforeRef.current as any).setMap(null);
         overlayBeforeRef.current = null;
      }
    }

    if (showOverlayAfter && afterUrl && afterImageBounds) {
      const bounds = makeBounds(afterImageBounds);
      if (overlayAfterRef.current && (overlayAfterRef.current as any)._url === afterUrl) {
         (overlayAfterRef.current as any).update(bounds, overlayAfterOpacity);
      } else {
         if (overlayAfterRef.current) (overlayAfterRef.current as any).setMap(null);
         const overlay = createImageOverlay(afterUrl, bounds, overlayAfterOpacity);
         overlayAfterRef.current = overlay;
         if (imageMappingMode === 'none') {
           map.fitBounds(bounds, { top: 80, right: 80, bottom: 80, left: 80 });
         }
      }
    } else {
      if (overlayAfterRef.current) {
         (overlayAfterRef.current as any).setMap(null);
         overlayAfterRef.current = null;
      }
    }

    // Overlays para imagens secundárias baseadas no checkbox 'Mostrar no mapa' OU modo de mapeamento
    const activeSecIds = new Set<string>();
    secondaryAfterImages.forEach(secImg => {
      if (!secImg.url || !secImg.bounds || !secImg.bounds.ne || !secImg.bounds.sw) return;
      if (isNaN(secImg.bounds.ne.lat) || isNaN(secImg.bounds.sw.lat)) return;
      
      const isMappingThis = imageMappingMode === secImg.id;
      const isVisible = showSecondaryOnMap[secImg.id] || isMappingThis;
      
      if (!isVisible) return;
      
      activeSecIds.add(secImg.id);
      const bounds = makeBounds(secImg.bounds);
      const opacity = secImg.opacity ?? 0.8;
      const rotation = secImg.rotation ?? 0;
      
      if (secondaryOverlaysRef.current[secImg.id] && secondaryOverlaysRef.current[secImg.id]._url === secImg.url) {
         secondaryOverlaysRef.current[secImg.id].update(bounds, opacity, rotation);
      } else {
         if (secondaryOverlaysRef.current[secImg.id]) secondaryOverlaysRef.current[secImg.id].setMap(null);
         const overlay = createImageOverlay(secImg.url, bounds, opacity, rotation);
         secondaryOverlaysRef.current[secImg.id] = overlay as any;
         overlay.setMap(map);
      }
      
      if (isMappingThis) {
        secondaryOverlaysRef.current[secImg.id]._isSecondaryMapping = true; // manter marcação para saber
      }
    });
    // Limpar overlays inativos
    Object.keys(secondaryOverlaysRef.current).forEach(id => {
       if (!activeSecIds.has(id)) {
          secondaryOverlaysRef.current[id]?.setMap?.(null);
          delete secondaryOverlaysRef.current[id];
       }
    });

    // Overlays para modelos numéricos
    const activeNumIds = new Set<string>();
    numericalModels.forEach(numModel => {
      if (!numModel.url || !numModel.bounds || !numModel.bounds.ne || !numModel.bounds.sw) return;
      if (isNaN(numModel.bounds.ne.lat) || isNaN(numModel.bounds.sw.lat)) return;
      
      const isMappingThis = imageMappingMode === numModel.id;
      const isVisible = showNumericalOnMap[numModel.id] || isMappingThis;
      
      if (!isVisible) return;
      
      activeNumIds.add(numModel.id);
      const bounds = makeBounds(numModel.bounds);
      const opacity = numModel.opacity ?? 0.8;
      const rotation = numModel.rotation ?? 0;
      const chroma = numModel.chromaKey ?? 0;
      const cropCfg = {
        top: numModel.cropTop ?? 0,
        bottom: numModel.cropBottom ?? 0,
        left: numModel.cropLeft ?? 0,
        right: numModel.cropRight ?? 0
      };
      
      if (numericalOverlaysRef.current[numModel.id] && numericalOverlaysRef.current[numModel.id]._url === numModel.url) {
         numericalOverlaysRef.current[numModel.id].update(bounds, opacity, rotation, chroma, cropCfg);
      } else {
         if (numericalOverlaysRef.current[numModel.id]) numericalOverlaysRef.current[numModel.id].setMap(null);
         const overlay = createImageOverlay(numModel.url, bounds, opacity, rotation, chroma, cropCfg);
         numericalOverlaysRef.current[numModel.id] = overlay as any;
         overlay.setMap(map);
      }
    });
    // Limpar overlays inativos
    Object.keys(numericalOverlaysRef.current).forEach(id => {
       if (!activeNumIds.has(id)) {
          numericalOverlaysRef.current[id]?.setMap?.(null);
          delete numericalOverlaysRef.current[id];
       }
    });

    // Removendo return function() {...} para não destruir as instâncias no ciclo de rendering
  }, [mapReady, panelOpen, showOverlayBefore, showOverlayAfter, beforeImage, beforeImageBounds, afterImage, afterImageBounds, overlayBeforeOpacity, overlayAfterOpacity, imageMappingMode, showSecondaryOnMap, secondaryOpacities, secondaryAfterImages, numericalModels, showNumericalOnMap]);

  // Limpeza de todos os overlays ao desmontar o componente ou caso mapReady fique false
  useEffect(() => {
    return () => {
      if (overlayBeforeRef.current) { (overlayBeforeRef.current as any).setMap(null); overlayBeforeRef.current = null; }
      if (overlayAfterRef.current) { (overlayAfterRef.current as any).setMap(null); overlayAfterRef.current = null; }
      Object.values(secondaryOverlaysRef.current).forEach((overlay: any) => overlay?.setMap?.(null));
      secondaryOverlaysRef.current = {};
      Object.values(numericalOverlaysRef.current).forEach((overlay: any) => overlay?.setMap?.(null));
      numericalOverlaysRef.current = {};
    };
  }, []);

  // Gerenciamento do Retângulo de Mapeamento de Imagem
  useEffect(() => {
    if (!mapInstanceRef.current || !mapReady) return;
    const map = mapInstanceRef.current;

    // Se o modo for 'none', remove o retângulo
    if (imageMappingMode === 'none') {
      if (rectInstanceRef.current) {
        rectInstanceRef.current.setMap(null);
        rectInstanceRef.current = null;
      }
      return;
    }

    // Ativa o overlay da imagem correspondente para feedback visual
    if (imageMappingMode === 'before') setShowOverlayBefore(true);
    if (imageMappingMode === 'after') setShowOverlayAfter(true);
    if (imageMappingMode !== 'none' && imageMappingMode !== 'before' && imageMappingMode !== 'after') {
      setShowSecondaryOnMap(prev => ({ ...prev, [imageMappingMode]: true }));
      setShowNumericalOnMap(prev => ({ ...prev, [imageMappingMode]: true }));
    }

    let initialBounds;
    let setBoundsFunc: (b: any) => void = () => {};

    if (imageMappingMode === 'before') {
      setBoundsFunc = setBeforeImageBounds;
      initialBounds = beforeImageBounds;
    } else if (imageMappingMode === 'after') {
      setBoundsFunc = setAfterImageBounds;
      initialBounds = afterImageBounds;
    } else {
      const secImg = secondaryAfterImages.find(img => img.id === imageMappingMode);
      const numImg = numericalModels.find(img => img.id === imageMappingMode);
      
      if (secImg) {
        setBoundsFunc = (newBounds) => {
          setSecondaryAfterImages(prev => prev.map(img =>
            img.id === imageMappingMode ? { ...img, bounds: newBounds } : img
          ));
        };
        initialBounds = secImg.bounds;
      } else if (numImg) {
        setBoundsFunc = (newBounds) => {
          setNumericalModels(prev => prev.map(img =>
            img.id === imageMappingMode ? { ...img, bounds: newBounds } : img
          ));
        };
        initialBounds = numImg.bounds;
      }
    }

    const gBounds = initialBounds ? {
      north: Math.max(initialBounds.ne.lat, initialBounds.sw.lat),
      south: Math.min(initialBounds.ne.lat, initialBounds.sw.lat),
      east: Math.max(initialBounds.ne.lng, initialBounds.sw.lng),
      west: Math.min(initialBounds.ne.lng, initialBounds.sw.lng),
    } : null;

    if (!gBounds) {
      // Se não tem bounds, cria um retângulo padrão no centro do mapa
      const center = map.getCenter();
      const lat = center.lat();
      const lng = center.lng();
      const offset = 0.01;
      const initialGBounds = {
        north: lat + offset,
        south: lat - offset,
        east: lng + offset,
        west: lng - offset,
      };
      // Define os bounds iniciais no estado para que o overlay apareça
      setBoundsFunc({
        ne: { lat: initialGBounds.north, lng: initialGBounds.east },
        sw: { lat: initialGBounds.south, lng: initialGBounds.west }
      });
      initialBounds = {
        ne: { lat: initialGBounds.north, lng: initialGBounds.east },
        sw: { lat: initialGBounds.south, lng: initialGBounds.west }
      };
    }

    const finalGBounds = {
      north: Math.max(initialBounds.ne.lat, initialBounds.sw.lat),
      south: Math.min(initialBounds.ne.lat, initialBounds.sw.lat),
      east: Math.max(initialBounds.ne.lng, initialBounds.sw.lng),
      west: Math.min(initialBounds.ne.lng, initialBounds.sw.lng),
    };

    if (rectInstanceRef.current) {
      rectInstanceRef.current.setMap(null);
    }

    const rect = new google.maps.Rectangle({
      bounds: finalGBounds,
      editable: true,
      draggable: true,
      map: map,
      strokeColor: '#fbbf24',
      strokeOpacity: 0.8,
      strokeWeight: 2,
      fillColor: '#fbbf24',
      fillOpacity: 0.1,
      zIndex: 200,
    });

    rectInstanceRef.current = rect;

    let timeoutId: NodeJS.Timeout | null = null;
    const updateBoundsState = () => {
      const b = rect.getBounds();
      if (!b) return;
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        const ne = b.getNorthEast();
        const sw = b.getSouthWest();
        setBoundsFunc({
          ne: { lat: ne.lat(), lng: ne.lng() },
          sw: { lat: sw.lat(), lng: sw.lng() },
        });
      }, 50);
    };

    rect.addListener('bounds_changed', updateBoundsState);
    rect.addListener('dragend', updateBoundsState);

    // Ajusta o zoom para ver o retângulo
    map.fitBounds(finalGBounds, { top: 100, right: 100, bottom: 100, left: 100 });

    return () => {
      if (rectInstanceRef.current) {
        rectInstanceRef.current.setMap(null);
        rectInstanceRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageMappingMode, mapReady]);

  // Desenhar todos os rastros no mapa (exceto o que está sendo editado); clique abre edição
  useEffect(() => {
    if (!mapInstanceRef.current || !mapReady) return;
    allTracksPolygonsRef.current.forEach((p) => p.setMap(null));
    allTracksPolygonsRef.current = [];
    const map = mapInstanceRef.current;
    filteredTracks
      .filter((t) => t.id !== editingId)
      .forEach((track) => {
        // Prevots: desenhar primeiro (nível 1 por baixo)
        const prevots = (track.prevotsPolygons ?? []).filter((p) => p.level !== 0);
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
              strokeWeight: 2,
              fillColor: color,
              fillOpacity: 0.35,
              map,
              clickable: true,
            });
            gPoly.addListener('click', () => handleEdit(track));
            allTracksPolygonsRef.current.push(gPoly);
          });
        if (!track.polygons?.length) return;
        track.polygons
          .sort((a, b) => F_SCALE_ORDER.indexOf(a.intensity) - F_SCALE_ORDER.indexOf(b.intensity))
          .forEach((poly) => {
            const ring = poly.coordinates[0];
            if (!ring || ring.length < 3) return;
            const path = ring.map(([lng, lat]) => ({ lat, lng }));
            const color = TORNADO_TRACK_COLORS[poly.intensity];
            const gPoly = new google.maps.Polygon({
              paths: path,
              strokeColor: color,
              strokeWeight: 2,
              fillColor: color,
              fillOpacity: 0.35,
              map,
              clickable: true,
            });
            gPoly.addListener('click', () => handleEdit(track));
            allTracksPolygonsRef.current.push(gPoly);
          });
      });
    return () => {
      allTracksPolygonsRef.current.forEach((p) => p.setMap(null));
      allTracksPolygonsRef.current = [];
    };
  }, [mapReady, filteredTracks, editingId]);

  // Desenhar polígonos do rastro em edição (formulário) — com vértices editáveis
  useEffect(() => {
    if (!mapInstanceRef.current || !mapReady) return;
    polygonsOnMapRef.current.forEach((p) => {
      google.maps.event.clearInstanceListeners(p);
      if (p.getPath) google.maps.event.clearInstanceListeners(p.getPath());
      p.setMap(null);
    });
    polygonsOnMapRef.current = [];
    const map = mapInstanceRef.current;
    const syncTimeoutsRef: Record<string, ReturnType<typeof setTimeout>> = {};

    const syncPathToState = (gPoly: any, intensity: FScale) => {
      const path = gPoly.getPath();
      const coords: number[][] = [];
      for (let i = 0; i < path.getLength(); i++) {
        const p = path.getAt(i);
        coords.push([typeof p.lng === 'function' ? p.lng() : p.lng, typeof p.lat === 'function' ? p.lat() : p.lat]);
      }
      if (coords.length < 3) return;
      const first = coords[0];
      const last = coords[coords.length - 1];
      if (last[0] !== first[0] || last[1] !== first[1]) coords.push([...first]);
      setPolygons((prev) => {
        const without = prev.filter((p) => p.intensity !== intensity);
        return [...without, { intensity, coordinates: [coords] }].sort(
          (a, b) => F_SCALE_ORDER.indexOf(a.intensity) - F_SCALE_ORDER.indexOf(b.intensity)
        );
      });
    };

    polygons.forEach((poly) => {
      const ring = poly.coordinates[0];
      if (!ring || ring.length < 3) return;
      const path = ring.map(([lng, lat]) => ({ lat, lng }));
      const color = TORNADO_TRACK_COLORS[poly.intensity];
      const intensity = poly.intensity;
      const gPoly = new google.maps.Polygon({
        paths: path,
        strokeColor: color,
        strokeWeight: 2,
        fillColor: color,
        fillOpacity: 0,
        map,
        editable: true,
        draggable: true,
      });
      const debouncedSync = () => {
        const key = `f-${intensity}`;
        if (syncTimeoutsRef[key]) clearTimeout(syncTimeoutsRef[key]);
        syncTimeoutsRef[key] = setTimeout(() => {
          delete syncTimeoutsRef[key];
          syncPathToState(gPoly, intensity);
        }, 150);
      };
      gPoly.getPath().addListener('set_at', debouncedSync);
      gPoly.getPath().addListener('insert_at', debouncedSync);
      gPoly.getPath().addListener('remove_at', debouncedSync);
      polygonsOnMapRef.current.push(gPoly);
    });

    return () => {
      Object.values(syncTimeoutsRef).forEach(clearTimeout);
      polygonsOnMapRef.current.forEach((p) => {
        google.maps.event.clearInstanceListeners(p);
        if (p.getPath) google.maps.event.clearInstanceListeners(p.getPath());
        p.setMap(null);
      });
      polygonsOnMapRef.current = [];
    };
  }, [mapReady, polygons]);

  // Desenhar polígonos Prevots do rastro em edição (nível 1 por baixo) — com vértices editáveis
  useEffect(() => {
    if (!mapInstanceRef.current || !mapReady) return;
    prevotsPolygonsOnMapRef.current.forEach((p) => {
      google.maps.event.clearInstanceListeners(p);
      if (p.getPath) google.maps.event.clearInstanceListeners(p.getPath());
      p.setMap(null);
    });
    prevotsPolygonsOnMapRef.current = [];
    const map = mapInstanceRef.current;
    const syncTimeoutsRef: Record<string, ReturnType<typeof setTimeout>> = {};

    const syncPrevotsPathToState = (gPoly: any, index: number) => {
      const path = gPoly.getPath();
      const coords: number[][] = [];
      for (let i = 0; i < path.getLength(); i++) {
        const p = path.getAt(i);
        coords.push([typeof p.lng === 'function' ? p.lng() : p.lng, typeof p.lat === 'function' ? p.lat() : p.lat]);
      }
      if (coords.length < 3) return;
      const first = coords[0];
      const last = coords[coords.length - 1];
      if (last[0] !== first[0] || last[1] !== first[1]) coords.push([...first]);
      setPrevotsPolygons((prev) => {
        const next = [...prev];
        if (index >= 0 && index < next.length) {
          next[index] = { level: next[index].level, coordinates: [coords] };
        }
        return next.sort((a, b) => a.level - b.level);
      });
    };

    [...prevotsPolygons]
      .filter((p) => p.level !== 0)
      .sort((a, b) => a.level - b.level)
      .forEach((poly, sortedIdx) => {
        const polygonIndex = prevotsPolygons.indexOf(poly);
        const ring = poly.coordinates[0];
        if (!ring || ring.length < 3) return;
        const path = ring.map(([lng, lat]) => ({ lat, lng }));
        const color = PREVOTS_LEVEL_COLORS[poly.level];
        const gPoly = new google.maps.Polygon({
          paths: path,
          strokeColor: color,
          strokeWeight: 2,
          fillColor: color,
          fillOpacity: 0,
          map,
          editable: true,
          draggable: true,
        });
        const debouncedSync = () => {
          const key = `p-${polygonIndex}`;
          if (syncTimeoutsRef[key]) clearTimeout(syncTimeoutsRef[key]);
          syncTimeoutsRef[key] = setTimeout(() => {
            delete syncTimeoutsRef[key];
            syncPrevotsPathToState(gPoly, polygonIndex);
          }, 150);
        };
        gPoly.getPath().addListener('set_at', debouncedSync);
        gPoly.getPath().addListener('insert_at', debouncedSync);
        gPoly.getPath().addListener('remove_at', debouncedSync);
        prevotsPolygonsOnMapRef.current.push(gPoly);
      });

    return () => {
      Object.values(syncTimeoutsRef).forEach(clearTimeout);
      prevotsPolygonsOnMapRef.current.forEach((p) => {
        google.maps.event.clearInstanceListeners(p);
        if (p.getPath) google.maps.event.clearInstanceListeners(p.getPath());
        p.setMap(null);
      });
      prevotsPolygonsOnMapRef.current = [];
    };
  }, [mapReady, prevotsPolygons]);

  // DrawingManager: desenhar novo polígono por intensidade (F0 primeiro, depois F1 dentro de F0, etc.)
  useEffect(() => {
    if (!mapInstanceRef.current || !mapReady || !drawMode) {
      if (drawingManagerRef.current) {
        drawingManagerRef.current.setDrawingMode(null);
        drawingManagerRef.current.setMap(null);
        drawingManagerRef.current = null;
      }
      return;
    }
    const initDrawing = async () => {
      try {
        const drawingLib = await google.maps.importLibrary('drawing') as { DrawingManager: any; OverlayType: { POLYGON: string } };
        const { DrawingManager, OverlayType } = drawingLib;
        const color = TORNADO_TRACK_COLORS[drawIntensity];
        const manager = new DrawingManager({
          map: mapInstanceRef.current,
          drawingMode: OverlayType.POLYGON,
          drawingControl: false,
          polygonOptions: {
            fillColor: color,
            fillOpacity: 0.35,
            strokeColor: color,
            strokeWeight: 2,
          },
        });
        google.maps.event.addListener(manager, 'overlaycomplete', (e: any) => {
          if (e.type !== OverlayType.POLYGON) return;
          const path = e.overlay.getPath();
          const coords: number[][] = [];
          for (let i = 0; i < path.getLength(); i++) {
            const p = path.getAt(i);
            coords.push([p.lng(), p.lat()]);
          }
          e.overlay.setMap(null);
          if (coords.length < 3) {
            addToast('Polígono precisa de pelo menos 3 pontos.', 'error');
            return;
          }
          const first = coords[0];
          const last = coords[coords.length - 1];
          if (last[0] !== first[0] || last[1] !== first[1]) coords.push([...first]);
          const parentF = previousFScale(drawIntensity);
          if (parentF) {
            const parentPoly = polygons.find((p) => p.intensity === parentF);
            if (!parentPoly?.coordinates[0]?.length) {
            addToast(`Desenhe primeiro o polígono ${parentF}. O polígono ${drawIntensity} deve ficar dentro de ${parentF}.`, 'error');
              return;
            }
            if (!isPolygonWithinRing(coords, parentPoly.coordinates[0])) {
              addToast(`O polígono ${drawIntensity} deve estar totalmente dentro do polígono ${parentF}.`, 'error');
              return;
            }
          }
          setPolygons((prev) => {
            const without = prev.filter((p) => p.intensity !== drawIntensity);
            return [...without, { intensity: drawIntensity, coordinates: [coords] }].sort(
              (a, b) => F_SCALE_ORDER.indexOf(a.intensity) - F_SCALE_ORDER.indexOf(b.intensity)
            );
          });
          addToast(`Polígono ${drawIntensity} adicionado.`, 'success');
          setDrawMode(false);
          if (drawingManagerRef.current) {
            drawingManagerRef.current.setDrawingMode(null);
            drawingManagerRef.current.setMap(null);
            drawingManagerRef.current = null;
          }
        });
        drawingManagerRef.current = manager;
      } catch (err) {
        console.error(err);
        addToast('Erro ao ativar desenho.', 'error');
      }
    };
    initDrawing();
    return () => {
      if (drawingManagerRef.current) {
        drawingManagerRef.current.setMap(null);
        drawingManagerRef.current = null;
      }
    };
  }, [mapReady, drawMode, drawIntensity, polygons]);

  // DrawingManager: desenhar polígonos Prevots (clip automático ao Brasil)
  useEffect(() => {
    if (!mapInstanceRef.current || !mapReady || !drawPrevotsMode) {
      if (prevotsDrawingManagerRef.current) {
        prevotsDrawingManagerRef.current.setDrawingMode(null);
        prevotsDrawingManagerRef.current.setMap(null);
        prevotsDrawingManagerRef.current = null;
      }
      return;
    }
    const initPrevotsDrawing = async () => {
      try {
        const drawingLib = await google.maps.importLibrary('drawing') as { DrawingManager: any; OverlayType: { POLYGON: string } };
        const { DrawingManager, OverlayType } = drawingLib;
        const color = PREVOTS_LEVEL_COLORS[drawPrevotsLevel];
        const manager = new DrawingManager({
          map: mapInstanceRef.current,
          drawingMode: OverlayType.POLYGON,
          drawingControl: false,
          polygonOptions: {
            fillColor: color,
            fillOpacity: 0.35,
            strokeColor: color,
            strokeWeight: 2,
          },
        });
        google.maps.event.addListener(manager, 'overlaycomplete', (e: any) => {
          if (e.type !== OverlayType.POLYGON) return;
          const path = e.overlay.getPath();
          const coords: number[][] = [];
          for (let i = 0; i < path.getLength(); i++) {
            const p = path.getAt(i);
            coords.push([p.lng(), p.lat()]);
          }
          e.overlay.setMap(null);
          if (coords.length < 3) {
            addToast('Polígono Prevots precisa de pelo menos 3 pontos.', 'error');
            return;
          }
          const first = coords[0];
          const last = coords[coords.length - 1];
          if (last[0] !== first[0] || last[1] !== first[1]) coords.push([...first]);
          const clipped = brazilBoundary ? clipPolygonToBrazil(coords, brazilBoundary) : coords;
          if (!clipped || clipped.length < 3) {
            addToast('Polígono fora dos limites do Brasil ou inválido após recorte.', 'error');
            return;
          }
          const closedRing = [...clipped];
          if (closedRing[0][0] !== closedRing[closedRing.length - 1][0] || closedRing[0][1] !== closedRing[closedRing.length - 1][1]) {
            closedRing.push([...closedRing[0]]);
          }
          setPrevotsPolygons((prev) =>
            [...prev, { level: drawPrevotsLevel, coordinates: [closedRing] }].sort((a, b) => a.level - b.level)
          );
          addToast(`Polígono nível ${drawPrevotsLevel} adicionado (recortado ao Brasil). Desenhe outro ou clique aqui para sair.`, 'success');
        });
        prevotsDrawingManagerRef.current = manager;
      } catch (err) {
        console.error(err);
        addToast('Erro ao ativar desenho Prevots.', 'error');
      }
    };
    initPrevotsDrawing();
    return () => {
      if (prevotsDrawingManagerRef.current) {
        prevotsDrawingManagerRef.current.setMap(null);
        prevotsDrawingManagerRef.current = null;
      }
    };
  }, [mapReady, drawPrevotsMode, drawPrevotsLevel, brazilBoundary, addToast]);

  const resetForm = () => {
    setEditingId(null);
    setDate('');
    setTime('');
    setCountry('Brasil');
    setState('');
    setLocality('');
    setDescription('');
    setSource('');
    setRadarWmsUrl('');
    setRadarStationId('');
    setRadarOverrides({});
    setPolygons([]);
    setBeforeImage('');
    setAfterImage('');
    setBeforeImageBounds(null);
    setAfterImageBounds(null);
    setShowOverlayBefore(false);
    setShowOverlayAfter(false);
    setTrackImage('');
    setTrackImageBounds(null);
    setPrevotsPolygons([]);
    setDrawMode(false);
    setDrawIntensity('F0');
    setDrawPrevotsMode(false);
    setShowBeforeAfterDialog(false);
    setSecondaryAfterImages([]);
    setSecondaryUploadingId(null);
    setNumericalModels([]);
    setNumericalUploadingId(null);
    setSkewts([]);
    setVictims('');
    setDamage('');
    setGallery([]);
    setExternalLinks([]);
  };

  const openNewTrack = () => {
    resetForm();
    setPanelOpen(true);
  };

  const openList = () => {
    setSidebarCollapsed(false);
  };

  /** Lê um GeoTIFF com geotiff.js e devolve { pngBlob, bounds } com bounds em WGS84 */
  const parseGeoTiff = async (file: File) => {
    const geotiffModule = await import('geotiff');
    const proj4Module = await import('proj4');
    const proj4 = (proj4Module as any).default ?? proj4Module;

    // fromArrayBuffer é mais compatível que fromBlob em geotiff v3
    const arrayBuffer = await file.arrayBuffer();
    const tiff = await geotiffModule.fromArrayBuffer(arrayBuffer);
    const image = await tiff.getImage();

    // --- bounds com reprojeção para WGS84 ---
    const bbox = image.getBoundingBox(); // [minX, minY, maxX, maxY] na CRS nativa
    let bounds: { ne: { lat: number; lng: number }; sw: { lat: number; lng: number } } | null = null;

    if (bbox && bbox.length >= 4) {
      const [minX, minY, maxX, maxY] = bbox;

      // Verifica se já está em graus WGS84
      const isWgs84 = Math.abs(minX) <= 180 && Math.abs(maxX) <= 180 &&
                      Math.abs(minY) <= 90  && Math.abs(maxY) <= 90;

      if (isWgs84) {
        bounds = { sw: { lat: minY, lng: minX }, ne: { lat: maxY, lng: maxX } };
      } else {
        // Obtém o código EPSG das GeoKeys do arquivo
        const geoKeys: any = image.getGeoKeys?.() ?? {};
        const epsgCode: number = geoKeys.ProjectedCSTypeGeoKey || geoKeys.GeographicTypeGeoKey || 0;

        let proj4String: string | null = COMMON_PROJ4_DEFS[epsgCode] ?? null;

        // Tenta buscar definição no epsg.io se não está na lista local
        if (!proj4String && epsgCode && epsgCode !== 32767) {
          try {
            const res = await fetch(`https://epsg.io/${epsgCode}.proj4`);
            if (res.ok) proj4String = (await res.text()).trim();
          } catch { /* sem rede — ignora */ }
        }

        if (proj4String) {
          proj4.defs(`EPSG:${epsgCode}`, proj4String);
          const convert = proj4(`EPSG:${epsgCode}`, 'WGS84');
          const [swLng, swLat] = convert.forward([minX, minY]);
          const [neLng, neLat] = convert.forward([maxX, maxY]);
          if (isFinite(swLat) && Math.abs(swLat) <= 90 && isFinite(swLng) && Math.abs(swLng) <= 180) {
            bounds = { sw: { lat: swLat, lng: swLng }, ne: { lat: neLat, lng: neLng } };
          }
        }

        // Fallback: tenta Web Mercator (projeção muito comum)
        if (!bounds) {
          try {
            const wm3857 = COMMON_PROJ4_DEFS[3857];
            proj4.defs('EPSG:3857', wm3857);
            const convert = proj4('EPSG:3857', 'WGS84');
            const [swLng, swLat] = convert.forward([minX, minY]);
            const [neLng, neLat] = convert.forward([maxX, maxY]);
            if (isFinite(swLat) && Math.abs(swLat) <= 90) {
              bounds = { sw: { lat: swLat, lng: swLng }, ne: { lat: neLat, lng: neLng } };
            }
          } catch { /* ignorar */ }
        }
      }
    }

    // --- render para PNG (navegadores não exibem TIFF em <img>) ---
    const origW = image.getWidth();
    const origH = image.getHeight();
    if (!origW || !origH) return { pngBlob: null, bounds };

    const nSamplesRaw = Math.max(1, image.getSamplesPerPixel() || 1);
    const nSamples = Math.min(nSamplesRaw, 4); // 4 no máximo para preview RGBA

    let pngBlob: Blob | null = null;
    try {
      // Reutiliza a lógica ultra-robusta (com estiramento de contraste, nodata, etc) do arquivo corrigido!
      const { geotiffBlobToPngDataUrl } = await import('@/lib/geotiffToPng');
      const dataUrl = await geotiffBlobToPngDataUrl(file);
      if (dataUrl) {
        const resp = await fetch(dataUrl);
        pngBlob = await resp.blob();
      } else {
        throw new Error('geotiffBlobToPngDataUrl resultou em vazio');
      }
    } catch (renderErr) {
      console.warn('GeoTIFF: não foi possível renderizar pixels com geotiffToPng. Usando apenas bounds.', renderErr);
    }
    return { pngBlob, bounds };
  };

  /** Extrai imagem + bounds geográficos de um arquivo KMZ */
  const parseKmz = async (file: File) => {
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(await file.arrayBuffer());

    // Encontra o arquivo .kml dentro do zip
    const kmlEntry = Object.values(zip.files).find(f => f.name.toLowerCase().endsWith('.kml'));
    if (!kmlEntry) throw new Error('KMZ: arquivo .kml não encontrado dentro do zip');

    const kmlText = await kmlEntry.async('string');

    // Extrai LatLonBox do KML
    const north = parseFloat(kmlText.match(/<north>\s*([\d.eE+-]+)\s*<\/north>/)?.[1] ?? 'NaN');
    const south = parseFloat(kmlText.match(/<south>\s*([\d.eE+-]+)\s*<\/south>/)?.[1] ?? 'NaN');
    const east  = parseFloat(kmlText.match(/<east>\s*([\d.eE+-]+)\s*<\/east>/)?.[1] ?? 'NaN');
    const west  = parseFloat(kmlText.match(/<west>\s*([\d.eE+-]+)\s*<\/west>/)?.[1] ?? 'NaN');

    if (!isFinite(north) || !isFinite(south) || !isFinite(east) || !isFinite(west)) {
      throw new Error('KMZ: não foi possível extrair coordenadas (LatLonBox) do KML');
    }

    const bounds = { ne: { lat: north, lng: east }, sw: { lat: south, lng: west } };

    // Encontra a imagem embutida no zip (jpg, png, etc.)
    const imgEntry = Object.values(zip.files).find(f =>
      /\.(jpe?g|png|gif|webp|bmp)$/i.test(f.name)
    );
    if (!imgEntry) throw new Error('KMZ: nenhuma imagem encontrada dentro do zip');

    const imgBuffer = await imgEntry.async('arraybuffer');
    const ext = imgEntry.name.split('.').pop()?.toLowerCase() ?? 'jpg';
    const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
    const displayBlob = new Blob([imgBuffer], { type: mime });

    return { displayBlob, bounds, ext };
  };

  const makeImageUploadHandler = (
    setUrl: (url: string) => void,
    setBounds: (b: { ne: { lat: number; lng: number }; sw: { lat: number; lng: number } } | null) => void,
    setUploading: (v: boolean) => void,
  ) => async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user?.uid) return;
    if (!storage) {
      addToast('Storage não configurado.', 'error');
      return;
    }
    setUploading(true);
    e.target.value = '';
    try {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_') || 'image';
      const ts = Date.now();
      const name = file.name.toLowerCase();
      const isKmz = name.endsWith('.kmz');
      const isGeoTiff = name.endsWith('.tif') || name.endsWith('.tiff');

      if (isKmz) {
        addToast('Lendo KMZ…', 'success');
        const { displayBlob, bounds, ext } = await parseKmz(file);
        setBounds(bounds);

        const imgName = safeName.replace(/\.kmz$/i, `.${ext}`);
        const imgPath = `tornado_tracks/${user.uid}/${ts}_${imgName}`;
        const imgRef = ref(storage, imgPath);
        const contentType = ext === 'png' ? 'image/png' : 'image/jpeg';
        await uploadBytes(imgRef, displayBlob, { contentType, cacheControl: 'public, max-age=31536000' });
        const displayUrl = await getDownloadURL(imgRef);
        setUrl(displayUrl);
        addToast('KMZ processado. Imagem e coordenadas extraídas com sucesso.', 'success');
      } else if (isGeoTiff) {
        addToast('Lendo GeoTIFF…', 'success');
        const { pngBlob, bounds } = await parseGeoTiff(file);
        if (bounds) setBounds(bounds);

        if (pngBlob && storage) {
          const pngName = safeName.replace(/\.(tif|tiff)$/i, '.png');
          const pngPath = `tornado_tracks/${user.uid}/${ts}_${pngName}`;
          const pngRef = ref(storage, pngPath);
          await uploadBytes(pngRef, pngBlob, { contentType: 'image/png', cacheControl: 'public, max-age=31536000' });
          const displayUrl = await getDownloadURL(pngRef);
          setUrl(displayUrl);
          addToast('GeoTIFF convertido para PNG. Bounds preenchidos.', 'success');
        } else if (storage) {
          const tiffPath = `tornado_tracks/${user.uid}/${ts}_${safeName}`;
          const tiffRef = ref(storage, tiffPath);
          await uploadBytes(tiffRef, file, { contentType: file.type || 'image/tiff', cacheControl: 'public, max-age=31536000' });
          const tiffUrl = await getDownloadURL(tiffRef);
          setUrl(tiffUrl);
          const msg = bounds
            ? 'GeoTIFF enviado. Bounds preenchidos. A conversão para PNG falhou (arquivo possivelmente muito grande/complexo) — o overlay pode não ser exibido em todos os browsers.'
            : 'GeoTIFF enviado. Não foi possível extrair bounds — preencha manualmente.';
          addToast(msg, 'success');
        } else {
          addToast('Storage não configurado.', 'error');
        }
      } else {
        const path = `tornado_tracks/${user.uid}/${ts}_${safeName}`;
        const storageRef = ref(storage, path);
        const contentType = file.type || (safeName.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg');
        await uploadBytes(storageRef, file, { contentType, cacheControl: 'public, max-age=31536000' });
        const url = await getDownloadURL(storageRef);
        setUrl(url);
        addToast('Imagem enviada. URL definida.', 'success');
      }
    } catch (err: any) {
      addToast(`Erro ao enviar: ${err?.message || err}`, 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleBeforeImageFileSelect = makeImageUploadHandler(
    setBeforeImage,
    setBeforeImageBounds,
    setBeforeImageUploading,
  );
  const handleAfterImageFileSelect = makeImageUploadHandler(
    setAfterImage,
    setAfterImageBounds,
    setAfterImageUploading,
  );

  const addSecondaryImage = () => {
    const id = Math.random().toString(36).substring(2, 9);
    setSecondaryAfterImages(prev => [...prev, { id, url: '', bounds: { ne: { lat: 0, lng: 0 }, sw: { lat: 0, lng: 0 } } }]);
  };

  const handleSkewtUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const handler = makeImageUploadHandler(
      (url) => setSkewts(prev => [...prev, url]),
      () => {},
      setSkewtUploading
    );
    await handler(e);
  };

  const handleGalleryUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const handler = makeImageUploadHandler(
      (url) => setGallery(prev => [...prev, url]),
      () => {},
      setGalleryUploading
    );
    await handler(e);
  };

  const removeSecondaryImage = (id: string) => {
    setSecondaryAfterImages(prev => prev.filter(img => img.id !== id));
    if (imageMappingMode === id) setImageMappingMode('none');
  };

  const handleSecondaryImageFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!activeSecondaryId) return;
    const id = activeSecondaryId;
    const handler = makeImageUploadHandler(
      (url) => setSecondaryAfterImages(prev => prev.map(img => img.id === id ? { ...img, url } : img)),
      (bounds) => setSecondaryAfterImages(prev => prev.map(img => img.id === id ? { ...img, bounds: bounds || { ne: { lat: 0, lng: 0 }, sw: { lat: 0, lng: 0 } } } : img)),
      (v) => setSecondaryUploadingId(v ? id : null)
    );
    await handler(e);
    setActiveSecondaryId(null);
  };

  const addNumericalModel = () => {
    const id = Math.random().toString(36).substring(2, 9);
    setNumericalModels(prev => [...prev, { id, url: '', round: '00Z', forecastHour: 1, bounds: { ne: { lat: 0, lng: 0 }, sw: { lat: 0, lng: 0 } } }]);
  };

  const removeNumericalModel = (id: string) => {
    setNumericalModels(prev => prev.filter(img => img.id !== id));
    if (imageMappingMode === id) setImageMappingMode('none');
  };

  const handleNumericalModelFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!activeNumericalId) return;
    const id = activeNumericalId;
    const handler = makeImageUploadHandler(
      (url) => setNumericalModels(prev => prev.map(img => img.id === id ? { ...img, url } : img)),
      (bounds) => setNumericalModels(prev => prev.map(img => img.id === id ? { ...img, bounds: bounds || { ne: { lat: 0, lng: 0 }, sw: { lat: 0, lng: 0 } } } : img)),
      (v) => setNumericalUploadingId(v ? id : null)
    );
    await handler(e);
    setActiveNumericalId(null);
  };

  const handleEdit = (t: TornadoTrack) => {
    setEditingId(t.id);
    setDate(t.date);
    setTime(t.time || '');
    setCountry(t.country || 'Brasil');
    setState(t.state);
    setLocality(t.locality || '');
    setDescription(t.description || '');
    setSource(t.source || '');
    setRadarWmsUrl(t.radarWmsUrl || '');
    setRadarStationId(t.radarStationId || '');
    
    // Migra propriedades legadas, ou aproveita radarOverrides preexistente
    const fallbackId = t.radarStationId || t.radarWmsUrl || 'legacy';
    const loadedOverrides = { ...(t.radarOverrides || {}) };
    if (!loadedOverrides[fallbackId] && t.radarLat !== undefined) {
      loadedOverrides[fallbackId] = {
        lat: t.radarLat, lng: t.radarLng, rangeKm: t.radarRangeKm,
        opacity: t.radarOpacity, rotation: t.radarRotation, chromaKey: t.radarChromaKey,
        cropTop: t.radarCropTop, cropBottom: t.radarCropBottom,
        cropLeft: t.radarCropLeft, cropRight: t.radarCropRight
      };
    }
    setRadarOverrides(loadedOverrides);
    
    setPolygons(t.polygons || []);
    setBeforeImage(t.beforeImage || '');
    setAfterImage(t.afterImage || '');
    setBeforeImageBounds(t.beforeImageBounds ?? null);
    setAfterImageBounds(t.afterImageBounds ?? null);
    setShowOverlayBefore(false);
    setShowOverlayAfter(false);
    setTrackImage(t.trackImage || '');
    setTrackImageBounds(t.trackImageBounds ?? null);
    setPrevotsPolygons(t.prevotsPolygons?.filter((p) => p.level !== 0) ?? []);
    setDrawMode(false);
    setDrawPrevotsMode(false);
    setShowBeforeAfterDialog(false);
    setSecondaryAfterImages(t.secondaryAfterImages || []);
    setNumericalModels(t.numericalModels || []);
    setSkewts(t.skewts || []);
    setVictims(t.victims ?? '');
    setDamage(t.damage || '');
    setGallery(t.gallery || []);
    setExternalLinks(t.externalLinks || []);
    setPanelOpen(true);
  };

  const removePolygon = (intensity: FScale) => {
    const prev = previousFScale(intensity);
    const hasHigher = polygons.some((p) => F_SCALE_ORDER.indexOf(p.intensity) > F_SCALE_ORDER.indexOf(intensity));
    if (hasHigher) {
      addToast('Remova primeiro os polígonos de intensidade maior (ex.: F2 antes de F1).', 'error');
      return;
    }
    setPolygons((p) => p.filter((x) => x.intensity !== intensity));
  };

  const removePrevotsPolygonAtIndex = (index: number) => {
    setPrevotsPolygons((p) => p.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    if (!date.trim() || !state.trim()) {
      addToast('Preencha data e estado.', 'error');
      return;
    }
    const hasF0 = polygons.some((p) => p.intensity === 'F0');
    if (!hasF0 || polygons.length === 0) {
      addToast('Desenhe pelo menos o polígono F0 (área externa do rastro).', 'error');
      return;
    }
    setSaving(true);
    try {
      if (!user?.uid) {
        addToast('Faça login para salvar.', 'error');
        return;
      }
      await saveTornadoTrack({
        id: editingId || undefined,
        date: date.trim(),
        time: time.trim() || undefined,
        country: country.trim() || undefined,
        state: state.trim(),
        locality: locality.trim() || undefined,
        description: description.trim() || undefined,
        source: source.trim() || undefined,
        radarWmsUrl: radarWmsUrl.trim() || undefined,
        radarStationId: radarStationId.trim() || undefined,
        radarOverrides: Object.keys(radarOverrides).length > 0 ? radarOverrides : undefined,
        polygons,
        prevotsPolygons: prevotsPolygons.filter((p) => p.level !== 0).length ? prevotsPolygons.filter((p) => p.level !== 0) : undefined,
        beforeImage: beforeImage.trim() || undefined,
        afterImage: afterImage.trim() || undefined,
        beforeImageBounds: beforeImageBounds || undefined,
        afterImageBounds: afterImageBounds || undefined,
        trackImage: trackImage.trim() || undefined,
        trackImageBounds: trackImageBounds || undefined,
        secondaryAfterImages: secondaryAfterImages.length ? secondaryAfterImages : undefined,
        numericalModels: numericalModels.length ? numericalModels : undefined,
        skewts: skewts.length ? skewts : undefined,
        victims: victims !== '' ? victims : undefined,
        damage: damage.trim() || undefined,
        gallery: gallery.length ? gallery : undefined,
        externalLinks: externalLinks.length ? externalLinks : undefined,
      }, user.uid);
      addToast(editingId ? 'Rastro atualizado.' : 'Rastro criado.', 'success');
      await loadTracks();
      resetForm();
      setPanelOpen(false);
    } catch (e: any) {
      addToast(`Erro ao salvar: ${e.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Excluir este rastro?')) return;
    try {
      await deleteTornadoTrack(id);
      addToast('Rastro excluído.', 'success');
      await loadTracks();
      if (editingId === id) resetForm();
    } catch (e: any) {
      addToast(`Erro ao excluir: ${e.message}`, 'error');
    }
  };

  if (!isMounted) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-slate-950 text-slate-500">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 flex flex-col bg-slate-950 text-white z-40">
      {/* Header */}
      <header className="flex-shrink-0 flex items-center justify-between gap-3 px-4 py-2 bg-slate-900/90 border-b border-slate-700">
        <div className="flex items-center gap-3">
          <Link href="/admin" className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300">
            <ChevronLeft className="w-5 h-5" />
          </Link>
          <h1 className="text-base font-bold flex items-center gap-2">
            <Wind className="w-5 h-5 text-amber-400" />
            Rastros de Tornados (Admin) — Escala F
          </h1>
        </div>
      </header>

      {/* Mapa + sidebar de rastros */}
      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 min-h-0 relative">
          <div ref={mapRef} className="absolute inset-0 w-full h-full" />

          {/* Widget de pesquisa no mapa — endereço ou lat,lon */}
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 w-full max-w-xl px-2">
            <div className="flex rounded-lg overflow-hidden bg-slate-900/95 border border-slate-600 shadow-xl">
              <input
                type="text"
                value={mapSearchQuery}
                onChange={(e) => setMapSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleMapSearch()}
                placeholder="Endereço ou lat,lon (ex: -26.62, -49.71)"
                className="flex-1 min-w-0 bg-slate-800 border-0 px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:ring-2 focus:ring-amber-500/50 focus:outline-none"
                aria-label="Pesquisar localização no mapa"
              />
              <button
                type="button"
                onClick={handleMapSearch}
                disabled={mapSearching || !mapSearchQuery.trim()}
                className="flex items-center justify-center w-12 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:pointer-events-none text-slate-900 transition-colors"
                title="Ir para o local"
                aria-label="Pesquisar"
              >
                {mapSearching ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Search className="w-5 h-5" />
                )}
              </button>
            </div>
          </div>

          {/* Botão e galeria de estilos de mapa (canto superior esquerdo) */}
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

          {/* Botões no canto direito do mapa */}
          <div className="absolute top-3 right-3 z-10 flex flex-col sm:flex-row gap-2">
            <button
              type="button"
              onClick={openNewTrack}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium shadow-lg border border-emerald-500/50"
            >
              <PlusCircle className="w-5 h-5" />
              Novo rastro
            </button>
            <button
              type="button"
              onClick={openList}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium shadow-lg border border-slate-600"
            >
              <List className="w-5 h-5" />
              Rastros
              {tracks.length > 0 && (
                <span className="bg-amber-500/90 text-slate-900 text-xs font-bold px-1.5 py-0.5 rounded">
                  {tracks.length}
                </span>
              )}
            </button>
          </div>

          {showBeforeAfterDialog && beforeImage.trim() && afterImage.trim() && (
            <div className="absolute bottom-4 left-4 z-30 w-[min(72rem,calc(100%-2rem))] pointer-events-none">
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
                    beforeUrl={beforeImage.trim()}
                    afterUrl={afterImage.trim()}
                    beforeLabel="Antes"
                    afterLabel="Depois"
                    className="w-full max-h-[56vh]"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Sidebar: lista de rastros cadastrados — com botão minimizar */}
        <aside
          className={`flex-shrink-0 bg-slate-900 border-l border-slate-700 flex flex-col transition-[width] duration-200 ${
            sidebarCollapsed ? 'w-12' : 'w-full max-w-md'
          }`}
        >
          {sidebarCollapsed ? (
            <div className="flex flex-col items-center py-4 gap-2">
              <button
                type="button"
                onClick={() => setSidebarCollapsed(false)}
                className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
                title="Expandir menu de rastros"
                aria-label="Expandir menu"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <span className="text-[10px] text-slate-500 uppercase tracking-wider" style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}>
                Rastros
              </span>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between flex-shrink-0 p-3 border-b border-slate-700">
                <h3 className="font-semibold text-slate-200">Rastros cadastrados</h3>
                <button
                  type="button"
                  onClick={() => setSidebarCollapsed(true)}
                  className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
                  title="Minimizar menu"
                  aria-label="Minimizar menu"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>
              {/* Filtro por data: Aplicar e Reset */}
              <div className="flex-shrink-0 p-3 border-b border-slate-700 space-y-2">
                <div className="flex items-center gap-2 text-slate-400 text-xs font-medium">
                  <Filter className="w-3.5 h-3.5" />
                  Filtrar por data
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="date"
                    value={filterStartDate}
                    onChange={(e) => setFilterStartDate(e.target.value)}
                    placeholder="Início"
                    className="bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm text-white"
                  />
                  <input
                    type="date"
                    value={filterEndDate}
                    onChange={(e) => setFilterEndDate(e.target.value)}
                    placeholder="Fim"
                    className="bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm text-white"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={applyDateFilter}
                    className="flex-1 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm font-medium"
                  >
                    Aplicar filtro
                  </button>
                  <button
                    type="button"
                    onClick={resetDateFilter}
                    className="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm"
                  >
                    Reset
                  </button>
                </div>
                {(appliedStartDate || appliedEndDate) && (
                  <p className="text-slate-500 text-xs">
                    Exibindo {filteredTracks.length} de {tracks.length} rastros
                  </p>
                )}
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto p-3">
                {loading ? (
                  <div className="flex justify-center py-8"><Loader2 className="w-8 h-8 animate-spin text-amber-400" /></div>
                ) : (
                  <ul className="space-y-2">
                    {filteredTracks.map((t) => (
                      <li key={t.id} className="flex items-center justify-between gap-2 bg-slate-800/50 rounded-lg p-3 border border-slate-600">
                        <div className="min-w-0">
                          <span className="font-medium text-white">{t.date}</span>
                          <span className="mx-1 text-slate-500">·</span>
                          <span className="text-slate-400 text-sm">{t.locality || t.state}</span>
                          <span className="ml-2 text-[10px] uppercase text-slate-500">{t.country || 'Brasil'}</span>
                          <div className="flex gap-1 mt-1 flex-wrap">
                            {(() => {
                              const maxF = getMaxIntensity(t);
                              return maxF ? (
                                <span className="font-mono text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: TORNADO_TRACK_COLORS[maxF] + '30', color: TORNADO_TRACK_COLORS[maxF] }}>{maxF}</span>
                              ) : null;
                            })()}
                          </div>
                          {(t.beforeImage && t.afterImage) && <span className="ml-2 text-xs text-emerald-400">Antes/Depois</span>}
                          {t.trackImage && <span className="ml-2 text-xs text-cyan-400">Imagem</span>}
                          {t.radarWmsUrl && <span className="ml-2 text-xs text-sky-400">Radar WMS</span>}
                        </div>
                        <div className="flex gap-1 flex-shrink-0">
                          <button onClick={() => handleEdit(t)} className="p-1.5 rounded bg-slate-700 hover:bg-cyan-600 text-cyan-300" title="Editar"><Edit className="w-4 h-4" /></button>
                          <button onClick={() => handleDelete(t.id)} className="p-1.5 rounded bg-slate-700 hover:bg-red-600 text-red-300" title="Excluir"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {!loading && filteredTracks.length === 0 && (
                  <p className="text-slate-500 text-sm py-4">
                    {tracks.length === 0 ? 'Nenhum rastro. Clique em "Novo rastro" para criar.' : 'Nenhum rastro no intervalo de datas. Use Reset para ver todos.'}
                  </p>
                )}
              </div>
            </>
          )}
        </aside>
      </div>

      {/* Painel do formulário (novo/editar rastro) — abre por cima quando Novo rastro ou Editar */}
      {panelOpen && (
        <>
          <div className="absolute inset-0 bg-black/50 z-20 pointer-events-none" aria-hidden />
          <div className="absolute top-0 right-0 bottom-0 w-full max-w-md bg-slate-900 border-l border-slate-700 shadow-2xl z-30 flex flex-col animate-in slide-in-from-right duration-200">
            <div className="flex items-center justify-between flex-shrink-0 p-3 border-b border-slate-700">
              <h3 className="font-semibold text-slate-200">
                {editingId ? 'Editar rastro' : 'Novo rastro'}
              </h3>
              <button
                type="button"
                onClick={() => { resetForm(); setPanelOpen(false); }}
                className="p-2 text-slate-400 hover:text-white rounded-lg"
                title="Fechar"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto">
                <div className="p-4 space-y-4">
                  <p className="text-slate-400 text-xs">
                    Desenhe os polígonos da menor para a maior intensidade: primeiro F0 (área total), depois F1 dentro de F0, F2 dentro de F1, etc. Escala F (Fujita).
                  </p>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <label>
                      <span className="text-slate-400 block mb-1">Data (YYYY-MM-DD)</span>
                      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2" />
                    </label>
                    <label>
                      <span className="text-slate-400 block mb-1">Hora UTC (aprox.)</span>
                      <input type="time" value={time} onChange={(e) => setTime(e.target.value)} placeholder="ex: 14:30" className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2" />
                    </label>
                    <label>
                      <span className="text-slate-400 block mb-1">País</span>
                      <select
                        value={country}
                        onChange={(e) => setCountry(e.target.value)}
                        className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2"
                      >
                        <option value="Brasil">Brasil</option>
                        <option value="Paraguai">Paraguai</option>
                        <option value="Argentina">Argentina</option>
                        <option value="Uruguai">Uruguai</option>
                        <option value="Bolívia">Bolívia</option>
                        <option value="Chile">Chile</option>
                        <option value="Peru">Peru</option>
                        <option value="Outro">Outro</option>
                      </select>
                    </label>
                    <label>
                      <span className="text-slate-400 block mb-1">Estado</span>
                      <input value={state} onChange={(e) => setState(e.target.value)} placeholder="ex: RS" className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2" />
                    </label>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <label>
                      <span className="text-slate-400 block mb-1">Vítimas</span>
                      <input value={victims} onChange={(e) => setVictims(e.target.value)} placeholder="ex: 2 mortos, 15 feridos" className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2" />
                    </label>
                    <label>
                      <span className="text-slate-400 block mb-1">Prejuízo</span>
                      <input value={damage} onChange={(e) => setDamage(e.target.value)} placeholder="ex: R$ 50 mi" className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2" />
                    </label>
                  </div>

                  {/* Seção SkewTs (00z - 21z) */}
                  <div className="space-y-2 border-t border-slate-700 pt-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">SkewTs (00z - 21z)</span>
                      <div className="flex gap-2">
                        <input 
                          type="file" 
                          ref={skewtFileInputRef} 
                          accept="image/*" 
                          onChange={handleSkewtUpload} 
                          className="hidden" 
                        />
                        <button 
                          type="button" 
                          onClick={() => skewtFileInputRef.current?.click()}
                          disabled={skewtUploading}
                          className="text-[10px] text-emerald-400 hover:text-emerald-300 font-bold flex items-center gap-1"
                        >
                          {skewtUploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                          Upload
                        </button>
                        <button 
                          type="button" 
                          onClick={() => setSkewts(prev => [...prev, ''])}
                          className="text-[10px] text-cyan-400 hover:text-cyan-300 font-bold flex items-center gap-1"
                        >
                          <PlusCircle className="w-3 h-3" /> Manual
                        </button>
                      </div>
                    </div>
                    {skewts.map((url, idx) => (
                      <div key={idx} className="flex gap-2">
                        <input 
                          value={url} 
                          onChange={(e) => {
                            const next = [...skewts];
                            next[idx] = e.target.value;
                            setSkewts(next);
                          }}
                          placeholder={`URL SkewT ${idx * 3}z`}
                          className="flex-1 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs"
                        />
                        <button 
                          type="button" 
                          onClick={() => setSkewts(prev => prev.filter((_, i) => i !== idx))}
                          className="p-1 text-red-400 hover:bg-red-950/30 rounded"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>

                  {/* Seção Galeria de Imagens */}
                  <div className="space-y-2 border-t border-slate-700 pt-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Galeria de Imagens (Slider)</span>
                      <div className="flex gap-2">
                        <input 
                          type="file" 
                          ref={galleryFileInputRef} 
                          accept="image/*" 
                          onChange={handleGalleryUpload} 
                          className="hidden" 
                        />
                        <button 
                          type="button" 
                          onClick={() => galleryFileInputRef.current?.click()}
                          disabled={galleryUploading}
                          className="text-[10px] text-emerald-400 hover:text-emerald-300 font-bold flex items-center gap-1"
                        >
                          {galleryUploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                          Upload
                        </button>
                        <button 
                          type="button" 
                          onClick={() => setGallery(prev => [...prev, ''])}
                          className="text-[10px] text-cyan-400 hover:text-cyan-300 font-bold flex items-center gap-1"
                        >
                          <PlusCircle className="w-3 h-3" /> Manual
                        </button>
                      </div>
                    </div>
                    {gallery.map((url, idx) => (
                      <div key={idx} className="flex gap-2">
                        <input 
                          value={url} 
                          onChange={(e) => {
                            const next = [...gallery];
                            next[idx] = e.target.value;
                            setGallery(next);
                          }}
                          placeholder="URL da imagem"
                          className="flex-1 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs"
                        />
                        <button 
                          type="button" 
                          onClick={() => setGallery(prev => prev.filter((_, i) => i !== idx))}
                          className="p-1 text-red-400 hover:bg-red-950/30 rounded"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>

                  {/* Seção Links Externos */}
                  <div className="space-y-2 border-t border-slate-700 pt-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Links Externos</span>
                      <button 
                        type="button" 
                        onClick={() => setExternalLinks(prev => [...prev, { label: '', url: '' }])}
                        className="text-[10px] text-cyan-400 hover:text-cyan-300 font-bold flex items-center gap-1"
                      >
                        <PlusCircle className="w-3 h-3" /> Adicionar Link
                      </button>
                    </div>
                    {externalLinks.map((link, idx) => (
                      <div key={idx} className="space-y-1 bg-slate-800/40 p-2 rounded-lg border border-slate-700/50">
                        <div className="flex gap-2">
                          <input 
                            value={link.label} 
                            onChange={(e) => {
                              const next = [...externalLinks];
                              next[idx].label = e.target.value;
                              setExternalLinks(next);
                            }}
                            placeholder="Rótulo (ex: Relatório Inmet)"
                            className="flex-1 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs"
                          />
                          <button 
                            type="button" 
                            onClick={() => setExternalLinks(prev => prev.filter((_, i) => i !== idx))}
                            className="p-1 text-red-400 hover:bg-red-950/30 rounded"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <input 
                          value={link.url} 
                          onChange={(e) => {
                            const next = [...externalLinks];
                            next[idx].url = e.target.value;
                            setExternalLinks(next);
                          }}
                          placeholder="URL"
                          className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs"
                        />
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <label className="col-span-2">
                      <span className="text-slate-400 block mb-1">Localidade</span>
                      <input value={locality} onChange={(e) => setLocality(e.target.value)} placeholder="ex: Vacaria" className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2" />
                    </label>
                    <label className="col-span-2">
                      <span className="text-slate-400 block mb-1">Descrição</span>
                      <input value={description} onChange={(e) => setDescription(e.target.value)} className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2" />
                    </label>
                    <label className="col-span-2">
                      <span className="text-slate-400 block mb-1">Fonte</span>
                      <input value={source} onChange={(e) => setSource(e.target.value)} className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2" />
                    </label>
                    <label className="col-span-2">
                      <span className="text-slate-400 block mb-1">Radar WMS (opcional)</span>
                      <input
                        value={radarWmsUrl}
                        onChange={(e) => setRadarWmsUrl(e.target.value)}
                        placeholder="URL WMS GetMap"
                        className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-xs"
                      />
                    </label>
                    <label className="col-span-2">
                      <span className="text-slate-400 block mb-1">Radar preferido</span>
                      <select
                        value={radarStationId}
                        onChange={(e) => setRadarStationId(e.target.value)}
                        className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm"
                      >
                        <option value="">Automático</option>
                        {CPTEC_RADAR_STATIONS.map((r) => (
                          <option key={r.slug} value={r.slug}>{r.name}</option>
                        ))}
                      </select>
                    </label>
                  </div>

                    {/* Ajuste Fino de Radar Local (Override) */}
                    <div className="col-span-2 space-y-3 rounded-lg border border-slate-600 p-3 bg-slate-800/50">
                      <span className="text-slate-300 text-sm font-semibold block">Ajuste Fino do Radar (Salvo apenas para este rastro)</span>
                      <p className="text-slate-500 text-xs">Preencha apenas o que desejar substituir em relação à configuração original do Radar.</p>
                      
                      {(() => {
                        const rId = radarStationId || radarWmsUrl || 'legacy';
                        const override = radarOverrides[rId] || {};
                        const updateField = (field: string, val: number | undefined) => {
                          setRadarOverrides(prev => ({
                            ...prev,
                            [rId]: { ...(prev[rId] || {}), [field]: val }
                          }));
                        };
                        return (
                          <>
                            <div className="grid grid-cols-2 gap-3">
                              <label>
                                <span className="text-slate-400 text-xs block mb-1">Centro Latitude</span>
                                <input type="number" value={override.lat ?? ''} onChange={(e) => updateField('lat', e.target.value ? parseFloat(e.target.value) : undefined)} className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs" />
                              </label>
                              <label>
                                <span className="text-slate-400 text-xs block mb-1">Centro Longitude</span>
                                <input type="number" value={override.lng ?? ''} onChange={(e) => updateField('lng', e.target.value ? parseFloat(e.target.value) : undefined)} className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs" />
                              </label>
                              <label>
                                <span className="text-slate-400 text-xs block mb-1">Raio (km)</span>
                                <input type="number" value={override.rangeKm ?? ''} onChange={(e) => updateField('rangeKm', e.target.value ? parseFloat(e.target.value) : undefined)} className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs" />
                              </label>
                              <label>
                                <span className="text-slate-400 text-xs block mb-1">Opacidade (0 a 1)</span>
                                <input type="number" step="0.05" min="0" max="1" value={override.opacity ?? ''} onChange={(e) => updateField('opacity', e.target.value ? parseFloat(e.target.value) : undefined)} className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs" />
                              </label>
                              <label>
                                <span className="text-slate-400 text-xs block mb-1">Rotação (graus)</span>
                                <input type="number" step="0.1" value={override.rotation ?? ''} onChange={(e) => updateField('rotation', e.target.value ? parseFloat(e.target.value) : undefined)} className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs" />
                              </label>
                              <label>
                                <span className="text-slate-400 text-xs block mb-1">Chroma Key Delta (0 a 255)</span>
                                <input type="number" value={override.chromaKey ?? ''} onChange={(e) => updateField('chromaKey', e.target.value ? parseInt(e.target.value) : undefined)} className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs" />
                              </label>
                            </div>

                            <div className="space-y-1 mt-2">
                              <span className="text-slate-400 text-xs font-semibold block">Cortes / Crop (0 a 1)</span>
                              <div className="grid grid-cols-4 gap-2">
                                <label>
                                  <span className="text-slate-500 text-[10px] block">Topo</span>
                                  <input type="number" step="0.01" min="0" max="1" value={override.cropTop ?? ''} onChange={(e) => updateField('cropTop', e.target.value ? parseFloat(e.target.value) : undefined)} className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs" />
                                </label>
                                <label>
                                  <span className="text-slate-500 text-[10px] block">Base</span>
                                  <input type="number" step="0.01" min="0" max="1" value={override.cropBottom ?? ''} onChange={(e) => updateField('cropBottom', e.target.value ? parseFloat(e.target.value) : undefined)} className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs" />
                                </label>
                                <label>
                                  <span className="text-slate-500 text-[10px] block">Esq.</span>
                                  <input type="number" step="0.01" min="0" max="1" value={override.cropLeft ?? ''} onChange={(e) => updateField('cropLeft', e.target.value ? parseFloat(e.target.value) : undefined)} className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs" />
                                </label>
                                <label>
                                  <span className="text-slate-500 text-[10px] block">Dir.</span>
                                  <input type="number" step="0.01" min="0" max="1" value={override.cropRight ?? ''} onChange={(e) => updateField('cropRight', e.target.value ? parseFloat(e.target.value) : undefined)} className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs" />
                                </label>
                              </div>
                            </div>
                          </>
                        );
                      })()}
                    </div>
                    {/* Imagem Antes (GeoTIFF/imagem) — overlay com caixinha */}
                    <div className="col-span-2 space-y-2 rounded-lg border border-slate-600 p-3 bg-slate-800/50">
                      <span className="text-slate-400 text-sm font-medium block">Imagem Antes (KMZ / GeoTIFF / imagem)</span>
                      <div className="flex gap-2 flex-wrap items-center">
                        <input type="file" ref={beforeImageFileInputRef} accept=".kmz,.tif,.tiff,image/tiff,image/*" onChange={handleBeforeImageFileSelect} disabled={beforeImageUploading} className="hidden" id="before-image-upload" />
                        <label htmlFor="before-image-upload" className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-600 text-sm font-medium cursor-pointer transition-colors ${beforeImageUploading ? 'opacity-50 pointer-events-none' : 'bg-slate-700 hover:bg-slate-600 text-slate-200'}`}>
                          {beforeImageUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                          {beforeImageUploading ? 'Enviando…' : 'Enviar KMZ / imagem'}
                        </label>
                        <label className="inline-flex items-center gap-2 text-slate-300 text-sm cursor-pointer">
                          <input type="checkbox" checked={showOverlayBefore} onChange={(e) => setShowOverlayBefore(e.target.checked)} className="rounded border-slate-500 bg-slate-800 text-amber-500 focus:ring-amber-500" />
                          Mostrar Antes no mapa
                        </label>
                        <button
                          type="button"
                          onClick={() => setImageMappingMode(imageMappingMode === 'before' ? 'none' : 'before')}
                          className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${imageMappingMode === 'before' ? 'bg-amber-500 text-black border-amber-400' : 'bg-slate-700 hover:bg-slate-600 text-slate-200 border-slate-600'}`}
                        >
                          <Layers className="w-4 h-4" />
                          {imageMappingMode === 'before' ? 'Concluir Ajuste' : 'Ajustar no Mapa'}
                        </button>
                      </div>
                      {showOverlayBefore && (
                        <div className="flex items-center gap-2 text-xs text-slate-400">
                          <span className="shrink-0">Opacidade:</span>
                          <input
                            type="range" min={0} max={1} step={0.05}
                            value={overlayBeforeOpacity}
                            onChange={(e) => setOverlayBeforeOpacity(parseFloat(e.target.value))}
                            className="flex-1 accent-amber-500"
                          />
                          <span className="w-8 text-right">{Math.round(overlayBeforeOpacity * 100)}%</span>
                        </div>
                      )}
                      <input type="url" value={beforeImage} onChange={(e) => setBeforeImage(e.target.value)} placeholder="Ou cole a URL da imagem Antes" className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm" />
                      <div className="grid grid-cols-4 gap-1 text-xs">
                        <input type="text" placeholder="NE lat" value={beforeImageBounds?.ne?.lat ?? ''} onChange={(e) => setBeforeImageBounds((b) => ({ ne: { lat: parseCoord(e.target.value), lng: b?.ne?.lng ?? 0 }, sw: b?.sw ?? { lat: 0, lng: 0 } }))} className="bg-slate-800 border border-slate-600 rounded px-2 py-1.5" />
                        <input type="text" placeholder="NE lng" value={beforeImageBounds?.ne?.lng ?? ''} onChange={(e) => setBeforeImageBounds((b) => ({ ne: { lat: b?.ne?.lat ?? 0, lng: parseCoord(e.target.value) }, sw: b?.sw ?? { lat: 0, lng: 0 } }))} className="bg-slate-800 border border-slate-600 rounded px-2 py-1.5" />
                        <input type="text" placeholder="SW lat" value={beforeImageBounds?.sw?.lat ?? ''} onChange={(e) => setBeforeImageBounds((b) => ({ ne: b?.ne ?? { lat: 0, lng: 0 }, sw: { lat: parseCoord(e.target.value), lng: b?.sw?.lng ?? 0 } }))} className="bg-slate-800 border border-slate-600 rounded px-2 py-1.5" />
                        <input type="text" placeholder="SW lng" value={beforeImageBounds?.sw?.lng ?? ''} onChange={(e) => setBeforeImageBounds((b) => ({ ne: b?.ne ?? { lat: 0, lng: 0 }, sw: { lat: b?.sw?.lat ?? 0, lng: parseCoord(e.target.value) } }))} className="bg-slate-800 border border-slate-600 rounded px-2 py-1.5" />
                      </div>
                      <p className="text-slate-500 text-xs">KMZ: imagem e coordenadas extraídas automaticamente. GeoTIFF também suportado.</p>
                    </div>
                    {/* Imagem Depois (KMZ/GeoTIFF/imagem) — overlay com caixinha */}
                    <div className="col-span-2 space-y-2 rounded-lg border border-slate-600 p-3 bg-slate-800/50">
                      <span className="text-slate-400 text-sm font-medium block">Imagem Depois (KMZ / GeoTIFF / imagem)</span>
                      <div className="flex gap-2 flex-wrap items-center">
                        <input type="file" ref={afterImageFileInputRef} accept=".kmz,.tif,.tiff,image/tiff,image/*" onChange={handleAfterImageFileSelect} disabled={afterImageUploading} className="hidden" id="after-image-upload" />
                        <label htmlFor="after-image-upload" className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-600 text-sm font-medium cursor-pointer transition-colors ${afterImageUploading ? 'opacity-50 pointer-events-none' : 'bg-slate-700 hover:bg-slate-600 text-slate-200'}`}>
                          {afterImageUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                          {afterImageUploading ? 'Enviando…' : 'Enviar KMZ / imagem'}
                        </label>
                        <label className="inline-flex items-center gap-2 text-slate-300 text-sm cursor-pointer">
                          <input type="checkbox" checked={showOverlayAfter} onChange={(e) => setShowOverlayAfter(e.target.checked)} className="rounded border-slate-500 bg-slate-800 text-amber-500 focus:ring-amber-500" />
                          Mostrar Depois no mapa
                        </label>
                        <button
                          type="button"
                          onClick={() => setImageMappingMode(imageMappingMode === 'after' ? 'none' : 'after')}
                          className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${imageMappingMode === 'after' ? 'bg-emerald-500 text-black border-emerald-400' : 'bg-slate-700 hover:bg-slate-600 text-slate-200 border-slate-600'}`}
                        >
                          <Layers className="w-4 h-4" />
                          {imageMappingMode === 'after' ? 'Concluir Ajuste' : 'Ajustar no Mapa'}
                        </button>
                      </div>
                      {showOverlayAfter && (
                        <div className="flex items-center gap-2 text-xs text-slate-400">
                          <span className="shrink-0">Opacidade:</span>
                          <input
                            type="range" min={0} max={1} step={0.05}
                            value={overlayAfterOpacity}
                            onChange={(e) => setOverlayAfterOpacity(parseFloat(e.target.value))}
                            className="flex-1 accent-amber-500"
                          />
                          <span className="w-8 text-right">{Math.round(overlayAfterOpacity * 100)}%</span>
                        </div>
                      )}
                      <input type="url" value={afterImage} onChange={(e) => setAfterImage(e.target.value)} placeholder="Ou cole a URL da imagem Depois" className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm" />
                      <div className="grid grid-cols-4 gap-1 text-xs">
                        <input type="text" placeholder="NE lat" value={afterImageBounds?.ne?.lat ?? ''} onChange={(e) => setAfterImageBounds((b) => ({ ne: { lat: parseCoord(e.target.value), lng: b?.ne?.lng ?? 0 }, sw: b?.sw ?? { lat: 0, lng: 0 } }))} className="bg-slate-800 border border-slate-600 rounded px-2 py-1.5" />
                        <input type="text" placeholder="NE lng" value={afterImageBounds?.ne?.lng ?? ''} onChange={(e) => setAfterImageBounds((b) => ({ ne: { lat: b?.ne?.lat ?? 0, lng: parseCoord(e.target.value) }, sw: b?.sw ?? { lat: 0, lng: 0 } }))} className="bg-slate-800 border border-slate-600 rounded px-2 py-1.5" />
                        <input type="text" placeholder="SW lat" value={afterImageBounds?.sw?.lat ?? ''} onChange={(e) => setAfterImageBounds((b) => ({ ne: b?.ne ?? { lat: 0, lng: 0 }, sw: { lat: parseCoord(e.target.value), lng: b?.sw?.lng ?? 0 } }))} className="bg-slate-800 border border-slate-600 rounded px-2 py-1.5" />
                        <input type="text" placeholder="SW lng" value={afterImageBounds?.sw?.lng ?? ''} onChange={(e) => setAfterImageBounds((b) => ({ ne: b?.ne ?? { lat: 0, lng: 0 }, sw: { lat: b?.sw?.lat ?? 0, lng: parseCoord(e.target.value) } }))} className="bg-slate-800 border border-slate-600 rounded px-2 py-1.5" />
                      </div>
                      <p className="text-slate-500 text-xs">KMZ: imagem e coordenadas extraídas automaticamente. GeoTIFF também suportado.</p>
                    </div>

                    {/* Múltiplas Imagens Secundárias (Depois) */}
                    <div className="col-span-2 space-y-3 rounded-lg border border-slate-700 p-3 bg-slate-800/30">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-200 text-sm font-semibold">Imagens de Zoom / Detalhes (Depois)</span>
                        <button
                          type="button"
                          onClick={addSecondaryImage}
                          className="text-xs flex items-center gap-1 px-2 py-1 rounded bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 border border-emerald-500/30 transition-colors"
                        >
                          <PlusCircle className="w-3 h-3" /> Adicionar imagem
                        </button>
                      </div>
                      
                      <input 
                        type="file" 
                        ref={secondaryImageFileInputRef} 
                        accept=".kmz,.tif,.tiff,image/tiff,image/*" 
                        onChange={handleSecondaryImageFileSelect} 
                        className="hidden" 
                      />

                      {secondaryAfterImages.length === 0 && (
                        <p className="text-slate-500 text-xs italic">Nenhuma imagem secundária adicionada.</p>
                      )}

                      <div className="space-y-4">
                        {secondaryAfterImages.map((img, idx) => (
                          <div key={img.id} className="p-3 rounded-lg border border-slate-700 bg-slate-900/50 space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-medium text-slate-400">Imagem #{idx + 1}</span>
                              <button 
                                type="button" 
                                onClick={() => removeSecondaryImage(img.id)}
                                className="p-1 rounded text-slate-500 hover:text-red-400 hover:bg-red-400/10 transition-colors"
                                title="Remover imagem"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>

                            <div className="flex gap-2 flex-wrap items-center">
                              <button 
                                type="button"
                                onClick={() => { setActiveSecondaryId(img.id); secondaryImageFileInputRef.current?.click(); }}
                                disabled={secondaryUploadingId === img.id}
                                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded border border-slate-600 text-xs font-medium cursor-pointer transition-colors ${secondaryUploadingId === img.id ? 'opacity-50 pointer-events-none' : 'bg-slate-700 hover:bg-slate-600 text-slate-200'}`}
                              >
                                {secondaryUploadingId === img.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                                {secondaryUploadingId === img.id ? 'Enviando…' : 'Enviar KMZ / imagem'}
                              </button>
                              
                              <button
                                type="button"
                                onClick={() => setImageMappingMode(imageMappingMode === img.id ? 'none' : img.id)}
                                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded border text-xs font-medium transition-colors ${imageMappingMode === img.id ? 'bg-amber-500 text-black border-amber-400' : 'bg-slate-700 hover:bg-slate-600 text-slate-200 border-slate-600'}`}
                              >
                                <Layers className="w-3 h-3" />
                                {imageMappingMode === img.id ? 'Concluir Ajuste' : 'Ajustar no Mapa'}
                              </button>
                            </div>

                            <input 
                              type="url" 
                              value={img.url} 
                              onChange={(e) => setSecondaryAfterImages(prev => prev.map(si => si.id === img.id ? { ...si, url: e.target.value } : si))} 
                              placeholder="URL da imagem" 
                              className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-xs" 
                            />

                            <div className="flex items-center justify-between gap-4 mt-1 bg-slate-800/80 p-2 rounded border border-slate-700">
                              <label className="inline-flex items-center gap-2 text-slate-300 text-xs cursor-pointer">
                                <input 
                                  type="checkbox" 
                                  checked={!!showSecondaryOnMap[img.id]} 
                                  onChange={(e) => setShowSecondaryOnMap(prev => ({ ...prev, [img.id]: e.target.checked }))} 
                                  className="rounded border-slate-500 bg-slate-900 text-emerald-500 focus:ring-emerald-500" 
                                />
                                Mostrar no mapa
                              </label>

                              <div className="flex items-center gap-3">
                                <div className="flex items-center gap-1 text-xs text-slate-400">
                                  <span className="shrink-0 truncate w-12">Opacid.</span>
                                  <input
                                    type="range" min={0} max={1} step={0.05}
                                    value={img.opacity ?? 0.8}
                                    onChange={(e) => setSecondaryAfterImages(prev => prev.map(si => si.id === img.id ? { ...si, opacity: parseFloat(e.target.value) } : si))}
                                    className="w-16 accent-amber-500"
                                  />
                                </div>
                                <div className="flex items-center gap-1 text-xs text-slate-400">
                                  <span className="shrink-0 truncate w-10">Rot. (º)</span>
                                  <input
                                    type="number" step="0.1"
                                    value={img.rotation ?? 0}
                                    onChange={(e) => setSecondaryAfterImages(prev => prev.map(si => si.id === img.id ? { ...si, rotation: parseFloat(e.target.value) } : si))}
                                    className="w-16 bg-slate-900 border border-slate-700 rounded px-1 py-0.5 text-xs text-center"
                                  />
                                </div>
                              </div>
                            </div>
                            
                            <div className="grid grid-cols-2 gap-2">
                              <div className="space-y-1">
                                <span className="text-[10px] text-slate-500 uppercase">Nordeste (NE)</span>
                                <div className="grid grid-cols-2 gap-1">
                                  <input type="text" placeholder="Lat" value={img.bounds?.ne?.lat ?? ''} onChange={(e) => setSecondaryAfterImages(prev => prev.map(si => si.id === img.id ? { ...si, bounds: { ...si.bounds, ne: { ...si.bounds.ne, lat: parseCoord(e.target.value) } } } : si))} className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-[10px]" />
                                  <input type="text" placeholder="Lng" value={img.bounds?.ne?.lng ?? ''} onChange={(e) => setSecondaryAfterImages(prev => prev.map(si => si.id === img.id ? { ...si, bounds: { ...si.bounds, ne: { ...si.bounds.ne, lng: parseCoord(e.target.value) } } } : si))} className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-[10px]" />
                                </div>
                              </div>
                              <div className="space-y-1">
                                <span className="text-[10px] text-slate-500 uppercase">Sudoeste (SW)</span>
                                <div className="grid grid-cols-2 gap-1">
                                  <input type="text" placeholder="Lat" value={img.bounds?.sw?.lat ?? ''} onChange={(e) => setSecondaryAfterImages(prev => prev.map(si => si.id === img.id ? { ...si, bounds: { ...si.bounds, sw: { ...si.bounds.sw, lat: parseCoord(e.target.value) } } } : si))} className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-[10px]" />
                                  <input type="text" placeholder="Lng" value={img.bounds?.sw?.lng ?? ''} onChange={(e) => setSecondaryAfterImages(prev => prev.map(si => si.id === img.id ? { ...si, bounds: { ...si.bounds, sw: { ...si.bounds.sw, lng: parseCoord(e.target.value) } } } : si))} className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-[10px]" />
                                </div>
                              </div>
                            </div>

                            <input 
                              type="text" 
                              value={img.description || ''} 
                              onChange={(e) => setSecondaryAfterImages(prev => prev.map(si => si.id === img.id ? { ...si, description: e.target.value } : si))} 
                              placeholder="Descrição curta (ex: Zoom na área urbana)" 
                              className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-xs" 
                            />
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Modelos Numéricos (GTS) */}
                    <div className="col-span-2 space-y-3 rounded-lg border border-slate-700 p-3 bg-slate-800/30">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-200 text-sm font-semibold">Modelos Numéricos (GTS)</span>
                        <button
                          type="button"
                          onClick={addNumericalModel}
                          className="text-xs flex items-center gap-1 px-2 py-1 rounded bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 border border-blue-500/30 transition-colors"
                        >
                          <PlusCircle className="w-3 h-3" /> Adicionar modelo
                        </button>
                      </div>

                      <input
                        type="file"
                        ref={numericalImageFileInputRef}
                        accept=".kmz,.tif,.tiff,image/tiff,image/*"
                        onChange={handleNumericalModelFileSelect}
                        className="hidden"
                      />

                      {numericalModels.length === 0 && (
                        <p className="text-slate-500 text-xs italic">Nenhum modelo numérico adicionado.</p>
                      )}

                      <div className="space-y-4">
                        {numericalModels.map((img, idx) => (
                          <div key={img.id} className="p-3 rounded-lg border border-slate-700 bg-slate-900/50 space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-medium text-slate-400">Modelo #{idx + 1}</span>
                              <button
                                type="button"
                                onClick={() => removeNumericalModel(img.id)}
                                className="p-1 rounded text-slate-500 hover:text-red-400 hover:bg-red-400/10 transition-colors"
                                title="Remover modelo"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>

                            <div className="grid grid-cols-2 gap-2 mb-2">
                              <div>
                                <label className="text-[10px] text-slate-400 mb-1 block">Rodada (HHZ)</label>
                                <select
                                  value={img.round || '00Z'}
                                  onChange={(e) => setNumericalModels(prev => prev.map(si => si.id === img.id ? { ...si, round: e.target.value } : si))}
                                  className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-xs text-white"
                                >
                                  {['00Z', '06Z', '12Z', '18Z', '20Z'].map(r => <option key={r} value={r}>{r}</option>)}
                                </select>
                              </div>
                              <div>
                                <label className="text-[10px] text-slate-400 mb-1 block">Forecast (+H)</label>
                                <input
                                  type="number" min={0}
                                  value={img.forecastHour ?? 1}
                                  onChange={(e) => setNumericalModels(prev => prev.map(si => si.id === img.id ? { ...si, forecastHour: parseInt(e.target.value) || 0 } : si))}
                                  className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-white"
                                />
                              </div>
                            </div>

                            <div className="flex gap-2 flex-wrap items-center">
                              <button
                                type="button"
                                onClick={() => { setActiveNumericalId(img.id); numericalImageFileInputRef.current?.click(); }}
                                disabled={numericalUploadingId === img.id}
                                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded border border-slate-600 text-xs font-medium cursor-pointer transition-colors ${numericalUploadingId === img.id ? 'opacity-50 pointer-events-none' : 'bg-slate-700 hover:bg-slate-600 text-slate-200'}`}
                              >
                                {numericalUploadingId === img.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                                {numericalUploadingId === img.id ? 'Enviando…' : 'Enviar imagem'}
                              </button>

                              <button
                                type="button"
                                onClick={() => setImageMappingMode(imageMappingMode === img.id ? 'none' : img.id)}
                                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded border text-xs font-medium transition-colors ${imageMappingMode === img.id ? 'bg-amber-500 text-black border-amber-400' : 'bg-slate-700 hover:bg-slate-600 text-slate-200 border-slate-600'}`}
                              >
                                <Layers className="w-3 h-3" />
                                {imageMappingMode === img.id ? 'Concluir Ajuste' : 'Ajustar no Mapa'}
                              </button>
                            </div>

                            <input
                              type="url"
                              value={img.url}
                              onChange={(e) => setNumericalModels(prev => prev.map(si => si.id === img.id ? { ...si, url: e.target.value } : si))}
                              placeholder="URL da imagem numérico"
                              className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-xs"
                            />

                            <label className="inline-flex items-center gap-2 text-slate-300 text-[11px] cursor-pointer mt-1">
                              <input
                                type="checkbox"
                                checked={!!showNumericalOnMap[img.id]}
                                onChange={(e) => setShowNumericalOnMap(prev => ({ ...prev, [img.id]: e.target.checked }))}
                                className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500"
                              />
                              Mostrar no mapa
                            </label>

                            {/* Transparency and Chroma */}
                            <div className="grid grid-cols-2 gap-4 my-2">
                              <div>
                                <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1">
                                  <span>Opacidade</span>
                                  <span>{Math.round((img.opacity ?? 0.8) * 100)}%</span>
                                </div>
                                <input
                                  type="range" min={0} max={1} step={0.05}
                                  value={img.opacity ?? 0.8}
                                  onChange={(e) => setNumericalModels(prev => prev.map(si => si.id === img.id ? { ...si, opacity: parseFloat(e.target.value) } : si))}
                                  className="w-full accent-blue-500"
                                />
                              </div>
                              <div>
                                <label className="text-[10px] text-slate-400 block mb-1">Recortar Fundo (Multiply)</label>
                                <label className="inline-flex items-center gap-2 text-slate-300 text-[11px] cursor-pointer">
                                  <input type="checkbox" checked={!!img.chromaKey} onChange={(e) => setNumericalModels(prev => prev.map(si => si.id === img.id ? { ...si, chromaKey: e.target.checked ? 1 : 0 } : si))} className="rounded border-slate-600 bg-slate-800 text-blue-500" />
                                  Sem fundo branco
                                </label>
                              </div>
                            </div>
                            
                            {/* Crop */}
                            <div className="grid grid-cols-4 gap-1">
                              <div className="flex flex-col"><span className="text-[10px] text-slate-500">Crop Top %</span><input type="number" min={0} max={100} value={img.cropTop ?? 0} onChange={(e) => setNumericalModels(prev => prev.map(si => si.id === img.id ? { ...si, cropTop: parseInt(e.target.value) || 0 } : si))} className="bg-slate-800 border border-slate-700 rounded px-1 py-1 text-[10px]" /></div>
                              <div className="flex flex-col"><span className="text-[10px] text-slate-500">Crop Bot %</span><input type="number" min={0} max={100} value={img.cropBottom ?? 0} onChange={(e) => setNumericalModels(prev => prev.map(si => si.id === img.id ? { ...si, cropBottom: parseInt(e.target.value) || 0 } : si))} className="bg-slate-800 border border-slate-700 rounded px-1 py-1 text-[10px]" /></div>
                              <div className="flex flex-col"><span className="text-[10px] text-slate-500">Crop Lft %</span><input type="number" min={0} max={100} value={img.cropLeft ?? 0} onChange={(e) => setNumericalModels(prev => prev.map(si => si.id === img.id ? { ...si, cropLeft: parseInt(e.target.value) || 0 } : si))} className="bg-slate-800 border border-slate-700 rounded px-1 py-1 text-[10px]" /></div>
                              <div className="flex flex-col"><span className="text-[10px] text-slate-500">Crop Rgt %</span><input type="number" min={0} max={100} value={img.cropRight ?? 0} onChange={(e) => setNumericalModels(prev => prev.map(si => si.id === img.id ? { ...si, cropRight: parseInt(e.target.value) || 0 } : si))} className="bg-slate-800 border border-slate-700 rounded px-1 py-1 text-[10px]" /></div>
                            </div>

                            <div className="grid grid-cols-2 gap-2 mt-2">
                              <div className="space-y-1">
                                <span className="text-[10px] text-slate-500 uppercase">Nordeste (NE)</span>
                                <div className="grid grid-cols-2 gap-1">
                                  <input type="text" placeholder="Lat" value={img.bounds?.ne?.lat ?? ''} onChange={(e) => setNumericalModels(prev => prev.map(si => si.id === img.id ? { ...si, bounds: { ...si.bounds, ne: { ...si.bounds.ne, lat: parseCoord(e.target.value) } } } : si))} className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-[10px]" />
                                  <input type="text" placeholder="Lng" value={img.bounds?.ne?.lng ?? ''} onChange={(e) => setNumericalModels(prev => prev.map(si => si.id === img.id ? { ...si, bounds: { ...si.bounds, ne: { ...si.bounds.ne, lng: parseCoord(e.target.value) } } } : si))} className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-[10px]" />
                                </div>
                              </div>
                              <div className="space-y-1">
                                <span className="text-[10px] text-slate-500 uppercase">Sudoeste (SW)</span>
                                <div className="grid grid-cols-2 gap-1">
                                  <input type="text" placeholder="Lat" value={img.bounds?.sw?.lat ?? ''} onChange={(e) => setNumericalModels(prev => prev.map(si => si.id === img.id ? { ...si, bounds: { ...si.bounds, sw: { ...si.bounds.sw, lat: parseCoord(e.target.value) } } } : si))} className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-[10px]" />
                                  <input type="text" placeholder="Lng" value={img.bounds?.sw?.lng ?? ''} onChange={(e) => setNumericalModels(prev => prev.map(si => si.id === img.id ? { ...si, bounds: { ...si.bounds, sw: { ...si.bounds.sw, lng: parseCoord(e.target.value) } } } : si))} className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-[10px]" />
                                </div>
                              </div>
                            </div>

                          </div>
                        ))}
                      </div>
                    </div>
                    
                    {(beforeImage.trim() && afterImage.trim()) && (
                      <div className="col-span-2">
                        <button
                          type="button"
                          onClick={() => setShowBeforeAfterDialog(true)}
                          className="w-full px-3 py-2 rounded-lg border border-emerald-500/50 text-emerald-300 hover:bg-emerald-500/10 transition-colors text-sm font-medium"
                        >
                          Abrir comparador Antes/Depois (slider)
                        </button>
                      </div>
                    )}
                  <div>
                    <span className="text-slate-400 text-sm block mb-2">Desenhar polígono (intensidade F)</span>
                    <div className="flex flex-wrap gap-2 items-center">
                      <select
                        value={drawIntensity}
                        onChange={(e) => setDrawIntensity(e.target.value as FScale)}
                        className="bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm"
                      >
                        {F_SCALE_ORDER.map((f) => (
                          <option key={f} value={f}>{f}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => setDrawMode((v) => !v)}
                        className={`px-3 py-2 rounded-lg text-sm font-medium ${drawMode ? 'bg-amber-600 text-white' : 'bg-slate-700 text-slate-200'}`}
                      >
                        {drawMode ? 'Clique no mapa' : `Desenhar ${drawIntensity}`}
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {polygons.map((p) => (
                      <span key={p.intensity} className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-800 border border-slate-600 text-sm">
                        <span className="font-mono" style={{ color: TORNADO_TRACK_COLORS[p.intensity] }}>{p.intensity}</span>
                        <button type="button" onClick={() => removePolygon(p.intensity)} className="text-slate-400 hover:text-red-400">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="border-t border-slate-600 pt-4 mt-4">
                    <span className="text-slate-400 text-sm block mb-2">Overlays Prevots (níveis 1–4)</span>
                    <p className="text-slate-500 text-xs mb-2">
                      Polígonos recortados automaticamente aos limites do Brasil. Nível 1 por baixo, nível 4 (magenta) por cima.
                    </p>
                    <div className="flex flex-wrap gap-2 items-center mb-2">
                      <select
                        value={drawPrevotsLevel}
                        onChange={(e) => setDrawPrevotsLevel(Number(e.target.value) as PrevotsLevel)}
                        className="bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm"
                      >
                        {PREVOTS_LEVEL_ORDER.filter((lvl) => lvl !== 0).map((lvl) => (
                          <option key={lvl} value={lvl}>Nível {lvl}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => setDrawPrevotsMode((v) => !v)}
                        disabled={!brazilBoundary}
                        title={!brazilBoundary ? 'Aguardando carregamento do limite do Brasil…' : undefined}
                        className={`px-3 py-2 rounded-lg text-sm font-medium ${drawPrevotsMode ? 'bg-amber-600 text-white' : 'bg-slate-700 text-slate-200'} disabled:opacity-50`}
                      >
                        {drawPrevotsMode ? 'Desenhando (clique aqui para sair)' : `Desenhar nível ${drawPrevotsLevel}`}
                      </button>
                      {!brazilBoundary && <span className="text-xs text-slate-500">Carregando Brasil…</span>}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {prevotsPolygons.map((p, idx) => (
                        <span key={`${p.level}-${idx}`} className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-800 border border-slate-600 text-sm">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: PREVOTS_LEVEL_COLORS[p.level] }} />
                          <span>{p.level === 0 ? 'Tempestades' : `Nível ${p.level}`}</span>
                          <button type="button" onClick={() => removePrevotsPolygonAtIndex(idx)} className="text-slate-400 hover:text-red-400">
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  <div className="flex flex-wrap gap-2 pt-2">
                    <button type="button" onClick={handleSave} disabled={saving} className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium flex items-center gap-2">
                      {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                      {editingId ? 'Atualizar' : 'Criar'}
                    </button>
                    <button type="button" onClick={resetForm} className="px-3 py-2 rounded-lg text-slate-400 hover:text-white border border-slate-600 hover:border-slate-500">
                      Cancelar
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

    </div>
  );
}
