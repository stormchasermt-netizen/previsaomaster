const fs = require('fs');
let text = fs.readFileSync('app/admin/radares/page.tsx', 'utf8');

text = text.replace(
  'const computedBounds = calcBounds(newImgLat, newImgLng, rangeKm);',
  'let computedBounds = calcBounds(newImgLat, newImgLng, rangeKm);\n    if (isIpmet) { computedBounds = { north: IPMET_FIXED_BOUNDS.north, south: IPMET_FIXED_BOUNDS.south, east: IPMET_FIXED_BOUNDS.east, west: IPMET_FIXED_BOUNDS.west }; }'
);

text = text.replace(
  /computedBounds = calcBounds\(latForBounds, lngForBounds, rangeKm\);/g,
  'computedBounds = calcBounds(latForBounds, lngForBounds, rangeKm);\n      if (isIpmet) { computedBounds = { north: IPMET_FIXED_BOUNDS.north, south: IPMET_FIXED_BOUNDS.south, east: IPMET_FIXED_BOUNDS.east, west: IPMET_FIXED_BOUNDS.west }; }'
);

fs.writeFileSync('app/admin/radares/page.tsx', text);
