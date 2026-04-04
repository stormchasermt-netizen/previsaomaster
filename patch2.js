const fs = require('fs');
let code = fs.readFileSync('app/ao-vivo-2/AoVivo2Content.tsx', 'utf8');

const oldString = code.substring(code.indexOf('const ppiSourceBySlug = useMemo'), code.indexOf('const effectiveDopplerImagesBySlug = useMemo'));
const newString = `const ppiSourceBySlug = useMemo(() => {
    const out: Record<string, 'cptec' | 'redemet' | 'sigma' | 'sipam'> = {};
    for (const slug of stationsWithBounds) {
      const catalog = bucketSlugToCatalogSlug(slug);
      const cptec = imagesByStationPpi[slug] ?? [];
      const red = imagesRedemetPpiByCptec[slug] ?? [];
      const sig = imagesSigmaPpiByCptec[slug] ?? [];
      const sip = imagesSipamPpiByCptec[slug] ?? [];
      const hasRed = hasRedemetFallback(catalog) && red.length > 0;
      const hasSig = hasSigmaFallback(catalog) && sig.length > 0;
      const hasSip = hasSipamFallback(catalog) && sip.length > 0;

      let src: 'cptec' | 'redemet' | 'sigma' | 'sipam';
      if (focusedSlug === slug && focusedRadarSource !== 'auto') {
        src = focusedRadarSource as any;
        if (src === 'cptec' && cptec.length === 0) {
          if (hasRed) src = 'redemet';
          else if (hasSig) src = 'sigma';
          else if (hasSip) src = 'sipam';
        }
        if (src === 'redemet' && !hasRed) {
          if (hasSig) src = 'sigma';
          else if (hasSip) src = 'sipam';
          else src = 'cptec';
        }
        if (src === 'sigma' && !hasSig) {
          if (hasRed) src = 'redemet';
          else if (hasSip) src = 'sipam';
          else src = 'cptec';
        }
        if (src === 'sipam' && !hasSip) {
          if (hasRed) src = 'redemet';
          else if (hasSig) src = 'sigma';
          else src = 'cptec';
        }
      } else {
        if (isCptecPpiRecent(cptec, CPTEC_PPI_RECENT_MAX_AGE_MS)) {
          src = 'cptec';
        } else if (hasRed) {
          src = 'redemet';
        } else if (hasSig) {
          src = 'sigma';
        } else if (hasSip) {
          src = 'sipam';
        } else {
          src = 'cptec';
        }
      }
      out[slug] = src;
    }
    return out;
  }, [
    stationsWithBounds,
    imagesByStationPpi,
    imagesRedemetPpiByCptec,
    imagesSigmaPpiByCptec,
    imagesSipamPpiByCptec,
    focusedSlug,
    focusedRadarSource,
  ]);

  const effectivePpiImagesBySlug = useMemo(() => {
    const out: Record<string, { name: string; url: string }[]> = {};
    for (const slug of stationsWithBounds) {
      const src = ppiSourceBySlug[slug];
      const cptec = imagesByStationPpi[slug] ?? [];
      const red = imagesRedemetPpiByCptec[slug] ?? [];
      const sig = imagesSigmaPpiByCptec[slug] ?? [];
      const sip = imagesSipamPpiByCptec[slug] ?? [];
      out[slug] = src === 'sipam' ? sip : (src === 'sigma' ? sig : (src === 'redemet' ? red : cptec));
    }
    return out;
  }, [stationsWithBounds, ppiSourceBySlug, imagesByStationPpi, imagesRedemetPpiByCptec, imagesSigmaPpiByCptec, imagesSipamPpiByCptec]);

  `;

code = code.replace(oldString, newString);

// Also update dependencies array for lookupsPpi
code = code.replace(
  'Object.values(imagesSigmaDopplerByCptec).some((imgs) => imgs.length > 0),\n    [imagesByStationPpi, imagesByStationDoppler, imagesRedemetPpiByCptec, imagesSigmaPpiByCptec, imagesSigmaDopplerByCptec]',
  'Object.values(imagesSigmaDopplerByCptec).some((imgs) => imgs.length > 0) ||\n      Object.values(imagesSipamPpiByCptec).some((imgs) => imgs.length > 0),\n    [imagesByStationPpi, imagesByStationDoppler, imagesRedemetPpiByCptec, imagesSigmaPpiByCptec, imagesSipamPpiByCptec, imagesSigmaDopplerByCptec]'
);

code = code.replace(
  'setImagesSigmaDopplerByCptec({});',
  'setImagesSigmaDopplerByCptec({});\n      setImagesSipamPpiByCptec({});'
);

code = code.replace(
  'const nextSigDop: Record<string, { name: string; url: string }[]> = {};',
  'const nextSigDop: Record<string, { name: string; url: string }[]> = {};\n        const nextSipPpi: Record<string, { name: string; url: string }[]> = {};'
);

code = code.replace(
  'setImagesSigmaDopplerByCptec(nextSigDop);',
  'setImagesSigmaDopplerByCptec(nextSigDop);\n        setImagesSipamPpiByCptec(nextSipPpi);'
);

// We need to fetch sipam tasks!
const sigTasksBlock = `        const sigTasks = stationsWithBounds
          .map((slug) => {
            const catalog = bucketSlugToCatalogSlug(slug);
            if (!hasSigmaFallback(catalog)) return null;
            const rs = getSigmaBucketSlugForCptecBucket(slug);
            if (!rs) return null;
            return Promise.all([
              fetchStationProduct(rs, 'ppi').then((row) => ({ cptecSlug: slug, imagesPpi: row.images })),
              fetchStationProduct(rs, 'doppler').then((row) => ({ cptecSlug: slug, imagesDop: row.images })),
            ]);
          })
          .filter(Boolean);`;

const sipTasksBlock = `        const sigTasks = stationsWithBounds
          .map((slug) => {
            const catalog = bucketSlugToCatalogSlug(slug);
            if (!hasSigmaFallback(catalog)) return null;
            const rs = getSigmaBucketSlugForCptecBucket(slug);
            if (!rs) return null;
            return Promise.all([
              fetchStationProduct(rs, 'ppi').then((row) => ({ cptecSlug: slug, imagesPpi: row.images })),
              fetchStationProduct(rs, 'doppler').then((row) => ({ cptecSlug: slug, imagesDop: row.images })),
            ]);
          })
          .filter(Boolean);

        const sipTasks = stationsWithBounds
          .map((slug) => {
            const catalog = bucketSlugToCatalogSlug(slug);
            if (!hasSipamFallback(catalog)) return null;
            const rs = getSipamBucketSlugForCptecBucket(slug);
            if (!rs) return null;
            return fetchStationProduct(rs, 'ppi').then((row) => ({ cptecSlug: slug, imagesPpi: row.images }));
          })
          .filter(Boolean);`;

code = code.replace(sigTasksBlock, sipTasksBlock);

const sigTasksResolve = `          const sigRes = await Promise.all(sigTasks);
          for (const tuple of sigRes) {
            const [ppi, dop] = tuple as [{ cptecSlug: string; imagesPpi: any[] }, { cptecSlug: string; imagesDop: any[] }];
            nextSigPpi[ppi.cptecSlug] = ppi.imagesPpi;
            nextSigDop[dop.cptecSlug] = dop.imagesDop;
          }`;

const sipTasksResolve = `          const sigRes = await Promise.all(sigTasks);
          for (const tuple of sigRes) {
            const [ppi, dop] = tuple as [{ cptecSlug: string; imagesPpi: any[] }, { cptecSlug: string; imagesDop: any[] }];
            nextSigPpi[ppi.cptecSlug] = ppi.imagesPpi;
            nextSigDop[dop.cptecSlug] = dop.imagesDop;
          }
          const sipRes = await Promise.all(sipTasks);
          for (const r of sipRes) {
            if (r) {
              nextSipPpi[r.cptecSlug] = r.imagesPpi;
            }
          }`;

code = code.replace(sigTasksResolve, sipTasksResolve);

// Also add to hasAny
code = code.replace(
  '(imagesSigmaDopplerByCptec[slug]?.length ?? 0) > 0 ||',
  '(imagesSigmaDopplerByCptec[slug]?.length ?? 0) > 0 ||\n          (imagesSipamPpiByCptec[slug]?.length ?? 0) > 0 ||'
);

// getSipamBucketSlugForCptecBucket check in marker click
code = code.replace(
  'const ss = getSigmaBucketSlugForCptecBucket(slug);',
  'const ss = getSigmaBucketSlugForCptecBucket(slug);\n              const sip = getSipamBucketSlugForCptecBucket(slug);'
);
code = code.replace(
  'if (src === \'sigma\' && ss) return findCptecBySlug(ss, radarConfigs) ?? findCptecBySlug(slug, radarConfigs);',
  'if (src === \'sigma\' && ss) return findCptecBySlug(ss, radarConfigs) ?? findCptecBySlug(slug, radarConfigs);\n              if (src === \'sipam\' && sip) return findCptecBySlug(sip, radarConfigs) ?? findCptecBySlug(slug, radarConfigs);'
);

// select option
code = code.replace(
  '{hasSigmaFallback(bucketSlugToCatalogSlug(focusedSlug)) && <option value="sigma">SIGMA</option>}',
  '{hasSigmaFallback(bucketSlugToCatalogSlug(focusedSlug)) && <option value="sigma">SIGMA</option>}\n                          {hasSipamFallback(bucketSlugToCatalogSlug(focusedSlug)) && <option value="sipam">SIPAM HIDRO</option>}'
);

// hasSipamFallback
code = code.replace(
  '(hasRedemetFallback(bucketSlugToCatalogSlug(focusedSlug)) || hasSigmaFallback(bucketSlugToCatalogSlug(focusedSlug)))',
  '(hasRedemetFallback(bucketSlugToCatalogSlug(focusedSlug)) || hasSigmaFallback(bucketSlugToCatalogSlug(focusedSlug)) || hasSipamFallback(bucketSlugToCatalogSlug(focusedSlug)))'
);

fs.writeFileSync('app/ao-vivo-2/AoVivo2Content.tsx', code);
