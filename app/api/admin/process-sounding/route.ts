import { NextRequest, NextResponse } from 'next/server';
import { processCSVContent } from '@/lib/soundingUtils';

export async function POST(req: NextRequest) {
  try {
    const { csvUrl } = await req.json();

    if (!csvUrl) {
      return NextResponse.json({ error: 'URL do CSV não fornecida' }, { status: 400 });
    }

    // 1. Baixar o CSV
    const response = await fetch(csvUrl);
    if (!response.ok) {
      return NextResponse.json({ error: 'Falha ao baixar o CSV do Storage' }, { status: 500 });
    }
    const csvContent = await response.text();

    // 2. Processar nativamente via utils
    const result = processCSVContent(csvContent);

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json(result);

  } catch (err: any) {
    console.error('API Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
