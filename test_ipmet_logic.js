const fs = require('fs');

async function test() {
  let trueTs12 = '';
  try {
    const htmlReq = await fetch('https://www.ipmetradar.com.br/alerta/ppigis/index.php');
    if (htmlReq.ok) {
      const html = await htmlReq.text();
      const m = html.match(/var dado_inicial = (\d{14});/);
      if (m && m[1]) {
        trueTs12 = m[1].substring(0, 12);
      }
    }
  } catch (e) {
    console.error('Error fetching IPMet HTML for timestamp:', e);
  }

  console.log("trueTs12:", trueTs12);
  if (!trueTs12) return;

  const IPMET_URL = 'https://getradaripmet-kj7x6j3jsa-uc.a.run.app';
  const url = `${IPMET_URL}?t=${encodeURIComponent(trueTs12)}`;
  console.log("Fetching:", url);
  const imgRes = await fetch(url);
  console.log("Image length:", (await imgRes.arrayBuffer()).byteLength);
}

test();
