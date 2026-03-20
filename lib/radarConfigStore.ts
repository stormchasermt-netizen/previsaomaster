/**
 * Configurações de radares meteorológicos (bounds e URL template).
 * Permite ao admin posicionar a imagem no mapa e salvar bounds para overlay correto.
 */

import {
  collection,
  doc,
  setDoc,
  getDocs,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';

export interface TrackImageBounds {
  ne: { lat: number; lng: number };
  sw: { lat: number; lng: number };
}

export interface RadarConfig {
  id: string;
  /** Slug da estação (chapeco, santiago, etc.) */
  stationSlug: string;
  /** Nome de exibição */
  name: string;
  /**
   * Template da URL PNG. Use {year}, {month}, {ts12} como placeholders.
   * Ex: https://s1.cptec.inpe.br/radar/sdcsc/chapeco/ppi/ppicz/{year}/{month}/R12137761_{ts12}.png
   */
  urlTemplate: string;
  /** Bounds para posicionar overlay no mapa */
  bounds: TrackImageBounds;
  /** Lat/lng da antena (para cálculo de distância) */
  lat: number;
  lng: number;
  /** Alcance em km */
  rangeKm: number;
  /** Intervalo de atualização em minutos (6 ou 10). Santiago usa 10. */
  updateIntervalMinutes?: number;
  /** Rotação da imagem em graus (ex: -110, 1.5) para alinhamento no mapa. */
  rotationDegrees?: number;
  /** Opacidade da imagem no mapa (0–1). Padrão 0.75. */
  opacity?: number;
  updatedAtMs?: number;
}

const COLLECTION = 'radar_configs';

function parseConfig(docId: string, data: Record<string, unknown>): RadarConfig {
  const b = data.bounds as Record<string, unknown>;
  const neRaw = b?.ne as { lat?: number; lng?: number } | undefined;
  const swRaw = b?.sw as { lat?: number; lng?: number } | undefined;
  const ne = { lat: neRaw?.lat ?? 0, lng: neRaw?.lng ?? 0 };
  const sw = { lat: swRaw?.lat ?? 0, lng: swRaw?.lng ?? 0 };
  const updatedAtMs =
    typeof (data.updatedAt as any)?.toMillis === 'function'
      ? (data.updatedAt as any).toMillis()
      : undefined;
  return {
    id: docId,
    stationSlug: (data.stationSlug as string) || '',
    name: (data.name as string) || '',
    urlTemplate: (data.urlTemplate as string) || '',
    bounds: { ne, sw },
    lat: typeof data.lat === 'number' ? data.lat : 0,
    lng: typeof data.lng === 'number' ? data.lng : 0,
    rangeKm: typeof data.rangeKm === 'number' ? data.rangeKm : 250,
    updateIntervalMinutes: typeof data.updateIntervalMinutes === 'number' ? data.updateIntervalMinutes : undefined,
    rotationDegrees: typeof data.rotationDegrees === 'number' ? data.rotationDegrees : undefined,
    opacity: typeof data.opacity === 'number' ? data.opacity : undefined,
    updatedAtMs,
  };
}

export async function fetchRadarConfigs(): Promise<RadarConfig[]> {
  if (!db) return [];
  const col = collection(db, COLLECTION);
  const snap = await getDocs(col);
  return snap.docs.map((d) => parseConfig(d.id, d.data()));
}

export async function saveRadarConfig(config: Omit<RadarConfig, 'id'> & { id?: string }): Promise<string> {
  if (!db) throw new Error('Firestore não inicializado');
  const payload = {
    stationSlug: config.stationSlug,
    name: config.name,
    urlTemplate: config.urlTemplate,
    bounds: config.bounds,
    lat: config.lat,
    lng: config.lng,
    rangeKm: config.rangeKm,
    updateIntervalMinutes: config.updateIntervalMinutes ?? null,
    rotationDegrees: config.rotationDegrees ?? null,
    opacity: config.opacity ?? null,
    updatedAt: serverTimestamp(),
  };
  const id = config.id || config.stationSlug;
  await setDoc(doc(db, COLLECTION, id), payload, { merge: true });
  return id;
}

/**
 * Substitui placeholders na URL template.
 * ts12 = YYYYMMDDHHmm
 *
 * IMPORTANTE: Ano e mês no path (ex: 2025/11/) devem ser coerentes com o ts12.
 * Se o template tiver YYYY/MM/ fixo (ex: 2025/11), sobrescrevemos com ano/mês do ts12
 * para evitar 404 (path 2025/11 com arquivo R12137761_202603170042.png).
 */
export function buildRadarPngUrl(urlTemplate: string, ts12: string): string {
  const y = ts12.slice(0, 4);
  const m = ts12.slice(4, 6);
  const d = ts12.slice(6, 8);
  const hh = ts12.slice(8, 10);
  const mm = ts12.slice(10, 12);
  const tsArgentina = `${y}${m}${d}T${hh}${mm}00Z`;

  return urlTemplate
    .replace(/\{year\}/g, y)
    .replace(/\{month\}/g, m)
    .replace(/\{day\}/g, d)
    .replace(/\{hh\}/g, hh)
    .replace(/\{mm\}/g, mm)
    .replace(/\{ts12\}/g, ts12)
    .replace(/\{tsArgentina\}/g, tsArgentina);
}