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

/** Monta a URL pública de download de um arquivo no Storage. */
function buildDownloadUrl(filePath: string): string {
  const encoded = encodeURIComponent(filePath);
  return `https://firebasestorage.googleapis.com/v0/b/${STORAGE_BUCKET}/o/${encoded}?alt=media`;
}

/**
 * Busca a imagem de radar mais recente no Storage para o radar e timestamp dados.
 * Path: radar_backup/{radarId}/{year}/{month}/{diahhmm}.png
 * 
 * Estratégia: lista arquivos com prefixo do dia+hora e encontra o mais próximo do minuto solicitado.
 * Se não encontrar na hora solicitada, tenta a hora anterior.
 */
export async function GET(req: NextRequest) {
  const radarId = req.nextUrl.searchParams.get('radarId');
  const ts12 = req.nextUrl.searchParams.get('ts12');
  const productType = req.nextUrl.searchParams.get('productType') || 'reflectividade';
  const maxDiffParam = req.nextUrl.searchParams.get('maxDiff');
  const allowedMaxDiff = maxDiffParam ? parseInt(maxDiffParam, 10) : 120;

  if (!radarId || !ts12 || ts12.length !== 12) {
    return NextResponse.json({ error: 'Missing or invalid params (radarId, ts12)' }, { status: 400 });
  }

  const y = ts12.slice(0, 4);
  const m = ts12.slice(4, 6);
  const d = ts12.slice(6, 8);
  const hh = ts12.slice(8, 10);
  const mm = ts12.slice(10, 12);
  const targetMin = parseInt(mm, 10);

  try {
    const bucket = admin.storage().bucket(STORAGE_BUCKET);

    const isVel = productType === 'velocidade';
    const suffix = isVel ? '_vel.png' : '.png';

    // 1. Tenta encontrar na hora solicitada: radar_backup/{radarId}/{year}/{month}/{day}{HH}
    const hourPrefix = `${RADAR_BACKUP_PREFIX}/${radarId}/${y}/${m}/${d}${hh}`;
    let [files] = await bucket.getFiles({ prefix: hourPrefix, maxResults: 50 });
    let pngFiles = files.filter(f => f.name.endsWith(suffix));

    // 2. Se não encontrou na hora solicitada, tenta a hora anterior
    if (pngFiles.length === 0) {
      const prevHour = String(Math.max(0, parseInt(hh, 10) - 1)).padStart(2, '0');
      const prevHourPrefix = `${RADAR_BACKUP_PREFIX}/${radarId}/${y}/${m}/${d}${prevHour}`;
      [files] = await bucket.getFiles({ prefix: prevHourPrefix, maxResults: 50 });
      pngFiles = files.filter(f => f.name.endsWith(suffix));
    }

    // 3. Se ainda não encontrou, tenta listar TODOS do dia (qualquer hora)
    if (pngFiles.length === 0) {
      const dayPrefix = `${RADAR_BACKUP_PREFIX}/${radarId}/${y}/${m}/${d}`;
      [files] = await bucket.getFiles({ prefix: dayPrefix, maxResults: 100 });
      pngFiles = files.filter(f => f.name.endsWith(suffix));
    }

    if (pngFiles.length === 0) {
      return NextResponse.json({ url: null, reason: 'no_files_found' }, { headers: { 'Cache-Control': 'public, max-age=300' } });
    }

    // Encontra o mais próximo do timestamp solicitado
    let bestFile: string | null = null;
    let minDiff = Infinity;

    for (const file of pngFiles) {
      const basename = file.name.split('/').pop()?.replace('.png', '') ?? '';
      // basename = "212330" (DDHHmm) → dia=21, hora=23, min=30
      if (basename.length < 6) continue;

      const fileDay = parseInt(basename.slice(0, 2), 10);
      const fileHour = parseInt(basename.slice(2, 4), 10);
      const fileMin = parseInt(basename.slice(4, 6), 10);

      // Calcula diferença em minutos absolutos
      const targetTotalMin = parseInt(d, 10) * 1440 + parseInt(hh, 10) * 60 + targetMin;
      const fileTotalMin = fileDay * 1440 + fileHour * 60 + fileMin;
      const diff = Math.abs(fileTotalMin - targetTotalMin);

      if (diff < minDiff) {
        minDiff = diff;
        bestFile = file.name;
      }
    }

    if (!bestFile || minDiff > allowedMaxDiff) {
      return NextResponse.json({ url: null, reason: 'no_close_match' }, { headers: { 'Cache-Control': 'public, max-age=300' } });
    }

    const basename = bestFile.split('/').pop()?.replace(suffix, '') ?? '';
    return NextResponse.json(
      { url: buildDownloadUrl(bestFile), basename, diffMinutes: minDiff },
      { headers: { 'Cache-Control': 'public, max-age=300' } }
    );
  } catch (err: unknown) {
    console.error('radar-storage-fallback error:', err);
    return NextResponse.json(
      { url: null, error: err instanceof Error ? err.message : 'storage search failed' },
      { status: 500 }
    );
  }
}
