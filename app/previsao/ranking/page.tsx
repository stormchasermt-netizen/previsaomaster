'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { getRanking } from '../../../lib/bswcRanking';
import type { BswcRankingRow } from '../../../lib/types';

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function RankingPage() {
  const [fromDate, setFromDate] = useState(todayISO());
  const [toDate, setToDate] = useState(todayISO());
  const [rows, setRows] = useState<BswcRankingRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRanking = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getRanking(fromDate, toDate);
      setRows(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar ranking.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRanking();
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6">
      <header className="flex items-center justify-between mb-6">
        <Link href="/previsao" className="inline-flex items-center gap-2 text-slate-400 hover:text-white">
          <ChevronLeft /> Voltar
        </Link>
        <h1 className="text-xl font-bold">Ranking – Previsão & Sondagens</h1>
      </header>

      <div className="flex flex-wrap gap-4 mb-6">
        <label className="flex items-center gap-2">
          De:
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm"
          />
        </label>
        <label className="flex items-center gap-2">
          Até:
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm"
          />
        </label>
        <button
          onClick={loadRanking}
          disabled={loading}
          className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 rounded font-medium"
        >
          {loading ? 'Carregando…' : 'Carregar'}
        </button>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-500/20 border border-red-500/50 rounded text-red-300">
          {error}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-700">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-800 text-slate-300">
              <th className="p-3 text-left">Pos</th>
              <th className="p-3 text-left">Jogador</th>
              <th className="p-3 text-center">Dias</th>
              <th className="p-3 text-center">Granizo</th>
              <th className="p-3 text-center">Vento</th>
              <th className="p-3 text-center">Tornado</th>
              <th className="p-3 text-center font-bold">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading && (
              <tr>
                <td colSpan={7} className="p-6 text-center text-slate-400">
                  Nenhum registro no período.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.userId} className="border-t border-slate-700 hover:bg-slate-800/50">
                <td className="p-3">{r.pos}</td>
                <td className="p-3 font-medium">{r.playerName}</td>
                <td className="p-3 text-center">{r.daysCount}</td>
                <td className="p-3 text-center">{r.hailPoints}</td>
                <td className="p-3 text-center">{r.windPoints}</td>
                <td className="p-3 text-center">{r.tornadoPoints}</td>
                <td className="p-3 text-center font-bold">{r.totalPoints}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
