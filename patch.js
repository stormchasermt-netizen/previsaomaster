const fs = require('fs');
let code = fs.readFileSync('app/admin/radares/page.tsx', 'utf8');

const regex = /\/\*\* Salva posição \(lat\/lng\) após arrastar\. Usado no fim do drag\. \*\/[\s\S]*?\}, \[selectedStation, radarSource, urlTemplate, config, rangeKm, updateIntervalMinutes, rotationDegrees, previewOpacity, configs, addToast\]\);/;

const newFn = `  /** Salva posição (lat/lng) após arrastar o Centro do Radar. Move a imagem junto para preservar a posição relativa. */
  const handleSavePosition = useCallback(async (lat: number, lng: number) => {
    if (!selectedStation || !urlTemplate.trim()) return;
    
    const deltaLat = lat - centerLat;
    const deltaLng = lng - centerLng;
    
    setCenterLat(lat);
    setCenterLng(lng);
    
    // Move a imagem junto com o centro do radar, se ela já foi deslocada
    let newImgLat = imageCenterLat !== 0 ? imageCenterLat + deltaLat : 0;
    let newImgLng = imageCenterLng !== 0 ? imageCenterLng + deltaLng : 0;
    if (newImgLat !== 0) setImageCenterLat(newImgLat);
    if (newImgLng !== 0) setImageCenterLng(newImgLng);
    
    // Move os bounds customizados junto, se existirem
    let newCustomBounds = customBounds;
    if (useCustomBounds && customBounds) {
        newCustomBounds = {
            north: customBounds.north + deltaLat,
            south: customBounds.south + deltaLat,
            east: customBounds.east + deltaLng,
            west: customBounds.west + deltaLng
        };
        setCustomBounds(newCustomBounds);
    }
    
    const s = selectedStation.station;
    const slug: string = selectedStation.type === 'cptec'
      ? (s as CptecRadarStation).slug
      : \`argentina:\${(s as ArgentinaRadarStation).id}\`;
    const id = (selectedStation.type === 'cptec' && radarSource === 'redemet') ? \`\${slug}-redemet\` : (selectedStation.type === 'cptec' && radarSource === 'sigma') ? \`sigma-\${slug}\` : slug;
    
    const isIpmet = selectedStation.type === 'cptec' && ((s as CptecRadarStation).slug === 'ipmet-bauru' || (s as CptecRadarStation).slug === 'ipmet-prudente');
    
    const latForBounds = (newImgLat !== 0) ? newImgLat : lat;
    const lngForBounds = (newImgLng !== 0) ? newImgLng : lng;

    let computedBounds;
    const isDefaultIpmetSave = isIpmet && (s as CptecRadarStation).bounds && newImgLat === 0 && newImgLng === 0 && rangeKm === (s as CptecRadarStation).rangeKm && !useCustomBounds;
    if (isDefaultIpmetSave) {
      computedBounds = {
        ne: { lat: (s as CptecRadarStation).bounds!.maxLat, lng: (s as CptecRadarStation).bounds!.maxLon },
        sw: { lat: (s as CptecRadarStation).bounds!.minLat, lng: (s as CptecRadarStation).bounds!.minLon }
      };
    } else {
      const calcBounds = isIpmet && typeof calculateRadarBoundsGeodesic === 'function' ? calculateRadarBoundsGeodesic : calculateRadarBounds;
      computedBounds = calcBounds(latForBounds, lngForBounds, rangeKm);
    }
    
    setSaving(true);
    try {
      await saveRadarConfig({
        id,
        stationSlug: slug,
        name: s.name + (radarSource === 'redemet' ? ' (Redemet)' : radarSource === 'sigma' ? ' (Sigma)' : ''),
        urlTemplate: urlTemplate.trim(),
        bounds: computedBounds,
        lat,
        lng,
        imageCenterLat: newImgLat !== 0 ? newImgLat : undefined,
        imageCenterLng: newImgLng !== 0 ? newImgLng : undefined,
        rangeKm,
        maskRadiusKm: maskRadiusKm !== rangeKm ? maskRadiusKm : undefined,
        updateIntervalMinutes: updateIntervalMinutes,
        rotationDegrees: rotationDegrees,
        opacity: previewOpacity,
        customBounds: (useCustomBounds && newCustomBounds) ? newCustomBounds : undefined,
        chromaKeyDeltaThreshold: chromaKeyDeltaThreshold > 0 ? chromaKeyDeltaThreshold : undefined,
        cropConfig: (cropTop > 0 || cropBottom > 0 || cropLeft > 0 || cropRight > 0) ? { top: cropTop, bottom: cropBottom, left: cropLeft, right: cropRight } : undefined,
        superRes: superRes || undefined,
      });
      addToast('Centro movido (imagem acompanhou).', 'success');
      await loadConfigs();
    } catch (e: any) {
      addToast(\`Erro ao salvar: \${e.message}\`, 'error');
    } finally {
      setSaving(false);
    }
  }, [selectedStation, radarSource, urlTemplate, config, rangeKm, updateIntervalMinutes, rotationDegrees, previewOpacity, configs, addToast, centerLat, centerLng, imageCenterLat, imageCenterLng, customBounds, useCustomBounds, maskRadiusKm, chromaKeyDeltaThreshold, cropTop, cropBottom, cropLeft, cropRight, superRes]);`;

if(code.match(regex)) {
  fs.writeFileSync('app/admin/radares/page.tsx', code.replace(regex, newFn));
  console.log('handleSavePosition updated successfully');
} else {
  console.log('Could not find handleSavePosition!');
}
