const fs = require('fs');

const tsFile = fs.readFileSync('lib/cptecRadarStations.ts', 'utf8');

// Find the CPTEC_RADAR_STATIONS array
const start = tsFile.indexOf('export const CPTEC_RADAR_STATIONS: CptecRadarStation[] = [');
const end = tsFile.indexOf('];', start);
const arrString = tsFile.substring(start, end + 2);

// Use a simple regex to extract slug and sigmaConfig pairs line by line.
const lines = arrString.split('\n');
let out = '';
for (const line of lines) {
  const slugMatch = line.match(/slug:\s*'([^']+)'/);
  const sigmaMatch = line.match(/sigmaConfig:\s*(\{.*?\})/);
  
  if (slugMatch && sigmaMatch) {
    const slug = slugMatch[1];
    const sigmaconfig = sigmaMatch[1];
    out += `  if (CPTEC_STATIONS['${slug}']) CPTEC_STATIONS['${slug}'].sigmaConfig = ${sigmaconfig};\n`;
  }
}

fs.writeFileSync('add_sigmaconfigs.js', out);
console.log('done correct extraction');
