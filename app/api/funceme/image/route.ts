import { NextResponse } from 'next/server';

interface FuncemeResultItem {
  dia: string;       // Ex: "2026/03/23"
  img: string;       // Ex: "PRSF20260323220944GMWR1000SST_openlayer.png"
  datahora: string;  // Ex: "2026-03-23 22:09:44"
}

interface FuncemeResponse {
  data: {
    list: Array<{
      result: FuncemeResultItem[];
      path: string; // Ex: "https://cdn.funceme.br/radar/operadares/GMWR1000SST/plots/prsf/transparente/"
    }>;
  };
}

// Headers obrigatórios — o servidor Funceme exige Origin e Referer do domínio radar.funceme.br
const FUNCEME_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
  'Origin': 'https://radar.funceme.br',
  'Referer': 'https://radar.funceme.br/',
  'Accept': 'application/json, text/plain, */*',
};

// Cache local em memória simples para os JSONs da Funceme
const jsonCache = new Map<string, { fetchTime: number; path: string; items: FuncemeResultItem[] }>();
const CACHE_TTL_MS = 60 * 1000; // 1 min

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const radar = searchParams.get('radar');   // GMWR1000SST ou RMT0100DS
  const timestamp = searchParams.get('timestamp'); // YYYYMMDDHHmm

  if (!radar || !timestamp || timestamp.length !== 12) {
    return new NextResponse('Missing radar or matching 12-char timestamp', { status: 400 });
  }

  const yyyy = timestamp.substring(0, 4);
  const mm = timestamp.substring(4, 6);
  const dd = timestamp.substring(6, 8);
  const HH = timestamp.substring(8, 10);
  const min = timestamp.substring(10, 12);

  const targetDateStr = `${yyyy}-${mm}-${dd}`;
  const targetTimeEpoch = new Date(`${yyyy}-${mm}-${dd}T${HH}:${min}:00Z`).getTime();

  const cacheKey = `${radar}_${targetDateStr}`;
  let path = '';
  let items: FuncemeResultItem[] = [];

  const now = Date.now();
  const cached = jsonCache.get(cacheKey);

  if (cached && now - cached.fetchTime < CACHE_TTL_MS) {
    path = cached.path;
    items = cached.items;
  } else {
    // Buscar da API original — com headers obrigatórios
    const apiUrl = `https://apil5.funceme.br/rpc/v1/produto-gerado?radar=${radar}&produto=prsf&tempo=20&data=${targetDateStr}&cache=no`;

    try {
      const res = await fetch(apiUrl, {
        headers: FUNCEME_HEADERS,
        cache: 'no-store',
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        return new NextResponse(`Funceme API error: ${res.status}`, { status: res.status });
      }
      const json = await res.json() as FuncemeResponse;

      if (!json?.data?.list?.[0]?.result) {
        return new NextResponse('No data available for this date', { status: 404 });
      }

      path = json.data.list[0].path;
      items = json.data.list[0].result;

      // Atualiza cache local
      jsonCache.set(cacheKey, { fetchTime: now, path, items });
    } catch (e: any) {
      return new NextResponse(`Fetch error: ${e.message}`, { status: 500 });
    }
  }

  if (items.length === 0) {
    return new NextResponse('No available frames for this date', { status: 404 });
  }

  // Encontrar o frame mais próximo dentro de +/- 15 min
  let bestItem: FuncemeResultItem | null = null;
  let minDiff = Infinity;

  for (const item of items) {
    const itemEpoch = new Date(item.datahora.replace(' ', 'T') + 'Z').getTime();
    const diff = Math.abs(targetTimeEpoch - itemEpoch);

    if (diff <= 15 * 60 * 1000 && diff < minDiff) {
      minDiff = diff;
      bestItem = item;
    }
  }

  if (!bestItem) {
    return new NextResponse('No frame close enough to the requested timestamp', { status: 404 });
  }

  // Montar URL Final: path + dia + / + img
  // Ex: https://cdn.funceme.br/radar/operadares/GMWR1000SST/plots/prsf/transparente/2026/03/23/PRSF2026...png
  const finalPath = path.endsWith('/') ? path : path + '/';
  const urlFinal = `${finalPath}${bestItem.dia}/${bestItem.img}`;

  // Baixar buffer da CDN e servir no domínio próprio com CORS liberado para o WebGL Canvas
  try {
    const upstream = await fetch(urlFinal, {
      headers: {
        'User-Agent': FUNCEME_HEADERS['User-Agent'],
        'Referer': 'https://radar.funceme.br/',
      },
      cache: 'no-store',
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });

    if (!upstream.ok) {
      return new NextResponse(`Erro Funceme CDN: ${upstream.status} para ${urlFinal}`, { status: 502 });
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
    return new NextResponse(`Funceme PNG fetch failed: ${err.message}`, { status: 502 });
  }
}
