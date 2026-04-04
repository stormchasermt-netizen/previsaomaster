const fs = require('fs');

let code = fs.readFileSync('cloud-run/radar-ao-vivo2-feeder/src/radarFetch.ts', 'utf8');

const regex = /export async function fetchIpmetImage\(nominalTs12: string\): Promise<\{ buffer: Buffer; ts12: string \} \| null> \{\s*const url = \`\$\{IPMET_URL\}\?t=\$\{encodeURIComponent\(nominalTs12\)\}\`;\s*const buf = await fetchPngBuffer\(url\);\s*if \(!buf\) return null;\s*return \{ buffer: buf, ts12: nominalTs12 \};\s*\}/;

const newCode = `export async function fetchIpmetImage(nominalTs12: string): Promise<{ buffer: Buffer; ts12: string } | null> {
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

if (code.match(regex)) {
  code = code.replace(regex, newCode);
  fs.writeFileSync('cloud-run/radar-ao-vivo2-feeder/src/radarFetch.ts', code);
  console.log("Patched correctly.");
} else {
  console.log("Regex did not match!");
}
