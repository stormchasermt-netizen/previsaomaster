const fs = require('fs');
let code = fs.readFileSync('app/ao-vivo-2/AoVivo2Content.tsx', 'utf8');

const oldCode = `  const stationsWithBounds = useMemo(
    () =>
      stations.filter((s) => !s.startsWith('redemet-') && Boolean(findCptecBySlug(s, radarConfigs))).sort(),
    [stations, radarConfigs]
  );`;

const newCode = `  const stationsWithBounds = useMemo(
    () => {
      const baseSlugs = new Set<string>();
      for (const s of stations) {
        const base = bucketSlugToCatalogSlug(s);
        if (Boolean(findCptecBySlug(base, radarConfigs))) {
          baseSlugs.add(base);
        }
      }
      return Array.from(baseSlugs).sort();
    },
    [stations, radarConfigs]
  );`;

if (code.includes(oldCode)) {
  code = code.replace(oldCode, newCode);
  fs.writeFileSync('app/ao-vivo-2/AoVivo2Content.tsx', code);
  console.log("Patched stationsWithBounds.");
} else {
  console.log("Failed to find stationsWithBounds.");
}
