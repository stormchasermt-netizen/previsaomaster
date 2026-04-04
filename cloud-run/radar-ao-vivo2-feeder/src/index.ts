import express, { Request, Response } from 'express';
import { Storage, type Bucket } from '@google-cloud/storage';
import {
  DEFAULT_SYNC_SLUGS,
  CPTEC_STATIONS,
  SLUGS_WITHOUT_CDN_SYNC,
  getNowTimestamp12UTC,
  fetchIpmetImage,
  fetchClimatempoPoa,
  downloadCptecImagesInWindow,
  downloadArgentinaImagesInWindow,
  downloadRedemetImagesInWindow,
  downloadSimeparImagesInWindow,
  downloadIpmetRainviewerInWindow,
  downloadSigmaImagesInWindow,
  ts12ToUtcMs,
} from './radarFetch.js';

const storage = new Storage();

const PORT = process.env.PORT || '8080';
const GCS_BUCKET = process.env.GCS_BUCKET || 'radar_ao_vivo_2';
const CRON_SECRET = process.env.CRON_SECRET || '';

const SYNC_WINDOW_MINUTES = Math.max(5, parseInt(process.env.SYNC_WINDOW_MINUTES || '60', 10) || 60);
const RETENTION_MINUTES = Math.max(1, parseInt(process.env.RETENTION_MINUTES || '60', 10) || 60);

/** Se true (default), corre sync + cleanup em ciclo sem precisar de HTTP. */
const ENABLE_AUTO_JOBS = process.env.ENABLE_AUTO_JOBS !== 'false';
/** Intervalo entre ciclos automáticos (ms). Default 5 min. */
const AUTO_JOB_INTERVAL_MS = Math.max(
  60_000,
  parseInt(process.env.AUTO_JOB_INTERVAL_MS || String(5 * 60 * 1000), 10) || 5 * 60 * 1000
);
/** Espera antes do 1.º ciclo (ms), para o health check do Cloud Run. */
const AUTO_JOB_START_DELAY_MS = Math.max(0, parseInt(process.env.AUTO_JOB_START_DELAY_MS || '8000', 10) || 0);

const SYNC_SLUGS = process.env.SYNC_SLUGS
  ? process.env.SYNC_SLUGS.split(/[,^;]/)
      .map((s) => s.trim())
      .filter(Boolean)
  : [...DEFAULT_SYNC_SLUGS];

const app = express();
app.use(express.json());

let lastSyncAt: string | null = null;
let lastCleanupAt: string | null = null;
let lastAutoError: string | null = null;
let jobRunning = false;

function requireSecret(req: Request, res: Response, next: express.NextFunction) {
  if (!CRON_SECRET) {
    console.warn('⚠️ CRON_SECRET not set. Protected endpoints are public!');
    return next();
  }
  const token = req.header('x-cron-secret') || req.query.secret;
  if (token !== CRON_SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function saveIfNotExists(
  bucket: Bucket,
  slug: string,
  fileName: string,
  buffer: Buffer,
  sourceUrl: string
): Promise<{ status: 'uploaded' | 'skipped' | 'failed'; path?: string; reason?: string }> {
  const objectPath = `${slug}/${fileName}`;
  const file = bucket.file(objectPath);
  try {
    const [exists] = await file.exists();
    if (exists) {
      return { status: 'skipped', path: objectPath, reason: 'Already exists' };
    }
    await file.save(buffer, {
      contentType: 'image/png',
      metadata: {
        cacheControl: 'public, max-age=31536000',
        metadata: { sourceUrl },
      },
    });
    return { status: 'uploaded', path: objectPath };
  } catch {
    return { status: 'failed', reason: 'GCS save failed', path: objectPath };
  }
}

async function executeSync(targetSlug?: string): Promise<{
  ok: boolean;
  nominalTs12: string;
  bucket: string;
  okCount: number;
  failCount: number;
  results: unknown[];
}> {
  const bucket = storage.bucket(GCS_BUCKET);
  const nominalTs12 = getNowTimestamp12UTC();
  const results: unknown[] = [];
  let okCount = 0;
  let failCount = 0;

  const slugsToProcess = targetSlug ? [targetSlug] : SYNC_SLUGS;

  for (const slug of slugsToProcess) {
    if (SLUGS_WITHOUT_CDN_SYNC.has(slug)) {
      results.push({
        slug,
        status: 'skipped_no_cdn_feed',
        detail: 'Sem feed CPTEC neste serviço — pasta só para cleanup ou conteúdo manual',
      });
      continue;
    }

        if (slug === 'ipmet-bauru') {
      const checkExists = async (fileName: string) => {
        const [exists] = await bucket.file(`${slug}/${fileName}`).exists();
        return exists;
      };

      console.log('[SYNC] ipmet-bauru: Usando fetchIpmetImage...');
      // We will only do fallback directly because user asked to use the cloud function
      const r = await fetchIpmetImage(nominalTs12);
      if (r) {
        const fileName = `${r.ts12}.png`;
        const exists = await checkExists(fileName);
        if (!exists) {
          const r2 = await saveIfNotExists(bucket, slug, fileName, r.buffer, 'ipmet_proxy');
          results.push({ slug, source: 'fallback', ...r2 });
          r2.status === 'failed' ? failCount++ : okCount++;
        } else {
          results.push({ slug, source: 'fallback', status: 'skipped', reason: 'Already exists' });
        }
      } else {
        results.push({ slug, source: 'fallback', status: 'failed', reason: 'Buffer fetch failed' });
        failCount++;
      }
      await delay(400);
      continue;
    }

    if (slug === 'climatempo-poa') {
      const r = await fetchClimatempoPoa(nominalTs12);
      if (r) {
        const r2 = await saveIfNotExists(bucket, slug, `${r.ts12}.png`, r.buffer, 'climatempo');
        results.push({ slug, ...r2 });
        r2.status === 'failed' ? failCount++ : okCount++;
      } else {
        results.push({ slug, status: 'failed', reason: 'Buffer fetch failed' });
        failCount++;
      }
      await delay(400);
      continue;
    }

    const checkExists = async (fileName: string) => {
      const [exists] = await bucket.file(`${slug}/${fileName}`).exists();
      return exists;
    };

    let found;
    if (slug.startsWith('argentina-')) {
      found = await downloadArgentinaImagesInWindow(slug, nominalTs12, SYNC_WINDOW_MINUTES, {
        checkExists,
      });
    } else if (slug.startsWith('redemet-')) {
      found = await downloadRedemetImagesInWindow(slug, nominalTs12, SYNC_WINDOW_MINUTES, {
        checkExists,
      });
    } else if (slug.startsWith('sigma-')) {
      found = await downloadSigmaImagesInWindow(slug, nominalTs12, SYNC_WINDOW_MINUTES, {
        checkExists,
      });
    } else if (slug === 'simepar-cascavel') {
      found = await downloadSimeparImagesInWindow(slug, nominalTs12, SYNC_WINDOW_MINUTES, {
        checkExists,
      });
    } else {
      const station = CPTEC_STATIONS[slug];
      if (!station) {
        results.push({ slug, status: 'error', error: 'Slug not supported' });
        failCount++;
        continue;
      }
      found = await downloadCptecImagesInWindow(station, slug, nominalTs12, SYNC_WINDOW_MINUTES, {
        checkExists,
      });
    }

    const slugResults: { ts12: string; layer?: string; status: string; path?: string; reason?: string }[] =
      [];
    for (const { ts12, layer, fileName, url, buffer } of found) {
      const r2 = await saveIfNotExists(bucket, slug, fileName, buffer, url);
      slugResults.push({ ts12, layer, status: r2.status, path: r2.path, reason: r2.reason });
      if (r2.status === 'failed') failCount++;
      else okCount++;
      await delay(200);
    }

    if (found.length === 0) {
      results.push({ slug, status: 'no_images_in_window', windowMinutes: SYNC_WINDOW_MINUTES });
      failCount++;
    } else {
      results.push({ slug, status: 'ok', files: slugResults.length, detail: slugResults });
    }
  }

  return {
    ok: true,
    nominalTs12,
    bucket: GCS_BUCKET,
    okCount,
    failCount,
    results,
  };
}

async function executeCleanup(): Promise<{
  ok: boolean;
  bucket: string;
  retentionMinutes: number;
  retentionMs: number;
  deletedCount: number;
  deleted: string[];
  skippedNonMatchingPattern: number;
  errors: { name: string; error: string }[];
}> {
  const bucket = storage.bucket(GCS_BUCKET);
  const retentionMs = RETENTION_MINUTES * 60 * 1000;
  const deleted: string[] = [];
  const skipped: string[] = [];
  const errors: { name: string; error: string }[] = [];

  for (const slug of SYNC_SLUGS) {
    const prefix = `${slug}/`;
    const [files] = await bucket.getFiles({ prefix });

    // Primeiro encontramos o timestamp mais recente nesta pasta,
    // para não apagar as imagens de radares que estejam atrasados (ex: 6 horas offline).
    let maxTsMs = 0;
    const fileData = files.map(f => {
      const base = f.name.split('/').pop() || '';
      const m = /^(\d{12})(?:-ppivr)?\.(png|jpg|jpeg|gif)$/i.exec(base);
      const isDoppler = /-ppivr\./i.test(base);
      if (!m) return { f, valid: false, t: 0, isDoppler: false };
      const ts12 = m[1];
      const t = ts12ToUtcMs(ts12);
      if (t > maxTsMs) maxTsMs = t;
      return { f, valid: true, t, isDoppler };
    });

    // Se a pasta estiver vazia ou sem imagens válidas, usamos Date.now()
    const referenceTimeMs = maxTsMs > 0 ? maxTsMs : Date.now();

    // Contagem para reter apenas as 12 mais recentes (por layer)
    const validFiles = fileData.filter((x) => x.valid).sort((a, b) => b.t - a.t);
    const ppiRetained = new Set<string>();
    const dopRetained = new Set<string>();
    let ppiCount = 0;
    let dopCount = 0;

    // A regra de tempo antigo (retentionMs) continua a valer, mas adicionamos o cap de 12 imagens.
    for (const { f, valid, t, isDoppler } of validFiles) {
      const ageMs = referenceTimeMs - t;
      let shouldDelete = !Number.isFinite(ageMs);

      // Limita a 12 de cada tipo, mesmo que estejam dentro do tempo
      if (!shouldDelete) {
        if (!isDoppler) {
          ppiCount++;
          if (ppiCount > 12) shouldDelete = true;
          else ppiRetained.add(f.name);
        } else {
          dopCount++;
          if (dopCount > 12) shouldDelete = true;
          else dopRetained.add(f.name);
        }
      }

      if (shouldDelete) {
        try {
          await f.delete();
          deleted.push(f.name);
        } catch (e) {
          errors.push({ name: f.name, error: String(e) });
        }
      }
    }

    // Ficheiros inválidos
    for (const { f, valid } of fileData) {
      if (!valid) skipped.push(f.name);
    }
    
    await delay(100);
  }

  return {
    ok: true,
    bucket: GCS_BUCKET,
    retentionMinutes: RETENTION_MINUTES,
    retentionMs,
    deletedCount: deleted.length,
    deleted,
    skippedNonMatchingPattern: skipped.length,
    errors,
  };
}

async function runAutoCycle(): Promise<void> {
  if (jobRunning) {
    console.warn('[auto] Ciclo anterior ainda a correr — a saltar este tick.');
    return;
  }
  jobRunning = true;
  lastAutoError = null;
  try {
    console.log('[auto] Sync…', new Date().toISOString());
    const syncResult = await executeSync();
    lastSyncAt = new Date().toISOString();
    console.log(
      `[auto] Sync OK nominalTs12=${syncResult.nominalTs12} okCount=${syncResult.okCount} failCount=${syncResult.failCount}`
    );

    console.log('[auto] Cleanup…');
    const cleanupResult = await executeCleanup();
    lastCleanupAt = new Date().toISOString();
    console.log(`[auto] Cleanup OK deleted=${cleanupResult.deletedCount}`);
  } catch (e) {
    lastAutoError = String(e);
    console.error('[auto] Erro:', e);
  } finally {
    jobRunning = false;
  }
}

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    bucket: GCS_BUCKET,
    slugs: SYNC_SLUGS.length,
    syncWindowMinutes: SYNC_WINDOW_MINUTES,
    retentionMinutes: RETENTION_MINUTES,
    autoJobs: ENABLE_AUTO_JOBS,
    autoJobIntervalMs: AUTO_JOB_INTERVAL_MS,
    lastSyncAt,
    lastCleanupAt,
    lastAutoError,
    jobRunning,
  });
});

app.all('/sync', requireSecret, async (req, res) => {
  try {
    const targetSlug = req.query.slug as string | undefined;
    const out = await executeSync(targetSlug);
    lastSyncAt = new Date().toISOString();
    res.json(out);
  } catch (error) {
    console.error('Sync error:', error);
    res.status(500).json({ error: String(error) });
  }
});

app.all('/cleanup', requireSecret, async (req, res) => {
  try {
    const out = await executeCleanup();
    lastCleanupAt = new Date().toISOString();
    res.json(out);
  } catch (error) {
    console.error('Cleanup error:', error);
    res.status(500).json({ error: String(error) });
  }
});

app.listen(PORT, () => {
  console.log(`[radar-ao-vivo2-feeder] Listening on port ${PORT}`);
  console.log(`Bucket: ${GCS_BUCKET}`);
  console.log(
    `Sync window: ${SYNC_WINDOW_MINUTES} min, retention ${RETENTION_MINUTES} min`
  );
  console.log(`Slugs (${SYNC_SLUGS.length}):`, SYNC_SLUGS.join(', '));

  if (ENABLE_AUTO_JOBS) {
    console.log(
      `[auto] Jobs automáticos ON — intervalo ${AUTO_JOB_INTERVAL_MS} ms, 1.º ciclo após ${AUTO_JOB_START_DELAY_MS} ms`
    );
    setTimeout(() => {
      void runAutoCycle();
      setInterval(() => void runAutoCycle(), AUTO_JOB_INTERVAL_MS);
    }, AUTO_JOB_START_DELAY_MS);
  } else {
    console.log('[auto] Jobs automáticos OFF (ENABLE_AUTO_JOBS=false) — usar POST /sync e /cleanup');
  }
});
