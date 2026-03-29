import Link from 'next/link';
import {
  ArrowLeft,
  Radar,
  Image as ImageIcon,
  Play,
  MapPin,
  Database,
  ListOrdered,
} from 'lucide-react';

/** Notas de planeamento / roadmap (histórico). */
export default function AoVivo3PlanejamentoPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4 flex flex-wrap items-center justify-between gap-3">
          <Link href="/ao-vivo-3" className="inline-flex items-center gap-2 text-sm text-cyan-400 hover:text-cyan-300">
            <ArrowLeft className="w-4 h-4" />
            Voltar ao Ao Vivo 3
          </Link>
          <span className="text-xs font-mono text-slate-500">Planeamento</span>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-10 space-y-10">
        <section className="space-y-3">
          <div className="flex items-center gap-3">
            <Radar className="w-8 h-8 text-amber-400" />
            <h1 className="text-2xl font-bold text-white">Notas técnicas</h1>
          </div>
          <p className="text-slate-400 text-sm">
            Tabela CPTEC completa em <code className="text-cyan-400">docs/radaresv2.txt</code>. Coordenadas em{' '}
            <code className="text-cyan-400">lib/radarV2Coords.ts</code>. Redemet / IPMET / storage já integrados no motor em{' '}
            <code className="text-cyan-400">app/ao-vivo-2/page.tsx</code>.
          </p>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 space-y-3">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <ListOrdered className="w-5 h-5 text-amber-500" />
            Prioridades
          </h2>
          <ul className="text-sm text-slate-300 space-y-2 list-disc pl-5">
            <li>Alinhar centro/bounds no mapa (WGS84).</li>
            <li>Canvas / filtros: só mostrar após processamento (ex. POA).</li>
            <li>Mosaico: pré-carga opcional via <code className="text-xs text-cyan-400">lib/radarImagePreload.ts</code>.</li>
            <li>Fallback: CPTEC → Redemet → storage (mais recente).</li>
          </ul>
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-slate-800 p-4 space-y-2">
            <h3 className="font-semibold text-white flex items-center gap-2">
              <ImageIcon className="w-4 h-4 text-cyan-400" /> Canvas
            </h3>
            <p className="text-xs text-slate-400">Evitar imagem “crua” antes do filtro.</p>
          </div>
          <div className="rounded-xl border border-slate-800 p-4 space-y-2">
            <h3 className="font-semibold text-white flex items-center gap-2">
              <Play className="w-4 h-4 text-emerald-400" /> Animação
            </h3>
            <p className="text-xs text-slate-400">Mosaico: intervalo ligeiramente maior; overlays só trocam após o lote carregar.</p>
          </div>
          <div className="rounded-xl border border-slate-800 p-4 space-y-2">
            <h3 className="font-semibold text-white flex items-center gap-2">
              <MapPin className="w-4 h-4 text-rose-400" /> Coordenadas
            </h3>
            <p className="text-xs text-slate-400">lat_centro / lon_centro vs bounds no ficheiro CPTEC.</p>
          </div>
          <div className="rounded-xl border border-slate-800 p-4 space-y-2">
            <h3 className="font-semibold text-white flex items-center gap-2">
              <Database className="w-4 h-4 text-sky-400" /> Fontes
            </h3>
            <p className="text-xs text-slate-400">APIs Redemet, IPMET, proxies e cache já ligados no Ao Vivo 2/3.</p>
          </div>
        </section>

        <footer className="pb-10 text-sm text-slate-500">
          <Link href="/ao-vivo-2" className="hover:text-cyan-400">
            Ao Vivo 2
          </Link>
        </footer>
      </main>
    </div>
  );
}
