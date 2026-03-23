import { NextResponse } from 'next/server';

interface FuncemeResultItem {
  dia: string; // Ex: "2026/03/23"
  img: string; // Ex: "PRSF20260323220944GMWR1000SST_openlayer.png"
  datahora: string; // Ex: "2026-03-23 22:09:44"
}

interface FuncemeResponse {
  data: {
    list: Array<{
      result: FuncemeResultItem[];
      path: string; // Ex: "https://cdn.funceme.br/radar/operadares/GMWR1000SST/plots/prsf/transparente/"
    }>;
  };
}

// Cache local em memória simples para os JSONs da Funceme. Ex: chave "GMWR1000SST_2026-03-23" -> { fetchTime, results }
const jsonCache = new Map<string, { fetchTime: number; path: string; items: FuncemeResultItem[] }>();
const CACHE_TTL_MS = 60 * 1000; // 1 minuto de cache em memória (evita sobrecarregar apil5 ao deslizar timeline)

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const radar = searchParams.get('radar'); // GMWR1000SST ou RMT0100DS
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
    // Buscar da API original
    const apiUrl = `https://apil5.funceme.br/rpc/v1/produto-gerado?radar=${radar}&produto=prsf&tempo=20&data=${targetDateStr}&cache=no`;

    try {
      const res = await fetch(apiUrl, { next: { revalidate: 0 } });
      if (!res.ok) {
        return new NextResponse(`Funceme API error: ${res.status}`, { status: res.status });
      }
      const json = await res.json() as FuncemeResponse;

      if (!json?.data?.list?.[0]?.result) {
        // Sem dados para este dia
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

  // Encontrar o frame mais próximo igual ou anterior ao targetTimeEpoch
  // Geralmente a lista já vem ordenada da mais recente para a mais antiga, mas vamos varrer sequencialmente.
  // datahora format is "YYYY-MM-DD HH:mm:ss" in UTC?? Actually Funceme datahora usually is UTC.
  // Let's assume the string can be parsed natively if we append 'Z', because Ceará radars usually register in UTC.
  
  let bestItem: FuncemeResultItem | null = null;
  let minDiff = Infinity;

  // Busca a imagem mais próxima dentro de uma janela de +/- 15 minutos
  for (const item of items) {
    const itemEpoch = new Date(item.datahora.replace(' ', 'T') + 'Z').getTime();
    const diff = Math.abs(targetTimeEpoch - itemEpoch);

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

  // Montar URL Final
  let finalPath = path.endsWith('/') ? path : path + '/';
  // item.dia comes as "2026/03/23", some radar formats skip the slash, but usually it has it.
  const diaFormatted = bestItem.dia.includes('/') ? bestItem.dia : `${bestItem.dia.substring(0,4)}/${bestItem.dia.substring(4,6)}/${bestItem.dia.substring(6,8)}`;
  
  const urlFinal = `${finalPath}${diaFormatted}/${bestItem.img}`;

  // Emitir Redirect 302 direto pra PNG da CDN
  return NextResponse.redirect(urlFinal, { status: 302 });
}
