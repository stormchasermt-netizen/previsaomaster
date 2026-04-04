const fs = require('fs');
const path = require('path');
const p = path.join(__dirname, 'app/ao-vivo-2/AoVivo2Content.tsx');
let content = fs.readFileSync(p, 'utf8');

const newCode = `    // Polling para historico e ao vivo
    useEffect(() => {
      const isWaitingForHistory = isHistoricalMode && (stations.length === 0 || Object.values(imagesByStationPpi).every(imgs => imgs.length === 0));
      const intervalTime = isWaitingForHistory ? 5000 : 60000;
      
      const interval = setInterval(fetchAllData, intervalTime);`;

content = content.replace(/\/\/ Polling para historico e ao vivo[\s\S]*?useEffect\(\(\) => \{[\s\S]*?const isWaitingForHistory = isHistoricalMode && stations\.length === 0;[\s\S]*?const intervalTime = isWaitingForHistory \? 5000 : 60000;[\s\S]*?const interval = setInterval\(fetchAllData, intervalTime\);/, newCode);
fs.writeFileSync(p, content);
