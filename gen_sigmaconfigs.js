const fs = require('fs');
const text = fs.readFileSync('lib/cptecRadarStations.ts', 'utf8');

const regex = /slug:\s*'([^']+)'[\s\S]*?sigmaConfig:\s*(\{[^\}]+\})/g;
let match;
let output = '';
while ((match = regex.exec(text)) !== null) {
  const slug = match[1];
  const sigmaconfig = match[2];
  output += `CPTEC_STATIONS['${slug}'] && (CPTEC_STATIONS['${slug}'].sigmaConfig = ${sigmaconfig});\n`;
}
fs.writeFileSync('add_sigmaconfigs.js', output);
console.log('done');
