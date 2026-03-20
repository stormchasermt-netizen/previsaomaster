/**
 * Converte GeoTIFF (Blob) para PNG data URL — para exibir em <img> no navegador.
 * Navegadores não renderizam TIFF nativamente.
 */

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

    const raw = await image.readRasters({ width: w, height: h });
    const bands: ArrayLike<number>[] = [];
    if (Array.isArray(raw)) {
      for (let c = 0; c < nSamples; c++) bands.push((raw as any)[c] ?? (raw as any));
    } else {
      for (let c = 0; c < nSamples; c++) bands.push((raw as any)[c]);
    }
    if (bands.length === 0 || !bands[0]) return null;

    const isInterleaved = bands.length === 1 && nSamples > 1;
    const getVal = (i: number, c: number) => {
      if (isInterleaved) return (bands[0] as any)[i * nSamples + c] ?? 0;
      return (bands[c] as any)?.[i] ?? 0;
    };

    const mins = Array<number>(nSamples).fill(Infinity);
    const maxs = Array<number>(nSamples).fill(-Infinity);
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < nSamples; c++) {
        const v = getVal(i, c);
        if (typeof v === 'number' && isFinite(v)) {
          if (v < mins[c]) mins[c] = v;
          if (v > maxs[c]) maxs[c] = v;
        }
      }
    }
    const norm = (v: number, c: number) => {
      const range = maxs[c] - mins[c] || 1;
      return Math.round(Math.max(0, Math.min(255, ((Number(v) - mins[c]) / range) * 255)));
    };

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const imgData = ctx.createImageData(w, h);
    for (let i = 0; i < n; i++) {
      if (nSamples >= 3) {
        imgData.data[i * 4] = norm(getVal(i, 0), 0);
        imgData.data[i * 4 + 1] = norm(getVal(i, 1), 1);
        imgData.data[i * 4 + 2] = norm(getVal(i, 2), 2);
        imgData.data[i * 4 + 3] = nSamples >= 4 ? norm(getVal(i, 3), 3) : 255;
      } else {
        const v = norm(getVal(i, 0), 0);
        imgData.data[i * 4] = v;
        imgData.data[i * 4 + 1] = v;
        imgData.data[i * 4 + 2] = v;
        imgData.data[i * 4 + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

/** Se a URL aponta para GeoTIFF, faz fetch + conversão e retorna data URL. Senão retorna a URL original. */
export async function resolveImageUrlForOverlay(url: string): Promise<string> {
  if (!url?.trim()) return url;
  const isTiff = /\.tif(f)?($|\?|&)/i.test(url);
  if (!isTiff) return url;
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) return url;
    const blob = await res.blob();
    const dataUrl = await geotiffBlobToPngDataUrl(blob);
    return dataUrl ?? url;
  } catch {
    return url;
  }
}
