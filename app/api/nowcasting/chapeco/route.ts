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

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const radarId = searchParams.get('radarId');
  const timestamp = searchParams.get('timestamp');

  if (!radarId || !timestamp || timestamp.length !== 12) {
    return new NextResponse('Missing radarId or matching 12-char timestamp', { status: 400 });
  }

  const yyyy = timestamp.substring(0, 4);
  const mm = timestamp.substring(4, 6);
  const dd = timestamp.substring(6, 8);
  const HH = timestamp.substring(8, 10);
  const min = timestamp.substring(10, 12);
  const targetTimeEpoch = new Date(`${yyyy}-${mm}-${dd}T${HH}:${min}:00Z`).getTime();

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
        return new NextResponse(`Nowcasting API error: ${res.status}`, { status: res.status });
      }
      products = await res.json() as NowcastingProduct[];
      jsonCache.set(cacheKey, { fetchTime: now, products });
    } catch (e: any) {
      return new NextResponse(`Fetch error: ${e.message}`, { status: 500 });
    }
  }

  // Find the specific product requested (reflectividade, velocidade, etc)
  const productData = products.find(p => p.id === radarId);
  if (!productData || !productData.imagens || productData.imagens.length === 0) {
    return new NextResponse('Product not found or no images available', { status: 404 });
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
    return new NextResponse('No frame close enough to the requested timestamp', { status: 404 });
  }

  // Previne problemas de Mixed Content convertendo HTTP nativo para HTTPS
  const finalUrl = bestItem.url.replace('http://', 'https://');

  return NextResponse.redirect(finalUrl, { status: 302 });
}
