const fs = require('fs');
let code = fs.readFileSync('app/ao-vivo-2/AoVivo2Content.tsx', 'utf8');

const regex = /      if \(\!isIpmet\) \{\s*if \(config\.customBounds && config\.customBounds\.north\) \{\s*merged\.bounds = \{\s*maxLat: config\.customBounds\.north,\s*minLat: config\.customBounds\.south,\s*maxLon: config\.customBounds\.east,\s*minLon: config\.customBounds\.west\s*\};\s*\} else if \(config\.bounds && config\.bounds\.ne\) \{\s*merged\.bounds = \{\s*maxLat: config\.bounds\.ne\.lat,\s*minLat: config\.bounds\.sw\.lat,\s*maxLon: config\.bounds\.ne\.lng,\s*minLon: config\.bounds\.sw\.lng\s*\};\s*\}\s*\}/;

const replacement = `      if (config.customBounds && config.customBounds.north) {
        merged.bounds = {
          maxLat: config.customBounds.north,
          minLat: config.customBounds.south,
          maxLon: config.customBounds.east,
          minLon: config.customBounds.west
        };
      } else if (config.bounds && config.bounds.ne) {
        merged.bounds = {
          maxLat: config.bounds.ne.lat,
          minLat: config.bounds.sw.lat,
          maxLon: config.bounds.ne.lng,
          minLon: config.bounds.sw.lng
        };
      }`;

if (code.match(regex)) {
  code = code.replace(regex, replacement);
  fs.writeFileSync('app/ao-vivo-2/AoVivo2Content.tsx', code);
  console.log("Patched perfectly.");
} else {
  console.log("Regex didn't match the second block.");
}
