const fs = require('fs');
const path = require('path');
const p = path.join(__dirname, 'cloud-run/radar-ao-vivo2-feeder/src/radarFetch.ts');
let content = fs.readFileSync(p, 'utf8');

const newCode = `  for (const ts12 of candidates) {
    const ppiFileName = \`\${ts12}.png\`;
    if (options?.checkExists && await options.checkExists(ppiFileName)) {
      // Já existe, não precisamos sacar o PPI
    } else {
      let ppi: any = await checkFirebaseStorageFallback(slug, ts12, 'reflectividade');
      if (!ppi) {
        ppi = await fetchCptecPngFromCdn(station, ts12, 'ppi');
      }
      if (ppi) {
        out.push({
          ts12,
          layer: 'ppi',
          fileName: ppiFileName,
          url: ppi.url || 'firebase-fallback',
          buffer: ppi.buffer,
        });
      }
    }

    if (fetchDoppler) {
      const vrFileName = \`\${ts12}-ppivr.png\`;
      if (options?.checkExists && await options.checkExists(vrFileName)) {
        // Já existe
      } else {
        let vr: any = await checkFirebaseStorageFallback(slug, ts12, 'velocidade');
        if (!vr) {
          vr = await fetchCptecPngFromCdn(station, ts12, 'doppler');
        }
        if (vr) {
          out.push({
            ts12,
            layer: 'doppler',
            fileName: vrFileName,
            url: vr.url || 'firebase-fallback',
            buffer: vr.buffer,
          });
        }
      }
    }
  }`;

content = content.replace(/for \(const ts12 of candidates\) \{[\s\S]*?if \(fetchDoppler\) \{[\s\S]*?\}[\s\S]*?\}/, newCode);
fs.writeFileSync(p, content);
