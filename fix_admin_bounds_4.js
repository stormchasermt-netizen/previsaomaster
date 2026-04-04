const fs = require('fs');
let code = fs.readFileSync('app/admin/radares/page.tsx', 'utf8');

code = code.replace(
  "import { hasSigmaFallback } from '@/lib/cptecRadarStations';",
  "import { hasSigmaFallback, IPMET_FIXED_BOUNDS } from '@/lib/cptecRadarStations';"
);

fs.writeFileSync('app/admin/radares/page.tsx', code);
