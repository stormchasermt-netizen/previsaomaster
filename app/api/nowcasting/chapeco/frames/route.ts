import { NextResponse } from 'next/server';

interface NowcastingImage {
  url: string;
  horario: number; // epoch ms
}

interface NowcastingProduct {
  produto: string;
  id: string;
  imagens: NowcastingImage[];
}

const jsonCache = new Map<string, { fetchTime: number; products: NowcastingProduct[] }>();
const CACHE_TTL_MS = 60 * 1000;

/**
 * GET /api/nowcasting/chapeco/frames?radarId=R12137761
 * Retorna a lista de timestamps (ts12 UTC) disponíveis para este produto de Chapecó.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const radarId = searchParams.get('radarId');

  if (!radarId) {
    return NextResponse.json({ error: 'Missing radarId' }, { status: 400 });
  }

  let products: NowcastingProduct[] = [];
  const now = Date.now();
  const cacheKey = 'chapeco_all';
  const cached = jsonCache.get(cacheKey);

  if (cached && now - cached.fetchTime < CACHE_TTL_MS) {
    products = cached.products;
  } else {
    const encodedName = encodeURIComponent('Chapecó');
    const apiUrl = `https://nowcasting.cptec.inpe.br/api/camadas/radar/2247/imagens?quantidade=400&nome=${encodedName}`;

    try {
      const res = await fetch(apiUrl, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
      if (!res.ok) {
        return NextResponse.json({ error: `Nowcasting API error: ${res.status}` }, { status: res.status });
      }
      products = await res.json() as NowcastingProduct[];
      jsonCache.set(cacheKey, { fetchTime: now, products });
    } catch (e: any) {
      return NextResponse.json({ error: e.message }, { status: 500 });
    }
  }

  const productData = products.find(p => p.id === radarId);
  if (!productData || !productData.imagens || productData.imagens.length === 0) {
    return NextResponse.json({ frames: [] });
  }

  // Converter epoch ms -> ts12 UTC
  const frames = productData.imagens.map(img => {
    const d = new Date(img.horario);
    const ts12 = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}`;
    const datahora = d.toISOString().replace('T', ' ').substring(0, 19);
    return { ts12, datahora };
  }).reverse(); // Mais antigo primeiro

  return NextResponse.json({ frames }, {
    headers: { 'Cache-Control': 'public, max-age=60', 'Access-Control-Allow-Origin': '*' },
  });
}
