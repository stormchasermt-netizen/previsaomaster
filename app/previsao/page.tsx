'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronLeft, Send, CheckCircle } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { BswcPrevisaoMap } from '../../components/BswcPrevisaoMap';
import {
  saveForecast,
  getLatestForecast,
  fetchReports,
  fetchReportsByTimeWindow,
  getReportTimeWindow,
} from '../../lib/bswcStore';
import { computeScoreboard } from '../../lib/bswcScoring';
import type { BswcHazard, BswcForecastFeature, BswcScoreboard } from '../../lib/types';

const PROBS_BY_TYPE: Record<BswcHazard, number[]> = {
  granizo: [5, 15, 30, 45],
  vento: [5, 15, 30, 45],
  tornado: [2, 5, 10, 15],
};

const LEVEL_OF: Record<string, Record<number, number>> = {
  tornado: { 2: 1, 5: 2, 10: 3, 15: 4 },
  granizo: { 5: 1, 15: 2, 30: 3, 45: 4 },
  vento: { 5: 1, 15: 2, 30: 3, 45: 4 },
};

const DEADLINE_UTC = 12;

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function getNextDeadline() {
  const now = new Date();
  const todayDL = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), DEADLINE_UTC, 0, 0)
  );
  return now < todayDL ? todayDL : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, DEADLINE_UTC, 0, 0));
}

function canEditNow() {
  return new Date() < getNextDeadline();
}

export default function PrevisaoPage() {
  const { user } = useAuth();
  const router = useRouter();

  const [dateISO, setDateISO] = useState(todayISO());
  const [hazard, setHazard] = useState<BswcHazard>('granizo');
  const [prob, setProb] = useState(15);
  const [polygons, setPolygons] = useState<BswcForecastFeature[]>([]);
  const [reports, setReports] = useState<
    Array<{ type: 'Feature'; geometry: { type: 'Point'; coordinates: [number, number] }; properties: { hazard: string; sev: string } }>
  >([]);
  const [scoreboard, setScoreboard] = useState<BswcScoreboard | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [viewMyForecast, setViewMyForecast] = useState(false);
  const [viewMode, setViewMode] = useState<'all' | 'overall'>('all');
  const [deadlineText, setDeadlineText] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  const level = LEVEL_OF[hazard]?.[prob] ?? 1;

  const loadReports = useCallback(async () => {
    const feats = await fetchReports(dateISO);
    setReports(feats.map((f) => ({ ...f, type: 'Feature' as const })));
  }, [dateISO]);

  const loadForecast = useCallback(async () => {
    if (!user) return;
    const fc = await getLatestForecast(user.uid, dateISO);
    if (fc?.geojson?.features?.length) {
      setPolygons(fc.geojson.features);
      setViewMyForecast(true);
    } else {
      setPolygons([]);
    }
  }, [user, dateISO]);

  const refreshScoreboard = useCallback(async () => {
    if (!user || !polygons.length) return;
    const { startISO, endISO } = getReportTimeWindow(dateISO);
    const reps = await fetchReportsByTimeWindow(startISO, endISO);
    const polys = polygons.map((f) => ({
      type: 'Feature' as const,
      geometry: f.geometry,
      properties: { level: f.properties.level, type: f.properties.type },
    }));
    const sb = computeScoreboard(polys, reps);
    setScoreboard(sb);
  }, [user, dateISO, polygons]);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  useEffect(() => {
    if (viewMyForecast && user) loadForecast();
    else if (!viewMyForecast) setPolygons([]);
  }, [viewMyForecast, user, dateISO, loadForecast]);

  useEffect(() => {
    if (viewMyForecast && polygons.length) refreshScoreboard();
    else setScoreboard(null);
  }, [viewMyForecast, polygons, refreshScoreboard]);

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const target = getNextDeadline();
      let diff = target.getTime() - now.getTime();
      if (diff < 0) diff = 0;
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setDeadlineText(`Fecha em: ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const handleSubmit = async () => {
    if (!user || polygons.length === 0) {
      alert('Desenhe ao menos um polígono e faça login.');
      return;
    }
    setLoading(true);
    try {
      await saveForecast({
        userId: user.uid,
        displayName: user.displayName || 'Jogador',
        dateISO,
        dayType: 'd0',
        geojson: { type: 'FeatureCollection', features: polygons },
      });
      setSent(true);
      setViewMyForecast(true);
      loadForecast();
    } catch (e) {
      console.error(e);
      alert('Erro ao enviar previsão.');
    } finally {
      setLoading(false);
    }
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-950 text-white p-6">
        <Link href="/" className="inline-flex items-center gap-2 text-slate-400 hover:text-white mb-6">
          <ChevronLeft /> Voltar
        </Link>
        <div className="max-w-md mx-auto text-center py-16">
          <h1 className="text-2xl font-bold mb-4">Previsão & Sondagens</h1>
          <p className="text-slate-400 mb-6">Faça login para participar.</p>
          <button
            onClick={() => router.push('/login')}
            className="px-6 py-3 bg-amber-500 text-black font-semibold rounded-lg"
          >
            Entrar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col">
      <header className="flex items-center justify-between p-4 bg-slate-900/80 border-b border-slate-700">
        <Link href="/" className="inline-flex items-center gap-2 text-slate-400 hover:text-white">
          <ChevronLeft /> Voltar
        </Link>
        <h1 className="text-lg font-bold">Previsão & Sondagens</h1>
        <div className="text-sm text-amber-400">{deadlineText}</div>
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
          Tipo:
          <select
            value={hazard}
            onChange={(e) => {
              setHazard(e.target.value as BswcHazard);
              setProb(PROBS_BY_TYPE[e.target.value as BswcHazard][0]);
            }}
            className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm"
          >
            <option value="granizo">Granizo</option>
            <option value="vento">Vento</option>
            <option value="tornado">Tornado</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          Prob(%):
          <select
            value={prob}
            onChange={(e) => setProb(Number(e.target.value))}
            className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm"
          >
            {PROBS_BY_TYPE[hazard].map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={viewMyForecast}
            onChange={(e) => {
              const checked = e.target.checked;
              setViewMyForecast(checked);
              if (!checked) {
                setPolygons([]);
                setViewMode('all');
              } else {
                setViewMode('all');
              }
            }}
          />
          Ver previsão feita
        </label>
        {viewMyForecast && polygons.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-slate-400 text-sm">Visualizar:</span>
            <button
              onClick={() => setViewMode('all')}
              className={`px-2 py-1 rounded text-sm ${viewMode === 'all' ? 'bg-amber-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
            >
              Todos os riscos
            </button>
            <button
              onClick={() => setViewMode('overall')}
              className={`px-2 py-1 rounded text-sm ${viewMode === 'overall' ? 'bg-amber-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
            >
              Mapa geral
            </button>
          </div>
        )}
        <button
          onClick={handleSubmit}
          disabled={loading || !canEditNow() || polygons.length === 0}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:cursor-not-allowed rounded font-medium"
        >
          {loading ? 'Enviando…' : <><Send size={16} /> Enviar previsão</>}
        </button>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-4 gap-4 p-4">
        <div className="lg:col-span-3 rounded-lg overflow-hidden border border-slate-700 bg-slate-900/40 relative">
          {validationError && (
            <div className="absolute top-2 left-2 right-2 z-20 bg-red-900/90 text-red-100 px-3 py-2 rounded text-sm flex items-center justify-between">
              <span>{validationError}</span>
              <button onClick={() => setValidationError(null)} className="text-red-200 hover:text-white">
                ✕
              </button>
            </div>
          )}
          <BswcPrevisaoMap
            hazard={hazard}
            prob={prob}
            level={level}
            polygons={polygons}
            reports={reports}
            onPolygonsChange={(p) => { setPolygons(p); setValidationError(null); }}
            canEdit={canEditNow() && !viewMyForecast}
            viewMode={viewMode}
            onValidationError={setValidationError}
          />
        </div>

        <aside className="space-y-4">
          {scoreboard && (
            <div className="bg-slate-800/80 rounded-lg p-4 border border-slate-600">
              <h3 className="font-semibold mb-3">Placar</h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-slate-400">
                    <th className="text-left">Perigo</th>
                    <th>Acertos</th>
                    <th>Erros</th>
                    <th>%</th>
                    <th>Pts</th>
                  </tr>
                </thead>
                <tbody>
                  {(['granizo', 'vento', 'tornado'] as const).map((h) => (
                    <tr key={h}>
                      <td className="capitalize">{h}</td>
                      <td>{scoreboard[h].hit}</td>
                      <td>{scoreboard[h].miss}</td>
                      <td>{scoreboard[h].pct}%</td>
                      <td>{scoreboard[h].pts}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-2 pt-2 border-t border-slate-600 font-bold">
                Total: {scoreboard.totalPts} pts
              </div>
            </div>
          )}

          {sent && (
            <div className="flex items-center gap-2 text-emerald-400 bg-emerald-500/10 rounded-lg p-3">
              <CheckCircle size={20} /> Previsão enviada!
            </div>
          )}

          <Link
            href="/previsao/ranking"
            className="block text-center py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm"
          >
            Ver Ranking
          </Link>

          {(user?.type === 'admin' || user?.type === 'superadmin') && (
            <Link
              href="/previsao/relatos"
              className="block text-center py-2 bg-amber-600/80 hover:bg-amber-600 rounded-lg text-sm"
            >
              Lançar relatos (Admin)
            </Link>
          )}
        </aside>
      </div>
    </div>
  );
}
