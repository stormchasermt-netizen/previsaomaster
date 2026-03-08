'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { ChevronLeft, Trash2, Edit, Wind, Loader2 } from 'lucide-react';
import { MAP_STYLE_DARK } from '@/lib/constants';
import { fetchTornadoTracks, saveTornadoTrack, deleteTornadoTrack } from '@/lib/tornadoTracksStore';
import {
  TORNADO_TRACK_COLORS,
  F_SCALE_ORDER,
  previousFScale,
  isPolygonWithinRing,
  type TornadoTrack,
  type TornadoDamagePolygon,
  type FScale,
} from '@/lib/tornadoTracksData';

declare const google: any;

const BRAZIL_CENTER = { lat: -14.235, lng: -51.925 };

export default function AdminRastrosTornadosPage() {
  const { user } = useAuth();
  const { addToast } = useToast();
  const router = useRouter();
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const drawingManagerRef = useRef<any>(null);
  const polygonsOnMapRef = useRef<any[]>([]);

  const [tracks, setTracks] = useState<TornadoTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [drawMode, setDrawMode] = useState(false);
  const [drawIntensity, setDrawIntensity] = useState<FScale>('F0');

  const [date, setDate] = useState('');
  const [state, setState] = useState('');
  const [locality, setLocality] = useState('');
  const [description, setDescription] = useState('');
  const [source, setSource] = useState('');
  const [beforeImage, setBeforeImage] = useState('');
  const [afterImage, setAfterImage] = useState('');
  const [polygons, setPolygons] = useState<TornadoDamagePolygon[]>([]);

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
        const { Map } = await google.maps.importLibrary('maps');
        if (!isMounted) return;
        const map = new Map(mapRef.current, {
          center: BRAZIL_CENTER,
          zoom: 4,
          disableDefaultUI: true,
          zoomControl: true,
          styles: MAP_STYLE_DARK,
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

  // Desenhar polígonos já cadastrados no mapa
  useEffect(() => {
    if (!mapInstanceRef.current || !mapReady) return;
    polygonsOnMapRef.current.forEach((p) => p.setMap(null));
    polygonsOnMapRef.current = [];
    const map = mapInstanceRef.current;
    polygons.forEach((poly) => {
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
      });
      polygonsOnMapRef.current.push(gPoly);
    });
  }, [mapReady, polygons]);

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

  const resetForm = () => {
    setEditingId(null);
    setDate('');
    setState('');
    setLocality('');
    setDescription('');
    setSource('');
    setBeforeImage('');
    setAfterImage('');
    setPolygons([]);
    setDrawMode(false);
    setDrawIntensity('F0');
  };

  const handleEdit = (t: TornadoTrack) => {
    setEditingId(t.id);
    setDate(t.date);
    setState(t.state);
    setLocality(t.locality || '');
    setDescription(t.description || '');
    setSource(t.source || '');
    setBeforeImage(t.beforeImage || '');
    setAfterImage(t.afterImage || '');
    setPolygons(t.polygons?.length ? t.polygons : []);
    setDrawMode(false);
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
      await saveTornadoTrack({
        id: editingId || undefined,
        date: date.trim(),
        polygons,
        state: state.trim(),
        locality: locality.trim() || undefined,
        description: description.trim() || undefined,
        source: source.trim() || undefined,
        beforeImage: beforeImage.trim() || undefined,
        afterImage: afterImage.trim() || undefined,
      });
      addToast(editingId ? 'Rastro atualizado.' : 'Rastro criado.', 'success');
      await loadTracks();
      resetForm();
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

  return (
    <div className="min-h-screen bg-slate-950 text-white p-4 pb-24">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link href="/admin" className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300">
            <ChevronLeft className="w-5 h-5" />
          </Link>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Wind className="w-6 h-6 text-amber-400" />
            Rastros de Tornados (Admin) — Escala F
          </h1>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div className="bg-slate-900/60 border border-slate-700 rounded-xl p-4">
            <h2 className="font-semibold text-slate-200 mb-2">
              {editingId ? 'Editar rastro' : 'Novo rastro'}
            </h2>
            <p className="text-slate-400 text-xs mb-4">
              Desenhe os polígonos da menor para a maior intensidade: primeiro F0 (área total), depois F1 dentro de F0, F2 dentro de F1, etc. Escala F (Fujita).
            </p>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <label>
                <span className="text-slate-400 block mb-1">Data (YYYY-MM-DD)</span>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2" />
              </label>
              <label>
                <span className="text-slate-400 block mb-1">Estado</span>
                <input value={state} onChange={(e) => setState(e.target.value)} placeholder="ex: RS" className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2" />
              </label>
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
                <span className="text-slate-400 block mb-1">URL imagem Antes</span>
                <input type="url" value={beforeImage} onChange={(e) => setBeforeImage(e.target.value)} placeholder="https://..." className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2" />
              </label>
              <label className="col-span-2">
                <span className="text-slate-400 block mb-1">URL imagem Depois</span>
                <input type="url" value={afterImage} onChange={(e) => setAfterImage(e.target.value)} placeholder="https://..." className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2" />
              </label>
            </div>
            <div className="mt-4">
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
                  {drawMode ? 'Clique no mapa para desenhar' : `Desenhar ${drawIntensity}`}
                </button>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {polygons.map((p) => (
                <span key={p.intensity} className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-800 border border-slate-600 text-sm">
                  <span className="font-mono" style={{ color: TORNADO_TRACK_COLORS[p.intensity] }}>{p.intensity}</span>
                  <button type="button" onClick={() => removePolygon(p.intensity)} className="text-slate-400 hover:text-red-400">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={handleSave} disabled={saving} className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium flex items-center gap-2">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {editingId ? 'Atualizar' : 'Criar'}
              </button>
              {(editingId || polygons.length > 0) && (
                <button type="button" onClick={resetForm} className="px-3 py-2 rounded-lg text-slate-400 hover:text-white">Cancelar</button>
              )}
            </div>
          </div>
          <div className="rounded-xl overflow-hidden border border-slate-700 h-80">
            <div ref={mapRef} className="w-full h-full" />
          </div>
        </div>

        <div className="bg-slate-900/60 border border-slate-700 rounded-xl p-4">
          <h3 className="font-semibold text-slate-200 mb-3">Rastros cadastrados</h3>
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-8 h-8 animate-spin text-amber-400" /></div>
          ) : (
            <ul className="space-y-2 max-h-[520px] overflow-y-auto">
              {tracks.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-2 bg-slate-800/50 rounded-lg p-3 border border-slate-600">
                  <div className="min-w-0">
                    <span className="font-medium text-white">{t.date}</span>
                    <span className="mx-1 text-slate-500">·</span>
                    <span className="text-slate-400 text-sm">{t.locality || t.state}</span>
                    <div className="flex gap-1 mt-1 flex-wrap">
                      {t.polygons.map((p) => (
                        <span key={p.intensity} className="font-mono text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: TORNADO_TRACK_COLORS[p.intensity] + '30', color: TORNADO_TRACK_COLORS[p.intensity] }}>{p.intensity}</span>
                      ))}
                    </div>
                    {(t.beforeImage && t.afterImage) && <span className="ml-2 text-xs text-emerald-400">Antes/Depois</span>}
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <button onClick={() => handleEdit(t)} className="p-1.5 rounded bg-slate-700 hover:bg-cyan-600 text-cyan-300" title="Editar"><Edit className="w-4 h-4" /></button>
                    <button onClick={() => handleDelete(t.id)} className="p-1.5 rounded bg-slate-700 hover:bg-red-600 text-red-300" title="Excluir"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {!loading && tracks.length === 0 && (
            <p className="text-slate-500 text-sm py-4">Nenhum rastro. Crie um com polígonos F0, F1, etc.</p>
          )}
        </div>
      </div>
    </div>
  );
}
