const fs = require('fs');
let code = fs.readFileSync('app/admin/radares/page.tsx', 'utf8');

const target1 = `    const initialUrl = isIpmet ? IPMET_STATIC_URL : buildRadarPngUrl(template, getSampleTs12(interval));
    
        let ipmetUrlsToTry: { url: string; ts12: string }[] = [];
    if (isIpmet) {
      // Para o IPMet, tenta carregar do Storage para mostrar a imagem real (com timestamp recente)
      const nominalTs = getNowMinusMinutesTimestamp12UTC(3);
      for (let back = 0; back <= 60; back += 6) {
        const baseTs = back === 0 ? nominalTs : subtractMinutesFromTimestamp12UTC(nominalTs, back);
        const ts12 = getNearestRadarTimestamp(baseTs, station);
        // Utiliza o proxy para não ter problemas de CORS ao tentar jogar no Canvas
        ipmetUrlsToTry.push({
          url: getProxiedRadarUrl(\`https://storage.googleapis.com/radar_ao_vivo_2/ipmet-bauru/\${ts12}.png\`),
          ts12,
        });
      }
    }
    
    const urlsToTry = isIpmet ? ipmetUrlsToTry : (source === 'redemet' ? [] : buildLatestImageUrls(station, template));`;

const repl1 = `    const initialUrl = isIpmet ? IPMET_STATIC_URL : buildRadarPngUrl(template, getSampleTs12(interval));
    
    let ipmetUrlsToTry: { url: string; ts12: string }[] = [];
    if (isIpmet) {
      // Para o IPMet, tenta carregar direto do cloud function (API proxied) para sempre pegar a imagem em tempo real (evitando CORS do getProxiedRadarUrl padrão se der erro).
      // Usa a URL do IPMET_STATIC_URL passando o t=
      const nominalTs = getNowMinusMinutesTimestamp12UTC(3);
      for (let back = 0; back <= 60; back += 6) {
        const baseTs = back === 0 ? nominalTs : subtractMinutesFromTimestamp12UTC(nominalTs, back);
        const ts12 = getNearestRadarTimestamp(baseTs, station);
        ipmetUrlsToTry.push({
          url: getProxiedRadarUrl(\`\${IPMET_STATIC_URL}?t=\${ts12}\`),
          ts12,
        });
      }
    }
    
    const urlsToTry = isIpmet ? ipmetUrlsToTry : (source === 'redemet' ? [] : buildLatestImageUrls(station, template));`;

code = code.replace(target1, repl1);

const target2 = `    setPreviewImageUrl(isIpmet ? initialUrl : (source === 'redemet' ? getProxiedRadarUrl(initialUrl) : (urlsToTry[0]?.url ?? initialUrl)));`;
const repl2 = `    setPreviewImageUrl(isIpmet ? (urlsToTry[0]?.url ?? initialUrl) : (source === 'redemet' ? getProxiedRadarUrl(initialUrl) : (urlsToTry[0]?.url ?? initialUrl)));`;
code = code.replace(target2, repl2);

fs.writeFileSync('app/admin/radares/page.tsx', code);
console.log("Patched page.tsx preview fetching");
