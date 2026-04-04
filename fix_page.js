const fs = require('fs');
let code = fs.readFileSync('app/admin/radares/page.tsx', 'utf8');

code = code.replace(/let computed = calc\(latForBounds, lngForBounds, rangeKm\);\n    const isIpmet = selectedStation\?\.type === 'cptec' && \(\(s as CptecRadarStation\)\.slug === 'ipmet-bauru' \|\| \(s as CptecRadarStation\)\.slug === 'ipmet-prudente'\);\n    if \(isIpmet\)/,
`let computed = calc(latForBounds, lngForBounds, rangeKm);
    if (isIpmet)`);

fs.writeFileSync('app/admin/radares/page.tsx', code);
console.log("Fixed page.tsx");
