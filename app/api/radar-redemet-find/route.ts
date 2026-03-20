import { NextRequest, NextResponse } from 'next/server';

const PLOTA_RADAR_URL = 'https://redemet.decea.mil.br/old/produtos/radares-meteorologicos/plota_radar.php';
const REDEMET_PRODUCTS_URL = 'https://redemet.decea.mil.br/old/produtos/radares-meteorologicos/';
const REDEMET_BASE = 'https://redemet.decea.mil.br/';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent': UA,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
  Pragma: 'no-cache',
};

function extractSessionCookie(headers: Headers): string {
  // getSetCookie() retorna array de todos os Set-Cookie (Node 18+)
  const getSetCookie = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  if (typeof getSetCookie === 'function') {
    const cookies = getSetCookie.call(headers);
    for (const c of cookies) {
      const m = c.match(/PHPSESSID=([^;]+)/);
      if (m) return `PHPSESSID=${m[1]}`;
    }
  }
  const setCookie = headers.get('set-cookie') ?? '';
  const match = setCookie.match(/PHPSESSID=([^;]+)/);
  return match ? `PHPSESSID=${match[1]}` : '';
}

/**
 * 1. GET na página de radares para obter cookie PHPSESSID
 * 2. POST no plota_radar.php com o cookie e Referer correto
 * 3. Extrai URL da imagem do radar solicitado
 */
async function findViaPlotaRadar(area: string, ts12: string): Promise<{ url: string | null; debug?: Record<string, unknown> }> {
  const y = ts12.slice(0, 4);
  const mo = ts12.slice(4, 6);
  const d = ts12.slice(6, 8);
  const hh = ts12.slice(8, 10);
  const mm = ts12.slice(10, 12);
  const datahora = `${d}/${mo}/${y} ${hh}:${mm}`;

  // Passo 1: obter sessão PHP na página de produtos (onde o form plota_radar vive)
  let sessionCookie = '';
  try {
    const pageRes = await fetch(REDEMET_PRODUCTS_URL, {
      method: 'GET',
      headers: BROWSER_HEADERS,
      redirect: 'follow',
      signal: AbortSignal.timeout(10_000),
    });
    sessionCookie = extractSessionCookie(pageRes.headers);
  } catch {
    // continua sem cookie
  }

  // Passo 2: POST no plota_radar.php (Referer = página do form)
  const postHeaders: Record<string, string> = {
    ...BROWSER_HEADERS,
    Referer: REDEMET_PRODUCTS_URL,
    Origin: 'https://redemet.decea.mil.br',
    'X-Requested-With': 'XMLHttpRequest',
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
  };
  if (sessionCookie) postHeaders['Cookie'] = sessionCookie;

  const bodyStr = `radar%5B%5D=${encodeURIComponent(area)}&maxcappi=maxcappi&datahora=${encodeURIComponent(datahora)}`;

  const res = await fetch(PLOTA_RADAR_URL, {
    method: 'POST',
    headers: postHeaders,
    body: bodyStr,
    redirect: 'follow',
    signal: AbortSignal.timeout(12_000),
  });

  if (!res.ok) {
    return { url: null, debug: { step: 'post_failed', status: res.status, datahora, hasSession: !!sessionCookie } };
  }

  const html = await res.text();

  const regex = new RegExp(
    `carrega_radar\\s*\\(\\s*\\d+\\s*,\\s*'${area}'\\s*,\\s*'([^']+)'`,
  );
  const rgMatch = html.match(regex);
  if (!rgMatch?.[1]) {
    return {
      url: null,
      debug: {
        step: 'no_match',
        status: res.status,
        htmlLength: html.length,
        htmlSnippet: html.slice(0, 600),
        datahora,
        hasSession: !!sessionCookie,
      },
    };
  }

  const path = rgMatch[1];
  return { url: `${REDEMET_BASE}${path}` };
}

export async function GET(req: NextRequest) {
  const area = req.nextUrl.searchParams.get('area');
  const ts12 = req.nextUrl.searchParams.get('ts12');

  if (!area || !ts12 || ts12.length !== 12) {
    return NextResponse.json({ error: 'Missing or invalid params (area, ts12)' }, { status: 400 });
  }

  try {
    const result = await findViaPlotaRadar(area, ts12);

    return NextResponse.json(
      result,
      { headers: { 'Cache-Control': result.url ? 'public, max-age=86400' : 'no-cache' } },
    );
  } catch (err: unknown) {
    return NextResponse.json(
      { url: null, error: err instanceof Error ? err.message : 'search failed' },
      { status: 500 },
    );
  }
}
