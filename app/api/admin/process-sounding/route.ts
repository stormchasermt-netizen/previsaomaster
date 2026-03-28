import { NextRequest, NextResponse } from 'next/server';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';

export async function POST(req: NextRequest) {
  try {
    const { csvUrl, isAverage, csvUrls, generateImage, imageTitle, latitude, nativeSpcLayout } = await req.json();

    const pythonServiceUrl = process.env.PYTHON_ENGINE_URL || 'https://sounding-engine-303740989273.us-central1.run.app';

    // Buscar Layout Customizado no Firestore
    let layoutConfig = null;
    if (db) {
      try {
        const layoutDoc = await getDoc(doc(db, 'app_configs', 'sounding_layout'));
        if (layoutDoc.exists()) {
          layoutConfig = layoutDoc.data().layout;
          console.log("Layout v6.1 recuperado para processamento global!");
        }
      } catch (err) {
        console.error("Erro ao buscar layout no Firestore (API):", err);
      }
    }

    if (isAverage) {
      if (!csvUrls || csvUrls.length === 0) {
        return NextResponse.json({ error: 'Nenhuma URL fornecida para média' }, { status: 400 });
      }
      
      const response = await fetch(`${pythonServiceUrl}/api/process-average-sounding`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csvUrls })
      });
      
      if (!response.ok) {
        const textErr = await response.text();
        return NextResponse.json({ error: `Engine Python Retornou: ${response.status} - ${textErr}` }, { status: 500 });
      }
      
      const data = await response.json();
      return NextResponse.json(data);
    } else {
      if (!csvUrl) {
        return NextResponse.json({ error: 'URL do CSV não fornecida' }, { status: 400 });
      }

      const response = await fetch(`${pythonServiceUrl}/api/process-sounding`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          csvUrl, 
          generateImage, 
          imageTitle, 
          latitude, 
          nativeSpcLayout,
          layout_config: layoutConfig 
        })
      });
      
      if (!response.ok) {
        const textErr = await response.text();
        return NextResponse.json({ error: `Engine Python Retornou: ${response.status} - ${textErr}` }, { status: 500 });
      }
      
      const data = await response.json();
      return NextResponse.json(data);
    }
  } catch (err: any) {
    console.error('API Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
