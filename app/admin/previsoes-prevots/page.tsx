'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { ChevronLeft, ChevronRight, Trash2, Edit, Loader2, PlusCircle, X, Calendar, Layers, Check } from 'lucide-react';
import { MAP_STYLE_DARK } from '@/lib/constants';
import {
  fetchPrevotsForecasts,
  savePrevotsForecast,
  deletePrevotsForecast,
  type PrevotsForecastInput,
} from '@/lib/prevotsForecastStore';
import {
  PREVOTS_LEVEL_COLORS,
  PREVOTS_LEVEL_ORDER,
  type PrevotsForecast,
  type PrevotsPolygon,
} from '@/lib/prevotsForecastData';
import type { PrevotsLevel } from '@/lib/tornadoTracksData';
import { BRASIL_GEOJSON_URL, getBrazilPolygons, clipPolygonToBrazil, type BrazilForClip } from '@/lib/brazilClip';

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

function getStaticMapPreviewUrl(maptype: string): string {
  const key = typeof process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY === 'string'
    ? process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
    : '';
  if (!key || key.startsWith('COLE_SUA')) return '';
  return `https://maps.googleapis.com/maps/api/staticmap?center=-14,-52&zoom=4&size=180x120&maptype=${maptype}&key=${key}`;
}

export default function AdminPrevisoesPrevotsPage() {
  const { user } = useAuth();
  const { addToast } = useToast();
  const router = useRouter();
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const drawingManagerRef = useRef<any>(null);
  const forecastPolygonsOnMapRef = useRef<any[]>([]);
  const editingPolygonsOnMapRef = useRef<any[]>([]);

  const [mapReady, setMapReady] = useState(false);
  const [forecasts, setForecasts] = useState<PrevotsForecast[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [forecastDate, setForecastDate] = useState('');
  const [polygons, setPolygons] = useState<PrevotsPolygon[]>([]);
  const [drawMode, setDrawMode] = useState(false);
  const [drawLevel, setDrawLevel] = useState<PrevotsLevel>(1);
  const [xUrl, setXUrl] = useState('');
  const [instagramUrl, setInstagramUrl] = useState('');
  const [brazilBoundary, setBrazilBoundary] = useState<BrazilForClip | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [baseMapId, setBaseMapId] = useState<BaseMapId>('satellite');
  const [showBaseMapGallery, setShowBaseMapGallery] = useState(false);
  /** ID da previsão exibida no mapa. null = mapa em branco. Define ao clicar no card ou no calendário. */
  const [selectedForecastId, setSelectedForecastId] = useState<string | null>(null);
  /** Data selecionada no calendário "Ver previsão do dia" (para manter o valor mesmo quando não há previsão) */
  const [calendarViewDate, setCalendarViewDate] = useState('');

  const loadForecasts = async () => {
    setLoading(true);
    try {
      const list = await fetchPrevotsForecasts();
      setForecasts(list);
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
    loadForecasts();
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
          styles: [],
        });
        mapInstanceRef.current = map;
        setMapReady(true);
      } catch (err) {
        console.error(err);
      }
    };
    initMap();
    return () => {
      isMounted = false;
      mapInstanceRef.current = null;
      setMapReady(false);
    };
  }, []);

  useEffect(() => {
    fetch(BRASIL_GEOJSON_URL)
      .then((r) => r.json())
      .then((data) => setBrazilBoundary(getBrazilPolygons(data)))
      .catch((e) => console.warn('Falha ao carregar limite do Brasil:', e));
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

  // Desenhar previsões no mapa — APENAS quando uma previsão está selecionada (clique no card ou calendário). null = mapa em branco.
  useEffect(() => {
    if (!mapInstanceRef.current || !mapReady) return;
    forecastPolygonsOnMapRef.current.forEach((p) => p.setMap(null));
    forecastPolygonsOnMapRef.current = [];
    if (!selectedForecastId) return;
    const f = forecasts.find((x) => x.id === selectedForecastId);
    if (!f || f.id === editingId) return;
    const map = mapInstanceRef.current;
    (f.polygons ?? [])
      .filter((p) => p.level !== 0)
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
        gPoly.addListener('click', () => handleEdit(f));
        forecastPolygonsOnMapRef.current.push(gPoly);
      });
    return () => {
      forecastPolygonsOnMapRef.current.forEach((p) => p.setMap(null));
      forecastPolygonsOnMapRef.current = [];
    };
  }, [mapReady, forecasts, selectedForecastId, editingId]);

  // Desenhar polígonos da previsão em edição
  useEffect(() => {
    if (!mapInstanceRef.current || !mapReady) return;
    editingPolygonsOnMapRef.current.forEach((p) => p.setMap(null));
    editingPolygonsOnMapRef.current = [];
    if (!panelOpen) return;
    const map = mapInstanceRef.current;
    [...polygons]
      .filter((p) => p.level !== 0)
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
        });
        editingPolygonsOnMapRef.current.push(gPoly);
      });
  }, [mapReady, polygons, panelOpen]);

  // DrawingManager para desenhar polígonos Prevots
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
        const drawingLib = (await google.maps.importLibrary('drawing')) as {
          DrawingManager: any;
          OverlayType: { POLYGON: string };
        };
        const { DrawingManager, OverlayType } = drawingLib;
        const color = PREVOTS_LEVEL_COLORS[drawLevel];
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
          if (!brazilBoundary) {
            addToast('Aguardando carregamento do limite do Brasil. Tente novamente em instantes.', 'error');
            return;
          }
          const clipped = clipPolygonToBrazil(coords, brazilBoundary);
          if (!clipped || clipped.length < 3) {
            addToast('Polígono fora dos limites do Brasil ou inválido após recorte.', 'error');
            return;
          }
          const closedRing = [...clipped];
          if (
            closedRing[0][0] !== closedRing[closedRing.length - 1][0] ||
            closedRing[0][1] !== closedRing[closedRing.length - 1][1]
          ) {
            closedRing.push([...closedRing[0]]);
          }
          setPolygons((prev) =>
            [...prev, { level: drawLevel, coordinates: [closedRing] }].sort((a, b) => a.level - b.level)
          );
          addToast(`Polígono nível ${drawLevel} adicionado (recortado ao Brasil). Desenhe outro ou clique fora para sair.`, 'success');
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
  }, [mapReady, drawMode, drawLevel, brazilBoundary, addToast]);

  const resetForm = () => {
    setEditingId(null);
    setForecastDate('');
    setPolygons([]);
    setDrawMode(false);
    setPanelOpen(false);
    setXUrl('');
    setInstagramUrl('');
    setSelectedForecastId(null);
  };

  const openNew = () => {
    resetForm();
    setPanelOpen(true);
  };

  const handleViewForecast = (f: PrevotsForecast) => {
    const next = selectedForecastId === f.id ? null : f.id;
    setSelectedForecastId(next);
    if (next) setCalendarViewDate(f.date);
  };

  const handleEdit = (f: PrevotsForecast) => {
    setSelectedForecastId(null);
    setEditingId(f.id);
    setForecastDate(f.date);
    setPolygons(f.polygons?.filter((p) => p.level !== 0) ?? []);
    setXUrl(f.xUrl || '');
    setInstagramUrl(f.instagramUrl || '');
    setDrawMode(false);
    setPanelOpen(true);
  };

  const handleCalendarDateSelect = (date: string) => {
    setCalendarViewDate(date);
    const f = forecasts.find((x) => x.date === date);
    setSelectedForecastId(f ? f.id : null);
  };

  const removePolygonAtIndex = (index: number) => {
    setPolygons((p) => p.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    if (!forecastDate.trim()) {
      addToast('Selecione a data da previsão.', 'error');
      return;
    }
    if (polygons.length === 0) {
      addToast('Desenhe pelo menos um polígono Prevots.', 'error');
      return;
    }
    if (!user?.uid) {
      addToast('Faça login para salvar.', 'error');
      return;
    }
    setSaving(true);
    try {
      const input: PrevotsForecastInput = {
        id: editingId || undefined,
        date: forecastDate.trim(),
        polygons: polygons.filter((p) => p.level !== 0),
        xUrl: xUrl.trim() || undefined,
        instagramUrl: instagramUrl.trim() || undefined,
      };
      await savePrevotsForecast(input, user.uid);
      addToast(editingId ? 'Previsão atualizada.' : 'Previsão criada.', 'success');
      await loadForecasts();
      resetForm();
    } catch (e: any) {
      addToast(`Erro ao salvar: ${e.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Excluir esta previsão?')) return;
    try {
      await deletePrevotsForecast(id);
      addToast('Previsão excluída.', 'success');
      await loadForecasts();
      if (editingId === id) resetForm();
    } catch (e: any) {
      addToast(`Erro ao excluir: ${e.message}`, 'error');
    }
  };

  return (
    <div className="fixed inset-0 flex flex-col bg-slate-950 text-white z-40">
      <header className="flex-shrink-0 flex items-center justify-between gap-3 px-4 py-2 bg-slate-900/90 border-b border-slate-700">
        <div className="flex items-center gap-3">
          <Link href="/admin" className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300">
            <ChevronLeft className="w-5 h-5" />
          </Link>
          <h1 className="text-base font-bold flex items-center gap-2">
            <Layers className="w-5 h-5 text-emerald-400" />
            Previsões Prevots
          </h1>
        </div>
      </header>

      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 min-h-0 relative">
          <div ref={mapRef} className="absolute inset-0 w-full h-full" />
          {/* Galeria de mapa base */}
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
        </div>

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
                title="Expandir"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <span className="text-[10px] text-slate-500 uppercase tracking-wider" style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}>
                Previsões
              </span>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between flex-shrink-0 p-3 border-b border-slate-700">
                <h3 className="font-semibold text-slate-200">Previsões salvas</h3>
                <button
                  type="button"
                  onClick={() => setSidebarCollapsed(true)}
                  className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>
              <div className="flex-shrink-0 p-3 border-b border-slate-700 space-y-3">
                <button
                  type="button"
                  onClick={openNew}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium"
                >
                  <PlusCircle className="w-4 h-4" />
                  Nova previsão
                </button>
                <div>
                  <label className="text-xs text-slate-500 block mb-1">Ver previsão do dia</label>
                  <input
                    type="date"
                    value={selectedForecastId ? forecasts.find((f) => f.id === selectedForecastId)?.date ?? calendarViewDate : calendarViewDate}
                    onChange={(e) => handleCalendarDateSelect(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm"
                  />
                </div>
                {selectedForecastId && (
                  <button
                    type="button"
                    onClick={() => setSelectedForecastId(null)}
                    className="w-full text-xs text-slate-400 hover:text-cyan-300"
                  >
                    Limpar mapa
                  </button>
                )}
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto p-3">
                {loading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="w-8 h-8 animate-spin text-amber-400" />
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {forecasts.map((f) => {
                      const isViewing = selectedForecastId === f.id;
                      return (
                        <li
                          key={f.id}
                          onClick={() => handleViewForecast(f)}
                          className={`flex items-center justify-between gap-2 rounded-lg p-3 border cursor-pointer transition-colors ${
                            isViewing ? 'bg-cyan-900/30 border-cyan-500/50' : 'bg-slate-800/50 border-slate-600 hover:border-slate-500'
                          }`}
                        >
                          <div className="min-w-0 flex items-center gap-2">
                            <Calendar className="w-4 h-4 text-emerald-400 shrink-0" />
                            <span className="font-medium text-white">{f.date}</span>
                            <span className="text-xs text-slate-500">{f.polygons?.length || 0} polígonos</span>
                          </div>
                          <div className="flex gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                            <button
                              onClick={() => handleEdit(f)}
                              className="p-1.5 rounded bg-slate-700 hover:bg-cyan-600 text-cyan-300"
                              title="Editar"
                            >
                              <Edit className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleDelete(f.id)}
                              className="p-1.5 rounded bg-slate-700 hover:bg-red-600 text-red-300"
                              title="Excluir"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {!loading && forecasts.length === 0 && (
                  <p className="text-slate-500 text-sm py-4">
                    Nenhuma previsão. Clique em &quot;Nova previsão&quot; para criar.
                  </p>
                )}
              </div>
            </>
          )}
        </aside>
      </div>

      {panelOpen && (
        <>
          <div className="absolute inset-0 bg-black/50 z-20 pointer-events-none" aria-hidden />
          <div className="absolute top-0 right-0 bottom-0 w-full max-w-md bg-slate-900 border-l border-slate-700 shadow-2xl z-30 flex flex-col animate-in slide-in-from-right duration-200">
            <div className="flex items-center justify-between flex-shrink-0 p-3 border-b border-slate-700">
              <h3 className="font-semibold text-slate-200">
                {editingId ? 'Editar previsão' : 'Nova previsão'}
              </h3>
              <button
                type="button"
                onClick={() => resetForm()}
                className="p-2 text-slate-400 hover:text-white rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
              <p className="text-slate-400 text-xs">
                Selecione a data da previsão e desenhe os polígonos (níveis 1–4). Serão recortados ao Brasil. Exibidos no Modo Ao Vivo.
              </p>
              <label className="block">
                <span className="text-slate-400 block mb-1">Data da previsão</span>
                <input
                  type="date"
                  value={forecastDate}
                  onChange={(e) => setForecastDate(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2"
                />
              </label>

              <div className="grid grid-cols-2 gap-3 mt-4">
                <label className="block">
                  <span className="text-slate-400 block mb-1 text-xs">Link da publicação no X</span>
                  <input
                    type="url"
                    placeholder="https://x.com/..."
                    value={xUrl}
                    onChange={(e) => setXUrl(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm"
                  />
                </label>
                <label className="block">
                  <span className="text-slate-400 block mb-1 text-xs">Link da publicação no Instagram</span>
                  <input
                    type="url"
                    placeholder="https://instagram.com/..."
                    value={instagramUrl}
                    onChange={(e) => setInstagramUrl(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm"
                  />
                </label>
              </div>

              <div className="border-t border-slate-600 pt-4">
                <span className="text-slate-400 text-sm block mb-2">Desenhar polígono (nível)</span>
                <div className="flex flex-wrap gap-2 items-center mb-2">
                  <select
                    value={drawLevel}
                    onChange={(e) => setDrawLevel(Number(e.target.value) as PrevotsLevel)}
                    className="bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm"
                  >
                    {PREVOTS_LEVEL_ORDER.filter((lvl) => lvl !== 0).map((lvl) => (
                      <option key={lvl} value={lvl}>
                        Nível {lvl}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setDrawMode((v) => !v)}
                    disabled={!brazilBoundary}
                    className={`px-3 py-2 rounded-lg text-sm font-medium ${
                      drawMode ? 'bg-amber-600 text-white' : 'bg-slate-700 text-slate-200'
                    } disabled:opacity-50`}
                  >
                    {drawMode ? 'Desenhando (clique aqui para sair)' : `Desenhar nível ${drawLevel}`}
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {polygons.map((p, idx) => (
                    <span
                      key={`${p.level}-${idx}`}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-800 border border-slate-600 text-sm"
                    >
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: PREVOTS_LEVEL_COLORS[p.level] }} />
                      {p.level === 0 ? 'Tempestades' : `Nível ${p.level}`}
                      <button type="button" onClick={() => removePolygonAtIndex(idx)} className="text-slate-400 hover:text-red-400">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex gap-2 pt-4">
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="flex-1 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium flex items-center justify-center gap-2"
                >
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                  {editingId ? 'Atualizar' : 'Criar'}
                </button>
                <button type="button" onClick={resetForm} className="px-3 py-2 rounded-lg text-slate-400 hover:text-white border border-slate-600">
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
