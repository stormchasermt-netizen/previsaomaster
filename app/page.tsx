'use client';
import React from 'react';
import Link from 'next/link';
import { CloudLightning, Gamepad2, Wind, Radio, Download, HelpCircle, BookOpen, Mail } from 'lucide-react';
import { motion } from 'framer-motion';
import { ParticleBackground } from '@/components/ParticleBackground';
import { useTranslation } from 'react-i18next';

export default function Home() {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col min-h-screen relative overflow-hidden bg-transparent selection:bg-cyan-500/30">
      
      {/* Partículas verdes e vermelhas que seguem o mouse */}
      <ParticleBackground />

      {/* Header Interno (Minimal de acordo com imagem) */}
      <nav className="w-full px-6 py-6 flex items-center justify-between relative z-20 max-w-7xl mx-auto">
        <div className="flex items-center gap-2 group cursor-pointer">
            <CloudLightning className="w-6 h-6 text-black" />
            <span className="font-bold text-lg tracking-tight">Previsão Master</span>
        </div>
        
        <div className="hidden md:flex items-center gap-8 text-sm font-semibold text-black/80">
            <a href="#" className="hover:text-black transition-colors">Sobre</a>
            <a href="#" className="hover:text-black transition-colors">Contato</a>
            <a href="#" className="hover:text-black transition-colors">Preços</a>
            <a href="#" className="hover:text-black transition-colors">Blog</a>
            <a href="#" className="hover:text-black transition-colors">Recursos</a>
        </div>

        <button className="bg-black text-white px-6 py-2 rounded-full text-sm font-bold flex items-center gap-2 hover:bg-black/80 transition-all shadow-lg hover:shadow-black/20">
            Download <Download className="w-4 h-4" />
        </button>
      </nav>

      {/* Hero Section */}
      <main className="flex-1 flex flex-col items-center justify-center text-center px-4 relative z-10 -mt-20">
        <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5 }}
            className="mb-8"
        >
            <CloudLightning className="w-20 h-20 text-black mx-auto" strokeWidth={1.5} />
            <h1 className="text-4xl md:text-6xl font-black text-black tracking-tight mt-4">Previsão Master</h1>
        </motion.div>

        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.5 }}
            className="max-w-2xl"
        >
            <h2 className="text-2xl md:text-4xl font-bold text-black/80 mb-10 leading-tight">
                O maior hub de meteorologia da América do Sul.
            </h2>

            {/* Ações Principais (Pill Shaped) */}
            <div className="flex flex-wrap justify-center gap-4 mb-20">
                <Link href="/jogos">
                    <button className="bg-black text-white px-8 py-4 rounded-full font-bold flex items-center gap-3 hover:scale-105 active:scale-95 transition-all shadow-[0_10px_30px_rgba(0,0,0,0.15)] group">
                        <Gamepad2 className="w-5 h-5 group-hover:rotate-12 transition-transform" /> Jogos
                    </button>
                </Link>
                <Link href="/rastros-tornados">
                    <button className="bg-black text-white px-8 py-4 rounded-full font-bold flex items-center gap-3 hover:scale-105 active:scale-95 transition-all shadow-[0_10px_30px_rgba(0,0,0,0.15)] group">
                        <Wind className="w-5 h-5 group-hover:-translate-y-1 transition-transform" /> Rastros de Tornados
                    </button>
                </Link>
                <Link href="/ao-vivo">
                    <button className="bg-black text-white px-8 py-4 rounded-full font-bold flex items-center gap-3 hover:scale-105 active:scale-95 transition-all shadow-[0_10px_30px_rgba(0,0,0,0.15)] group">
                        <Radio className="w-5 h-5" /> Modo Ao Vivo
                    </button>
                </Link>

            </div>
        </motion.div>

        {/* Footer de Links Internos com ícones Lucide profissionais */}
        <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="flex items-center gap-8 text-sm font-bold text-black/70 border-t border-black/5 pt-10"
        >
            <Link href="/regras" className="flex items-center gap-2 hover:text-black transition-colors">
                 <HelpCircle className="w-4 h-4" /> Como Funciona
            </Link>
            <a href="#" className="flex items-center gap-2 hover:text-black transition-colors">
                 <BookOpen className="w-4 h-4" /> Material de Estudo
            </a>
            <Link href="/projeto" className="flex items-center gap-2 hover:text-black transition-colors">
                 <Mail className="w-4 h-4" /> Projeto & Dados
            </Link>
        </motion.div>
      </main>

      {/* Rodapé Copyright */}
      <footer className="w-full py-8 text-center text-xs font-bold text-black/40">
        © 2025 Previsão Master
      </footer>
    </div>
  );
}
