/**
 * Web Worker para processamento de imagens de radar.
 * Roda em uma thread separada para não bloquear a UI durante filtros complexos.
 */

// Tipagem básica para OffscreenCanvas (pode variar conforme ambiente)
const _self: any = self;

// --- Helpers de Filtragem de Pixels (Portados de radarImageFilter.ts) ---

function filterPixels(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
    if (a === 0) continue;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const delta = max - min;
    const lightness = Math.round((max + min) / 2);
    if (delta < 20 && lightness > 60) {
      data[i + 3] = 0;
    }
  }
}

function filterClimatempoPixels(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
    if (a === 0) continue;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const delta = max - min;
    if (delta < 60) {
      data[i + 3] = 0;
      continue;
    }
    if (r > 130 && r < 210 && g > 110 && g < 190 && b < 100) {
      data[i + 3] = 0;
      continue;
    }
    if (r < 100 && g < 120 && b < 120 && delta < 80) {
      data[i + 3] = 0;
      continue;
    }
  }
}

// ... (Outras funções auxiliares de Super Res portadas conforme necessário)

self.onmessage = async (e: MessageEvent) => {
  const { imageUrl, type, product, chromaDelta, cropConfig } = e.data;

  try {
    const res = await fetch(imageUrl);
    if (!res.ok) throw new Error('Fetch failed');
    const blob = await res.blob();
    const bitmap = await createImageBitmap(blob);

    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canto get context');

    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();

    // Recorte de legendas se houver
    if (cropConfig) {
      const { top, bottom, left, right } = cropConfig;
      if (top > 0) ctx.clearRect(0, 0, canvas.width, canvas.height * top);
      if (bottom > 0) ctx.clearRect(0, canvas.height * (1 - bottom), canvas.width, canvas.height * bottom);
      if (left > 0) ctx.clearRect(0, 0, canvas.width * left, canvas.height);
      if (right > 0) ctx.clearRect(canvas.width * (1 - right), 0, canvas.width * right, canvas.height);
    }

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    // Aplicação dos filtros
    if (type === 'climatempo-poa') {
      filterClimatempoPixels(imageData.data);
    } else {
      filterPixels(imageData.data);
    }

    // Chroma Key Dinâmico (Estúdio)
    if (chromaDelta && chromaDelta > 0) {
      for (let i = 0; i < imageData.data.length; i += 4) {
        if (imageData.data[i + 3] === 0) continue;
        const r = imageData.data[i], g = imageData.data[i + 1], b = imageData.data[i + 2];
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        if (max - min < chromaDelta) imageData.data[i + 3] = 0;
      }
    }

    ctx.putImageData(imageData, 0, 0);

    // Converte de volta para Blob para enviar ao Mapa
    const finalBlob = await canvas.convertToBlob({ type: 'image/png' });
    const finalUrl = URL.createObjectURL(finalBlob);

    self.postMessage({ url: finalUrl });
  } catch (err) {
    self.postMessage({ error: 'Worker processing failed' });
  }
};
