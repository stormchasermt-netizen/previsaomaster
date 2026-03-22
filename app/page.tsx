'use client';
import React from 'react';
import Link from 'next/link';
import { CloudLightning, Radio, HelpCircle, BookOpen, Wind, Gamepad2, Mail } from 'lucide-react';
import { motion, Variants } from 'framer-motion';
import { ParticleBackground } from '@/components/ParticleBackground';
import { useTranslation } from 'react-i18next';

export default function Home() {
  const containerVariants: Variants = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: 0.15
      }
    }
  };

  const itemVariants: Variants = {
    hidden: { opacity: 0, y: 20 },
    show: { 
        opacity: 1, 
        y: 0, 
        transition: { 
            type: 'spring', 
            stiffness: 300, 
            damping: 24 
        } 
    }
  };

  const { t } = useTranslation();

  return (
    <div className="flex flex-col items-center justify-center min-h-[80vh] relative overflow-hidden bg-black selection:bg-cyan-500/30">
      <ParticleBackground />
      
      {/* Envelope: Projeto & Dados (transparência) */}
      <Link
        href="/projeto"
        className="absolute top-6 right-6 z-20 flex items-center gap-2 px-3 py-2 rounded-full bg-white/5 border border-white/10 hover:border-cyan-500/40 hover:bg-cyan-500/10 text-slate-400 hover:text-cyan-400 transition-all group"
        title="Projeto e fontes de dados"
      >
        <Mail className="w-4 h-4" />
        <span className="text-xs font-medium hidden sm:inline">Projeto & Dados</span>
      </Link>
      
      {/* Ambient Glow Effects */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-600/20 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-600/20 rounded-full blur-[120px] pointer-events-none" />

      <motion.div 
        className="text-center mb-16 relative z-10"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: "easeOut" }}
      >
        <div className="mx-auto mb-6 relative w-24 h-24 flex items-center justify-center">
          <div className="absolute inset-0 bg-white/5 rounded-full blur-xl animate-pulse" />
          <CloudLightning className="w-20 h-20 text-white relative z-10" strokeWidth={1.5} />
        </div>
        <h1 className="text-4xl md:text-6xl font-black uppercase tracking-tighter mb-4 bg-clip-text text-transparent bg-gradient-to-b from-white via-gray-200 to-gray-500 leading-tight" style={{ fontFamily: 'Impact, sans-serif' }}>
          PREVISÃO MASTER
        </h1>
        <p className="text-cyan-400/80 text-sm md:text-base font-bold tracking-[0.2em] uppercase mb-8">
          {t('app_subtitle')}
        </p>

      </motion.div>

      <motion.div 
        className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16 relative z-10 w-full max-w-5xl px-4"
        variants={containerVariants}
        initial="hidden"
        animate="show"
      >
        {/* Jogos */}
        <motion.div variants={itemVariants}>
          <Link href="/jogos" className="block h-full">
            <motion.div 
              whileHover={{ y: -5, scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="h-48 bg-[#151A23]/80 backdrop-blur-md border border-white/5 hover:border-white/10 rounded-2xl flex flex-col items-center justify-center transition-colors shadow-xl hover:shadow-blue-900/20 relative overflow-hidden group"
            >
              <div className="absolute inset-0 bg-gradient-to-b from-cyan-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
              <div className="w-12 h-12 bg-white/5 rounded-xl flex items-center justify-center mb-4 group-hover:bg-cyan-500/20 group-hover:text-cyan-400 transition-colors duration-300">
                <Gamepad2 className="w-6 h-6 text-slate-300 group-hover:text-cyan-400" />
              </div>
              <h3 className="text-white font-bold text-lg mb-1 group-hover:text-cyan-400 transition-colors">Jogos</h3>
              <p className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold">Single, Multi, Previsao</p>
            </motion.div>
          </Link>
        </motion.div>

        {/* Rastros de Tornados */}
        <motion.div variants={itemVariants}>
          <Link href="/rastros-tornados" className="block h-full">
            <motion.div 
              whileHover={{ y: -5, scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="h-48 bg-[#151A23]/80 backdrop-blur-md border border-white/5 hover:border-white/10 rounded-2xl flex flex-col items-center justify-center transition-colors shadow-xl hover:shadow-red-900/20 relative overflow-hidden group"
            >
              <div className="absolute inset-0 bg-gradient-to-b from-red-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
              <div className="w-12 h-12 bg-white/5 rounded-xl flex items-center justify-center mb-4 group-hover:bg-red-500/20 group-hover:text-red-400 transition-colors duration-300">
                <Wind className="w-6 h-6 text-slate-300 group-hover:text-red-400" />
              </div>
              <h3 className="text-white font-bold text-lg mb-1 group-hover:text-red-400 transition-colors">Rastros de Tornados</h3>
              <p className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold">Mapa de eventos no Brasil</p>
            </motion.div>
          </Link>
        </motion.div>

        {/* Modo Ao Vivo */}
        <motion.div variants={itemVariants}>
          <Link href="/ao-vivo" className="block h-full">
            <motion.div 
              whileHover={{ y: -5, scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="h-48 bg-[#151A23]/80 backdrop-blur-md border border-white/5 hover:border-white/10 rounded-2xl flex flex-col items-center justify-center transition-colors shadow-xl hover:shadow-emerald-900/20 relative overflow-hidden group"
            >
              <div className="absolute inset-0 bg-gradient-to-b from-emerald-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
              <div className="w-12 h-12 bg-white/5 rounded-xl flex items-center justify-center mb-4 group-hover:bg-emerald-500/20 group-hover:text-emerald-400 transition-colors duration-300">
                <Radio className="w-6 h-6 text-slate-300 group-hover:text-emerald-400" />
              </div>
              <h3 className="text-white font-bold text-lg mb-1 group-hover:text-emerald-400 transition-colors">Modo Ao Vivo</h3>
              <p className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold">Previsao em tempo real</p>
            </motion.div>
          </Link>
        </motion.div>
      </motion.div>

      <motion.div 
        className="flex flex-wrap gap-3 justify-center relative z-10"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.8, duration: 0.5 }}
      >
        <Link href="/regras">
          <motion.button 
            whileHover={{ scale: 1.05, backgroundColor: 'rgba(255,255,255,0.1)' }}
            whileTap={{ scale: 0.95 }}
            className="flex items-center gap-2 px-6 py-2.5 rounded-full border border-white/10 bg-white/5 backdrop-blur-sm text-sm text-slate-300 font-medium transition-colors"
          >
            <HelpCircle className="w-4 h-4" /> Como Funciona
          </motion.button>
        </Link>
        <motion.a 
          href="#" 
          whileHover={{ scale: 1.05, backgroundColor: 'rgba(255,255,255,0.1)' }}
          whileTap={{ scale: 0.95 }}
          className="flex items-center gap-2 px-6 py-2.5 rounded-full border border-white/10 bg-white/5 backdrop-blur-sm text-sm text-slate-300 font-medium transition-colors"
        >
          <BookOpen className="w-4 h-4" /> Material de Estudo
        </motion.a>
        <Link href="/projeto">
          <motion.button 
            whileHover={{ scale: 1.05, backgroundColor: 'rgba(255,255,255,0.1)' }}
            whileTap={{ scale: 0.95 }}
            className="flex items-center gap-2 px-6 py-2.5 rounded-full border border-cyan-500/30 bg-cyan-500/5 backdrop-blur-sm text-sm text-cyan-400 font-medium transition-colors"
          >
            <Mail className="w-4 h-4" /> Projeto & Dados
          </motion.button>
        </Link>
      </motion.div>
    </div>
  );
}
