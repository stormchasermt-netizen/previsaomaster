'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import { saveReport, fetchReports } from '../../../lib/bswcStore';
import { MAP_STYLE_DARK } from '../../../lib/constants';
import type { BswcHazard, BswcSeverity } from '../../../lib/types';

declare const google: any;

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

export default function RelatosPage() {
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
