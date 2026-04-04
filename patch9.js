const fs = require('fs');
const path = require('path');
const p = path.join(__dirname, 'cloud-run/radar-ao-vivo2-feeder/src/index.ts');
let content = fs.readFileSync(p, 'utf8');

const newCode = `          if (slug === 'ipmet-bauru' || slug === 'ipmet-prudente') {
            const ipmetData = await downloadIpmetImagesInWindow(slug, targetTs12, windowMinutes);
            r = ipmetData.map(s => ({ buffer: s.buffer, fileName: s.fileName, url: s.url }));`;

content = content.replace(/if \(slug === 'ipmet-bauru' \|\| slug === 'ipmet-prudente'\) \{[\s\S]*?url: 'ipmet' \}\] : \[\];/g, newCode);

if (!content.includes('downloadIpmetImagesInWindow')) {
  content = content.replace('downloadSimeparImagesInWindow,', 'downloadSimeparImagesInWindow,\ndownloadIpmetImagesInWindow,');
}

fs.writeFileSync(p, content);
