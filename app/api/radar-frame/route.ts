import { NextRequest, NextResponse } from 'next/server';
import { 
  CPTEC_RADAR_STATIONS, 
  buildNowcastingPngUrl, 
  getNearestRadarTimestamp
} from '@/lib/cptecRadarStations';
import { hasRedemetFallback } from '@/lib/redemetRadar';
import { ARGENTINA_RADAR_STATIONS, buildArgentinaRadarPngUrl, getArgentinaRadarTimestamp } from '@/lib/argentinaRadarStations';

// Função auxiliar para testar se uma URL de imagem existe (HEAD request rápido)
async function checkUrlExists(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

// Função mágica para curar os erros de CORS (Access-Control-Allow-Origin)
const proxyWrap = (url: string) => `/api/radar-proxy?url=${encodeURIComponent(url)}`;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const slug = searchParams.get('slug');
  const ts12 = searchParams.get('ts12');
  const product = (searchParams.get('product') || 'reflectividade') as 'reflectividade' | 'velocidade' | 'vil' | 'waldvogel';
  const isLive = searchParams.get('isLive') === 'true'; // Se o slider está na posição 0
  const sourceMode = searchParams.get('sourceMode'); // 'hd' ou 'superres'

  if (!slug || !ts12 || ts12.length !== 12) {
    return NextResponse.json({ error: 'Faltam parâmetros' }, { status: 400 });
  }

  const hostUrl = req.nextUrl.origin;

  // IDENTIFICAR SE É HISTÓRICO ANTIGO (> 48 Horas)
  const targetDate = new Date(Date.UTC(
    parseInt(ts12.slice(0, 4), 10), 
    parseInt(ts12.slice(4, 6), 10) - 1, 
    parseInt(ts12.slice(6, 8), 10),
    parseInt(ts12.slice(8, 10), 10), 
    parseInt(ts12.slice(10, 12), 10)
  ));
  const isHistorical = (Date.now() - targetDate.getTime()) > 48 * 60 * 60 * 1000;

  // 1. REGRA RÍGIDA: USP, IPMET e Climatempo POA
  // Só têm imagem na fonte original se for AO VIVO. Histórico antigo vira Storage.
  if (['usp-starnet', 'ipmet-bauru', 'climatempo-poa'].includes(slug)) {
    if (isLive && !isHistorical) {
      if (slug === 'usp-starnet') return NextResponse.json({ url: proxyWrap(`https://www.starnet.iag.usp.br/img_starnet/Radar_USP/Integracao/integracao_last.png?t=${Date.now()}`), source: 'cptec', ts12 });
      if (slug === 'ipmet-bauru') return NextResponse.json({ url: proxyWrap(`https://www.ipmetradar.com.br/out/brz_latest.png?t=${Date.now()}`), source: 'cptec', ts12 });
      if (slug === 'climatempo-poa') return NextResponse.json({ url: proxyWrap(`https://statics.climatempo.com.br/radar_poa/pngs/latest/radar_poa_1.png?t=${Date.now()}`), source: 'cptec', ts12 });
    } else {
      // É histórico: Vai direto para sua rota de fallback do Storage
      const storageRes = await fetch(`${hostUrl}/api/radar-storage-fallback?radarId=${slug}&ts12=${ts12}&productType=${product}`);
      const storageData = await storageRes.json().catch(() => null);
      if (storageData?.url) return NextResponse.json({ url: storageData.url, source: 'storage', ts12 });
      return NextResponse.json({ error: 'Nenhuma imagem no storage' }, { status: 404 });
    }
  }

  // Identificar se é Argentina
  const argRadar = ARGENTINA_RADAR_STATIONS.find(r => r.id === slug.replace('argentina:', ''));
  if (argRadar) {
    const argTs = getArgentinaRadarTimestamp(targetDate, argRadar);
    const argUrl = buildArgentinaRadarPngUrl(argRadar, argTs, product);
    // Argentina exige Proxy para evitar bloqueio de CORS no Canvas
    return NextResponse.json({ url: proxyWrap(argUrl), source: 'argentina', ts12: argTs });
  }

  // Localizar radar CPTEC
  const cptecRadar = CPTEC_RADAR_STATIONS.find(r => r.slug === slug);
  if (cptecRadar) {
    // 2. SE FOR HISTÓRICO (>48h), IGNORA AS APIS AO VIVO E VAI PRO STORAGE!
    if (isHistorical) {
      const exactTs12 = getNearestRadarTimestamp(ts12, cptecRadar);
      const storageRes = await fetch(`${hostUrl}/api/radar-storage-fallback?radarId=${slug}&ts12=${exactTs12}&productType=${product}`);
      const storageData = await storageRes.json().catch(() => null);
      if (storageData?.url) return NextResponse.json({ url: storageData.url, source: 'storage', ts12: exactTs12 });
      return NextResponse.json({ error: 'Nenhuma imagem histórica no backup' }, { status: 404 });
    }

    // 3. É RECENTE: Usa as APIs de Nowcasting/Funceme/Sipam
    if (slug === 'chapeco') {
      const radarId = product === 'velocidade' ? (cptecRadar.velocityId || cptecRadar.id) : cptecRadar.id;
      return NextResponse.json({ url: `/api/nowcasting/chapeco?radarId=${radarId}&timestamp=${ts12}`, source: 'cptec', ts12 });
    }

    if (cptecRadar.org === 'funceme') {
       return NextResponse.json({ url: `/api/funceme/image?radar=${cptecRadar.id}&produto=${product}&timestamp=${ts12}`, source: 'funceme', ts12 });
    }

    // 4. RADARES PADRÕES DO CPTEC (Com Fallback Dinâmico Recente)
    const exactTs12 = getNearestRadarTimestamp(ts12, cptecRadar);
    const isHd = sourceMode === 'hd';
    const hasRedemet = hasRedemetFallback(slug);

    // Se estiver em modo HD explícito e tiver Redemet, prioriza o fallback
    const tryCptecFirst = !isHd || !hasRedemet;

    if (tryCptecFirst) {
      const cptecUrl = buildNowcastingPngUrl(cptecRadar, exactTs12, product, true);
      const exists = await checkUrlExists(cptecUrl);
      if (exists) {
        // CPTEC via Proxy para evitar "tainted canvas" no Super Res
        return NextResponse.json({ url: proxyWrap(cptecUrl), source: 'cptec', ts12: exactTs12 });
      }
    }

    // Se CPTEC falhou ou o usuário pediu HD: Tenta REDEMET
    if (hasRedemet && product === 'reflectividade') {
      const redemetRes = await fetch(`${hostUrl}/api/radar-redemet-find?area=${slug}&ts12=${exactTs12}`);
      const redemetData = await redemetRes.json().catch(() => null);
      if (redemetData?.url) {
        return NextResponse.json({ url: proxyWrap(redemetData.url), source: 'redemet', ts12: exactTs12 });
      }
    }

    // Fallback de emergência (Backups recentes no Storage)
    const storageRes = await fetch(`${hostUrl}/api/radar-storage-fallback?radarId=${slug}&ts12=${exactTs12}&productType=${product}`);
    const storageData = await storageRes.json().catch(() => null);
    if (storageData?.url) {
      return NextResponse.json({ url: storageData.url, source: 'storage', ts12: exactTs12 });
    }

    return NextResponse.json({ error: 'Nenhuma fonte disponível' }, { status: 404 });
  }

  return NextResponse.json({ error: 'Radar não encontrado' }, { status: 404 });
}
