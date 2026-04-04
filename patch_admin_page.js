const fs = require('fs');
let code = fs.readFileSync('app/admin/radares/page.tsx', 'utf8');

const regex = /    let computed = calc\(latForBounds, lngForBounds, rangeKm\);\n    const isIpmet = selectedStation\?\.type === 'cptec' && \(\(s as CptecRadarStation\)\.slug === 'ipmet-bauru' \|\| \(s as CptecRadarStation\)\.slug === 'ipmet-prudente'\);\n    if \(isIpmet\) \{ computed = \{ north: IPMET_FIXED_BOUNDS\.north, south: IPMET_FIXED_BOUNDS\.south, east: IPMET_FIXED_BOUNDS\.east, west: IPMET_FIXED_BOUNDS\.west \}; \}\n    return computed;/;

const repl = `    let computed = calc(latForBounds, lngForBounds, rangeKm);
    return computed;`;

if (code.match(regex)) {
  code = code.replace(regex, repl);
  fs.writeFileSync('app/admin/radares/page.tsx', code);
  console.log("Patched page.tsx bounds override correctly.");
} else {
  console.log("Regex didn't match.");
}
