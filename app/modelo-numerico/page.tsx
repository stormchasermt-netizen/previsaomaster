'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, SkipBack, SkipForward } from 'lucide-react';

const VARIABLE_CATEGORIES: Record<string, string[]> = {
  'Severo': ['hrt01km', 'hrt03km', 'mllr', 'mlcape', 'mucape', 'sblcl'],
  'Atributos da Tempestade': ['mdbz'],
  'Sinótico': ['T2m', 'Td_2m', 'Thetae_2m']
};

const VARIABLE_LABELS: Record<string, string> = {
  hrt01km: 'Helicidade Relativa à Tempestade (Sfc - 1km)',
  hrt03km: 'Helicidade Relativa à Tempestade (Sfc - 3km)',
  mdbz: 'Refletividade Máxima',
  mlcape: 'ml-CAPE',
  mllr: 'ml-Lapse-rate',
  mucape: 'mu-CAPE',
  sblcl: 'sb-LCL',
  T2m: 'Temperatura (2m)',
  Td_2m: 'Temperatura do Ponto de Orvalho',
  Thetae_2m: 'Theta-e (2m)'
};

function formatRunDateTime(run: string) {
  const match = run.match(/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$/);
  if (match) {
    const [, y, m, d, H, M] = match;
    return `${d}/${m}/${y} ${H}:${M} UTC`;
  }
  return run;
}

function formatValidDateTime(name: string) {
  const match = name.match(/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})\./);
  if (match) {
    const [, y, m, d, H, M] = match;
    return `${d}/${m}/${y} ${H}:${M} UTC`;
  }
  return name.replace(/\.\w+$/, '');
}

function getForecastHour(run: string, name: string, idx: number) {
  const matchRun = run.match(/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$/);
  const matchName = name.match(/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})\./);
  
  if (matchRun && matchName) {
    const d1 = Date.UTC(+matchRun[1], +matchRun[2] - 1, +matchRun[3], +matchRun[4], +matchRun[5]);
    const d2 = Date.UTC(+matchName[1], +matchName[2] - 1, +matchName[3], +matchName[4], +matchName[5]);
    const diffHrs = Math.round((d2 - d1) / 3600000);
    return diffHrs;
  }
  return idx;
}

export default function NumericModelPage() {
  const [isMounted, setIsMounted] = useState(false);

  const [runs, setRuns] = useState<string[]>([]);
  const [selectedRun, setSelectedRun] = useState<string>('');
  
  const [availableVariables, setAvailableVariables] = useState<string[]>([]);
  const [selectedVariable, setSelectedVariable] = useState<string>('mllr'); // Fallback para a variavel pedida
  
  const [images, setImages] = useState<{name: string, url: string}[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const prevIndexRef = useRef<number>(0);

  useEffect(() => {
    prevIndexRef.current = currentIndex;
  }, [currentIndex]);
  
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
    <div className="flex flex-col h-screen bg-white text-black font-sans overflow-hidden">
      {/* HEADER */}
      <header className="flex items-center justify-between px-6 py-3 bg-white border-b border-gray-200 shrink-0">
        <div className="flex items-center w-full relative">
          
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600 font-bold">Data:</span>
              <select 
                className="bg-gray-50 border border-gray-300 text-sm rounded-md px-3 py-1 outline-none focus:border-blue-500 font-medium"
                value={selectedRun}
                onChange={e => setSelectedRun(e.target.value)}
                disabled={isLoading || runs.length === 0}
              >
                {runs.map(run => (
                  <option key={run} value={run}>{formatRunDateTime(run).split(' ')[0]}</option>
                ))}
                {runs.length === 0 && <option>Carregando...</option>}
              </select>
            </div>
            
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600 font-bold">Rodada:</span>
              <select 
                className="bg-gray-50 border border-gray-300 text-sm rounded-md px-3 py-1 outline-none focus:border-blue-500 font-medium"
                value={selectedRun}
                onChange={e => setSelectedRun(e.target.value)}
                disabled={isLoading || runs.length === 0}
              >
                {runs.map(run => (
                  <option key={run} value={run}>{formatRunDateTime(run).split(' ').slice(1).join(' ')}</option>
                ))}
                {runs.length === 0 && <option>Carregando...</option>}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600 font-bold">Domínio:</span>
              <select 
                className="bg-gray-50 border border-gray-300 text-sm rounded-md px-3 py-1 outline-none focus:border-blue-500 font-medium"
                defaultValue="Centro-Sul"
              >
                <option value="Centro-Sul">Centro-Sul</option>
              </select>
            </div>
          </div>
          
          <div className="absolute right-0 top-0 bg-[#00174b] text-white px-6 py-2 rounded-bl-lg font-bold shadow-md text-lg tracking-wider border-b border-l border-blue-800">
            WRF3km
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

          {/* TOP SPC-STYLE TIMELINE */}
          {images.length > 0 && (
            <div className="w-full flex bg-neutral-900 border-b border-neutral-800 text-[10px] sm:text-xs font-mono select-none overflow-x-auto custom-scrollbar shrink-0">
              <div className="flex items-center px-2 py-1.5 text-neutral-500 font-bold border-r border-neutral-800 shrink-0">
                F+
              </div>
              {images.map((img, idx) => {
                const fHour = getForecastHour(selectedRun, img.name, idx);
                return (
                  <div
                    key={idx}
                    className={`flex-1 min-w-[28px] text-center py-1.5 cursor-crosshair border-r border-neutral-800 last:border-0 hover:bg-neutral-700 hover:text-white transition-colors ${
                      idx === currentIndex ? 'bg-blue-600 text-white font-bold hover:bg-blue-500' : 'text-neutral-400'
                    }`}
                    onMouseEnter={() => {
                      if (currentIndex !== idx) {
                        setCurrentIndex(idx);
                        setIsPlaying(false);
                      }
                    }}
                    onClick={() => {
                      setCurrentIndex(idx);
                      setIsPlaying(false);
                    }}
                  >
                    {String(fHour).padStart(2, '0')}
                  </div>
                );
              })}
            </div>
          )}
          
          <div className="flex-1 relative overflow-hidden flex items-center justify-center p-4 bg-neutral-900/50">
            {images.length > 0 && (
              <div className="absolute top-4 right-4 z-20 flex flex-col items-end gap-1 font-mono text-sm sm:text-base bg-black/60 backdrop-blur-md text-white p-3 rounded-md shadow-lg border border-neutral-700 pointer-events-none">
                <div className="flex gap-2">
                  <span className="text-neutral-400 font-medium">Rodada:</span> 
                  <span className="font-bold">{formatRunDateTime(selectedRun)}</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-neutral-400 font-medium">Validade:</span> 
                  <span className="font-bold text-blue-400">{formatValidDateTime(images[currentIndex]?.name || '')}</span>
                </div>
              </div>
            )}

            {images.length > 0 ? (
              images.map((img, idx) => {
                const isCurrent = idx === currentIndex;
                const isPrev = idx === prevIndexRef.current && !isCurrent;
                
                return (
                  <img 
                    key={img.url}
                    src={img.url} 
                    alt={`Forecast frame ${idx}`}
                    className={`absolute max-w-full max-h-full object-contain will-change-opacity pointer-events-none transition-opacity ${
                      isCurrent 
                        ? (isPlaying && playSpeed <= 100 ? 'opacity-100 z-10 duration-0 ease-linear' : 'opacity-100 z-10 duration-150 ease-in')
                        : isPrev 
                          ? 'opacity-100 z-0 duration-300 ease-out' 
                          : 'opacity-0 z-0 duration-0 ease-linear'
                    }`}
                  />
                );
              })
            ) : (
              !isLoading && (
                <div className="text-neutral-500 flex flex-col items-center">
                  <div className="text-4xl mb-2">🌩️</div>
                  <p>Nenhuma imagem disponível para esta seleção.</p>
                </div>
              )
            )}
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

              <div className="flex-1"></div>

              <div className="flex items-center gap-3">
                <span className="text-xs text-neutral-400 font-medium">Velocidade:</span>
                <select 
                  className="bg-neutral-800 border border-neutral-700 text-xs rounded px-2 py-1 outline-none text-neutral-200 focus:border-blue-500"
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
