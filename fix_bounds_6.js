const fs = require('fs');
let code = fs.readFileSync('lib/cptecRadarStations.ts', 'utf8');

// Replace IPMET_FIXED_BOUNDS entirely
code = code.replace(
  /export const IPMET_FIXED_BOUNDS = \{[^}]+\};/g,
  'export const IPMET_FIXED_BOUNDS = {\n  north: -19.4975,\n  south: -24.5,\n  east: -46.5,\n  west: -54.0,\n  ne: { lat: -19.4975, lng: -46.5 },\n  sw: { lat: -24.5, lng: -54.0 }\n};'
);

// Replace bounds for prudente
const lines = code.split('\n');
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes("id: 'IPMET-PRUDENTE'") || lines[i].includes("id: 'IPMET-BAURU'")) {
    lines[i] = lines[i].replace(/bounds: \{[^}]+\}/, 'bounds: { minLat: -24.5, maxLat: -19.4975, minLon: -54.0, maxLon: -46.5 }');
  }
}
code = lines.join('\n');

code = code.replace(
  /\/\*\*[\s\S]*?Latitude M[íi]nima \(Extremo Sul\): -26\.4118[\s\S]*?\*\//,
  '/**\n * Bounding Box do Tile (Mosaico Integrado IPMet):\n * Latitude Mínima (Extremo Sul): -24.5\n * Longitude Mínima (Extremo Oeste): -54.0\n * Latitude Máxima (Extremo Norte): -19.4975\n * Longitude Máxima (Extremo Leste): -46.5\n */'
);

fs.writeFileSync('lib/cptecRadarStations.ts', code);
