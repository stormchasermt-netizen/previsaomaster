const fs = require('fs');
let code = fs.readFileSync('app/admin/radares/page.tsx', 'utf8');

code = code.replace(
  /const isIpmet = selectedStation\.type === 'cptec' && \(s as CptecRadarStation\)\.slug === 'ipmet-bauru';/g,
  "const isIpmet = selectedStation.type === 'cptec' && ((s as CptecRadarStation).slug === 'ipmet-bauru' || (s as CptecRadarStation).slug === 'ipmet-prudente');"
);

fs.writeFileSync('app/admin/radares/page.tsx', code);
