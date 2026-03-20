/**
 * Sistema de presença em tempo real usando Firestore.
 * Usuários logados registram sua presença na coleção /presence/{uid}.
 * Um heartbeat atualiza lastSeen a cada 60s.
 * Usuários com lastSeen > 2 min são considerados offline.
 */
import {
  doc,
  setDoc,
  deleteDoc,
  serverTimestamp,
  onSnapshot,
  collection,
  Timestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';

export type RastrosUserType = 'meteorologista' | 'storm_chaser' | 'observador' | 'civil';

export interface PresenceData {
  uid: string;
  displayName: string;
  photoURL?: string | null;
  /** Tipo na página Rastros (Meteorologista, Storm Chaser, Observador, Civil) */
  userType?: RastrosUserType | null;
  /** Latitude (apenas se locationShared = true) */
  lat?: number | null;
  /** Longitude (apenas se locationShared = true) */
  lng?: number | null;
  locationShared: boolean;
  lastSeen: Timestamp | null;
  page?: string;
  /** Se o usuário está transmitindo ao vivo (câmera) */
  isLiveStreaming?: boolean;
  /** ID da sala LiveKit quando transmitindo (para outros assistirem) */
  liveRoomName?: string | null;
}

const PRESENCE_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutos

/** Cria ou atualiza a presença do usuário no Firestore. */
export async function updatePresence(
  uid: string,
  data: Omit<PresenceData, 'uid' | 'lastSeen'>
): Promise<void> {
  if (!db) return;
  await setDoc(
    doc(db, 'presence', uid),
    { ...data, uid, lastSeen: serverTimestamp() },
    { merge: true }
  );
}

/** Remove a presença do usuário (logout / saída da página). */
export async function removePresence(uid: string): Promise<void> {
  if (!db) return;
  try {
    await deleteDoc(doc(db, 'presence', uid));
  } catch { /* ignora erros de remoção */ }
}

/**
 * Assina em tempo real a coleção de presença.
 * O callback recebe apenas os usuários considerados online (lastSeen < 2 min).
 * Retorna função de cancelamento.
 */
export function subscribeToPresence(
  callback: (users: PresenceData[]) => void
): () => void {
  if (!db) return () => {};
  const colRef = collection(db, 'presence');
  const unsubscribe = onSnapshot(colRef, (snap) => {
    const now = Date.now();
    const online: PresenceData[] = [];
    snap.forEach((d) => {
      const data = d.data() as PresenceData;
      const ts = data.lastSeen;
      if (ts) {
        const ms = ts instanceof Timestamp ? ts.toMillis() : 0;
        if (now - ms < PRESENCE_TIMEOUT_MS) {
          online.push({ ...data, uid: d.id });
        }
      }
    });
    callback(online);
  });
  return unsubscribe;
}
