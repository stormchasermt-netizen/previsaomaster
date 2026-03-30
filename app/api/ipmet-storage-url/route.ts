import { NextRequest, NextResponse } from 'next/server';
import * as admin from 'firebase-admin';

// Inicializa o Admin SDK do Firebase para contornar problemas de permissão (401) no comando LIST.
// No Firebase App Hosting / Vercel, isso usa a Service Account padrão por debaixo dos panos.
if (!admin.apps.length) {
  try {
    admin.initializeApp();
  } catch (error) {
    console.error('Erro ao inicializar firebase-admin:', error);
  }
}

const STORAGE_BUCKET = 'studio-4398873450-7cc8f.firebasestorage.app';
const IPMET_PREFIX = 'ipmet-bauru';

/** Monta a URL pública de download de um arquivo no Storage. */
function buildDownloadUrl(filePath: string): string {
  const encoded = encodeURIComponent(filePath);
  return `https://firebasestorage.googleapis.com/v0/b/${STORAGE_BUCKET}/o/${encoded}?alt=media`;
}

/**
 * Usa o SDK admin do Firebase para listar arquivos do Storage.
 * Bypassa a restrição de "public list" garantindo que sempre ache os arquivos.
 */
async function listStorageObjects(prefix: string): Promise<string[]> {
  try {
    const bucket = admin.storage().bucket(STORAGE_BUCKET);
    const [files] = await bucket.getFiles({ prefix, maxResults: 15 });
    
    if (!files || files.length === 0) return [];
    return files
      .map(f => f.name)
      .filter(name => name.endsWith('.png'));
  } catch (error) {
    console.error('Erro no admin.storage().getFiles:', error);
    return [];
  }
}

/**
 * Busca imagem IPMET no Storage para o timestamp dado.
 * Usa listagem por prefixo para encontrar qualquer arquivo que comece com HHmm,
 * independente dos segundos (resolve o problema de segundos irregulares).
 *
 * Tenta: 1) path com dia, 2) path legado (sem dia).
 */
export async function GET(req: NextRequest) {
  const ts12 = req.nextUrl.searchParams.get('ts12');
  if (!ts12 || ts12.length !== 12) {
    return NextResponse.json({ error: 'Missing or invalid ts12 (YYYYMMDDHHmm)' }, { status: 400 });
  }

  const maxDiffParam = req.nextUrl.searchParams.get('maxDiff');
  const allowedMaxDiff = maxDiffParam ? parseInt(maxDiffParam, 10) : 15;

  const y = ts12.slice(0, 4);
  const m = ts12.slice(4, 6);
  const d = ts12.slice(6, 8);
  const hh = ts12.slice(8, 10);
  const mm = ts12.slice(10, 12);
  const hhmmPrefix = `${hh}${mm}`;

  // Monta prefixo da hora: se ts12 for "202603191710", d="19", hh="17", mm="10"
  // Buscar pela HORA inteira garante que não percamos o arquivo se os minutos não baterem exato.
  const targetMin = parseInt(mm, 10);
  
  // Função auxiliar para encontrar o arquivo com o minuto mais próximo
  const findClosestFile = (files: string[], basenameExtractor: (f: string) => string, format: 'HH' | 'DDHH') => {
    let bestFile: string | null = null;
    let minDiff = Infinity;
    let bestBasename = '';

    for (const file of files) {
      const base = basenameExtractor(file);
      let fileMin = 0;
      
      if (format === 'DDHH') {
        // Espera DDHHmm ou DDHHmmss: minuto está no índice 4,5
        if (base.length >= 6) {
          fileMin = parseInt(base.slice(4, 6), 10);
        } else {
          continue;
        }
      } else {
        // Espera HHmm ou HHmmss: minuto está no índice 2,3
        if (base.length >= 4) {
          fileMin = parseInt(base.slice(2, 4), 10);
        } else {
          continue;
        }
      }

      const diff = Math.abs(fileMin - targetMin);
      if (diff < minDiff && diff <= allowedMaxDiff) {
        minDiff = diff;
        bestFile = file;
        bestBasename = base;
      }
    }
    return { bestFile, bestBasename };
  };

  // 1) Tenta path com dia: ipmet-bauru/YYYY/MM/DD/HH*.png
  const dayPrefix = `${IPMET_PREFIX}/${y}/${m}/${d}/${hh}`;
  const dayFiles = await listStorageObjects(dayPrefix);
  if (dayFiles.length > 0) {
    const { bestFile, bestBasename } = findClosestFile(
      dayFiles, 
      (f) => f.split('/').pop()?.replace('.png', '') ?? '',
      'HH'
    );
    if (bestFile) {
      return NextResponse.json(
        { url: buildDownloadUrl(bestFile), hhmmss: bestBasename },
        { headers: { 'Cache-Control': 'public, max-age=3600' } }
      );
    }
  }

  // 2) Fallback: path legado (DDHHmm*.png) na pasta do mês ipmet-bauru/YYYY/MM/
  // Os arquivos são frequentemente salvos como DDHHmmss.png direto na pasta do mês.
  const legacyPrefix = `${IPMET_PREFIX}/${y}/${m}/${d}${hh}`;
  const legacyFiles = await listStorageObjects(legacyPrefix);
  if (legacyFiles.length > 0) {
    const { bestFile, bestBasename } = findClosestFile(
      legacyFiles, 
      (f) => f.split('/').pop()?.replace('.png', '') ?? '',
      'DDHH'
    );
    if (bestFile) {
      return NextResponse.json(
        { url: buildDownloadUrl(bestFile), hhmmss: bestBasename },
        { headers: { 'Cache-Control': 'public, max-age=3600' } }
      );
    }
  }

  return NextResponse.json({ url: null });
}
