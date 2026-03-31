'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, SkipBack, SkipForward } from 'lucide-react';

const VARIABLE_CATEGORIES: Record<string, string[]> = {
  'Precipitação / Radar': ['hrt01km', 'hrt03km', 'mdbz'],
  'Convecção / Severo': ['mucape', 'mlcape', 'mllr', 'sblcl'],
  'Superfície / Termodinâmica': ['T2m', 'Td_2m', 'Thetae_2m']
};

const VARIABLE_LABELS: Record<string, string> = {
  hrt01km: 'Refletividade Simulada (1km)',
  hrt03km: 'Refletividade Simulada (3km)',
  mdbz: 'Refletividade Máxima (Max dBZ)',
  mlcape: 'Mixed Layer CAPE',
  mllr: 'Mid-Level Lapse Rate',
  mucape: 'Most Unstable CAPE',
  sblcl: 'Surface-Based LCL',
  T2m: 'Temperatura (2m)',
  Td_2m: 'Ponto de Orvalho (2m)',
  Thetae_2m: 'Temp. Potencial Equiv. (2m)'
};

function formatRunName(run: string) {
  const match = run.match(/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$/);
  if (match) {
    const [, y, m, d, H, M] = match;
    return `${d}/${m}/${y} ${H}:${M}Z`;
  }
  return run;
}

function formatFileNameToHour(name: string) {
  const match = name.match(/_(\d{2})(\d{2})(\d{2})\./);
  if (match) {
    const [, H, M] = match;
    return `${H}:${M}Z`;
  }
  return name.replace(/\.\w+$/, '');
}

export default function NumericModelPage() {
  const [isMounted, setIsMounted] = useState(false);

  const [runs, setRuns] = useState<string[]>([]);
  const [selectedRun, setSelectedRun] = useState<string>('');
  
  const [availableVariables, setAvailableVariables] = useState<string[]>([]);
  const [selectedVariable, setSelectedVariable] = useState<string>('mllr'); // Fallback para a variavel pedida
  
  const [images, setImages] = useState<{name: string, url: string}[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [playSpeed, setPlaySpeed] = useState(300); // ms per frame
  const [isLoading, setIsLoading] = useState(true);

  // Preloading state
  const preloadedImagesRef = useRef<Set<string>>(new Set());

  // Mount
  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Fetch Runs on mount
  useEffect(() => {
    if (!isMounted) return;
    
    setIsLoading(true);
    fetch('/api/model-images?action=listRuns')
      .then(r => r.json())
      .then(data => {
        if (data.runs && data.runs.length > 0) {
          setRuns(data.runs);
          setSelectedRun(data.runs[0]);
        } else {
          setIsLoading(false);
        }
      })
      .catch(err => {
        console.error("Erro ao listar runs:", err);
        setIsLoading(false);
      });
  }, [isMounted]);

  // Fetch variables when run changes
  useEffect(() => {
    if (!selectedRun) return;
    setIsLoading(true);
    fetch(`/api/model-images?action=listVariables&run=${selectedRun}`)
      .then(r => r.json())
      .then(data => {
        if (data.variables) {
          setAvailableVariables(data.variables);
          if (!data.variables.includes(selectedVariable) && data.variables.length > 0) {
            setSelectedVariable(data.variables[0]);
          }
        }
      })
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, [selectedRun, selectedVariable]); 

  // Fetch images when run or variable changes
  useEffect(() => {
    if (!selectedRun || !selectedVariable) return;
    setIsLoading(true);
    setImages([]);
    setCurrentIndex(0);
    setIsPlaying(false);
    
    fetch(`/api/model-images?action=getImages&run=${selectedRun}&variable=${selectedVariable}`)
      .then(r => {
        if (!r.ok) throw new Error("Erro da API: " + r.status);
        return r.json();
      })
      .then(data => {
        if (data.images && data.images.length > 0) {
          setImages(data.images);
          preloadImages(data.images.map((i: any) => i.url));
        } else {
          setImages([]);
        }
      })
      .catch(err => {
        console.error("Erro ao buscar imagens:", err);
        setImages([]);
      })
      .finally(() => setIsLoading(false));
  }, [selectedRun, selectedVariable]);

  const preloadImages = (urls: string[]) => {
    urls.forEach(url => {
      if (preloadedImagesRef.current.has(url)) return;
      const img = new Image();
      img.src = url;
      preloadedImagesRef.current.add(url);
    });
  };

  // Playback logic
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isPlaying && images.length > 0) {
      interval = setInterval(() => {
        setCurrentIndex(prev => (prev + 1) % images.length);
      }, playSpeed);
    }
    return () => clearInterval(interval);
  }, [isPlaying, images.length, playSpeed]);

  if (!isMounted) return <div className="min-h-screen bg-neutral-900" />;

  const togglePlay = () => setIsPlaying(!isPlaying);
  const nextFrame = () => { setIsPlaying(false); setCurrentIndex(prev => (prev + 1) % images.length); };
  const prevFrame = () => { setIsPlaying(false); setCurrentIndex(prev => (prev - 1 + images.length) % images.length); };
  
  // Categorize available variables
  const uncategorizedVariables = availableVariables.filter(v => 
    !Object.values(VARIABLE_CATEGORIES).flat().includes(v)
  );

  return (
    <div className="flex flex-col h-screen bg-neutral-900 text-white font-sans overflow-hidden">
      {/* HEADER */}
      <header className="flex items-center justify-between px-6 py-3 bg-neutral-950 border-b border-neutral-800 shrink-0">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold tracking-tight text-blue-400">Modelo WRF 3km</h1>
          <div className="h-6 w-px bg-neutral-700"></div>
          
          <div className="flex items-center gap-2">
            <span className="text-sm text-neutral-400 font-medium">Rodada:</span>
            <select 
              className="bg-neutral-800 border border-neutral-700 text-sm rounded-md px-3 py-1.5 outline-none focus:border-blue-500 transition-colors"
              value={selectedRun}
              onChange={e => setSelectedRun(e.target.value)}
              disabled={isLoading || runs.length === 0}
            >
              {runs.map(run => (
                <option key={run} value={run}>{formatRunName(run)}</option>
              ))}
              {runs.length === 0 && <option>Carregando...</option>}
            </select>
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden relative">
        {/* SIDEBAR */}
        <aside className="w-72 bg-neutral-950 border-r border-neutral-800 flex flex-col overflow-y-auto custom-scrollbar shrink-0">
          <div className="p-4">
            <h2 className="text-xs font-bold text-neutral-500 uppercase tracking-wider mb-4">Variáveis (Produtos)</h2>
            
            <div className="space-y-6">
              {Object.entries(VARIABLE_CATEGORIES).map(([category, vars]) => {
                const activeVars = vars.filter(v => availableVariables.includes(v));
                if (activeVars.length === 0) return null;
                
                return (
                  <div key={category}>
                    <h3 className="text-sm font-semibold text-neutral-300 mb-2">{category}</h3>
                    <div className="flex flex-col gap-1">
                      {activeVars.map(v => (
                        <button
                          key={v}
                          onClick={() => setSelectedVariable(v)}
                          className={`text-left px-3 py-2 rounded-md text-sm transition-all ${
                            selectedVariable === v 
                              ? 'bg-blue-600 text-white font-medium shadow-sm' 
                              : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
                          }`}
                        >
                          {VARIABLE_LABELS[v] || v}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}

              {uncategorizedVariables.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-neutral-300 mb-2">Outros</h3>
                  <div className="flex flex-col gap-1">
                    {uncategorizedVariables.map(v => (
                      <button
                        key={v}
                        onClick={() => setSelectedVariable(v)}
                        className={`text-left px-3 py-2 rounded-md text-sm transition-all ${
                          selectedVariable === v 
                            ? 'bg-blue-600 text-white font-medium' 
                            : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
                        }`}
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </aside>

        {/* MAIN VIEWER */}
        <main className="flex-1 bg-black relative flex flex-col">
          {isLoading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/50 backdrop-blur-sm">
              <div className="animate-spin rounded-full h-12 w-12 border-4 border-neutral-600 border-t-blue-500"></div>
            </div>
          )}
          
          <div className="flex-1 relative overflow-hidden flex items-center justify-center p-4">
            {images.length > 0 ? (
              <img 
                src={images[currentIndex]?.url} 
                alt={`Forecast frame ${currentIndex}`}
                className="max-w-full max-h-full object-contain"
                loading="eager"
              />
            ) : (
              !isLoading && (
                <div className="text-neutral-500 flex flex-col items-center">
                  <div className="text-4xl mb-2">🌩️</div>
                  <p>Nenhuma imagem disponível para esta seleção.</p>
                </div>
              )
            )}
            
            {/* INVISIBLE PRELOAD CONTAINER - Ensures browser caches the next frames */}
            <div className="hidden">
              {images.map((img, idx) => (
                <img key={idx} src={img.url} alt="preload" />
              ))}
            </div>
          </div>

          {/* BOTTOM PLAYBACK CONTROLS */}
          {images.length > 0 && (
            <div className="h-16 bg-neutral-950 border-t border-neutral-800 flex items-center px-4 gap-4 shrink-0">
              <div className="flex items-center gap-2">
                <button onClick={prevFrame} className="p-2 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded-full transition-colors">
                  <SkipBack size={20} />
                </button>
                <button 
                  onClick={togglePlay} 
                  className="p-3 bg-blue-600 hover:bg-blue-500 text-white rounded-full transition-colors shadow-md flex items-center justify-center"
                >
                  {isPlaying ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" className="ml-1" />}
                </button>
                <button onClick={nextFrame} className="p-2 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded-full transition-colors">
                  <SkipForward size={20} />
                </button>
              </div>

              <div className="flex-1 flex flex-col justify-center px-4">
                <input 
                  type="range" 
                  min={0} 
                  max={images.length - 1} 
                  value={currentIndex}
                  onChange={(e) => { setIsPlaying(false); setCurrentIndex(Number(e.target.value)); }}
                  className="w-full h-2 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                />
                <div className="flex justify-between text-xs text-neutral-500 mt-1 font-medium">
                  <span>Início</span>
                  <span className="text-blue-400 font-bold">{formatFileNameToHour(images[currentIndex]?.name || '')}</span>
                  <span>Fim</span>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <span className="text-xs text-neutral-400 font-medium">Velocidade:</span>
                <select 
                  className="bg-neutral-800 border border-neutral-700 text-xs rounded px-2 py-1 outline-none text-neutral-200"
                  value={playSpeed}
                  onChange={e => setPlaySpeed(Number(e.target.value))}
                >
                  <option value={800}>Lenta</option>
                  <option value={300}>Normal</option>
                  <option value={100}>Rápida</option>
                  <option value={50}>Muito Rápida</option>
                </select>
              </div>
            </div>
          )}
        </main>
      </div>

      <style dangerouslySetInnerHTML={{__html: `
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background-color: #3f3f46;
          border-radius: 20px;
        }
      `}} />
    </div>
  );
}
