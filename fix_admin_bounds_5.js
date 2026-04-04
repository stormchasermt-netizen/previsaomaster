const fs = require('fs');
let code = fs.readFileSync('app/admin/radares/page.tsx', 'utf8');

const match = code.match(/const bounds = React\.useMemo\(\(\) => \{[\s\S]*?\}, \[.*?\]\);/);
if (match) {
  let inner = match[0];
  inner = inner.replace(
    'return calc(latForBounds, lngForBounds, rangeKm);',
    "let computed = calc(latForBounds, lngForBounds, rangeKm);\n    const isIpmet = selectedStation?.type === 'cptec' && ((s as CptecRadarStation).slug === 'ipmet-bauru' || (s as CptecRadarStation).slug === 'ipmet-prudente');\n    if (isIpmet) { computed = { north: IPMET_FIXED_BOUNDS.north, south: IPMET_FIXED_BOUNDS.south, east: IPMET_FIXED_BOUNDS.east, west: IPMET_FIXED_BOUNDS.west }; }\n    return computed;"
  );
  code = code.replace(match[0], inner);
  fs.writeFileSync('app/admin/radares/page.tsx', code);
  console.log('done bounds');
} else {
  console.log('not found');
}
