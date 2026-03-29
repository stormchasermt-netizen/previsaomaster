'use client';

import Link from 'next/link';
import AoVivo2Page from '../ao-vivo-2/page';

/**
 * Ao Vivo 3 — mesma experiência técnica do Ao Vivo 2 (CPTEC, Argentina, Redemet, IPMET, storage, etc.),
 * com ajustes de animação mosaico no motor compartilhado (sem remover overlays até o novo lote carregar).
 */
export default function AoVivo3Page() {
  return (
    <div className="relative min-h-screen">
      <div
        className="pointer-events-none fixed top-0 left-0 right-0 z-[2147483000] flex justify-center pt-2 px-2"
        aria-hidden
      >
        <div className="pointer-events-auto max-w-[min(100%,42rem)] flex flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-full border border-cyan-500/35 bg-slate-950/92 px-4 py-2 text-[11px] text-slate-300 shadow-xl backdrop-blur-md">
          <span className="font-bold uppercase tracking-wide text-cyan-400">Ao Vivo 3</span>
          <span className="text-slate-500 hidden sm:inline">Motor partilhado com Ao Vivo 2 · animação mosaico mais suave</span>
          <Link
            href="/ao-vivo-3/planejamento"
            className="text-amber-400/90 hover:text-amber-300 underline-offset-2 hover:underline"
          >
            Plano / notas
          </Link>
        </div>
      </div>
      <AoVivo2Page />
    </div>
  );
}
