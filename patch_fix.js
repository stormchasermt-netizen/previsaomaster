const fs = require('fs');

let code = fs.readFileSync('c:\\Users\\Usuário\\Downloads\\download (12)\\studio\\app\\ao-vivo\\page.tsx', 'utf8');

code = code.replace(/\\`\/api\/radar-ao-vivo2-image\?file=\\\$\\{encodeURIComponent\('argentina-' \+ dr\.station\.id \+ '\/' \+ exactTs12 \+ \(productType === 'velocidade' \? '-ppivr' : ''\) \+ '\.png'\)\\}\\`/g, 
  "`/api/radar-ao-vivo2-image?file=${encodeURIComponent('argentina-' + dr.station.id + '/' + exactTs12 + (productType === 'velocidade' ? '-ppivr' : '') + '.png')}`");

fs.writeFileSync('c:\\Users\\Usuário\\Downloads\\download (12)\\studio\\app\\ao-vivo\\page.tsx', code);
