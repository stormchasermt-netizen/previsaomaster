import { PrevisaoEvent, PrevisaoScore } from './types';

const DB_NAME = 'PrevisaoMasterDB';
const DB_VERSION = 1;
const STORE_EVENTS = 'events';
const STORE_SCORES = 'scores';

// Helper to open DB
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event: any) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_EVENTS)) {
        db.createObjectStore(STORE_EVENTS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_SCORES)) {
        db.createObjectStore(STORE_SCORES, { keyPath: 'id' });
      }
    };

    request.onsuccess = (event: any) => {
      resolve(event.target.result);
    };

    request.onerror = (event: any) => {
      reject(event.target.error);
    };
  });
}

// Generic GetAll
async function getAll<T>(storeName: string): Promise<T[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Generic Put (Insert/Update)
async function put<T>(storeName: string, item: T): Promise<T> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.put(item);

    request.onsuccess = () => resolve(item);
    request.onerror = () => reject(request.error);
  });
}

// Generic Delete
async function remove(storeName: string, id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.delete(id);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// Generic Clear
async function clear(storeName: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.clear();

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// INITIAL MIGRATION FROM LOCALSTORAGE TO INDEXEDDB
async function migrateFromLocalStorage() {
  const MOCK_EVENTS_KEY = 'previsao_master_events';
  const MOCK_SCORES_KEY = 'previsao_master_scores';

  const lsEvents = localStorage.getItem(MOCK_EVENTS_KEY);
  if (lsEvents) {
    try {
      const events = JSON.parse(lsEvents);
      for (const evt of events) {
        await put(STORE_EVENTS, evt);
      }
      localStorage.removeItem(MOCK_EVENTS_KEY); // Clean up LS
      console.log('Migrated Events to IndexedDB');
    } catch (e) {
      console.error('Migration failed for events', e);
    }
  }

  const lsScores = localStorage.getItem(MOCK_SCORES_KEY);
  if (lsScores) {
    try {
      const scores = JSON.parse(lsScores);
      for (const score of scores) {
        await put(STORE_SCORES, score);
      }
      localStorage.removeItem(MOCK_SCORES_KEY); // Clean up LS
      console.log('Migrated Scores to IndexedDB');
    } catch (e) {
      console.error('Migration failed for scores', e);
    }
  }
}

// Run migration once on load
migrateFromLocalStorage();

async function replaceEvents(events: PrevisaoEvent[]): Promise<void> {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_EVENTS, 'readwrite');
    const store = tx.objectStore(STORE_EVENTS);
    store.clear();
    for (const evt of events) {
      store.put(evt);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export const db = {
  getEvents: () => getAll<PrevisaoEvent>(STORE_EVENTS),
  saveEvent: (evt: PrevisaoEvent) => put(STORE_EVENTS, evt),
  deleteEvent: (id: string) => remove(STORE_EVENTS, id),
  replaceEvents,

  getScores: () => getAll<PrevisaoScore>(STORE_SCORES),
  saveScore: (score: PrevisaoScore) => put(STORE_SCORES, score),
  clearScores: () => clear(STORE_SCORES),
};