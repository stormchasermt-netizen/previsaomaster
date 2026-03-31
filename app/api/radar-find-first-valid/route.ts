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

/** 
 * Verifica uma lista de URLs de radar em sequência e retorna a primeira que existir (HTTP 200/OK via HEAD).
 * Útil para busca em espiral (ex: tentar 18:00, depois 17:59, 17:58) sem múltiplos roundtrips pro cliente.
 */
export async function POST(req: NextRequest) {
  try {
    const { urls } = await req.json();

    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return NextResponse.json({ error: 'Missing or invalid urls array' }, { status: 400 });
    }

    for (const url of urls) {
      if (typeof url !== 'string') continue;
      
      let parsed: URL;
      try {
        parsed = new URL(url);
        if (!ALLOWED_HOSTS.includes(parsed.hostname)) {
          continue; // Pula URLs não permitidas em vez de falhar toda a requisição
        }
      } catch (e) {
         continue;
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

      try {
        const upstream = await fetch(url, {
          method: 'HEAD',
          headers,
          cache: 'no-store',
          redirect: 'follow',
          signal: AbortSignal.timeout(4000), // Timeout curto por tentativa para não travar a fila
        });

        if (upstream.ok) {
          // Encontramos a primeira URL válida!
          return NextResponse.json({ exists: true, url: url });
        }
      } catch (err: any) {
        // Ignora erros individuais (timeout, dns) e tenta a próxima
      }
    }

    // Se chegou aqui, nenhuma URL funcionou
    return NextResponse.json({ exists: false, url: null });

  } catch (e: any) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }
}
