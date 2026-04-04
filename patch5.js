const fs = require('fs');
const path = require('path');
const p = path.join(__dirname, 'app/api/radar-ao-vivo2/route.ts');
let content = fs.readFileSync(p, 'utf8');

const newCode = `      const product = productParam === 'doppler' ? 'doppler' : 'ppi';

      const actualStation = station === 'ipmet-prudente' ? 'ipmet-bauru' : station;
      const dateStr = searchParams.get('date');
      const prefix = mode === 'historico' ? \`historico/\${actualStation}/\${dateStr ? dateStr + '/' : ''}\` : \`\${actualStation}/\`;
      const [files] = await bucket.getFiles({ prefix });`;

content = content.replace(/const product = productParam === 'doppler' \? 'doppler' : 'ppi';[\s\S]*?const actualStation = station === 'ipmet-prudente' \? 'ipmet-bauru' : station;[\s\S]*?const prefix = mode === 'historico' \? `historico\/\$\{actualStation\}\/` : `\$\{actualStation\}\/`;[\s\S]*?const \[files\] = await bucket\.getFiles\(\{ prefix \}\);/, newCode);
fs.writeFileSync(p, content);
