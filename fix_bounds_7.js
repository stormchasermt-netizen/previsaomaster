const fs = require('fs');
let code = fs.readFileSync('lib/cptecRadarStations.ts', 'utf8');

// Replace IPMET_FIXED_BOUNDS entirely
let startIdx = code.indexOf('export const IPMET_FIXED_BOUNDS');
if (startIdx !== -1) {
  let endIdx = code.indexOf('};', startIdx) + 2;
  code = code.substring(0, startIdx) + 
         'export const IPMET_FIXED_BOUNDS = {\n  north: -19.4975,\n  south: -24.5,\n  east: -46.5,\n  west: -54.0,\n  ne: { lat: -19.4975, lng: -46.5 },\n  sw: { lat: -24.5, lng: -54.0 }\n};' + 
         code.substring(endIdx);
}

// Replace bounds for prudente/bauru
const lines = code.split('\n');
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes("id: 'IPMET-PRUDENTE'") || lines[i].includes("id: 'IPMET-BAURU'")) {
    lines[i] = lines[i].replace(/bounds: \{[^}]+\}/, 'bounds: { minLat: -24.5, maxLat: -19.4975, minLon: -54.0, maxLon: -46.5 }');
  }
}
code = lines.join('\n');

// Replace the old comment documenting the bounds
code = code.replace(
  /\/\*\*\s*\n\s*\* Bounding Box do Tile[\s\S]*?Leste\): -44.6430\s*\*\//,
  '/**\n * Bounding Box do Tile (Mosaico Integrado IPMet):\n * Latitude Mínima (Extremo Sul): -24.5\n * Longitude Mínima (Extremo Oeste): -54.0\n * Latitude Máxima (Extremo Norte): -19.4975\n * Longitude Máxima (Extremo Leste): -46.5\n */'
);

fs.writeFileSync('lib/cptecRadarStations.ts', code);
