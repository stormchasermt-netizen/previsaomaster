import { CPTEC_STATIONS, downloadSigmaImagesInWindow } from './dist/radarFetch.js';

async function test() {
  console.log('Testing sigma-santiago...');
  console.log('Santiago config:', CPTEC_STATIONS['santiago']);

  // current UTC
  const d = new Date();
  const ts12 = d.getUTCFullYear() +
               String(d.getUTCMonth() + 1).padStart(2, '0') +
               String(d.getUTCDate()).padStart(2, '0') +
               String(d.getUTCHours()).padStart(2, '0') +
               String(Math.floor(d.getUTCMinutes() / 12) * 12).padStart(2, '0');

  try {
    const res = await downloadSigmaImagesInWindow('sigma-santiago', ts12, 600, {
      checkExists: async () => false
    });
    console.log('Found:', res.length, 'images');
    if (res.length > 0) {
      console.log(res.map(r => r.url));
    }
  } catch (err) {
    console.error('Error:', err);
  }
}

test();
