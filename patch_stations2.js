const fs = require('fs');
let code = fs.readFileSync('app/ao-vivo-2/AoVivo2Content.tsx', 'utf8');

const regex = /const stationsWithBounds = useMemo\(\s*\(\) =>\s*stations\.filter\(\(s\) => !s\.startsWith\('redemet-'\) && Boolean\(findCptecBySlug\(s, radarConfigs\)\)\)\.sort\(\),\s*\[stations, radarConfigs\]\s*\);/;

const newCode = `const stationsWithBounds = useMemo(
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

if (code.match(regex)) {
  code = code.replace(regex, newCode);
  fs.writeFileSync('app/ao-vivo-2/AoVivo2Content.tsx', code);
  console.log("Patched stationsWithBounds via regex.");
} else {
  console.log("Regex failed.");
}
