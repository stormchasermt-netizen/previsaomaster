const fs = require('fs');
let code = fs.readFileSync('cloud-run/radar-ao-vivo2-feeder/src/radarFetch.ts', 'utf8');

const regex = /\}\?t=\\?\$\{encodeURIComponent\(nominalTs12\)\}\`\;[\s\S]*?return \{ buffer: buf, ts12: nominalTs12 \};\n\}/;
code = code.replace(regex, "}");

fs.writeFileSync('cloud-run/radar-ao-vivo2-feeder/src/radarFetch.ts', code);
