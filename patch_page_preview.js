const fs = require('fs');
let code = fs.readFileSync('app/admin/radares/page.tsx', 'utf8');

const regex = /url: getProxiedRadarUrl\(\`https:\/\/storage\.googleapis\.com\/radar_ao_vivo_2\/ipmet-bauru\/\$\{ts12\}\.png\`\)/g;
const replacement = "url: getProxiedRadarUrl(`${IPMET_STATIC_URL}?t=${ts12}`)";

if (code.match(regex)) {
  code = code.replace(regex, replacement);
  fs.writeFileSync('app/admin/radares/page.tsx', code);
  console.log("Patched page.tsx IPmet urls");
} else {
  console.log("Regex no match");
}
