'use client';
import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useMultiplayer } from '@/contexts/MultiplayerContext';
import { useAuth } from '@/contexts/AuthContext';
import { mockStore } from '@/lib/store';
import { pickRandomEvent } from '@/lib/gameLogic';
import { Users, Copy, Play, Loader2, LogOut, Shield, AlertTriangle, RefreshCw, CheckCircle, UserPlus, X, Check } from 'lucide-react';
import clsx from 'clsx';
import { useToast } from '@/contexts/ToastContext';

import { useWakeLock } from '@/hooks/useWakeLock';

export default function LobbyPage() {
    const params = useParams();
    const code = params.code as string;
    const { lobby, joinLobby, leaveLobby, startGame, recentPlayers, sendInvite, forceStartGame, isHost } = useMultiplayer();
    
    // Stability Hooks
    useWakeLock();
    
    // Prevent accidental tab close
    useEffect(() => {
        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            e.preventDefault();
            e.returnValue = '';
            return '';
        };
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, []);

    const { user } = useAuth();
    const { addToast } = useToast();
    const router = useRouter();

    const [isJoining, setIsJoining] = useState(true);
    const [joinError, setJoinError] = useState(false);
    
    // Social Sidebar State
    const [showSocial, setShowSocial] = useState(false);
    const [inviteSentTo, setInviteSentTo] = useState<string | null>(null);
    const [allKnownPlayers, setAllKnownPlayers] = useState<any[]>([]);

    // Load Players for Social Sidebar
    useEffect(() => {
        if (showSocial) {
            const loadPlayers = async () => {
                const scores = await mockStore.getScores();
                const playersMap = new Map();
                
                // 1. Process Recent Players
                recentPlayers.forEach(p => {
                    const isOnline = (Date.now() - (p.lastSeen || 0)) < 1000 * 60 * 15;
                    playersMap.set(p.uid, { ...p, isOnline });
                });
                
                // 2. Process Historical Players
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
                
                // Sort
                const list = Array.from(playersMap.values()).sort((a, b) => {
                    if (a.isOnline === b.isOnline) return a.displayName.localeCompare(b.displayName);
                    return a.isOnline ? -1 : 1;
                });

                setAllKnownPlayers(list);
            };
            loadPlayers();
        }
    }, [showSocial, recentPlayers]);

    const handleSendInvite = async (uid: string) => {
        setInviteSentTo(uid);
        if (lobby?.code) {
            await sendInvite(uid, lobby.code);
        }
        setTimeout(() => setInviteSentTo(null), 3000);
    };

    // Auto-join if url param exists and not in lobby
    useEffect(() => {
        const initJoin = async () => {
            if (code && user && (!lobby || lobby.code !== code)) {
                setIsJoining(true);
                setJoinError(false);
                const success = await joinLobby(code);
                setIsJoining(false);
                if (!success) setJoinError(true);
            } else if (lobby && lobby.code === code) {
                setIsJoining(false);
            }
        };
        initJoin();
    }, [code, user, lobby]); 

    // Redirect on lobby status change
    useEffect(() => {
        if (lobby?.status === 'playing' || lobby?.status === 'loading') {
            router.push('/jogar');
        }
    }, [lobby?.status, router]);

    if (!user) {
        return (
            <div className="min-h-[60vh] flex flex-col items-center justify-center">
                <p className="text-white mb-4">Você precisa estar logado para entrar na sala.</p>
                <button onClick={() => router.push('/login')} className="bg-white text-black px-4 py-2 rounded font-bold">Fazer Login</button>
            </div>
        );
    }

    if (joinError) {
        return (
            <div className="min-h-[60vh] flex flex-col items-center justify-center gap-6 animate-in fade-in">
                <div className="bg-red-500/10 border border-red-500/50 p-6 rounded-2xl text-center max-w-sm">
                    <AlertTriangle className="w-12 h-12 text-red-400 mx-auto mb-4" />
                    <h2 className="text-xl font-bold text-white mb-2">Falha na Conexão</h2>
                    <p className="text-slate-400 text-sm mb-2">Não foi possível conectar à sala <span className="text-white font-mono font-bold">{code}</span>.</p>
                    <p className="text-slate-500 text-xs mb-6">A sala pode não existir ou a partida já começou.</p>
                    <div className="flex flex-col gap-3">
                         <button onClick={() => { setJoinError(false); joinLobby(code); }} className="bg-red-600 text-white px-6 py-3 rounded-xl font-bold flex items-center justify-center gap-2">
                            <RefreshCw className="w-4 h-4" /> Tentar Novamente
                        </button>
                        <button onClick={() => router.push('/')} className="bg-slate-800 text-slate-300 px-6 py-3 rounded-xl font-bold">Voltar ao Menu</button>
                    </div>
                </div>
            </div>
        );
    }

    if (isJoining || !lobby) {
        return (
            <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4">
                <Loader2 className="w-12 h-12 text-cyan-400 animate-spin" />
                <p className="text-slate-400 animate-pulse">Conectando à sala...</p>
            </div>
        );
    }

    const playerCount = lobby.players.length;
    const canStart = playerCount >= 1; // Can start solo in a lobby now
    const isLoading = lobby.status === 'loading';

    const handleCopyInvite = () => {
        const url = `${window.location.origin}/lobby/${lobby.code}`;
        navigator.clipboard.writeText(url);
        addToast('Link copiado!', 'success');
    };

    const handleStart = async () => {
        if (!canStart && isHost) { addToast("Mínimo de 1 jogador.", 'error'); return; }
        const allEvents = await mockStore.getEvents();
        const activeEvents = allEvents.filter(e => e.active);
        if (activeEvents.length === 0) { addToast("Nenhum evento ativo no sistema.", 'error'); return; }
        const picked = pickRandomEvent(activeEvents, lobby?.currentEventId);
        if (!picked) { addToast("Nenhum evento disponível para jogar.", 'error'); return; }
        startGame(picked.id);
    };

    return (
        <div className="max-w-4xl mx-auto p-6 space-y-8 animate-in fade-in pb-32">
            <div className="text-center space-y-2">
                <h1 className="text-4xl font-black text-white uppercase tracking-tight">
                    {isLoading ? 'Preparando Partida' : 'Sala de Espera'}
                </h1>
                <div className="inline-flex items-center gap-2 bg-slate-800 px-4 py-2 rounded-lg border border-white/10">
                    <span className="text-slate-400 text-sm font-bold uppercase">Código:</span>
                    <span className="text-cyan-400 font-mono text-xl tracking-widest font-bold">{lobby.code}</span>
                    <button onClick={handleCopyInvite} className="ml-2 text-slate-400 hover:text-white"><Copy className="w-4 h-4" /></button>
                </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {lobby.players.map(player => (
                    <div key={player.uid} className="bg-slate-900 border border-white/10 p-4 rounded-xl flex flex-col items-center relative group">
                        {player.isHost && <div className="absolute top-2 right-2 text-amber-400"><Shield className="w-4 h-4" /></div>}
                        <div className="w-16 h-16 rounded-full bg-slate-800 mb-3 overflow-hidden border-2 border-slate-700 relative">
                            {player.photoURL ? <img src={player.photoURL} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-xl font-bold text-slate-500">{player.displayName[0]}</div>}
                        </div>
                        <div className="font-bold text-white text-center truncate w-full">{player.displayName}</div>
                        <div className="text-xs font-bold mt-1 text-emerald-400">
                           Pronto
                        </div>
                    </div>
                ))}
            </div>

            {/* SOCIAL SIDEBAR TOGGLE */}
            <button 
                onClick={() => setShowSocial(true)}
                className="fixed right-0 top-24 md:top-32 bg-slate-800 border-l border-y border-white/10 p-3 rounded-l-xl shadow-2xl hover:bg-slate-700 transition-all z-[80] group"
            >
                <UserPlus className="w-5 h-5 text-cyan-400" />
                <div className="absolute right-full top-1/2 -translate-y-1/2 mr-2 bg-black px-2 py-1 rounded text-xs text-white opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap">Convidar Amigo</div>
            </button>

            {/* SOCIAL SIDEBAR */}
            {showSocial && (
                <div className="fixed inset-y-0 right-0 w-80 bg-[#0a0f1a] border-l border-white/10 z-[100] shadow-2xl animate-in slide-in-from-right flex flex-col">
                    <div className="p-4 border-b border-white/10 flex items-center justify-between">
                        <h3 className="font-bold text-white flex items-center gap-2"><Users className="w-4 h-4 text-cyan-400"/> Convidar ({allKnownPlayers.length})</h3>
                        <button onClick={() => setShowSocial(false)} className="text-slate-400 hover:text-white"><X className="w-4 h-4"/></button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-2 space-y-2">
                        {allKnownPlayers.length === 0 && (
                            <div className="text-center p-8 text-slate-500 text-sm">
                                <Users className="w-8 h-8 mx-auto mb-2 opacity-20" />
                                Nenhum jogador encontrado.
                            </div>
                        )}
                        {allKnownPlayers.map(p => {
                            // Don't show players already in lobby
                            const isInLobby = lobby.players.some(lp => lp.uid === p.uid);
                            if (isInLobby) return null;

                            return (
                                <div key={p.uid} className="bg-slate-900 border border-white/5 p-3 rounded-lg flex items-center gap-3 group hover:border-white/20 transition-all">
                                    <div className="w-8 h-8 rounded-full bg-slate-800 overflow-hidden shrink-0 relative">
                                        {p.photoURL ? <img src={p.photoURL} className="w-full h-full object-cover"/> : <div className="flex items-center justify-center h-full font-bold text-slate-500">{p.displayName[0]}</div>}
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
                                            title="Convidar"
                                    >
                                        {inviteSentTo === p.uid ? <Check className="w-4 h-4"/> : <UserPlus className="w-4 h-4" />}
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            <div className="fixed bottom-8 left-0 w-full bg-[#0a0f1a] border-t border-white/10 p-4 z-[60] shadow-2xl">
                <div className="max-w-4xl mx-auto flex items-center justify-between">
                    <button onClick={leaveLobby} className="flex items-center gap-2 text-red-400 hover:text-red-300 font-bold px-4 py-3 rounded-lg hover:bg-red-900/10">
                        <LogOut className="w-5 h-5" /> Sair
                    </button>
                    <div className="flex items-center gap-4">
                        <div className="text-sm hidden sm:block font-medium text-slate-400">{playerCount}/20 jogadores</div>
                        {isLoading ? (
                            <div className="flex items-center gap-2">
                                <div className="bg-slate-800 text-white px-4 md:px-8 py-3 rounded-xl font-bold flex items-center gap-2 border border-white/10 animate-pulse">
                                    <Loader2 className="w-5 h-5 animate-spin" /> <span>Carregando...</span>
                                </div>
                                {isHost && (
                                    <button 
                                        onClick={forceStartGame}
                                        className="bg-amber-600 hover:bg-amber-500 text-white px-4 py-3 rounded-xl font-bold flex items-center gap-2 transition-all shadow-lg animate-in fade-in"
                                        title="Forçar início da partida"
                                    >
                                        <Play className="w-5 h-5" /> <span>Forçar Início</span>
                                    </button>
                                )}
                            </div>
                        ) : isHost ? (
                            <button onClick={handleStart} disabled={!canStart} className={clsx("px-8 py-3 rounded-xl font-bold flex items-center gap-2 transition-all", canStart ? "bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg" : "bg-slate-800 text-slate-500 cursor-not-allowed")}>
                                <Play className="w-5 h-5" /> Iniciar Partida
                            </button>
                        ) : (
                            <div className="flex items-center gap-2 text-slate-400 bg-slate-800 px-4 py-3 rounded-lg animate-pulse border border-white/5">
                                <Loader2 className="w-4 h-4 animate-spin" /> Aguardando o Host...
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
