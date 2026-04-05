import { NextRequest, NextResponse } from 'next/server';
import * as admin from 'firebase-admin';
import { getRadarAoVivo2BucketName } from '@/lib/radarAoVivo2Bucket';

export const dynamic = 'force-dynamic';

if (!admin.apps.length) {
  try {
    admin.initializeApp();
  } catch (error) {
    console.error('Erro ao inicializar firebase-admin:', error);
  }
}

async function downloadAndUpload(url: string, destSlug: string, targetName: string) {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return false;
    const buffer = await resp.arrayBuffer();
    
    const bucket = admin.storage().bucket(getRadarAoVivo2BucketName());
    const dateSegment = targetName.slice(0, 8); // extrai YYYYMMDD do inicio do nome (ex: 202511072100.png)
    let finalSlug = destSlug;
    
    // Simplificar slugs originados de fallbacks/alias para salvar no path limpo
    if (finalSlug.startsWith('sigma-')) finalSlug = finalSlug.replace('sigma-', '');
    if (finalSlug.startsWith('sipam-')) finalSlug = finalSlug.replace('sipam-', ''); 
    if (finalSlug.startsWith('redemet-')) finalSlug = finalSlug.replace('redemet-', ''); // note: maybe keep it mapped, but frontend reads exact station. 

    // Destino padrão de histórico do Ao Vivo 2: historico/<slug>/<YYYYMMDD>/<name>
    const destPath = `historico/${finalSlug}/${dateSegment}/${targetName}`;
    
    const file = bucket.file(destPath);
    await file.save(Buffer.from(buffer), {
      contentType: 'image/png',
      metadata: {
         cacheControl: 'public, max-age=31536000, immutable'
      }
    });
    return true;
  } catch(e) {
    return false;
  }
}

function getCptecUrlCandidates(station: any, ts12: string, layer: 'ppi' | 'doppler') {
  const urls: string[] = [];
  const servers = Array.isArray(station.server) ? station.server : [station.server || 's1'];
  
  const y = ts12.slice(0, 4);
  const m = ts12.slice(4, 6);
  const d = ts12.slice(6, 8);
  const h = ts12.slice(8, 10);
  const min = ts12.slice(10, 12);
  
  const layerDir = layer === 'ppi' ? 'ppicz' : 'ppivr';
  const id = layer === 'ppi' ? station.id : (station.dopplerId || station.id);
  const filename = layer === 'ppi' ? `${ts12}.png` : `${ts12}-ppivr.png`;

  for (const srv of servers) {
    const srvFixed = srv.replace('s0', 's1'); // just in case
    urls.push(`https://${srvFixed}.cptec.inpe.br/radar/${station.org}/${station.slug}/ppi/${layerDir}/${y}/${m}/${id}_${ts12}.png`);
  }
  return urls;
}

export async function POST(req: NextRequest) {
  try {
    const { targetTs12, slugs, windowMinutes = 120 } = await req.json();

    if (!targetTs12 || !Array.isArray(slugs)) {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }

    const origin = req.nextUrl.origin;

    const results: Record<string, { ppi: { name: string, url: string }[], doppler: { name: string, url: string }[] }> = {};

    // For each slug, we will find up to 12 images
    const promises = slugs.map(async (slug) => {
      results[slug] = { ppi: [], doppler: [] };

      // SIPAM
      if (slug.startsWith('sipam-')) {
        const sipamSlug = slug.replace('sipam-', '');
        try {
          const res = await fetch(`${origin}/api/sipam/frames?radar=${sipamSlug}`);
          if (res.ok) {
            const data = await res.json();
            if (data.frames) {
              const valid = data.frames.filter((f: any) => f.ts12 <= targetTs12).slice(-12);
              valid.forEach((f: any) => {
                results[slug].ppi.push({ name: `${f.ts12}.png`, url: `https://hidro.sipam.gov.br/apihidro/imagemRadar/${sipamSlug}/dbz/2/${f.sipamTs}.png` });
              });
            }
          }
        } catch (e) {}
        return;
      }

      // FUNCEME
      if (slug.startsWith('funceme-') && slug !== 'funceme-ceara') {
        const radarId = slug === 'funceme-fortaleza' ? 'GMWR1000SST' : 'SST1';
        const date = `${targetTs12.slice(0,4)}-${targetTs12.slice(4,6)}-${targetTs12.slice(6,8)}`;
        try {
          const res = await fetch(`${origin}/api/funceme/frames?radar=${radarId}&date=${date}`);
          if (res.ok) {
            const data = await res.json();
            if (data.frames) {
              const valid = data.frames.filter((f: any) => f.ts12 <= targetTs12).slice(-12);
              valid.forEach((f: any) => {
                results[slug].ppi.push({ name: `${f.ts12}.png`, url: `https://radar.funceme.br/data/dados/gerados/${radarId}/prsf/20/${date.replace(/-/g,'/')}/${f.datahora.replace(/-/g,'_').replace(' ','_').replace(/:/g,'_')}.png` });
              });
            }
          }
        } catch (e) {}
        return;
      }

      // IPMET
      if (slug === 'ipmet-bauru' || slug === 'ipmet-prudente') {
        try {
          const res = await fetch(`${origin}/api/ipmet-available-timestamps?ts12=${targetTs12}`);
          if (res.ok) {
            const data = await res.json();
            if (data.timestamps) {
              // Descending from API
              const valid = data.timestamps.filter((ts: string) => ts <= targetTs12).slice(0, 12).reverse();
              valid.forEach((ts: string) => {
                results[slug].ppi.push({ name: `${ts}.png`, url: `https://www.ipmetradar.com.br/alerta/ppigis/gera_imagem.php?t=${ts}` });
              });
            }
          }
        } catch (e) {}
        return;
      }

      // REDEMET
      if (slug.startsWith('redemet-')) {
        const area = slug.replace('redemet-', '');
        try {
          // just fetch 12 times backwards, 10 min steps
          let curTs = targetTs12;
          for (let i = 0; i < 12; i++) {
            const res = await fetch(`${origin}/api/radar-redemet-find?area=${area}&ts12=${curTs}&historical=true`);
            if (res.ok) {
              const data = await res.json();
              if (data.url) {
                results[slug].ppi.push({ name: `${curTs}.png`, url: data.url });
              }
            }
            // subtract 10 min
            const d = new Date(Date.UTC(parseInt(curTs.slice(0,4)), parseInt(curTs.slice(4,6))-1, parseInt(curTs.slice(6,8)), parseInt(curTs.slice(8,10)), parseInt(curTs.slice(10,12))));
            d.setUTCMinutes(d.getUTCMinutes() - 10);
            curTs = `${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,'0')}${String(d.getUTCDate()).padStart(2,'0')}${String(d.getUTCHours()).padStart(2,'0')}${String(d.getUTCMinutes()).padStart(2,'0')}`;
          }
          results[slug].ppi.reverse(); // oldest first
        } catch (e) {}
        return;
      }

      // CHAPECO (NOWCASTING API DIRECT OR FALLBACK)
      if (slug === 'chapeco') {
        try {
          // 1) First attempt to get the exact data using the generic CPTEC logic via the espiral
          // We can generate candidates like we do for Generic CPTEC and test them
          const station = { id: 'R12137761', dopplerId: 'R12137762', server: ['s1','s2','s3','s0'], org: 'sdcsc', slug: 'chapeco' };
          let curTs = targetTs12;
          for (let i = 0; i < 12; i++) {
            const candidatesPpi: string[] = [];
            const candidatesDop: string[] = [];
            for (let off = 0; off < 5; off++) {
               const d = new Date(Date.UTC(parseInt(curTs.slice(0,4)), parseInt(curTs.slice(4,6))-1, parseInt(curTs.slice(6,8)), parseInt(curTs.slice(8,10)), parseInt(curTs.slice(10,12))));
               d.setUTCMinutes(d.getUTCMinutes() - off);
               const t = `${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,'0')}${String(d.getUTCDate()).padStart(2,'0')}${String(d.getUTCHours()).padStart(2,'0')}${String(d.getUTCMinutes()).padStart(2,'0')}`;
               candidatesPpi.push(...getCptecUrlCandidates(station, t, 'ppi'));
               candidatesDop.push(...getCptecUrlCandidates(station, t, 'doppler'));
            }

            const reqPpi = await fetch(`${origin}/api/radar-find-first-valid`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ urls: candidatesPpi })
            });
            if (reqPpi.ok) {
              const res = await reqPpi.json();
              if (res.exists && res.url) {
                const m = res.url.match(/_(\d{12})\.png/);
                const actualTs = m ? m[1] : curTs;
                results[slug].ppi.push({ name: `${actualTs}.png`, url: res.url });
              }
            }

            const reqDop = await fetch(`${origin}/api/radar-find-first-valid`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ urls: candidatesDop })
            });
            if (reqDop.ok) {
              const res = await reqDop.json();
              if (res.exists && res.url) {
                const m = res.url.match(/_(\d{12})\.png/);
                const actualTs = m ? m[1] : curTs;
                results[slug].doppler.push({ name: `${actualTs}-ppivr.png`, url: res.url });
              }
            }

            const d = new Date(Date.UTC(parseInt(curTs.slice(0,4)), parseInt(curTs.slice(4,6))-1, parseInt(curTs.slice(6,8)), parseInt(curTs.slice(8,10)), parseInt(curTs.slice(10,12))));
            d.setUTCMinutes(d.getUTCMinutes() - 10);
            curTs = `${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,'0')}${String(d.getUTCDate()).padStart(2,'0')}${String(d.getUTCHours()).padStart(2,'0')}${String(d.getUTCMinutes()).padStart(2,'0')}`;
          }
          results[slug].ppi.reverse();
          results[slug].doppler.reverse();

          // 2) If the espiral yielded nothing, we can try the nowcasting API frames directly
          if (results[slug].ppi.length === 0) {
            const resPpi = await fetch(`${origin}/api/nowcasting/chapeco/frames?radarId=R12137761`);
            if (resPpi.ok) {
              const data = await resPpi.json();
              if (data.frames) {
                const valid = data.frames.filter((f: any) => f.ts12 <= targetTs12).slice(-12);
                valid.forEach((f: any) => {
                  const y = f.ts12.slice(0, 4);
                  const m = f.ts12.slice(4, 6);
                  results[slug].ppi.push({ name: `${f.ts12}.png`, url: `https://s1.cptec.inpe.br/radar/sdcsc/chapeco/ppi/ppicz/${y}/${m}/R12137761_${f.ts12}.png` });
                });
              }
            }
          }
          if (results[slug].doppler.length === 0) {
            const resDop = await fetch(`${origin}/api/nowcasting/chapeco/frames?radarId=R12137762`);
            if (resDop.ok) {
              const data = await resDop.json();
              if (data.frames) {
                const valid = data.frames.filter((f: any) => f.ts12 <= targetTs12).slice(-12);
                valid.forEach((f: any) => {
                  const y = f.ts12.slice(0, 4);
                  const m = f.ts12.slice(4, 6);
                  results[slug].doppler.push({ name: `${f.ts12}-ppivr.png`, url: `https://s1.cptec.inpe.br/radar/sdcsc/chapeco/ppi/ppivr/${y}/${m}/R12137762_${f.ts12}.png` });
                });
              }
            }
          }

          // 3) If even nowcasting API had nothing (e.g. historical date), we will forge standard urls assuming 10-min interval, to at least attempt display without 404s crashing the loop
          if (results[slug].ppi.length === 0) {
            let curTs = targetTs12;
            for (let i = 0; i < 12; i++) {
              const y = curTs.slice(0, 4);
              const m = curTs.slice(4, 6);
              results[slug].ppi.push({ name: `${curTs}.png`, url: `https://s1.cptec.inpe.br/radar/sdcsc/chapeco/ppi/ppicz/${y}/${m}/R12137761_${curTs}.png` });
              const d = new Date(Date.UTC(parseInt(y), parseInt(m)-1, parseInt(curTs.slice(6,8)), parseInt(curTs.slice(8,10)), parseInt(curTs.slice(10,12))));
              d.setUTCMinutes(d.getUTCMinutes() - 10);
              curTs = `${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,'0')}${String(d.getUTCDate()).padStart(2,'0')}${String(d.getUTCHours()).padStart(2,'0')}${String(d.getUTCMinutes()).padStart(2,'0')}`;
            }
            results[slug].ppi.reverse();
          }
          if (results[slug].doppler.length === 0) {
            let curTs = targetTs12;
            for (let i = 0; i < 12; i++) {
              const y = curTs.slice(0, 4);
              const m = curTs.slice(4, 6);
              results[slug].doppler.push({ name: `${curTs}-ppivr.png`, url: `https://s1.cptec.inpe.br/radar/sdcsc/chapeco/ppi/ppivr/${y}/${m}/R12137762_${curTs}.png` });
              const d = new Date(Date.UTC(parseInt(y), parseInt(m)-1, parseInt(curTs.slice(6,8)), parseInt(curTs.slice(8,10)), parseInt(curTs.slice(10,12))));
              d.setUTCMinutes(d.getUTCMinutes() - 10);
              curTs = `${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,'0')}${String(d.getUTCDate()).padStart(2,'0')}${String(d.getUTCHours()).padStart(2,'0')}${String(d.getUTCMinutes()).padStart(2,'0')}`;
            }
            results[slug].doppler.reverse();
          }
        } catch(e) {}
        return;
      }

      // CPTEC (Generic)
      // Needs to find first valid via espiral
      try {
        // Fetch radarConfigs to get station data. 
        // We use the local absolute URL to avoid external routing issues (which was causing 404/html responses)
        const configsRes = await fetch(`${origin}/api/radar-configs`, { headers: { 'Content-Type': 'application/json' } });
        let station: any = null;
        if (configsRes.ok) {
          const configs = await configsRes.json();
          for (const st of configs) {
            if (st.slug === slug || st.id === slug) { station = st; break; }
            if (st.aliases) {
              for (const al of st.aliases) {
                if (al.slug === slug) { station = st; break; }
              }
            }
            if (station) break;
          }
        }

        if (station) {
          let curTs = targetTs12;
          for (let i = 0; i < 12; i++) {
            // Generate candidates: exact, -1, -2, -3
            const candidatesPpi: string[] = [];
            const candidatesDop: string[] = [];
            for (let off = 0; off < 5; off++) {
               const d = new Date(Date.UTC(parseInt(curTs.slice(0,4)), parseInt(curTs.slice(4,6))-1, parseInt(curTs.slice(6,8)), parseInt(curTs.slice(8,10)), parseInt(curTs.slice(10,12))));
               d.setUTCMinutes(d.getUTCMinutes() - off);
               const t = `${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,'0')}${String(d.getUTCDate()).padStart(2,'0')}${String(d.getUTCHours()).padStart(2,'0')}${String(d.getUTCMinutes()).padStart(2,'0')}`;
               candidatesPpi.push(...getCptecUrlCandidates(station, t, 'ppi'));
               if (station.dopplerId) candidatesDop.push(...getCptecUrlCandidates(station, t, 'doppler'));
            }

            // Test PPI
            const reqPpi = await fetch(`${origin}/api/radar-find-first-valid`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ urls: candidatesPpi })
            });
            if (reqPpi.ok) {
              const res = await reqPpi.json();
              if (res.exists && res.url) {
                // extract TS from url: R123456_202511072100.png
                const m = res.url.match(/_(\d{12})\.png/);
                const actualTs = m ? m[1] : curTs;
                results[slug].ppi.push({ name: `${actualTs}.png`, url: res.url });
              }
            }

            // Test Doppler
            if (candidatesDop.length > 0) {
              const reqDop = await fetch(`${origin}/api/radar-find-first-valid`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ urls: candidatesDop })
              });
              if (reqDop.ok) {
                const res = await reqDop.json();
                if (res.exists && res.url) {
                  const m = res.url.match(/_(\d{12})\.png/);
                  const actualTs = m ? m[1] : curTs;
                  results[slug].doppler.push({ name: `${actualTs}-ppivr.png`, url: res.url });
                }
              }
            }

            // Step back by 10 minutes
            const d = new Date(Date.UTC(parseInt(curTs.slice(0,4)), parseInt(curTs.slice(4,6))-1, parseInt(curTs.slice(6,8)), parseInt(curTs.slice(8,10)), parseInt(curTs.slice(10,12))));
            d.setUTCMinutes(d.getUTCMinutes() - 10);
            curTs = `${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,'0')}${String(d.getUTCDate()).padStart(2,'0')}${String(d.getUTCHours()).padStart(2,'0')}${String(d.getUTCMinutes()).padStart(2,'0')}`;
          }
          results[slug].ppi.reverse();
          results[slug].doppler.reverse();
        }
      } catch (e) {}
    });

    await Promise.all(promises);

    // === NEW PIPELINE: DOWNLAOD & UPLOAD TO BUCKET ===
    // Agora que encontramos as URLs externas, vamos puxá-las pró-ativamente
    // para acelerar a leitura no cliente e isolar falhas de CORS/404s.
    const uploadPromises: Promise<void>[] = [];
    const stats: Record<string, number> = {};

    for (const slug of Object.keys(results)) {
       stats[slug] = 0;
       
       for (const img of results[slug].ppi) {
          uploadPromises.push((async () => {
             const success = await downloadAndUpload(img.url, slug, img.name);
             if (success) stats[slug]++;
          })());
       }
       
       for (const img of results[slug].doppler) {
          uploadPromises.push((async () => {
             const success = await downloadAndUpload(img.url, slug, img.name);
             if (success) stats[slug]++;
          })());
       }
    }
    
    await Promise.allSettled(uploadPromises);

    return NextResponse.json({ ok: true, results, stats });
  } catch (error: any) {
    console.error('Error in radar-historico-direct:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
