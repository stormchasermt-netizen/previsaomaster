import { doc, setDoc, increment, collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';

const COLLECTION = 'radar_views';

export async function incrementRadarViews(radarSlugId: string): Promise<void> {
  if (!db || !radarSlugId) return;
  try {
    await setDoc(doc(db, COLLECTION, radarSlugId), { views: increment(1) }, { merge: true });
  } catch (err) {
    // Silenciar erros de permissão para não quebrar a UI
    return;
  }
}

export async function fetchAllRadarViews(): Promise<Record<string, number>> {
  if (!db) return {};
  try {
    const snap = await getDocs(collection(db, COLLECTION));
    const views: Record<string, number> = {};
    snap.docs.forEach((d) => {
      views[d.id] = d.data().views || 0;
    });
    return views;
  } catch (err) {
    // Erro de permissão silencioso para não travar a UI
    return {};
  }
}
