'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { fetchTornadoTracks } from '@/lib/tornadoTracksStore';
import { TornadoTrack } from '@/lib/tornadoTracksData';
import { ChevronLeft, LayoutDashboard, FileText, Play, Loader2, List, Wind, TrendingUp } from 'lucide-react';

import { SkewTChart, PythonSoundingData } from './SkewTChart';
import { StatsCharts } from './StatsCharts';

// --- Utils ---
function interpolateValue(h: number, profile: any[], field: string) {
  if (profile.length < 2) return null;
  for (let i = 0; i < profile.length - 1; i++) {
    const p1 = profile[i];
    const p2 = profile[i+1];
    if ((p1.height <= h && p2.height >= h) || (p1.height >= h && p2.height <= h)) {
      if (p1.height === p2.height) return p1[field];
      const ratio = (h - p1.height) / (p2.height - p1.height);
      return p1[field] + ratio * (p2[field] - p1[field]);
    }
  }
  return null;
}

export default function AdminDashboardPage() {
  const { user } = useAuth();
  const { addToast } = useToast();
  const router = useRouter();
  
  const [tracks, setTracks] = useState<TornadoTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  
  const [activeData, setActiveData] = useState<PythonSoundingData | null>(null);
  const [activeTrackName, setActiveTrackName] = useState<string>('');
  
  // States for Average
  const [allSoundingsData, setAllSoundingsData] = useState<PythonSoundingData[]>([]);
  const [averageData, setAverageData] = useState<PythonSoundingData | null>(null);
  const [isAveraging, setIsAveraging] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

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
    setAverageData(null);
    setAllSoundingsData([]);
    
    try {
      const res = await fetch('/api/admin/process-sounding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          csvUrl: fileUrl,
          generateImage: true,
          imageTitle: `Previsão Master - ${track.date} ${track.locality || track.state}`
        })
      });
      
      const result = await res.json();
      
      if (result.success) {
        // Normalize indices for frontend (lowercase from Python to CamelCase)
        const normalizedData = {
          ...result.data,
          base64_img: result.base64_img,
          indices: result.data.indices ? {
            mlCAPE: result.data.indices.mlcape ?? 0,
            mlLCL: result.data.indices.mllcl ?? 0,
            CAPE03ml: result.data.indices['3cape'] ?? 0,
            EFFshear: result.data.indices.eff_shear ?? 0,
            Shr_0_500m: result.data.indices.shr_0_500m ?? 0,
            srh_0_1km: result.data.indices.srh_0_1km ?? 0,
            srh_0_3km: result.data.indices.srh_0_3km ?? 0,
            STP_0_1km: result.data.indices.stp_0_1km ?? 0,
            STP_0_500m: result.data.indices.stp_0_500m ?? 0,
            scp: result.data.indices.scp ?? 0,
            stp: result.data.indices.stp ?? 0,
            pw: result.data.indices.pw ?? 0,
            dcape: result.data.indices.dcape ?? 0
          } : {}
        };
        setActiveData(normalizedData);
        addToast('Sondagem processada com sucesso!', 'success');
      } else {
        addToast('Erro: ' + (result.error || 'Falha no processamento, tente novamente.'), 'error');
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
      const filesToProcess = tracks.flatMap(t => t.soundingFiles?.map(f => f.url) || []);
      
      if (filesToProcess.length === 0) {
        addToast('Nenhum dado disponível para média.', 'error');
        return;
      }

      const res = await fetch('/api/admin/process-sounding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isAverage: true, csvUrls: filesToProcess })
      });
      
      const result = await res.json();
      
      if (!result.success || !result.data) {
          throw new Error(result.error || 'Falha no processo backend.');
      }

      const rawProcessedObjList = result.data;
      const processedObjList: PythonSoundingData[] = rawProcessedObjList.map((d: any) => ({
        ...d,
        indices: d.indices ? {
          mlCAPE: d.indices.mlcape ?? 0,
          mlLCL: d.indices.mllcl ?? 0,
          CAPE03ml: d.indices['3cape'] ?? 0,
          EFFshear: d.indices.eff_shear ?? 0,
          Shr_0_500m: d.indices.shr_0_500m ?? 0,
          srh_0_1km: d.indices.srh_0_1km ?? 0,
          srh_0_3km: d.indices.srh_0_3km ?? 0,
          STP_0_1km: d.indices.stp_0_1km ?? 0,
          STP_0_500m: d.indices.stp_0_500m ?? 0,
          scp: d.indices.scp ?? 0,
          stp: d.indices.stp ?? 0,
          pw: d.indices.pw ?? 0,
          dcape: d.indices.dcape ?? 0
        } : {}
      }));
      
      setAllSoundingsData(processedObjList);

      // Calculando o Mean Profile no Frontend
      const standardLevels = Array.from({ length: 121 }, (_, i) => i * 100); 
      const meanProfile: any[] = [];

      for (const h of standardLevels) {
        let u=0, v=0, t=0, td=0, p=0, count=0, t_count=0;

        for (const data of processedObjList) {
          if (!data.profile) continue;
          const valU = interpolateValue(h, data.profile, 'u');
          const valV = interpolateValue(h, data.profile, 'v');
          const valT = interpolateValue(h, data.profile, 'temp');
          const valTd = interpolateValue(h, data.profile, 'dwpt');
          const valP = interpolateValue(h, data.profile, 'pressure');
          
          if (valU !== null && valV !== null) { u += valU; v += valV; count++; }
          if (valT !== null && valTd !== null && valP !== null) { t += valT; td += valTd; p += valP; t_count++; }
        }

        if (count > 0 || t_count > 0) {
          meanProfile.push({
            height: h,
            u: count > 0 ? u / count : null,
            v: count > 0 ? v / count : null,
            temp: t_count > 0 ? t / t_count : null,
            dwpt: t_count > 0 ? td / t_count : null,
            pressure: t_count > 0 ? p / t_count : null
          });
        }
      }

      // We don't have mean 'indices' directly, we will let StatsCharts display the distributions
      const meanData: PythonSoundingData = {
          profile: meanProfile,
          parcel: [],
          indices: processedObjList[0]?.indices // dummy fallback
      };

      setAverageData(meanData);
      addToast(`Média termodinâmica gerada com base em ${processedObjList.length} perfis!`, 'success');
    } catch (err: any) {
        addToast('Erro ao gerar média: certifique-se que o backend Python Engine está rodando. ' + err.message, 'error');
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

  const currentDisplay = averageData || activeData;

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
                Hodograph & Skew-T Engine
              </h1>
              <p className="text-slate-500 text-sm">Motor Server-Side (Python SHARPpy) p/ Termodinâmica Global</p>
            </div>
          </div>
          <div className="flex gap-3">
              <button 
                onClick={generateAverageSounding}
                disabled={isAveraging || tracks.length === 0}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-slate-950 text-sm font-bold transition-colors disabled:opacity-50"
              >
                {isAveraging ? <Loader2 className="w-4 h-4 animate-spin" /> : <TrendingUp className="w-4 h-4" />}
                Processar Skew-T Média
              </button>
          </div>
        </div>

        <div className="flex gap-6 relative">
          {/* List of Tracks (Collapsible Sidebar) */}
          <div className={`${isSidebarOpen ? 'w-full lg:w-1/4' : 'w-0 overflow-hidden'} transition-all duration-300 ease-in-out space-y-4 relative`}>
            {isSidebarOpen && (
              <>
                <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
                  <FileText className="w-5 h-5 text-cyan-400" />
                  CSVs (Sondagens)
                </h2>
                <div className="space-y-3 overflow-y-auto max-h-[75vh] pr-2 custom-scrollbar">
                  {tracks.length === 0 ? (
                    <div className="p-8 text-center bg-slate-900/50 rounded-xl border border-dashed border-slate-800">
                      <p className="text-slate-500 text-sm">Sem arquivos registrados.</p>
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
                              <span className="text-[10px] text-slate-400 truncate flex-1" title={file.name}>{file.name}</span>
                              <button 
                                onClick={() => processSounding(track, file.url, file.name)}
                                disabled={processingId !== null || isAveraging}
                                className="p-1.5 rounded bg-cyan-500/10 text-cyan-500 hover:bg-cyan-500 hover:text-black disabled:opacity-50 transition-all"
                                title="Processar Individualmente"
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
              </>
            )}
          </div>

          {/* Visualization Area */}
          <div className={`${isSidebarOpen ? 'lg:w-3/4' : 'w-full'} flex-1 transition-all duration-300 ease-in-out`}>
            <div className="relative h-full">
              {/* Toggle Button */}
              <button 
                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                className="absolute -left-3 top-4 z-20 p-1.5 rounded-full bg-slate-800 border border-slate-700 text-slate-400 hover:text-white hover:bg-slate-700 transition-all shadow-lg"
                title={isSidebarOpen ? "Recolher Menu" : "Expandir Menu"}
              >
                {isSidebarOpen ? <ChevronLeft className="w-4 h-4" /> : <List className="w-4 h-4" />}
              </button>

              {!currentDisplay ? (
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 min-h-[500px] h-full flex flex-col items-center justify-center shadow-2xl">
                  <Wind className="w-16 h-16 text-slate-800 mb-4" />
                  <h3 className="text-xl font-bold text-slate-400">Motor de Termodinâmica Inativo</h3>
                  <p className="text-slate-600 text-sm max-w-sm mt-2 text-center">Inicie o cálculo para carregar os arrays de parcelas adiabáticas.</p>
                </div>
              ) : (
                <div className="space-y-6 animate-in fade-in duration-500">
                  <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-2xl">
                    <div className="border-b border-slate-800 pb-4 mb-6 flex justify-between items-end">
                      <div>
                        <h3 className="text-xl font-bold text-amber-500">
                          {averageData ? 'Composição Estocástica' : 'Análise Convectiva Individual'}
                        </h3>
                        <p className="text-sm text-slate-400">{activeTrackName}</p>
                      </div>
                      {averageData && (
                        <span className="text-xs bg-cyan-500/20 text-cyan-400 border border-cyan-500/50 px-3 py-1.5 rounded-full font-bold">
                          {allSoundingsData.length} Perfis
                        </span>
                      )}
                    </div>
                    
                    {currentDisplay.base64_img && !currentDisplay.base64_img.startsWith("ERROR:") ? (
                      <div className="w-full bg-slate-900 rounded-xl overflow-hidden shadow-2xl flex flex-col items-center gap-4">
                        <div className="w-full bg-white p-2 flex justify-center items-center border-4 border-slate-800 rounded-lg shadow-inner">
                          <img 
                            src={currentDisplay.base64_img} 
                            alt="Professional Skew-T" 
                            className="w-full h-auto object-contain max-h-[85vh]" 
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-8">
                        {currentDisplay.base64_img && currentDisplay.base64_img.startsWith("ERROR:") && (
                          <div className="p-4 bg-red-500/10 border border-red-500/50 rounded-lg text-red-400 text-sm font-mono">
                            <strong>Erro na Renderização:</strong> {currentDisplay.base64_img.replace("ERROR:", "")}
                          </div>
                        )}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                           <div className="space-y-2">
                               <h4 className="text-sm font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2"><Wind className="w-4 h-4"/> Skew-T (Legado)</h4>
                               <SkewTChart data={currentDisplay} meanData={averageData} />
                           </div>
                           <div className="space-y-2">
                               <h4 className="text-sm font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2"><TrendingUp className="w-4 h-4"/> Hodógrafa (Legado)</h4>
                               <div className="bg-slate-50 aspect-square rounded-xl relative p-2 overflow-hidden shadow-inner">
                                 <HodographChart 
                                   data={(currentDisplay.profile || []).filter(p => p.u !== null && p.height <= 12100).map(p => ({ u: p.u, v: p.v, height: p.height }))} 
                                   backgroundData={averageData ? allSoundingsData.map(d => (d.profile || []).filter(p => p.u !== null && p.height <= 12100).map(p => ({ u: p.u, v: p.v, height: p.height }))) : undefined}
                                 />
                               </div>
                           </div>
                        </div>
                        
                        {/* Stats Cards (Fallback) */}
                        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl">
                            <h4 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">Índices de Severidade</h4>
                            {averageData ? (
                               <StatsCharts dataList={allSoundingsData} />
                            ) : (
                               <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                   {Object.entries(currentDisplay.indices).map(([k, v]) => (
                                       <div key={k} className="bg-slate-800/50 p-3 rounded-lg border border-slate-700">
                                           <p className="text-[10px] text-slate-400 uppercase font-bold">{k}</p>
                                           <p className="text-lg font-bold text-white">{(v as number).toFixed(1)}</p>
                                       </div>
                                   ))}
                               </div>
                            )}
                        </div>
                      </div>
                    )}
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

// --- Hodograph Chart Local Component (kept for compatibility) ---
function HodographChart({ data, backgroundData }: { data: any[], backgroundData?: any[][] }) {
  const size = 400;
  const padding = 25;
  const center = size / 2;
  
  const allPoints = backgroundData ? [...data, ...backgroundData.flat()] : data;
  if(allPoints.length === 0) return null;

  const maxAmp = Math.max(...allPoints.map(d => Math.abs(d.u || 0)), ...allPoints.map(d => Math.abs(d.v || 0)), 40);
  const scale = (size / 2 - padding) / maxAmp;
  
  const getSegmentColor = (h: number) => {
    if (h <= 1000) return '#cf0af0'; 
    if (h <= 3000) return '#ff0000'; 
    if (h <= 6000) return '#ff9100'; 
    if (h <= 9000) return '#ffff00'; 
    if (h <= 12000) return '#00f2ff'; 
    return '#cbd5e1';
  };

  const guides = [10, 20, 30, 40, 50, 60, 75, 100].filter(g => g <= maxAmp * 1.5);
  if (guides.length === 0) guides.push(20);

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
            <text x={center + 2} y={center - g * scale - 2} className="fill-slate-400 text-[9px] font-medium">{g}</text>
          </g>
        ))}

        <text x={size-padding-15} y={center-5} className="fill-slate-400 text-[10px] italic">u</text>
        <text x={center+5} y={padding+10} className="fill-slate-400 text-[10px] italic">v</text>

        {/* Background Shadows */}
        {backgroundData?.map((points, pIdx) => (
          <polyline
            key={pIdx}
            points={points.filter(p => p.height <= 12050 && p.u).map(p => `${center + p.u * scale},${center - p.v * scale}`).join(' ')}
            fill="none" stroke="#cbd5e1" strokeWidth="1.2" strokeOpacity="0.4"
          />
        ))}

        {/* Main Line */}
        {data.slice(0, -1).map((d, i) => {
          const next = data[i+1];
          if(!d.u || !next.u) return null;
          const x1 = center + d.u * scale; const y1 = center - d.v * scale;
          const x2 = center + next.u * scale; const y2 = center - next.v * scale;
          
          return (
            <line 
              key={i} x1={x1} y1={y1} x2={x2} y2={y2} 
              stroke={getSegmentColor(next.height)} 
              strokeWidth={backgroundData ? "5.5" : "4"} 
              strokeLinecap="round" 
              className={backgroundData ? "drop-shadow-[0_0_4px_rgba(255,255,255,0.8)]" : ""}
            />
          );
        })}

        {/* Points */}
        {(() => {
          const drawnLabels = new Set<number>();
          return data.map((d, i) => {
            if(!d.u) return null;
            const hKm = Math.round(d.height / 1000);
            const isLabelHeight = heightLabels.some(lh => Math.abs(d.height - lh) < 100) || i === 0;

            if (!isLabelHeight || drawnLabels.has(hKm)) return null;
            drawnLabels.add(hKm);

            const x = center + d.u * scale;
            const y = center - d.v * scale;

            return (
              <g key={i}>
                <circle cx={x} cy={y} r={backgroundData ? "3.5" : "2.5"} fill={backgroundData ? "white" : "black"} />
                <text x={x+5} y={y-5} className="text-[12px] font-bold select-none pointer-events-none stroke-white stroke-[0.5px] fill-black">
                  {hKm}
                </text>
              </g>
            );
          });
        })()}
      </svg>
    </div>
  );
}
