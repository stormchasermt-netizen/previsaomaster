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
      variables = variables.map((p: string) => p.replace(`${run}/`, '').replace(/\/$/, '')).filter(Boolean).sort();
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
      
      const expires = Date.now() + 1000 * 60 * 60 * 24; // 24 hours
      const images = await Promise.all(
        imageFiles.map(async (file) => {
          let url = '';
          const fileName = file.name.split('/').pop() || '';
          try {
            // Attempt to generate a signed URL (requires Service Account credentials to be present)
            const [signedUrl] = await file.getSignedUrl({ action: 'read', expires });
            url = signedUrl;
          } catch(err) {
            // Fallback: se estiver rodando local sem Service Account e não conseguir assinar a URL, tenta devolver a URL pública direta
            url = `https://storage.googleapis.com/${BUCKET_NAME}/${file.name}`;
          }
          
          return {
            name: fileName,
            url
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
