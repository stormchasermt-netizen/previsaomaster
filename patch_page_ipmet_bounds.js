const fs = require('fs');
let code = fs.readFileSync('app/admin/radares/page.tsx', 'utf8');

const lines = code.split('\n');
const newLines = lines.filter(line => !line.includes('if (isIpmet) { computedBounds = { north: IPMET_FIXED_BOUNDS.north, south: IPMET_FIXED_BOUNDS.south, east: IPMET_FIXED_BOUNDS.east, west: IPMET_FIXED_BOUNDS.west }; }'));

fs.writeFileSync('app/admin/radares/page.tsx', newLines.join('\n'));
console.log("Patched line by line");
