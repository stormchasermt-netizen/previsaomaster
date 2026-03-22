export async function geotiffBlobToPngDataUrl(blob: Blob): Promise<string | null> {
  try {
    const { fromBlob } = await import('geotiff');
    const tiff = await fromBlob(blob);
    const image = await tiff.getImage();

    const origW = image.getWidth();
    const origH = image.getHeight();
    const MAX_DIM = 16384;
    const scale = Math.min(1, MAX_DIM / Math.max(origW, origH, 1));
    const w = Math.max(1, Math.round(origW * scale));
    const h = Math.max(1, Math.round(origH * scale));

    const nSamples = image.getSamplesPerPixel();
    const n = w * h;

    // ✅ FIX 1: readRasters retorna TypedArrays indexados por número, não array JS puro
    const raw = await image.readRasters({ width: w, height: h }) as any;

    // Extrai cada banda corretamente (raw[0], raw[1], ...)
    const bands: ArrayLike<number>[] = [];
    for (let c = 0; c < nSamples; c++) {
      if (raw[c]) bands.push(raw[c]);
    }
    if (bands.length === 0) return null;

    // Acesso direto por banda/pixel
    const getVal = (i: number, c: number): number => {
      const v = (bands[c] as any)?.[i];
      return (v !== undefined && v !== null) ? Number(v) : 0;
    };

    // ✅ FIX 2: Detecta e ignora NoData values comuns (-9999, NaN, Inf)
    const NODATA_THRESHOLD = -9000; // valores abaixo disso são considerados NoData
    const isNoData = (v: number) => !isFinite(v) || isNaN(v) || v < NODATA_THRESHOLD;

    // ✅ FIX 3: Normaliza apenas bandas de cor (não alpha), ignorando NoData
    const colorBands = nSamples >= 4 ? nSamples - 1 : nSamples;
    const mins = Array<number>(colorBands).fill(Infinity);
    const maxs = Array<number>(colorBands).fill(-Infinity);

    for (let i = 0; i < n; i++) {
      for (let c = 0; c < colorBands; c++) {
        const v = getVal(i, c);
        if (!isNoData(v)) {
          if (v < mins[c]) mins[c] = v;
          if (v > maxs[c]) maxs[c] = v;
        }
      }
    }

    // Fallback: se não achou dados válidos, usa 0–255
    for (let c = 0; c < colorBands; c++) {
      if (!isFinite(mins[c])) { mins[c] = 0; maxs[c] = 255; }
    }

    const norm = (v: number, c: number): number => {
      if (isNoData(v)) return 0;
      const range = maxs[c] - mins[c];
      // ✅ FIX 4: range === 0 → banda constante, retorna valor médio visível
      if (range === 0) return mins[c] >= 0 && mins[c] <= 255 ? Math.round(mins[c]) : 128;
      return Math.round(Math.max(0, Math.min(255, ((v - mins[c]) / range) * 255)));
    };

    // ✅ FIX 5: Alpha band — detecta se é float [0..1] ou uint [0..255]
    const getAlpha = (i: number): number => {
      if (nSamples < 4) return 255;
      const v = getVal(i, nSamples - 1);
      if (isNoData(v)) return 0;
      // Se alpha está em [0..1], converte; se está em [0..255], usa direto
      if (v >= 0 && v <= 1) return Math.round(v * 255);
      return Math.round(Math.max(0, Math.min(255, v)));
    };

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const imgData = ctx.createImageData(w, h);

    for (let i = 0; i < n; i++) {
      const base = i * 4;
      if (nSamples >= 3) {
        imgData.data[base] = norm(getVal(i, 0), 0); // R
        imgData.data[base + 1] = norm(getVal(i, 1), 1); // G
        imgData.data[base + 2] = norm(getVal(i, 2), 2); // B
        imgData.data[base + 3] = getAlpha(i);            // A
      } else {
        // Grayscale
        const v = norm(getVal(i, 0), 0);
        imgData.data[base] = v;
        imgData.data[base + 1] = v;
        imgData.data[base + 2] = v;
        imgData.data[base + 3] = getAlpha(i);
      }
    }

    ctx.putImageData(imgData, 0, 0);
    return canvas.toDataURL('image/png');
  } catch (err) {
    console.error('[geotiffBlobToPngDataUrl]', err); // ✅ Não engole o erro silenciosamente
    return null;
  }
}