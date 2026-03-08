'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import intersect from '@turf/intersect';
import { polygon as turfPolygon } from '@turf/helpers';
import { useAuth } from '../contexts/AuthContext';
import { saveReport, fetchReports } from '../lib/bswcStore';
import { MAP_STYLE_DARK } from '../lib/constants';
import type { BswcHazard, BswcSeverity, BswcForecastFeature } from '../lib/types';

declare const google: any;

const BRASIL_GEOJSON_URL = 'https://cdn.jsdelivr.net/gh/LucasMouraChaser/brasilunificado@main/brasilunificado.geojson';

type BrazilPolygonFeature = { type: 'Feature'; geometry: { type: 'Polygon'; coordinates: number[][][] }; properties?: object };
/** Brasil pode ser um único polígono ou várias partes (MultiPolygon); guardamos array para interseção com todas. */
type BrazilForClip = BrazilPolygonFeature[];

/** Brasil: lng -75 a -34, lat -34 a 5. Se o primeiro valor estiver nesses lat e o segundo em lng, está [lat,lng] e precisamos trocar para [lng,lat]. */
function normalizeToLngLat(ring: number[][]): number[][] {
  if (!ring.length) return ring;
  const [a, b] = ring[0];
  const looksLikeLat = a >= -35 && a <= 6;
  const looksLikeLng = b >= -76 && b <= -33;
  if (looksLikeLat && looksLikeLng) return ring.map(([x, y]) => [y, x]);
  return ring;
}

/** Extrai o(s) polígono(s) do GeoJSON do Brasil. Normaliza coordenadas para [lng, lat] e suporta várias features/partes. */
function getBrazilPolygons(geojson: any): BrazilForClip | null {
  if (!geojson?.features?.length) return null;
  const parts: BrazilPolygonFeature[] = [];
  for (const f of geojson.features) {
    const geom = f?.geometry;
    if (!geom) continue;
    if (geom.type === 'Polygon' && Array.isArray(geom.coordinates?.[0])) {
      const ring = normalizeToLngLat(geom.coordinates[0]);
      parts.push(turfPolygon([ring]) as unknown as BrazilPolygonFeature);
    } else if (geom.type === 'MultiPolygon' && Array.isArray(geom.coordinates)) {
      for (const ring of geom.coordinates) {
        if (ring?.[0]?.length) {
          const normalized = normalizeToLngLat(ring[0]);
          parts.push(turfPolygon([normalized]) as unknown as BrazilPolygonFeature);
        }
      }
    }
  }
  return parts.length ? parts : null;
}

/** Verifica se o ponto [lng, lat] está dentro do polígono (anel fechado [lng,lat][]). Ray casting. */
function pointInPolygon(point: number[], ring: number[][]): boolean {
  const [x, y] = point;
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Inverte o anel (mantém fechado). Útil quando o desenho está em ordem que o Turf rejeita. */
function reverseRing(ring: number[][]): number[][] {
  if (ring.length <= 2) return ring;
  const first = ring[0];
  const middle = ring.slice(1, -1).reverse();
  return [first, ...middle, first];
}

/** Recorta um polígono (anel [lng,lat][]) ao limite do Brasil. Usa todas as partes do Brasil (MultiPolygon). Retorna anel recortado ou null. */
function clipPolygonToBrazil(
  ring: number[][],
  brazilParts: BrazilForClip | null
): number[][] | null {
  if (!ring.length || !brazilParts?.length) return null;
  const runOne = (r: number[][], brazilFeature: BrazilPolygonFeature): number[][] | null => {
    try {
      const poly = turfPolygon([r]);
      const result = intersect(poly as any, brazilFeature as any);
      if (!result?.geometry) return null;
      const g = result.geometry as { type: string; coordinates: number[][][] | number[][][][] };
      if (g.type === 'Polygon' && g.coordinates?.[0]?.length >= 3) return g.coordinates[0] as number[][];
      if (g.type === 'MultiPolygon' && Array.isArray(g.coordinates) && g.coordinates.length) {
        const first = (g.coordinates as number[][][][]).find((c) => c[0]?.length >= 3);
        return first ? (first[0] as number[][]) : null;
      }
      return null;
    } catch {
      return null;
    }
  };
  const run = (r: number[][]): number[][] | null => {
    for (const part of brazilParts) {
      const clipped = runOne(r, part);
      if (clipped) return clipped;
    }
    return null;
  };
  let clipped: number[][] | null = run(ring);
  if (!clipped && ring.length >= 3) clipped = run(reverseRing(ring));
  // Fallback: se o Turf.intersect falhar mas algum vértice estiver dentro do Brasil, aceitar o polígono (evita rejeitar quando o desenho claramente cruza o Brasil)
  if (!clipped && ring.length >= 3) {
    const uniquePoints = ring.length > 0 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
      ? ring.slice(0, -1) : ring;
    for (const pt of uniquePoints) {
      for (const part of brazilParts) {
        const partRing = part.geometry.coordinates[0];
        if (partRing?.length >= 3 && pointInPolygon(pt, partRing)) {
          return ring;
        }
      }
    }
  }
  return clipped;
}

// Cores por nível (1–4) – alinhado ao HTML BSWC (PREV 1–4)
const LEVEL_COLORS: Record<number, string> = {
  1: '#90EE90', // Verde claro - PREV 1
  2: '#FFA500', // Laranja - PREV 2
  3: '#FF0000', // Vermelho - PREV 3
  4: '#800080', // Roxo - PREV 4
};

const HAZARD_LABELS: Record<string, string> = {
  granizo: 'Granizo',
  vento: 'Vento',
  tornado: 'Tornado',
};

const REPORT_LEGEND_ITEMS: Array<{ key: string; label: string; icon: string }> = [
  { key: 'vento|NOR', label: 'Ventos 80–100 km/h', icon: 'https://static.wixstatic.com/media/c003a9_38c6ec164e3742dab2237816e4ff8c95~mv2.png' },
  { key: 'vento|SS', label: 'Ventos > 100 km/h', icon: 'https://static.wixstatic.com/media/c003a9_3fc6c303cb364c5db3595e4203c1888e~mv2.png' },
  { key: 'granizo|NOR', label: 'Granizo < 4 cm', icon: 'https://static.wixstatic.com/media/c003a9_70be04c630a64abca49711a423da779b~mv2.png' },
  { key: 'granizo|SS', label: 'Granizo ≥ 4 cm', icon: 'https://static.wixstatic.com/media/c003a9_946684b74c234c2287a153a6b6c077fe~mv2.png' },
  { key: 'tornado|NOR', label: 'Tornado < Ef2', icon: 'https://static.wixstatic.com/media/c003a9_9f22188e065e4424a1f8ee3a3afeffde~mv2.png' },
  { key: 'tornado|SS', label: 'Tornado ≥ Ef2', icon: 'https://static.wixstatic.com/media/c003a9_3a647b1160024b55bb3ecc148df1309f~mv2.png' },
];

export type BswcPrevisaoMapProps = {
  hazard: BswcHazard;
  prob: number;
  level: number;
  polygons: BswcForecastFeature[];
  reports: Array<{
    type: 'Feature';
    geometry: { type: 'Point'; coordinates: [number, number] };
    properties: { hazard: string; sev: string };
  }>;
  onPolygonsChange: (polygons: BswcForecastFeature[]) => void;
  canEdit: boolean;
  viewMode: 'all' | 'overall';
  onValidationError: (msg: string | null) => void;
};

/** Mapa de previsão BSWC: desenha polígonos, relatos, legendas e desenho de polígonos */
export function BswcPrevisaoMap({
  hazard,
  prob,
  level,
  polygons,
  reports,
  onPolygonsChange,
  canEdit,
  onValidationError,
}: BswcPrevisaoMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const polygonsRef = useRef<any[]>([]);
  const markersRef = useRef<any[]>([]);
  const drawingManagerRef = useRef<any>(null);
  const [mapReady, setMapReady] = useState(false);
  const [drawMode, setDrawMode] = useState(false);
  const [brazilBoundary, setBrazilBoundary] = useState<BrazilForClip | null>(null);
  const brazilBoundaryRef = useRef<BrazilForClip | null>(null);
  // Refs para não recriar o DrawingManager a cada re-render do pai (evita parar o desenho no meio)
  const onPolygonsChangeRef = useRef(onPolygonsChange);
  const onValidationErrorRef = useRef(onValidationError);
  const polygonsRefLatest = useRef(polygons);
  const hazardRef = useRef(hazard);
  const levelRef = useRef(level);
  onPolygonsChangeRef.current = onPolygonsChange;
  onValidationErrorRef.current = onValidationError;
  polygonsRefLatest.current = polygons;
  hazardRef.current = hazard;
  levelRef.current = level;
  brazilBoundaryRef.current = brazilBoundary;

  useEffect(() => {
    fetch(BRASIL_GEOJSON_URL)
      .then((r) => r.json())
      .then((geojson) => {
        const parts = getBrazilPolygons(geojson);
        setBrazilBoundary(parts);
      })
      .catch((err) => console.error('Erro ao carregar contorno do Brasil:', err));
  }, []);

  useEffect(() => {
    let isMounted = true;
    const initMap = async () => {
      if (!mapRef.current) return;
      try {
        const { Map } = await google.maps.importLibrary('maps');
        await google.maps.importLibrary('marker');
        if (!isMounted) return;
        const map = new Map(mapRef.current, {
          center: { lat: -25, lng: -52 },
          zoom: 4,
          disableDefaultUI: true,
          zoomControl: true,
          styles: MAP_STYLE_DARK,
        });
        mapInstanceRef.current = map;
        setMapReady(true);
      } catch (err) {
        console.error('BswcPrevisaoMap init error', err);
      }
    };
    initMap();
    return () => { isMounted = false; };
  }, []);

  // Desenhar polígonos (GeoJSON: coordinates[0] = anel externo, [lng, lat]); recortados ao Brasil e cores = legenda
  useEffect(() => {
    if (!mapInstanceRef.current || !mapReady) return;
    polygonsRef.current.forEach((p) => p.setMap(null));
    polygonsRef.current = [];
    polygons.forEach((feat) => {
      const coords = feat.geometry?.coordinates?.[0];
      if (!coords?.length) return;
      const lvl = feat.properties?.level ?? 1;
      const color = LEVEL_COLORS[lvl] ?? '#90EE90';
      let ring: number[][] = coords;
      if (brazilBoundary) {
        const clipped = clipPolygonToBrazil(coords, brazilBoundary);
        if (clipped && clipped.length >= 3) ring = clipped;
      }
      const path = ring.map(([lng, lat]) => ({ lat, lng }));
      const polygon = new google.maps.Polygon({
        paths: path,
        strokeColor: color,
        strokeWeight: 2,
        fillColor: color,
        fillOpacity: 0.4,
        map: mapInstanceRef.current,
        editable: false,
      });
      polygonsRef.current.push(polygon);
    });
  }, [polygons, mapReady, brazilBoundary]);

  // Desenhar marcadores de relatos (com ícones do BSWC)
  useEffect(() => {
    if (!mapInstanceRef.current || !mapReady) return;
    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];
    const REPORT_ICONS: Record<string, string> = {
      'vento|NOR': 'https://static.wixstatic.com/media/c003a9_38c6ec164e3742dab2237816e4ff8c95~mv2.png',
      'vento|SS': 'https://static.wixstatic.com/media/c003a9_3fc6c303cb364c5db3595e4203c1888e~mv2.png',
      'granizo|NOR': 'https://static.wixstatic.com/media/c003a9_70be04c630a64abca49711a423da779b~mv2.png',
      'granizo|SS': 'https://static.wixstatic.com/media/c003a9_946684b74c234c2287a153a6b6c077fe~mv2.png',
      'tornado|NOR': 'https://static.wixstatic.com/media/c003a9_9f22188e065e4424a1f8ee3a3afeffde~mv2.png',
      'tornado|SS': 'https://static.wixstatic.com/media/c003a9_3a647b1160024b55bb3ecc148df1309f~mv2.png',
    };
    reports.forEach((r) => {
      const [lng, lat] = r.geometry.coordinates;
      const key = `${(r.properties.hazard || 'vento').toLowerCase()}|${(r.properties.sev || 'NOR').toUpperCase()}`;
      const iconUrl = REPORT_ICONS[key] || REPORT_ICONS['vento|NOR'];
      const marker = new google.maps.Marker({
        position: { lat, lng },
        map: mapInstanceRef.current,
        icon: { url: iconUrl, scaledSize: new google.maps.Size(20, 20), anchor: new google.maps.Point(10, 10) },
      });
      markersRef.current.push(marker);
    });
  }, [reports, mapReady]);

  // DrawingManager só quando canEdit e drawMode; sem dep de polygons/callbacks para não destruir no meio do desenho
  useEffect(() => {
    if (!mapInstanceRef.current || !mapReady || !canEdit || !drawMode) {
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
        const color = LEVEL_COLORS[levelRef.current] || '#90EE90';
        const manager = new DrawingManager({
          map: mapInstanceRef.current,
          drawingMode: OverlayType.POLYGON,
          drawingControl: false,
          polygonOptions: {
            fillColor: color,
            fillOpacity: 0.35,
            strokeColor: color,
            strokeWeight: 2,
            clickable: true,
            editable: false,
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
          if (coords.length < 3) return;
          const first = coords[0];
          const last = coords[coords.length - 1];
          if (last[0] !== first[0] || last[1] !== first[1]) coords.push([...first]);
          const brazil = brazilBoundaryRef.current;
          let finalCoords = coords;
          if (brazil) {
            const clipped = clipPolygonToBrazil(coords, brazil);
            if (!clipped || clipped.length < 3) {
              onValidationErrorRef.current?.('Nenhuma parte do polígono está dentro do Brasil. O mapa considera apenas a área que passar pelo território brasileiro — desenhe de forma que pelo menos parte corte o Brasil.');
              e.overlay.setMap(null);
              return;
            }
            const last = clipped[clipped.length - 1];
            const first = clipped[0];
            finalCoords = (last[0] === first[0] && last[1] === first[1]) ? clipped : [...clipped, first];
          }
          const currentPolygons = polygonsRefLatest.current;
          const currentHazard = hazardRef.current;
          const currentLevel = levelRef.current;
          const newFeature: BswcForecastFeature = {
            type: 'Feature',
            geometry: { type: 'Polygon', coordinates: [finalCoords] },
            properties: { dia: 'd0', type: currentHazard, level: currentLevel },
          };
          onPolygonsChangeRef.current([...currentPolygons, newFeature]);
          onValidationErrorRef.current?.(null);
          e.overlay.setMap(null);
          setDrawMode(false);
          if (drawingManagerRef.current) {
            drawingManagerRef.current.setDrawingMode(null);
            drawingManagerRef.current.setMap(null);
            drawingManagerRef.current = null;
          }
        });
        drawingManagerRef.current = manager;
      } catch (err) {
        console.error('DrawingManager init error', err);
        onValidationErrorRef.current?.('Não foi possível ativar o desenho.');
      }
    };
    initDrawing();
    return () => {
      if (drawingManagerRef.current) {
        drawingManagerRef.current.setMap(null);
        drawingManagerRef.current = null;
      }
    };
  }, [mapReady, canEdit, drawMode]);

  const probs = hazard === 'tornado' ? [2, 5, 10, 15] : [5, 15, 30, 45];
  const hazardLabel = HAZARD_LABELS[hazard] || hazard;

  return (
    <div className="relative w-full h-full min-h-[400px]">
      <div ref={mapRef} className="absolute inset-0 w-full h-full" />
      {/* Botão Desenhar polígono (só quando pode editar e não está vendo previsão feita) */}
      {canEdit && (
        <div className="absolute top-2 left-2 z-10">
          <button
            type="button"
            onClick={() => setDrawMode((v) => !v)}
            className={`px-3 py-2 rounded text-sm font-medium shadow-lg ${drawMode ? 'bg-amber-500 text-black' : 'bg-slate-700 text-white hover:bg-slate-600'}`}
          >
            {drawMode ? '✏️ Clique no mapa para desenhar' : '✏️ Desenhar polígono'}
          </button>
        </div>
      )}
      {/* Legenda Relatos – canto inferior esquerdo */}
      <div className="absolute bottom-2 left-2 z-10 bg-[#262626] border border-[#555] rounded shadow-lg p-2 text-xs text-slate-200 max-w-[200px]">
        <div className="font-semibold mb-1">Relatos</div>
        {REPORT_LEGEND_ITEMS.map((item) => (
          <div key={item.key} className="flex items-center gap-1.5 py-0.5">
            <img src={item.icon} alt="" width={16} height={16} className="flex-shrink-0" />
            <span>{item.label}</span>
          </div>
        ))}
      </div>
      {/* Legenda Probabilidades – canto inferior direito */}
      <div className="absolute bottom-2 right-2 z-10 bg-[#262626] border border-[#555] rounded shadow-lg p-2 text-xs text-slate-200">
        <div className="font-semibold mb-1">Probabilidades ({hazardLabel})</div>
        {probs.map((p) => {
          const lvl = hazard === 'tornado' ? ({ 2: 1, 5: 2, 10: 3, 15: 4 } as Record<number, number>)[p] : ({ 5: 1, 15: 2, 30: 3, 45: 4 } as Record<number, number>)[p];
          const color = LEVEL_COLORS[lvl] ?? '#888';
          return (
            <div key={p} className="flex items-center gap-1.5 py-0.5">
              <span className="inline-block w-3 h-3 rounded-sm border border-black/25 flex-shrink-0" style={{ backgroundColor: color }} />
              <span>{p}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const REPORT_ICONS: Record<string, string> = {
  'vento|NOR': 'https://static.wixstatic.com/media/c003a9_38c6ec164e3742dab2237816e4ff8c95~mv2.png',
  'vento|SS': 'https://static.wixstatic.com/media/c003a9_3fc6c303cb364c5db3595e4203c1888e~mv2.png',
  'granizo|NOR': 'https://static.wixstatic.com/media/c003a9_70be04c630a64abca49711a423da779b~mv2.png',
  'granizo|SS': 'https://static.wixstatic.com/media/c003a9_946684b74c234c2287a153a6b6c077fe~mv2.png',
  'tornado|NOR': 'https://static.wixstatic.com/media/c003a9_9f22188e065e4424a1f8ee3a3afeffde~mv2.png',
  'tornado|SS': 'https://static.wixstatic.com/media/c003a9_3a647b1160024b55bb3ecc148df1309f~mv2.png',
};

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function BswcRelatosPage() {
  const { user } = useAuth();
  const router = useRouter();
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);

  const [dateISO, setDateISO] = useState(todayISO());
  const [hazard, setHazard] = useState<BswcHazard>('vento');
  const [sev, setSev] = useState<BswcSeverity>('NOR');
  const [showDlg, setShowDlg] = useState(false);
  const [pendingLat, setPendingLat] = useState(0);
  const [pendingLng, setPendingLng] = useState(0);
  const [selHour, setSelHour] = useState('12');
  const [selMin, setSelMin] = useState('00');
  const [loading, setLoading] = useState(false);
  const [reports, setReports] = useState<
    Array<{ lat: number; lng: number; hazard: string; sev: string }>
  >([]);

  const loadReports = async () => {
    const feats = await fetchReports(dateISO);
    setReports(
      feats.map((f) => ({
        lat: f.geometry.coordinates[1],
        lng: f.geometry.coordinates[0],
        hazard: f.properties.hazard,
        sev: f.properties.sev,
      }))
    );
  };

  useEffect(() => {
    if (!user || (user.type !== 'admin' && user.type !== 'superadmin')) {
      router.push('/');
      return;
    }
    loadReports();
  }, [user, router, dateISO]);

  useEffect(() => {
    let isMounted = true;

    const initMap = async () => {
      if (!mapRef.current) return;
      try {
        const { Map } = await google.maps.importLibrary('maps');
        await google.maps.importLibrary('marker');

        const map = new Map(mapRef.current, {
          center: { lat: -25, lng: -52 },
          zoom: 4,
          disableDefaultUI: true,
          zoomControl: true,
          styles: MAP_STYLE_DARK,
        });

        map.addListener('click', (e: any) => {
          if (!e.latLng) return;
          const lat = e.latLng.lat();
          const lng = e.latLng.lng();
          setPendingLat(lat);
          setPendingLng(lng);
          const now = new Date();
          setSelHour(String(now.getHours()).padStart(2, '0'));
          setSelMin(String(now.getMinutes()).padStart(2, '0'));
          setShowDlg(true);
        });

        mapInstanceRef.current = map;
      } catch (err) {
        console.error('Map init error', err);
      }
    };

    initMap();
    return () => { isMounted = false; };
  }, []);

  useEffect(() => {
    if (!mapInstanceRef.current) return;

    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];

    reports.forEach((r) => {
      const key = `${r.hazard}|${r.sev}`;
      const iconUrl = REPORT_ICONS[key] || REPORT_ICONS['vento|NOR'];
      const marker = new google.maps.Marker({
        position: { lat: r.lat, lng: r.lng },
        map: mapInstanceRef.current,
        icon: { url: iconUrl, scaledSize: new google.maps.Size(20, 20) },
      });
      markersRef.current.push(marker);
    });
  }, [reports]);

  const handleConfirm = async () => {
    setLoading(true);
    try {
      const hora = `${selHour}:${selMin}:00`;
      await saveReport({
        dateISO,
        hazard,
        sev,
        lat: pendingLat,
        lon: pendingLng,
        hora,
        autor: 'admin',
      });
      setShowDlg(false);
      await loadReports();
    } catch (e) {
      console.error(e);
      alert('Erro ao salvar relato.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col">
      <header className="flex items-center justify-between p-4 bg-slate-900/80 border-b border-slate-700">
        <Link href="/previsao" className="inline-flex items-center gap-2 text-slate-400 hover:text-white">
          <ChevronLeft /> Voltar
        </Link>
        <h1 className="text-lg font-bold">Lançar relatos (Admin)</h1>
      </header>

      <div className="flex flex-wrap gap-3 p-4 bg-slate-900/60 border-b border-slate-700">
        <label className="flex items-center gap-2">
          Data:
          <input
            type="date"
            value={dateISO}
            onChange={(e) => setDateISO(e.target.value)}
            className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm"
          />
        </label>
        <label className="flex items-center gap-2">
          Perigo:
          <select
            value={hazard}
            onChange={(e) => setHazard(e.target.value as BswcHazard)}
            className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm"
          >
            <option value="granizo">Granizo</option>
            <option value="vento">Vento</option>
            <option value="tornado">Tornado</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          Intensidade:
          <select
            value={sev}
            onChange={(e) => setSev(e.target.value as BswcSeverity)}
            className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm"
          >
            <option value="NOR">Normal</option>
            <option value="SS">Significativo</option>
          </select>
        </label>
        <p className="text-slate-400 text-sm">Clique no mapa para adicionar relato</p>
      </div>

      <div className="flex-1 p-4">
        <div ref={mapRef} className="w-full h-[calc(100vh-180px)] min-h-[400px] rounded-lg" />
      </div>

      {showDlg && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-slate-800 rounded-lg p-6 w-full max-w-sm border border-slate-600">
            <h3 className="font-semibold mb-4">Confirmar relato</h3>
            <p className="text-sm text-slate-400 mb-2">
              Lat: {pendingLat.toFixed(4)} | Lon: {pendingLng.toFixed(4)}
            </p>
            <label className="block mb-2">
              Hora (UTC):
              <div className="flex gap-2 mt-1">
                <select
                  value={selHour}
                  onChange={(e) => setSelHour(e.target.value)}
                  className="bg-slate-700 border border-slate-600 rounded px-2 py-1 flex-1"
                >
                  {Array.from({ length: 24 }, (_, i) => (
                    <option key={i} value={String(i).padStart(2, '0')}>
                      {String(i).padStart(2, '0')}
                    </option>
                  ))}
                </select>
                <select
                  value={selMin}
                  onChange={(e) => setSelMin(e.target.value)}
                  className="bg-slate-700 border border-slate-600 rounded px-2 py-1 flex-1"
                >
                  {Array.from({ length: 60 }, (_, i) => (
                    <option key={i} value={String(i).padStart(2, '0')}>
                      {String(i).padStart(2, '0')}
                    </option>
                  ))}
                </select>
              </div>
            </label>
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setShowDlg(false)}
                className="flex-1 py-2 bg-slate-600 hover:bg-slate-500 rounded"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirm}
                disabled={loading}
                className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded font-medium"
              >
                {loading ? 'Salvando…' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
