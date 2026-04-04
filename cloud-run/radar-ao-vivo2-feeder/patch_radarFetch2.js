const fs = require('fs');
let code = fs.readFileSync('src/radarFetch.ts', 'utf8');

const oldFunc = `export async function fetchIpmetImage(nominalTs12: string): Promise<{ buffer: Buffer; ts12: string } | null> {
  const url = \`\${IPMET_URL}?t=\${encodeURIComponent(nominalTs12)}\`;
  const buf = await fetchPngBuffer(url);
  if (!buf) return null;
  return { buffer: buf, ts12: nominalTs12 };
}`;

const newFunc = `export async function fetchIpmetImage(nominalTs12: string): Promise<{ buffer: Buffer; ts12: string } | null> {
  let trueTs12 = '';
  try {
    const htmlReq = await fetch('https://www.ipmetradar.com.br/alerta/ppigis/index.php');
    if (htmlReq.ok) {
      const html = await htmlReq.text();
      const m = html.match(/var dado_inicial = (\\d{14});/);
      if (m && m[1]) {
        trueTs12 = m[1].substring(0, 12);
      }
    }
  } catch (e) {
    console.error('Error fetching IPMet HTML for timestamp:', e);
  }

  if (!trueTs12) {
    console.log('[fetchIpmetImage] Could not extract true ts12, falling back to nominalTs12');
    trueTs12 = nominalTs12;
  }

  const url = \`\${IPMET_URL}?t=\${encodeURIComponent(trueTs12)}\`;
  const buf = await fetchPngBuffer(url);
  if (!buf) return null;
  return { buffer: buf, ts12: trueTs12 };
}`;

if (code.includes(oldFunc)) {
  code = code.replace(oldFunc, newFunc);
  fs.writeFileSync('src/radarFetch.ts', code);
  console.log("Patched!");
} else {
  console.log("Could not find the function to patch.");
}
