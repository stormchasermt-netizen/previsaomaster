import { NextRequest, NextResponse } from 'next/server';

interface SoundingPoint {
  height: number;
  u: number;
  v: number;
}

function calculateUV(speed: number, direction: number) {
  // Converte direção para radianos e inverte para convenção matemática
  // 'direction' é de onde o vento VEM (orientação meteorológica)
  const rad = direction * (Math.PI / 180);
  const u = -speed * Math.sin(rad);
  const v = -speed * Math.cos(rad);
  return { u, v };
}

function processCSVContent(csvContent: string) {
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

  const dataPoints: SoundingPoint[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(delimiter).map(v => v.trim());
    if (values.length < headers.length) continue;

    const h = parseFloat(values[heightIdx]);
    if (isNaN(h)) continue;

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

    dataPoints.push({ height: h, u, v });
  }

  // Ordena por altura
  dataPoints.sort((a, b) => a.height - b.height);

  return { success: true, data: dataPoints };
}

export async function POST(req: NextRequest) {
  try {
    const { csvUrl } = await req.json();

    if (!csvUrl) {
      return NextResponse.json({ error: 'URL do CSV não fornecida' }, { status: 400 });
    }

    // 1. Baixar o CSV
    const response = await fetch(csvUrl);
    if (!response.ok) {
      return NextResponse.json({ error: 'Falha ao baixar o CSV do Storage' }, { status: 500 });
    }
    const csvContent = await response.text();

    // 2. Processar nativamente
    const result = processCSVContent(csvContent);

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json(result);

  } catch (err: any) {
    console.error('API Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
