export interface SoundingPoint {
  height: number;
  u: number;
  v: number;
}

export function calculateUV(speed: number, direction: number) {
  // Converte direção para radianos e inverte para convenção matemática
  // 'direction' é de onde o vento VEM (orientação meteorológica)
  const rad = direction * (Math.PI / 180);
  const u = -speed * Math.sin(rad);
  const v = -speed * Math.cos(rad);
  return { u, v };
}

export function processCSVContent(csvContent: string) {
  const lines = csvContent.split(/\r?\n/).filter(line => line.trim() !== '');
  if (lines.length < 2) return { error: 'CSV muito curto ou vazio' };

  // Detecta delimitador (vírgula ou ponto e vírgula)
  const firstLine = lines[0];
  const delimiter = firstLine.includes(';') ? ';' : ',';
  
  const headers = firstLine.split(delimiter).map(h => h.toLowerCase().trim());
  
  // Identifica colunas
  const heightIdx = headers.findIndex(h => h.includes('height') || h.includes('hagl') || h.includes('alt') || h === 'h');
  const speedIdx = headers.findIndex(h => h.includes('speed') || h.includes('wspd') || h.includes('vel') || h.includes('knots') || h === 'sknt');
  const dirIdx = headers.findIndex(h => h.includes('dir') || h.includes('wdir') || h.includes('rumbo') || h === 'drct');
  const uIdx = headers.findIndex(h => h === 'u');
  const vIdx = headers.findIndex(h => h === 'v');

  if (heightIdx === -1) return { error: 'Coluna de altura não encontrada' };

  const rawDataPoints: { rawHeight: number; u: number; v: number }[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(delimiter).map(v => v.trim());
    if (values.length < headers.length) continue;

    const rawH = parseFloat(values[heightIdx]);
    if (isNaN(rawH)) continue;

    let u = 0, v = 0;

    if (uIdx !== -1 && vIdx !== -1) {
      u = parseFloat(values[uIdx]);
      v = parseFloat(values[vIdx]);
    } else if (speedIdx !== -1 && dirIdx !== -1) {
      const speed = parseFloat(values[speedIdx]);
      const direction = parseFloat(values[dirIdx]);
      if (isNaN(speed) || isNaN(direction)) continue;
      const uv = calculateUV(speed, direction);
      u = uv.u;
      v = uv.v;
    } else {
      return { error: 'Colunas de vento não encontradas' };
    }

    rawDataPoints.push({ rawHeight: rawH, u, v });
  }

  if (rawDataPoints.length === 0) return { error: 'Nenhum dado válido encontrado' };

  // Ordena por altura absoluta
  rawDataPoints.sort((a, b) => a.rawHeight - b.rawHeight);

  // Calcula a altura relativa: o primeiro ponto (mais baixo) passa a ser 0.
  const baseHeight = rawDataPoints[0].rawHeight;
  const dataPoints: SoundingPoint[] = rawDataPoints.map(p => ({
    height: p.rawHeight - baseHeight,
    u: p.u,
    v: p.v
  }));

  return { success: true, data: dataPoints };
}

/**
 * Interpola U e V para uma altura específica
 */
export function interpolateSounding(points: SoundingPoint[], targetHeight: number): { u: number, v: number } | null {
  if (points.length < 2) return null;
  
  // Fora do intervalo
  if (targetHeight < points[0].height || targetHeight > points[points.length - 1].height) {
    // Extrapolação simples para 0m se estiver perto
    if (targetHeight < points[0].height && targetHeight >= 0) {
        return { u: points[0].u, v: points[0].v };
    }
    return null;
  }

  // Encontra os dois pontos vizinhos
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i+1];
    
    if (targetHeight >= p1.height && targetHeight <= p2.height) {
      const fraction = (targetHeight - p1.height) / (p2.height - p1.height);
      const u = p1.u + (p2.u - p1.u) * fraction;
      const v = p1.v + (p2.v - p1.v) * fraction;
      return { u, v };
    }
  }

  return null;
}
