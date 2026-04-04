const fs = require('fs');
let code = fs.readFileSync('app/admin/radares/page.tsx', 'utf8');
const lines = code.split('\n');

const start = lines.findIndex(l => l.includes('// 3. Circular Mask (Ipmet Bauru / Prudente)'));
const end = lines.findIndex(l => l.includes("ctx.globalCompositeOperation = 'source-over'; // reset"));

if (start > 0 && end > 0) {
  lines.splice(start, end - start + 3, '        // 3. Circular Mask removed for IPMet');
  code = lines.join('\n');
  code = code.replace('if (chromaKeyDeltaThreshold === 0 && cropTop === 0 && cropBottom === 0 && cropLeft === 0 && cropRight === 0 && !isIpmet) {',
    'if (chromaKeyDeltaThreshold === 0 && cropTop === 0 && cropBottom === 0 && cropLeft === 0 && cropRight === 0) {');
  fs.writeFileSync('app/admin/radares/page.tsx', code);
  console.log('Fixed admin bounds override / mask');
} else {
  console.log('Start/end not found', start, end);
}
