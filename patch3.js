const fs = require('fs');
let code = fs.readFileSync('src/radarFetch.ts', 'utf8');

const fetchUspCode = `
export async function downloadUspImagesInWindow(
  slug: string,
  targetTs12: string,
  windowMinutes: number
): Promise<CptecSyncedFile[]> {
  const images: CptecSyncedFile[] = [];
  if (slug !== 'usp-starnet') return images;

  const nowMs = ts12ToUtcMs(targetTs12);
  const startMs = nowMs - windowMinutes * 60 * 1000;

  // Starnet loop X is 1 to 10. 10 is the most recent.
  // We need to fetch each image and read its Last-Modified header to get the real timestamp,
  // since the URL is generic. Or we can just use the current time and subtract ~5 mins per frame, 
  // but let's try to get Last-Modified.
  
  for (let i = 1; i <= 10; i++) {
    const imgUrl = \`https://www.starnet.iag.usp.br/img_starnet/Radar_USP/pelletron_36km/loop/36km_loop_\${i}.png\`;
    try {
      const imgRes = await fetch(imgUrl, {
        signal: AbortSignal.timeout(10000),
      });
      if (imgRes.ok) {
        const lastModified = imgRes.headers.get('last-modified');
        let fileDate = new Date(); // fallback to roughly now if not provided
        if (lastModified) {
          fileDate = new Date(lastModified);
        } else {
          // Fallback: estimate time based on index (i=10 is newest, i=1 is oldest, 5 min intervals)
          fileDate = new Date(nowMs - (10 - i) * 5 * 60 * 1000);
        }
        
        const fileMs = fileDate.getTime();
        // check if it's within the window
        if (fileMs >= startMs && fileMs <= nowMs + 10 * 60 * 1000) {
          const ts12 = \`\${fileDate.getUTCFullYear()}\${String(fileDate.getUTCMonth() + 1).padStart(2, '0')}\${String(fileDate.getUTCDate()).padStart(2, '0')}\${String(fileDate.getUTCHours()).padStart(2, '0')}\${String(fileDate.getUTCMinutes()).padStart(2, '0')}\`;
          const fileName = \`\${slug}_\${ts12}.png\`;
          const buf = Buffer.from(await imgRes.arrayBuffer());
          images.push({ buffer: buf, fileName, url: imgUrl, ts12, layer: 'ppi' });
        }
      }
    } catch (e: any) {
      console.log(\`[USP] Falha ao baixar \${imgUrl}: \${e.message}\`);
    }
  }

  images.sort((a, b) => b.ts12.localeCompare(a.ts12));
  return images;
}
`;

fs.writeFileSync('src/radarFetch.ts', code + '\n' + fetchUspCode);
