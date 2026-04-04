const fs = require('fs');
const path = require('path');
const p = path.join(__dirname, 'cloud-run/radar-ao-vivo2-feeder/src/radarFetch.ts');
let content = fs.readFileSync(p, 'utf8');

const ipmetFallback = `
export async function checkIpmetStorageFallback(slug: string, ts12: string): Promise<{ buffer: Buffer, fileName: string } | null> {
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
    return { buffer, fileName: \`\${ts12}.png\` };
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

content = content.replace('export async function fetchIpmetImage', ipmetFallback + '\nexport async function fetchIpmetImage');
fs.writeFileSync(p, content);
