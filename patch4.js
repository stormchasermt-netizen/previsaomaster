const fs = require('fs');
const path = require('path');
const p = path.join(__dirname, 'cloud-run/radar-ao-vivo2-feeder/src/radarFetch.ts');
let content = fs.readFileSync(p, 'utf8');

const newRedemet = `  while (out.length < maxImages && ts12ToUtcMs(currentTs) >= endMs) {
    const fileName = \`\${currentTs}.png\`;
    let shouldDownload = true;

    if (options?.checkExists && (await options.checkExists(fileName))) {
      // Se já existe no bucket, simulamos uma "descoberta" para não apagar e contar para as 12
      out.push({
        ts12: currentTs,
        layer: 'ppi',
        fileName,
        url: \`gcs://\${slug}/\${fileName}\`, // Placeholder url, file exists
        buffer: Buffer.alloc(0),
      });
      shouldDownload = false;
    }

    if (shouldDownload) {
      let got: any = await checkFirebaseStorageFallback(\`redemet-\${slug}\`, currentTs, 'reflectividade');
      if (!got) {
        got = await tryFetchRedemetImageForTs12(area, currentTs);
      }
      if (got) {
        out.push({
          ts12: currentTs,
          layer: 'ppi',
          fileName,
          url: got.url || 'firebase-fallback',
          buffer: got.buffer,
        });
      }
    }

    // Voltar 5 min no relógio (tenta o próximo)
    currentTs = subtractMinutesFromTimestamp12UTC(currentTs, 5);
  }`;

content = content.replace(/while \(out\.length < maxImages && ts12ToUtcMs\(currentTs\) >= endMs\) \{[\s\S]*?currentTs = subtractMinutesFromTimestamp12UTC\(currentTs, 5\);\n  \}/, newRedemet);
fs.writeFileSync(p, content);
