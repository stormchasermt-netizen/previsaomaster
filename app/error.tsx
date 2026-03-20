'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const isRateError =
    error?.message?.toLowerCase().includes('rate') ||
    error?.message?.toLowerCase().includes('exceeded') ||
    error?.message?.toLowerCase().includes('429') ||
    error?.message?.toLowerCase().includes('quota');

  useEffect(() => {
    console.error('App error:', error);
  }, [error]);

  return (
    <div className="min-h-screen bg-[#0B0F19] flex flex-col items-center justify-center p-6 text-white">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="flex justify-center">
          <div className="p-4 rounded-full bg-amber-500/20">
            <AlertTriangle className="w-12 h-12 text-amber-400" />
          </div>
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-100 mb-2">
            {isRateError ? 'Muitas requisições' : 'Algo deu errado'}
          </h1>
          <p className="text-slate-400 text-sm">
            {isRateError
              ? 'O site está recebendo muitas visitas no momento. Tente novamente em alguns minutos.'
              : 'Ocorreu um erro ao carregar a página. Tente recarregar.'}
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            onClick={reset}
            className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-black font-bold text-sm transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Tentar novamente
          </button>
          <Link
            href="/"
            className="inline-flex items-center justify-center px-5 py-3 rounded-lg bg-slate-700 hover:bg-slate-600 text-white font-bold text-sm transition-colors"
          >
            Ir para o início
          </Link>
        </div>
      </div>
    </div>
  );
}
