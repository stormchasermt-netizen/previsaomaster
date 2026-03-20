/**
 * Perfil do usuário na página Rastros de Tornados.
 * Permite nome customizado e tipo (Meteorologista, Storm Chaser, Observador, Civil).
 * Salvo em Firestore até o usuário alterar no perfil.
 */

import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';

export type RastrosUserType = 'meteorologista' | 'storm_chaser' | 'observador' | 'civil';

export interface RastrosUserProfile {
  displayName: string;
  userType: RastrosUserType;
  updatedAt?: unknown;
}

const COLLECTION = 'rastros_profiles';

const USER_TYPE_LABELS: Record<RastrosUserType, string> = {
  meteorologista: 'Meteorologista',
  storm_chaser: 'Storm Chaser',
  observador: 'Observador',
  civil: 'Civil',
};

export function getRastrosUserTypeLabel(type: RastrosUserType): string {
  return USER_TYPE_LABELS[type];
}

export async function fetchRastrosProfile(uid: string): Promise<RastrosUserProfile | null> {
  if (!db) return null;
  try {
    const snap = await getDoc(doc(db, COLLECTION, uid));
    if (!snap.exists()) return null;
    const data = snap.data();
    return {
      displayName: (data?.displayName as string) ?? '',
      userType: (data?.userType as RastrosUserType) ?? 'civil',
      updatedAt: data?.updatedAt,
    };
  } catch {
    return null;
  }
}

export async function saveRastrosProfile(
  uid: string,
  profile: Omit<RastrosUserProfile, 'updatedAt'>
): Promise<void> {
  if (!db) return;
  await setDoc(
    doc(db, COLLECTION, uid),
    { ...profile, updatedAt: serverTimestamp() },
    { merge: true }
  );
}
