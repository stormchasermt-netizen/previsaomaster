const fs = require('fs');
const path = require('path');
const p = path.join(__dirname, 'cloud-run/radar-ao-vivo2-feeder/src/index.ts');
let content = fs.readFileSync(p, 'utf8');

// 1. Replace executeHistorico signature and clear logic
const histRegex = /async function executeHistorico\(targetTs12: string, windowMinutes: number\): Promise<\{ ok: boolean, results: any\[\] \}> \{[\s\S]*?await bucket\.deleteFiles\(\{ prefix: `historico\/\$\{slug\}\/` \}\);[\s\S]*?\}\)\);/;
const histNew = `async function executeHistorico(targetTs12: string, windowMinutes: number): Promise<{ ok: boolean, results: any[] }> {
  const bucket = storage.bucket(GCS_BUCKET);
  const results: any[] = [];
  const dateStr = targetTs12.substring(0, 8);
  
  const activeSlugs = SYNC_SLUGS.filter(slug => !SLUGS_WITHOUT_CDN_SYNC.has(slug));

  // Clear existing history for all active slugs in parallel to speed up
  await Promise.all(activeSlugs.map(async (slug) => {
    try {
      await bucket.deleteFiles({ prefix: \`historico/\${slug}/\${dateStr}/\` });
    } catch (e) {
      console.error(\`Failed to clear history for \${slug}\`, e);
    }
  }));`;
content = content.replace(histRegex, histNew);

// 2. Replace the save logic inside executeHistorico
const saveRegex = /const objectPath = `historico\/\$\{slug\}\/\$\{item\.fileName\}`;/;
const saveNew = `const objectPath = \`historico/\${slug}/\${dateStr}/\${item.fileName}\`;`;
content = content.replace(saveRegex, saveNew);

// 3. Add import for downloadIpmetImagesInWindow
content = content.replace('downloadSimeparImagesInWindow,', 'downloadSimeparImagesInWindow,\n  downloadIpmetImagesInWindow,');

// 4. Update executeHistorico ipmet fetching logic
const ipmetRegex = /if \(slug === 'ipmet-bauru' \|\| slug === 'ipmet-prudente'\) \{\s*const fetchIpmet = await fetchIpmetImage\(targetTs12\);\s*r = fetchIpmet \? \[\{ buffer: fetchIpmet\.buffer, fileName: `\$\{fetchIpmet\.ts12\}\.png`, url: 'ipmet' \}\] : \[\];\s*\}/;
const ipmetNew = `if (slug === 'ipmet-bauru' || slug === 'ipmet-prudente') {
          const ipmetData = await downloadIpmetImagesInWindow(slug, targetTs12, windowMinutes);
          r = ipmetData.map(s => ({ buffer: s.buffer, fileName: s.fileName, url: s.url }));
        }`;
content = content.replace(ipmetRegex, ipmetNew);

fs.writeFileSync(p, content);
