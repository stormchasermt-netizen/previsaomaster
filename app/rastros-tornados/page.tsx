'use client';

import React, { useEffect, useRef, useState, useMemo } from 'react';
import Link from 'next/link';
import { ChevronLeft, Info, Wind, Layers, Check } from 'lucide-react';
import { MAP_STYLE_DARK } from '../../lib/constants';
import {
  TORNADO_TRACKS_DEMO,
  TORNADO_TRACK_COLORS,
  F_SCALE_ORDER,
  getTracksYears,
  getTracksIntensities,
  type TornadoTrack,
  type FScale,
} from '../../lib/tornadoTracksData';
import { fetchTornadoTracks } from '../../lib/tornadoTracksStore';
import { BeforeAfterCompare } from '../../components/BeforeAfterCompare';

declare const google: any;

const BRAZIL_CENTER = { lat: -14.235, lng: -51.925 };
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
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const polygonsRef = useRef<any[]>([]);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [tracks, setTracks] = useState<TornadoTrack[]>([]);
  const [tracksLoading, setTracksLoading] = useState(true);
  const [yearFilter, setYearFilter] = useState<string>('');
  const [intensityFilter, setIntensityFilter] = useState<string>('');
  const [selectedTrack, setSelectedTrack] = useState<TornadoTrack | null>(null);
  const [hoveredTrack, setHoveredTrack] = useState<TornadoTrack | null>(null);
  const [baseMapId, setBaseMapId] = useState<BaseMapId>('satellite');
  const [showBaseMapGallery, setShowBaseMapGallery] = useState(false);

  useEffect(() => {
    let isMounted = true;
    fetchTornadoTracks()
      .then((list) => {
        if (isMounted) setTracks(list.length ? list : TORNADO_TRACKS_DEMO);
      })
      .catch(() => {
        if (isMounted) setTracks(TORNADO_TRACKS_DEMO);
      })
      .finally(() => {
        if (isMounted) setTracksLoading(false);
      });
    return () => { isMounted = false; };
  }, []);

  const years = useMemo(() => getTracksYears(tracks), [tracks]);
  const intensities = useMemo(() => getTracksIntensities(tracks), [tracks]);

  const filteredTracks = useMemo(() => {
    return tracks.filter((t) => {
      const trackYear = t.date.slice(0, 4);
      if (yearFilter && trackYear !== yearFilter) return false;
      if (intensityFilter && !t.polygons.some((p) => p.intensity === intensityFilter)) return false;
      return true;
    });
  }, [tracks, yearFilter, intensityFilter]);

  /** Rastro usado para o comparativo antes/depois: hover tem prioridade, depois seleção (se tiver ambas as imagens). */
  const trackForCompare = useMemo(() => {
    const t = hoveredTrack || selectedTrack;
    return t && t.beforeImage && t.afterImage ? t : null;
  }, [hoveredTrack, selectedTrack]);

  useEffect(() => {
    let isMounted = true;
    const initMap = async () => {
      if (!mapRef.current) return;
      try {
        const { Map } = await google.maps.importLibrary('maps');
        if (!isMounted) return;
        const map = new Map(mapRef.current, {
          center: BRAZIL_CENTER,
          zoom: DEFAULT_ZOOM,
          disableDefaultUI: true,
          zoomControl: true,
          mapTypeId: 'satellite',
        });
        mapInstanceRef.current = map;
        setMapReady(true);
      } catch (err) {
        console.error('RastrosTornados init map error', err);
      }
    };
    initMap();
    return () => {
      isMounted = false;
    };
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
    if (!mapInstanceRef.current || !mapReady) return;
    polygonsRef.current.forEach((p) => p.setMap(null));
    polygonsRef.current = [];

    const map = mapInstanceRef.current;
    const addTrackListeners = (obj: any, track: TornadoTrack) => {
      obj.addListener('click', () => setSelectedTrack(track));
      obj.addListener('mouseover', () => {
        if (hoverTimeoutRef.current) {
          clearTimeout(hoverTimeoutRef.current);
          hoverTimeoutRef.current = null;
        }
        setHoveredTrack(track);
      });
      obj.addListener('mouseout', () => {
        hoverTimeoutRef.current = setTimeout(() => setHoveredTrack(null), 200);
      });
    };

    // Desenhar polígonos aninhados (F0 exterior → F5 interior). Escala F.
    filteredTracks.forEach((track) => {
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
            fillOpacity: 0.4,
            map,
            clickable: true,
          });
          addTrackListeners(gPoly, track);
          polygonsRef.current.push(gPoly);
        });
    });

    return () => {
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    };
  }, [mapReady, filteredTracks]);

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-slate-950 text-white overflow-hidden">
      <header className="flex items-center justify-between gap-3 px-4 py-2 bg-slate-900/90 border-b border-slate-700 flex-shrink-0">
        <Link href="/" className="inline-flex items-center gap-2 text-slate-400 hover:text-white flex-shrink-0">
          <ChevronLeft className="w-5 h-5" /> Voltar
        </Link>
        <h1 className="text-base font-bold flex items-center gap-2 truncate min-w-0">
          <Wind className="w-5 h-5 text-amber-400 flex-shrink-0" />
          Rastros de Tornados no Brasil
        </h1>
        <div className="flex flex-wrap items-center justify-end gap-2 flex-shrink-0">
          <label className="flex items-center gap-1.5 text-sm">
            <span className="text-slate-500 hidden sm:inline">Ano:</span>
            <select
              value={yearFilter}
              onChange={(e) => setYearFilter(e.target.value)}
              className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm"
            >
              <option value="">Todos</option>
              {years.map((y) => (
                <option key={y} value={String(y)}>{y}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-sm">
            <span className="text-slate-500 hidden sm:inline">F:</span>
            <select
              value={intensityFilter}
              onChange={(e) => setIntensityFilter(e.target.value)}
              className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm"
            >
              <option value="">Todas</option>
              {intensities.map((i) => (
                <option key={i} value={i}>{i}</option>
              ))}
            </select>
          </label>
          <span className="text-slate-500 text-xs self-center">
            {tracksLoading ? '…' : `${filteredTracks.length}`}
          </span>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* Área do mapa — ocupa todo o espaço restante */}
        <div className="flex-1 min-h-0 min-w-0 relative bg-slate-900/40">
          <div ref={mapRef} className="absolute inset-0 w-full h-full" />
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
                <div className="absolute top-full right-0 mt-1 w-72 rounded-lg border border-slate-600 bg-slate-900 shadow-xl p-3 animate-in fade-in slide-in-from-top-2 duration-150">
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

          {/* Legenda */}
          <div className="absolute bottom-2 left-2 z-10 bg-slate-900/95 border border-slate-600 rounded-lg shadow-lg p-3 text-xs">
            <div className="font-semibold mb-2 text-slate-200">Escala F (Fujita)</div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              {F_SCALE_ORDER.map((f) => (
                <div key={f} className="flex items-center gap-2">
                  <span
                    className="inline-block w-4 h-1 rounded flex-shrink-0"
                    style={{ backgroundColor: TORNADO_TRACK_COLORS[f] || '#666' }}
                  />
                  <span className="text-slate-300">{f}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Painel lateral: lista e detalhe — largura fixa, scroll próprio */}
        <div className="w-80 flex-shrink-0 flex flex-col gap-2 p-3 bg-slate-950/95 border-l border-slate-700 overflow-y-auto">
          <div className="bg-slate-900/80 border border-slate-700 rounded-lg p-4">
            <h2 className="font-semibold text-slate-200 mb-2 flex items-center gap-2">
              <Info className="w-4 h-4" />
              Eventos
            </h2>
            <p className="text-slate-500 text-xs mb-3">
              Clique em um rastro no mapa para ver detalhes. Passe o mouse para comparar Antes/Depois (se houver imagens).
            </p>
            <ul className="space-y-2 max-h-48 overflow-y-auto">
              {filteredTracks.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedTrack(t)}
                    className={`w-full text-left px-3 py-2 rounded text-sm border transition-colors ${
                      selectedTrack?.id === t.id
                        ? 'bg-amber-500/20 border-amber-500/50 text-white'
                        : 'bg-slate-800/50 border-slate-600 text-slate-300 hover:border-slate-500'
                    }`}
                  >
                    <span className="font-medium">{t.date}</span>
                    <span className="mx-1">·</span>
                    <span className="text-slate-400">{t.locality || t.state}</span>
                    <div className="flex gap-1 mt-1 flex-wrap">
                      {t.polygons.map((p) => (
                        <span
                          key={p.intensity}
                          className="font-mono text-xs"
                          style={{ color: TORNADO_TRACK_COLORS[p.intensity] || '#888' }}
                        >
                          {p.intensity}
                        </span>
                      ))}
                    </div>
                    {t.beforeImage && t.afterImage && (
                      <span className="ml-1.5 text-[10px] text-emerald-400">Antes/Depois</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {/* Comparativo Antes/Depois — aparece ao passar o mouse ou ao selecionar um rastro com imagens */}
          {trackForCompare && (
            <div
              className="bg-slate-900/80 border border-emerald-500/30 rounded-lg p-4 animate-in fade-in slide-in-from-bottom-2 duration-200"
              onMouseEnter={() => {
                if (hoverTimeoutRef.current) {
                  clearTimeout(hoverTimeoutRef.current);
                  hoverTimeoutRef.current = null;
                }
              }}
              onMouseLeave={() => {
                hoverTimeoutRef.current = setTimeout(() => setHoveredTrack(null), 300);
              }}
            >
              <h3 className="font-semibold text-emerald-400 mb-2">Antes / Depois</h3>
              <p className="text-slate-500 text-xs mb-2">
                {trackForCompare.date} · {trackForCompare.locality || trackForCompare.state}
              </p>
              <BeforeAfterCompare
                beforeUrl={trackForCompare.beforeImage!}
                afterUrl={trackForCompare.afterImage!}
                beforeLabel="Antes"
                afterLabel="Depois"
                className="w-full"
              />
            </div>
          )}

          {selectedTrack && (
            <div className="bg-slate-900/80 border border-amber-500/30 rounded-lg p-4">
              <h3 className="font-semibold text-amber-400 mb-2">Detalhes do evento</h3>
              <dl className="space-y-1 text-sm">
                <div>
                  <dt className="text-slate-500">Data</dt>
                  <dd className="text-slate-200">{selectedTrack.date}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Intensidades (escala F)</dt>
                  <dd className="flex flex-wrap gap-1">
                    {selectedTrack.polygons.map((p) => (
                      <span
                        key={p.intensity}
                        className="font-mono font-medium"
                        style={{ color: TORNADO_TRACK_COLORS[p.intensity] || '#888' }}
                      >
                        {p.intensity}
                      </span>
                    ))}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Local</dt>
                  <dd className="text-slate-200">
                    {selectedTrack.locality ? `${selectedTrack.locality}, ` : ''}
                    {selectedTrack.state}
                  </dd>
                </div>
                {selectedTrack.description && (
                  <div>
                    <dt className="text-slate-500">Descrição</dt>
                    <dd className="text-slate-300">{selectedTrack.description}</dd>
                  </div>
                )}
                {selectedTrack.source && (
                  <div>
                    <dt className="text-slate-500">Fonte</dt>
                    <dd className="text-slate-400 text-xs">{selectedTrack.source}</dd>
                  </div>
                )}
              </dl>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
