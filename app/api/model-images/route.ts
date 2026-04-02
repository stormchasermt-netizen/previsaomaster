import { NextRequest, NextResponse } from 'next/server';
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  try {
    admin.initializeApp();
  } catch (error) {
    console.error('Erro ao inicializar firebase-admin:', error);
  }
}

const BUCKET_NAME = 'wrf-3km-imagens-diarias';

/** Pastas usadas só como overlay (ex.: contornos) — não são produtos selecionáveis na UI */
const OVERLAY_ONLY_VARIABLE_PREFIXES = new Set(['mlcape_contorno', 'mlcape_contornos']);

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action');

  try {
    const bucket = admin.storage().bucket(BUCKET_NAME);

    if (action === 'listRuns') {
      const [files, , apiResponse] = await bucket.getFiles({ delimiter: '/' });
      let runs = apiResponse.prefixes || [];
      // Clean up the trailing slash and sort descending (newest first)
      runs = runs.map((p: string) => p.replace(/\/$/, '')).sort().reverse();
      return NextResponse.json({ runs });
    }

    if (action === 'listVariables') {
      const run = searchParams.get('run');
      if (!run) return NextResponse.json({ error: 'Missing run parameter' }, { status: 400 });
      
      const [files, , apiResponse] = await bucket.getFiles({ prefix: `${run}/`, delimiter: '/' });
      let variables = apiResponse.prefixes || [];
      variables = variables
        .map((p: string) => p.replace(`${run}/`, '').replace(/\/$/, ''))
        .filter(Boolean)
        .filter((v) => !OVERLAY_ONLY_VARIABLE_PREFIXES.has(v))
        .sort();
      return NextResponse.json({ variables });
    }

    if (action === 'getImages') {
      const run = searchParams.get('run');
      const variable = searchParams.get('variable');
      if (!run || !variable) return NextResponse.json({ error: 'Missing run or variable parameter' }, { status: 400 });
      
      const prefix = `${run}/${variable}/`;
      const [files] = await bucket.getFiles({ prefix });
      
      // Filter out only image files and sort them chronologically
      const imageFiles = files
        .filter(f => f.name.match(/\.(jpg|jpeg|png|gif)$/i))
        .sort((a, b) => a.name.localeCompare(b.name));
        
      // Filter the data files (.npy.gz) to attach them
      const dataFiles = files.filter(f => f.name.match(/\.npy\.gz$/i));
      
      const images = await Promise.all(
        imageFiles.map(async (file) => {
          const fileName = file.name.split('/').pop() || '';
          const baseName = fileName.replace(/\.[^/.]+$/, ""); // strip extension
          
          // Try to find the matching data file
          const dataFile = dataFiles.find(df => df.name.endsWith(`${baseName}.npy.gz`));
          
          // generation muda quando o objeto é sobrescrito no bucket — incluir na URL invalida cache (CDN/navegador)
          let gen = '';
          try {
            const [meta] = await file.getMetadata();
            gen = meta.generation != null ? String(meta.generation) : '';
          } catch {
            /* ignore */
          }
          const v = gen ? `&v=${encodeURIComponent(gen)}` : '';
          const url = `/api/model-image-proxy?file=${encodeURIComponent(file.name)}${v}`;
          
          let dataUrl = null;
          if (dataFile) {
              dataUrl = `/api/model-image-proxy?file=${encodeURIComponent(dataFile.name)}`;
          }

          return {
            name: fileName,
            url,
            dataUrl,
          };
        })
      );
      
      return NextResponse.json({ images });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error: any) {
    console.error('Error fetching model data:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
