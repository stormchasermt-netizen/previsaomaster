const fs = require('fs');
let code = fs.readFileSync('app/ao-vivo-2/AoVivo2Content.tsx', 'utf8');

const hookStr = `
  useEffect(() => {
    const renderPrevots = (map: maplibregl.Map | null, prefix: string) => {
      if (!map || !mapReady) return;
      const sourceId = \`prevots-source-\${prefix}\`;
      const fillLayerId = \`prevots-fill-\${prefix}\`;
      const lineLayerId = \`prevots-line-\${prefix}\`;

      if (!prevotsOverlayVisible) {
        if (map.getLayer(fillLayerId)) map.removeLayer(fillLayerId);
        if (map.getLayer(lineLayerId)) map.removeLayer(lineLayerId);
        if (map.getSource(sourceId)) map.removeSource(sourceId);
        return;
      }

      const activeForecast = prevotsForecasts.find(f => f.date === prevotsForecastDate);
      if (!activeForecast) {
        if (map.getLayer(fillLayerId)) map.removeLayer(fillLayerId);
        if (map.getLayer(lineLayerId)) map.removeLayer(lineLayerId);
        if (map.getSource(sourceId)) map.removeSource(sourceId);
        return;
      }

      const features: GeoJSON.Feature<GeoJSON.Polygon>[] = activeForecast.polygons.map((p) => {
        const c = PREVOTS_LEVEL_COLORS[p.level];
        const hex = \`#\${c.slice(2, 8)}\`;
        return {
          type: 'Feature',
          properties: { color: hex },
          geometry: {
            type: 'Polygon',
            coordinates: [p.coordinates.map(c => [c[1], c[0]])] // MapLibre wants [lng, lat]
          }
        };
      });

      const geojsonData: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features
      };

      if (map.getSource(sourceId)) {
        (map.getSource(sourceId) as maplibregl.GeoJSONSource).setData(geojsonData);
      } else {
        map.addSource(sourceId, { type: 'geojson', data: geojsonData });
        map.addLayer({
          id: fillLayerId,
          type: 'fill',
          source: sourceId,
          paint: {
            'fill-color': ['get', 'color'],
            'fill-opacity': 0.3
          }
        });
        map.addLayer({
          id: lineLayerId,
          type: 'line',
          source: sourceId,
          paint: {
            'line-color': ['get', 'color'],
            'line-width': 2
          }
        });
      }
    };

    if (splitScreen) {
      renderPrevots(mapSplitLeftRef.current, 'left');
      renderPrevots(mapSplitRightRef.current, 'right');
    } else {
      renderPrevots(mapSingleRef.current, 'single');
    }
  }, [prevotsOverlayVisible, prevotsForecasts, prevotsForecastDate, mapReady, splitScreen]);
`;

if (!code.includes('renderPrevots(')) {
  code = code.replace(
    /(\/\*\* Camadas raster por radar — troca com raster-fade-duration para transição suave \*\/)/,
    `${hookStr}\n  $1`
  );
}

fs.writeFileSync('app/ao-vivo-2/AoVivo2Content.tsx', code);
console.log('patched prevots map rendering');
