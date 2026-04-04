const fs = require('fs');
let code = fs.readFileSync('lib/cptecRadarStations.ts', 'utf8');

code = code.replace(
  /export const IPMET_FIXED_BOUNDS = \{[\s\S]*?sw: \{[^\}]+\}\s*\};/,
  'export const IPMET_FIXED_BOUNDS = {\n  north: -19.4975,\n  south: -24.5,\n  east: -46.5,\n  west: -54.0,\n  ne: { lat: -19.4975, lng: -46.5 },\n  sw: { lat: -24.5, lng: -54.0 }\n};'
);

fs.writeFileSync('lib/cptecRadarStations.ts', code);
