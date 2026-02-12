'use client';
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { ImageLayerEditor } from '@/components/ImageLayerEditor';
import { StormReportEditor } from '@/components/StormReportEditor';
import { mockStore } from '@/lib/store';
import { PREDEFINED_LAYERS, LAYER_CATEGORIES, LAYER_TIMES } from '@/lib/constants';
import type { PrevisaoEvent, PrevisaoLayer, StormReport, MapBounds, RiskPolygon } from '@/lib/types';
import { ShieldAlert, Plus, Check, X, Clock, Map as MapIcon, Edit, Upload, Image as ImageIcon, Trash2, Loader2 } from 'lucide-react';
import clsx from 'clsx';

export default function Admin() {
  const { user } = useAuth();
  const { addToast } = useToast();
  const router = useRouter();
  const [events, setEvents] = useState<PrevisaoEvent[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  
  // Layer editing
  const [layers, setLayers] = useState<PrevisaoLayer[]>([]);
  const [activeLayerId, setActiveLayerId] = useState('');
  const [editingTimeSlot, setEditingTimeSlot] = useState<string | null>(null);
  const [showLayerEditor, setShowLayerEditor] = useState(false);

  // Form State
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [displayDate, setDisplayDate] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [monthHint, setMonthHint] = useState('');
  const [stormReports, setStormReports] = useState<StormReport[]>([]);
  const [riskPolygons, setRiskPolygons] = useState<RiskPolygon[]>([]);
  const [reportMapUrl, setReportMapUrl] = useState<string | undefined>(undefined);
  const [boundsJson, setBoundsJson] = useState('{"south":-40,"north":-10,"west":-70,"east":-40}');

  const loadEvents = async () => {
      setLoading(true);
      try {
          const loaded = await mockStore.getEvents();
          setEvents(loaded);
      } catch (e: any) {
          addToast(`Erro ao carregar eventos: ${e.message}`, 'error');
      } finally {
          setLoading(false);
      }
  };

  useEffect(() => {
    if (!user || (user.type !== 'admin' && user.type !== 'superadmin')) {
      router.push('/');
      return;
    }
    loadEvents();
  }, [user, router]);

  const handleEditEvent = (evt: PrevisaoEvent) => {
    setEditingEventId(evt.id);
    setDisplayDate(evt.displayDate);
    setEventDate(evt.eventDate);
    setMonthHint(evt.monthHint || '');
    setStormReports(evt.stormReports);
    setRiskPolygons(evt.riskPolygons || []);
    setReportMapUrl(evt.reportMapUrl);
    setLayers(evt.layers);
    setBoundsJson(JSON.stringify(evt.bounds));
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleCancelEdit = () => {
    setEditingEventId(null);
    setDisplayDate('');
    setEventDate('');
    setMonthHint('');
    setStormReports([]);
    setRiskPolygons([]);
    setReportMapUrl(undefined);
    setLayers([]);
    setBoundsJson('{"south":-40,"north":-10,"west":-70,"east":-40}');
    setShowForm(false);
  };

  const handleDeleteEvent = async (id: string) => {
      if (confirm('Tem certeza que deseja excluir este evento permanentemente?')) {
          try {
              await mockStore.deleteEvent(id);
              setEvents(prev => prev.filter(e => e.id !== id));
              addToast('Evento excluído com sucesso.', 'success');
              if (editingEventId === id) {
                  handleCancelEdit();
              }
          } catch(e: any) {
              addToast(`Erro ao excluir: ${e.message}`, 'error');
          }
      }
  };

  const handleSaveEvent = async () => {
    // 1. Separate Bounds Validation
    let bounds: MapBounds;
    try {
        bounds = JSON.parse(boundsJson);
    } catch (e) {
        addToast('Erro na formatação do JSON de Limites (Bounds).', 'error');
        return;
    }

    // 2. Separate Data Validation
    if (!displayDate || !eventDate) {
       addToast('Preencha os campos obrigatórios de data.', 'error');
       return;
    }

    try {
        setLoading(true);
        const eventData = {
            displayDate,
            eventDate,
            monthHint,
            region: 'america_do_sul' as const,
            layers,
            stormReports,
            riskPolygons,
            reportMapUrl,
            bounds,
            active: true
        };

        if (editingEventId) {
            // Update existing
            const fullEvent: PrevisaoEvent = { ...eventData, id: editingEventId, createdAt: Date.now() }; 
            await mockStore.updateEvent(fullEvent);
            addToast('Evento atualizado com sucesso!', 'success');
        } else {
            // Create new
            await mockStore.addEvent(eventData);
            addToast('Evento criado com sucesso!', 'success');
        }

        await loadEvents();
        handleCancelEdit(); 

    } catch (e: any) {
        console.error("Erro ao salvar:", e);
        addToast(`Erro ao salvar evento: ${e.message}`, 'error');
    } finally {
        setLoading(false);
    }
  };

  const handleLayerSave = (imageUrl: string) => {
    if (!activeLayerId || !editingTimeSlot) return;
    
    const config = PREDEFINED_LAYERS.find(l => l.id === activeLayerId);
    if (!config) return;

    const newLayer: PrevisaoLayer = {
        id: activeLayerId,
        name: config.name,
        category: config.category,
        time: editingTimeSlot,
        imageUrl,
        validDifficulties: ['iniciante', 'intermediario', 'especialista', 'mestre'],
        order: layers.length
    };

    const others = layers.filter(l => !(l.id === activeLayerId && l.time === editingTimeSlot));
    setLayers([...others, newLayer]);
    setShowLayerEditor(false);
    
    addToast('Camada adicionada com sucesso!', 'success');
  };

  const handleReportMapUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files[0]) {
          const reader = new FileReader();
          reader.onload = (ev) => {
              if (ev.target?.result) {
                  setReportMapUrl(ev.target.result.toString());
                  addToast('Mapa de referência carregado.', 'success');
              }
          };
          reader.readAsDataURL(e.target.files[0]);
      }
  };

  return (
    <div className="space-y-8 pb-20">
      <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <ShieldAlert className="text-amber-400" /> Painel Admin
          </h1>
          <button 
            onClick={() => showForm ? handleCancelEdit() : setShowForm(true)}
            className={clsx(
                "px-4 py-2 rounded-md flex items-center gap-2 transition-colors",
                showForm ? "bg-slate-700 text-slate-200" : "bg-cyan-600 hover:bg-cyan-500 text-white"
            )}
          >
            {showForm ? <X className="h-4 w-4"/> : <Plus className="h-4 w-4"/>} 
            {showForm ? 'Cancelar Edição' : 'Novo Evento'}
          </button>
      </div>

      {loading && !showForm && (
          <div className="flex justify-center py-12">
              <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
          </div>
      )}

      {/* CREATE/EDIT FORM */}
      {showForm && (
        <div className="grid lg:grid-cols-2 gap-8 animate-in slide-in-from-top-4">
            {/* Left: Metadata */}
            <div className="bg-slate-900/50 border border-white/10 rounded-xl p-6 space-y-4">
                <h3 className="text-white font-bold mb-4 border-b border-white/10 pb-2 flex justify-between">
                    <span>1. Metadados {editingEventId && <span className="text-amber-400 text-xs ml-2">(Editando)</span>}</span>
                </h3>
                
                <div>
                    <label className="block text-sm text-slate-400 mb-1">Data de Exibição *</label>
                    <input value={displayDate} onChange={e => setDisplayDate(e.target.value)} className="w-full bg-slate-800 border border-white/10 rounded px-3 py-2 text-white" placeholder="ex: 27 de Abril de 2011" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm text-slate-400 mb-1">Data ISO *</label>
                        <input type="date" value={eventDate} onChange={e => setEventDate(e.target.value)} className="w-full bg-slate-800 border border-white/10 rounded px-3 py-2 text-white" />
                    </div>
                    <div>
                        <label className="block text-sm text-slate-400 mb-1">Dica do Mês</label>
                        <input value={monthHint} onChange={e => setMonthHint(e.target.value)} className="w-full bg-slate-800 border border-white/10 rounded px-3 py-2 text-white" />
                    </div>
                </div>
                
                <div>
                    <label className="block text-sm text-slate-400 mb-2 flex items-center gap-2">
                        <MapIcon className="w-4 h-4 text-cyan-400" /> 
                        Relatos & Polígonos de Risco (Recorte Brasil)
                    </label>
                    <p className="text-[10px] text-slate-500 mb-2">Use a ferramenta de polígono para desenhar áreas de previsão (Prevots). O recorte será automático.</p>
                    <StormReportEditor 
                        reports={stormReports} 
                        onUpdate={setStormReports}
                        riskPolygons={riskPolygons}
                        onUpdatePolygons={setRiskPolygons}
                    />
                </div>

                <div className="bg-slate-800/50 p-4 rounded-lg border border-white/5">
                    <label className="block text-sm text-slate-400 mb-2 flex items-center gap-2">
                        <ImageIcon className="w-4 h-4 text-emerald-400" /> Mapa de Referência (Rodapé)
                    </label>
                    <div className="flex gap-4 items-center">
                        <label className="cursor-pointer bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded text-sm text-white flex items-center gap-2">
                            <Upload className="w-4 h-4" /> Enviar Imagem
                            <input type="file" className="hidden" accept="image/*" onChange={handleReportMapUpload} />
                        </label>
                        {reportMapUrl && <span className="text-xs text-emerald-400 flex items-center gap-1"><Check className="w-3 h-3"/> Imagem Carregada</span>}
                        {reportMapUrl && (
                            <button onClick={() => setReportMapUrl(undefined)} className="text-xs text-red-400 underline">Remover</button>
                        )}
                    </div>
                    {reportMapUrl && <img src={reportMapUrl} className="mt-2 max-h-32 rounded border border-white/10" />}
                </div>

                <div>
                    <label className="block text-sm text-slate-400 mb-1">Limites Padrão (Define Área do Alvo)</label>
                    <input value={boundsJson} onChange={e => setBoundsJson(e.target.value)} className="w-full bg-slate-800 border border-white/10 rounded px-3 py-2 text-white font-mono text-xs opacity-70" />
                </div>

                <div className="flex gap-2 mt-4">
                    <button onClick={handleSaveEvent} disabled={loading} className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white py-3 rounded-lg font-bold disabled:opacity-50 flex justify-center items-center gap-2">
                        {loading ? <Loader2 className="animate-spin w-4 h-4"/> : (editingEventId ? 'Atualizar Evento' : 'Criar Evento')}
                    </button>
                </div>
            </div>

            {/* Right: Layers */}
            <div className="bg-slate-900/50 border border-white/10 rounded-xl p-6 space-y-6">
                <h3 className="text-white font-bold mb-4 border-b border-white/10 pb-2">2. Camadas (Imagens)</h3>

                <div className="space-y-2">
                    <label className="block text-sm text-slate-400">Tipo de Camada</label>
                    <select 
                        value={activeLayerId} 
                        onChange={(e) => setActiveLayerId(e.target.value)}
                        className="w-full bg-slate-800 border border-white/10 rounded px-3 py-2 text-white"
                    >
                        <option value="">Selecione...</option>
                        {LAYER_CATEGORIES.map(cat => (
                            <optgroup key={cat} label={cat}>
                                {PREDEFINED_LAYERS.filter(l => l.category === cat).map(l => (
                                    <option key={l.id} value={l.id}>{l.name}</option>
                                ))}
                            </optgroup>
                        ))}
                    </select>
                </div>

                {activeLayerId && (
                    <div className="grid grid-cols-4 gap-2">
                        {LAYER_TIMES.map(time => {
                             const hasLayer = layers.some(l => l.id === activeLayerId && l.time === time);
                             return (
                                 <button
                                    key={time}
                                    onClick={() => { setEditingTimeSlot(time); setShowLayerEditor(true); }}
                                    className={clsx(
                                        "py-2 rounded border text-sm transition-all",
                                        hasLayer 
                                            ? "bg-emerald-500/20 border-emerald-500 text-emerald-400"
                                            : "border-slate-700 text-slate-400 hover:border-slate-500"
                                    )}
                                 >
                                    {time} {hasLayer && <Check className="inline w-3 h-3"/>}
                                 </button>
                             );
                        })}
                    </div>
                )}

                <div className="border-t border-white/10 pt-4">
                    <div className="text-sm text-slate-400 mb-2">Camadas adicionadas: {layers.length}</div>
                    <ul className="space-y-2 max-h-60 overflow-y-auto custom-scrollbar pr-2">
                        {layers.map((l, i) => (
                            <li key={i} className="flex justify-between items-center bg-slate-800 px-3 py-2 rounded text-xs">
                                <span className="text-white">{l.name} ({l.time})</span>
                                <button onClick={() => setLayers(layers.filter((_, idx) => idx !== i))} className="text-red-400 hover:text-red-300"><X className="w-3 h-3"/></button>
                            </li>
                        ))}
                    </ul>
                </div>
            </div>
        </div>
      )}

      {/* MODAL LAYER EDITOR */}
      {showLayerEditor && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/90 p-4">
            <div className="w-full max-w-4xl bg-slate-900 border border-white/10 rounded-xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
                <div className="flex justify-between items-center p-4 border-b border-white/10 bg-slate-900">
                    <h3 className="text-white font-bold">Editando: {PREDEFINED_LAYERS.find(l=>l.id===activeLayerId)?.name} - {editingTimeSlot}</h3>
                    <button onClick={() => setShowLayerEditor(false)} className="text-slate-400 hover:text-white"><X/></button>
                </div>
                <div className="p-4 overflow-y-auto">
                    <ImageLayerEditor onSave={handleLayerSave} />
                </div>
            </div>
        </div>
      )}

      {/* EVENT LIST */}
      <div className="bg-slate-900/50 border border-white/10 rounded-xl overflow-hidden">
         <div className="p-4 border-b border-white/10 bg-slate-900">
            <h3 className="text-white font-bold">Eventos Existentes (Firestore - Nuvem)</h3>
         </div>
         <div className="p-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {events.map(ev => (
                <div key={ev.id} className="relative group bg-slate-800/50 border border-white/5 rounded-lg p-4 hover:border-cyan-500/30 transition-colors">
                    <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button 
                            onClick={() => handleEditEvent(ev)}
                            className="bg-cyan-600 hover:bg-cyan-500 text-white p-1.5 rounded shadow-lg"
                            title="Editar Evento"
                        >
                            <Edit className="w-3 h-3" />
                        </button>
                        <button 
                            onClick={() => handleDeleteEvent(ev.id)}
                            className="bg-red-500/20 hover:bg-red-500 text-red-400 hover:text-white p-1.5 rounded border border-red-500/30 shadow-lg"
                            title="Excluir Evento"
                        >
                            <Trash2 className="w-3 h-3" />
                        </button>
                    </div>

                    <div className="flex justify-between items-start mb-2">
                        <span className="text-xs uppercase bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded font-bold">Ativo</span>
                        <div className="text-slate-500 text-xs flex items-center gap-1">
                            <Clock className="w-3 h-3"/> {ev.eventDate}
                        </div>
                    </div>
                    <div className="font-bold text-white mb-2">{ev.displayDate}</div>
                    <div className="flex gap-4 text-xs text-slate-400">
                        <span>{ev.layers.length} camadas</span>
                        <span>{ev.stormReports.length} relatos</span>
                    </div>
                </div>
            ))}
         </div>
      </div>
    </div>
  );
}
