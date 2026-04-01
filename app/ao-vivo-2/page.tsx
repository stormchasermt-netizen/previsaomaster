'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, Play, Pause, SkipBack, SkipForward } from 'lucide-react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { CPTEC_RADAR_STATIONS, getRadarImageBounds, type CptecRadarStation } from '@/lib/cptecRadarStations';

const MAPTILER_KEY = 'WyOGmI7ufyBLH3G7aX9o';
const SAT_STYLE = `https://api.maptiler.com/maps/hybrid-v4/style.json?key=${MAPTILER_KEY}`;

const RADAR_SOURCE_ID = 'radar-aovivo2-src';
const RADAR_LAYER_ID = 'radar-aovivo2-layer';

function findCptecBySlug(slug: string): CptecRadarStation | undefined {
  return CPTEC_RADAR_STATIONS.find((s) => s.slug === slug);
}

function imageCoordinatesFromBounds(bounds: ReturnType<typeof getRadarImageBounds>): [
  [number, number],
  [number, number],
  [number, number],
  [number, number],
] {
  return [
    [bounds.west, bounds.north],
    [bounds.east, bounds.north],
    [bounds.east, bounds.south],
    [bounds.west, bounds.south],
  ];
}

function absoluteUrl(path: string): string {
  if (typeof window === 'undefined') return path;
  if (path.startsWith('http')) return path;
  return `${window.location.origin}${path}`;
}

export default function AoVivo2Page() {
  const [isMounted, setIsMounted] = useState(false);
  const [stations, setStations] = useState<string[]>([]);
  const [selectedStation, setSelectedStation] = useState<string>('');
  const [images, setImages] = useState<{ name: string; url: string }[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [playSpeed] = useState(400);

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!isMounted) return;
    setIsLoading(true);
    setError(null);
    fetch('/api/radar-ao-vivo2?action=listStations')
      .then((r) => r.json())
      .then((data: { stations?: string[] }) => {
        const list = data.stations || [];
        setStations(list);
        if (list.length > 0) {
          setSelectedStation((prev) => prev || list[0]);
        }
      })
      .catch((e) => setError(String(e)))
      .finally(() => setIsLoading(false));
  }, [isMounted]);

  useEffect(() => {
    if (!isMounted || !selectedStation) {
      setImages([]);
      return;
    }
    setIsLoading(true);
    setError(null);
    fetch(`/api/radar-ao-vivo2?action=listImages&station=${encodeURIComponent(selectedStation)}`)
      .then((r) => r.json())
      .then((data: { images?: { name: string; url: string }[] }) => {
        const imgs = data.images || [];
        setImages(imgs);
        setCurrentIndex(0);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setIsLoading(false));
  }, [isMounted, selectedStation]);

  const stationForBounds = findCptecBySlug(selectedStation);

  useEffect(() => {
    if (!stationForBounds && mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
    }
  }, [stationForBounds]);

  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container || !stationForBounds) return;

    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
    }

    const bounds = getRadarImageBounds(stationForBounds);
    const map = new maplibregl.Map({
      container,
      style: SAT_STYLE,
      center: [(bounds.west + bounds.east) / 2, (bounds.south + bounds.north) / 2],
      zoom: 6,
    });
    map.fitBounds(
      [
        [bounds.west, bounds.south],
        [bounds.east, bounds.north],
      ],
      { padding: 48, duration: 0 }
    );
    mapRef.current = map;

    return () => {
      map.remove();
      if (mapRef.current === map) mapRef.current = null;
    };
  }, [stationForBounds]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !stationForBounds || images.length === 0) return;

    const img = images[currentIndex];
    if (!img) return;

    const bounds = getRadarImageBounds(stationForBounds);
    const coordinates = imageCoordinatesFromBounds(bounds);
    const url = absoluteUrl(img.url);

    const apply = () => {
      const src = map.getSource(RADAR_SOURCE_ID) as maplibregl.ImageSource | undefined;
      if (src && typeof src.updateImage === 'function') {
        src.updateImage({ url, coordinates });
      } else {
        if (map.getLayer(RADAR_LAYER_ID)) map.removeLayer(RADAR_LAYER_ID);
        if (map.getSource(RADAR_SOURCE_ID)) map.removeSource(RADAR_SOURCE_ID);
        map.addSource(RADAR_SOURCE_ID, {
          type: 'image',
          url,
          coordinates,
        });
        map.addLayer({
          id: RADAR_LAYER_ID,
          type: 'raster',
          source: RADAR_SOURCE_ID,
          paint: {
            'raster-opacity': 0.88,
            'raster-fade-duration': 0,
          },
        });
      }
    };

    if (!map.isStyleLoaded()) {
      map.once('load', apply);
    } else {
      apply();
    }
  }, [images, currentIndex, stationForBounds]);

  useEffect(() => {
    if (!isPlaying || images.length < 2) return;
    const t = setInterval(() => {
      setCurrentIndex((i) => (i + 1) % images.length);
    }, playSpeed);
    return () => clearInterval(t);
  }, [isPlaying, images.length, playSpeed]);

  if (!isMounted) {
    return <div className="min-h-screen bg-slate-900" />;
  }

  const togglePlay = () => setIsPlaying((p) => !p);
  const prevFrame = () => {
    setIsPlaying(false);
    setCurrentIndex((i) => (i - 1 + Math.max(images.length, 1)) % Math.max(images.length, 1));
  };
  const nextFrame = () => {
    setIsPlaying(false);
    setCurrentIndex((i) => (i + 1) % Math.max(images.length, 1));
  };

  return (
    <div className="flex flex-col h-[100dvh] bg-slate-950 text-white">
      <header className="flex items-center justify-between px-4 py-2 border-b border-slate-700 shrink-0 z-10">
        <Link
          href="/"
          className="flex items-center gap-2 text-slate-300 hover:text-white text-sm font-medium"
        >
          <ChevronLeft className="w-5 h-5" />
          Início
        </Link>
        <h1 className="text-sm font-bold tracking-wide text-cyan-400">Ao vivo — cache (v2)</h1>
        <div className="w-20" />
      </header>

      <div className="flex flex-wrap items-center gap-3 px-4 py-2 border-b border-slate-800 shrink-0 bg-slate-900/90">
        <label className="text-xs text-slate-400 font-semibold">Radar</label>
        <select
          className="bg-slate-800 border border-slate-600 rounded px-3 py-1.5 text-sm max-w-[220px]"
          value={selectedStation}
          onChange={(e) => setSelectedStation(e.target.value)}
          disabled={stations.length === 0}
        >
          {stations.length === 0 ? (
            <option value="">Nenhuma pasta no bucket</option>
          ) : (
            stations.map((s) => (
              <option key={s} value={s}>
                {findCptecBySlug(s)?.name ?? s}
              </option>
            ))
          )}
        </select>
        {!stationForBounds && selectedStation ? (
          <span className="text-xs text-amber-400">
            Slug sem bounds CPTEC — use um slug listado em cptecRadarStations.
          </span>
        ) : null}
      </div>

      <div className="flex-1 relative min-h-0">
        {error && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60 p-4 text-center text-red-300 text-sm">
            {error}
          </div>
        )}
        {isLoading && stations.length === 0 && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-950/80">
            <div className="animate-spin rounded-full h-10 w-10 border-2 border-cyan-500 border-t-transparent" />
          </div>
        )}
        {!stationForBounds && selectedStation ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center p-6 text-center text-slate-400 text-sm">
            Crie no bucket uma pasta com o slug de um radar CPTEC (ex.{' '}
            <code className="text-cyan-300">chapeco</code>).
          </div>
        ) : (
          <div ref={mapContainerRef} className="absolute inset-0 w-full h-full" />
        )}

        {images.length === 0 && selectedStation && stationForBounds && !isLoading && (
          <div className="absolute bottom-16 left-4 right-4 z-10 rounded-lg bg-black/70 border border-slate-600 p-4 text-sm text-slate-200">
            Nenhuma imagem em{' '}
            <code className="text-cyan-300">gs://radar_ao_vivo_2/{selectedStation}/</code>. Envie PNGs,
            ex. <code className="text-cyan-300">20251107120000.png</code>.
          </div>
        )}
      </div>

      {images.length > 0 && (
        <div className="border-t border-slate-700 bg-slate-900 shrink-0">
          <div className="flex overflow-x-auto gap-0.5 px-2 py-2 text-[10px] font-mono touch-pan-x">
            {images.map((im, idx) => (
              <button
                key={im.url}
                type="button"
                onClick={() => {
                  setCurrentIndex(idx);
                  setIsPlaying(false);
                }}
                className={`shrink-0 px-2 py-1 rounded border ${
                  idx === currentIndex
                    ? 'bg-cyan-700 border-cyan-500 text-white'
                    : 'bg-slate-800 border-slate-600 text-slate-300 hover:bg-slate-700'
                }`}
              >
                {im.name.replace(/\.(png|jpg|jpeg|gif)$/i, '').slice(-6) || idx}
              </button>
            ))}
          </div>
          <div className="flex items-center justify-center gap-4 py-3 border-t border-slate-800">
            <button
              type="button"
              onClick={prevFrame}
              className="p-2 rounded-full bg-slate-800 hover:bg-slate-700"
              aria-label="Anterior"
            >
              <SkipBack className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={togglePlay}
              className="p-3 rounded-full bg-cyan-700 hover:bg-cyan-600"
              aria-label={isPlaying ? 'Pausar' : 'Play'}
            >
              {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6 pl-0.5" />}
            </button>
            <button
              type="button"
              onClick={nextFrame}
              className="p-2 rounded-full bg-slate-800 hover:bg-slate-700"
              aria-label="Próximo"
            >
              <SkipForward className="w-5 h-5" />
            </button>
            <span className="text-xs text-slate-500">
              {currentIndex + 1} / {images.length}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
