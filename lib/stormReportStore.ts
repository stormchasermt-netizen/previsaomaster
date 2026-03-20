import {
  collection,
  addDoc,
  getDocs,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp,
  doc,
  getDoc,
  runTransaction,
  type Timestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from './firebase';

const REPORT_VIEWS_COL = 'report_views';
const SESSION_VIEW_PREFIX = 'report_viewed_';

export interface StormReport {
  id?: string;
  userId: string;
  displayName: string;
  lat: number;
  lng: number;
  type: 'ven' | 'gra' | 'tor';
  detail?: string;
  mediaType?: 'file' | 'link';
  mediaUrl?: string;
  createdAt?: Timestamp;
  dateISO: string;
}

const COL = 'storm_reports';

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function uploadReportMedia(file: File, reportId: string): Promise<string> {
  if (!storage) throw new Error('Firebase Storage não configurado');
  const ext = file.name.split('.').pop() ?? 'bin';
  const storageRef = ref(storage, `${COL}/${reportId}/${Date.now()}.${ext}`);
  const snap = await uploadBytes(storageRef, file);
  return getDownloadURL(snap.ref);
}

export async function saveStormReport(
  data: Omit<StormReport, 'id' | 'createdAt'>,
  file?: File | null,
): Promise<string> {
  if (!db) throw new Error('Firestore não inicializado');
  const col = collection(db, COL);
  const clean: Record<string, unknown> = { createdAt: serverTimestamp() };
  for (const [k, v] of Object.entries(data)) {
    if (v !== undefined) clean[k] = v;
  }
  const docRef = await addDoc(col, clean);

  if (file) {
    const url = await uploadReportMedia(file, docRef.id);
    const { doc: docFn, updateDoc } = await import('firebase/firestore');
    await updateDoc(docFn(db, COL, docRef.id), { mediaUrl: url, mediaType: 'file' });
  }

  return docRef.id;
}

export async function fetchTodayStormReports(): Promise<StormReport[]> {
  if (!db) return [];
  const col = collection(db, COL);
  const q = query(col, where('dateISO', '==', todayISO()), orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as StormReport));
}

export function subscribeToTodayReports(
  callback: (reports: StormReport[]) => void,
): Unsubscribe {
  if (!db) return () => {};
  const col = collection(db, COL);
  const q = query(col, where('dateISO', '==', todayISO()), orderBy('createdAt', 'desc'));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() } as StormReport)));
  });
}

/** Verifica se o relato já foi contado como visualizado nesta sessão */
function alreadyViewedReport(reportId: string): boolean {
  if (typeof window === 'undefined') return true;
  return sessionStorage.getItem(SESSION_VIEW_PREFIX + reportId) === '1';
}

/** Marca que o relato foi visualizado nesta sessão */
function markReportViewed(reportId: string): void {
  if (typeof window === 'undefined') return;
  sessionStorage.setItem(SESSION_VIEW_PREFIX + reportId, '1');
}

/**
 * Registra uma visualização do relato e retorna o novo total.
 * Só incrementa uma vez por sessão por relato.
 */
export async function recordReportView(reportId: string): Promise<number> {
  if (!db) return 0;
  if (alreadyViewedReport(reportId)) {
    const docRef = doc(db, REPORT_VIEWS_COL, reportId);
    const snap = await getDoc(docRef);
    return snap.exists() ? (snap.data()?.count ?? 0) : 0;
  }
  try {
    const docRef = doc(db, REPORT_VIEWS_COL, reportId);
    const newCount = await runTransaction(db, async (tx) => {
      const snap = await tx.get(docRef);
      const current = snap.exists() ? (snap.data()?.count ?? 0) : 0;
      const next = current + 1;
      tx.set(docRef, { count: next, reportId }, { merge: true });
      return next;
    });
    markReportViewed(reportId);
    return newCount;
  } catch (e) {
    console.warn('Erro ao registrar visualização do relato:', e);
    return 0;
  }
}

/** Obtém o número de visualizações de um relato */
export async function getReportViewCount(reportId: string): Promise<number> {
  if (!db) return 0;
  try {
    const docRef = doc(db, REPORT_VIEWS_COL, reportId);
    const snap = await getDoc(docRef);
    return snap.exists() ? (snap.data()?.count ?? 0) : 0;
  } catch (e) {
    console.warn('Erro ao obter visualizações do relato:', e);
    return 0;
  }
}
