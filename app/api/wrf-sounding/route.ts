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

    // Passo 1: CSV da VM (via proxy na Cloud Run ou direto)
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
      console.error('[wrF-sounding] VM fetch failed:', msg);
      return NextResponse.json(
        {
          step: 'vm_fetch',
          error:
            'Não foi possível conectar à VM do WRF (rede/firewall). O site roda no Google Cloud; o IP de origem não é o seu PC. Libere a porta 8095 na VM para ingresso do Google Cloud (ex.: 0.0.0.0/0 em TCP 8095) ou use um túnel/HTTPS.',
          details: msg,
        },
        { status: 502 },
      );
    }

    if (!vmResponse.ok) {
      const errorText = await vmResponse.text();
      console.error('Error from VM:', errorText);
      return NextResponse.json(
        {
          step: 'vm_http',
          error: `HTTP ${vmResponse.status} ao obter CSV (VM via proxy Cloud Run ou direto)`,
          details: errorText,
        },
        { status: vmResponse.status >= 500 ? 502 : vmResponse.status },
      );
    }

    const vmData = await vmResponse.json();

    if (vmData.status !== 'success' || !vmData.csv_data) {
      return NextResponse.json(
        {
          step: 'vm_payload',
          error: 'Resposta inválida da VM WRF (sem csv_data)',
        },
        { status: 500 },
      );
    }

    console.log(
      `[WRF Sondagem] CSV recebido da VM, tamanho: ${vmData.csv_data.length} caracteres`,
    );

    // Passo 2: render SHARPpy no Cloud Run
    let renderResponse: Response;
    try {
      renderResponse = await fetch(renderUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          csv: vmData.csv_data,
          title: `WRF Sounding - Lat: ${lat.toFixed(2)} Lon: ${lon.toFixed(2)}`,
        }),
        cache: 'no-store',
        signal: AbortSignal.timeout(RENDER_FETCH_MS),
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[wrf-sounding] Cloud Run fetch failed:', msg);
      return NextResponse.json(
        {
          step: 'render_fetch',
          error: 'Falha ao chamar o serviço de renderização (Cloud Run)',
          details: msg,
        },
        { status: 502 },
      );
    }

    if (!renderResponse.ok) {
      const errorText = await renderResponse.text();
      console.error('Error from sounding-engine:', errorText);
      return NextResponse.json(
        {
          step: 'render_http',
          error: 'Erro ao renderizar sondagem',
          details: errorText,
        },
        { status: renderResponse.status },
      );
    }

    const responseJson = await renderResponse.json();

    if (!responseJson.success || !responseJson.base64_img) {
      console.error('Render failure:', responseJson);
      return NextResponse.json(
        {
          step: 'render_payload',
          error: `Render failed: ${responseJson.error || 'No image'}`,
          trace: responseJson.trace,
        },
        { status: 500 },
      );
    }

    const b64 = stripDataUrlBase64(responseJson.base64_img);
    const imageBuffer = Buffer.from(b64, 'base64');

    return new NextResponse(imageBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
      },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('Error in wrf-sounding proxy:', error);
    return NextResponse.json(
      { step: 'unexpected', error: msg || 'Internal Server Error' },
      { status: 500 },
    );
  }
}
