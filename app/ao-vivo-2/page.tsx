import dynamic from 'next/dynamic';

const AoVivo2Content = dynamic(() => import('./AoVivo2Content'), {
  ssr: false,
  loading: () => (
    <div className="min-h-[100dvh] bg-slate-950 flex items-center justify-center">
      <div className="animate-spin rounded-full h-10 w-10 border-2 border-cyan-500 border-t-transparent" />
    </div>
  ),
});

export default function AoVivo2Page() {
  return <AoVivo2Content />;
}
