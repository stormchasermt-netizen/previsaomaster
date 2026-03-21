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
  'firebasestorage.googleapis.com',
];

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url');
  if (!url) {
    return NextResponse.json({ error: 'Missing url param' }, { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return NextResponse.json({ error: 'Invalid url' }, { status: 400 });
  }

  if (!ALLOWED_HOSTS.includes(parsed.hostname)) {
    return NextResponse.json({ error: 'Host not allowed' }, { status: 403 });
  }

  const isRedemet = ['redemet.decea.mil.br', 'estatico-redemet.decea.mil.br'].includes(parsed.hostname);
  const headers: Record<string, string> = {
    'User-Agent': isRedemet
      ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      : 'Mozilla/5.0 (compatible; tornado-tracks-radar-proxy/1.0)',
  };
  if (isRedemet) {
    headers['Referer'] = 'https://redemet.decea.mil.br/';
  }

  try {
    const upstream = await fetch(url, {
      headers,
      cache: 'no-store',
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });

    if (!upstream.ok) {
      const status = upstream.status;
      const text = await upstream.text().catch(() => '');
      return NextResponse.json(
        {
          error: status === 404 ? 'Imagem não encontrada (404). Verifique se o radar/publicação existem nesse horário.' : `Servidor CPTEC retornou ${status}`,
          url: parsed.href,
          detail: text.slice(0, 200),
        },
        { status: status >= 400 && status < 500 ? status : 502 }
      );
    }

    const contentType = upstream.headers.get('content-type') ?? 'image/png';
    if (!contentType.startsWith('image/')) {
      return NextResponse.json(
        { error: 'Resposta não é imagem', url: parsed.href },
        { status: 502 }
      );
    }

    const body = await upstream.arrayBuffer();

    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=300',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'fetch failed' },
      { status: 502 }
    );
  }
}
