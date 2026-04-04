const fs = require('fs');
let code = fs.readFileSync('app/ao-vivo-2/AoVivo2Content.tsx', 'utf8');

const regex = /        if \(slug === 'ipmet-bauru' \|\| slug === 'ipmet-prudente'\) \{\n          const mRadius = boundsStation\.maskRadiusKm \?\? boundsStation\.rangeKm;\n          const masked = await filterRadarImageCircularMask\(nextUrl, boundsStation\.lat, boundsStation\.lng, mRadius, bounds\);\n          if \(gen !== layerUpdateGenerationRef\.current\) return;\n          nextUrl = masked \?\? nextUrl;\n        \}\n/m;
code = code.replace(regex, "");

fs.writeFileSync('app/ao-vivo-2/AoVivo2Content.tsx', code);
console.log("Removed IPMet circular mask logic.");
