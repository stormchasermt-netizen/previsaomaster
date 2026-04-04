const fs = require('fs');
const path = require('path');
const p = path.join(__dirname, 'cloud-run/radar-ao-vivo2-feeder/src/radarFetch.ts');
let content = fs.readFileSync(p, 'utf8');

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

export async function checkFirebaseStorageFallback(slug: string, ts12: string, productType: 'reflectividade' | 'velocidade' = 'reflectividade'): Promise<{ buffer: Buffer, fileName: string } | null> {
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
    return { buffer, fileName: \`\${ts12}\${isVel ? '-ppivr' : ''}.png\` };
  } catch (err) {
    console.error('checkFirebaseStorageFallback err:', err);
    return null;
  }
}
`;

content = content.replace('export async function fetchCptecPngFromCdn', fallbackCode + '\nexport async function fetchCptecPngFromCdn');
fs.writeFileSync(p, content);
