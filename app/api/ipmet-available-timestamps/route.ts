import { NextRequest, NextResponse } from 'next/server';
import * as admin from 'firebase-admin';

// Inicializa o Admin SDK do Firebase para contornar problemas de permissão (401) no comando LIST.
if (!admin.apps.length) {
  try {
    admin.initializeApp();
  } catch (error) {
    console.error('Erro ao inicializar firebase-admin:', error);
  }
}

const STORAGE_BUCKET = 'studio-4398873450-7cc8f.firebasestorage.app';
const IPMET_PREFIX = 'ipmet-bauru';

/**
 * Endpoint para listar de uma vez todos os timestamps válidos (minutos exatos) 
 * que estão de fato salvos no Storage. Isso permite que o slider do FrontEnd 
 * não fique chutando horários falhos.
 */
export async function GET(req: NextRequest) {
  const ts12 = req.nextUrl.searchParams.get('ts12');
  if (!ts12 || ts12.length !== 12) {
    return NextResponse.json({ error: 'Missing or invalid ts12' }, { status: 400 });
  }

  const y = ts12.slice(0, 4);
  const m = ts12.slice(4, 6);
  const d = ts12.slice(6, 8);
  
  const bucket = admin.storage().bucket(STORAGE_BUCKET);
  const files: any[] = [];

  try {
    const dateObj = new Date(Date.UTC(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10)));
    dateObj.setUTCDate(dateObj.getUTCDate() - 1);
    const prevY = dateObj.getUTCFullYear().toString();
    const prevM = (dateObj.getUTCMonth() + 1).toString().padStart(2, '0');
    const prevD = dateObj.getUTCDate().toString().padStart(2, '0');

    const prefixLegacyToday = `${IPMET_PREFIX}/${y}/${m}/${d}`; // DDHHmmss
    const prefixDayToday = `${IPMET_PREFIX}/${y}/${m}/${d}/`;   // DD/HHmm
    const prefixLegacyYesterday = `${IPMET_PREFIX}/${prevY}/${prevM}/${prevD}`;
    const prefixDayYesterday = `${IPMET_PREFIX}/${prevY}/${prevM}/${prevD}/`;

    // A API getFiles do gcloud filtra do lado do servidor via startsWith
    const prefixes = [prefixLegacyToday, prefixDayToday, prefixLegacyYesterday, prefixDayYesterday];
    
    await Promise.all(prefixes.map(async (p) => {
      const [resFiles] = await bucket.getFiles({ prefix: p });
      files.push(...resFiles);
    }));

  } catch (error) {
    console.error('getFiles erro:', error);
  }

  const validTimestamps = new Set<string>();

  files.forEach(f => {
    if (!f.name?.endsWith('.png')) return;
    
    const parts = f.name.split('/');
    const basename = parts[parts.length - 1].replace('.png', '');
    
    let fileY, fileM, fileD, fileH, fileMin;

    if (parts.length >= 5 && parts[parts.length - 2].length === 2 && !isNaN(Number(parts[parts.length - 2]))) {
      // Subpasta: /YYYY/MM/DD/HHmm
      fileD = parts[parts.length - 2];
      fileM = parts[parts.length - 3];
      fileY = parts[parts.length - 4];
      if (basename.length >= 4) {
        fileH = basename.slice(0, 2);
        fileMin = basename.slice(2, 4);
      }
    } else if (parts.length >= 4) {
      // Legado: /YYYY/MM/DDHHmmss
      fileM = parts[parts.length - 2];
      fileY = parts[parts.length - 3];
      if (basename.length >= 6) {
        fileD = basename.slice(0, 2);
        fileH = basename.slice(2, 4);
        fileMin = basename.slice(4, 6);
      }
    }

    if (fileY && fileM && fileD && fileH && fileMin) {
      validTimestamps.add(`${fileY}${fileM}${fileD}${fileH}${fileMin}`);
    }
  });

  const arr = Array.from(validTimestamps);
  arr.sort((a, b) => b.localeCompare(a)); // Descending: newest first

  return NextResponse.json({ timestamps: arr }, { headers: { 'Cache-Control': 'public, max-age=30' } });
}
