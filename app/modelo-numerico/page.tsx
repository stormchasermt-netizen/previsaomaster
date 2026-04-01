'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import Link from 'next/link';
import { Play, Pause, SkipBack, SkipForward, ChevronLeft, ChevronRight, CloudLightning, Layers } from 'lucide-react';
import {
  parseWrfRunFolder,
  formatRodadaDropdownLabel,
  getForecastHourFromRun,
  domainLabel,
} from '@/lib/wrfModelRuns';
import { getMapBoundsForRunFolder, imagePixelToLatLonParana, isParanaRun } from '@/lib/wrfDomainBounds';

const VARIABLE_CATEGORIES: Record<string, string[]> = {
  'Severo': ['hrt01km', 'hrt03km', 'mllr', 'mlcape', 'mucape', 'sblcl', 'scp', 'stp'],
  'Atributos da Tempestade': ['mdbz'],
  'Sinótico': ['T2m', 'Td_2m', 'Thetae_2m']
};

/** Pastas no bucket que são só overlay — nunca aparecem na lista lateral / Outros */
const OVERLAY_ONLY_VARIABLE_KEYS = new Set(['mlcape_contorno', 'mlcape_contornos']);

function isOverlayOnlyVariableKey(v: string) {
  return OVERLAY_ONLY_VARIABLE_KEYS.has(v);
}

/** Emparelha frame base com overlay pelo timestamp YYYYMMDD_HHMMSS do nome do arquivo */
function findOverlayForBaseName(
  baseFileName: string,
  overlays: { name: string; url: string }[]
): { name: string; url: string } | undefined {
  const ts = baseFileName.match(/^(\d{8}_\d{6})/)?.[1];
  if (!ts) return undefined;
  return overlays.find((o) => o.name.startsWith(ts));
}

  const VARIABLE_LABELS: Record<string, string> = {
    hrt01km: 'Helicidade Relativa à Tempestade (Sfc - 1km)',
    hrt03km: 'Helicidade Relativa à Tempestade (Sfc - 3km)',
    mdbz: 'Refletividade Máxima',
    mlcape: 'ml-CAPE',
    mllr: 'ml-Lapse-rate',
    mucape: 'mu-CAPE',
    sblcl: 'sb-LCL',
    scp: 'Parâmetro Composto de Supercélula (SCP)',
    stp: 'Parâmetro de Tornado Significativo (STP)',
    T2m: 'Temperatura (2m)',
    Td_2m: 'Temperatura do Ponto de Orvalho',
    Thetae_2m: 'Theta-e (2m)'
  };

function formatValidDateTime(name: string) {
  const match = name.match(/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})\./);
  if (match) {
    const [, y, m, d, H, M] = match;
    return `${d}/${m}/${y} ${H}:${M} UTC`;
  }
  return name.replace(/\.\w+$/, '');
}

function getValidDateStr(name: string) {
  const match = name.match(/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})\./);
  if (match) {
    const [, y, m, d] = match;
    const date = new Date(Date.UTC(+y, +m - 1, +d));
    const days = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    return `${days[date.getUTCDay()]} ${d}/${m}`;
  }
  return '';
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

  // States para Sondagem (WRF)
  const [hoverPos, setHoverPos] = useState<{x: number, y: number, lat: number, lon: number} | null>(null);
  const [isSoundingLoading, setIsSoundingLoading] = useState(false);
  const [soundingImageUrl, setSoundingImageUrl] = useState<string | null>(null);
  const [soundingPos, setSoundingPos] = useState<{lat: number, lon: number} | null>(null);
  const [soundingIndex, setSoundingIndex] = useState<number | null>(null);

  // Overlay State (ML-CAPE Contorno)
  const [showOverlayCape, setShowOverlayCape] = useState(false);
  const [overlayImages, setOverlayImages] = useState<{name: string, url: string}[]>([]);
  
  // Premium Popup State
  const [showPremiumPopup, setShowPremiumPopup] = useState(false);

  const parsedSelectedRun = useMemo(() => parseWrfRunFolder(selectedRun), [selectedRun]);
  const selectedDateYmd = parsedSelectedRun?.dateYmd ?? '';

  const uniqueDates = useMemo(() => {
    const set = new Set<string>();
    runs.forEach((r) => {
      const p = parseWrfRunFolder(r);
      if (p) set.add(p.dateYmd);
    });
    return Array.from(set).sort().reverse();
  }, [runs]);

  const domainsForSelectedDate = useMemo(() => {
    const set = new Set<string>();
    runs.forEach((r) => {
      const p = parseWrfRunFolder(r);
      if (p?.dateYmd === selectedDateYmd) set.add(p.domain);
    });
    return Array.from(set).sort((a, b) => {
      const rank = (d: string) => (d === 'centro-sul' ? 0 : d === 'parana' ? 1 : 2);
      return rank(a) - rank(b) || a.localeCompare(b);
    });
  }, [runs, selectedDateYmd]);

  const runsForRodadaDropdown = useMemo(() => {
    const dom = parsedSelectedRun?.domain;
    if (!selectedDateYmd || !dom) return [];
    return runs.filter((r) => {
      const p = parseWrfRunFolder(r);
      return p?.dateYmd === selectedDateYmd && p.domain === dom;
    });
  }, [runs, selectedDateYmd, parsedSelectedRun?.domain]);

  useEffect(() => {
    // Show popup immediately when component mounts
    setShowPremiumPopup(true);
  }, []);
  const mapImageToCoords = (e: React.MouseEvent<HTMLImageElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ox = e.nativeEvent.offsetX;
    const oy = e.nativeEvent.offsetY;

    let lat: number;
    let lon: number;
    if (selectedRun && isParanaRun(selectedRun)) {
      const ll = imagePixelToLatLonParana(ox, oy, rect.width, rect.height);
      lat = ll.lat;
      lon = ll.lon;
    } else {
      const b = getMapBoundsForRunFolder(selectedRun || '');
      const latSpan = b.north - b.south;
      const lonSpan = b.east - b.west;
      lat = b.north - (oy / rect.height) * latSpan;
      lon = b.west + (ox / rect.width) * lonSpan;
    }

    setHoverPos({
      x: ox,
      y: oy,
      lat,
      lon,
    });
  };

  const handleImageClick = async (e: React.MouseEvent<HTMLImageElement>) => {
    if (!hoverPos || !images[currentIndex]) return;
    await fetchSounding(hoverPos.lat, hoverPos.lon, currentIndex);
  };

  const fetchSounding = async (lat: number, lon: number, index: number) => {
    if (!images[index]) return;
    
    setIsSoundingLoading(true);
    setSoundingImageUrl(null);
    setSoundingPos({ lat, lon });
    setSoundingIndex(index);
    
    try {
      // images[index].name é o nome do arquivo
      const res = await fetch('/api/wrf-sounding', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          lat,
          lon,
          fileName: images[index].name
        }),
      });

      if (!res.ok) {
        let detail = '';
        try {
          const ct = res.headers.get('content-type') || '';
          if (ct.includes('application/json')) {
            const j = (await res.json()) as {
              step?: string;
              error?: string;
              details?: string;
            };
            detail = [j.step, j.error, j.details].filter(Boolean).join(' — ');
          }
        } catch {
          /* ignore */
        }
        throw new Error(detail || `Falha ao gerar sondagem (${res.status})`);
      }

      // Recebemos a imagem renderizada como blob (via api interna -> Cloud Run)
      const blob = await res.blob();
      const imageUrl = URL.createObjectURL(blob);
      setSoundingImageUrl(imageUrl);
    } catch (err) {
      console.error(err);
      const msg =
        err instanceof Error && err.message
          ? err.message
          : 'Erro ao buscar ou renderizar sondagem do WRF.';
      alert(msg);
    } finally {
      setIsSoundingLoading(false);
    }
  };

  const closeSounding = () => {
    setSoundingImageUrl(null);
  };



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
          // Remover pastas que são estritamente overlays (nunca produto principal na sidebar)
          const filteredVars = data.variables.filter((v: string) => !isOverlayOnlyVariableKey(v));
          setAvailableVariables(filteredVars);
          if (!filteredVars.includes(selectedVariable) && filteredVars.length > 0) {
            setSelectedVariable(filteredVars[0]);
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
      
    // Fetch Overlay Images se for o caso
    if (selectedVariable === 'hrt01km' || selectedVariable === 'hrt03km') {
      fetch(`/api/model-images?action=getImages&run=${selectedRun}&variable=mlcape_contorno`)
        .then(r => r.ok ? r.json() : { images: [] })
        .then(data => {
          if (data.images) {
            setOverlayImages(data.images);
            preloadImages(data.images.map((i: any) => i.url));
          } else {
            setOverlayImages([]);
          }
        })
        .catch(err => {
          console.error("Erro ao buscar overlay:", err);
          setOverlayImages([]);
        });
    } else {
      setShowOverlayCape(false); // Reseta se mudar pra outra variável
      setOverlayImages([]);
    }
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

  // Preload approach for images to avoid flickering quando altera src ou oculta
  useEffect(() => {
    images.forEach(img => {
      const i = new window.Image();
      i.src = img.url;
    });
  }, [images]);

  if (!isMounted) return <div className="min-h-screen bg-white" />;

  const togglePlay = () => setIsPlaying(!isPlaying);
  const nextFrame = () => { setIsPlaying(false); setCurrentIndex(prev => (prev + 1) % images.length); };
  const prevFrame = () => { setIsPlaying(false); setCurrentIndex(prev => (prev - 1 + images.length) % images.length); };
  
  // Categorize available variables (nunca incluir pastas só-overlay)
  const uncategorizedVariables = availableVariables.filter(
    (v) =>
      !isOverlayOnlyVariableKey(v) &&
      !Object.values(VARIABLE_CATEGORIES).flat().includes(v)
  );

  return (
    <div className="flex flex-col h-[100dvh] bg-white text-black font-sans overflow-hidden">
      {/* HEADER — WRF 3km no canto superior esquerdo; pastas do bucket: YYYYMMDD[_domínio]_HHMMSS */}
      <header className="flex flex-col px-4 sm:px-6 py-2 sm:py-3 bg-white border-b border-gray-200 shrink-0 relative z-20 gap-3">
        <div className="flex flex-wrap items-center gap-3 w-full">
          <div className="bg-[#00174b] text-white px-4 sm:px-5 py-1.5 sm:py-2 rounded-lg font-bold shadow-md text-sm sm:text-base tracking-wider border border-blue-800 shrink-0">
            <CloudLightning size={18} className="hidden sm:inline mr-1 align-text-bottom" />
            WRF 3km
          </div>
          <Link
            href="/"
            className="text-gray-500 hover:text-blue-800 transition-colors flex items-center gap-1 text-sm font-medium"
            title="Voltar"
          >
            <ChevronLeft size={22} />
            <span className="hidden sm:inline">Voltar</span>
          </Link>
        </div>

        <div className="flex w-full">
          <div className="flex gap-2 sm:gap-4 items-center flex-wrap sm:flex-nowrap w-full">
            <div className="flex items-center gap-1 sm:gap-2 flex-1 sm:flex-none min-w-0">
              <span className="text-xs sm:text-sm text-gray-600 font-bold hidden sm:inline shrink-0">Data:</span>
              <select
                className="w-full min-w-0 sm:w-auto bg-gray-50 border border-gray-300 text-xs sm:text-sm rounded-md px-2 sm:px-3 py-1.5 outline-none focus:border-blue-500 font-medium cursor-pointer"
                value={selectedDateYmd}
                onChange={(e) => {
                  const newDate = e.target.value;
                  const candidates = runs.filter((r) => parseWrfRunFolder(r)?.dateYmd === newDate);
                  const curDom = parseWrfRunFolder(selectedRun)?.domain;
                  const sameDom = candidates.find((r) => parseWrfRunFolder(r)?.domain === curDom);
                  setSelectedRun(sameDom ?? candidates[0] ?? '');
                }}
                disabled={isLoading || runs.length === 0}
                suppressHydrationWarning
              >
                {uniqueDates.map((dateStr) => (
                  <option key={dateStr} value={dateStr}>
                    {`${dateStr.substring(6, 8)}/${dateStr.substring(4, 6)}/${dateStr.substring(0, 4)}`}
                  </option>
                ))}
                {runs.length === 0 && <option value="">Carregando...</option>}
              </select>
            </div>

            <div className="flex items-center gap-1 sm:gap-2 flex-1 sm:flex-none min-w-0">
              <span className="text-xs sm:text-sm text-gray-600 font-bold hidden sm:inline shrink-0">Domínio:</span>
              <select
                className="w-full min-w-0 sm:w-auto bg-gray-50 border border-gray-300 text-xs sm:text-sm rounded-md px-2 sm:px-3 py-1.5 outline-none focus:border-blue-500 font-medium cursor-pointer"
                value={
                  parsedSelectedRun && domainsForSelectedDate.includes(parsedSelectedRun.domain)
                    ? parsedSelectedRun.domain
                    : domainsForSelectedDate[0] ?? ''
                }
                onChange={(e) => {
                  const newDom = e.target.value;
                  const candidates = runs.filter((r) => {
                    const p = parseWrfRunFolder(r);
                    return p?.dateYmd === selectedDateYmd && p.domain === newDom;
                  });
                  if (candidates[0]) setSelectedRun(candidates[0]);
                }}
                disabled={isLoading || runs.length === 0 || domainsForSelectedDate.length === 0}
                suppressHydrationWarning
              >
                {domainsForSelectedDate.map((d) => (
                  <option key={d} value={d}>
                    {domainLabel(d)}
                  </option>
                ))}
                {domainsForSelectedDate.length === 0 && runs.length > 0 && (
                  <option value="">—</option>
                )}
              </select>
            </div>

            <div className="flex items-center gap-1 sm:gap-2 flex-1 sm:flex-none min-w-0">
              <span className="text-xs sm:text-sm text-gray-600 font-bold hidden sm:inline shrink-0">Rodada:</span>
              <select
                className="w-full min-w-0 sm:w-auto bg-gray-50 border border-gray-300 text-xs sm:text-sm rounded-md px-2 sm:px-3 py-1.5 outline-none focus:border-blue-500 font-medium cursor-pointer"
                value={selectedRun}
                onChange={(e) => setSelectedRun(e.target.value)}
                disabled={isLoading || runs.length === 0 || runsForRodadaDropdown.length === 0}
                suppressHydrationWarning
              >
                {runsForRodadaDropdown.map((run) => (
                  <option key={run} value={run}>
                    {formatRodadaDropdownLabel(run)}
                  </option>
                ))}
                {runs.length === 0 && <option value="">Carregando...</option>}
              </select>
            </div>
          </div>
        </div>
      </header>

      <div className="flex flex-col sm:flex-row flex-1 overflow-hidden relative h-full">
        {/* MOBILE VARIABLE SELECTOR (Dropdown) */}
        <div className="sm:hidden w-full bg-white border-b border-gray-200 p-2 shrink-0 z-10">
           <select 
              className="w-full bg-blue-50 border border-blue-200 text-blue-900 text-sm rounded-lg px-3 py-2 outline-none focus:border-blue-500 font-bold appearance-none text-center shadow-sm"
              value={selectedVariable}
              onChange={(e) => setSelectedVariable(e.target.value)}
            >
              {Object.entries(VARIABLE_CATEGORIES).map(([category, vars]) => {
                const activeVars = vars.filter(v => availableVariables.includes(v));
                if (activeVars.length === 0) return null;
                
                return (
                  <optgroup key={category} label={category}>
                    {activeVars.map(v => (
                      <option key={v} value={v}>
                        {VARIABLE_LABELS[v] || v}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
              {uncategorizedVariables.length > 0 && (
                <optgroup label="Outros">
                  {uncategorizedVariables.map(v => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
        </div>

        {/* DESKTOP SIDEBAR */}
        <aside className="hidden sm:flex w-72 bg-gray-50 border-r border-gray-200 flex-col overflow-y-auto custom-scrollbar shrink-0">
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
        <main className="flex-1 bg-white relative flex flex-col h-full min-h-0">
          {isLoading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/50 backdrop-blur-sm">
              <div className="animate-spin rounded-full h-12 w-12 border-4 border-gray-400 border-t-blue-800"></div>
            </div>
          )}

          {/* TOP SPC-STYLE TIMELINE */}
          {images.length > 0 && (
            <div className="w-full flex flex-col bg-gray-100 border-b border-gray-300 text-[9px] sm:text-[10px] font-mono select-none overflow-x-auto custom-scrollbar shrink-0 shadow-sm z-20 touch-pan-x">
              
              {/* DATE MARKERS ROW */}
              <div className="flex w-max min-w-full bg-gray-200 border-b border-gray-300 text-gray-700 font-bold sticky top-0 left-0">
                <div className="w-[28px] shrink-0 border-r border-gray-300 bg-gray-200 sticky left-0 z-10"></div>
                {(() => {
                  const days: { label: string, count: number }[] = [];
                  images.forEach(img => {
                    const label = getValidDateStr(img.name);
                    if (days.length === 0 || days[days.length - 1].label !== label) {
                      days.push({ label, count: 1 });
                    } else {
                      days[days.length - 1].count++;
                    }
                  });
                  return days.map((day, i) => (
                    <div 
                      key={i} 
                      className="border-r border-gray-400 px-1 py-0.5" 
                      style={{ width: `${day.count * 20}px`, minWidth: `${day.count * 20}px` }}
                    >
                      {day.label}
                    </div>
                  ));
                })()}
              </div>

              {/* FORECAST HOUR ROW */}
              <div className="flex w-max min-w-full">
                <div className="w-[28px] flex items-center justify-center py-0.5 text-gray-500 font-bold border-r border-gray-300 shrink-0 bg-gray-200 sticky left-0 z-10">
                  F+
                </div>
                {images.map((img, idx) => {
                  const fHour = getForecastHourFromRun(selectedRun, img.name, idx);
                  return (
                    <div
                      key={idx}
                      className={`w-[20px] shrink-0 text-center py-0.5 cursor-crosshair border-r border-gray-300 last:border-0 transition-colors ${
                        idx === currentIndex ? 'bg-blue-800 text-white font-bold' : 'text-gray-600 font-medium hover:bg-blue-100 hover:text-blue-900'
                      }`}
                      onClick={() => {
                        setCurrentIndex(idx);
                        setIsPlaying(false);
                      }}
                      onPointerEnter={(e) => {
                        // Só troca no hover se não for touch
                        if (e.pointerType !== 'touch' && currentIndex !== idx) {
                          setCurrentIndex(idx);
                          setIsPlaying(false);
                        }
                      }}
                    >
                      {String(fHour).padStart(2, '0')}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          
          <div className="flex-1 relative overflow-hidden flex items-center justify-center bg-white p-0 sm:p-2">
            {images.length > 0 && (
              <div className="absolute top-2 right-2 z-20 flex flex-col items-stretch gap-0 w-[min(100%,220px)] sm:w-auto sm:max-w-[260px] text-gray-900">
                <div className="pointer-events-none font-mono text-[10px] sm:text-sm">
                  <div className="flex gap-1 sm:gap-2 items-baseline justify-end">
                    <span className="text-gray-500 font-bold text-[8px] sm:text-xs uppercase tracking-wide">Run:</span>
                    <span className="font-bold text-[10px] sm:text-sm bg-gray-100 px-1 sm:px-2 border border-gray-200 rounded break-all text-left">
                      {selectedRun || '—'}
                    </span>
                  </div>
                  <div className="flex gap-1 sm:gap-2 items-baseline justify-end mt-0.5 sm:mt-1">
                    <span className="text-gray-500 font-bold text-[8px] sm:text-xs uppercase tracking-wide">Valid:</span>
                    <span className="font-bold text-[10px] sm:text-sm bg-blue-100 text-blue-900 px-1 sm:px-2 border border-blue-200 rounded">
                      {formatValidDateTime(images[currentIndex]?.name || '')}
                    </span>
                  </div>
                </div>

                {/* Estilo SPC: Controle de camadas (só em HRT 1km / 3km) */}
                {(selectedVariable === 'hrt01km' || selectedVariable === 'hrt03km') && (
                  <div className="mt-2 pointer-events-auto w-full border border-black border-dotted bg-white text-[11px] sm:text-xs shadow-sm">
                    <div className="px-1.5 py-1 border-b border-gray-400 font-sans">
                      <span className="font-bold text-black">Controle de camadas</span>
                      <span className="text-[10px] text-gray-700 font-normal"> [Drag to rearrange order]</span>
                    </div>
                    <label
                      className={`flex items-center gap-2 px-2 py-1.5 cursor-pointer font-sans font-bold text-black border-t border-dotted border-black select-none ${
                        showOverlayCape ? 'bg-[#d8f0dc]' : 'bg-[#c0c0c0]'
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5 shrink-0 accent-blue-700"
                        checked={showOverlayCape}
                        onChange={(e) => setShowOverlayCape(e.target.checked)}
                      />
                      <span>ml-CAPE (contorno)</span>
                    </label>
                  </div>
                )}
              </div>
            )}

            {images.length > 0 ? (
              images.map((img, idx) => {
                const isCurrent = idx === currentIndex;
                
                // NO SPC, a troca é SECA E DIRETA (flicker free porque o browser cacheia e renderiza na hora)
                // Não usamos transition-opacity para drag/hover, pois isso causa o "fade preto" indesejado em trocas rápidas.
                
                const overlayPair = findOverlayForBaseName(img.name, overlayImages);

                return (
                  <div key={img.url} className={`absolute w-full h-full ${isCurrent ? 'block z-10' : 'hidden z-0'}`}>
                    <img 
                      src={img.url} 
                      alt={`Forecast frame ${idx}`}
                      onMouseMove={isCurrent ? mapImageToCoords : undefined}
                      onMouseLeave={isCurrent ? () => setHoverPos(null) : undefined}
                      onClick={isCurrent ? handleImageClick : undefined}
                      className="w-full h-full object-contain sm:object-scale-down cursor-crosshair"
                    />
                    
                    {/* OVERLAY: mlcape_contorno (mesmo timestamp do frame base) */}
                    {showOverlayCape && overlayPair && (
                      <img 
                        src={overlayPair.url} 
                        alt={`Overlay ml-CAPE ${idx}`}
                        className="absolute inset-0 w-full h-full object-contain sm:object-scale-down pointer-events-none"
                      />
                    )}
                  </div>
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

            {/* Hover tooltip for Lat/Lon */}
            {hoverPos && !isSoundingLoading && !soundingImageUrl && (
              <div 
                className="absolute pointer-events-none bg-black/80 text-white text-[10px] px-2 py-1 rounded shadow-lg z-50 transform -translate-x-1/2 -translate-y-full mt-[-10px]"
                style={{ 
                  left: hoverPos.x, 
                  top: hoverPos.y 
                }}
              >
                <div>Lat: {hoverPos.lat.toFixed(4)}</div>
                <div>Lon: {hoverPos.lon.toFixed(4)}</div>
                <div className="text-blue-300 font-bold mt-1">Clique para sondagem</div>
              </div>
            )}

            {/* Loading Indicator for Sounding */}
            {isSoundingLoading && (
              <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-white/70 backdrop-blur-sm">
                <div className="animate-spin rounded-full h-12 w-12 border-4 border-gray-400 border-t-blue-800 mb-4"></div>
                <div className="text-gray-800 font-bold bg-white px-4 py-2 rounded shadow">
                  Gerando sondagem...
                </div>
              </div>
            )}

            {/* Sounding Result Modal */}
            {soundingImageUrl && soundingPos && soundingIndex !== null && (
              <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
                <div className="relative bg-white p-2 rounded max-w-full max-h-full overflow-hidden flex flex-col">
                  
                  {/* Controles do Skew-T */}
                  <div className="flex items-center justify-between bg-gray-100 p-2 mb-2 rounded border border-gray-300 gap-4">
                    <button 
                      onClick={() => soundingIndex > 0 && fetchSounding(soundingPos.lat, soundingPos.lon, soundingIndex - 1)}
                      disabled={soundingIndex <= 0}
                      className="flex items-center justify-center gap-1 bg-white hover:bg-gray-50 text-blue-800 border border-blue-800 px-3 py-1 rounded font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <ChevronLeft size={16} /> Voltar Hora
                    </button>

                    <div className="text-sm font-semibold text-gray-700 flex flex-col items-center">
                      <span>Lat: {soundingPos.lat.toFixed(3)} | Lon: {soundingPos.lon.toFixed(3)}</span>
                      <span className="text-blue-800 text-xs uppercase tracking-wide">
                        Válido para: {images[soundingIndex] ? images[soundingIndex].name.replace('.png', '').replace('.jpg', '').substring(9,11) + ':' + images[soundingIndex].name.replace('.png', '').replace('.jpg', '').substring(11,13) + ' UTC' : ''}
                      </span>
                    </div>

                    <button 
                      onClick={() => soundingIndex < images.length - 1 && fetchSounding(soundingPos.lat, soundingPos.lon, soundingIndex + 1)}
                      disabled={soundingIndex >= images.length - 1}
                      className="flex items-center justify-center gap-1 bg-white hover:bg-gray-50 text-blue-800 border border-blue-800 px-3 py-1 rounded font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Avançar Hora <ChevronRight size={16} />
                    </button>

                    <button 
                      onClick={closeSounding}
                      className="ml-4 bg-red-600 hover:bg-red-700 text-white px-4 py-1 rounded font-bold flex items-center gap-1"
                    >
                      X Fechar
                    </button>
                  </div>

                  {/* Imagem do Skew-T com scroll se for muito grande */}
                  <div className="overflow-auto flex-1 flex justify-center items-start">
                    <img src={soundingImageUrl} alt="WRF Sounding" className="max-w-full h-auto object-contain border border-gray-300" />
                  </div>
                </div>
              </div>
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

              <div className="flex items-center gap-2 sm:gap-3">
                <span className="text-xs text-gray-500 font-bold uppercase tracking-wider hidden sm:inline">Velocidade:</span>
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

      {/* PREMIUM POPUP MODAL */}
      {showPremiumPopup && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-300">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-300">
            <div className="bg-gradient-to-r from-blue-800 to-cyan-600 p-6 text-center text-white relative">
              <button 
                onClick={() => setShowPremiumPopup(false)}
                className="absolute top-4 right-4 text-white/70 hover:text-white transition-colors"
              >
                <span className="sr-only">Fechar</span>
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
              <div className="mx-auto w-12 h-12 bg-white/20 rounded-full flex items-center justify-center mb-3 shadow-inner">
                <span className="text-2xl font-black">!</span>
              </div>
              <h2 className="text-2xl font-black mb-1">Recurso Premium</h2>
            </div>
            
            <div className="p-6 text-center">
              <p className="text-gray-700 text-lg mb-4 font-medium">
                Não perca a oportunidade de assinar com desconto.
              </p>
              
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 mb-4">
                <p className="text-blue-900 text-sm">
                  Os 150 primeiros usuários terão desconto de <span className="font-bold">R$ 10</span> em cada mês por 3 meses.
                </p>
              </div>
              
              <div className="text-xs text-gray-500 mb-6 font-medium">
                * Valor do Plano: R$ 29,99
              </div>
              
              <button 
                onClick={() => setShowPremiumPopup(false)}
                className="w-full bg-blue-800 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-xl transition-colors shadow-md hover:shadow-lg active:scale-95"
              >
                Continuar
              </button>
            </div>
          </div>
        </div>
      )}

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
