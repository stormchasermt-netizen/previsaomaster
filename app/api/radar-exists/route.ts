import { NextRequest, NextResponse } from 'next/server';

const ALLOWED_HOSTS = [
  's0.cptec.inpe.br',
  's1.cptec.inpe.br',
  's2.cptec.inpe.br',
  's3.cptec.inpe.br',
  'webmet.ohmc.ar',
  'www.starnet.iag.usp.br',
  'redemet.decea.mil.br',
  'estatico-redemet.decea.mil.br',
];

/** Verifica se uma imagem de radar existe (HEAD request). Usado para filtrar o slider. */
export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url');
  if (!url) {
    return NextResponse.json({ error: 'Missing url param' }, { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
    if (!ALLOWED_HOSTS.includes(parsed.hostname)) {
      return NextResponse.json({ exists: false, hostNotAllowed: true });
    }

    const isRedemet = ['redemet.decea.mil.br', 'estatico-redemet.decea.mil.br'].includes(parsed.hostname);
    const headers: Record<string, string> = {
      'User-Agent': isRedemet
        ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        : 'Mozilla/5.0 (compatible; tornado-tracks-radar-check/1.0)',
    };
    if (isRedemet) {
      headers['Referer'] = 'https://redemet.decea.mil.br/';
    }

    const upstream = await fetch(url, {
      method: 'HEAD',
      headers,
      cache: 'no-store',
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
    });

    return NextResponse.json({ exists: upstream.ok });
  } catch (err: any) {
    if (err.name !== 'AbortError') {
      console.error(`[radar-exists] Error checking ${url}:`, err.message);
    }
    return NextResponse.json({ exists: false });
  }
}
