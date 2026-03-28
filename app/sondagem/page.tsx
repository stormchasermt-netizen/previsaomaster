'use client';

import React, { useState, useEffect } from 'react';
import { 
  CloudLightning, 
  Upload, 
  FileText, 
  RefreshCcw, 
  Download, 
  ChevronLeft,
  AlertCircle,
  Loader2
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';

const API_BASE = 'http://localhost:9090';

export default function SondagemPage() {
  const [csvContent, setCsvContent] = useState<string | null>(null);
  const [title, setTitle] = useState('Sondagem - Previsão Master');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageData, setImageData] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState('');

  // Carregar sedenova.csv automaticamente ao entrar se não houver dados
  const loadSedenova = async () => {
    setLoading(true);
    setStatusMsg('Carregando sedenova.csv...');
    try {
      const resp = await fetch('/sedenova.csv');
      if (!resp.ok) throw new Error('Não foi possível carregar o arquivo sedenova.csv');
      const text = await resp.text();
      setCsvContent(text);
      setTitle('Sede Nova - SHARPpy Native');
      setStatusMsg('Arquivo carregado. Processando...');
      await processSounding(text, 'Sede Nova - SHARPpy Native');
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  const processSounding = async (csv: string, soundingTitle: string) => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(`${API_BASE}/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          csv: csv,
          title: soundingTitle
        })
      });

      const data = await resp.json();
      if (data.error) {
        throw new Error(data.error);
      }

      setImageData(data.base64_img);
      setStatusMsg('Sondagem renderizada com sucesso!');
    } catch (err: any) {
      setError(`Erro no Backend: ${err.message}. Certifique-se que o serviço Python está rodando na porta 9090.`);
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result as string;
      setCsvContent(text);
      setTitle(file.name.replace('.csv', ''));
      processSounding(text, file.name.replace('.csv', ''));
    };
    reader.readAsText(file);
  };

  return (
    <div className="min-h-screen bg-[#f8f9fa] text-black selection:bg-cyan-500/20">
      {/* Header */}
      <header className="bg-white border-b border-black/5 sticky top-0 z-30 px-6 py-4 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-4">
          <Link href="/">
            <button className="p-2 hover:bg-black/5 rounded-full transition-colors">
              <ChevronLeft className="w-5 h-5" />
            </button>
          </Link>
          <div className="flex items-center gap-2">
            <CloudLightning className="w-6 h-6 text-black" />
            <span className="font-bold text-lg">SHARPpy Native Dashboard</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button 
            onClick={loadSedenova}
            disabled={loading}
            className="px-4 py-2 bg-black text-white rounded-full text-sm font-bold flex items-center gap-2 hover:bg-black/80 disabled:opacity-50 transition-all"
          >
            <RefreshCcw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Carregar sedenova.csv
          </button>
          
          <label className="px-4 py-2 border border-black/10 rounded-full text-sm font-bold cursor-pointer hover:bg-black/5 transition-all flex items-center gap-2">
            <Upload className="w-4 h-4" />
            Upload CSV
            <input type="file" className="hidden" accept=".csv" onChange={handleFileUpload} />
          </label>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto p-6 flex flex-col gap-6">
        {/* Status Bar */}
        <AnimatePresence>
          {error && (
            <motion.div 
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="bg-red-50 border border-red-200 p-4 rounded-xl flex items-center gap-3 text-red-700 text-sm font-medium"
            >
              <AlertCircle className="w-5 h-5" />
              {error}
            </motion.div>
          )}
          
          {!error && statusMsg && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="px-4 text-xs font-bold text-black/40 flex items-center gap-2 uppercase tracking-widest"
            >
              <div className={`w-2 h-2 rounded-full ${loading ? 'bg-amber-500 animate-pulse' : 'bg-green-500'}`} />
              {statusMsg}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Main Display Area */}
        <div className="flex flex-col gap-4">
          <div className="bg-white rounded-2xl border border-black/5 p-4 shadow-2xl min-h-[600px] flex items-center justify-center relative overflow-hidden group">
            {imageData ? (
              <motion.div 
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                className="w-full h-full flex flex-col items-center"
              >
                <div className="absolute top-6 right-6 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <a 
                    href={imageData} 
                    download={`${title}.png`}
                    className="p-3 bg-white/90 backdrop-blur shadow-lg rounded-full hover:bg-black hover:text-white transition-all"
                  >
                    <Download className="w-5 h-5" />
                  </a>
                </div>
                <img 
                  src={imageData} 
                  alt="Sounding" 
                  className="max-w-full h-auto rounded-lg shadow-lg border border-black/5"
                />
              </motion.div>
            ) : (
              <div className="text-center">
                <div className="bg-black/5 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4">
                  {loading ? <Loader2 className="w-10 h-10 text-black/20 animate-spin" /> : <FileText className="w-10 h-10 text-black/10" />}
                </div>
                <h3 className="text-xl font-bold text-black/40">Nenhuma sondagem carregada</h3>
                <p className="text-sm text-black/20 mt-2">Arraste um CSV ou clique em carregar sedenova</p>
              </div>
            )}
          </div>
        </div>

        {/* Info Box */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
          <div className="bg-black text-white p-6 rounded-3xl shadow-xl">
             <h4 className="text-xs font-black uppercase tracking-widest opacity-40 mb-4">Configuração</h4>
             <div className="space-y-4">
                <div>
                  <p className="text-xs opacity-60">Título Ativo</p>
                  <p className="font-bold text-lg">{title}</p>
                </div>
                <div className="flex items-center gap-2 px-3 py-1 bg-white/10 rounded-full w-fit">
                   <div className="w-2 h-2 rounded-full bg-cyan-400" />
                   <span className="text-[10px] font-black uppercase tracking-tighter">Hemisfério Sul</span>
                </div>
             </div>
          </div>
          
          <div className="bg-white border border-black/5 p-6 rounded-3xl col-span-2">
             <h4 className="text-xs font-black uppercase tracking-widest text-black/40 mb-4">Sobre o Motor Nativo</h4>
             <p className="text-sm text-black/60 leading-relaxed">
                Esta interface utiliza o motor de renderização original do <strong>SHARPpy</strong> via PyQt5.
                Ao contrário das versões simplificadas, esta gera o painel completo conforme os padrões do SPC/NWS, 
                incluindo Cálculos Bunkers ajustados para o Hemisfério Sul (Left Mover) e barbelas de vento orientadas corretamente.
             </p>
          </div>
        </div>
      </main>

      <footer className="py-10 text-center text-[10px] font-black uppercase tracking-[0.2em] text-black/20 border-t border-black/5">
         Powered by SHARPpy v9.0 Native Engine
      </footer>
    </div>
  );
}
