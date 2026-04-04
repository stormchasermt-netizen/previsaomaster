const fs = require('fs');
let code = fs.readFileSync('lib/cptecRadarStations.ts', 'utf8');

// Replace IPMET_FIXED_BOUNDS entirely
code = code.replace(
  /export const IPMET_FIXED_BOUNDS = \{[^}]+\};/g,
  'export const IPMET_FIXED_BOUNDS = {\n  north: -19.4975,\n  south: -24.5,\n  east: -46.5,\n  west: -54.0,\n  ne: { lat: -19.4975, lng: -46.5 },\n  sw: { lat: -24.5, lng: -54.0 }\n};'
);

// Replace bounds for prudente
code = code.replace(
  /{ id: 'IPMET-PRUDENTE', [^}]+\}, sigmaConfig:/g,
  (match) => {
    return match.replace(/bounds: \{[^}]+\}/, 'bounds: { minLat: -24.5, maxLat: -19.4975, minLon: -54.0, maxLon: -46.5 }');
  }
);

// Replace bounds for bauru
code = code.replace(
  /{ id: 'IPMET-BAURU', [^}]+\}, sigmaConfig:/g,
  (match) => {
    return match.replace(/bounds: \{[^}]+\}/, 'bounds: { minLat: -24.5, maxLat: -19.4975, minLon: -54.0, maxLon: -46.5 }');
  }
);

fs.writeFileSync('lib/cptecRadarStations.ts', code);
