'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, LayoutDashboard, Database, TrendingUp, Play, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { fetchTornadoTracks } from '@/lib/tornadoTracksStore';
import { TornadoTrack, getMaxIntensity } from '@/lib/tornadoTracksData';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { StudyCharts } from './StudyCharts';

export default function StudyDashboardPage() {
  const { user } = useAuth();
  const { addToast } = useToast();
  
  const [tracks, setTracks] = useState<TornadoTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [progress, setProgress] = useState({ current: 0, total: 0 });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const allTracks = await fetchTornadoTracks();
      const withSoundings = allTracks.filter(t => t.soundingFiles && t.soundingFiles.length > 0);
      setTracks(withSoundings);
    } catch (err: any) {
      addToast('Erro ao carregar trilhas: ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const processStudy = async () => {
    if (tracks.length === 0) return;
    setProcessing(true);
    const studyResults: any[] = [];
    setProgress({ current: 0, total: tracks.length });

    const pythonServiceUrl = process.env.NEXT_PUBLIC_PYTHON_ENGINE_URL || 'https://sounding-engine-303740989273.us-central1.run.app';

    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i];
      const maxIntensity = getMaxIntensity(track) || 'F0';
      
      // Processar cada sounding file da track
      if (track.soundingFiles) {
        for (const file of track.soundingFiles) {
          try {
            const res = await fetch(`${pythonServiceUrl}/api/study-indices`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ csvUrl: file.url })
            });
            const data = await res.json();
            if (data.success && data.results && data.results[0]) {
              studyResults.push({
                trackId: track.id,
                date: track.date,
                maxIntensity,
                indices: data.results[0].indices
              });
            }
          } catch (e) {
            console.error('Erro ao processar sounding:', file.name, e);
          }
        }
      }
      setProgress(prev => ({ ...prev, current: i + 1 }));
    }

    setResults(studyResults);
    setProcessing(false);
    addToast(`Processamento concluído: ${studyResults.length} sondagens analisadas.`, 'success');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <Loader2 className="w-10 h-10 text-cyan-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 p-4 sm:p-8">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-800 pb-6">
          <div className="flex items-center gap-4">
            <Link href="/admin/dashboard" className="p-2 rounded-lg bg-slate-900 border border-slate-700 hover:bg-slate-800 transition-all hover:scale-110">
              <ChevronLeft className="w-6 h-6" />
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-white flex items-center gap-3">
                <TrendingUp className="w-8 h-8 text-cyan-400" />
                Menu Estudos - Estatística Global
              </h1>
              <p className="text-slate-500 text-sm">Análise de severidade comparativa (STP, SCP, SRH) — Hemisfério Sul</p>
            </div>
          </div>
          <button
            onClick={processStudy}
            disabled={processing || tracks.length === 0}
            className="flex items-center gap-2.5 px-6 py-3 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold transition-all shadow-[0_0_20px_rgba(6,182,212,0.3)] disabled:opacity-50 group active:scale-95"
          >
            {processing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5 fill-current" />}
            {processing ? `Processando… (${progress.current}/${progress.total})` : 'Processar Base de Dados'}
          </button>
        </div>

        {/* Info Area */}
        {results.length === 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center py-12">
            <div className="space-y-6">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 text-xs font-bold uppercase tracking-wider">
                <Database className="w-3.5 h-3.5" />
                Dados Prontos
              </div>
              <h2 className="text-4xl font-black text-white leading-tight">
                Compare a Termodinâmica de <span className="text-cyan-400">Tornados Brasileiros</span>
              </h2>
              <p className="text-slate-400 text-lg leading-relaxed">
                Este motor utiliza o SHARPpy para extrair os parâmetros de severidade mais importantes de todos os arquivos CSV anexados aos rastros. 
                Configure a análise para agrupar as médias por intensidade (F-Scale).
              </p>
              <div className="flex flex-wrap gap-4">
                <div className="flex items-center gap-2 text-sm text-slate-300">
                  <CheckCircle2 className="w-5 h-5 text-emerald-500" /> SRH ajustado (SH)
                </div>
                <div className="flex items-center gap-2 text-sm text-slate-300">
                  <CheckCircle2 className="w-5 h-5 text-emerald-500" /> STP & SCP Inclusos
                </div>
                <div className="flex items-center gap-2 text-sm text-slate-300">
                  <CheckCircle2 className="w-5 h-5 text-emerald-500" /> Lógica Hemisfério Sul
                </div>
              </div>
            </div>
            <div className="bg-slate-900/50 border border-slate-800 rounded-3xl p-8 flex flex-col items-center justify-center text-center space-y-4 shadow-2xl">
              <div className="w-20 h-20 rounded-full bg-cyan-500/10 flex items-center justify-center">
                <TrendingUp className="w-10 h-10 text-cyan-400" />
              </div>
              <h3 className="text-xl font-bold text-white">Nenhum dado processado ainda</h3>
              <p className="text-slate-500 text-sm max-w-xs">Clique no botão acima para iniciar a leitura e classificação de {tracks.length} tornados com sondagens.</p>
            </div>
          </div>
        )}

        {/* Results Area */}
        {results.length > 0 && (
          <div className="space-y-8 animate-in zoom-in-95 duration-500">
            <div className="flex items-center justify-between p-4 bg-slate-900/80 border border-slate-800 rounded-2xl shadow-lg">
               <div className="flex items-center gap-3">
                 <CheckCircle2 className="w-6 h-6 text-emerald-500" />
                 <span className="font-bold text-white">{results.length} sondagens integradas no estudo estatístico.</span>
               </div>
               <button onClick={() => setResults([])} className="text-xs text-slate-500 hover:text-white transition-colors">Limpar resultados</button>
            </div>

            <StudyCharts results={results} />
            
            <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-200/80 leading-relaxed">
                <strong>Nota Técnica:</strong> Os valores de SRH (Storm-Relative Helicity) e STP (Significant Tornado Parameter) foram invertidos no cálculo para refletir a severidade ciclônica do Hemisfério Sul como valores positivos, facilitando a comparação visual entre categorias de intensidade.
              </p>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
