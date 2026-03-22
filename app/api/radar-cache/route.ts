import { NextRequest, NextResponse } from 'next/server';
import * as admin from 'firebase-admin';

// Inicializa o Admin SDK (reutiliza instância existente)
if (!admin.apps.length) {
  try {
    admin.initializeApp();
  } catch (error) {
    console.error('Erro ao inicializar firebase-admin:', error);
  }
}

const STORAGE_BUCKET = 'studio-4398873450-7cc8f.firebasestorage.app';
const RADAR_BACKUP_PREFIX = 'radar_backup';

/**
 * API de cache de imagens de radar no Firebase Storage.
 * 
 * Recebe:
 *   - imageUrl: URL original da imagem de radar (CPTEC, Argentina, etc.)
 *   - radarId: slug do radar (ex: 'santiago', 'argentina:RMA1')
 *   - ts12: timestamp YYYYMMDDHHmm (usado para nome do arquivo)
 *   - productType: 'reflectividade' | 'velocidade' (sufixo do path)
 * 
 * Fluxo:
 *   1. Verifica se já existe no Storage
 *   2. Se não existe, faz download e salva
 *   3. Retorna URL pública do Storage
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { imageUrl, radarId, ts12, productType } = body;

    if (!imageUrl || !radarId || !ts12 || ts12.length < 12) {
      return NextResponse.json({ error: 'Missing params' }, { status: 400 });
    }

    const y = ts12.slice(0, 4);
    const m = ts12.slice(4, 6);
    const d = ts12.slice(6, 8);
    const hh = ts12.slice(8, 10);
    const mm = ts12.slice(10, 12);

    // Sanitizar radarId (argentina:RMA1 → argentina_RMA1)
    const safeRadarId = radarId.replace(/[^a-zA-Z0-9_-]/g, '_');

    // Construir path com sufixo de tipo (vel/ref) para diferenciar
    const suffix = productType === 'velocidade' ? '_vel' : '';
    const storagePath = `${RADAR_BACKUP_PREFIX}/${safeRadarId}/${y}/${m}/${d}${hh}${mm}${suffix}.png`;

    const bucket = admin.storage().bucket(STORAGE_BUCKET);
    const file = bucket.file(storagePath);

    // 1. Verificar se já existe
    const [exists] = await file.exists();
    if (exists) {
      // Já existe — retorna a URL sem sobrescrever
      const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${STORAGE_BUCKET}/o/${encodeURIComponent(storagePath)}?alt=media`;
      return NextResponse.json(
        { cached: true, url: downloadUrl, path: storagePath },
        { headers: { 'Cache-Control': 'public, max-age=3600' } }
      );
    }

    // 2. Fazer download da imagem original
    const imgRes = await fetch(imageUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; radar-cache/1.0)',
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!imgRes.ok) {
      return NextResponse.json({ error: 'Failed to fetch image', status: imgRes.status }, { status: 502 });
    }

    const contentType = imgRes.headers.get('content-type') || '';
    if (!contentType.includes('image')) {
      return NextResponse.json({ error: 'Response is not an image' }, { status: 502 });
    }

    const arrayBuffer = await imgRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 3. Salvar no Storage
    await file.save(buffer, {
      metadata: {
        contentType: 'image/png',
        cacheControl: 'public, max-age=31536000', // Imutável — nunca muda
        metadata: {
          sourceUrl: imageUrl,
          radarId,
          timestamp: ts12,
          productType: productType || 'reflectividade',
          cachedAt: new Date().toISOString(),
        },
      },
    });

    const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${STORAGE_BUCKET}/o/${encodeURIComponent(storagePath)}?alt=media`;

    return NextResponse.json(
      { cached: false, url: downloadUrl, path: storagePath },
      { headers: { 'Cache-Control': 'public, max-age=3600' } }
    );
  } catch (err: unknown) {
    console.error('radar-cache error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'cache failed' },
      { status: 500 }
    );
  }
}
