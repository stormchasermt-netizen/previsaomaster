const fs = require('fs');
let code = fs.readFileSync('c:\\Users\\Usuário\\Downloads\\download (12)\\studio\\app\\ao-vivo\\page.tsx', 'utf8');

// 1. Injetar auth protection
code = code.replace(
  "const { t } = useTranslation();",
  `const { t } = useTranslation();\n  const router = import('next/navigation').then(m => m.useRouter());\n  useEffect(() => {\n    if (user !== undefined && (!user || (user.type !== 'admin' && user.type !== 'superadmin'))) {\n      window.location.href = '/';\n    }\n  }, [user]);`
);

// 2. Substituir a busca da imagem diretamente para bater no nosso bucket proxy e ignorar o exists
code = code.replace(
  /async function probeRadarImageExists[\s\S]*?return false;\n  \}/g,
  `async function probeRadarImageExists(dr: DisplayRadar, ts12: string, productType: string, slugParam: string, signal?: AbortSignal, isHistorical: boolean = false): Promise<boolean> { return true; }`
);

// 3. Forçar o updateRadarLayer a usar sempre o bucket em vez da URL real
const updateRadarLayerRegex = /const updateRadarLayer = useCallback\([\s\S]*?overlayGenerationRef\]\n    \);/g;

code = code.replace(updateRadarLayerRegex, `
  const updateRadarLayer = useCallback(
    (map: maplibregl.Map, dr: DisplayRadar, minutesAgo: number, isPast: boolean, opacity: number, exactTs12: string, productType: string) => {
      const slug = dr.type === 'cptec' ? dr.station.slug : \`argentina-\${dr.station.id}\`;
      const radarKey = dr.type === 'cptec' ? dr.station.slug : dr.station.id;
      const layerId = \`radar-layer-\${radarKey}\`;
      const sourceId = \`radar-source-\${radarKey}\`;
      
      const bounds = getBoundsForDisplayRadar(dr);
      if (!bounds) return;
      const coordinates = [
        [bounds.west, bounds.north],
        [bounds.east, bounds.north],
        [bounds.east, bounds.south],
        [bounds.west, bounds.south],
      ];

      // Ignoramos a url gerada pela app antiga, forçamos o nosso bucket
      const v = Date.now();
      const ext = productType === 'velocidade' ? '-ppivr.png' : '.png';
      const finalUrl = \`/api/radar-ao-vivo2-image?file=\${encodeURIComponent(slug + '/' + exactTs12 + ext)}&v=\${v}\`;

      if (map.getSource(sourceId)) {
        (map.getSource(sourceId) as any).updateImage({ url: finalUrl, coordinates });
      } else {
        map.addSource(sourceId, { type: 'image', url: finalUrl, coordinates });
      }
      if (!map.getLayer(layerId)) {
        map.addLayer({
          id: layerId,
          type: 'raster',
          source: sourceId,
          paint: {
            'raster-opacity': opacity,
            'raster-fade-duration': 0,
            'raster-resampling': 'nearest'
          },
        });
      } else {
        map.setPaintProperty(layerId, 'raster-opacity', opacity);
      }
    }, [getBoundsForDisplayRadar]
  );
`);

fs.writeFileSync('temp_patch.js', 'ok');
fs.writeFileSync('c:\\Users\\Usuário\\Downloads\\download (12)\\studio\\app\\ao-vivo\\page.tsx', code);
