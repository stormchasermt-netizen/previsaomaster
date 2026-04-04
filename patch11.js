const fs = require('fs');
const path = require('path');
const p = path.join(__dirname, 'cloud-run/radar-ao-vivo2-feeder/src/radarFetch.ts');
let content = fs.readFileSync(p, 'utf8');

// Add imports
content = content.replace("import sharp from 'sharp';", "import sharp from 'sharp';\nimport { Storage } from '@google-cloud/storage';");

// Add Firebase Storage fallback functions
const fallbackCode = `
const STORAGE_BUCKET = 'studio-4398873450-7cc8f.firebasestorage.app';
const RADAR_BACKUP_PREFIX = 'radar_backup';

let fallbackBucket: any;
function getFallbackBucket() {
  if (!fallbackBucket) {
    fallbackBucket = new Storage().bucket(STORAGE_BUCKET);
  }
  return fallbackBucket;
}

export async function checkFirebaseStorageFallback(slug: string, ts12: string, productType: 'reflectividade' | 'velocidade' = 'reflectividade'): Promise<{ buffer: Buffer, fileName: string, url: string } | null> {
  const y = ts12.slice(0, 4);
  const m = ts12.slice(4, 6);
  const d = ts12.slice(6, 8);
  const hh = ts12.slice(8, 10);
  const mm = ts12.slice(10, 12);
  const targetMin = parseInt(mm, 10);

  const isVel = productType === 'velocidade';
  const suffix = isVel ? '_vel.png' : '.png';
  const bucket = getFallbackBucket();

  try {
    const hourPrefix = \`\${RADAR_BACKUP_PREFIX}/\${slug}/\${y}/\${m}/\${d}\${hh}\`;
    let [files] = await bucket.getFiles({ prefix: hourPrefix, maxResults: 50 });
    let pngFiles = files.filter((f: any) => f.name.endsWith(suffix));

    if (pngFiles.length === 0) {
      const prevHour = String(Math.max(0, parseInt(hh, 10) - 1)).padStart(2, '0');
      const prevHourPrefix = \`\${RADAR_BACKUP_PREFIX}/\${slug}/\${y}/\${m}/\${d}\${prevHour}\`;
      [files] = await bucket.getFiles({ prefix: prevHourPrefix, maxResults: 50 });
      pngFiles = files.filter((f: any) => f.name.endsWith(suffix));
    }

    if (pngFiles.length === 0) {
      const dayPrefix = \`\${RADAR_BACKUP_PREFIX}/\${slug}/\${y}/\${m}/\${d}\`;
      [files] = await bucket.getFiles({ prefix: dayPrefix, maxResults: 100 });
      pngFiles = files.filter((f: any) => f.name.endsWith(suffix));
    }

    if (pngFiles.length === 0) return null;

    let bestFile: any = null;
    let minDiff = Infinity;

    for (const file of pngFiles) {
      const basename = file.name.split('/').pop()?.replace('.png', '') ?? '';
      if (basename.length < 6) continue;

      const fileDay = parseInt(basename.slice(0, 2), 10);
      const fileHour = parseInt(basename.slice(2, 4), 10);
      const fileMin = parseInt(basename.slice(4, 6), 10);

      const targetTotalMin = parseInt(d, 10) * 1440 + parseInt(hh, 10) * 60 + targetMin;
      const fileTotalMin = fileDay * 1440 + fileHour * 60 + fileMin;
      const diff = Math.abs(fileTotalMin - targetTotalMin);

      if (diff < minDiff) {
        minDiff = diff;
        bestFile = file;
      }
    }

    if (!bestFile || minDiff > 10) return null; // 10 minutes tolerance

    const [buffer] = await bestFile.download();
    return { buffer, fileName: \`\${ts12}\${isVel ? '-ppivr' : ''}.png\`, url: 'firebase-fallback' };
  } catch (err) {
    console.error('checkFirebaseStorageFallback err:', err);
    return null;
  }
}

export async function checkIpmetStorageFallback(slug: string, ts12: string): Promise<{ buffer: Buffer, fileName: string, url: string } | null> {
  const y = ts12.slice(0, 4);
  const m = ts12.slice(4, 6);
  const d = ts12.slice(6, 8);
  const hh = ts12.slice(8, 10);
  const mm = ts12.slice(10, 12);
  const targetMin = parseInt(mm, 10);

  const bucket = getFallbackBucket();
  const prefixLegacyToday = \`ipmet-bauru/\${y}/\${m}/\${d}\${hh}\`;
  const prefixDayToday = \`ipmet-bauru/\${y}/\${m}/\${d}/\${hh}\`;

  try {
    let [files] = await bucket.getFiles({ prefix: prefixLegacyToday, maxResults: 50 });
    let pngFiles = files.filter((f: any) => f.name.endsWith('.png'));

    if (pngFiles.length === 0) {
      [files] = await bucket.getFiles({ prefix: prefixDayToday, maxResults: 50 });
      pngFiles = files.filter((f: any) => f.name.endsWith('.png'));
    }
    
    if (pngFiles.length === 0) return null;

    let bestFile: any = null;
    let minDiff = Infinity;

    for (const file of pngFiles) {
      const parts = file.name.split('/');
      const basename = parts[parts.length - 1].replace('.png', '');
      
      let fileH, fileMin;
      if (parts.length >= 5 && parts[parts.length - 2].length === 2 && !isNaN(Number(parts[parts.length - 2]))) {
        if (basename.length >= 4) {
          fileH = parseInt(basename.slice(0, 2), 10);
          fileMin = parseInt(basename.slice(2, 4), 10);
        }
      } else if (parts.length >= 4) {
        if (basename.length >= 6) {
          fileH = parseInt(basename.slice(2, 4), 10);
          fileMin = parseInt(basename.slice(4, 6), 10);
        }
      }

      if (fileH === undefined || fileMin === undefined) continue;

      const targetTotalMin = parseInt(hh, 10) * 60 + targetMin;
      const fileTotalMin = fileH * 60 + fileMin;
      const diff = Math.abs(fileTotalMin - targetTotalMin);

      if (diff < minDiff) {
        minDiff = diff;
        bestFile = file;
      }
    }

    if (!bestFile || minDiff > 10) return null;

    const [buffer] = await bestFile.download();
    return { buffer, fileName: \`\${ts12}.png\`, url: 'firebase-fallback' };
  } catch (err) {
    console.error('checkIpmetStorageFallback err:', err);
    return null;
  }
}

export async function downloadIpmetImagesInWindow(
  slug: string,
  nowTs12: string,
  windowMinutes: number,
  options?: { checkExists?: (fileName: string) => Promise<boolean> }
): Promise<CptecSyncedFile[]> {
  const out: CptecSyncedFile[] = [];
  const maxImages = 12;
  
  let currentTs = nowTs12;
  const endMs = ts12ToUtcMs(nowTs12) - windowMinutes * 60 * 1000;

  while (out.length < maxImages && ts12ToUtcMs(currentTs) >= endMs) {
    const fileName = \`\${currentTs}.png\`;
    let shouldDownload = true;

    if (options?.checkExists && (await options.checkExists(fileName))) {
      out.push({
        ts12: currentTs,
        layer: 'ppi',
        fileName,
        url: \`gcs://\${slug}/\${fileName}\`,
        buffer: Buffer.alloc(0),
      });
      shouldDownload = false;
    }

    if (shouldDownload) {
      let ipmet: any = await checkIpmetStorageFallback(slug, currentTs);
      if (!ipmet) {
         // if it's very recent, try live fetch
         const diff = Math.abs(ts12ToUtcMs(nowTs12) - ts12ToUtcMs(currentTs)) / 60000;
         if (diff < 20) {
           ipmet = await fetchIpmetImage(currentTs);
         }
      }
      if (ipmet) {
        out.push({
          ts12: currentTs,
          layer: 'ppi',
          fileName,
          url: ipmet.url || 'firebase-fallback',
          buffer: ipmet.buffer,
        });
      }
    }

    currentTs = subtractMinutesFromTimestamp12UTC(currentTs, 15);
  }
  return out;
}
`;

content = content.replace('export async function fetchCptecPngFromCdn', fallbackCode + '\nexport async function fetchCptecPngFromCdn');

// Update CPTEC
const oldCptecLoop = `  for (const ts12 of candidates) {
    const ppiFileName = \`\${ts12}.png\`;
    if (options?.checkExists && await options.checkExists(ppiFileName)) {
      // Já existe, não precisamos sacar o PPI
    } else {
      const ppi = await fetchCptecPngFromCdn(station, ts12, 'ppi');
      if (ppi) {
        out.push({
          ts12,
          layer: 'ppi',
          fileName: ppiFileName,
          url: ppi.url,
          buffer: ppi.buffer,
        });
      }
    }

    if (fetchDoppler && station.dopplerId) {
      const dopFileName = \`\${ts12}-ppivr.png\`;
      if (options?.checkExists && await options.checkExists(dopFileName)) {
        // Já existe
      } else {
        const dop = await fetchCptecPngFromCdn(station, ts12, 'doppler');
        if (dop) {
          out.push({
            ts12,
            layer: 'doppler',
            fileName: dopFileName,
            url: dop.url,
            buffer: dop.buffer,
          });
        }
      }
    }
  }`;

const newCptecLoop = `  for (const ts12 of candidates) {
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

    if (fetchDoppler && station.dopplerId) {
      const dopFileName = \`\${ts12}-ppivr.png\`;
      if (options?.checkExists && await options.checkExists(dopFileName)) {
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
            fileName: dopFileName,
            url: vr.url || 'firebase-fallback',
            buffer: vr.buffer,
          });
        }
      }
    }
  }`;
content = content.replace(oldCptecLoop, newCptecLoop);

// Update Redemet
const oldRedemetLoop = `  while (out.length < maxImages && ts12ToUtcMs(currentTs) >= endMs) {
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
      const got = await tryFetchRedemetImageForTs12(area, currentTs);
      if (got) {
        out.push({
          ts12: currentTs,
          layer: 'ppi',
          fileName,
          url: got.url,
          buffer: got.buffer,
        });
      }
    }

    // Voltar 5 min no relógio (tenta o próximo)
    currentTs = subtractMinutesFromTimestamp12UTC(currentTs, 5);
  }`;

const newRedemetLoop = `  while (out.length < maxImages && ts12ToUtcMs(currentTs) >= endMs) {
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

content = content.replace(oldRedemetLoop, newRedemetLoop);
fs.writeFileSync(p, content);
