const fs = require('fs');
const path = require('path');
const p = path.join(__dirname, 'app/ao-vivo-2/AoVivo2Content.tsx');
let content = fs.readFileSync(p, 'utf8');

const oldCode = `    const fetchStationProduct = (slug: string, prod: 'ppi' | 'doppler') =>
      fetch(
        \`/api/radar-ao-vivo2?action=listImages&station=\${encodeURIComponent(slug)}&product=\${prod}\${isHistoricalMode ? '&mode=historico' : ''}\`
      )`;

const newCode = `    const fetchStationProduct = (slug: string, prod: 'ppi' | 'doppler') =>
      fetch(
        \`/api/radar-ao-vivo2?action=listImages&station=\${encodeURIComponent(slug)}&product=\${prod}\${isHistoricalMode ? \`&mode=historico\${histStartDate ? '&date=' + histStartDate.replace(/\\D/g, '').substring(0, 8) : ''}\` : ''}\`
      )`;

content = content.replace(oldCode, newCode);
fs.writeFileSync(p, content);
