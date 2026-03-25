'use client';
import React, { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { CloudLightning, ArrowRight } from 'lucide-react';

export default function Login() {
  const { loginWithGoogle, user } = useAuth();
  const router = useRouter();

  const searchParams = useSearchParams();
  
  useEffect(() => {
    if (user) {
      const trackId = searchParams.get('track');
      if (trackId) {
        router.push(`/rastros-tornados?track=${trackId}`);
      } else {
        router.push('/');
      }
    }
  }, [user, router, searchParams]);

  const handleGoogleLogin = () => {
    loginWithGoogle();
  };

  return (
    <div className="min-h-[70vh] flex items-center justify-center animate-in fade-in duration-700">
      <div className="w-full max-w-md bg-[#161b22] border border-white/10 rounded-2xl p-8 shadow-2xl relative overflow-hidden">
         {/* Background decoration */}
         <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-cyan-500 to-blue-600"></div>
         
         <div className="flex flex-col items-center text-center mb-8">
            <div className="h-20 w-20 bg-slate-800 rounded-2xl flex items-center justify-center mb-6 shadow-lg shadow-black/50 border border-white/5">
                <CloudLightning className="h-10 w-10 text-white" />
            </div>
            <h1 className="text-3xl font-black text-white uppercase tracking-tight mb-2">Bem-vindo</h1>
            <p className="text-slate-400 text-sm">Faça login para salvar seu progresso e acessar o ranking.</p>
         </div>

         <div className="space-y-4">
            <button 
                onClick={handleGoogleLogin}
                className="w-full bg-white hover:bg-slate-100 text-black p-4 rounded-xl flex items-center justify-center gap-3 transition-transform active:scale-95 font-bold shadow-xl"
            >
                <img src="https://www.google.com/favicon.ico" alt="G" className="w-5 h-5" />
                <span>Continuar com Google</span>
                <ArrowRight className="w-4 h-4 opacity-50" />
            </button>
         </div>
         
         <div className="mt-8 pt-6 border-t border-white/5 text-center">
            <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">
                Previsao Masters
            </p>
         </div>
      </div>
    </div>
  );
}
