/**
 * Rastreamento de visitas diárias no Firestore.
 * Conta uma visita por sessão/dia (sessionStorage) para evitar inflação por refresh.
 */

import { doc, getDoc, setDoc, increment, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';

const COLLECTION = 'daily_visits';
const SESSION_KEY_PREFIX = 'visit_counted_';

function getTodayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Verifica se já registramos uma visita nesta sessão hoje */
function alreadyCountedToday(): boolean {
  if (typeof window === 'undefined') return true;
  return sessionStorage.getItem(SESSION_KEY_PREFIX + getTodayKey()) === '1';
}

/** Marca que contamos uma visita hoje nesta sessão */
function markCountedToday(): void {
  if (typeof window === 'undefined') return;
  sessionStorage.setItem(SESSION_KEY_PREFIX + getTodayKey(), '1');
}

/**
 * Registra uma visita para o dia atual.
 * Só incrementa uma vez por sessão (evita contagem múltipla por refresh).
 */
export async function recordVisit(): Promise<void> {
  if (!db) return;
  if (alreadyCountedToday()) return;
  const dateKey = getTodayKey();
  try {
    const ref = doc(db, COLLECTION, dateKey);
    await setDoc(ref, { count: increment(1), date: dateKey }, { merge: true });
    markCountedToday();
  } catch (e) {
    console.warn('Erro ao registrar visita:', e);
  }
}

/**
 * Obtém o número de visitas do dia atual.
 */
export async function getTodayVisitCount(): Promise<number> {
  if (!db) return 0;
  const dateKey = getTodayKey();
  try {
    const ref = doc(db, COLLECTION, dateKey);
    const snap = await getDoc(ref);
    return snap.exists() ? (snap.data()?.count ?? 0) : 0;
  } catch (e) {
    console.warn('Erro ao obter contagem de visitas:', e);
    return 0;
  }
}

/**
 * Assina em tempo real o contador de visitas do dia.
 * Retorna função de cancelamento.
 */
export function subscribeToTodayVisitCount(callback: (count: number) => void): () => void {
  if (!db) return () => {};
  const dateKey = getTodayKey();
  const ref = doc(db, COLLECTION, dateKey);
  const unsub = onSnapshot(ref, (snap) => {
    callback(snap.exists() ? (snap.data()?.count ?? 0) : 0);
  }, (err: unknown) => {
    console.warn('Erro ao assinar visitas:', err);
    callback(0);
  });
  return unsub;
}
