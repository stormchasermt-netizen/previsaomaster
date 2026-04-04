const proj4 = require('proj4');

const WGS84 = 'EPSG:4326';
const PARANA_LCC = '+proj=lcc +lat_1=-24.452 +lat_2=-24.452 +lat_0=-24.452 +lon_0=-51.647 +a=6370000 +b=6370000 +units=m +no_defs';

// DADOS DO plot_wrf_parana.py
const WEST_BOUND = -56.0;
const EAST_BOUND = -47.0;
const SOUTH_BOUND = -27.0;
const NORTH_BOUND = -22.0;

const plotLeft = 0.17641;
const plotRight = 0.745;
const plotBottom = 0.11;
const plotTop = 0.88;

function testMapping(px, py) {
    const plotWidthFrac = plotRight - plotLeft;
    const plotHeightFrac = plotTop - plotBottom;

    const plotX = (px - plotLeft) / plotWidthFrac;
    const plotY = (1.0 - py - plotBottom) / plotHeightFrac;

    const cornerSW = proj4(WGS84, PARANA_LCC, [WEST_BOUND, SOUTH_BOUND]);
    const cornerNE = proj4(WGS84, PARANA_LCC, [EAST_BOUND, NORTH_BOUND]);

    const xmin = cornerSW[0];
    const xmax = cornerNE[0];
    const ymin = cornerSW[1];
    const ymax = cornerNE[1];

    const lccX = xmin + plotX * (xmax - xmin);
    const lccY = ymin + plotY * (ymax - ymin);

    const [lon, lat] = proj4(PARANA_LCC, WGS84, [lccX, lccY]);
    console.log(`Result -> Lat: ${lat.toFixed(4)}, Lon: ${lon.toFixed(4)}`);
    console.log(`Expected -> Lat: ${SOUTH_BOUND.toFixed(4)}, Lon: ${WEST_BOUND.toFixed(4)}`);
}

console.log("--- Testando Paraná (SW) ---");
testMapping(plotLeft, 1.0 - plotBottom);
