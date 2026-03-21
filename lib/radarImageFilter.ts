/**
 * Filtro de ruído para imagens de radar meteorológico.
 * Remove pixels brancos/cinza (ground clutter, ruído) tornando-os transparentes.
 * Mantém pixels coloridos (dados meteorológicos reais).
 *
 * Usa fetch + createImageBitmap para evitar problemas de CORS com Canvas.
 * Caso a fetch falhe (CORS), faz fallback re-buscando a imagem pelo proxy.
 */

/**
 * Processa pixel data para remover ruído branco/cinza.
 * Pixels com baixa saturação e alto brilho são tornados transparentes.
 */
function filterPixels(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];

    if (a === 0) continue;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    const lightness = Math.round((max + min) / 2);

    // Se a diferença (delta) entre a cor mais forte e mais fraca for baixa (menos de 20),
    // significa que é um tom de cinza, branco ou preto, pois não tem saturação de cor dominante.
    // Se, além disso, não for muito escuro (lightness > 60), é o ruído branco/cinza do radar.
    if (delta < 20 && lightness > 60) {
      data[i + 3] = 0; // Torna o pixel de ruído 100% transparente
    }
  }
}

/**
 * Aplica filtro de ruído numa imagem de radar.
 * Faz fetch da URL com CORS, processa via Canvas, retorna data URL.
 * Se CORS falhar, tenta via proxy.
 *
 * @param imageUrl - URL da imagem (já carregada no overlay)
 * @returns Data URL filtrada, ou null se falhar
 */
export async function filterRadarImageFromUrl(
  imageUrl: string,
  chromaDelta?: number,
  cropConfig?: { top: number; bottom: number; left: number; right: number }
): Promise<string | null> {
  try {
    let blob: Blob;
    try {
      const res = await fetch(imageUrl, { mode: 'cors', signal: AbortSignal.timeout(8000) });
      if (!res.ok) return null;
      blob = await res.blob();
    } catch {
      const proxyUrl = `/api/radar-proxy?url=${encodeURIComponent(imageUrl)}`;
      try {
        const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(10000) });
        if (!res.ok) return null;
        blob = await res.blob();
      } catch {
        return null;
      }
    }

    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;

    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();

    if (cropConfig) {
      if (cropConfig.top > 0) ctx.clearRect(0, 0, canvas.width, canvas.height * cropConfig.top);
      if (cropConfig.bottom > 0) ctx.clearRect(0, canvas.height * (1 - cropConfig.bottom), canvas.width, canvas.height * cropConfig.bottom);
      if (cropConfig.left > 0) ctx.clearRect(0, 0, canvas.width * cropConfig.left, canvas.height);
      if (cropConfig.right > 0) ctx.clearRect(canvas.width * (1 - cropConfig.right), 0, canvas.width * cropConfig.right, canvas.height);
    }

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    
    if (chromaDelta && chromaDelta > 0) {
      for (let i = 0; i < imageData.data.length; i += 4) {
        if (imageData.data[i + 3] === 0) continue;
        const r = imageData.data[i], g = imageData.data[i + 1], b = imageData.data[i + 2];
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        if (max - min < chromaDelta) {
          imageData.data[i + 3] = 0;
        } else {
           if (r > 130 && r < 210 && g > 110 && g < 190 && b < 100) { imageData.data[i+3] = 0; }
           if (r < 100 && g < 120 && b < 120 && (max-min) < 80) { imageData.data[i+3] = 0; }
        }
      }
    } else {
      filterPixels(imageData.data);
    }
    
    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

/**
 * Processa pixels específicos do radar da Climatempo (Porto Alegre).
 * Remove terra (bege), oceano (azul), bordas (preto) e fundo branco.
 * Usa lógica de Saturação (Delta) rigorosa, preservando apenas as cores puras e intensas (neon) das tempestades.
 */
function filterClimatempoPixels(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];

    if (a === 0) continue;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;

    // Se a cor for muito lavada, cinza, branca, preta, bege, ou azul claro, o Delta será baixo.
    // Chuvas são representadas pelas cores RGB quase puras (Ciano, Verde Limão, Amarelo, Vermelho, Magenta) cujo Delta de saturação passa de 100.
    if (delta < 60) {
      data[i + 3] = 0;
      continue;
    }

    // Filtra as linhas de municípios (que são um amarelo queimado/mostarda ou marrom)
    // Mostarda/Marrom costuma ter R alto, G alto, mas B baixo.
    if (r > 130 && r < 210 && g > 110 && g < 190 && b < 100) {
      data[i + 3] = 0;
      continue;
    }
    
    // Filtro para o azul escuro/cinza esverdeado das rodovias
    if (r < 100 && g < 120 && b < 120 && delta < 80) {
      data[i + 3] = 0;
      continue;
    }
  }
}

/**
 * Aplica filtro de fundo (Chroma Key de terrenos) e recorta legendas
 * especificamente para as imagens da Climatempo POA.
 */
export async function filterClimatempoRadarImage(
  imageUrl: string,
  chromaDelta?: number,
  cropConfig?: { top: number; bottom: number; left: number; right: number }
): Promise<string | null> {
  try {
    let blob: Blob;
    try {
      const res = await fetch(imageUrl, { mode: 'cors', signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error('CORS fail');
      blob = await res.blob();
    } catch {
      const proxyUrl = `/api/radar-proxy?url=${encodeURIComponent(imageUrl)}`;
      const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) return null;
      blob = await res.blob();
    }

    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;

    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();

    if (cropConfig) {
      if (cropConfig.top > 0) ctx.clearRect(0, 0, canvas.width, canvas.height * cropConfig.top);
      if (cropConfig.bottom > 0) ctx.clearRect(0, canvas.height * (1 - cropConfig.bottom), canvas.width, canvas.height * cropConfig.bottom);
      if (cropConfig.left > 0) ctx.clearRect(0, 0, canvas.width * cropConfig.left, canvas.height);
      if (cropConfig.right > 0) ctx.clearRect(canvas.width * (1 - cropConfig.right), 0, canvas.width * cropConfig.right, canvas.height);
    } else {
      // Padrões hardcoded Climatempo se não houver override via Estúdio
      const bw = 2;
      ctx.clearRect(0, 0, canvas.width, bw);
      ctx.clearRect(0, canvas.height - bw, canvas.width, bw);
      ctx.clearRect(0, 0, bw, canvas.height);
      ctx.clearRect(canvas.width - bw, 0, bw, canvas.height);
      ctx.clearRect(canvas.width * 0.6, canvas.height * 0.75, canvas.width * 0.4, canvas.height * 0.25);
      ctx.clearRect(0, 0, canvas.width * 0.4, canvas.height * 0.1);
    }

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    
    if (chromaDelta && chromaDelta > 0) {
      for (let i = 0; i < imageData.data.length; i += 4) {
        if (imageData.data[i + 3] === 0) continue;
        const r = imageData.data[i], g = imageData.data[i + 1], b = imageData.data[i + 2];
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        if (max - min < chromaDelta) {
          imageData.data[i + 3] = 0;
        } else {
           if (r > 130 && r < 210 && g > 110 && g < 190 && b < 100) { imageData.data[i+3] = 0; }
           if (r < 100 && g < 120 && b < 120 && (max-min) < 80) { imageData.data[i+3] = 0; }
        }
      }
    } else {
      filterClimatempoPixels(imageData.data);
    }
    
    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}
