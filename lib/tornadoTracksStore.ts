import {
  collection,
  doc,
  addDoc,
  setDoc,
  getDocs,
  deleteDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { TornadoTrack, FScale } from '@/lib/tornadoTracksData';

const COLLECTION = 'tornado_tracks';

export type TornadoTrackInput = Omit<TornadoTrack, 'id'> & { id?: string };

/** Firestore não suporta arrays aninhados; guardamos coordinates como JSON string. */
function polygonsToFirestore(polygons: { intensity: FScale; coordinates: number[][][] }[]) {
  return polygons.map((p) => ({
    intensity: p.intensity,
    coordinatesJson: JSON.stringify(p.coordinates),
  }));
}

function polygonsFromFirestore(polygons: { intensity?: string; coordinatesJson?: string; coordinates?: number[][][] }[]): TornadoTrack['polygons'] {
  return polygons.map((p: any) => {
    let coordinates: number[][][] = [];
    if (typeof p.coordinatesJson === 'string') {
      try {
        coordinates = JSON.parse(p.coordinatesJson);
      } catch {
        coordinates = [];
      }
    } else if (Array.isArray(p.coordinates)) {
      coordinates = p.coordinates;
    }
    return {
      intensity: (p.intensity || 'F0') as FScale,
      coordinates: Array.isArray(coordinates) ? coordinates : [],
    };
  });
}

export async function fetchTornadoTracks(): Promise<TornadoTrack[]> {
  if (!db) return [];
  const col = collection(db, COLLECTION);
  const snap = await getDocs(col);
  const list = snap.docs.map((d) => {
    const data = d.data();
    const polygonsRaw = Array.isArray(data.polygons) ? data.polygons : [];
    return {
      id: d.id,
      date: data.date || '',
      polygons: polygonsFromFirestore(polygonsRaw),
      state: data.state || '',
      locality: data.locality,
      description: data.description,
      source: data.source,
      beforeImage: data.beforeImage,
      afterImage: data.afterImage,
    };
  });
  return list.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

export async function saveTornadoTrack(track: TornadoTrackInput): Promise<string> {
  if (!db) throw new Error('Firestore não inicializado');
  const payload = {
    date: track.date,
    polygons: polygonsToFirestore(track.polygons),
    state: track.state,
    locality: track.locality || null,
    description: track.description || null,
    source: track.source || null,
    beforeImage: track.beforeImage || null,
    afterImage: track.afterImage || null,
    updatedAt: serverTimestamp(),
  };
  if (track.id) {
    await setDoc(doc(db, COLLECTION, track.id), { ...payload, updatedAt: serverTimestamp() });
    return track.id;
  }
  const ref = await addDoc(collection(db, COLLECTION), {
    ...payload,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function deleteTornadoTrack(id: string): Promise<void> {
  if (!db) throw new Error('Firestore não inicializado');
  await deleteDoc(doc(db, COLLECTION, id));
}
