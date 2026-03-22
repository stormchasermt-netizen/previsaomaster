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
 * Estágio 3 — Filtro Bilateral.
 * Suaviza a imagem sem borrar bordas de alto contraste (como couplets).
 * sigmaSpace: alcance espacial do desfoque.
 * sigmaColor: quanta diferença de cor é necessária para "borrar" o pixel.
 */
function applyBilateralFilter(data: Uint8ClampedArray, w: number, h: number, sigmaSpace: number, sigmaColor: number): void {
  const copy = new Uint8ClampedArray(data);
  const radius = Math.round(sigmaSpace * 1.5);
  const spaceCoeff = -0.5 / (sigmaSpace * sigmaSpace);
  const colorCoeff = -0.5 / (sigmaColor * sigmaColor);

  for (let y = radius; y < h - radius; y++) {
    for (let x = radius; x < w - radius; x++) {
      const ci = (y * w + x) * 4;
      if (copy[ci + 3] === 0) continue;

      const r0 = copy[ci], g0 = copy[ci + 1], b0 = copy[ci + 2];
      let norm = 0;
      let rSum = 0, gSum = 0, bSum = 0;

      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const ni = ((y + dy) * w + (x + dx)) * 4;
          if (copy[ni + 3] === 0) continue;

          const r1 = copy[ni], g1 = copy[ni+1], b1 = copy[ni+2];
          
          // Distância espacial ao quadrado
          const distSq = dx * dx + dy * dy;
          // Diferença de cor ao quadrado (Euclidiana no espaço RGB)
          const colorDistSq = (r1 - r0)*(r1 - r0) + (g1 - g0)*(g1 - g0) + (b1 - b0)*(b1 - b0);
          
          const weight = Math.exp(distSq * spaceCoeff + colorDistSq * colorCoeff);
          
          rSum += r1 * weight;
          gSum += g1 * weight;
          bSum += b1 * weight;
          norm += weight;
        }
      }

      if (norm > 0) {
        data[ci] = Math.round(rSum / norm);
        data[ci + 1] = Math.round(gSum / norm);
        data[ci + 2] = Math.round(bSum / norm);
      }
    }
  }
}

/**
 * Estágio 4 — Protetor de Couplet.
 * Detecta áreas de alto cisalhamento (verde tocando vermelho).
 * Retorna uma máscara de pixels que NÃO devem ser filtrados/suavizados.
 */
function getCoupletMask(data: Uint8ClampedArray, w: number, h: number): Uint8Array {
  const mask = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      if (data[i + 3] === 0) continue;

      const r = data[i], g = data[i + 1], b = data[i + 2];
      const isGreen = g > r && g > b;
      const isRed = r > g && r > b;

      if (!isGreen && !isRed) continue;

      let foundOpposite = false;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const ni = ((y + dy) * w + (x + dx)) * 4;
          if (data[ni + 3] === 0) continue;
          const nr = data[ni], ng = data[ni+1], nb = data[ni+2];
          const nIsGreen = ng > nr && ng > nb;
          const nIsRed = nr > ng && nr > nb;

          if ((isGreen && nIsRed) || (isRed && nIsGreen)) {
            foundOpposite = true;
            break;
          }
        }
        if (foundOpposite) break;
      }

      if (foundOpposite) {
        mask[y * w + x] = 1;
      }
    }
  }
  return mask;
}

/**
 * Estágio 3.5 — Filtro de Preenchimento (Hole Filling).
 * Se um pixel for transparente (buraco) mas estiver cercado por muitos pixels coloridos,
 * nós o restauramos com a cor média dos vizinhos para fechar buracos dentro das tempestades.
 */
function applyHoleFilling(data: Uint8ClampedArray, w: number, h: number): void {
  const copy = new Uint8ClampedArray(data);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const ci = (y * w + x) * 4;
      if (copy[ci + 3] > 0) continue;

      let colorNeighbors = 0;
      let rSum = 0, gSum = 0, bSum = 0;
      
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (dx === 0 && dy === 0) continue;
          const ny = y + dy;
          const nx = x + dx;
          if (ny < 0 || nx < 0 || ny >= h || nx >= w) continue;
          const ni = (ny * w + nx) * 4;
          if (copy[ni + 3] > 0) {
            colorNeighbors++;
            rSum += copy[ni];
            gSum += copy[ni + 1];
            bSum += copy[ni + 2];
          }
        }
      }
      
      if (colorNeighbors >= 8) {
        data[ci] = Math.round(rSum / colorNeighbors);
        data[ci + 1] = Math.round(gSum / colorNeighbors);
        data[ci + 2] = Math.round(bSum / colorNeighbors);
        data[ci + 3] = 255;
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
    const [velRes, refRes] = await Promise.all([
      fetchImageData(velocityUrl),
      reflectivityUrl ? fetchImageData(reflectivityUrl) : Promise.resolve(null)
    ]);

    if (!velRes) return null;
    const { data: velImgData, width: w, height: h } = velRes;
    const velData = velImgData.data;

    // 1. Remoção de Pequenos Contornos Baseada em Tamanho (Peneira)
    // Remove blobs < 4 pixels (ruído granular isolado)
    applyBlobFilter(velData, w, h, 4);

    // 2. Se houver refletividade, separar Zona A e Zona B para Bilateral inteligente
    if (refRes) {
      const { data: refImgData, width: refW, height: refH } = refRes;
      const refData = refImgData.data;
      const sameSize = w === refW && h === refH;

      const zoneBData = new Uint8ClampedArray(velData);
      const zoneAData = new Uint8ClampedArray(velData);

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const vi = (y * w + x) * 4;
          const rx = sameSize ? x : Math.round((x / w) * refW);
          const ry = sameSize ? y : Math.round((y / h) * refH);
          const ri = (ry * refW + rx) * 4;

          let isZoneB = false;
          if (ri >= 0 && ri + 3 < refData.length && refData[ri + 3] > 0) {
             const rr = refData[ri], rg = refData[ri+1], rb = refData[ri+2];
             const rMax = Math.max(rr, rg, rb);
             const rMin = Math.min(rr, rg, rb);
             if (rMax - rMin > 40 || rr > 180) isZoneB = true;
          }

          if (isZoneB) {
            zoneAData[vi + 3] = 0;
          } else {
            zoneBData[vi + 3] = 0;
          }
        }
      }

      // 3. Aplicar Filtro Bilateral
      // Zona A (Fraca): Filtro Bilateral suave (sigmaColor alto preserva menos, sigmaSpace baixo corre pouco)
      applyBilateralFilter(zoneAData, w, h, 1.5, 45);
      
      // Zona B (Tempestade): Filtro Bilateral preciso (sigmaColor baixo para NÃO borras couplets)
      applyBilateralFilter(zoneBData, w, h, 2.5, 25);

      // Merge das zonas
      for (let i = 0; i < w * h; i++) {
        const vi = i * 4;
        if (zoneBData[vi + 3] > 0) {
            velData[vi] = zoneBData[vi];
            velData[vi + 1] = zoneBData[vi + 1];
            velData[vi + 2] = zoneBData[vi + 2];
        } else if (zoneAData[vi + 3] > 0) {
            velData[vi] = zoneAData[vi];
            velData[vi + 1] = zoneAData[vi + 1];
            velData[vi + 2] = zoneAData[vi + 2];
        }
      }
    } else {
      // Sem refletividade, aplica bilateral padrão equilibrado
      applyBilateralFilter(velData, w, h, 2.0, 30);
    }

    // Hole Filling final para fechar pequenos buracos pontuais
    applyHoleFilling(velData, w, h);

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.putImageData(velImgData, 0, 0);
    return canvas.toDataURL('image/png');
  } catch (err) {
    console.error("Super Res v4 Error:", err);
    return null;
  }
}
