import {
  collection,
  doc,
  setDoc,
  getDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';

const COLLECTION = 'app_configs';
const SOUNDING_LAYOUT_DOC = 'sounding_layout';

export interface SoundingBoxConfig {
  id: string;
  rel_x: number;
  rel_y: number;
  w: number;
  h: number;
  params: string[];
  font_size?: number;
}

export async function fetchSoundingLayout(): Promise<SoundingBoxConfig[] | null> {
  if (!db) return null;
  try {
    const d = await getDoc(doc(db, COLLECTION, SOUNDING_LAYOUT_DOC));
    if (d.exists()) {
      return d.data().layout as SoundingBoxConfig[];
    }
  } catch (err) {
    console.error("Erro ao buscar layout de sondagem:", err);
  }
  return null;
}

export async function saveSoundingLayout(layout: SoundingBoxConfig[]): Promise<void> {
  if (!db) throw new Error('Firestore não inicializado');
  await setDoc(doc(db, COLLECTION, SOUNDING_LAYOUT_DOC), {
    layout,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}
