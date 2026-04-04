const fs = require('fs');
let code = fs.readFileSync('cloud-run/radar-ao-vivo2-feeder/src/index.ts', 'utf8');

const replacement = `    if (slug === 'ipmet-bauru') {
      const checkExists = async (fileName) => {
        const [exists] = await bucket.file(\`\${slug}/\${fileName}\`).exists();
        return exists;
      };

      console.log('[SYNC] ipmet-bauru: Usando fetchIpmetImage...');
      // We will only do fallback directly because user asked to use the cloud function
      const r = await fetchIpmetImage(nominalTs12);
      if (r) {
        const fileName = \`\${r.ts12}.png\`;
        const exists = await checkExists(fileName);
        if (!exists) {
          const r2 = await saveIfNotExists(bucket, slug, fileName, r.buffer, 'ipmet_proxy');
          results.push({ slug, source: 'fallback', ...r2 });
          r2.status === 'failed' ? failCount++ : okCount++;
        } else {
          results.push({ slug, source: 'fallback', status: 'skipped', reason: 'Already exists' });
        }
      } else {
        results.push({ slug, source: 'fallback', status: 'failed', reason: 'Buffer fetch failed' });
        failCount++;
      }
      await delay(400);
      continue;
    }`;

code = code.replace(/if \(slug === 'ipmet-bauru'\) \{[\s\S]*?continue;\s*\}/, replacement);
fs.writeFileSync('cloud-run/radar-ao-vivo2-feeder/src/index.ts', code);
