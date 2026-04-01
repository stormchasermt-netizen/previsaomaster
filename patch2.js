const fs = require('fs');
let code = fs.readFileSync('c:\\Users\\Usuário\\Downloads\\download (12)\\studio\\app\\ao-vivo\\page.tsx', 'utf8');

const filterRegex = /async function filterValidSliderMinutesAgo\([\s\S]*?\): Promise<number\[\]> \{[\s\S]*?\n  \}/;
code = code.replace(filterRegex, `async function filterValidSliderMinutesAgo(dr: DisplayRadar, productType: 'reflectividade' | 'velocidade' | 'vil' | 'waldvogel', maxMinutes: number, radarConfigs: RadarConfig[], referenceTs12: string, isHistorical: boolean, signal?: AbortSignal): Promise<number[]> {
  const configSlug = dr.type === 'cptec' ? dr.station.slug : \`argentina:\${dr.station.id}\`;
  const cfg = radarConfigs.find((c) => c.stationSlug === configSlug);
  const radarInterval = cfg?.updateIntervalMinutes ?? (dr.type === 'cptec' ? (dr.station.updateIntervalMinutes ?? 10) : 10);
  const step = Math.max(1, radarInterval);
  const candidates: number[] = [];
  for (let m = 0; m <= maxMinutes; m += step) candidates.push(m);
  return candidates.length > 0 ? candidates : [0];
}`);

const probeRegex = /async function probeRadarImageExists\([\s\S]*?\): Promise<boolean> \{[\s\S]*?return false;\n  \}/;
code = code.replace(probeRegex, `async function probeRadarImageExists(dr: DisplayRadar, ts12: string, productType: 'reflectividade' | 'velocidade' | 'vil' | 'waldvogel', slugParam: string, signal?: AbortSignal, isHistorical: boolean = false): Promise<boolean> { return true; }`);

fs.writeFileSync('c:\\Users\\Usuário\\Downloads\\download (12)\\studio\\app\\ao-vivo\\page.tsx', code);
