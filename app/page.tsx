// This is a placeholder file. The original content from pages/Home.tsx will be moved here.
'use client';
import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CloudLightning, User, Users, Radio, BookOpen, HelpCircle, X, Shield, Zap, TrendingUp, Medal, Hash, Gamepad2, ChevronLeft, ArrowRight, UserPlus, Send, Check, MessageSquare } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useMultiplayer } from '@/contexts/MultiplayerContext';
import { mockStore } from '@/lib/store';
import { PrevisaoDifficulty } from '@/lib/types';
import clsx from 'clsx';

export default function Home() {
  const { user } = useAuth();
  const { createLobby, incomingInvite, acceptInvite, declineInvite, recentPlayers, sendInvite, lobby } = useMultiplayer();
  const router = useRouter();

  // Modal State
  const [isSetupOpen, setIsSetupOpen] = useState(false);
  const [multiplayerView, setMultiplayerView] = useState<'menu' | 'create' | 'join'>('menu');
  const [selectedDifficulty, setSelectedDifficulty] = useState<PrevisaoDifficulty>('iniciante');
  const [joinCode, setJoinCode] = useState('');
  
  // Sidebar State
  const [showSocial, setShowSocial] = useState(false);
  const [inviteSentTo, setInviteSentTo] = useState<string | null>(null);
  const [allKnownPlayers, setAllKnownPlayers] = useState<any[]>([]);

  // Load Players for Social Sidebar
  useEffect(() => {
    if (showSocial) {
      const loadPlayers = async () => {
         const scores = await mockStore.getScores();
         const playersMap = new Map();
         
         // 1. Process Recent Players (Potential Online)
         recentPlayers.forEach(p => {
             const isOnline = (Date.now() - (p.lastSeen || 0)) < 1000 * 60 * 15; // 15 min threshold
             playersMap.set(p.uid, { ...p, isOnline });
         });
         
         // 2. Process Historical Players from Scores (Offline usually)
         scores.forEach(s => {
             if (!playersMap.has(s.userId)) {
                 playersMap.set(s.userId, {
                     uid: s.userId,
                     displayName: s.displayName,
                     photoURL: s.photoURL,
                     isOnline: false
                 });
             }
         });
         
         // Convert to Array and Sort: Online first, then by Name
         const list = Array.from(playersMap.values()).sort((a, b) => {
             if (a.isOnline === b.isOnline) return a.displayName.localeCompare(b.displayName);
             return a.isOnline ? -1 : 1;
         });

         setAllKnownPlayers(list);
      };
      loadPlayers();
    }
  }, [showSocial, recentPlayers]);

  const handleMultiplayerClick = () => {
      if (!user) { router.push('/login'); return; }
      setMultiplayerView('menu'); setJoinCode(''); setIsSetupOpen(true);
  };

  const handleCreateLobby = () => { createLobby(selectedDifficulty); setIsSetupOpen(false); };
  const handleJoinLobby = () => { if (joinCode.trim().length < 4) return; setIsSetupOpen(false); router.push(`/lobby/${joinCode.toUpperCase()}`); };

  const handleSendInvite = async (uid: string) => {
      setInviteSentTo(uid);
      
      let code = lobby?.code;
      if (!code) {
          // If not in a lobby, create one first (default difficulty)
          try {
              code = await createLobby('iniciante');
          } catch(e) {
              console.error("Failed to auto-create lobby for invite", e);
          }
      }
      
      if (code) {
          await sendInvite(uid, code);
      }
      
      setTimeout(() => setInviteSentTo(null), 3000);
  };

  const difficulties = [
      { id: 'iniciante', label: 'Iniciante', icon: BookOpen, desc: 'Todas as ferramentas.', color: 'text-emerald-400', border: 'border-emerald-500/30', bg: 'bg-emerald-500/10' },
      { id: 'intermediario', label: 'Intermediário', icon: TrendingUp, desc: 'Sem compostos.', color: 'text-cyan-400', border: 'border-cyan-500/30', bg: 'bg-cyan-500/10' },
      { id: 'especialista', label: 'Especialista', icon: Zap, desc: 'Apenas superfície.', color: 'text-amber-400', border: 'border-amber-500/30', bg: 'bg-amber-500/10' },
      { id: 'mestre', label: 'Mestre', icon: Medal, desc: 'Hardcore (12Z).', color: 'text-rose-400', border: 'border-rose-500/30', bg: 'bg-rose-500/10' },
  ];

  return (
    <div className="flex flex-col items-center justify-center min-h-[80vh] animate-in fade-in duration-700 relative">
      
      {/* Central Logo Area */}
      <div className="text-center mb-16">
          <div className="mx-auto mb-6 relative">
             <CloudLightning className="w-20 h-20 text-white mx-auto" strokeWidth={1.5} />
             <div className="absolute -top-2 -right-2 text-slate-600 opacity-50">
                <div className="w-4 h-4 bg-slate-500 rounded-full blur-sm"></div>
             </div>
          </div>
          
          <h1 className="text-5xl md:text-6xl font-black text-white tracking-widest uppercase mb-2" style={{ fontFamily: 'Impact, sans-serif', letterSpacing: '0.05em' }}>
              Previsão Master
          </h1>
          <p className="text-slate-400 text-lg">
              Teste suas habilidades de previsão de tempestades severas
          </p>
      </div>

      {/* Game Mode Cards */}
      <div className="flex flex-col md:flex-row gap-6 mb-12">
          
          {/* Single Player - DISABLED */}
          <div className="relative w-64 h-40 bg-[#161b22] border border-white/5 rounded-lg flex flex-col items-center justify-center opacity-60 cursor-not-allowed shadow-none grayscale-[0.5]">
              <div className="absolute top-2 right-2 bg-slate-800 text-[9px] font-bold px-1.5 py-0.5 rounded text-slate-400">EM BREVE</div>
              <div className="w-10 h-10 bg-slate-800 rounded-lg flex items-center justify-center mb-3 transition-colors">
                  <User className="w-5 h-5 text-slate-500" />
              </div>
              <h3 className="text-slate-400 font-bold">Single Player</h3>
              <p className="text-[10px] text-slate-600 mt-1 uppercase tracking-wider">Pratique sozinho</p>
          </div>

          {/* Multiplayer (Create/Join) */}
          <div onClick={handleMultiplayerClick} className="group cursor-pointer">
              <div className="w-64 h-40 bg-[#161b22] border border-white/10 rounded-lg flex flex-col items-center justify-center hover:border-cyan-500/50 hover:bg-[#1c2128] transition-all shadow-lg relative overflow-hidden">
                   <div className="absolute inset-0 bg-cyan-500/5 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                   <div className="w-10 h-10 bg-slate-800 rounded-lg flex items-center justify-center mb-3 group-hover:bg-cyan-500/20 group-hover:text-cyan-400 transition-colors">
                      <Users className="w-5 h-5 text-slate-300 group-hover:text-cyan-400" />
                  </div>
                  <h3 className="text-white font-bold group-hover:text-cyan-400 transition-colors">Multiplayer</h3>
                  <p className="text-[10px] text-slate-500 mt-1 uppercase tracking-wider group-hover:text-slate-400">Criar ou Entrar</p>
              </div>
          </div>

          {/* Live Mode (Disabled) */}
          <div className="relative w-64 h-40 bg-[#161b22] border border-white/5 rounded-lg flex flex-col items-center justify-center opacity-60 cursor-not-allowed">
               <div className="absolute top-2 right-2 bg-slate-800 text-[9px] font-bold px-1.5 py-0.5 rounded text-slate-400">EM BREVE</div>
               <div className="w-10 h-10 bg-slate-800 rounded-lg flex items-center justify-center mb-3">
                  <Radio className="w-5 h-5 text-slate-500" />
              </div>
              <h3 className="text-slate-400 font-bold">Modo Ao Vivo</h3>
              <p className="text-[10px] text-slate-600 mt-1 uppercase tracking-wider">Previsão em tempo real</p>
          </div>

      </div>

      {/* Footer Links */}
      <div className="flex gap-4">
          <Link href="/regras">
             <button className="flex items-center gap-2 px-6 py-2 rounded-full border border-white/10 bg-[#161b22] hover:bg-[#1c2128] text-sm text-slate-300 transition-colors">
                 <HelpCircle className="w-4 h-4" /> Como Funciona
             </button>
          </Link>
           <a href="#" className="flex items-center gap-2 px-6 py-2 rounded-full border border-white/10 bg-[#161b22] hover:bg-[#1c2128] text-sm text-slate-300 transition-colors">
                 <BookOpen className="w-4 h-4" /> Material de Estudo
             </a>
      </div>

      {/* SOCIAL SIDEBAR TOGGLE */}
      {user && (
          <button 
             onClick={() => setShowSocial(true)}
             className="fixed right-0 top-1/2 -translate-y-1/2 bg-slate-800 border-l border-y border-white/10 p-3 rounded-l-xl shadow-2xl hover:bg-slate-700 transition-all z-40 group"
          >
              <Users className="w-5 h-5 text-cyan-400" />
              <div className="absolute right-full top-1/2 -translate-y-1/2 mr-2 bg-black px-2 py-1 rounded text-xs text-white opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap">Jogadores Recentes</div>
          </button>
      )}

      {/* SOCIAL SIDEBAR */}
      {showSocial && (
          <div className="fixed inset-y-0 right-0 w-80 bg-[#0a0f1a] border-l border-white/10 z-[100] shadow-2xl animate-in slide-in-from-right flex flex-col">
              <div className="p-4 border-b border-white/10 flex items-center justify-between">
                  <h3 className="font-bold text-white flex items-center gap-2"><Users className="w-4 h-4 text-cyan-400"/> Jogadores ({allKnownPlayers.length})</h3>
                  <button onClick={() => setShowSocial(false)} className="text-slate-400 hover:text-white"><X className="w-4 h-4"/></button>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-2">
                  {allKnownPlayers.length === 0 && (
                      <div className="text-center p-8 text-slate-500 text-sm">
                          <Users className="w-8 h-8 mx-auto mb-2 opacity-20" />
                          Nenhum jogador encontrado no histórico.
                      </div>
                  )}
                  {allKnownPlayers.map(p => (
                      <div key={p.uid} className="bg-slate-900 border border-white/5 p-3 rounded-lg flex items-center gap-3 group hover:border-white/20 transition-all">
                           <div className="w-8 h-8 rounded-full bg-slate-800 overflow-hidden shrink-0 relative">
                               {p.photoURL ? <img src={p.photoURL} className="w-full h-full object-cover"/> : <div className="flex items-center justify-center h-full font-bold text-slate-500">{p.displayName[0]}</div>}
                               {/* Status Indicator */}
                               <div className={clsx("absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border border-slate-900", p.isOnline ? "bg-emerald-500" : "bg-slate-500")}></div>
                           </div>
                           <div className="flex-1 min-w-0">
                               <div className="font-bold text-white truncate text-sm">{p.displayName}</div>
                               <div className="text-[10px] text-slate-500 flex items-center gap-1">
                                   <span className={clsx("w-1.5 h-1.5 rounded-full", p.isOnline ? "bg-emerald-500" : "bg-slate-600")}></span> 
                                   {p.isOnline ? "Online" : "Offline"}
                               </div>
                           </div>
                           <button 
                                disabled={inviteSentTo === p.uid}
                                onClick={() => handleSendInvite(p.uid)} 
                                className="opacity-0 group-hover:opacity-100 transition-opacity bg-cyan-600 hover:bg-cyan-500 text-white p-1.5 rounded disabled:opacity-50"
                                title="Convidar para Sala"
                           >
                               {inviteSentTo === p.uid ? <Check className="w-4 h-4"/> : <UserPlus className="w-4 h-4" />}
                           </button>
                      </div>
                  ))}
              </div>
              <div className="p-4 border-t border-white/10 text-xs text-slate-500 text-center">
                  Crie uma sala Multiplayer para convidar amigos.
              </div>
          </div>
      )}

      {/* INVITE RECEIVED MODAL */}
      {incomingInvite && (
          <div className="fixed top-4 right-4 z-[200] w-80 bg-slate-900 border border-cyan-500/50 rounded-xl shadow-2xl p-4 animate-in slide-in-from-right">
              <div className="flex items-start gap-3">
                  <div className="bg-cyan-500/20 p-2 rounded-full text-cyan-400 animate-pulse">
                      <MessageSquare className="w-5 h-5" />
                  </div>
                  <div className="flex-1">
                      <h4 className="font-bold text-white text-sm">Convite para Jogar!</h4>
                      <p className="text-slate-300 text-xs mt-1">
                          <span className="text-white font-bold">{incomingInvite.hostName}</span> convidou você para uma partida.
                      </p>
                      <div className="flex gap-2 mt-3">
                          <button 
                              onClick={acceptInvite}
                              className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white py-1.5 rounded text-xs font-bold transition-colors"
                          >
                              Aceitar
                          </button>
                          <button 
                              onClick={declineInvite}
                              className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 py-1.5 rounded text-xs font-bold transition-colors"
                          >
                              Recusar
                          </button>
                      </div>
                  </div>
              </div>
          </div>
      )}

      {/* MULTIPLAYER SETUP MODAL (Existing Code) */}
      {isSetupOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in">
            <div className="bg-slate-900 border border-white/10 rounded-2xl p-6 w-full max-w-md shadow-2xl relative overflow-hidden">
                <button onClick={() => setIsSetupOpen(false)} className="absolute top-4 right-4 text-slate-500 hover:text-white z-10"><X className="w-5 h-5" /></button>
                {multiplayerView === 'menu' && (
                    <div className="animate-in slide-in-from-right duration-300">
                        <div className="text-center mb-8">
                            <Users className="w-12 h-12 text-white mx-auto mb-3" />
                            <h2 className="text-2xl font-bold text-white uppercase">Multiplayer</h2>
                            <p className="text-slate-400 text-sm">Escolha como deseja jogar</p>
                        </div>
                        <div className="space-y-4">
                            <button onClick={() => setMultiplayerView('create')} className="w-full bg-cyan-600 hover:bg-cyan-500 text-white p-4 rounded-xl flex items-center justify-between group transition-all">
                                <div className="flex items-center gap-3"><div className="bg-black/20 p-2 rounded-lg"><Gamepad2 className="w-6 h-6" /></div><div className="text-left"><div className="font-bold">Criar Nova Sala</div><div className="text-xs text-cyan-200">Você será o Host</div></div></div>
                                <ArrowRight className="w-5 h-5 opacity-50 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
                            </button>
                            <button onClick={() => setMultiplayerView('join')} className="w-full bg-slate-800 hover:bg-slate-700 text-white p-4 rounded-xl flex items-center justify-between group border border-white/10 transition-all">
                                <div className="flex items-center gap-3"><div className="bg-black/20 p-2 rounded-lg"><Hash className="w-6 h-6 text-slate-300" /></div><div className="text-left"><div className="font-bold">Entrar com Código</div><div className="text-xs text-slate-400">Junte-se a uma sala existente</div></div></div>
                                <ArrowRight className="w-5 h-5 opacity-50 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
                            </button>
                        </div>
                    </div>
                )}
                {/* ... existing Create/Join views ... */}
                {multiplayerView === 'create' && (
                     <div className="animate-in slide-in-from-right duration-300">
                        <button onClick={() => setMultiplayerView('menu')} className="absolute top-4 left-4 text-slate-500 hover:text-white flex items-center gap-1 text-xs font-bold uppercase tracking-wider"><ChevronLeft className="w-4 h-4" /> Voltar</button>
                        <div className="text-center mb-6 mt-2"><Shield className="w-10 h-10 text-cyan-400 mx-auto mb-2" /><h2 className="text-xl font-bold text-white uppercase">Configurar Sala</h2></div>
                        <div className="space-y-3 mb-8">{difficulties.map((diff) => (<button key={diff.id} onClick={() => setSelectedDifficulty(diff.id as PrevisaoDifficulty)} className={clsx("w-full flex items-center p-3 rounded-lg border transition-all text-left group", selectedDifficulty === diff.id ? `${diff.bg} ${diff.border} shadow-[0_0_15px_rgba(0,0,0,0.5)] scale-[1.02]` : "bg-slate-800/50 border-transparent hover:bg-slate-800 hover:border-white/10")}><div className={clsx("p-2 rounded-md mr-3 bg-black/20", diff.color)}><diff.icon className="w-5 h-5" /></div><div><div className={clsx("font-bold text-sm", selectedDifficulty === diff.id ? "text-white" : "text-slate-300")}>{diff.label}</div><div className="text-xs text-slate-500">{diff.desc}</div></div>{selectedDifficulty === diff.id && (<div className="ml-auto w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_5px_cyan]"></div>)}</button>))}</div>
                        <button onClick={handleCreateLobby} className="w-full bg-cyan-600 hover:bg-cyan-500 text-white font-bold py-3 rounded-xl shadow-lg shadow-cyan-900/40 transition-all hover:scale-[1.02] active:scale-95">Criar Sala</button>
                    </div>
                )}
                {multiplayerView === 'join' && (
                     <div className="animate-in slide-in-from-right duration-300">
                        <button onClick={() => setMultiplayerView('menu')} className="absolute top-4 left-4 text-slate-500 hover:text-white flex items-center gap-1 text-xs font-bold uppercase tracking-wider"><ChevronLeft className="w-4 h-4" /> Voltar</button>
                        <div className="text-center mb-8 mt-4"><Hash className="w-12 h-12 text-emerald-400 mx-auto mb-3" /><h2 className="text-xl font-bold text-white uppercase">Digitar Código</h2></div>
                        <div className="space-y-6"><div><input value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())} placeholder="CÓDIGO" maxLength={8} className="w-full bg-slate-950 border-2 border-slate-700 focus:border-emerald-500 rounded-xl px-4 py-4 text-center text-3xl font-black text-white tracking-[0.5em] placeholder:tracking-normal placeholder:text-slate-700 outline-none transition-colors" /><p className="text-center text-xs text-slate-500 mt-2">Exemplo: X7K9P2</p></div><button onClick={handleJoinLobby} disabled={joinCode.length < 4} className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-3 rounded-xl shadow-lg shadow-emerald-900/40 transition-all hover:scale-[1.02] active:scale-95 flex items-center justify-center gap-2">Entrar na Sala <ArrowRight className="w-4 h-4"/></button></div>
                    </div>
                )}
            </div>
        </div>
      )}
    </div>
  );
}
