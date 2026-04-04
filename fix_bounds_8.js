const fs = require('fs');
let code = fs.readFileSync('lib/cptecRadarStations.ts', 'utf8');

code = code.replace(
  /\/\*\*\s*\n\s*\* Bounding Box do Tile[\s\S]*?Leste\): -44\.6430\s*\*\//,
  '/**\n * Bounding Box do Tile (Mosaico Integrado IPMet):\n * Latitude Mínima (Extremo Sul): -24.5\n * Longitude Mínima (Extremo Oeste): -54.0\n * Latitude Máxima (Extremo Norte): -19.4975\n * Longitude Máxima (Extremo Leste): -46.5\n */'
);

fs.writeFileSync('lib/cptecRadarStations.ts', code);
