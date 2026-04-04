const fs = require('fs');
let code = fs.readFileSync('lib/cptecRadarStations.ts', 'utf8');

code = code.replace(
  /export const IPMET_FIXED_BOUNDS = \{[\s\S]*?sw: \{[^\}]+\}\s*\};/,
  'export const IPMET_FIXED_BOUNDS = {\n  north: -19.4975,\n  south: -24.5,\n  east: -46.5,\n  west: -54.0,\n  ne: { lat: -19.4975, lng: -46.5 },\n  sw: { lat: -24.5, lng: -54.0 }\n};'
);

code = code.replace(
  /{ id: 'IPMET-PRUDENTE'[\s\S]*?bounds: {[^}]+}/,
  "{ id: 'IPMET-PRUDENTE', slug: 'ipmet-prudente', name: 'IPMet (Pres. Prudente)', lat: -22.175000, lng: -51.372778, rangeKm: 450, org: 'ipmet', server: 's1', product: 'ppi', subtype: 'ppicz', updateIntervalMinutes: 15, updateIntervalOffsetMinutes: 0, bounds: { minLat: -24.5, maxLat: -19.4975, minLon: -54.0, maxLon: -46.5 }"
);

code = code.replace(
  /{ id: 'IPMET-BAURU'[\s\S]*?bounds: {[^}]+}/,
  "{ id: 'IPMET-BAURU', slug: 'ipmet-bauru', name: 'IPMet (Bauru)', lat: -22.357778, lng: -49.026667, rangeKm: 450, org: 'ipmet', server: 's1', product: 'ppi', subtype: 'ppicz', updateIntervalMinutes: 15, updateIntervalOffsetMinutes: 0, bounds: { minLat: -24.5, maxLat: -19.4975, minLon: -54.0, maxLon: -46.5 }"
);

fs.writeFileSync('lib/cptecRadarStations.ts', code);
