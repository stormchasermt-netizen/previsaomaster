const fs = require('fs');
let code = fs.readFileSync('app/admin/radares/page.tsx', 'utf8');
code = code.replace(
  "import {\n  ARGENTINA_RADAR_STATIONS,",
  "import { IPMET_FIXED_BOUNDS } from '@/lib/cptecRadarStations';\nimport {\n  ARGENTINA_RADAR_STATIONS,"
);
fs.writeFileSync('app/admin/radares/page.tsx', code);
