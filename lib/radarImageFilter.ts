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
export async function filterRadarImageFromUrl(imageUrl: string): Promise<string | null> {
  try {
    // Tenta fetch direto (funciona se origin permite CORS ou é same-origin)
    let blob: Blob;
    try {
      const res = await fetch(imageUrl, { mode: 'cors', signal: AbortSignal.timeout(8000) });
      if (!res.ok) return null;
      blob = await res.blob();
    } catch {
      // CORS bloqueou — tenta via proxy
      const proxyUrl = `/api/radar-proxy?url=${encodeURIComponent(imageUrl)}`;
      try {
        const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(10000) });
        if (!res.ok) return null;
        blob = await res.blob();
      } catch {
        return null;
      }
    }

    // Criar bitmap a partir do blob
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;

    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    filterPixels(imageData.data);
    ctx.putImageData(imageData, 0, 0);

    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}
