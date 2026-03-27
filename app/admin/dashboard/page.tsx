'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { fetchTornadoTracks } from '@/lib/tornadoTracksStore';
import { TornadoTrack } from '@/lib/tornadoTracksData';
import { ChevronLeft, LayoutDashboard, FileText, Play, Loader2, List, Wind, TrendingUp } from 'lucide-react';
import { SoundingPoint, processCSVContent, interpolateSounding } from '@/lib/soundingUtils';

export default function AdminDashboardPage() {
  const { user } = useAuth();
  const { addToast } = useToast();
  const router = useRouter();
  
  const [tracks, setTracks] = useState<TornadoTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [activeData, setActiveData] = useState<SoundingPoint[] | null>(null);
  const [activeTrackName, setActiveTrackName] = useState<string>('');
  
  // States for Average Hodograph
  const [allSoundingsData, setAllSoundingsData] = useState<SoundingPoint[][]>([]);
  const [averageData, setAverageData] = useState<SoundingPoint[] | null>(null);
  const [isAveraging, setIsAveraging] = useState(false);

  useEffect(() => {
    if (!user || (user.type !== 'admin' && user.type !== 'superadmin')) {
      if (!loading) router.push('/');
      return;
    }
    loadData();
  }, [user, router]);

  const loadData = async () => {
    setLoading(true);
    try {
      const allTracks = await fetchTornadoTracks();
      const withSoundings = allTracks.filter(t => t.soundingFiles && t.soundingFiles.length > 0);
      setTracks(withSoundings);
    } catch (err: any) {
      addToast('Erro ao carregar dados: ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const processSounding = async (track: TornadoTrack, fileUrl: string, fileName: string) => {
    const procId = `${track.id}_${fileName}`;
    setProcessingId(procId);
    setActiveTrackName(`${track.date} - ${track.locality || track.state} (${fileName})`);
    setAverageData(null); // Clear average view when selecting specific
    
    try {
      const res = await fetch('/api/admin/process-sounding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csvUrl: fileUrl })
      });
      
      const result = await res.json();
      
      if (result.success) {
        setActiveData(result.data);
        addToast('Sondagem processada com sucesso!', 'success');
      } else {
        addToast('Erro: ' + (result.error || 'Falha no processamento'), 'error');
      }
    } catch (err: any) {
      addToast('Erro na requisição: ' + err.message, 'error');
    } finally {
      setProcessingId(null);
    }
  };

  const generateAverageSounding = async () => {
    setIsAveraging(true);
    setActiveData(null);
    setActiveTrackName('Média de Todos os Eventos');
    
    try {
      const processed: SoundingPoint[][] = [];
      const filesToProcess = tracks.flatMap(t => t.soundingFiles?.map(f => ({ url: f.url, name: f.name })) || []);
      
      if (filesToProcess.length === 0) {
        addToast('Nenhum dado disponível para média.', 'warning');
        return;
      }

      for (const file of filesToProcess) {
        const res = await fetch(file.url);
        const csv = await res.text();
        const result = processCSVContent(csv);
        if (result.success && result.data) {
          processed.push(result.data);
        }
      }

      setAllSoundingsData(processed);

      // Simple averaging logic
      const standardLevels = Array.from({ length: 121 }, (_, i) => i * 100); // 0 to 12000m every 100m
      const meanSounding: SoundingPoint[] = [];

      for (const h of standardLevels) {
        let sumU = 0;
        let sumV = 0;
        let count = 0;

        for (const points of processed) {
          const val = interpolateSounding(points, h);
          if (val) {
            sumU += val.u;
            sumV += val.v;
            count++;
          }
        }

        if (count > 0) {
          meanSounding.push({ height: h, u: sumU / count, v: sumV / count });
        }
      }

      setAverageData(meanSounding);
      addToast(`Média gerada com base em ${processed.length} sondagens!`, 'success');
    } catch (err: any) {
        addToast('Erro ao gerar média: ' + err.message, 'error');
    } finally {
        setIsAveraging(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <Loader2 className="w-10 h-10 text-amber-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 p-4 sm:p-8">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-800 pb-6">
          <div className="flex items-center gap-4">
            <Link href="/admin" className="p-2 rounded-lg bg-slate-900 border border-slate-700 hover:bg-slate-800 transition-colors">
              <ChevronLeft className="w-6 h-6" />
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                <LayoutDashboard className="w-7 h-7 text-amber-500" />
                Hodograph Admin: Sondagens
              </h1>
              <p className="text-slate-500 text-sm">Processamento de dados brutos e geração de hodógrafas</p>
            </div>
          </div>
          <div className="flex gap-3">
              <button 
                onClick={generateAverageSounding}
                disabled={isAveraging || tracks.length === 0}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-slate-950 text-sm font-bold transition-colors disabled:opacity-50"
              >
                {isAveraging ? <Loader2 className="w-4 h-4 animate-spin" /> : <TrendingUp className="w-4 h-4" />}
                Gerar Sondagem Média
              </button>
             <Link href="/admin/rastros-tornados" className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm font-medium transition-colors">
               <List className="w-4 h-4" /> Gerenciar Rastros
             </Link>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* List of Tracks with Soundings */}
          <div className="lg:col-span-1 space-y-4">
            <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
              <FileText className="w-5 h-5 text-cyan-400" />
              Eventos com Sondagem
            </h2>
            
            <div className="space-y-3 overflow-y-auto max-h-[70vh] pr-2 custom-scrollbar">
              {tracks.length === 0 ? (
                <div className="p-8 text-center bg-slate-900/50 rounded-xl border border-dashed border-slate-800">
                  <p className="text-slate-500 text-sm">Nenhum rastro com arquivos CSV anexados.</p>
                  <Link href="/admin/rastros-tornados" className="text-amber-500 hover:underline text-xs mt-2 inline-block">Adicionar CSVs no Admin de Rastros</Link>
                </div>
              ) : (
                tracks.map(track => (
                  <div key={track.id} className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
                    <div className="p-3 bg-slate-800/50 border-b border-slate-700">
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">{track.date}</p>
                      <h3 className="font-bold text-white truncate">{track.locality || track.state}</h3>
                    </div>
                    <div className="p-3 space-y-2">
                      {track.soundingFiles?.map((file, fIdx) => (
                        <div key={fIdx} className="flex items-center justify-between gap-2 p-2 rounded bg-slate-950 border border-slate-800 hover:border-slate-700 transition-colors">
                          <span className="text-xs text-slate-400 truncate flex-1" title={file.name}>{file.name}</span>
                          <button 
                            onClick={() => processSounding(track, file.url, file.name)}
                            disabled={processingId !== null || isAveraging}
                            className="p-1.5 rounded bg-amber-500/10 text-amber-500 hover:bg-amber-500 hover:text-black disabled:opacity-50 transition-all"
                            title="Processar Hodógrafa"
                          >
                            {processingId === `${track.id}_${file.name}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Visualization Area */}
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 min-h-[500px] flex flex-col shadow-2xl relative overflow-hidden">
              <div className="absolute top-0 right-0 p-4 opacity-5">
                <Wind className="w-32 h-32" />
              </div>

              {!activeData && !averageData ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center space-y-4">
                  <div className="p-4 rounded-full bg-slate-800/50 border border-slate-700">
                    <TrendingUp className="w-12 h-12 text-slate-600" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-slate-400">Nenhuma sondagem selecionada</h3>
                    <p className="text-slate-600 text-sm max-w-xs mx-auto">Selecione um arquivo CSV à esquerda ou clique em "Gerar Sondagem Média" para análise agregada.</p>
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex flex-col space-y-6 animate-in fade-in duration-500">
                  <div className="border-b border-slate-800 pb-4 flex justify-between items-end">
                    <div>
                      <h3 className="text-lg font-bold text-amber-500">
                        {averageData ? 'Hodógrafa Média (Composta)' : 'Hodógrafa Analítica (0-12km)'}
                      </h3>
                      <p className="text-sm text-slate-400">{activeTrackName}</p>
                    </div>
                    {averageData && (
                      <span className="text-xs bg-slate-800 border border-slate-700 px-2 py-1 rounded text-slate-400 font-bold">
                        {allSoundingsData.length} Casos
                      </span>
                    )}
                  </div>

                  <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
                    {/* Hodograph Chart (SVG) */}
                    <div className="aspect-square bg-white rounded-xl border border-slate-200 flex items-center justify-center p-4 relative shadow-md">
                      <HodographChart 
                        data={(averageData || activeData || []).filter(d => d.height <= 12100)} 
                        backgroundData={averageData ? allSoundingsData : undefined}
                      />
                    </div>

                    {/* Data Summary / Stats */}
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-3">
                        <div className="bg-slate-800/40 p-3 rounded-lg border border-slate-700">
                          <p className="text-[10px] text-slate-500 uppercase font-bold">Máx Vento (Vetor)</p>
                          <p className="text-xl font-bold text-white">
                            {Math.max(...(averageData || activeData || []).map(d => Math.sqrt(d.u**2 + d.v**2))).toFixed(1)} <span className="text-xs font-normal text-slate-500">kt/s</span>
                          </p>
                        </div>
                        <div className="bg-slate-800/40 p-3 rounded-lg border border-slate-700">
                          <p className="text-[10px] text-slate-500 uppercase font-bold">Níveis</p>
                          <p className="text-xl font-bold text-white">{(averageData || activeData || []).length}</p>
                        </div>
                      </div>

                      <div className="bg-slate-800/20 rounded-xl border border-slate-800 p-4">
                        <h4 className="text-xs font-bold text-slate-400 uppercase mb-3">Tabela de Níveis</h4>
                        <div className="max-h-64 overflow-y-auto pr-2 custom-scrollbar text-[10px]">
                          <table className="w-full text-left">
                            <thead className="text-slate-500 border-b border-slate-700">
                              <tr>
                                <th className="pb-2">Altura (m)</th>
                                <th className="pb-2">U</th>
                                <th className="pb-2">V</th>
                                <th className="pb-2">Vel</th>
                              </tr>
                            </thead>
                            <tbody className="text-slate-300">
                              {(averageData || activeData || []).map((d, i) => (
                                <tr key={i} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                                  <td className="py-1.5">{Math.round(d.height)}</td>
                                  <td>{d.u.toFixed(1)}</td>
                                  <td>{d.v.toFixed(1)}</td>
                                  <td className="font-bold text-amber-500/80">{Math.sqrt(d.u**2+d.v**2).toFixed(1)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function HodographChart({ data, backgroundData }: { data: SoundingPoint[], backgroundData?: SoundingPoint[][] }) {
  const size = 400;
  const padding = 25;
  const center = size / 2;
  
  // Find max amplitude across all data (main + background)
  const allPoints = backgroundData ? [...data, ...backgroundData.flat()] : data;
  const maxAmp = Math.max(...allPoints.map(d => Math.abs(d.u)), ...allPoints.map(d => Math.abs(d.v)), 40);
  const scale = (size / 2 - padding) / maxAmp;
  
  // Segment color logic
  const getSegmentColor = (h: number) => {
    if (h <= 1000) return '#cf0af0'; // Magenta
    if (h <= 3000) return '#ff0000'; // Red
    if (h <= 6000) return '#ff9100'; // Orange
    if (h <= 9000) return '#ffff00'; // Yellow
    if (h <= 12000) return '#00f2ff'; // Cyan
    return '#cbd5e1';
  };

  // Guide circles
  const guides = [10, 20, 30, 40, 50, 60, 75, 100].filter(g => g <= maxAmp * 1.5);
  if (guides.length === 0) guides.push(20);

  // Labels for height
  const heightLabels = [1000, 3000, 6000, 9000, 12000];

  return (
    <div className="w-full h-full">
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-full font-sans">
        {/* Background Grid */}
        <line x1={padding} y1={center} x2={size-padding} y2={center} stroke="#cbd5e1" strokeWidth="1" />
        <line x1={center} y1={padding} x2={center} y2={size-padding} stroke="#cbd5e1" strokeWidth="1" />
        
        {/* Guide Circles */}
        {guides.map(g => (
          <g key={g}>
            <circle 
              cx={center} cy={center} r={g * scale} 
              fill="none" stroke="#e2e8f0" strokeWidth="1" strokeDasharray={g % 20 === 0 ? "0" : "4 4"}
            />
            <text 
              x={center + 2} y={center - g * scale - 2} 
              className="fill-slate-400 text-[9px] font-medium"
            >
              {g}
            </text>
          </g>
        ))}

        {/* Axis Labels */}
        <text x={size-padding-15} y={center-5} className="fill-slate-400 text-[10px] italic">u</text>
        <text x={center+5} y={padding+10} className="fill-slate-400 text-[10px] italic">v</text>

        {/* Background "Shadow" Soundings */}
        {backgroundData?.map((points, pIdx) => (
          <polyline
            key={pIdx}
            points={points.filter(p => p.height <= 12050).map(p => `${center + p.u * scale},${center - p.v * scale}`).join(' ')}
            fill="none"
            stroke="#cbd5e1"
            strokeWidth="1.2"
            strokeOpacity="0.4"
          />
        ))}

        {/* Main Hodograph Line Segments */}
        {data.slice(0, -1).map((d, i) => {
          const next = data[i+1];
          const x1 = center + d.u * scale;
          const y1 = center - d.v * scale;
          const x2 = center + next.u * scale;
          const y2 = center - next.v * scale;
          
          return (
            <line 
              key={i} 
              x1={x1} y1={y1} x2={x2} y2={y2} 
              stroke={backgroundData ? "#ef4444" : getSegmentColor(next.height)} 
              strokeWidth={backgroundData ? "5" : "4"} 
              strokeLinecap="round" 
              className={backgroundData ? "drop-shadow-[0_0_10px_rgba(239,68,68,0.5)]" : ""}
            />
          );
        })}

        {/* Height Labels and Points */}
        {data.map((d, i) => {
          const isLabelHeight = heightLabels.some(lh => Math.abs(d.height - lh) < 100) || i === 0;
          const x = center + d.u * scale;
          const y = center - d.v * scale;
          
          if (!isLabelHeight) return null;

          return (
            <g key={i}>
              <circle cx={x} cy={y} r={backgroundData ? "3" : "2.5"} fill={backgroundData ? "#ef4444" : "black"} />
              <text 
                x={x+5} y={y-5} 
                className={`text-[12px] font-bold select-none pointer-events-none stroke-white stroke-[0.5px] ${backgroundData ? "fill-red-600" : "fill-black"}`}
              >
                {Math.round(d.height/1000)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
