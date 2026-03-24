import { NextResponse } from 'next/server';

interface SipamRadar {
  nomeRadar: string;
  nomeMunicipio: string;
  latitudeCentro: number;
  longitudeCentro: number;
  latitudeMax: number;
  latitudeMin: number;
  longitudeMax: number;
  longitudeMin: number;
  produtos: string[];
  varreduras: string[];
  ultimaDataVarredura: string;
}

// Cache LRU em memória
const jsonCache = new Map<string, { fetchTime: number; radars: SipamRadar[] }>();
const CACHE_TTL_MS = 60 * 1000;

/**
 * GET /api/sipam/frames?radar=sbbv&produto=dbz
 * Retorna a lista de timestamps (ts12 UTC) disponíveis para este radar SIPAM.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const radarSlug = searchParams.get('radar');

  if (!radarSlug) {
    return NextResponse.json({ error: 'Missing radar' }, { status: 400 });
  }

  let radars: SipamRadar[] = [];
  const now = Date.now();
  const cacheKey = 'sipam_all';
  const cached = jsonCache.get(cacheKey);

  if (cached && now - cached.fetchTime < CACHE_TTL_MS) {
    radars = cached.radars;
  } else {
    try {
      const res = await fetch('https://apihidro.sipam.gov.br/radares/', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://hidro.sipam.gov.br/',
        },
        cache: 'no-store',
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        return NextResponse.json({ error: `SIPAM API error: ${res.status}` }, { status: res.status });
      }
      radars = await res.json() as SipamRadar[];
      jsonCache.set(cacheKey, { fetchTime: now, radars });
    } catch (e: any) {
      return NextResponse.json({ error: e.message }, { status: 500 });
    }
  }

  const radar = radars.find(r => r.nomeRadar === radarSlug);
  if (!radar || !radar.varreduras || radar.varreduras.length === 0) {
    return NextResponse.json({ frames: [] });
  }

  // Converter varreduras ISO "2026-03-24T00:10:00Z" -> { ts12, datahora, sipamTs }
  const frames = radar.varreduras.map(v => {
    const d = new Date(v);
    const ts12 = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}`;
    // Formato para URL da imagem: YYYY_MM_DD_HH_mm_ss
    const sipamTs = `${d.getUTCFullYear()}_${String(d.getUTCMonth() + 1).padStart(2, '0')}_${String(d.getUTCDate()).padStart(2, '0')}_${String(d.getUTCHours()).padStart(2, '0')}_${String(d.getUTCMinutes()).padStart(2, '0')}_${String(d.getUTCSeconds()).padStart(2, '0')}`;
    const datahora = d.toISOString().replace('T', ' ').substring(0, 19);
    return { ts12, datahora, sipamTs };
  }).sort((a, b) => a.ts12.localeCompare(b.ts12)); // Mais antigo primeiro

  return NextResponse.json({ frames, bounds: { north: radar.latitudeMax, south: radar.latitudeMin, east: radar.longitudeMax, west: radar.longitudeMin } }, {
    headers: { 'Cache-Control': 'public, max-age=60', 'Access-Control-Allow-Origin': '*' },
  });
}
