import { NextRequest, NextResponse } from 'next/server';
import { CPTEC_RADAR_STATIONS, buildNowcastingPngUrl, getNearestRadarTimestamp } from '@/lib/cptecRadarStations';
import { ARGENTINA_RADAR_STATIONS, buildArgentinaRadarPngUrl, getArgentinaRadarTimestamp } from '@/lib/argentinaRadarStations';

async function checkUrlExists(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const slug = searchParams.get('slug');
  const ts12 = searchParams.get('ts12');
  const product = searchParams.get('product') || 'reflectividade';
  const isLive = searchParams.get('isLive') === 'true';

  if (!slug || !ts12) return NextResponse.json({ error: 'Faltam parâmetros' }, { status: 400 });

  const hostUrl = req.nextUrl.origin;
  // A MÁGICA DO CORS: Envolvemos a URL no Proxy para o Web Worker não chorar!
  const proxyWrap = (url: string) => `${hostUrl}/api/radar-proxy?url=${encodeURIComponent(url)}`;

  // 1. Argentina
  const argRadar = ARGENTINA_RADAR_STATIONS.find(r => r.id === slug.replace('argentina:', ''));
  if (argRadar) {
    const nominalDate = new Date(Date.UTC(
      parseInt(ts12.slice(0, 4), 10), parseInt(ts12.slice(4, 6), 10) - 1, parseInt(ts12.slice(6, 8), 10),
      parseInt(ts12.slice(8, 10), 10), parseInt(ts12.slice(10, 12), 10)
    ));
    const argTs = getArgentinaRadarTimestamp(nominalDate, argRadar);
    const argUrl = buildArgentinaRadarPngUrl(argRadar, argTs, product as any);
    return NextResponse.json({ url: proxyWrap(argUrl), source: 'argentina', ts12: argTs });
  }

  // 2. CPTEC / FUNCEME / USP / IPMET
  const cptecRadar = CPTEC_RADAR_STATIONS.find(r => r.slug === slug);
  if (cptecRadar) {
    const exactTs12 = getNearestRadarTimestamp(ts12, cptecRadar);

    // Radares Fixos (Só funcionam no Ao Vivo, o histórico vai pro Storage no Frontend)
    if (['usp-starnet', 'ipmet-bauru', 'climatempo-poa'].includes(slug)) {
      if (isLive) {
        if (slug === 'usp-starnet') return NextResponse.json({ url: proxyWrap(`https://www.starnet.iag.usp.br/img_starnet/Radar_USP/Integracao/integracao_last.png?t=${Date.now()}`), source: 'cptec', ts12: exactTs12 });
        if (slug === 'ipmet-bauru') return NextResponse.json({ url: proxyWrap(`https://www.ipmetradar.com.br/out/brz_latest.png?t=${Date.now()}`), source: 'cptec', ts12: exactTs12 });
        if (slug === 'climatempo-poa') return NextResponse.json({ url: proxyWrap(`https://statics.climatempo.com.br/radar_poa/pngs/latest/radar_poa_1.png?t=${Date.now()}`), source: 'cptec', ts12: exactTs12 });
      }
      return NextResponse.json({ error: 'Use storage' }, { status: 404 });
    }

    if (slug === 'chapeco') {
      const radarId = product === 'velocidade' ? (cptecRadar.velocityId || cptecRadar.id) : cptecRadar.id;
      // Nossas APIs internas não precisam de proxyWrap
      return NextResponse.json({ url: `${hostUrl}/api/nowcasting/chapeco?radarId=${radarId}&timestamp=${ts12}`, source: 'cptec', ts12 });
    }

    if (cptecRadar.org === 'funceme') {
       return NextResponse.json({ url: `${hostUrl}/api/funceme/image?radar=${cptecRadar.id}&produto=${product}&timestamp=${ts12}`, source: 'funceme', ts12 });
    }

    // Tenta a CDN do CPTEC
    const cptecUrl = buildNowcastingPngUrl(cptecRadar, exactTs12, product as any, true);
    const exists = await checkUrlExists(cptecUrl);
    if (exists) return NextResponse.json({ url: proxyWrap(cptecUrl), source: 'cptec', ts12: exactTs12 });

    // Se CPTEC caiu, devolve 404 pro Frontend acionar a Redemet ou Storage!
    return NextResponse.json({ error: 'CPTEC offline' }, { status: 404 });
  }

  return NextResponse.json({ error: 'Radar não encontrado' }, { status: 404 });
}
