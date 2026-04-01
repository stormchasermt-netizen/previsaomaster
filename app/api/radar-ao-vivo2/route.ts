import { NextRequest, NextResponse } from 'next/server';
import * as admin from 'firebase-admin';
import { getRadarAoVivo2BucketName, isValidRadarAoVivo2StationSlug } from '@/lib/radarAoVivo2Bucket';

export const dynamic = 'force-dynamic';

if (!admin.apps.length) {
  try {
    admin.initializeApp();
  } catch (error) {
    console.error('Erro ao inicializar firebase-admin:', error);
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action');

  try {
    const bucket = admin.storage().bucket(getRadarAoVivo2BucketName());

    if (action === 'listStations') {
      const [, , apiResponse] = await bucket.getFiles({ delimiter: '/' });
      const prefixes = (apiResponse.prefixes || []) as string[];
      const stations = prefixes
        .map((p: string) => p.replace(/\/$/, ''))
        .filter(Boolean)
        .filter(isValidRadarAoVivo2StationSlug)
        .sort();
      return NextResponse.json({ stations });
    }

    if (action === 'listImages') {
      const station = searchParams.get('station');
      if (!station || !isValidRadarAoVivo2StationSlug(station)) {
        return NextResponse.json({ error: 'Missing or invalid station' }, { status: 400 });
      }

      /** ppi = reflectividade (YYYYMMDDHHmm.png); doppler = velocidade (YYYYMMDDHHmm-ppivr.png) */
      const productParam = searchParams.get('product') || 'ppi';
      const product = productParam === 'doppler' ? 'doppler' : 'ppi';

      const prefix = `${station}/`;
      const [files] = await bucket.getFiles({ prefix });

      const imageFiles = files
        .filter((f) => f.name.match(/\.(jpg|jpeg|png|gif)$/i))
        .filter((f) => {
          const base = f.name.split('/').pop() || '';
          if (product === 'doppler') {
            return /^\d{12}-ppivr\.(png|jpg|jpeg|gif)$/i.test(base);
          }
          return /^\d{12}\.(png|jpg|jpeg|gif)$/i.test(base) && !/-ppivr\./i.test(base);
        })
        .sort((a, b) => a.name.localeCompare(b.name));

      const images = await Promise.all(
        imageFiles.map(async (file) => {
          const fileName = file.name.split('/').pop() || '';
          let gen = '';
          try {
            const [meta] = await file.getMetadata();
            gen = meta.generation != null ? String(meta.generation) : '';
          } catch {
            /* ignore */
          }
          const v = gen ? `&v=${encodeURIComponent(gen)}` : '';
          const url = `/api/radar-ao-vivo2-image?file=${encodeURIComponent(file.name)}${v}`;
          return { name: fileName, url };
        })
      );

      return NextResponse.json({ images });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('radar-ao-vivo2 API:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
