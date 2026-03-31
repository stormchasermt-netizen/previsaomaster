import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { lat, lon, fileName } = body;

    if (lat === undefined || lon === undefined || !fileName) {
      return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
    }

    // O IP da VM que roda o backend do WRF (conforme fornecido pelo usuário)
    const vmUrl = 'http://34.41.194.43:8095/generate-wrf-sounding';

    // Passo 1: Pega o CSV da VM
    const vmResponse = await fetch(vmUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ lat, lon, fileName }),
      cache: 'no-store',
    });

    if (!vmResponse.ok) {
      const errorText = await vmResponse.text();
      console.error('Error from VM:', errorText);
      return NextResponse.json({ error: `Error generating sounding CSV: ${errorText}` }, { status: vmResponse.status });
    }

    const vmData = await vmResponse.json();
    
    if (vmData.status !== 'success' || !vmData.csv_data) {
      return NextResponse.json({ error: 'Invalid response from WRF VM' }, { status: 500 });
    }

    // Passo 2: Envia o CSV para o python-service local para renderizar a imagem
    // O python-service está rodando na porta 9090 (rota /process-average-sounding)
    const renderUrl = 'http://127.0.0.1:9090/process-average-sounding'; 
    
    // Log do tamanho do CSV recebido para debug
    console.log(`[WRF Sondagem] CSV recebido da VM com sucesso, tamanho: ${vmData.csv_data.length} caracteres`);

    const renderResponse = await fetch(renderUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        csv_content: vmData.csv_data,
        title: `WRF Sounding - Lat: ${lat.toFixed(2)} Lon: ${lon.toFixed(2)}`
      }),
      cache: 'no-store',
    });

    if (!renderResponse.ok) {
      const errorText = await renderResponse.text();
      console.error('Error from local python-service:', errorText);
      return NextResponse.json({ error: `Error rendering sounding image: ${errorText}` }, { status: renderResponse.status });
    }

    // Passo 3: Retorna a imagem final para o frontend
    const imageBuffer = await renderResponse.arrayBuffer();

    return new NextResponse(imageBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
      },
    });
  } catch (error: any) {
    console.error('Error in wrf-sounding proxy:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
