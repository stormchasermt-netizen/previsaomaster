const fs = require('fs');

let code = fs.readFileSync('c:\\Users\\Usuário\\Downloads\\download (12)\\studio\\app\\api\\wrf-sounding\\route.ts', 'utf8');

// Simplificar todo o fluxo de fetch a partir de "Passo 1" até ao final da resposta da API
const startIndex = code.indexOf('// Passo 1: CSV da VM (via proxy na Cloud Run ou direto)');

if (startIndex !== -1) {
  const newLogic = `// Passo 1: Imagem da VM gerada pelo Python \`plot_skewt\` do colega
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
          error: \`HTTP \${vmResponse.status} erro a gerar a imagem na VM\`,
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

    console.log(\`[WRF Sondagem] Imagem Skew-T devolvida pela VM, tamanho: \${vmData.image.length} caracteres\`);

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
`;

  code = code.substring(0, startIndex) + newLogic;
  fs.writeFileSync('c:\\Users\\Usuário\\Downloads\\download (12)\\studio\\app\\api\\wrf-sounding\\route.ts', code);
}
