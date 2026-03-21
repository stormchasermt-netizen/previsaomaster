import {
  collection,
  doc,
  addDoc,
  setDoc,
  getDocs,
  deleteDoc,
  serverTimestamp,
  query,
  where,
  orderBy,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { PrevotsForecast, PrevotsPolygon } from '@/lib/prevotsForecastData';

const COLLECTION = 'prevots_forecasts';

export type PrevotsForecastInput = Omit<PrevotsForecast, 'id'> & { id?: string };

function polygonsToFirestore(polygons: PrevotsPolygon[]) {
  return polygons.map((p) => ({
    level: p.level,
    coordinatesJson: JSON.stringify(p.coordinates),
  }));
}

function polygonsFromFirestore(raw: unknown): PrevotsPolygon[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((p: any) => {
      const level = Number(p?.level ?? 0);
      if (level < 0 || level > 4) return null;
      let coords: number[][][] = [];
      if (typeof p?.coordinatesJson === 'string') {
        try {
          coords = JSON.parse(p.coordinatesJson);
        } catch {
          coords = [];
        }
      } else if (Array.isArray(p?.coordinates)) coords = p.coordinates;
      if (!Array.isArray(coords) || coords.length === 0) return null;
      return { level: level as 0 | 1 | 2 | 3 | 4, coordinates: coords };
    })
    .filter((x): x is PrevotsPolygon => x != null);
}

export async function fetchPrevotsForecasts(): Promise<PrevotsForecast[]> {
  if (!db) return [];
  const col = collection(db, COLLECTION);
  const q = query(col, orderBy('date', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => {
    const data = d.data();
    const createdAtMs = typeof data.createdAt?.toMillis === 'function' ? data.createdAt.toMillis() : undefined;
    const updatedAtMs = typeof data.updatedAt?.toMillis === 'function' ? data.updatedAt.toMillis() : undefined;
    return {
      id: d.id,
      date: data.date || '',
      polygons: polygonsFromFirestore(data.polygons),
      createdAtMs,
      updatedAtMs,
      adminId: data.adminId ?? undefined,
      xUrl: data.xUrl ?? undefined,
      instagramUrl: data.instagramUrl ?? undefined,
    };
  });
}

export async function fetchPrevotsForecastByDate(date: string): Promise<PrevotsForecast | null> {
  if (!db) return null;
  const col = collection(db, COLLECTION);
  const q = query(col, where('date', '==', date));
  const snap = await getDocs(q);
  const d = snap.docs[0];
  if (!d) return null;
  const data = d.data();
  const createdAtMs = typeof data.createdAt?.toMillis === 'function' ? data.createdAt.toMillis() : undefined;
  const updatedAtMs = typeof data.updatedAt?.toMillis === 'function' ? data.updatedAt.toMillis() : undefined;
  return {
    id: d.id,
    date: data.date || '',
    polygons: polygonsFromFirestore(data.polygons),
    createdAtMs,
    updatedAtMs,
    adminId: data.adminId ?? undefined,
    xUrl: data.xUrl ?? undefined,
    instagramUrl: data.instagramUrl ?? undefined,
  };
}

export async function savePrevotsForecast(forecast: PrevotsForecastInput, adminId: string): Promise<string> {
  if (!db) throw new Error('Firestore não inicializado');
  const payload = {
    date: forecast.date,
    polygons: polygonsToFirestore(forecast.polygons),
    adminId,
    xUrl: forecast.xUrl ?? null,
    instagramUrl: forecast.instagramUrl ?? null,
    updatedAt: serverTimestamp(),
  };
  if (forecast.id) {
    await setDoc(doc(db, COLLECTION, forecast.id), { ...payload, updatedAt: serverTimestamp() }, { merge: true });
    return forecast.id;
  }
  const ref = await addDoc(collection(db, COLLECTION), {
    ...payload,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function deletePrevotsForecast(id: string): Promise<void> {
  if (!db) throw new Error('Firestore não inicializado');
  await deleteDoc(doc(db, COLLECTION, id));
}
