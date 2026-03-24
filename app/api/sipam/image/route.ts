import { NextResponse } from 'next/server';

const SIPAM_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
  'Referer': 'https://hidro.sipam.gov.br/',
};

/**
 * GET /api/sipam/image?radar=sbbv&produto=dbz&timestamp=2026_03_24_00_05_00
 * Proxy binário para imagens do SIPAM em siger.sipam.gov.br.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const radar = searchParams.get('radar');
  const produto = searchParams.get('produto') || 'dbz';
  const timestamp = searchParams.get('timestamp');

  if (!radar || !timestamp) {
    return new NextResponse('Missing radar or timestamp', { status: 400 });
  }

  const imageUrl = `https://siger.sipam.gov.br/radar/${radar}/${produto}/${timestamp}.png`;

  try {
    const upstream = await fetch(imageUrl, {
      headers: SIPAM_HEADERS,
      cache: 'no-store',
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });

    if (!upstream.ok) {
      return new NextResponse(`SIPAM CDN error: ${upstream.status}`, { status: 502 });
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
    return new NextResponse(`SIPAM PNG fetch failed: ${err.message}`, { status: 502 });
  }
}
