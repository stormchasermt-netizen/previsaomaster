import fs from 'fs';
import { pipeline } from 'stream/promises';

async function download() {
  const vars = ['mdbz', 'T2m', 'Td_2m', 'Thetae_2m', 'hrt01km', 'hrt03km', 'mucape', 'mlcape', 'sblcl', 'mllr', 'scp', 'stp'];
  
  for (const v of vars) {
    const url = `https://storage.googleapis.com/wrf-3km-imagens-diarias/20251107_parana_000000/${v}/20251107_000000.jpg`;
    console.log('Downloading', url);
    const res = await fetch(url);
    if (!res.ok) continue;
    const dest = fs.createWriteStream(`temp_${v}.jpg`);
    await pipeline(res.body as any, dest);
  }
}

download();