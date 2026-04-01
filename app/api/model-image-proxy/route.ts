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
  const filePath = searchParams.get('file');

  if (!filePath) {
    return new NextResponse('Missing file parameter', { status: 400 });
  }

  try {
    const bucket = admin.storage().bucket(BUCKET_NAME);
    const file = bucket.file(filePath);

    const [exists] = await file.exists();
    if (!exists) {
      return new NextResponse('File not found', { status: 404 });
    }

    const [metadata] = await file.getMetadata();
    const contentType = metadata.contentType || 'image/jpeg';

    const [buffer] = await file.download();

    const gen = metadata.generation != null ? String(metadata.generation) : '';
    // URL com &v=generation muda quando o objeto é substituído → cache seguro por longo prazo
    const hasVersion = searchParams.has('v') && searchParams.get('v') === gen;
    const cacheControl = hasVersion
      ? 'public, max-age=31536000, immutable'
      : 'public, max-age=300, s-maxage=300, stale-while-revalidate=60';

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        ...(gen ? { ETag: `"g${gen}"` } : {}),
        'Cache-Control': cacheControl,
      },
    });
  } catch (error: any) {
    console.error('Error fetching model image:', error);
    return new NextResponse(error.message || 'Internal Server Error', { status: 500 });
  }
}
