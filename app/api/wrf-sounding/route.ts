import { NextRequest, NextResponse } from 'next/server';

const VM_FETCH_MS = 60000;
const RENDER_FETCH_MS = 120000;

function stripDataUrlBase64(raw: string): string {
  const s = String(raw).trim();
  const m = /^data:image\/[^;]+;base64,(.+)$/is.exec(s);
  return m ? m[1] : s;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { lat, lon, fileName } = body;

    if (lat === undefined || lon === undefined || !fileName) {
      return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
    }

    // CSV do WRF: por padrão usa Cloud Run POST /process com wrf_proxy_only (HTTPS → VM HTTP).
    // WRF_SOUNDING_VM_URL = HTTP direto na VM (só se o SSR conseguir fetch HTTP).
    // WRF_SOUNDING_VM_PROXY_URL = URL alternativa do proxy (ex.: outro /process).
    const directVmUrl = process.env.WRF_SOUNDING_VM_URL;
    const vmUrl =
      directVmUrl ||
      process.env.WRF_SOUNDING_VM_PROXY_URL ||
      'https://sounding-engine-303740989273.us-central1.run.app/process';

    const vmBody = directVmUrl
      ? { lat, lon, fileName }
      : { wrf_proxy_only: true, lat, lon, fileName };

    const renderUrl =
      process.env.SOUNDING_ENGINE_URL ||
      'https://sounding-engine-303740989273.us-central1.run.app/process';

    // Passo 1: Imagem da VM gerada pelo Python `plot_skewt` do colega
    let vmResponse: Response;
    try {
      vmResponse = await fetch(vmUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(vmBody),
        cache: 'no-store',
        signal: AbortSignal.timeout(VM_FETCH_MS),
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('Timeout') || msg.includes('aborted')) {
        return NextResponse.json(
          {
            step: 'vm_fetch',
            error: 'Tempo esgotado ao aguardar o servidor Python na VM gerar a sondagem. Tente outra vez ou verifique o script wrf_sounding_server.py.',
            details: msg,
          },
          { status: 504 },
        );
      }
      return NextResponse.json(
        {
          step: 'vm_fetch',
          error: 'Nao foi possivel conectar a VM do WRF. O IP / porta deve estar fechado.',
          details: msg,
        },
        { status: 502 },
      );
    }

    if (!vmResponse.ok) {
      const errorText = await vmResponse.text().catch(() => 'No text');
      return NextResponse.json(
        {
          step: 'vm_http',
          error: `HTTP ${vmResponse.status} erro a gerar a imagem na VM`,
          details: errorText,
        },
        { status: vmResponse.status >= 500 ? 502 : vmResponse.status },
      );
    }

    const vmData = await vmResponse.json();

    if (vmData.error || !vmData.image) {
      return NextResponse.json(
        {
          step: 'vm_payload',
          error: vmData.error || 'Resposta invalida da VM WRF (sem key image)',
        },
        { status: 500 },
      );
    }

    console.log(`[WRF Sondagem] Imagem Skew-T devolvida pela VM, tamanho: ${vmData.image.length} caracteres`);

    // Retorna a imagem final Base64 da VM como manda a API do site (esperando "image")
    return NextResponse.json({ image: vmData.image });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Erro /api/wrf-sounding geral:', error);
    return NextResponse.json(
      { step: 'general', error: message },
      { status: 500 },
    );
  }
}
