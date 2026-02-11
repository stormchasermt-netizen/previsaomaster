import React from 'react';
import { Target, BookOpen, Calculator, Trophy, Users, ShieldAlert } from 'lucide-react';

export default function Rules() {
  return (
    <div className="max-w-4xl mx-auto space-y-12 animate-in fade-in pb-20">
        <div className="text-center space-y-4">
            <h1 className="text-4xl font-black text-white uppercase tracking-tight">Regras & Pontuação</h1>
            <p className="text-slate-400 max-w-2xl mx-auto">
                Entenda como o Previsão Master funciona e como maximizar sua pontuação.
            </p>
        </div>
        
        <div className="grid md:grid-cols-2 gap-8">
            <section className="bg-slate-900/50 border border-white/10 p-6 rounded-2xl space-y-4">
                <div className="flex items-center gap-3 mb-2">
                    <Target className="text-cyan-400 h-6 w-6" />
                    <h2 className="text-xl font-bold text-white">O Objetivo</h2>
                </div>
                <p className="text-slate-300 leading-relaxed text-sm">
                    O Previsão Master foi projetado para ajudar você a se tornar um melhor previsor de tempo severo. 
                    Ao praticar com eventos históricos reais, você desenvolverá as habilidades de reconhecimento de padrões 
                    que meteorologistas operacionais usam todos os dias. Seja você um entusiasta, estudante ou caçador de 
                    tempestades, este jogo afiará sua habilidade de identificar onde tornados são mais prováveis de ocorrer.
                </p>
            </section>

            <section className="bg-slate-900/50 border border-white/10 p-6 rounded-2xl space-y-4">
                <div className="flex items-center gap-3 mb-2">
                    <BookOpen className="text-emerald-400 h-6 w-6" />
                    <h2 className="text-xl font-bold text-white">Como Jogar</h2>
                </div>
                <ul className="space-y-3 text-slate-300 text-sm">
                    <li className="flex gap-2">
                        <span className="text-cyan-500 font-bold">•</span>
                        Você verá análises meteorológicas reais de um dia significativo (a data está oculta).
                    </li>
                    <li className="flex gap-2">
                        <span className="text-cyan-500 font-bold">•</span>
                        Seu trabalho é estudar a configuração atmosférica e posicionar seu alvo onde acredita que a atividade de tornados será focada.
                    </li>
                    <li className="flex gap-2">
                        <span className="text-cyan-500 font-bold">•</span>
                        Ao enviar, você verá os relatos reais de tempestade daquele dia e descobrirá quão perto sua previsão chegou.
                    </li>
                </ul>
            </section>
        </div>

        <section className="space-y-6">
             <div className="flex items-center gap-3">
                <Calculator className="text-amber-400 h-6 w-6" />
                <h2 className="text-2xl font-bold text-white">Níveis de Dificuldade</h2>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-slate-800 p-5 rounded-xl border border-white/5">
                    <div className="text-emerald-400 font-bold text-lg mb-1">Iniciante</div>
                    <div className="text-xs text-slate-500 uppercase font-bold mb-3">Multiplicador: 60%</div>
                    <p className="text-xs text-slate-300">Todas as ferramentas de análise disponíveis, incluindo parâmetros compostos como STP e SCP. Ótimo para aprender.</p>
                </div>
                <div className="bg-slate-800 p-5 rounded-xl border border-white/5">
                    <div className="text-cyan-400 font-bold text-lg mb-1">Intermediário</div>
                    <div className="text-xs text-slate-500 uppercase font-bold mb-3">Multiplicador: 80%</div>
                    <p className="text-xs text-slate-300">Sem parâmetros compostos. Você precisará juntar as peças da ameaça a partir dos ingredientes individuais.</p>
                </div>
                <div className="bg-slate-800 p-5 rounded-xl border border-white/5">
                    <div className="text-amber-400 font-bold text-lg mb-1">Especialista</div>
                    <div className="text-xs text-slate-500 uppercase font-bold mb-3">Multiplicador: 100%</div>
                    <p className="text-xs text-slate-300">Apenas análise de superfície. Como prever antes da era da orientação moderna.</p>
                </div>
                <div className="bg-slate-800 p-5 rounded-xl border border-white/5">
                    <div className="text-rose-400 font-bold text-lg mb-1">Mestre</div>
                    <div className="text-xs text-slate-500 uppercase font-bold mb-3">Multiplicador: 120%</div>
                    <p className="text-xs text-slate-300">Apenas análise 12Z com exigência de raio de 80 milhas. O desafio supremo.</p>
                </div>
            </div>
        </section>

        <section className="bg-gradient-to-r from-slate-900 to-slate-800 border border-white/10 p-8 rounded-2xl">
             <div className="flex items-center gap-3 mb-6">
                <Trophy className="text-yellow-400 h-6 w-6" />
                <h2 className="text-2xl font-bold text-white">Novo Sistema de Pontuação (Alvo + Área)</h2>
            </div>
            
            <div className="space-y-4 text-slate-300">
                <p>Sua pontuação final é a soma de dois componentes principais:</p>
                
                <div className="grid md:grid-cols-2 gap-6 mt-4 mb-6">
                    <div className="bg-black/30 p-4 rounded-lg border border-white/5">
                        <h3 className="text-emerald-400 font-bold mb-2">1. Pontos de Precisão (O Ponto)</h3>
                        <p className="text-sm">
                            Baseado unicamente na distância do seu alvo para o <strong>relato de tornado mais próximo</strong>.
                        </p>
                        <ul className="text-xs mt-2 list-disc list-inside text-slate-400">
                            <li>0 km = Pontuação Máxima (3000 pts)</li>
                            <li>A pontuação cai drasticamente à medida que você se afasta.</li>
                            <li>Acima de 100km = 0 pontos de precisão.</li>
                        </ul>
                    </div>

                    <div className="bg-black/30 p-4 rounded-lg border border-white/5">
                        <h3 className="text-cyan-400 font-bold mb-2">2. Pontos de Área (O Círculo)</h3>
                        <p className="text-sm">
                            Seu alvo gera um <strong>círculo de 100km</strong> de raio. Você ganha pontos por <strong>CADA relato</strong> que cair dentro deste círculo.
                        </p>
                        <ul className="text-xs mt-2 list-disc list-inside text-slate-400">
                            <li>Recompensa a previsão de agrupamentos (outbreaks).</li>
                            <li>Relatos mais próximos do centro do círculo valem mais.</li>
                        </ul>
                    </div>
                </div>

                <p className="text-sm font-bold text-white">Bônus Adicionais:</p>
                <ul className="space-y-2 list-disc list-inside ml-4 text-sm">
                    <li><strong className="text-white">Multiplicador de Dificuldade:</strong> Aplica-se sobre o total (60% a 120%).</li>
                    <li><strong className="text-white">Bônus de Sequência (Streak):</strong> Previsões consecutivas com erro menor que 100km aumentam sua pontuação em até 30%.</li>
                </ul>
            </div>
        </section>

        <section className="grid md:grid-cols-2 gap-8">
             <div className="space-y-4">
                <div className="flex items-center gap-3">
                    <Users className="text-purple-400 h-6 w-6" />
                    <h2 className="text-xl font-bold text-white">Modos de Jogo</h2>
                </div>
                <ul className="space-y-3 text-sm text-slate-300">
                    <li><strong className="text-white">Single Player:</strong> Pratique no seu próprio ritmo (Em Breve).</li>
                    <li><strong className="text-white">Multiplayer:</strong> Compita contra outros no Ranking Global.</li>
                    <li><strong className="text-white">Live Mode:</strong> Em breve! Preveja eventos reais enquanto acontecem.</li>
                </ul>
             </div>

             <div className="space-y-4">
                <div className="flex items-center gap-3">
                    <ShieldAlert className="text-red-400 h-6 w-6" />
                    <h2 className="text-xl font-bold text-white">Regras da Comunidade</h2>
                </div>
                <ul className="space-y-2 text-xs text-slate-400">
                    <li>• Nomes de usuário devem ser apropriados.</li>
                    <li>• Jogo limpo: O uso de ferramentas de desenvolvedor ou manipulação de dados é proibido.</li>
                    <li>• Detecção de DevTools: O jogo monitora o uso durante sessões ativas.</li>
                    <li>• Contas múltiplas para manipular o ranking resultarão em banimento.</li>
                </ul>
             </div>
        </section>
    </div>
  );
}
