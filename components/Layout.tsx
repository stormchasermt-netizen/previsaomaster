'use client';
import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { CloudLightning, Settings, BarChart2, User, X, LogOut, Save, Volume2, Music, Shield, Film, Mail, Languages } from 'lucide-react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { mockStore } from '@/lib/store';
import { PrevisaoScore } from '@/lib/types';

export default function AppLayout({ children }: { children?: React.ReactNode }) {
  const { user, loginWithGoogle, updateUsername, logout } = useAuth();
  const { t, i18n } = useTranslation();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAccountOpen, setIsAccountOpen] = useState(false);
  const [isLangOpen, setIsLangOpen] = useState(false);
  const [userScores, setUserScores] = useState<PrevisaoScore[]>([]);
  
  // Settings & Theme State
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [musicEnabled, setMusicEnabled] = useState(true);

  // Account State
  const [newUsername, setNewUsername] = useState('');
  
  useEffect(() => {
    let isMounted = true;
    if (user) {
        mockStore.getScores().then(scores => {
            if (isMounted) {
                // Filter scores for the current user and sort by creation date descending
                const filteredAndSorted = scores
                    .filter(s => s.userId === user.uid)
                    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
                setUserScores(filteredAndSorted);
            }
        });
    } else {
        setUserScores([]);
    }
    return () => { isMounted = false; };
  }, [user, isAccountOpen]); // Re-fetch when user or modal state changes

  const handleOpenAccount = () => {
      setIsSettingsOpen(false);
      setNewUsername(user?.displayName || '');
      setIsAccountOpen(true);
  };

  const handleSaveProfile = async () => {
      if(newUsername.trim() && newUsername.trim() !== user?.displayName) {
          await updateUsername(newUsername.trim());
          setIsAccountOpen(false);
      } else {
          setIsAccountOpen(false);
      }
  };

  const handleGoogleLogin = () => {
      loginWithGoogle();
  };

  const stats = userScores;
  const totalScore = stats.reduce((acc, curr) => acc + curr.finalScore, 0);
  const bestDistance = stats.length > 0 ? Math.min(...stats.map(s => s.distanceKm)) : 0;
  
  const pathname = usePathname();
  const isFullScreenPage = pathname === '/rastros-tornados' || pathname === '/ao-vivo' || pathname?.startsWith('/jogar') || pathname?.startsWith('/admin');
  
  // Only calculate best personal score from valid games (distance is not 99999)
  const validGames = stats.filter(s => s.distanceKm < 99900);
  const bestScore = validGames.length > 0 ? Math.max(...validGames.map(s => s.finalScore)) : 0;

  return (
    <div className={clsx(
        "min-h-screen font-sans selection:bg-cyan-500/30 relative overflow-x-hidden transition-colors duration-300",
        isDarkMode ? "bg-[#0B0F19] text-white dark" : "bg-white text-black"
    )}>
      
      {/* BACKGROUND IMAGE WITH BLUR */}
      <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
           {/* Ambient Glow Effects (Lower opacity in light mode) */}
          <div className={clsx("absolute top-1/4 left-1/4 w-[500px] h-[500px] rounded-full blur-[120px] pointer-events-none", isDarkMode ? "bg-blue-600/10" : "bg-blue-400/5")} />
          <div className={clsx("absolute bottom-1/4 right-1/4 w-[500px] h-[500px] rounded-full blur-[120px] pointer-events-none", isDarkMode ? "bg-purple-600/10" : "bg-purple-400/5")} />

          {/* Image Layer - New Image from User */}
          <div 
            className={clsx(
                "absolute inset-0 bg-cover bg-center bg-no-repeat transition-all duration-700",
                isDarkMode ? "blur-[6px] scale-105 opacity-60 mix-blend-luminosity" : "opacity-90"
            )}
            style={{ 
                backgroundImage: "url('https://raw.githubusercontent.com/stormchasermt-netizen/main/2fe3f12651522e5692b3bd958731fe0ae5edf4e7/remova_todos_os_202603212216.png')" 
            }}
          ></div>

          {/* Dark Overlay for Text Readability (Conditional) */}
          <div className={clsx(
              "absolute inset-0 transition-colors duration-500",
              isDarkMode ? "bg-[#0B0F19]/80 backdrop-blur-[2px]" : "bg-white/40"
          )}></div>
          
          {/* Lightning Flash Layer (Kept for effect) */}
          <div className="absolute inset-0 z-0 bg-white opacity-0 animate-lightning pointer-events-none mix-blend-overlay"></div>
      </div>

      {/* HEADER — oculto em páginas de tela cheia (rastros-tornados, jogar) para não sobrepor o mapa */}
      {!isFullScreenPage && (
      <header className="sticky top-0 z-40 bg-[#0B0F19]/80 backdrop-blur-md px-6 h-16 flex items-center justify-between border-b border-white/5 shadow-lg shadow-black/20">
         <div className="flex items-center gap-4">
             <Link href="/" prefetch={false} className="text-xs font-bold tracking-widest text-slate-300 hover:text-white uppercase flex items-center gap-2 transition-colors">
                <CloudLightning className="h-5 w-5 text-cyan-400" /> 
                <span className="hidden sm:inline">{t('app_title')}</span>
             </Link>
         </div>

         <div className="flex items-center gap-2">
            {/* Language Switcher */}
            <div className="relative">
                <button 
                    onClick={() => setIsLangOpen(!isLangOpen)}
                    className="p-2 text-slate-400 hover:text-cyan-400 hover:bg-white/5 rounded-lg transition-colors flex items-center gap-1"
                    title="Change Language"
                >
                    <Languages className="w-5 h-5" />
                    <span className="text-[10px] font-bold uppercase">{i18n.language.split('-')[0]}</span>
                </button>

                {isLangOpen && (
                    <div className="absolute top-full right-0 mt-2 p-2 bg-[#161b22] border border-white/10 rounded-xl shadow-2xl z-50 flex flex-col gap-1 min-w-[120px]">
                        {[
                            { code: 'pt', label: 'Português', flag: 'https://flagcdn.com/w40/br.png' },
                            { code: 'en', label: 'English', flag: 'https://flagcdn.com/w40/us.png' },
                            { code: 'es', label: 'Español', flag: 'https://flagcdn.com/w40/es.png' }
                        ].map((lang) => (
                            <button
                                key={lang.code}
                                onClick={() => {
                                    i18n.changeLanguage(lang.code);
                                    setIsLangOpen(false);
                                }}
                                className={clsx(
                                    "flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-bold transition-colors w-full text-left",
                                    i18n.language.startsWith(lang.code) ? "bg-cyan-500/20 text-cyan-400" : "hover:bg-white/5 text-slate-400"
                                )}
                            >
                                <img src={lang.flag} className="w-5 h-5 rounded-full object-cover border border-white/10" alt={lang.label} />
                                {lang.label}
                            </button>
                        ))}
                    </div>
                )}
            </div>

             <button 
                onClick={() => setIsDarkMode(!isDarkMode)}
                className={clsx(
                    "p-2 rounded-lg transition-colors",
                    isDarkMode ? "text-yellow-400 hover:bg-white/5" : "text-slate-600 hover:bg-black/5"
                )}
                title={isDarkMode ? "Modo Claro" : "Modo Escuro"}
             >
                {isDarkMode ? <span className="text-lg">☀️</span> : <span className="text-lg">🌙</span>}
             </button>

            <Link href="/projeto" prefetch={false} className={clsx("p-2 rounded-lg transition-colors", isDarkMode ? "text-slate-400 hover:text-cyan-400 hover:bg-white/5" : "text-slate-600 hover:text-cyan-600 hover:bg-black/5")} title={t('nav_project')}>
              <Mail className="w-5 h-5" />
            </Link>
            {!user ? (
                 <button 
                    onClick={handleGoogleLogin}
                    className="flex items-center gap-2 bg-white text-black px-4 py-1.5 rounded-full text-sm font-bold hover:bg-cyan-50 transition-colors shadow-[0_0_15px_rgba(255,255,255,0.3)]"
                 >
                     <img src="https://www.google.com/favicon.ico" alt="G" className="w-3 h-3" />
                    {t('btn_login')}
                 </button>
            ) : (
                <>
                    {(user.type === 'admin' || user.type === 'superadmin') && (
                        <Link href="/admin" prefetch={false} className="p-2 text-amber-400 hover:bg-white/5 rounded-lg transition-colors" title="Painel Admin">
                            <Shield className="w-5 h-5" />
                        </Link>
                    )}

                    <Link href="/ranking" prefetch={false} className="p-2 text-slate-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors">
                        <BarChart2 className="w-5 h-5" />
                    </Link>

                    <Link href="/streaming" prefetch={false} className="p-2 text-slate-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors" title="Documentários 4K">
                        <Film className="w-5 h-5" />
                    </Link>

                    <button 
                        onClick={() => setIsSettingsOpen(true)}
                        className="p-2 text-slate-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
                    >
                        <Settings className="w-5 h-5" />
                    </button>

                    <div className="ml-2 flex items-center gap-2 bg-slate-800/50 pl-1 pr-3 py-1 rounded-full border border-white/10 hover:border-cyan-500/30 transition-colors">
                         {user.photoURL ? (
                             <img src={user.photoURL} className="w-6 h-6 rounded-full" alt="Profile" />
                         ) : (
                             <div className="w-6 h-6 rounded-full bg-cyan-500 flex items-center justify-center text-xs font-bold">{user.displayName[0]}</div>
                         )}
                         <span className="text-xs font-bold text-slate-300 max-w-[80px] truncate">{user.displayName}</span>
                    </div>
                </>
            )}
         </div>
      </header>
      )}

      <main className="w-full relative z-10">
        {children}
      </main>

      {!isFullScreenPage && (
      <footer className="fixed bottom-0 w-full py-4 text-center text-[10px] text-slate-500 border-t border-white/5 bg-[#0a0f1a]/90 backdrop-blur z-30">
          <div className="flex items-center justify-center gap-2">
            <CloudLightning className="h-3 w-3" /> © 2025 Previsão Master
          </div>
      </footer>
      )}

      {/* SETTINGS MODAL */}
      {isSettingsOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in">
              <div className="w-full max-w-md bg-[#161b22] border border-white/10 rounded-xl shadow-2xl overflow-hidden">
                  <div className="flex items-center justify-between p-4 border-b border-white/5">
                      <h2 className="text-lg font-bold flex items-center gap-2">
                          <Settings className="w-5 h-5 text-blue-400" /> {t('settings_title')}
                      </h2>
                      <button onClick={() => setIsSettingsOpen(false)} className="text-slate-400 hover:text-white"><X className="w-5 h-5"/></button>
                  </div>
                  
                  <div className="p-4 space-y-4">
                      {/* Account Settings Button */}
                      <button 
                        onClick={handleOpenAccount}
                        className="w-full flex items-center justify-between bg-slate-800/50 hover:bg-slate-800 border border-white/5 p-4 rounded-lg transition-colors group"
                      >
                          <div className="flex items-center gap-3">
                              <div className="bg-blue-500/10 p-2 rounded-full text-blue-400 group-hover:text-blue-300">
                                  <User className="w-5 h-5" />
                              </div>
                              <span className="font-bold text-sm">Configurações da Conta</span>
                          </div>
                          <span className="text-slate-500 text-lg">›</span>
                      </button>

                      <div className="border-t border-white/5 my-4"></div>

                      {/* Sound Toggles */}
                      <div className="flex items-center justify-between p-2">
                          <div className="flex items-center gap-3">
                               <Volume2 className="w-5 h-5 text-slate-400" />
                               <div>
                                   <div className="font-bold text-sm">Efeitos Sonoros</div>
                                   <div className="text-xs text-slate-500">Sons de eventos do jogo</div>
                               </div>
                          </div>
                          <button 
                            onClick={() => setSoundEnabled(!soundEnabled)}
                            className={clsx("w-10 h-6 rounded-full relative transition-colors", soundEnabled ? "bg-blue-600" : "bg-slate-700")}
                          >
                              <div className={clsx("absolute top-1 w-4 h-4 bg-white rounded-full transition-all", soundEnabled ? "left-5" : "left-1")} />
                          </button>
                      </div>

                      <div className="flex items-center justify-between p-2">
                          <div className="flex items-center gap-3">
                               <Music className="w-5 h-5 text-slate-400" />
                               <div>
                                   <div className="font-bold text-sm">Música</div>
                                   <div className="text-xs text-slate-500">Música de fundo</div>
                               </div>
                          </div>
                          <button 
                            onClick={() => setMusicEnabled(!musicEnabled)}
                            className={clsx("w-10 h-6 rounded-full relative transition-colors", musicEnabled ? "bg-blue-600" : "bg-slate-700")}
                          >
                              <div className={clsx("absolute top-1 w-4 h-4 bg-white rounded-full transition-all", musicEnabled ? "left-5" : "left-1")} />
                          </button>
                      </div>
                      
                       <div className="border-t border-white/5 my-4"></div>
                       
                       <div className="grid grid-cols-2 gap-2">
                           <Link href="/regras" prefetch={false} onClick={() => setIsSettingsOpen(false)} className="bg-slate-800 hover:bg-slate-700 text-xs font-bold text-center py-3 rounded border border-white/5">
                               ? Regras
                           </Link>
                           <Link href="/ranking" prefetch={false} onClick={() => setIsSettingsOpen(false)} className="bg-slate-800 hover:bg-slate-700 text-xs font-bold text-center py-3 rounded border border-white/5">
                               Ranking
                           </Link>
                       </div>

                  </div>
              </div>
          </div>
      )}

      {/* ACCOUNT MODAL */}
      {isAccountOpen && user && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in">
              <div className="w-full max-w-md bg-[#161b22] border border-white/10 rounded-xl shadow-2xl overflow-hidden">
                  <div className="flex items-center justify-between p-4 border-b border-white/5">
                      <h2 className="text-lg font-bold flex items-center gap-2">
                          <User className="w-5 h-5 text-blue-400" /> Perfil de Usuário
                      </h2>
                      <button onClick={() => setIsAccountOpen(false)} className="text-slate-400 hover:text-white"><X className="w-5 h-5"/></button>
                  </div>
                  
                  <div className="p-6 space-y-6">
                      <div className="bg-slate-800/30 rounded-lg p-4 flex items-center gap-4 border border-white/5">
                           {user.photoURL ? (
                               <img src={user.photoURL} className="w-12 h-12 rounded-full border border-white/10 shadow-lg" alt="" />
                           ) : (
                               <div className="w-12 h-12 rounded-full bg-cyan-600 flex items-center justify-center text-xl font-bold">{user.displayName[0]}</div>
                           )}
                           <div>
                               <div className="font-bold text-lg">{user.displayName}</div>
                               <div className="text-xs text-slate-500">{user.email}</div>
                               <div className="text-[10px] uppercase font-bold text-cyan-500 mt-1">{user.type}</div>
                           </div>
                      </div>

                      <div className="space-y-2">
                          <label className="text-xs font-bold text-slate-500 uppercase">Alterar Nome de Usuário</label>
                          <div className="flex gap-2">
                              <input 
                                value={newUsername}
                                onChange={(e) => setNewUsername(e.target.value)}
                                className="flex-1 bg-black border border-white/10 rounded px-3 py-2 text-sm focus:border-blue-500 outline-none"
                                placeholder="Novo nome"
                              />
                              <button 
                                onClick={handleSaveProfile}
                                className="bg-blue-600 hover:bg-blue-500 text-white px-4 rounded text-sm font-bold"
                              >
                                  Salvar
                              </button>
                          </div>
                      </div>

                      <div className="space-y-2">
                          <label className="text-xs font-bold text-slate-500 uppercase">Estatísticas (Nuvem)</label>
                          <div className="grid grid-cols-2 gap-2">
                              <div className="bg-black/50 p-3 rounded border border-white/5">
                                  <div className="text-xs text-slate-500">Pontuação Total</div>
                                  <div className="text-lg font-mono font-bold">{totalScore.toLocaleString()}</div>
                              </div>
                              <div className="bg-black/50 p-3 rounded border border-white/5">
                                  <div className="text-xs text-slate-500">Partidas</div>
                                  <div className="text-lg font-mono font-bold">{stats.length}</div>
                              </div>
                               <div className="bg-black/50 p-3 rounded border border-white/5">
                                  <div className="text-xs text-slate-500">Melhor Distância</div>
                                  <div className="text-lg font-mono font-bold">{bestDistance.toFixed(0)} <span className="text-xs font-sans font-normal text-slate-600">km</span></div>
                              </div>
                               <div className="bg-black/50 p-3 rounded border border-white/5">
                                  <div className="text-xs text-slate-500">Recorde Pessoal</div>
                                  <div className="text-lg font-mono font-bold">{bestScore.toLocaleString()}</div>
                              </div>
                          </div>
                      </div>

                      <button 
                        onClick={() => { logout(); setIsAccountOpen(false); }}
                        className="w-full border border-red-500/20 text-red-400 hover:bg-red-500/10 py-3 rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition-colors mt-4"
                      >
                          <LogOut className="w-4 h-4" /> Sair da Conta
                      </button>

                  </div>
              </div>
          </div>
      )}
    </div>
  );
}
