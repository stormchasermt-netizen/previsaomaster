const fs = require('fs');
let code = fs.readFileSync('cloud-run/radar-ao-vivo2-feeder/src/index.ts', 'utf8');

const regex = /if \(slug === 'ipmet-bauru'\) \{/;
if (code.match(regex)) {
  code = code.replace(regex, "if (slug === 'ipmet-bauru' || slug === 'ipmet-prudente') {");
  
  // also change the console.log string to include slug
  code = code.replace(/console\.log\('\[SYNC\] ipmet-bauru: Usando fetchIpmetImage\.\.\.'\);/, "console.log(`[SYNC] ${slug}: Usando fetchIpmetImage...`);");
  
  fs.writeFileSync('cloud-run/radar-ao-vivo2-feeder/src/index.ts', code);
  console.log("Patched index.ts");
} else {
  console.log("Could not find ipmet-bauru");
}
