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

  // Renderiza de forma sincrona sem delay de opacity
  // Preload approach for images to avoid flickering quando altera src ou oculta
  useEffect(() => {
    images.forEach(img => {
      const i = new window.Image();
      i.src = img.url;
    });
  }, [images]);

  if (!isMounted) return null;

  return (
    <div className="flex flex-col h-screen bg-white text-black font-sans overflow-hidden">
      {/* HEADER */}
      <header className="flex items-center justify-between px-6 py-3 bg-white border-b border-gray-200 shrink-0">
        <div className="flex items-center w-full relative">
          
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600 font-bold">Data:</span>
              <select 
                className="bg-gray-50 border border-gray-300 text-sm rounded-md px-3 py-1 outline-none focus:border-blue-500 font-medium cursor-pointer"
                value={selectedRun ? selectedRun.substring(0, 8) : ''}
                onChange={e => {
                  const newDate = e.target.value;
                  const firstRunOfDate = runs.find(r => r.startsWith(newDate));
                  if (firstRunOfDate) setSelectedRun(firstRunOfDate);
                }}
                disabled={isLoading || runs.length === 0}
              >
                {Array.from(new Set(runs.map(run => run.substring(0, 8)))).map(dateStr => (
                  <option key={dateStr} value={dateStr}>
                    {`${dateStr.substring(6, 8)}/${dateStr.substring(4, 6)}/${dateStr.substring(0, 4)}`}
                  </option>
                ))}
                {runs.length === 0 && <option value="">Carregando...</option>}
              </select>
            </div>
            
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600 font-bold">Rodada:</span>
              <select 
                className="bg-gray-50 border border-gray-300 text-sm rounded-md px-3 py-1 outline-none focus:border-blue-500 font-medium cursor-pointer"
                value={selectedRun}
                onChange={e => setSelectedRun(e.target.value)}
                disabled={isLoading || runs.length === 0}
              >
                {runs
                  .filter(run => selectedRun && run.startsWith(selectedRun.substring(0, 8)))
                  .map(run => (
                  <option key={run} value={run}>
                    {`${run.substring(9, 11)}:${run.substring(11, 13)} UTC`}
                  </option>
                ))}
                {runs.length === 0 && <option value="">Carregando...</option>}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600 font-bold">Domínio:</span>
              <select 
                className="bg-gray-100 border border-gray-300 text-sm rounded-md px-3 py-1 outline-none font-medium cursor-not-allowed text-gray-500"
                defaultValue="Centro-Sul"
                disabled
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
        <aside className="w-72 bg-gray-50 border-r border-gray-200 flex flex-col overflow-y-auto custom-scrollbar shrink-0">
          <div className="p-4">
            <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-4">Variáveis (Produtos)</h2>
            
            <div className="space-y-6">
              {Object.entries(VARIABLE_CATEGORIES).map(([category, vars]) => {
                const activeVars = vars.filter(v => availableVariables.includes(v));
                if (activeVars.length === 0) return null;
                
                return (
                  <div key={category}>
                    <h3 className="text-sm font-bold text-gray-800 mb-2 border-b border-gray-200 pb-1">{category}</h3>
                    <div className="flex flex-col gap-1">
                      {activeVars.map(v => (
                        <button
                          key={v}
                          onClick={() => setSelectedVariable(v)}
                          className={`text-left px-3 py-2 rounded-md text-sm transition-all ${
                            selectedVariable === v 
                              ? 'bg-blue-800 text-white font-medium shadow-sm' 
                              : 'text-gray-600 hover:bg-gray-200 hover:text-gray-900 font-medium'
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
                  <h3 className="text-sm font-bold text-gray-800 mb-2 border-b border-gray-200 pb-1">Outros</h3>
                  <div className="flex flex-col gap-1">
                    {uncategorizedVariables.map(v => (
                      <button
                        key={v}
                        onClick={() => setSelectedVariable(v)}
                        className={`text-left px-3 py-2 rounded-md text-sm transition-all ${
                          selectedVariable === v 
                            ? 'bg-blue-800 text-white font-medium shadow-sm' 
                            : 'text-gray-600 hover:bg-gray-200 hover:text-gray-900 font-medium'
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
        <main className="flex-1 bg-white relative flex flex-col">
          {isLoading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/50 backdrop-blur-sm">
              <div className="animate-spin rounded-full h-12 w-12 border-4 border-gray-400 border-t-blue-800"></div>
            </div>
          )}

          {/* TOP SPC-STYLE TIMELINE */}
          {images.length > 0 && (
            <div className="w-full flex bg-gray-100 border-b border-gray-300 text-[10px] sm:text-xs font-mono select-none overflow-x-auto custom-scrollbar shrink-0 shadow-sm z-20">
              <div className="flex items-center px-2 py-1.5 text-gray-500 font-bold border-r border-gray-300 shrink-0 bg-gray-200">
                F+
              </div>
              {images.map((img, idx) => {
                const fHour = getForecastHour(selectedRun, img.name, idx);
                return (
                  <div
                    key={idx}
                    className={`flex-1 min-w-[28px] text-center py-1.5 cursor-crosshair border-r border-gray-300 last:border-0 hover:bg-blue-100 hover:text-blue-900 transition-colors ${
                      idx === currentIndex ? 'bg-blue-800 text-white font-bold hover:bg-blue-700' : 'text-gray-600 font-medium'
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
          
          <div className="flex-1 relative overflow-hidden flex items-center justify-center bg-white p-2">
            {images.length > 0 && (
              <div className="absolute top-2 right-2 z-20 flex flex-col items-end gap-0.5 font-mono text-sm sm:text-base text-gray-800 pointer-events-none">
                <div className="flex gap-2 items-baseline">
                  <span className="text-gray-500 font-bold text-xs uppercase tracking-wide">Run:</span> 
                  <span className="font-bold text-sm bg-gray-100 px-2 border border-gray-200 rounded">{formatRunDateTime(selectedRun)}</span>
                </div>
                <div className="flex gap-2 items-baseline mt-1">
                  <span className="text-gray-500 font-bold text-xs uppercase tracking-wide">Valid:</span> 
                  <span className="font-bold text-sm bg-blue-100 text-blue-900 px-2 border border-blue-200 rounded">{formatValidDateTime(images[currentIndex]?.name || '')}</span>
                </div>
              </div>
            )}

            {images.length > 0 ? (
              images.map((img, idx) => {
                const isCurrent = idx === currentIndex;
                
                // NO SPC, a troca é SECA E DIRETA (flicker free porque o browser cacheia e renderiza na hora)
                // Não usamos transition-opacity para drag/hover, pois isso causa o "fade preto" indesejado em trocas rápidas.
                
                return (
                  <img 
                    key={img.url}
                    src={img.url} 
                    alt={`Forecast frame ${idx}`}
                    className={`absolute max-w-full max-h-full object-contain pointer-events-none ${
                      isCurrent ? 'block z-10' : 'hidden z-0'
                    }`}
                  />
                );
              })
            ) : (
              !isLoading && (
                <div className="text-gray-400 flex flex-col items-center">
                  <div className="text-4xl mb-2">🌩️</div>
                  <p>Nenhuma imagem disponível para esta seleção.</p>
                </div>
              )
            )}
          </div>

          {/* BOTTOM PLAYBACK CONTROLS */}
          {images.length > 0 && (
            <div className="h-14 bg-gray-100 border-t border-gray-300 flex items-center px-4 gap-4 shrink-0 shadow-inner z-20">
              <div className="flex items-center gap-2">
                <button onClick={prevFrame} className="p-2 text-gray-600 hover:text-blue-800 hover:bg-gray-200 rounded-full transition-colors">
                  <SkipBack size={20} />
                </button>
                <button 
                  onClick={togglePlay} 
                  className="p-2.5 bg-blue-800 hover:bg-blue-700 text-white rounded-full transition-colors shadow flex items-center justify-center"
                >
                  {isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" className="ml-0.5" />}
                </button>
                <button onClick={nextFrame} className="p-2 text-gray-600 hover:text-blue-800 hover:bg-gray-200 rounded-full transition-colors">
                  <SkipForward size={20} />
                </button>
              </div>

              <div className="flex-1"></div>

              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-500 font-bold uppercase tracking-wider">Velocidade:</span>
                <select 
                  className="bg-white border border-gray-300 text-xs rounded px-2 py-1 outline-none text-gray-800 focus:border-blue-500 font-medium shadow-sm"
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
