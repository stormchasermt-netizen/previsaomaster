'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { ChevronLeft, Plus, Trash2, Edit, Wind, Loader2, MapPin } from 'lucide-react';
import { MAP_STYLE_DARK } from '@/lib/constants';
import { fetchTornadoTracks, saveTornadoTrack, deleteTornadoTrack } from '@/lib/tornadoTracksStore';
import { TORNADO_TRACK_COLORS, type TornadoTrack, type TornadoIntensity } from '@/lib/tornadoTracksData';

declare const google: any;

const BRAZIL_CENTER = { lat: -14.235, lng: -51.925 };
const INTENSITIES: TornadoIntensity[] = ['EF0', 'EF1', 'EF2', 'EF3', 'EF4', 'EF5'];

export default function AdminRastrosTornadosPage() {
  const { user } = useAuth();
  const { addToast } = useToast();
  const router = useRouter();
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const polylineRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);

  const [tracks, setTracks] = useState<TornadoTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [drawMode, setDrawMode] = useState(false);

  const [date, setDate] = useState('');
  const [intensity, setIntensity] = useState<TornadoIntensity>('EF1');
  const [state, setState] = useState('');
  const [locality, setLocality] = useState('');
  const [description, setDescription] = useState('');
  const [source, setSource] = useState('');
  const [beforeImage, setBeforeImage] = useState('');
  const [afterImage, setAfterImage] = useState('');
  const [path, setPath] = useState<[number, number][]>([]);

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

  useEffect(() => {
    if (!mapInstanceRef.current || !mapReady) return;
    if (polylineRef.current) {
      polylineRef.current.setMap(null);
      polylineRef.current = null;
    }
    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];
    if (path.length < 2) return;
    const pathMvc = path.map(([lng, lat]) => ({ lat, lng }));
    const color = TORNADO_TRACK_COLORS[intensity] || '#888';
    const polyline = new google.maps.Polyline({
      path: pathMvc,
      strokeColor: color,
      strokeWeight: 4,
      map: mapInstanceRef.current,
    });
    polylineRef.current = polyline;
    path.forEach(([lng, lat]) => {
      const m = new google.maps.Marker({
        position: { lat, lng },
        map: mapInstanceRef.current,
        icon: { path: google.maps.SymbolPath.CIRCLE, scale: 6, fillColor: color, fillOpacity: 1, strokeColor: '#fff', strokeWeight: 1 },
      });
      markersRef.current.push(m);
    });
  }, [mapReady, path, intensity]);

  useEffect(() => {
    if (!mapInstanceRef.current || !mapReady) return;
    const map = mapInstanceRef.current;
    if (!drawMode) {
      google.maps.event.clearListeners(map, 'click');
      return;
    }
    const listener = map.addListener('click', (e: any) => {
      const lat = e.latLng.lat();
      const lng = e.latLng.lng();
      setPath((prev) => [...prev, [lng, lat]]);
    });
    return () => google.maps.event.removeListener(listener);
  }, [mapReady, drawMode]);

  const resetForm = () => {
    setEditingId(null);
    setDate('');
    setIntensity('EF1');
    setState('');
    setLocality('');
    setDescription('');
    setSource('');
    setBeforeImage('');
    setAfterImage('');
    setPath([]);
    setDrawMode(false);
  };

  const handleEdit = (t: TornadoTrack) => {
    setEditingId(t.id);
    setDate(t.date);
    setIntensity(t.intensity);
    setState(t.state);
    setLocality(t.locality || '');
    setDescription(t.description || '');
    setSource(t.source || '');
    setBeforeImage(t.beforeImage || '');
    setAfterImage(t.afterImage || '');
    setPath(t.path.length ? t.path : []);
    setDrawMode(false);
  };

  const handleSave = async () => {
    if (!date.trim() || !state.trim()) {
      addToast('Preencha data e estado.', 'error');
      return;
    }
    if (path.length < 2) {
      addToast('Desenhe o rastro no mapa (mínimo 2 pontos).', 'error');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        id: editingId || undefined,
        date: date.trim(),
        path,
        intensity,
        state: state.trim(),
        locality: locality.trim() || undefined,
        description: description.trim() || undefined,
        source: source.trim() || undefined,
        beforeImage: beforeImage.trim() || undefined,
        afterImage: afterImage.trim() || undefined,
      };
      await saveTornadoTrack(payload);
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
            Rastros de Tornados (Admin)
          </h1>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Form + Map */}
        <div className="space-y-4">
          <div className="bg-slate-900/60 border border-slate-700 rounded-xl p-4">
            <h2 className="font-semibold text-slate-200 mb-4">
              {editingId ? 'Editar rastro' : 'Novo rastro'}
            </h2>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <label>
                <span className="text-slate-400 block mb-1">Data (YYYY-MM-DD)</span>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2"
                />
              </label>
              <label>
                <span className="text-slate-400 block mb-1">Intensidade</span>
                <select
                  value={intensity}
                  onChange={(e) => setIntensity(e.target.value as TornadoIntensity)}
                  className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2"
                >
                  {INTENSITIES.map((i) => (
                    <option key={i} value={i}>{i}</option>
                  ))}
                </select>
              </label>
              <label>
                <span className="text-slate-400 block mb-1">Estado</span>
                <input
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  placeholder="ex: RS"
                  className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2"
                />
              </label>
              <label>
                <span className="text-slate-400 block mb-1">Localidade</span>
                <input
                  value={locality}
                  onChange={(e) => setLocality(e.target.value)}
                  placeholder="ex: Vacaria"
                  className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2"
                />
              </label>
              <label className="col-span-2">
                <span className="text-slate-400 block mb-1">Descrição</span>
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2"
                />
              </label>
              <label className="col-span-2">
                <span className="text-slate-400 block mb-1">Fonte</span>
                <input
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2"
                />
              </label>
              <label className="col-span-2">
                <span className="text-slate-400 block mb-1">URL imagem Antes</span>
                <input
                  type="url"
                  value={beforeImage}
                  onChange={(e) => setBeforeImage(e.target.value)}
                  placeholder="https://..."
                  className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2"
                />
              </label>
              <label className="col-span-2">
                <span className="text-slate-400 block mb-1">URL imagem Depois</span>
                <input
                  type="url"
                  value={afterImage}
                  onChange={(e) => setAfterImage(e.target.value)}
                  placeholder="https://..."
                  className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2"
                />
              </label>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => { setDrawMode((v) => !v); }}
                className={`px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-2 ${drawMode ? 'bg-amber-600 text-white' : 'bg-slate-700 text-slate-200'}`}
              >
                <MapPin className="w-4 h-4" />
                {drawMode ? 'Clique no mapa para adicionar pontos' : 'Desenhar rastro no mapa'}
              </button>
              {path.length > 0 && (
                <button
                  type="button"
                  onClick={() => setPath([])}
                  className="px-3 py-2 rounded-lg text-sm bg-slate-700 text-slate-300 hover:bg-slate-600"
                >
                  Limpar rastro ({path.length} pts)
                </button>
              )}
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium flex items-center gap-2"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {editingId ? 'Atualizar' : 'Criar'}
              </button>
              {(editingId || path.length > 0) && (
                <button type="button" onClick={resetForm} className="px-3 py-2 rounded-lg text-slate-400 hover:text-white">
                  Cancelar
                </button>
              )}
            </div>
          </div>
          <div className="rounded-xl overflow-hidden border border-slate-700 h-64">
            <div ref={mapRef} className="w-full h-full" />
          </div>
        </div>

        {/* List */}
        <div className="bg-slate-900/60 border border-slate-700 rounded-xl p-4">
          <h3 className="font-semibold text-slate-200 mb-3">Rastros cadastrados</h3>
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-8 h-8 animate-spin text-amber-400" /></div>
          ) : (
            <ul className="space-y-2 max-h-[480px] overflow-y-auto">
              {tracks.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-2 bg-slate-800/50 rounded-lg p-3 border border-slate-600">
                  <div className="min-w-0">
                    <span className="font-medium text-white">{t.date}</span>
                    <span className="mx-1 text-slate-500">·</span>
                    <span className="font-mono text-sm" style={{ color: TORNADO_TRACK_COLORS[t.intensity] }}>{t.intensity}</span>
                    <span className="mx-1 text-slate-500">·</span>
                    <span className="text-slate-400 text-sm">{t.locality || t.state}</span>
                    {(t.beforeImage && t.afterImage) && (
                      <span className="ml-2 text-xs text-emerald-400">Antes/Depois</span>
                    )}
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
            <p className="text-slate-500 text-sm py-4">Nenhum rastro. Crie um usando o formulário ao lado.</p>
          )}
        </div>
      </div>
    </div>
  );
}
