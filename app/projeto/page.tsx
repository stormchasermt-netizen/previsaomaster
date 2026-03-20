'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Mail, Database, Server, Archive, FileSearch, Shield, ChevronRight } from 'lucide-react';

type Tab = 'projeto' | 'aplicacao';

export default function ProjetoPage() {
  const [activeTab, setActiveTab] = useState<Tab>('projeto');

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in pb-24 pt-4">
      {/* Header com envelope destacado */}
      <div className="text-center space-y-4">
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 text-sm font-medium mb-4">
          <Mail className="w-4 h-4" />
          Transparência sobre dados e serviços
        </div>
        <h1 className="text-4xl font-black text-white uppercase tracking-tight">
          Projeto & Aplicação
        </h1>
        <p className="text-slate-400 max-w-2xl mx-auto">
          Entenda o que é público, o que é pago e como protegemos a infraestrutura pública.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-white/10 pb-2">
        <button
          onClick={() => setActiveTab('projeto')}
          className={`flex items-center gap-2 px-4 py-2 rounded-t-lg font-medium text-sm transition-colors ${
            activeTab === 'projeto'
              ? 'bg-white/10 text-white border border-white/20 border-b-0'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Database className="w-4 h-4" />
          Projeto
        </button>
        <button
          onClick={() => setActiveTab('aplicacao')}
          className={`flex items-center gap-2 px-4 py-2 rounded-t-lg font-medium text-sm transition-colors ${
            activeTab === 'aplicacao'
              ? 'bg-white/10 text-white border border-white/20 border-b-0'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <FileSearch className="w-4 h-4" />
          Aplicação
        </button>
      </div>

      {/* Conteúdo Projeto */}
      {activeTab === 'projeto' && (
        <div className="space-y-6">
          <section className="bg-emerald-500/5 border border-emerald-500/20 p-6 rounded-2xl">
            <h2 className="text-xl font-bold text-emerald-400 mb-4 flex items-center gap-2">
              <Database className="w-5 h-5" />
              Os dados são públicos
            </h2>
            <p className="text-slate-300 leading-relaxed">
              <strong className="text-white">Não cobramos pelos dados meteorológicos.</strong> Radares, imagens de satélite 
              e informações de previsão de tempo são de origem pública (CPTEC/INPE, IPMet e outras instituições). 
              Esses dados pertencem a todos os brasileiros.
            </p>
          </section>

          <section className="bg-slate-900/50 border border-white/10 p-6 rounded-2xl space-y-4">
            <h2 className="text-xl font-bold text-cyan-400 flex items-center gap-2">
              <Server className="w-5 h-5" />
              O que cobramos (valor agregado)
            </h2>
            <p className="text-slate-300 leading-relaxed">
              Existe uma diferença jurídica entre <em>vender o dado</em> e <em>vender um serviço de conveniência</em>.
            </p>
            <ul className="space-y-3 text-slate-300">
              <li className="flex gap-3">
                <span className="text-cyan-500 font-bold">→</span>
                <span><strong className="text-white">Armazenamento:</strong> hospedagem do histórico que o governo não oferece.</span>
              </li>
              <li className="flex gap-3">
                <span className="text-cyan-500 font-bold">→</span>
                <span><strong className="text-white">Processamento:</strong> Cloud Functions, tratamento e organização dos dados.</span>
              </li>
              <li className="flex gap-3">
                <span className="text-cyan-500 font-bold">→</span>
                <span><strong className="text-white">Historicidade:</strong> banco de dados histórico que construímos e mantemos.</span>
              </li>
              <li className="flex gap-3">
                <span className="text-cyan-500 font-bold">→</span>
                <span><strong className="text-white">Interface:</strong> plataforma tecnológica de visualização e leitura científica.</span>
              </li>
            </ul>
            <p className="text-slate-400 text-sm italic mt-4">
              O usuário não está pagando pelo PNG do INPE. Está pagando para acessar um banco de dados histórico 
              que construímos, mantivemos e pagamos a infraestrutura (Firebase) para existir.
            </p>
          </section>

          <section className="bg-slate-900/50 border border-white/10 p-6 rounded-2xl space-y-4">
            <h2 className="text-xl font-bold text-amber-400 flex items-center gap-2">
              <Shield className="w-5 h-5" />
              Proteção da infraestrutura pública
            </h2>
            <p className="text-slate-300 leading-relaxed">
              O cache que utilizamos é um argumento ético importante: <strong className="text-white">não sobrecarregamos o Estado.</strong>
            </p>
            <p className="text-slate-300 leading-relaxed">
              Baixamos cada imagem uma vez e servimos para milhares de usuários pelo nosso próprio servidor. 
              Isso demonstra que somos parceiros da infraestrutura pública, não parasitas.
            </p>
          </section>
        </div>
      )}

      {/* Conteúdo Aplicação */}
      {activeTab === 'aplicacao' && (
        <div className="space-y-6">
          <section className="bg-slate-900/50 border border-white/10 p-6 rounded-2xl space-y-4">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <Archive className="w-5 h-5" />
              Citação de fonte
            </h2>
            <p className="text-slate-300 leading-relaxed">
              Em todas as telas do sistema:
            </p>
            <blockquote className="bg-black/30 border-l-4 border-cyan-500 p-4 rounded-r-lg text-slate-300 italic">
              &quot;Dados originais obtidos de CPTEC/INPE e instituições parceiras. Este sistema é uma plataforma 
              de visualização e armazenamento independente.&quot;
            </blockquote>
          </section>

          <section className="bg-slate-900/50 border border-white/10 p-6 rounded-2xl space-y-4">
            <h2 className="text-xl font-bold text-white">Marcas e logos</h2>
            <p className="text-slate-300 leading-relaxed">
              Não utilizamos logos oficiais do INPE ou IPMet como se o aplicativo fosse parceiro oficial. 
              Isso seria uso indevido de marca.
            </p>
          </section>

          <section className="bg-slate-900/50 border border-white/10 p-6 rounded-2xl space-y-4">
            <h2 className="text-xl font-bold text-white">Termo de uso</h2>
            <p className="text-slate-300 leading-relaxed">
              A assinatura (quando aplicável) remunera o <strong>serviço</strong> de processamento, armazenamento 
              histórico e disponibilidade da plataforma tecnológica. Os dados meteorológicos são de origem pública.
            </p>
          </section>
        </div>
      )}

      {/* Citação de fonte */}
      <div className="bg-slate-900/30 border border-white/5 p-4 rounded-xl">
        <p className="text-center text-xs text-slate-500">
          Dados originais: CPTEC/INPE. Plataforma de visualização e armazenamento independente.
        </p>
      </div>

      <div className="pt-4">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-slate-400 hover:text-white transition-colors text-sm font-medium"
        >
          <ChevronRight className="w-4 h-4 rotate-180" />
          Voltar ao início
        </Link>
      </div>
    </div>
  );
}
