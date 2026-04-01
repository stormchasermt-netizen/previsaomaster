const fs = require('fs');
const lines = fs.readFileSync('c:\\Users\\Usuário\\OneDrive\\Documents\\radares argentina.txt', 'utf8').split('\n');

const out = [];
for (const line of lines) {
  if (!line.startsWith('"')) continue;
  const parts = line.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g).map(s => s.replace(/"/g, ''));
  if (parts.length < 11) continue;
  const [codigo, nome, desc, lat, lng, raio, raiom, sw_lat, sw_lon, ne_lat, ne_lon] = parts;
  
  const id = codigo;
  const slug = `argentina-${id}`;
  const outLine = `  { id: '${id}', slug: '${slug}', name: '${nome}', lat: ${lat}, lng: ${lng}, rangeKm: ${raio}, org: 'argentina', server: 'webmet', product: 'ppi', subtype: 'COLMAX', updateIntervalMinutes: 10, updateIntervalOffsetMinutes: 0, bounds: { minLon: ${sw_lon}, minLat: ${sw_lat}, maxLon: ${ne_lon}, maxLat: ${ne_lat} } },`;
  out.push(outLine);
}
fs.writeFileSync('temp_ar.txt', out.join('\n'));
