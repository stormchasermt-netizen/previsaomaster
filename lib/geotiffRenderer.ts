/**
 * Converte GeoTIFF para PNG exibível em <img>.
 * Browsers não renderizam TIFF — estas funções fazem a conversão no client-side.
 * Pixels NoData ficam transparentes (como no Google Earth).
 */

const dataUrlCache = new Map<string, string>();

export function isTiffUrl(url: string): boolean {
  return /\.(tiff?)([\?#]|$)/i.test(url) || /%2[Ff].*\.(tiff?)/i.test(url);
}

type BoundsResult = { ne: { lat: number; lng: number }; sw: { lat: number; lng: number } } | null;

/** Renderiza um GeoTIFF (ArrayBuffer) para { dataUrl, bounds }. */
async function renderGeoTiff(buf: ArrayBuffer): Promise<{ dataUrl: string; bounds: BoundsResult }> {
  const { fromArrayBuffer } = await import('geotiff');
  const tiff = await fromArrayBuffer(buf);
  const image = await tiff.getImage();

  // Bounds geográficos
  const bbox = image.getBoundingBox();
  let bounds: BoundsResult = null;
  if (bbox && bbox.length >= 4) {
    const [minX, minY, maxX, maxY] = bbox;
    bounds = { sw: { lat: minY, lng: minX }, ne: { lat: maxY, lng: maxX } };
  }

  // Dimensões (capped a 2048px)
  const origW = image.getWidth();
  const origH = image.getHeight();
  const MAX_DIM = 2048;
  const scale = Math.min(1, MAX_DIM / Math.max(origW, origH, 1));
  const w = Math.max(1, Math.round(origW * scale));
  const h = Math.max(1, Math.round(origH * scale));

  const nSamples = image.getSamplesPerPixel();
  const n = w * h;
  const fd = image.getFileDirectory();
  const bps = fd.BitsPerSample ? fd.BitsPerSample[0] : 8;

  // NoData
  let noDataVal: number | null = null;
  try {
    const nd = (image as any).getGDALNoData?.();
    if (nd != null && isFinite(nd)) noDataVal = nd;
  } catch {}

  // Ler bandas separadamente
  const rasters = await image.readRasters({ width: w, height: h }) as any;
  const bands: ArrayLike<number>[] = [];
  for (let c = 0; c < nSamples; c++) bands.push(rasters[c] || rasters);

  const is8bit = bps <= 8;
  const normBands: Uint8Array[] = [];
  const isNoData = new Uint8Array(n);

  for (let c = 0; c < Math.min(nSamples, 4); c++) {
    const band = bands[c];
    const out = new Uint8Array(n);
    if (is8bit) {
      for (let i = 0; i < n; i++) {
        const v = band[i];
        if (noDataVal !== null && v === noDataVal) { isNoData[i] = 1; out[i] = 0; }
        else { out[i] = v & 0xFF; }
      }
    } else {
      let min = Infinity, max = -Infinity;
      for (let i = 0; i < n; i++) {
        const v = band[i];
        if (noDataVal !== null && v === noDataVal) { isNoData[i] = 1; continue; }
        if (!isFinite(v)) { isNoData[i] = 1; continue; }
        if (v < min) min = v;
        if (v > max) max = v;
      }
      const range = max - min || 1;
      for (let i = 0; i < n; i++) {
        if (isNoData[i]) { out[i] = 0; continue; }
        out[i] = Math.round(Math.max(0, Math.min(255, ((band[i] - min) / range) * 255)));
      }
    }
    normBands.push(out);
  }

  // Pixels RGB(0,0,0) sem NoData definido → transparentes (bordas pretas típicas)
  if (noDataVal === null && nSamples >= 3) {
    for (let i = 0; i < n; i++) {
      if (normBands[0][i] === 0 && normBands[1][i] === 0 && normBands[2][i] === 0) {
        isNoData[i] = 1;
      }
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const imgData = ctx.createImageData(w, h);

  for (let i = 0; i < n; i++) {
    if (isNoData[i]) { imgData.data[i * 4 + 3] = 0; continue; }
    if (nSamples >= 3) {
      imgData.data[i * 4]     = normBands[0][i];
      imgData.data[i * 4 + 1] = normBands[1][i];
      imgData.data[i * 4 + 2] = normBands[2][i];
      imgData.data[i * 4 + 3] = nSamples >= 4 ? normBands[3][i] : 255;
    } else {
      const v = normBands[0][i];
      imgData.data[i * 4] = v; imgData.data[i * 4 + 1] = v; imgData.data[i * 4 + 2] = v;
      imgData.data[i * 4 + 3] = 255;
    }
  }

  ctx.putImageData(imgData, 0, 0);
  const dataUrl = canvas.toDataURL('image/png');
  return { dataUrl, bounds };
}

/** Converte um GeoTIFF (via URL) em data-URL PNG. Usa cache. */
export async function tiffUrlToDataUrl(url: string): Promise<string> {
  if (dataUrlCache.has(url)) return dataUrlCache.get(url)!;
  const resp = await fetch(url);
  const buf = await resp.arrayBuffer();
  const { dataUrl } = await renderGeoTiff(buf);
  dataUrlCache.set(url, dataUrl);
  return dataUrl;
}

/** Converte um GeoTIFF (File) em { pngBlob, bounds }. Para upload no admin. */
export async function parseGeoTiffFile(file: File): Promise<{ pngBlob: Blob | null; bounds: BoundsResult }> {
  const buf = await file.arrayBuffer();
  const { dataUrl, bounds } = await renderGeoTiff(buf);
  const resp = await fetch(dataUrl);
  const pngBlob = await resp.blob();
  return { pngBlob, bounds };
}
