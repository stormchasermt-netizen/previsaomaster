import {
  collection,
  doc,
  addDoc,
  setDoc,
  getDocs,
  deleteDoc,
  serverTimestamp,
  increment,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { inferCountryFromTrack, type TornadoTrack, type FScale, type TrackImageBounds, type PrevotsPolygon } from '@/lib/tornadoTracksData';

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

function prevotsPolygonsFromFirestore(raw: unknown): PrevotsPolygon[] {
  if (!Array.isArray(raw)) return [];
  const result: PrevotsPolygon[] = [];
  raw.forEach((p: any) => {
    const level = Number(p?.level ?? 0);
    if (level < 0 || level > 4) return;
    let coords: number[][][] = [];
    if (typeof p?.coordinatesJson === 'string') {
      try {
        coords = JSON.parse(p.coordinatesJson);
      } catch { coords = []; }
    } else if (Array.isArray(p?.coordinates)) coords = p.coordinates;
    if (!Array.isArray(coords) || coords.length === 0) return;
    result.push({ level: level as any, coordinates: coords });
  });
  return result;
}

function prevotsPolygonsToFirestore(prevots: PrevotsPolygon[]) {
  return prevots.map((p) => ({
    level: p.level,
    coordinatesJson: JSON.stringify(p.coordinates),
  }));
}

export async function fetchTornadoTracks(): Promise<TornadoTrack[]> {
  if (!db) return [];
  const col = collection(db, COLLECTION);
  const snap = await getDocs(col);
  const list = snap.docs.map((d) => {
    const data = d.data();
    const polygonsRaw = Array.isArray(data.polygons) ? data.polygons : [];
    const bounds = data.trackImageBounds;
    const createdAtMs = typeof data.createdAt?.toMillis === 'function' ? data.createdAt.toMillis() : undefined;
    const updatedAtMs = typeof data.updatedAt?.toMillis === 'function' ? data.updatedAt.toMillis() : undefined;
    const baseTrack: TornadoTrack = {
      id: d.id,
      date: data.date || '',
      time: data.time ?? undefined,
      polygons: polygonsFromFirestore(polygonsRaw),
      prevotsPolygons: prevotsPolygonsFromFirestore(data.prevotsPolygons),
      country: data.country ?? undefined,
      state: data.state || '',
      locality: data.locality,
      description: data.description,
      source: data.source,
      views: typeof data.views === 'number' ? data.views : 0,
      radarWmsUrl: data.radarWmsUrl ?? undefined,
      radarStationId: data.radarStationId ?? undefined,
      beforeImage: data.beforeImage,
      afterImage: data.afterImage,
      beforeImageBounds: data.beforeImageBounds && typeof data.beforeImageBounds.ne?.lat === 'number'
        ? { ne: data.beforeImageBounds.ne, sw: data.beforeImageBounds.sw }
        : undefined,
      afterImageBounds: data.afterImageBounds && typeof data.afterImageBounds.ne?.lat === 'number'
        ? { ne: data.afterImageBounds.ne, sw: data.afterImageBounds.sw }
        : undefined,
      trackImage: data.trackImage ?? undefined,
      trackImageBounds: bounds && typeof bounds.ne?.lat === 'number' && typeof bounds.sw?.lat === 'number'
        ? { ne: bounds.ne, sw: bounds.sw }
        : undefined,
      createdAtMs,
      updatedAtMs,
      radarLat: typeof data.radarLat === 'number' ? data.radarLat : undefined,
      radarLng: typeof data.radarLng === 'number' ? data.radarLng : undefined,
      radarRangeKm: typeof data.radarRangeKm === 'number' ? data.radarRangeKm : undefined,
      radarRotation: typeof data.radarRotation === 'number' ? data.radarRotation : undefined,
      radarOpacity: typeof data.radarOpacity === 'number' ? data.radarOpacity : undefined,
      radarChromaKey: typeof data.radarChromaKey === 'number' ? data.radarChromaKey : undefined,
      radarCropTop: typeof data.radarCropTop === 'number' ? data.radarCropTop : undefined,
      radarCropBottom: typeof data.radarCropBottom === 'number' ? data.radarCropBottom : undefined,
      radarCropLeft: typeof data.radarCropLeft === 'number' ? data.radarCropLeft : undefined,
      radarCropRight: typeof data.radarCropRight === 'number' ? data.radarCropRight : undefined,
      radarCustomBounds: data.radarCustomBounds && typeof data.radarCustomBounds.north === 'number' ? data.radarCustomBounds : undefined,
      radarOverrides: data.radarOverrides && typeof data.radarOverrides === 'object' ? data.radarOverrides : undefined,
      secondaryAfterImages: Array.isArray(data.secondaryAfterImages) ? data.secondaryAfterImages : undefined,
    };
    return {
      ...baseTrack,
      country: inferCountryFromTrack(baseTrack),
    };
  });
  return list.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

export async function saveTornadoTrack(track: TornadoTrackInput, adminId: string): Promise<string> {
  if (!db) throw new Error('Firestore não inicializado');
  const payload = {
    date: track.date,
    time: track.time || null,
    polygons: polygonsToFirestore(track.polygons),
    prevotsPolygons: prevotsPolygonsToFirestore(track.prevotsPolygons ?? []),
    country: track.country || null,
    state: track.state,
    locality: track.locality || null,
    description: track.description || null,
    source: track.source || null,
    views: track.views ?? 0,
    radarWmsUrl: track.radarWmsUrl || null,
    radarStationId: track.radarStationId || null,
    beforeImage: track.beforeImage || null,
    afterImage: track.afterImage || null,
    beforeImageBounds: track.beforeImageBounds || null,
    afterImageBounds: track.afterImageBounds || null,
    trackImage: track.trackImage || null,
    trackImageBounds: track.trackImageBounds || null,
    // Overrides de radar
    radarLat: track.radarLat ?? null,
    radarLng: track.radarLng ?? null,
    radarRangeKm: track.radarRangeKm ?? null,
    radarRotation: track.radarRotation ?? null,
    radarOpacity: track.radarOpacity ?? null,
    radarChromaKey: track.radarChromaKey ?? null,
    radarCropTop: track.radarCropTop ?? null,
    radarCropBottom: track.radarCropBottom ?? null,
    radarCropLeft: track.radarCropLeft ?? null,
    radarCropRight: track.radarCropRight ?? null,
    radarCustomBounds: track.radarCustomBounds ?? null,
    radarOverrides: track.radarOverrides ?? null,
    secondaryAfterImages: track.secondaryAfterImages ?? null,
    adminId,
    updatedAt: serverTimestamp(),
  };
  if (track.id) {
    await setDoc(doc(db, COLLECTION, track.id), { ...payload, updatedAt: serverTimestamp() }, { merge: true });
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

export async function incrementTrackViews(id: string): Promise<void> {
  if (!db) return;
  try {
    await setDoc(doc(db, COLLECTION, id), { views: increment(1) }, { merge: true });
  } catch (err) {
    console.error('Error incrementing track views:', err);
  }
}
