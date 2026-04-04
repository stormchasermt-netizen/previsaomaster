const fs = require('fs');
let code = fs.readFileSync('lib/cptecRadarStations.ts', 'utf8');

const oldLine = code.match(/{ id: 'IPMET-PRUDENTE', [^}]+ } },/);
if (oldLine) {
  const newLine = oldLine[0].replace(/lat: -?[\d.]+,\s*lng: -?[\d.]+/, 'lat: -22.175000, lng: -51.372778');
  code = code.replace(oldLine[0], newLine);
  fs.writeFileSync('lib/cptecRadarStations.ts', code);
  console.log('updated');
}
