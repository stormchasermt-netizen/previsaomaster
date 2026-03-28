'use client';

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Layout, Save, Move, MousePointer2, RefreshCw, ArrowUp, ArrowDown, Edit3, Maximize2, Cloud, ExternalLink, Check } from 'lucide-react';
import { fetchSoundingLayout, saveSoundingLayout } from '@/lib/soundingConfigStore';

interface Box {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  params: string[];
  fontSize: number; // Nova propriedade para escala interna
}

const ALL_PARAMS = [
  'SBCAPE', 'MLCAPE', 'MUCAPE', 'SBCIN', 'MLCIN', 'MUCIN', 'SBLCL', 'MLLCL', 'MULCL',
  'SBLI', 'MLLI', 'MULI', 'SBLFC', 'MLLFC', 'MULFC', 'SBEL', 'MLEL', 'MUEL',
  'PW', 'K', 'DCAPE', '3CAPE', 'MidRH', 'LowRH', 'SigSevere', 'WNDG', 'ESP', 'MMP', 'NCAPE',
  'SRH 1km', 'SRH 3km', 'Eff SRH', 'Shear 1km', 'Shear 6km', 'Shear 8km', 'Eff Shear',
  'MnWind', 'SRW', 'Bunkers Right', 'Bunkers Left', 'Corfidi Down', 'Corfidi Up',
  'Sfc-3km Lapse', '3-6km Lapse', '850-500mb Lapse', '700-500mb Lapse',
  'Supercell (LM)', 'STP 0 - 500m', 'STP Fix', 'STP cin', 'SHIP',
  'WBZ', 'FZL', 'ConvT', 'MaxT', 'MeanW', 'DownT'
];

const INITIAL_BOXES: Box[] = [
  { id: 'skewt', name: 'Skew-T Plot', x: 2, y: 5, w: 53, h: 58, color: 'rgba(255, 0, 0, 0.05)', params: [], fontSize: 10 },
  { id: 'hodo', name: 'Hodograph', x: 56.2, y: 5, w: 43, h: 58, color: 'rgba(0, 0, 255, 0.05)', params: [], fontSize: 10 },
  { id: 'parcel', name: 'Parcel Table', x: 1.95, y: 67.4, w: 28, h: 8, color: 'rgba(0, 255, 0, 0.05)', params: [], fontSize: 8 },
  { id: 'kinem', name: 'Kinematic Table', x: 30.6, y: 68.6, w: 26, h: 16, color: 'rgba(255, 255, 0, 0.05)', params: ['SRH 1km', 'SRH 3km', 'Eff SRH', 'Shear 1km', 'Shear 6km', 'Shear 8km', 'Eff Shear', 'MnWind', 'SRW', 'Bunkers Right', 'Bunkers Left', 'Corfidi Down', 'Corfidi Up'], fontSize: 10 },
  { id: 'extra', name: 'Indices Box', x: 1.95, y: 75.6, w: 28, h: 12, color: 'rgba(128, 128, 128, 0.05)', params: ['PW', '3CAPE', 'WBZ', 'WNDG', 'K', 'DCAPE', 'FZL', 'ESP', 'MidRH', 'DownT', 'ConvT', 'MMP', 'LowRH', 'MeanW', 'MaxT', 'NCAPE', 'SigSevere'], fontSize: 10 },
  { id: 'lapse', name: 'Lapse Rates', x: 1.85, y: 88, w: 28, h: 9, color: 'rgba(0, 255, 255, 0.05)', params: ['Sfc-3km Lapse', '3-6km Lapse', '850-500mb Lapse', '700-500mb Lapse'], fontSize: 9 },
  { id: 'windbarbs', name: '850/500 Barbs', x: 39.7, y: 84.6, w: 17, h: 14, color: 'rgba(255, 255, 255, 0.1)', params: [], fontSize: 12 },
  { id: 'convec', name: 'Convective Box', x: 18, y: 84.2, w: 12, h: 13, color: 'rgba(255, 165, 0, 0.05)', params: ['Supercell (LM)', 'STP 0 - 500m', 'STP Fix', 'STP cin', 'SHIP'], fontSize: 10 },
];

export default function SoundingDesigner() {
  const [boxes, setBoxes] = useState(INITIAL_BOXES);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [isLive, setIsLive] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [canvasSize, setCanvasSize] = useState({ w: 1000, h: 666 });

  const [isSaving, setIsSaving] = useState(false);
  const selectedBox = boxes.find(b => b.id === selectedId);

  // Carregar Layout do Firestore ao iniciar
  useEffect(() => {
    async function init() {
      const saved = await fetchSoundingLayout();
      if (saved && saved.length > 0) {
        console.log("Layout v6.1 carregado do Firestore!");
        const merged = INITIAL_BOXES.map(initBox => {
          const s = saved.find(sb => sb.id === initBox.id);
          if (s) {
            return {
              ...initBox,
              x: s.rel_x * 100,
              y: (1 - s.rel_y) * 100,
              w: s.w * 100,
              h: s.h * 100,
              params: s.params || initBox.params
            };
          }
          return initBox;
        });
        setBoxes(merged);
      }
    }
    init();
  }, []);

  const generatePreview = async () => {
    if (isGenerating) return;
    setIsGenerating(true);
    try {
      const response = await fetch('http://127.0.0.1:8095/process-average-sounding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          csv_content: `"Pressure","Altitude","Temperature","Dew_point","Wind_direction","Wind_speed","Sigma_level"
930.48,622,23.26,18.44,12,8.92,137
928.17,644,23.34,18.35,11,13.7,136
925.66,667,23.31,18.27,11,16.74,135
922.92,693,23.23,18.2,11,19.17,134
919.95,722,23.12,18.12,10,21.33,133
916.73,752,22.98,18.04,10,23.35,132
913.22,786,22.82,17.95,10,25.27,131
909.41,822,22.63,17.86,10,27.17,130
905.28,862,22.42,17.76,9,28.99,129
900.79,905,22.19,17.66,9,30.82,128
895.93,953,21.94,17.54,8,32.63,127
890.66,1004,21.64,17.42,7,34.36,126
884.96,1060,21.29,17.29,6,35.94,125
878.8,1120,20.87,17.16,5,37.32,124
872.16,1186,20.33,17.04,4,38.36,123
864.99,1258,19.75,16.88,2,39.16,122
857.28,1335,19.16,16.68,1,39.89,121
849,1419,18.53,16.47,359,40.29,120
840.12,1509,17.89,16.24,355,40.62,119
830.62,1607,17.27,15.96,352,40.73,118
820.47,1712,16.7,15.47,346,40.92,117
809.66,1825,16.13,14.87,338,41.59,116
798.18,1947,15.46,14.09,332,42.78,115
786.01,2078,14.68,13.09,326,44.27,114
773.15,2218,13.86,11.81,321,46.11,113
759.6,2367,12.96,10.3,318,48.39,112
745.37,2526,12.03,8.39,316,51.24,111
730.49,2695,11.17,5.86,314,54.73,110
714.97,2874,10.26,2.9,313,58.67,109
698.84,3064,9.19,-0.13,312,62.42,108
682.16,3264,8.02,-2.93,312,64.79,107
664.97,3474,6.78,-5.3,312,65.03,106
647.33,3694,5.48,-7.58,313,62.89,105
629.31,3924,4.28,-10.15,315,59.61,104
610.98,4164,3.12,-13.74,317,57.12,103
592.43,4413,1.67,-18.61,318,56.3,102
573.74,4671,-0.07,-22.96,318,56.2,101
554.99,4935,-1.95,-25.23,317,56.01,100
536.29,5207,-3.93,-26.66,315,55.27,99
517.71,5484,-6.06,-27.17,313,54.23,98
499.35,5765,-8.34,-26.56,311,53.2,97
481.31,6049,-10.75,-25.45,309,52.41,96
463.69,6334,-13.17,-25.27,307,51.77,95
446.57,6619,-15.54,-25.77,304,51.04,94
429.95,6904,-17.85,-26.68,301,49.95,93
413.81,7189,-20.16,-27.77,299,48.68,92
398.15,7474,-22.46,-28.97,296,47.4,91
382.96,7758,-24.77,-30.15,293,46.42,90
368.23,8042,-27.08,-31.31,290,45.81,89
353.94,8326,-29.34,-32.75,287,45.62,88
340.09,8610,-31.56,-34.48,284,45.93,87
326.66,8893,-33.59,-37.11,282,46.93,86
313.66,9177,-35.57,-39.6,280,48.53,85
301.05,9461,-37.58,-41.78,278,50.57,84
288.85,9746,-39.54,-43.88,277,52.89,83
277.03,10030,-41.49,-45.94,275,55.41,82
265.59,10315,-43.42,-48.06,275,58.24,81
254.52,10600,-45.28,-50.05,274,61.74,80
243.81,10886,-47.02,-51.64,274,65.85,79
233.45,11172,-48.62,-53.49,275,69.84,78
223.43,11460,-49.8,-55,276,72.3,77
213.75,11749,-51.2,-56.71,277,68.72,76
204.39,12038,-53.88,-59.21,277,67.85,75
195.35,12326,-56.55,-62.37,276,67.94,74
186.63,12615,-57.72,-63.89,275,61.57,73
178.2,12907,-56.91,-65.39,275,46.38,72
170.07,13203,-56.01,-68.48,280,32.62,71
162.23,13503,-57.06,-72.15,287,28.22,70
154.67,13803,-59.09,-75.08,291,29.7,69
147.39,14103,-61.26,-77.3,292,31.9,68
140.38,14404,-63.2,-78.14,293,34.37,67
133.64,14706,-65.35,-79.04,293,36.31,66
127.15,15006,-67.75,-79.31,293,37,65
120.92,15307,-69.55,-80.57,291,36.07,64
114.93,15609,-70.88,-81.85,286,36.75,63
109.18,15912,-72.28,-82.79,285,40.05,62
103.67,16216,-72.15,-83,288,42.1,61
98.39,16526,-69.71,-83.29,293,38.07,60
93.34,16840,-69.06,-83.42,306,33.48,59
88.5,17158,-69.04,-84.18,312,36.1,58
83.88,17481,-66.57,-84.03,310,40.3,57
79.45,17811,-64.15,-83.92,311,37.1,56
75.2,18148,-63.13,-84.01,320,30.7,55
71.12,18491,-62.91,-84.81,332,30.6,54
67.19,18842,-61.39,-84.85,333,29.3,53
63.42,19202,-59.49,-84.86,330,18.31,52
59.77,19573,-59.23,-85.07,340,9.66,51
56.26,19952,-59.12,-85.3,354,5.44,50
52.86,20341,-59.65,-85.62,350,4.1,49
49.6,20741,-59.46,-85.86,349,4.37,48
46.45,21151,-58.64,-86.02,31,5.1,47
43.43,21574,-58.02,-86.22,62,8.34,46
40.53,22009,-57.9,-86.47,72,11.11,45"`,
          layout_config: boxes.map(b => ({
            id: b.id,
            rel_x: b.x / 100,
            rel_y: 1 - (b.y / 100),
            w: b.w / 100,
            h: b.h / 100,
            params: b.params,
            font_size: b.fontSize || 10
          })),
          title: "Sondagem Real - sedenova.csv"
        })
      });
      const data = await response.json();
      if (data.image) setPreviewImageUrl(`data:image/png;base64,${data.image}`);
    } catch (err) {
      console.error("Erro ao gerar preview:", err);
    } finally {
      setIsGenerating(false);
    }
  };

  // Auto-Preview ao mudar layout (Debounce)
  useEffect(() => {
    if (!isLive) return;
    const timer = setTimeout(() => {
      generatePreview();
    }, 1200);
    return () => clearTimeout(timer);
  }, [boxes, isLive]);

  // Polling para "Live Code" (Atualiza quando o usuário edita o Python backend)
  useEffect(() => {
    if (!isLive) return;
    const interval = setInterval(() => {
      console.log("Polling Live Preview...");
      generatePreview();
    }, 5000); // 5 segundos de intervalo para capturar mudanças no código backend
    return () => clearInterval(interval);
  }, [isLive]);

  const updateBox = (id: string, updates: Partial<Box>) => {
    setBoxes(prev => prev.map(b => b.id === id ? { ...b, ...updates } : b));
  };

  const toggleParam = (param: string) => {
    if (!selectedId) return;
    setBoxes(prev => prev.map(b => {
      if (b.id !== selectedId) return b;
      const has = b.params.includes(param);
      return {
        ...b,
        params: has ? b.params.filter(px => px !== param) : [...b.params, param]
      };
    }));
  };

  const saveLayout = async () => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      const config = boxes.map(b => ({
        id: b.id,
        rel_x: b.x / 100,
        rel_y: 1 - (b.y / 100),
        w: b.w / 100,
        h: b.h / 100,
        params: b.params,
        font_size: b.fontSize || 10
      }));
      await saveSoundingLayout(config);
      alert("Sucesso! Layout v6.1 salvo permanentemente no Firestore. 🏆🌪️");
    } catch (err) {
      console.error("Erro ao salvar layout:", err);
      alert("Erro ao salvar no Firestore.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-[#02040a] text-white font-sans overflow-hidden">
      <div className="flex justify-between items-center p-5 bg-[#0f172a] border-b border-white/10 z-30 shadow-2xl">
        <div className="flex items-center gap-4">
          <div className="bg-blue-600 p-2 rounded-lg"><Layout size={24} /></div>
          <div>
            <h1 className="text-xl font-black uppercase tracking-tighter">Designer Ultra v5.0</h1>
            <p className="text-[10px] text-blue-400 font-bold tracking-widest uppercase">Custom Parameter Engine</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 cursor-pointer bg-slate-800 px-3 py-1.5 rounded-full border border-slate-700 hover:border-cyan-500 transition-colors">
            <input 
              type="checkbox" 
              checked={isLive} 
              onChange={(e) => setIsLive(e.target.checked)}
              className="w-4 h-4 accent-cyan-500"
            />
            <span className="text-sm font-bold text-cyan-400">MODO LIVE ⚡</span>
          </label>
          <button 
            onClick={generatePreview}
            disabled={isGenerating}
            className="bg-cyan-600 hover:bg-cyan-500 text-white px-6 py-2 rounded-lg font-bold shadow-lg shadow-cyan-900/20 active:scale-95 disabled:opacity-50"
          >
            {isGenerating ? 'GERANDO...' : 'GERAR PRÉVIA 🖼️'}
          </button>
          <button 
            onClick={saveLayout}
            disabled={isSaving}
            className="bg-emerald-600 hover:bg-emerald-500 text-white px-6 py-2 rounded-lg font-bold shadow-lg shadow-emerald-900/20 active:scale-95 disabled:opacity-50 flex items-center gap-2"
          >
            {isSaving ? <RefreshCw size={18} className="animate-spin" /> : <Save size={18} />}
            {isSaving ? 'SALVANDO...' : 'SALVAR LAYOUT 💾'}
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* COLUNA 1: SIDEBAR (Parâmetros) */}
        <div className="w-80 bg-[#0f172a] border-r border-white/10 flex flex-col shadow-2xl z-20">
          {selectedBox ? (
            <>
              <div className="p-4 bg-[#1e293b] border-b border-white/5">
                <div className="text-[10px] text-blue-400 font-black uppercase mb-1 flex items-center gap-2">
                  <Edit3 size={10} /> Editando Componente
                </div>
                <h2 className="text-sm font-bold text-white truncate">{selectedBox.name}</h2>
              </div>

              <div className="p-4 space-y-4 border-b border-white/5">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[9px] text-slate-500 font-bold uppercase">Posição X (%)</label>
                    <input type="number" step="0.1" value={selectedBox.x} onChange={(e) => updateBox(selectedBox.id, { x: Number(e.target.value) })} className="w-full bg-blue-500/10 border border-blue-500/30 p-1.5 rounded text-xs outline-none focus:border-blue-500 font-mono text-blue-400" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] text-slate-500 font-bold uppercase">Posição Y (%)</label>
                    <input type="number" step="0.1" value={selectedBox.y} onChange={(e) => updateBox(selectedBox.id, { y: Number(e.target.value) })} className="w-full bg-blue-500/10 border border-blue-500/30 p-1.5 rounded text-xs outline-none focus:border-blue-500 font-mono text-blue-400" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] text-slate-500 font-bold uppercase">Largura (%)</label>
                    <input type="number" value={Math.round(selectedBox.w)} onChange={(e) => updateBox(selectedBox.id, { w: Number(e.target.value) })} className="w-full bg-black/40 border border-white/10 p-1.5 rounded text-xs outline-none focus:border-blue-500 font-mono" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] text-slate-500 font-bold uppercase">Altura (%)</label>
                    <input type="number" value={Math.round(selectedBox.h)} onChange={(e) => updateBox(selectedBox.id, { h: Number(e.target.value) })} className="w-full bg-black/40 border border-white/10 p-1.5 rounded text-xs outline-none focus:border-blue-500 font-mono" />
                  </div>
                  <div className="col-span-2 pt-2 border-t border-white/5">
                    <label className="text-[9px] text-slate-500 font-bold uppercase block mb-1">Escala / Fonte (Itens Internos)</label>
                    <div className="flex items-center gap-3">
                      <input 
                        type="range" min="4" max="24" step="1"
                        value={selectedBox.fontSize} 
                        onChange={(e) => updateBox(selectedBox.id, { fontSize: Number(e.target.value) })} 
                        className="flex-1 h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-500" 
                      />
                      <span className="text-[10px] font-mono font-bold text-cyan-400 min-w-[20px]">{selectedBox.fontSize}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex-1 flex flex-col overflow-hidden">
                <div className="p-3 bg-black/20 text-[9px] font-bold uppercase tracking-widest text-slate-400 border-y border-white/5">
                  Gerenciar Parâmetros
                </div>
                <div className="flex-1 overflow-y-auto p-3 space-y-4 scrollbar-thin scrollbar-thumb-slate-700 font-sans">
                  <div>
                    <h3 className="text-[10px] font-bold text-blue-400 mb-2 uppercase tracking-tighter">Disponíveis</h3>
                    <div className="space-y-1">
                      {ALL_PARAMS.filter(p => !selectedBox.params.includes(p)).map(p => (
                        <div key={p} onClick={() => toggleParam(p)} className="flex items-center justify-between p-1.5 bg-slate-800/30 border border-slate-700/50 rounded hover:border-cyan-500/50 cursor-pointer group transition-all">
                          <span className="text-[11px] text-slate-400 group-hover:text-cyan-400">{p}</span>
                          <ArrowDown size={10} className="text-slate-600" />
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <h3 className="text-[10px] font-bold text-green-400 mb-2 uppercase tracking-tighter">Ativos na Caixa ({selectedBox.params.length})</h3>
                    <div className="space-y-1">
                      {selectedBox.params.map(p => (
                        <div key={p} onClick={() => toggleParam(p)} className="flex items-center justify-between p-1.5 bg-slate-800 border border-slate-700 rounded hover:border-red-500/50 cursor-pointer group transition-all">
                          <span className="text-[11px] text-slate-200 group-hover:text-red-400 font-bold">{p}</span>
                          <ArrowUp size={10} className="text-slate-500" />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center opacity-30">
              <MousePointer2 size={48} className="mb-4 text-slate-600" />
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-tighter">Selecione uma caixa no canvas</h2>
            </div>
          )}
        </div>

        {/* COLUNA 2: EDITOR / MESA DE LUZ (60%) */}
        <div className="flex-[3] relative bg-[#010204] overflow-hidden flex flex-col">
          <div className="p-2 border-b border-white/5 bg-slate-900/30 flex justify-between items-center">
            <span className="text-[9px] text-slate-500 font-mono tracking-widest uppercase ml-2">Area de Design (Relative Canvas)</span>
            <div className="flex gap-2 mr-2">
               <div className="px-2 py-0.5 rounded-full bg-cyan-950 border border-cyan-800 text-[8px] text-cyan-400 font-bold uppercase">Interactive D&D</div>
            </div>
          </div>

          <div className="flex-1 relative overflow-auto p-12 flex items-center justify-center scrollbar-hide">
            <div 
              id="designer-canvas"
              className="relative bg-white shadow-2xl overflow-hidden ring-4 ring-slate-800"
              style={{ 
                width: canvasSize.w, 
                height: canvasSize.h,
                backgroundImage: previewImageUrl ? `url(${previewImageUrl})` : 'none',
                backgroundSize: '100% 100%',
                backgroundRepeat: 'no-repeat'
              }}
              onClick={() => setSelectedId(null)}
            >
              {/* Overlay suave para ver as caixas melhor sobre a imagem */}
              {previewImageUrl && <div className="absolute inset-0 bg-white/20 pointer-events-none" />}

              {boxes.map((box) => (
                <motion.div
                  key={box.id}
                  drag
                  dragMomentum={false}
                  dragConstraints={{ left: 0, top: 0, right: 100, bottom: 100 }} // constraints handled by logic
                  onDragStart={() => setSelectedId(box.id)}
                  onDragEnd={(_, info) => {
                    const rect = document.getElementById('designer-canvas')?.getBoundingClientRect();
                    if (!rect) return;
                    const newX = ((box.x * rect.width / 100) + info.offset.x) / rect.width * 100;
                    const newY = ((box.y * rect.height / 100) + info.offset.y) / rect.height * 100;
                    updateBox(box.id, { x: Math.max(0, Math.min(100 - box.w, newX)), y: Math.max(0, Math.min(100 - box.h, newY)) });
                  }}
                  onClick={(e) => { e.stopPropagation(); setSelectedId(box.id); }}
                  className={`absolute cursor-move flex flex-col items-center justify-center p-1 select-none border-2 transition-all ${selectedId === box.id ? 'border-cyan-500 bg-cyan-500/20 z-50 ring-4 ring-cyan-500/20 shadow-[0_0_30px_rgba(6,182,212,0.5)]' : 'border-gray-200/50 bg-white/10 hover:border-gray-400/80 z-10 opacity-60 hover:opacity-100'}`}
                  style={{
                    width: `${box.w}%`,
                    height: `${box.h}%`,
                    left: `${box.x}%`,
                    top: `${box.y}%`,
                  }}
                >
                  <div className="absolute -top-4 left-0 text-[8px] font-black text-cyan-400 bg-slate-900 px-1 rounded border border-cyan-800/50 pointer-events-none">
                    {box.id.toUpperCase()}
                  </div>
                  <div className="text-[10px] font-bold text-center leading-tight drop-shadow-sm text-slate-800">{box.name}</div>
                </motion.div>
              ))}
            </div>
          </div>
        </div>

        {/* COLUNA 3: LIVE PREVIEW RESULT (RESULTADO FINAL) */}
        <div className="flex-[2] bg-[#02040a] border-l border-white/10 flex flex-col p-6 space-y-4">
           <div className="w-full flex justify-between items-center">
              <h2 className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                <RefreshCw size={12} className={isGenerating ? 'animate-spin text-cyan-400' : ''} />
                Resultado em Tempo Real
              </h2>
              {isGenerating && <div className="text-[8px] text-cyan-500 font-bold animate-pulse">RENDERIZANDO...</div>}
           </div>

           <div className="flex-1 w-full bg-black rounded-lg border border-white/5 shadow-[0_0_100px_rgba(0,0,0,0.5)] overflow-hidden relative group">
              {previewImageUrl ? (
                <a href={previewImageUrl} target="_blank" rel="noreferrer" className="block w-full h-full">
                  <img 
                    src={previewImageUrl} 
                    alt="Preview Final" 
                    className="w-full h-full object-contain cursor-zoom-in"
                  />
                  <div className="absolute top-2 right-2 p-1 bg-black/60 rounded border border-white/10 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Maximize2 size={12} className="text-white" />
                  </div>
                </a>
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center space-y-4 text-slate-800">
                  <Cloud size={48} className="opacity-10" />
                  <span className="text-[10px] font-mono uppercase tracking-widest opacity-30">Aguardando API...</span>
                </div>
              )}
           </div>

           <div className="bg-slate-900/50 p-4 rounded-xl border border-white/5 space-y-3">
              <div className="flex justify-between items-center text-[9px] font-bold uppercase text-slate-400">
                <span>Engenharia Meteorológica</span>
                <span className="text-green-500">Live Sync Active</span>
              </div>
              <p className="text-[10px] text-slate-500 font-medium leading-relaxed italic">
                "Este painel renderiza a imagem real via MetPy 1.5. Mova as caixas para ver o impacto dinâmico na imagem final."
              </p>
           </div>
        </div>
      </div>
    </div>
  );
}
