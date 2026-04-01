import { NextRequest, NextResponse } from 'next/server';
import * as admin from 'firebase-admin';
import { getRadarAoVivo2BucketName, isValidRadarAoVivo2ObjectPath } from '@/lib/radarAoVivo2Bucket';

if (!admin.apps.length) {
  try {
    admin.initializeApp();
  } catch (error) {
    console.error('Erro ao inicializar firebase-admin:', error);
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const filePath = searchParams.get('file');

  if (!filePath || !isValidRadarAoVivo2ObjectPath(filePath)) {
    return new NextResponse('Invalid or missing file parameter', { status: 400 });
  }

  try {
    const bucket = admin.storage().bucket(getRadarAoVivo2BucketName());
    const file = bucket.file(filePath);

    const [exists] = await file.exists();
    if (!exists) {
      return new NextResponse('File not found', { status: 404 });
    }

    const [metadata] = await file.getMetadata();
    const contentType = metadata.contentType || 'image/png';

    const [buffer] = await file.download();

    const gen = metadata.generation != null ? String(metadata.generation) : '';
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
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    console.error('radar-ao-vivo2-image:', error);
    return new NextResponse(message, { status: 500 });
  }
}
