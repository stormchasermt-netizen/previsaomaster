const fs = require('fs');
let code = fs.readFileSync('lib/cptecRadarStations.ts', 'utf8');

const regex = /export const IPMET_FIXED_BOUNDS = \{[\s\S]*?\};/;
const newBounds = `export const IPMET_FIXED_BOUNDS = {
  north: -18.08,
  south: -26.4,
  east: -44.516,
  west: -55.876,
  ne: { lat: -18.08, lng: -44.516 },
  sw: { lat: -26.4, lng: -55.876 }
};`;

code = code.replace(regex, newBounds);

// Also replace in the array
code = code.replace(/bounds:\s*\{\s*minLat:\s*-24\.5,\s*maxLat:\s*-19\.4975,\s*minLon:\s*-54\.0,\s*maxLon:\s*-46\.5\s*\}/g, 'bounds: { minLat: -26.4, maxLat: -18.08, minLon: -55.876, maxLon: -44.516 }');

fs.writeFileSync('lib/cptecRadarStations.ts', code);
console.log("Patched lib/cptecRadarStations.ts");
