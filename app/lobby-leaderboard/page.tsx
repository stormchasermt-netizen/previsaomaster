'use client';
import React, { useEffect, useState } from 'react';
import { useMultiplayer } from '@/contexts/MultiplayerContext';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { mockStore } from '@/lib/store';
import { pickRandomEvent } from '@/lib/gameLogic';
import { Trophy, ArrowRight, StopCircle, Clock, Medal, AlertTriangle, Loader2 } from 'lucide-react';
import clsx from 'clsx';
import { useToast } from '@/contexts/ToastContext';

export default function LobbyLeaderboard() {
    const { lobby, nextRound, endMatch, leaveLobby } = useMultiplayer();
    const { user } = useAuth();
    const router = useRouter();
    const { addToast } = useToast();

    const [isStarting, setIsStarting] = useState(false);

    // Redirect if lobby not in correct state
    useEffect(() => {
        if (!lobby) {
            router.push('/');
            return;
        }
        if (lobby.status === 'loading' || lobby.status === 'playing') {
            router.push('/jogar');
            return;
        }
        if (lobby.status === 'finished') {
            // Wait 5s then leave
            const timer = setTimeout(() => {
                leaveLobby();
            }, 8000);
            return () => clearTimeout(timer);
        }
    }, [lobby?.status]);

    const isHost = lobby?.hostId === user?.uid;

    const handleNext = async () => {
         setIsStarting(true);
         // Pick random event (async)
         const allEvents = await mockStore.getEvents();
         const activeEvents = allEvents.filter(e => e.active);
         
         if (activeEvents.length === 0) {
            addToast("Nenhum evento disponível.", 'error');
            setIsStarting(false);
            return;
         }

         const picked = pickRandomEvent(activeEvents, lobby?.currentEventId);
         if (!picked) { addToast("Nenhum evento disponível.", 'error'); setIsStarting(false); return; }
         nextRound(picked.id);
         // No need to set isStarting false, navigation will happen via effect
    };

    if (!lobby) return null;

    // Sort players by total score
    const sortedPlayers = [...lobby.players].sort((a, b) => b.totalScore - a.totalScore);

    return (
        <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-8 animate-in zoom-in-95 duration-300 pb-20">
            <div className="text-center mt-4">
                {lobby.status === 'finished' ? (
                     <h1 className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-200 to-yellow-500 uppercase">Fim de Jogo!</h1>
                ) : (
                    <h1 className="text-2xl md:text-3xl font-black text-white uppercase">Resultados da Rodada</h1>
                )}
                <p className="text-slate-400 mt-2 text-sm">Ranking atual da sala</p>
            </div>

            <div className="bg-slate-900 border border-white/10 rounded-2xl overflow-hidden shadow-2xl">
                <div className="grid grid-cols-1 divide-y divide-white/5">
                    {sortedPlayers.map((player, idx) => {
                        // Detect if player failed to submit (distance 99999 or explicitly 0 score with large distance)
                        const failedToSubmit = player.lastRoundDistance >= 99990;

                        return (
                            <div key={player.uid} className={clsx("p-4 flex items-center gap-3 md:gap-4", player.uid === user?.uid ? "bg-white/5" : "")}>
                                <div className="w-8 text-center font-bold text-lg text-slate-500 shrink-0">
                                    {idx === 0 ? <Medal className="w-6 h-6 text-yellow-400 mx-auto" /> : 
                                     idx === 1 ? <Medal className="w-6 h-6 text-slate-300 mx-auto" /> :
                                     idx === 2 ? <Medal className="w-6 h-6 text-amber-700 mx-auto" /> : idx + 1}
                                </div>
                                <div className="w-10 h-10 md:w-12 md:h-12 rounded-full bg-slate-800 overflow-hidden border border-white/10 shrink-0">
                                    {player.photoURL ? (
                                        <img src={player.photoURL} className="w-full h-full object-cover" />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center font-bold text-slate-500">
                                            {player.displayName[0]}
                                        </div>
                                    )}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="font-bold text-white flex items-center gap-2 truncate">
                                        {player.displayName} 
                                        {player.uid === user?.uid && <span className="text-[10px] bg-cyan-900 text-cyan-400 px-1.5 rounded shrink-0">VOCÊ</span>}
                                    </div>
                                    
                                    {failedToSubmit ? (
                                        <div className="text-xs text-red-400 font-bold flex items-center gap-1 mt-1">
                                            <AlertTriangle className="w-3 h-3" /> Sem Previsão
                                        </div>
                                    ) : (
                                        <div className="text-xs text-slate-400 flex flex-wrap gap-x-4 gap-y-1 mt-1">
                                            <span className="text-emerald-400 font-bold">+{player.lastRoundScore} pts</span>
                                            <span>Erro: {player.lastRoundDistance.toFixed(0)} km</span>
                                        </div>
                                    )}
                                </div>
                                <div className="text-right shrink-0">
                                    <div className="text-xl md:text-2xl font-black text-cyan-400">{player.totalScore}</div>
                                    <div className="text-[10px] text-slate-500 uppercase tracking-wider">Total</div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Host Controls */}
            {isHost && lobby.status !== 'finished' && (
                <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4 px-4">
                     <button 
                        onClick={endMatch}
                        className="w-full sm:w-auto bg-slate-800 hover:bg-slate-700 text-red-400 px-6 py-3 rounded-xl font-bold flex items-center justify-center gap-2 border border-white/5"
                     >
                        <StopCircle className="w-5 h-5" /> Encerrar
                     </button>
                     <button 
                        onClick={handleNext}
                        disabled={isStarting}
                        className={clsx(
                            "w-full sm:w-auto px-8 py-3 rounded-xl font-bold shadow-lg flex items-center justify-center gap-2 transition-all",
                            isStarting 
                                ? "bg-slate-700 text-slate-400 cursor-wait" 
                                : "bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-900/20 animate-pulse"
                        )}
                     >
                        {isStarting ? (
                            <>
                                <Loader2 className="w-5 h-5 animate-spin" /> Iniciando...
                            </>
                        ) : (
                            <>
                                <ArrowRight className="w-5 h-5" /> Próximo Cenário
                            </>
                        )}
                     </button>
                </div>
            )}
            
            {!isHost && lobby.status !== 'finished' && (
                 <div className="text-center text-slate-500 animate-pulse flex items-center justify-center gap-2">
                    <Clock className="w-4 h-4" /> Aguardando o Host...
                 </div>
            )}

            {lobby.status === 'finished' && (
                <div className="text-center text-slate-400 pb-8">
                    Retornando ao menu em instantes...
                </div>
            )}
        </div>
    );
}
