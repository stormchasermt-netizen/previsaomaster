import fs from 'fs';

const file = 'app/ao-vivo-2/AoVivo2Content.tsx';
let code = fs.readFileSync(file, 'utf8');

// The replacement logic:
const newStartJob = `
  const startHistoricalJob = async () => {
    if (!histStartDate) return;
    setHistLoading(true);
    
    // convert YYYY-MM-DDTHH:mm to YYYYMMDDHHmm
    const toTs12 = (d: string) => d.replace(/\\D/g, '').slice(0, 12);
    
    let windowMinutes = 120; 
    let targetTs12 = toTs12(histStartDate);
    
    if (histIsInterval && histEndDate) {
      const endTs = toTs12(histEndDate);
      targetTs12 = endTs; 
      const d1 = new Date(histStartDate).getTime();
      const d2 = new Date(histEndDate).getTime();
      windowMinutes = Math.max(10, Math.floor((d2 - d1) / 60000));
      if (windowMinutes > 1440) windowMinutes = 1440;
    }
    
    try {
      if (typeof addToast === 'function') addToast('Buscando histórico... Isso pode levar alguns instantes.', 'info');
      setIsHistoricalMode(true);
      setShowHistoricalModal(false);

      // Collect all slugs to fetch (including fallbacks)
      const allSlugs = new Set<string>();
      stationsWithBounds.forEach(slug => {
        allSlugs.add(slug);
        const red = getRedemetBucketSlugForCptecBucket(slug);
        if (red) allSlugs.add(red);
        const sig = getSigmaBucketSlugForCptecBucket(slug);
        if (sig) allSlugs.add(sig);
        const sip = getSipamBucketSlugForCptecBucket(slug);
        if (sip) allSlugs.add(sip);
      });

      const slugsArray = Array.from(allSlugs);

      const res = await fetch('/api/radar-historico-direct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetTs12, slugs: slugsArray, windowMinutes })
      });
      
      if (!res.ok) throw new Error('Erro ao iniciar job');
      
      const data = await res.json();
      if (data.ok && data.results) {
        const nextPpi = { ...imagesByStationPpi };
        const nextDop = { ...imagesByStationDoppler };
        const nextRed = { ...imagesRedemetPpiByCptec };
        const nextSigPpi = { ...imagesSigmaPpiByCptec };
        const nextSigDop = { ...imagesSigmaDopplerByCptec };
        const nextSipPpi = { ...imagesSipamPpiByCptec };

        for (const slug of Object.keys(data.results)) {
           // Se for um fallback Redemet
           if (slug.startsWith('redemet-')) {
              const cptecSlug = getCptecSlugFromRedemetArea(slug.replace('redemet-', ''));
              if (cptecSlug) nextRed[cptecSlug] = data.results[slug].ppi;
           } else if (slug.startsWith('sigma-')) {
              const cptecSlug = slug.replace('sigma-', '');
              nextSigPpi[cptecSlug] = data.results[slug].ppi;
              nextSigDop[cptecSlug] = data.results[slug].doppler;
           } else if (slug.startsWith('sipam-')) {
              const sipamSlug = slug.replace('sipam-', '');
              // find the cptec slug that corresponds to this sipamSlug
              const cptecSlug = stationsWithBounds.find(s => getSipamBucketSlugForCptecBucket(s) === slug);
              if (cptecSlug) nextSipPpi[cptecSlug] = data.results[slug].ppi;
           } else {
              nextPpi[slug] = data.results[slug].ppi;
              nextDop[slug] = data.results[slug].doppler;
           }
        }
        
        setImagesByStationPpi(nextPpi);
        setImagesByStationDoppler(nextDop);
        setImagesRedemetPpiByCptec(nextRed);
        setImagesSigmaPpiByCptec(nextSigPpi);
        setImagesSigmaDopplerByCptec(nextSigDop);
        setImagesSipamPpiByCptec(nextSipPpi);

        if (typeof addToast === 'function') addToast('Histórico carregado com sucesso!', 'success');
      }

    } catch (e) {
      if (typeof addToast === 'function') addToast('Erro ao buscar histórico', 'error');
    } finally {
      setHistLoading(false);
    }
  };
`;

const regex = /const startHistoricalJob = async \(\) => \{[\s\S]*?finally \{\s*\/\/[^\n]*\s*\}\s*\};/;
code = code.replace(regex, newStartJob.trim());

fs.writeFileSync(file, code, 'utf8');
console.log('Done!');
