const fs = require('fs');
let code = fs.readFileSync('lib/cptecRadarStations.ts', 'utf8');

// The multi-line regex was failing because of the newlines. Let's use a robust approach
let startIdx = code.indexOf('export const IPMET_FIXED_BOUNDS');
let endIdx = code.indexOf('};', startIdx) + 2;

if (startIdx !== -1 && endIdx !== -1) {
  code = code.substring(0, startIdx) + 
         'export const IPMET_FIXED_BOUNDS = {\n  north: -19.4975,\n  south: -24.5,\n  east: -46.5,\n  west: -54.0,\n  ne: { lat: -19.4975, lng: -46.5 },\n  sw: { lat: -24.5, lng: -54.0 }\n};' + 
         code.substring(endIdx);
}

// Replace the specific lines for prudente/bauru by doing string splits
const lines = code.split('\n');
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes("id: 'IPMET-PRUDENTE'") || lines[i].includes("id: 'IPMET-BAURU'")) {
    lines[i] = lines[i].replace(/bounds: \{[^}]+\}/, 'bounds: { minLat: -24.5, maxLat: -19.4975, minLon: -54.0, maxLon: -46.5 }');
  }
}
code = lines.join('\n');

fs.writeFileSync('lib/cptecRadarStations.ts', code);
console.log('done');
