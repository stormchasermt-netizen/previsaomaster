const fs = require('fs');
const file = 'cloud-run/radar-ao-vivo2-feeder/src/index.ts';
let code = fs.readFileSync(file, 'utf8');

// 1. Add executeHistorico function
const historicoFunc = `
async function executeHistorico(targetTs12: string, windowMinutes: number): Promise<{ ok: boolean, results: any[] }> {
  const bucket = storage.bucket(GCS_BUCKET);
  const results: any[] = [];
  
  for (const slug of SYNC_SLUGS) {
    if (SLUGS_WITHOUT_CDN_SYNC.has(slug)) continue;
    
    // Clear existing history for this slug
    const prefix = \`historico/\${slug}/\`;
    try {
      await bucket.deleteFiles({ prefix });
    } catch (e) {
      console.error(\`Failed to clear history for \${slug}\`, e);
    }
    
    // Download logic
    let r;
    if (slug === 'ipmet-bauru' || slug === 'ipmet-prudente') {
      // For Ipmet we might not be able to easily get history unless the proxy supports it, but let's try the latest
      const fetchIpmet = await fetchIpmetImage(targetTs12);
      r = fetchIpmet ? [{ buffer: fetchIpmet.buffer, fileName: \`\${fetchIpmet.ts12}.png\`, url: 'ipmet' }] : [];
    } else if (slug === 'climatempo-poa') {
      const climatempo = await fetchClimatempoPoa(targetTs12);
      r = climatempo ? [{ buffer: climatempo.buffer, fileName: \`\${climatempo.ts12}.png\`, url: climatempo.url }] : [];
    } else if (slug === 'simepar-cascavel') {
      const simepar = await downloadSimeparImagesInWindow(targetTs12, windowMinutes);
      r = simepar.map(s => ({ buffer: s.buffer, fileName: s.fileName, url: s.url }));
    } else if (slug.startsWith('sigma-')) {
      const st = CPTEC_STATIONS.find((s) => s.slug === slug);
      if (st && st.sigmaConfig) {
        const sigma = await downloadSigmaImagesInWindow(st.sigmaConfig, targetTs12, windowMinutes);
        r = sigma.map(s => ({ buffer: s.buffer, fileName: s.fileName, url: s.url }));
      } else {
        r = [];
      }
    } else if (slug.startsWith('redemet-')) {
      const baseSlug = slug.replace('redemet-', '');
      const st = CPTEC_STATIONS.find((s) => s.slug === baseSlug);
      if (st && st.redemetId) {
        const red = await downloadRedemetImagesInWindow(st, targetTs12, windowMinutes);
        r = red.map(s => ({ buffer: s.buffer, fileName: s.fileName, url: s.url }));
      } else {
        r = [];
      }
    } else {
      const st = CPTEC_STATIONS.find((s) => s.slug === slug);
      if (st) {
        if (st.org === 'smn_ar') {
          const ar = await downloadArgentinaImagesInWindow(st, targetTs12, windowMinutes);
          r = ar.map(s => ({ buffer: s.buffer, fileName: s.fileName, url: s.url }));
        } else {
          const cptec = await downloadCptecImagesInWindow(st, slug, targetTs12, windowMinutes);
          r = cptec.map(s => ({ buffer: s.buffer, fileName: s.fileName, url: s.url }));
        }
      } else {
        r = [];
      }
    }
    
    // Save to historico/slug/
    if (r && r.length > 0) {
      await Promise.all(r.map(async item => {
        try {
          const objectPath = \`historico/\${slug}/\${item.fileName}\`;
          const file = bucket.file(objectPath);
          await file.save(item.buffer, { contentType: 'image/png' });
        } catch (e) {
          console.error('Failed to save', item.fileName, e);
        }
      }));
      results.push({ slug, count: r.length });
    } else {
      results.push({ slug, count: 0 });
    }
  }
  
  return { ok: true, results };
}
`;

if (!code.includes('async function executeHistorico(')) {
  code = code.replace('async function executeCleanup()', historicoFunc + '\nasync function executeCleanup()');
}

// 2. Add app.post('/historico')
const endpoint = `
app.post('/historico', requireSecret, async (req, res) => {
  try {
    const { targetTs12, windowMinutes } = req.body;
    if (!targetTs12 || typeof windowMinutes !== 'number') {
      return res.status(400).json({ error: 'Missing targetTs12 or windowMinutes' });
    }
    
    // Run async so it doesn't block
    executeHistorico(targetTs12, windowMinutes)
      .then(r => console.log('Historico finished', r))
      .catch(e => console.error('Historico error', e));
      
    res.json({ ok: true, status: 'job_started', targetTs12, windowMinutes });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});
`;

if (!code.includes("app.post('/historico'")) {
  code = code.replace("app.all('/cleanup'", endpoint + "\napp.all('/cleanup'");
}

fs.writeFileSync(file, code);
console.log('Patched index.ts');
