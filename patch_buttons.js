const fs = require('fs');
let code = fs.readFileSync('app/ao-vivo-2/AoVivo2Content.tsx', 'utf8');

const buttons = `                <button
                  type="button"
                  onClick={() => setPrevotsOverlayVisible(!prevotsOverlayVisible)}
                  className={\`flex h-11 w-11 items-center justify-center rounded-xl shadow-lg ring-1 ring-black/5 transition \${
                    prevotsOverlayVisible ? 'bg-[#ff00ff] text-white shadow-[0_0_15px_rgba(255,0,255,0.4)]' : 'bg-white/95 text-slate-700 hover:bg-white'
                  }\`}
                  title="Alternar Overlay Prevots"
                >
                  <ShieldAlert className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  onClick={() => setReportStep('location')}
                  className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-500/90 text-slate-900 shadow-[0_0_15px_rgba(245,158,11,0.3)] transition hover:bg-amber-400 hover:scale-105"
                  title="Enviar relato"
                >
                  <AlertTriangle className="h-5 w-5" />
                </button>
`;

if (!code.includes('setPrevotsOverlayVisible(!prevotsOverlayVisible)')) {
  code = code.replace(
    /<ChevronLeft className="h-5 w-5" \/>\s*<\/Link>/,
    `<ChevronLeft className="h-5 w-5" />\n                </Link>\n${buttons}`
  );
}

fs.writeFileSync('app/ao-vivo-2/AoVivo2Content.tsx', code);
console.log('patched left buttons');
