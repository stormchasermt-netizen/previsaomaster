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

// ============================================================
// SUPER RES — Pipeline de 3 estágios para Doppler (velocidade)
// ============================================================

/** Helper: busca imagem como ImageData, com fallback via proxy. */
async function fetchImageData(url: string): Promise<{ data: ImageData; width: number; height: number } | null> {
  try {
    let blob: Blob;
    try {
      const res = await fetch(url, { mode: 'cors', signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error('fail');
      blob = await res.blob();
    } catch {
      const proxyUrl = `/api/radar-proxy?url=${encodeURIComponent(url)}`;
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
    return { data: ctx.getImageData(0, 0, canvas.width, canvas.height), width: canvas.width, height: canvas.height };
  } catch {
    return null;
  }
}

/**
 * Estágio 1 — Máscara de Refletividade.
 * Apaga pixels de velocidade onde a reflectividade correspondente é fraca ou ausente.
 * Critério: se o pixel na refletividade for transparente OU tiver
 * um delta de saturação menor que 15 (cinza/branco/preto = sem eco meteorológico),
 * o pixel correspondente na velocidade vira transparente.
 */
function applyReflectivityMask(velData: Uint8ClampedArray, refData: Uint8ClampedArray, w: number, h: number, refW: number, refH: number): void {
  const sameSize = w === refW && h === refH;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const vi = (y * w + x) * 4;
      if (velData[vi + 3] === 0) continue;

      // Mapear coordenadas se os tamanhos forem diferentes
      const rx = sameSize ? x : Math.round((x / w) * refW);
      const ry = sameSize ? y : Math.round((y / h) * refH);
      const ri = (ry * refW + rx) * 4;

      // Se fora dos limites da refletividade, apagar
      if (ri < 0 || ri + 3 >= refData.length) {
        velData[vi + 3] = 0;
        continue;
      }

      const ra = refData[ri + 3];
      if (ra === 0) {
        velData[vi + 3] = 0;
        continue;
      }

      // Reflectividade presente mas muito lavada (cinza/branco) = sem eco real
      const rr = refData[ri], rg = refData[ri + 1], rb = refData[ri + 2];
      const rMax = Math.max(rr, rg, rb);
      const rMin = Math.min(rr, rg, rb);
      if (rMax - rMin < 15 && ((rr + rg + rb) / 3) > 60) {
        velData[vi + 3] = 0;
      }
    }
  }
}

/**
 * Estágio 2 — Blob Filter (Componentes Conexos).
 * Remove clusters de pixels coloridos com área menor que minSize.
 * Usa flood-fill 4-conexo para agrupar pixels vizinhos.
 */
function applyBlobFilter(data: Uint8ClampedArray, w: number, h: number, minSize: number = 5): void {
  const visited = new Uint8Array(w * h);
  const stack: number[] = [];

  for (let startIdx = 0; startIdx < w * h; startIdx++) {
    if (visited[startIdx] || data[startIdx * 4 + 3] === 0) continue;

    // Flood fill para encontrar o cluster
    const cluster: number[] = [];
    stack.length = 0;
    stack.push(startIdx);
    visited[startIdx] = 1;

    while (stack.length > 0) {
      const idx = stack.pop()!;
      cluster.push(idx);
      const cx = idx % w;
      const cy = (idx - cx) / w;

      // 4-conexo: cima, baixo, esquerda, direita
      const neighbors = [
        cy > 0 ? idx - w : -1,
        cy < h - 1 ? idx + w : -1,
        cx > 0 ? idx - 1 : -1,
        cx < w - 1 ? idx + 1 : -1,
      ];

      for (const ni of neighbors) {
        if (ni < 0 || visited[ni] || data[ni * 4 + 3] === 0) continue;
        visited[ni] = 1;
        stack.push(ni);
      }
    }

    // Se cluster for pequeno demais, apagar
    if (cluster.length < minSize) {
      for (const idx of cluster) {
        data[idx * 4 + 3] = 0;
      }
    }
  }
}

/**
 * Estágio 3 — Filtro de Moda Local.
 * Para cada pixel colorido, olha os 8 vizinhos.
 * Se o pixel central for outlier (cor totalmente diferente da maioria), substitui pela moda.
 * "Cor" é quantizada em buckets de 32 para evitar comparações exatas impossíveis.
 */
function applyLocalModeFilter(data: Uint8ClampedArray, w: number, h: number): void {
  // Trabalha numa cópia para não contaminar leituras
  const copy = new Uint8ClampedArray(data);

  const quantize = (r: number, g: number, b: number): number => {
    return ((r >> 5) << 10) | ((g >> 5) << 5) | (b >> 5);
  };

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const ci = (y * w + x) * 4;
      if (copy[ci + 3] === 0) continue;

      const centerQ = quantize(copy[ci], copy[ci + 1], copy[ci + 2]);

      // Contar cores dos 8 vizinhos
      const colorCounts = new Map<number, { count: number; r: number; g: number; b: number }>();
      let totalNeighbors = 0;

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const ni = ((y + dy) * w + (x + dx)) * 4;
          if (copy[ni + 3] === 0) continue;
          totalNeighbors++;
          const q = quantize(copy[ni], copy[ni + 1], copy[ni + 2]);
          const existing = colorCounts.get(q);
          if (existing) {
            existing.count++;
          } else {
            colorCounts.set(q, { count: 1, r: copy[ni], g: copy[ni + 1], b: copy[ni + 2] });
          }
        }
      }

      if (totalNeighbors < 3) continue; // Poucos vizinhos, não filtra

      // Encontrar a moda (cor mais frequente entre vizinhos)
      let modeQ = centerQ;
      let modeCount = 0;
      let modeR = copy[ci], modeG = copy[ci + 1], modeB = copy[ci + 2];

      colorCounts.forEach((info, q) => {
        if (info.count > modeCount) {
          modeCount = info.count;
          modeQ = q;
          modeR = info.r;
          modeG = info.g;
          modeB = info.b;
        }
      });

      // Se o pixel central é diferente da moda e a moda domina (≥3 vizinhos), substituir
      if (centerQ !== modeQ && modeCount >= 3) {
        data[ci] = modeR;
        data[ci + 1] = modeG;
        data[ci + 2] = modeB;
      }
    }
  }
}

/**
 * SUPER RES — Pipeline completo de limpeza para imagens Doppler (velocidade radial).
 *
 * @param velocityUrl URL da imagem de velocidade (ppivr)
 * @param reflectivityUrl URL da imagem de reflectividade (ppicz) do mesmo radar/timestamp (opcional)
 * @returns Data URL filtrada, ou null se falhar
 */
export async function filterDopplerSuperRes(
  velocityUrl: string,
  reflectivityUrl?: string | null
): Promise<string | null> {
  try {
    const velResult = await fetchImageData(velocityUrl);
    if (!velResult) return null;

    const { data: velImgData, width: w, height: h } = velResult;
    const velData = velImgData.data;

    // Primeiro: remover ruído branco/cinza básico (mesma lógica do filtro normal)
    filterPixels(velData);

    // Estágio 1: Máscara de Refletividade (se disponível)
    if (reflectivityUrl) {
      const refResult = await fetchImageData(reflectivityUrl);
      if (refResult) {
        applyReflectivityMask(velData, refResult.data.data, w, h, refResult.width, refResult.height);
      }
    }

    // Estágio 2: Blob Filter — remove clusters isolados < 5 pixels
    applyBlobFilter(velData, w, h, 5);

    // Estágio 3: Filtro de Moda Local — corrige outliers internos
    applyLocalModeFilter(velData, w, h);

    // Renderizar resultado
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.putImageData(velImgData, 0, 0);
    return canvas.toDataURL('image/png');
  } catch (e) {
    console.error('Super Res filter error:', e);
    return null;
  }
}
