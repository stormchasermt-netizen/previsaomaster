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

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        // Cache na borda por um longo periodo para economizar requests no Storage
        'Cache-Control': 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=86400',
      },
    });
  } catch (error: any) {
    console.error('Error fetching model image:', error);
    return new NextResponse(error.message || 'Internal Server Error', { status: 500 });
  }
}
