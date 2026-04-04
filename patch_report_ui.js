const fs = require('fs');
let code = fs.readFileSync('app/ao-vivo-2/AoVivo2Content.tsx', 'utf8');

const reportUI = fs.readFileSync('report_ui_block.txt', 'utf8');

const funcs = `
  const myLocation = null;

  const cancelReport = () => {
    setReportStep('closed');
    setReportLat(null);
    setReportLng(null);
    setReportType('ven');
    setReportDetail('');
    setReportMediaMode('file');
    setReportMediaFile(null);
    setReportMediaLink('');
    setReportCitySearch('');
  };

  const startPickMapLocation = () => {
    setReportStep('pick-map');
    const map = splitScreen ? mapSplitLeftRef.current : mapSingleRef.current;
    if (map) {
      map.getCanvas().style.cursor = 'crosshair';
      map.once('click', (e) => {
        setReportLat(parseFloat(e.lngLat.lat.toFixed(5)));
        setReportLng(parseFloat(e.lngLat.lng.toFixed(5)));
        setReportStep('form');
        map.getCanvas().style.cursor = '';
      });
    }
  };

  const searchCityForReport = async () => {
    if (!reportCitySearch.trim()) return;
    try {
      const res = await fetch(\`https://nominatim.openstreetmap.org/search?format=json&q=\${encodeURIComponent(reportCitySearch)}\`);
      const data = await res.json();
      if (data && data.length > 0) {
        setReportLat(parseFloat(data[0].lat));
        setReportLng(parseFloat(data[0].lon));
        setReportStep('form');
      } else {
        if (typeof addToast === 'function') addToast('Cidade não encontrada', 'info');
      }
    } catch {
      if (typeof addToast === 'function') addToast('Erro ao buscar cidade', 'error');
    }
  };

  const submitReport = async () => {
    if (!user || reportLat == null || reportLng == null) return;
    const hasMedia = reportMediaFile || (reportMediaMode === 'link' && reportMediaLink?.trim());
    if (reportType === 'tor' && !hasMedia) {
      if (typeof addToast === 'function') addToast('Tornados e Nuvens Funis requerem foto ou vídeo.', 'error');
      return;
    }
    setReportSending(true);
    try {
      const payload = {
        userId: user.uid,
        lat: reportLat,
        lng: reportLng,
        type: reportType,
        detail: reportType !== 'tor' ? reportDetail || undefined : undefined,
        mediaType: reportMediaMode === 'link' && reportMediaLink ? 'link' : reportMediaFile ? 'file' : undefined,
        mediaUrl: reportMediaMode === 'link' && reportMediaLink ? reportMediaLink : undefined,
        createdAt: new Date(),
        status: 'pending',
      };

      if (reportMediaMode === 'file' && reportMediaFile) {
        const fileRef = ref(storage, \`reports/\${Date.now()}_\${reportMediaFile.name}\`);
        await uploadBytes(fileRef, reportMediaFile);
        payload.mediaUrl = await getDownloadURL(fileRef);
      }

      await addDoc(collection(db, 'storm_reports'), payload);
      if (typeof addToast === 'function') addToast('Relato enviado com sucesso! Aguardando moderação.', 'success');
      cancelReport();
    } catch (e) {
      if (typeof addToast === 'function') addToast('Erro ao enviar relato.', 'error');
      console.error(e);
    } finally {
      setReportSending(false);
    }
  };
`;

if (!code.includes('const cancelReport = () => {')) {
  code = code.replace(
    /export default function AoVivo2Content\(\) \{/,
    `export default function AoVivo2Content() {\n${funcs}`
  );
}

if (!code.includes('Popup de relato multi-etapa')) {
  code = code.replace(
    /<div className="fixed inset-0 pointer-events-none z-\[999\]">\s*<\/div>\s*<\/div>\s*<\/div>\s*\)\;\s*\}/s,
    `${reportUI.replace(/geocoder\.geocode/g, 'fetch')}\n        <div className="fixed inset-0 pointer-events-none z-[999]">\n        </div>\n      </div>\n    </div>\n  );\n}`
  );
}

fs.writeFileSync('app/ao-vivo-2/AoVivo2Content.tsx', code);
console.log('patched report funcs and UI');
