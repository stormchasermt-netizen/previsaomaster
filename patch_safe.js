const fs = require('fs');

let code = fs.readFileSync('c:\\Users\\Usuário\\Downloads\\download (12)\\studio\\app\\ao-vivo\\page.tsx', 'utf8');

// Adiciona o router
code = code.replace(
  "import Link from 'next/link';",
  "import Link from 'next/link';\nimport { useRouter } from 'next/navigation';"
);

// Trata da segurança (Admin only)
const useAuthStr = "const { user } = useAuth();\n  const { addToast } = useToast();";
code = code.replace(
  useAuthStr,
  `const { user } = useAuth();
  const { addToast } = useToast();
  const router = useRouter();
  
  useEffect(() => {
    if (user !== undefined && (!user || (user.type !== 'admin' && user.type !== 'superadmin'))) {
      router.push('/');
    }
  }, [user, router]);
  
  useEffect(() => {
    const style = document.createElement('style');
    style.innerHTML = \`
      .maplibregl-canvas, .mapboxgl-canvas {
        image-rendering: pixelated !important;
        image-rendering: crisp-edges !important;
        image-rendering: -moz-crisp-edges !important;
        -ms-interpolation-mode: nearest-neighbor !important;
      }
    \`;
    document.head.appendChild(style);
    return () => {
      document.head.removeChild(style);
    };
  }, []);`
);

// Atualizar processWithWorker na Linha ~2370 para CPTEC
code = code.replace(
  "const cptecUrl = buildNowcastingPngUrl(dr.station, exactTs12, productType as any, true);",
  "const slug = (dr.station as CptecRadarStation).slug;\n        const cptecUrl = `/api/radar-ao-vivo2-image?file=${encodeURIComponent(slug + '/' + exactTs12 + (productType === 'velocidade' ? '-ppivr' : '') + '.png')}`;"
);

// Atualizar para ARGENTINA no mesmo método
code = code.replace(
  "const argUrl = buildArgentinaRadarPngUrl(dr.station, argTs, productType);",
  "const argUrl = `/api/radar-ao-vivo2-image?file=${encodeURIComponent('argentina-' + dr.station.id + '/' + exactTs12 + (productType === 'velocidade' ? '-ppivr' : '') + '.png')}`;"
);

// Atualizar outra referência da ARGENTINA se existir para trás
code = code.replace(
  "const argUrl = buildArgentinaRadarPngUrl(dr.station, argTs, productType);",
  "const argUrl = `/api/radar-ao-vivo2-image?file=${encodeURIComponent('argentina-' + dr.station.id + '/' + exactTs12 + (productType === 'velocidade' ? '-ppivr' : '') + '.png')}`;"
);

// Adicionar a interpolação para o Raster
code = code.replace(
  "'raster-opacity-transition': { duration: 450, delay: 0 }",
  "'raster-opacity-transition': { duration: 450, delay: 0 },\n                  'raster-resampling': 'nearest'"
);

// Contornar os pesos de CPU mudando só as assinaturas
const filterString = "async function filterValidSliderMinutesAgo(\n  dr: DisplayRadar,\n  productType: 'reflectividade' | 'velocidade' | 'vil' | 'waldvogel',\n  maxMinutes: number,\n  radarConfigs: RadarConfig[],\n  referenceTs12: string,\n  isHistorical: boolean,\n  signal?: AbortSignal\n): Promise<number[]> {\n  const configSlug = dr.type === 'cptec' ? dr.station.slug : `argentina:${dr.station.id}`;";

code = code.replace(
  filterString,
  `async function filterValidSliderMinutesAgo(
  dr: DisplayRadar,
  productType: 'reflectividade' | 'velocidade' | 'vil' | 'waldvogel',
  maxMinutes: number,
  radarConfigs: RadarConfig[],
  referenceTs12: string,
  isHistorical: boolean,
  signal?: AbortSignal
): Promise<number[]> {
  const cfg = radarConfigs.find((c) => c.stationSlug === (dr.type === 'cptec' ? dr.station.slug : \`argentina:\${dr.station.id}\`));
  const radarInterval = cfg?.updateIntervalMinutes ?? (dr.type === 'cptec' ? (dr.station.updateIntervalMinutes ?? 10) : 10);
  const step = Math.max(1, radarInterval);
  const candidates: number[] = [];
  for (let m = 0; m <= maxMinutes; m += step) candidates.push(m);
  return candidates.length > 0 ? candidates : [0];
  
  const configSlug = dr.type === 'cptec' ? dr.station.slug : \`argentina:\${dr.station.id}\`;`
);

const probeString = "async function probeRadarImageExists(\n  dr: DisplayRadar,\n  ts12: string,\n  productType: 'reflectividade' | 'velocidade' | 'vil' | 'waldvogel',\n  slugParam: string,\n  signal?: AbortSignal,\n  isHistorical: boolean = false\n): Promise<boolean> {";

code = code.replace(
  probeString,
  `async function probeRadarImageExists(
  dr: DisplayRadar,
  ts12: string,
  productType: 'reflectividade' | 'velocidade' | 'vil' | 'waldvogel',
  slugParam: string,
  signal?: AbortSignal,
  isHistorical: boolean = false
): Promise<boolean> {
  return true;`
);

// Update icones do Brasil
code = code.replace(
  "const RADAR_ICON_AVAILABLE = 'https://raw.githubusercontent.com/stormchasermt-netizen/previsaomaster/7e352d326e59aa65efc40ce2979d5a078a393dc4/radar-icon-svg-download-png-8993769.webp';",
  "const RADAR_ICON_AVAILABLE = 'https://raw.githubusercontent.com/stormchasermt-netizen/previsaomaster/78c82d9eb9f723ed65805e819046d598ace4a36e/radar-icon-svg-download-png-8993769.webp';"
);
code = code.replace(
  "const RADAR_ICON_UNAVAILABLE = 'https://raw.githubusercontent.com/stormchasermt-netizen/previsaomaster/7e352d326e59aa65efc40ce2979d5a078a393dc4/radar-icon-svg-download-png-8993769.webp';",
  "const RADAR_ICON_UNAVAILABLE = 'https://raw.githubusercontent.com/stormchasermt-netizen/previsaomaster/78c82d9eb9f723ed65805e819046d598ace4a36e/radar-icon-svg-download-png-8993769.webp';"
);

fs.writeFileSync('c:\\Users\\Usuário\\Downloads\\download (12)\\studio\\app\\ao-vivo\\page.tsx', code);
