const fs = require('fs');
let code = fs.readFileSync('app/ao-vivo-2/AoVivo2Content.tsx', 'utf8');

const regex = /function findCptecBySlug[\s\S]*?function imageCoordinatesFromBounds/m;
const match = code.match(regex);
if (match) {
  const replacement = `function findCptecBySlug(slug: string, radarConfigs?: RadarConfig[]): CptecRadarStation & { iconLat?: number, iconLng?: number, maskRadiusKm?: number } | undefined {
  const base = CPTEC_RADAR_STATIONS.find((s) => s.slug === bucketSlugToCatalogSlug(slug));
  if (!base) return undefined;

  if (radarConfigs) {
    const config = radarConfigs.find(c => c.id === slug) || radarConfigs.find(c => c.stationSlug === base.slug);
    if (config) {
      const merged = { ...base, iconLat: base.lat, iconLng: base.lng, maskRadiusKm: base.rangeKm };
      const isIpmet = base.slug === 'ipmet-bauru' || base.slug === 'ipmet-prudente';
      
      // O ícone do IPMet nunca deve sair do lugar, mesmo que o centro da máscara mude.
      if (!isIpmet) {
        if (config.lat !== undefined && config.lat !== 0) merged.iconLat = config.lat;
        if (config.lng !== undefined && config.lng !== 0) merged.iconLng = config.lng;
      }
      
      // A máscara (ou o cálculo de bounds/corte) usa as configurações ajustadas pelo admin.
      if (config.lat !== undefined && config.lat !== 0) merged.lat = config.lat;
      if (config.lng !== undefined && config.lng !== 0) merged.lng = config.lng;

      if (config.rangeKm !== undefined && config.rangeKm !== 0) merged.rangeKm = config.rangeKm;
      if (config.maskRadiusKm !== undefined && config.maskRadiusKm !== 0) merged.maskRadiusKm = config.maskRadiusKm;
      
      if (!isIpmet) {
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
      }
      return merged;
    }
  }

  return { ...base, iconLat: base.lat, iconLng: base.lng };
}

function imageCoordinatesFromBounds`;

  code = code.replace(regex, replacement);
  fs.writeFileSync('app/ao-vivo-2/AoVivo2Content.tsx', code);
  console.log("Fixed fully!");
}
