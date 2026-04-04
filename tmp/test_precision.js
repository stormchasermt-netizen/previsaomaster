const proj4 = require('proj4');

const WGS84 = 'EPSG:4326';
const CENTRO_SUL_LCC = '+proj=lcc +lat_1=-27.0 +lat_2=-27.0 +lat_0=-27.0 +lon_0=-52.0 +a=6370000 +b=6370000 +units=m +no_defs';

// DADOS REAIS DA VM
const WEST_BOUND = -61.14971752357618;
const EAST_BOUND = -43.35028247642382;
const SOUTH_BOUND = -35.49505475584838;
const NORTH_BOUND = -17.95054755848838;

const plotLeft = 0.17641;
const plotRight = 0.745;
const plotBottom = 0.11;
const plotTop = 0.88;

function testMapping(px, py) {
    const plotWidthFrac = plotRight - plotLeft;
    const plotHeightFrac = plotTop - plotBottom;

    const plotX = (px - plotLeft) / plotWidthFrac;
    const plotY = (1.0 - py - plotBottom) / plotHeightFrac;

    console.log(`Input px: ${px}, py: ${py}`);
    console.log(`PlotX: ${plotX}, PlotY: ${plotY}`);

    const cornerSW = proj4(WGS84, CENTRO_SUL_LCC, [WEST_BOUND, SOUTH_BOUND]);
    const cornerNE = proj4(WGS84, CENTRO_SUL_LCC, [EAST_BOUND, NORTH_BOUND]);

    const xmin = cornerSW[0];
    const xmax = cornerNE[0];
    const ymin = cornerSW[1];
    const ymax = cornerNE[1];

    const lccX = xmin + plotX * (xmax - xmin);
    const lccY = ymin + plotY * (ymax - ymin);

    const [lon, lat] = proj4(CENTRO_SUL_LCC, WGS84, [lccX, lccY]);
    console.log(`Result -> Lat: ${lat.toFixed(4)}, Lon: ${lon.toFixed(4)}`);
    console.log(`Expected -> Lat: ${SOUTH_BOUND.toFixed(4)}, Lon: ${WEST_BOUND.toFixed(4)} (if SW corner)`);
}

console.log("--- Testando Canto Inferior Esquerdo (SW) ---");
testMapping(plotLeft, 1.0 - plotBottom);

console.log("\n--- Testando Canto Superior Direito (NE) ---");
testMapping(plotRight, 1.0 - plotTop);
