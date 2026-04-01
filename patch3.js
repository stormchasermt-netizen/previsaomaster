const fs = require('fs');
let code = fs.readFileSync('c:\\Users\\Usuário\\Downloads\\download (12)\\studio\\app\\ao-vivo\\page.tsx', 'utf8');

code = code.replace(
  "const cptecUrl = buildNowcastingPngUrl(dr.station, exactTs12, productType as any, true);",
  "const slug = (dr.station as CptecRadarStation).slug;\n        const cptecUrl = `/api/radar-ao-vivo2-image?file=${encodeURIComponent(slug + '/' + exactTs12 + (productType === 'velocidade' ? '-ppivr' : '') + '.png')}`;"
);

code = code.replace(
  "const argUrl = buildArgentinaRadarPngUrl(dr.station, argTs, productType);",
  "const argUrl = `/api/radar-ao-vivo2-image?file=${encodeURIComponent('argentina-' + dr.station.id + '/' + exactTs12 + (productType === 'velocidade' ? '-ppivr' : '') + '.png')}`;"
);

code = code.replace(
  "'raster-opacity-transition': { duration: 450, delay: 0 }",
  "'raster-opacity-transition': { duration: 450, delay: 0 },\n                  'raster-resampling': 'nearest'"
);

fs.writeFileSync('c:\\Users\\Usuário\\Downloads\\download (12)\\studio\\app\\ao-vivo\\page.tsx', code);
