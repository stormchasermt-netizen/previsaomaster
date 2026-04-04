const fs = require('fs');
let code = fs.readFileSync('app/admin/radares/page.tsx', 'utf8');

const regex1 = /    const isIpmet = selectedStation\.type === 'cptec' && \(\(s as CptecRadarStation\)\.slug === 'ipmet-bauru' \|\| \(s as CptecRadarStation\)\.slug === 'ipmet-prudente'\);\n    \n    const calcBounds = isIpmet && typeof calculateRadarBoundsGeodesic === 'function' \? calculateRadarBoundsGeodesic : calculateRadarBounds;\n    let computedBounds = calcBounds\(newImgLat, newImgLng, rangeKm\);\n    if \(isIpmet\) \{ computedBounds = \{ north: IPMET_FIXED_BOUNDS\.north, south: IPMET_FIXED_BOUNDS\.south, east: IPMET_FIXED_BOUNDS\.east, west: IPMET_FIXED_BOUNDS\.west \}; \}/g;

const repl1 = `    const calcBounds = typeof calculateRadarBoundsGeodesic === 'function' ? calculateRadarBoundsGeodesic : calculateRadarBounds;
    let computedBounds = calcBounds(newImgLat, newImgLng, rangeKm);`;

code = code.replace(regex1, repl1);

const regex2 = /    const isIpmet = selectedStation\.type === 'cptec' && \(\(s as CptecRadarStation\)\.slug === 'ipmet-bauru' \|\| \(s as CptecRadarStation\)\.slug === 'ipmet-prudente'\);\n    \n    const latForBounds = \(newImgLat !== 0\) \? newImgLat : lat;\n    const lngForBounds = \(newImgLng !== 0\) \? newImgLng : lng;\n\n    let computedBounds;\n    const calcBounds = isIpmet && typeof calculateRadarBoundsGeodesic === 'function' \? calculateRadarBoundsGeodesic : calculateRadarBounds;\n    if \(isIpmet\) \{\n      computedBounds = \{ north: IPMET_FIXED_BOUNDS\.north, south: IPMET_FIXED_BOUNDS\.south, east: IPMET_FIXED_BOUNDS\.east, west: IPMET_FIXED_BOUNDS\.west \};\n    \} else \{\n      computedBounds = calcBounds\(latForBounds, lngForBounds, rangeKm\);\n    \}/g;

const repl2 = `    const latForBounds = (newImgLat !== 0) ? newImgLat : lat;
    const lngForBounds = (newImgLng !== 0) ? newImgLng : lng;

    const calcBounds = typeof calculateRadarBoundsGeodesic === 'function' ? calculateRadarBoundsGeodesic : calculateRadarBounds;
    let computedBounds = calcBounds(latForBounds, lngForBounds, rangeKm);`;

code = code.replace(regex2, repl2);

const regex3 = /    const isIpmet = selectedStation\.type === 'cptec' && \(\(s as CptecRadarStation\)\.slug === 'ipmet-bauru' \|\| \(s as CptecRadarStation\)\.slug === 'ipmet-prudente'\);\n    const calcBounds = isIpmet && typeof calculateRadarBoundsGeodesic === 'function' \? calculateRadarBoundsGeodesic : calculateRadarBounds;\n    let computedBounds;\n    if \(isIpmet\) \{\n      computedBounds = \{ north: IPMET_FIXED_BOUNDS\.north, south: IPMET_FIXED_BOUNDS\.south, east: IPMET_FIXED_BOUNDS\.east, west: IPMET_FIXED_BOUNDS\.west \};\n    \} else \{\n      const latForBounds = \(imageCenterLat !== 0\) \? imageCenterLat : centerLat;\n      const lngForBounds = \(imageCenterLng !== 0\) \? imageCenterLng : centerLng;\n      computedBounds = calcBounds\(latForBounds, lngForBounds, rangeKm\);\n    \}/g;

const repl3 = `    const calcBounds = typeof calculateRadarBoundsGeodesic === 'function' ? calculateRadarBoundsGeodesic : calculateRadarBounds;
    const latForBounds = (imageCenterLat !== 0) ? imageCenterLat : centerLat;
    const lngForBounds = (imageCenterLng !== 0) ? imageCenterLng : centerLng;
    let computedBounds = calcBounds(latForBounds, lngForBounds, rangeKm);`;

code = code.replace(regex3, repl3);

fs.writeFileSync('app/admin/radares/page.tsx', code);
console.log("Patched page.tsx handleSave callbacks!");
