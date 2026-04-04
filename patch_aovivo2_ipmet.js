const fs = require('fs');
let code = fs.readFileSync('app/ao-vivo-2/AoVivo2Content.tsx', 'utf8');

const regex = /if \(config\.customBounds && config\.customBounds\.north\) \{[\s\S]*?minLon: config\.bounds\.sw\.lng\s*\}\s*;/;
const match = code.match(regex);
if (match) {
  const newLogic = `if (!isIpmet) {\n      ${match[0].split('\\n').join('\\n      ')}\n      }`;
  code = code.replace(regex, `if (!isIpmet) {
        if (config.customBounds && config.customBounds.north) {
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
        }
      }`);
  fs.writeFileSync('app/ao-vivo-2/AoVivo2Content.tsx', code);
  console.log("Patched!");
} else {
  console.log("No match");
}
