'use client';
import React, { useEffect, useState } from 'react';
import { mockStore } from '@/lib/store';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { Trophy, Medal, User, Trash2, Zap } from 'lucide-react';

interface AggregatedScore {
    userId: string;
    displayName: string;
    photoURL?: string;
    totalScore: number;
    totalGames: number;
    bestScore: number;
    averageDistance: number;
}

export default function Ranking() {
  const { user } = useAuth();
  const { addToast } = useToast();
  const [leaderboard, setLeaderboard] = useState<AggregatedScore[]>([]);

  const loadScores = async () => {
    const all = await mockStore.getScores();
    
    // Aggregate by User
    const aggMap = new Map<string, AggregatedScore & { totalDistance: number }>();

    all.forEach(score => {
        if (!aggMap.has(score.userId)) {
            aggMap.set(score.userId, {
                userId: score.userId,
                displayName: score.displayName,
                photoURL: score.photoURL,
                totalScore: 0,
                totalGames: 0,
                bestScore: 0,
                averageDistance: 0,
                totalDistance: 0
            });
        }
        
        const entry = aggMap.get(score.userId)!;
        entry.totalScore += score.finalScore;
        entry.totalGames += 1;
        entry.totalDistance += score.distanceKm;
        if (score.finalScore > entry.bestScore) {
            entry.bestScore = score.finalScore;
        }
    });

    const finalLeaderboard: AggregatedScore[] = Array.from(aggMap.values()).map(entry => ({
        ...entry,
        averageDistance: entry.totalGames > 0 ? entry.totalDistance / entry.totalGames : 0
    }));

    // Sort by Total Score
    finalLeaderboard.sort((a, b) => b.totalScore - a.totalScore);
    
    setLeaderboard(finalLeaderboard);
  };

  useEffect(() => {
    loadScores();
  }, []);

  const handleClear = async () => {
    if (confirm('Tem certeza que deseja apagar todo o ranking? Isso apagará o histórico de todos os jogadores.')) {
        await mockStore.clearScores();
        loadScores();
        addToast('Ranking zerado com sucesso.', 'success');
    }
  };

  const isAdmin = user?.type === 'admin' || user?.type === 'superadmin';

  return (
    <div className="space-y-8 animate-in fade-in pb-20">
      <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-black text-white flex items-center gap-2 uppercase tracking-tight">
                <Trophy className="text-amber-400 h-8 w-8" /> Ranking Global
            </h1>
            <p className="text-slate-400 text-sm mt-1">Pontuação total acumulada por jogador</p>
          </div>
          
          {isAdmin && leaderboard.length > 0 && (
             <button 
                onClick={handleClear}
                className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1 border border-red-500/30 px-3 py-1.5 rounded hover:bg-red-500/10 transition-colors"
             >
                <Trash2 className="h-3 w-3" /> Zerar (Admin)
             </button>
          )}
      </div>

      <div className="bg-slate-900/50 border border-white/10 rounded-xl overflow-hidden shadow-2xl">
        <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[600px]">
                <thead>
                    <tr className="bg-slate-950 border-b border-white/10 text-[10px] uppercase tracking-wider text-slate-500 font-bold">
                        <th className="p-4 w-16 text-center">Pos</th>
                        <th className="p-4">Jogador</th>
                        <th className="p-4 text-center">Partidas</th>
                        <th className="p-4 text-center">Melhor Pontuação</th>
                        <th className="p-4 text-right">Pontuação Total</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                    {leaderboard.length === 0 ? (
                        <tr>
                            <td colSpan={5} className="p-12 text-center text-slate-500 flex flex-col items-center justify-center gap-2">
                                <Zap className="w-8 h-8 opacity-20" />
                                <span>Ainda não há pontuações registradas. Jogue para aparecer aqui!</span>
                            </td>
                        </tr>
                    ) : (
                        leaderboard.map((s, i) => (
                            <tr key={s.userId} className={s.userId === user?.uid ? "bg-cyan-900/10" : "hover:bg-slate-800/30 transition-colors"}>
                                <td className="p-4 text-center">
                                    <div className="flex justify-center">
                                        {i === 0 && <Medal className="h-6 w-6 text-yellow-400 drop-shadow-[0_0_5px_rgba(250,204,21,0.5)]" />}
                                        {i === 1 && <Medal className="h-6 w-6 text-slate-300 drop-shadow-[0_0_5px_rgba(203,213,225,0.5)]" />}
                                        {i === 2 && <Medal className="h-6 w-6 text-amber-700 drop-shadow-[0_0_5px_rgba(180,83,9,0.5)]" />}
                                        {i > 2 && <span className="font-mono text-slate-500 font-bold">#{i + 1}</span>}
                                    </div>
                                </td>
                                <td className="p-4">
                                    <div className="flex items-center gap-3">
                                        <div className="h-10 w-10 rounded-full bg-slate-800 flex items-center justify-center overflow-hidden border border-white/10 shrink-0">
                                            {s.photoURL ? <img src={s.photoURL} alt="" className="w-full h-full object-cover" /> : <User className="h-5 w-5 text-slate-400"/>}
                                        </div>
                                        <div>
                                            <div className="text-white font-bold flex items-center gap-2">
                                                {s.displayName}
                                                {s.userId === user?.uid && <span className="text-[9px] bg-cyan-600 text-white px-1.5 py-0.5 rounded">VOCÊ</span>}
                                            </div>
                                            <div className="text-xs text-slate-500">Média de Erro: {s.averageDistance.toFixed(0)} km</div>
                                        </div>
                                    </div>
                                </td>
                                <td className="p-4 text-center text-slate-300 font-medium">
                                    {s.totalGames}
                                </td>
                                <td className="p-4 text-center text-emerald-400 font-mono font-medium">
                                    {s.bestScore.toLocaleString()}
                                </td>
                                <td className="p-4 text-right">
                                    <span className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-500">
                                        {s.totalScore.toLocaleString()}
                                    </span>
                                </td>
                            </tr>
                        ))
                    )}
                </tbody>
            </table>
        </div>
      </div>
    </div>
  );
}
