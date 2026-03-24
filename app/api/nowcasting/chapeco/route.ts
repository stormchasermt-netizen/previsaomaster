import { NextResponse } from 'next/server';

interface NowcastingImage {
  url: string;
  horario: number; // epoch ms
}

interface NowcastingProduct {
  produto: string;
  id: string; // Ex: 'R12137761'
  idSubprod: number;
  imagens: NowcastingImage[];
}

// Cache local em memória simples para os JSONs da API Nowcasting
const jsonCache = new Map<string, { fetchTime: number; products: NowcastingProduct[] }>();
const CACHE_TTL_MS = 60 * 1000; // 1 minuto de cache

async function resolveNowcastingImageUrl(request: Request): Promise<{ status: number, url?: string, error?: string }> {
  const { searchParams } = new URL(request.url);
  const radarId = searchParams.get('radarId');
  const timestamp = searchParams.get('timestamp');

  if (!radarId || !timestamp || timestamp.length !== 12) {
    return { status: 400, error: 'Missing radarId or matching 12-char timestamp' };
  }

  const yyyy = timestamp.substring(0, 4);
  const mm = timestamp.substring(4, 6);
  const dd = timestamp.substring(6, 8);
  const HH = timestamp.substring(8, 10);
  const min = timestamp.substring(10, 12);
  const targetTimeEpoch = new Date(`${yyyy}-${mm}-${dd}T${HH}:${min}:00Z`).getTime();

  if (isNaN(targetTimeEpoch)) {
    return { status: 400, error: 'Invalid timestamp format' };
  }

  const diffHours = (Date.now() - targetTimeEpoch) / (1000 * 60 * 60);
  // A API Nowcasting (tempo real) só suporta os últimos ~400 frames (aprox 40 horas).
  // Requisições para histórico mais antigo do que 48h recusam imediatamente para poupar a API e evitar lentidão.
  if (diffHours > 48 || diffHours < -5) {
    return { status: 404, error: 'Historical frames not available in Nowcasting API' };
  }

  let products: NowcastingProduct[] = [];
  const now = Date.now();
  const cacheKey = 'chapeco_all'; 

  const cached = jsonCache.get(cacheKey);

  if (cached && now - cached.fetchTime < CACHE_TTL_MS) {
    products = cached.products;
  } else {
    // Busca até 40 horas de histórico (400 frames x 6 min = 40h)
    const apiUrl = `https://nowcasting.cptec.inpe.br/api/camadas/radar/2247/imagens?quantidade=400&nome=Chapecó`;

    try {
      const res = await fetch(apiUrl, { next: { revalidate: 0 } });
      if (!res.ok) {
        return { status: res.status, error: `Nowcasting API error: ${res.status}` };
      }
      products = await res.json() as NowcastingProduct[];
      jsonCache.set(cacheKey, { fetchTime: now, products });
    } catch (e: any) {
      return { status: 500, error: `Fetch error: ${e.message}` };
    }
  }

  // Find the specific product requested (reflectividade, velocidade, etc)
  const productData = products.find(p => p.id === radarId);
  if (!productData || !productData.imagens || productData.imagens.length === 0) {
    return { status: 404, error: 'Product not found or no images available' };
  }

  let bestItem: NowcastingImage | null = null;
  let minDiff = Infinity;

  // Busca a imagem mais próxima dentro de uma janela de +/- 15 minutos
  for (const item of productData.imagens) {
    const diff = Math.abs(targetTimeEpoch - item.horario);
    
    if (diff <= 15 * 60 * 1000) {
      if (diff < minDiff) {
        minDiff = diff;
        bestItem = item;
      }
    }
  }

  if (!bestItem) {
    return { status: 404, error: 'No frame close enough to the requested timestamp' };
  }

  // Previne problemas de Mixed Content convertendo HTTP nativo para HTTPS
  const finalUrl = bestItem.url.replace('http://', 'https://');
  return { status: 200, url: finalUrl };
}

export async function HEAD(request: Request) {
  const result = await resolveNowcastingImageUrl(request);
  if (result.status !== 200 || !result.url) {
    return new NextResponse(result.error || 'Not found', { status: result.status });
  }

  try {
    const upstream = await fetch(result.url, {
      method: 'HEAD',
      cache: 'no-store',
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
    });

    if (!upstream.ok) {
      return new NextResponse(`Erro CPTEC CDN: ${upstream.status}`, { status: 502 });
    }

    const contentType = upstream.headers.get('content-type') ?? 'image/png';
    return new NextResponse(null, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=300',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err: any) {
    return new NextResponse(`CPTEC HEAD fetch failed: ${err.message}`, { status: 502 });
  }
}

export async function GET(request: Request) {
  const result = await resolveNowcastingImageUrl(request);
  if (result.status !== 200 || !result.url) {
    return new NextResponse(result.error || 'Not found', { status: result.status });
  }

  try {
    const upstream = await fetch(result.url, {
      cache: 'no-store',
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });

    if (!upstream.ok) {
      return new NextResponse(`Erro CPTEC CDN: ${upstream.status}`, { status: 502 });
    }

    const contentType = upstream.headers.get('content-type') ?? 'image/png';
    const body = await upstream.arrayBuffer();

    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=300',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err: any) {
    return new NextResponse(`CPTEC PNG fetch failed: ${err.message}`, { status: 502 });
  }
}
