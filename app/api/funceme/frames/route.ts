import { NextResponse } from 'next/server';

interface FuncemeResultItem {
  dia: string;
  img: string;
  datahora: string;
}

interface FuncemeResponse {
  data: {
    list: Array<{
      result: FuncemeResultItem[];
      path: string;
    }>;
  };
}

const FUNCEME_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
  'Origin': 'https://radar.funceme.br',
  'Referer': 'https://radar.funceme.br/',
  'Accept': 'application/json, text/plain, */*',
};

// Cache local em memória
const jsonCache = new Map<string, { fetchTime: number; frames: { ts12: string; datahora: string }[] }>();
const CACHE_TTL_MS = 60 * 1000;

/**
 * GET /api/funceme/frames?radar=GMWR1000SST&date=2026-03-23
 * Retorna a lista de timestamps (ts12 UTC) disponíveis para este radar neste dia.
 * O frontend usa essa lista para alimentar o slider com horários reais.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const radar = searchParams.get('radar');
  const date = searchParams.get('date'); // YYYY-MM-DD

  if (!radar || !date) {
    return NextResponse.json({ error: 'Missing radar or date' }, { status: 400 });
  }

  const cacheKey = `frames_${radar}_${date}`;
  const now = Date.now();
  const cached = jsonCache.get(cacheKey);

  if (cached && now - cached.fetchTime < CACHE_TTL_MS) {
    return NextResponse.json({ frames: cached.frames }, {
      headers: { 'Cache-Control': 'public, max-age=60', 'Access-Control-Allow-Origin': '*' },
    });
  }

  const apiUrl = `https://apil5.funceme.br/rpc/v1/produto-gerado?radar=${radar}&produto=prsf&tempo=20&data=${date}&cache=no`;

  try {
    const res = await fetch(apiUrl, {
      headers: FUNCEME_HEADERS,
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      return NextResponse.json({ error: `Funceme API error: ${res.status}` }, { status: res.status });
    }
    const json = await res.json() as FuncemeResponse;

    if (!json?.data?.list?.[0]?.result) {
      return NextResponse.json({ frames: [] });
    }

    const items = json.data.list[0].result;

    // Converter datahora "2026-03-23 22:09:44" -> ts12 "202603232209"
    const frames = items.map(item => {
      const dt = item.datahora.replace(/-/g, '').replace(' ', '').substring(0, 12);
      return { ts12: dt, datahora: item.datahora };
    }).reverse(); // Mais antigo primeiro, mais recente por último

    jsonCache.set(cacheKey, { fetchTime: now, frames });

    return NextResponse.json({ frames }, {
      headers: { 'Cache-Control': 'public, max-age=60', 'Access-Control-Allow-Origin': '*' },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
