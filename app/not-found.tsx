'use client';

import Link from 'next/link';
import { Frown } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="min-h-[70vh] flex flex-col items-center justify-center text-center p-4">
      <div className="mb-8">
        <Frown className="w-20 h-20 text-slate-700 mx-auto" />
      </div>
      <h1 className="text-4xl md:text-5xl font-black text-white tracking-tight mb-2 uppercase">404 - Não Encontrado</h1>
      <p className="text-slate-400 max-w-lg mb-8">A página que você está tentando acessar não existe ou foi movida. Verifique o endereço e tente novamente.</p>
      <Link href="/">
        <button className="bg-cyan-600 hover:bg-cyan-500 text-white font-bold py-3 px-6 rounded-lg transition-colors hover:shadow-xl hover:shadow-cyan-900/50">
          Voltar para a Página Inicial
        </button>
      </Link>
    </div>
  );
}
