const fs = require('fs');
let code = fs.readFileSync('app/ao-vivo-2/AoVivo2Content.tsx', 'utf8');

const regex = /      \/\/ O ícone do IPMet nunca deve sair do lugar[\s\S]*?      return merged;\n    \}\n  \}/;

const replacement = `      // O ícone do IPMet nunca deve sair do lugar e os bounds/posição também não devem ser alterados.
      if (!isIpmet) {
        if (config.lat !== undefined && config.lat !== 0) merged.iconLat = config.lat;
        if (config.lng !== undefined && config.lng !== 0) merged.iconLng = config.lng;
        
        if (config.lat !== undefined && config.lat !== 0) merged.lat = config.lat;
        if (config.lng !== undefined && config.lng !== 0) merged.lng = config.lng;

        if (config.rangeKm !== undefined && config.rangeKm !== 0) merged.rangeKm = config.rangeKm;
        if (config.maskRadiusKm !== undefined && config.maskRadiusKm !== 0) merged.maskRadiusKm = config.maskRadiusKm;
        
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
      } else {
        // Garantir explicitamente que IPMet não usa customBounds e nem posição alterada
        // e que o bounds original de lib/cptecRadarStations prevalece.
        merged.lat = base.lat;
        merged.lng = base.lng;
        merged.iconLat = base.lat;
        merged.iconLng = base.lng;
      }
      return merged;
    }
  }`;

code = code.replace(regex, replacement);
fs.writeFileSync('app/ao-vivo-2/AoVivo2Content.tsx', code);
console.log("Patched AoVivo2Content.tsx");
