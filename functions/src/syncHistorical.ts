/**
 * Função 2: Backup histórico (2014 até hoje).
 * Processa 1 radar + 1 dia por invocação. Descobre intervalo correto e baixa imagens.
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onCall } from 'firebase-functions/v2/https';
import { getStorage } from 'firebase-admin/storage';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeApp } from 'firebase-admin/app';
import {
  CPTEC_STATIONS_FOR_BACKUP,
  ARGENTINA_STATIONS_FOR_BACKUP,
  UNIVERSAL_FALLBACK_CONFIGS,
  buildCptecPngUrl,
  buildArgentinaPngUrl,
  fetchPngBuffer,
  getHistoricalStoragePath,
  type CptecStation,
  type ArgentinaStation,
} from './radarBackupUtils';

initializeApp();

const PROGRESS_COLLECTION = 'radar_backup_progress';
const DELAY_MS = 300;
const START_YEAR = 2014;

type RadarKind = 'cptec' | 'argentina';

interface ProgressDoc {
  radarId: string;
  radarKind: RadarKind;
  lastProcessedDate: string;
  status: 'idle' | 'running' | 'completed';
  updatedAt: unknown;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Retorna próximo par (radar, dia) a processar. */
async function getNextToProcess(): Promise<{
  radarId: string;
  radarKind: RadarKind;
  dateStr: string;
  station: CptecStation | ArgentinaStation;
} | null> {
  const db = getFirestore();

  const cptecRadars = CPTEC_STATIONS_FOR_BACKUP.map((s) => ({
    radarId: s.slug,
    radarKind: 'cptec' as RadarKind,
    station: s,
  }));
  const argentinaRadars = ARGENTINA_STATIONS_FOR_BACKUP.map((s) => ({
    radarId: `argentina:${s.id}`,
    radarKind: 'argentina' as RadarKind,
    station: s,
  }));
  const allRadars = [...cptecRadars, ...argentinaRadars];

  const today = new Date().toISOString().slice(0, 10);
  let best: { radarId: string; radarKind: RadarKind; dateStr: string; station: CptecStation | ArgentinaStation; lastDate: string } | null = null;

  for (const { radarId, radarKind, station } of allRadars) {
    const docRef = db.collection(PROGRESS_COLLECTION).doc(radarId);
    const snap = await docRef.get();
    let lastDate = today;
    if (snap.exists) {
      const data = snap.data() as ProgressDoc;
      lastDate = data.lastProcessedDate || today;
    }

    const last = new Date(lastDate + 'T00:00:00Z');
    last.setDate(last.getDate() - 1);
    const dateStr = last.toISOString().slice(0, 10);
    const y = parseInt(dateStr.slice(0, 4), 10);
    if (y < START_YEAR) continue;

    if (!best || lastDate > best.lastDate) {
      best = { radarId, radarKind, dateStr, station, lastDate };
    }
  }
  return best ? { radarId: best.radarId, radarKind: best.radarKind, dateStr: best.dateStr, station: best.station } : null;
}

/** Testa se alguma URL do dia retorna 200 para o intervalo dado. */
async function testIntervalCptec(
  station: CptecStation,
  dateStr: string,
  interval: number,
  offset: number
): Promise<boolean> {
  const testSlots = ['0000', '1200', '2300'];
  for (const hhmm of testSlots) {
    const [h, m] = [parseInt(hhmm.slice(0, 2), 10), parseInt(hhmm.slice(2, 4), 10)];
    const totalMin = h * 60 + m;
    const snapped = Math.round((totalMin - offset) / interval) * interval + offset;
    const nh = Math.floor(snapped / 60) % 24;
    const nm = snapped % 60;
    const ts12 = dateStr.replace(/-/g, '') + String(nh).padStart(2, '0') + String(nm).padStart(2, '0');
    const url = buildCptecPngUrl(station, ts12);
    const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(8000) });
    if (res.ok) return true;
  }
  return false;
}

/** Gera todos os HHmm do dia para intervalo/offset. */
function generateSlotsForDay(interval: number, offset: number): string[] {
  const slots: string[] = [];
  for (let t = offset; t <= 23 * 60 + 55; t += interval) {
    const h = Math.floor(t / 60);
    const m = t % 60;
    slots.push(String(h).padStart(2, '0') + String(m).padStart(2, '0'));
  }
  return slots;
}

async function processCptecDay(
  station: CptecStation,
  radarId: string,
  dateStr: string,
  bucket: ReturnType<ReturnType<typeof getStorage>['bucket']>
): Promise<number> {
  let bestInterval = 10;
  let bestOffset = 0;
  for (const { interval, offset } of UNIVERSAL_FALLBACK_CONFIGS) {
    const ok = await testIntervalCptec(station, dateStr, interval, offset);
    if (ok) {
      bestInterval = interval;
      bestOffset = offset;
      break;
    }
  }

  const slots = generateSlotsForDay(bestInterval, bestOffset);
  const dateStrCompact = dateStr.replace(/-/g, '');
  let count = 0;
  for (const hhmm of slots) {
    const ts12 = dateStrCompact + hhmm;
    const url = buildCptecPngUrl(station, ts12);
    const buf = await fetchPngBuffer(url);
    if (buf) {
      const path = getHistoricalStoragePath(radarId, dateStr, hhmm);
      const file = bucket.file(path);
      const [exists] = await file.exists();
      if (!exists) {
        await file.save(buf, { contentType: 'image/png' });
        count++;
      }
    }
    await delay(DELAY_MS);
  }
  return count;
}

async function processArgentinaDay(
  station: ArgentinaStation,
  radarId: string,
  dateStr: string,
  bucket: ReturnType<ReturnType<typeof getStorage>['bucket']>
): Promise<number> {
  const interval = station.updateIntervalMinutes;
  const offset = 0;
  const slots = generateSlotsForDay(interval, offset);
  const dateStrCompact = dateStr.replace(/-/g, '');
  let count = 0;
  for (const hhmm of slots) {
    const tsArgentina = dateStrCompact + 'T' + hhmm.slice(0, 2) + hhmm.slice(2, 4) + '00Z';
    const url = buildArgentinaPngUrl(station, tsArgentina);
    const buf = await fetchPngBuffer(url);
    if (buf) {
      const path = getHistoricalStoragePath(radarId, dateStr, hhmm);
      const file = bucket.file(path);
      const [exists] = await file.exists();
      if (!exists) {
        await file.save(buf, { contentType: 'image/png' });
        count++;
      }
    }
    await delay(DELAY_MS);
  }
  return count;
}

async function runHistoricalSync(): Promise<{ radarId: string; dateStr: string; saved: number } | null> {
  const next = await getNextToProcess();
  if (!next) return null;

  const db = getFirestore();
  const docRef = db.collection(PROGRESS_COLLECTION).doc(next.radarId);
  await docRef.set(
    {
      radarId: next.radarId,
      radarKind: next.radarKind,
      lastProcessedDate: next.dateStr,
      status: 'running',
      updatedAt: new Date(),
    },
    { merge: true }
  );

  const bucket = getStorage().bucket();
  let saved = 0;
  if (next.radarKind === 'cptec') {
    saved = await processCptecDay(next.station as CptecStation, next.radarId, next.dateStr, bucket);
  } else {
    saved = await processArgentinaDay(next.station as ArgentinaStation, next.radarId, next.dateStr, bucket);
  }

  await docRef.set(
    {
      lastProcessedDate: next.dateStr,
      status: 'idle',
      updatedAt: new Date(),
    },
    { merge: true }
  );

  return { radarId: next.radarId, dateStr: next.dateStr, saved };
}

export const syncHistoricalRadarImages = onSchedule(
  {
    schedule: '0 3 * * *',
    region: 'us-central1',
    timeoutSeconds: 540,
  },
  async () => {
    const result = await runHistoricalSync();
    if (result) {
      console.log(`syncHistoricalRadarImages: ${result.radarId} ${result.dateStr} saved=${result.saved}`);
    } else {
      console.log('syncHistoricalRadarImages: no work');
    }
  }
);

export const syncHistoricalRadarImagesManual = onCall(
  { region: 'us-central1', timeoutSeconds: 540 },
  async () => {
    const result = await runHistoricalSync();
    if (result) {
      return { ok: true, radarId: result.radarId, dateStr: result.dateStr, saved: result.saved };
    }
    return { ok: true, message: 'no work' };
  }
);
