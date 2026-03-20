/**
 * Função 1: Sync de imagens mais recentes.
 * A cada ~10 min, buscar e salvar a imagem mais recente de todos os radares.
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getStorage } from 'firebase-admin/storage';
import { initializeApp } from 'firebase-admin/app';
import {
  CPTEC_STATIONS_FOR_BACKUP,
  ARGENTINA_STATIONS_FOR_BACKUP,
  IPMET_URL,
  findWorkingCptecUrl,
  findWorkingArgentinaUrl,
  fetchPngBuffer,
  getLatestStoragePath,
  getNowTimestamp12UTC,
} from './radarBackupUtils';

initializeApp();

const DELAY_MS = 500;

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export const syncLatestRadarImages = onSchedule(
  {
    schedule: 'every 10 minutes',
    region: 'us-central1',
  },
  async () => {
    const bucket = getStorage().bucket();
    const ts12 = getNowTimestamp12UTC();
    const nominalDate = new Date();

    let okCount = 0;
    let failCount = 0;

    for (const station of CPTEC_STATIONS_FOR_BACKUP) {
      const result = await findWorkingCptecUrl(station, ts12);
      if (result) {
        const buf = await fetchPngBuffer(result.url);
        if (buf) {
          const path = getLatestStoragePath(station.slug, result.ts12);
          await bucket.file(path).save(buf, { contentType: 'image/png' });
          okCount++;
        } else {
          failCount++;
        }
      } else {
        failCount++;
      }
      await delay(DELAY_MS);
    }

    for (const station of ARGENTINA_STATIONS_FOR_BACKUP) {
      const result = await findWorkingArgentinaUrl(station, nominalDate);
      if (result) {
        const buf = await fetchPngBuffer(result.url);
        if (buf) {
          const path = getLatestStoragePath(`argentina:${station.id}`, getTs12FromArgentina(result.tsArgentina));
          await bucket.file(path).save(buf, { contentType: 'image/png' });
          okCount++;
        } else {
          failCount++;
        }
      } else {
        failCount++;
      }
      await delay(DELAY_MS);
    }

    const ipmetBuf = await fetchPngBuffer(IPMET_URL + '?t=' + Date.now());
    if (ipmetBuf) {
      const path = getLatestStoragePath('ipmet-bauru', ts12);
      await bucket.file(path).save(ipmetBuf, { contentType: 'image/png' });
      okCount++;
    } else {
      failCount++;
    }

    console.log(`syncLatestRadarImages: ok=${okCount} fail=${failCount}`);
  }
);

function getTs12FromArgentina(tsArgentina: string): string {
  return tsArgentina.slice(0, 8) + tsArgentina.slice(9, 11) + tsArgentina.slice(11, 13);
}
