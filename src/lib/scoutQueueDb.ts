// Mobile POI Scout — IndexedDB glue for the offline queue.
//
// Uses the native IndexedDB API directly to avoid adding a dependency for
// what amounts to <100 lines of glue. The store has a single object store
// keyed by auto-increment id; each entry records the token it was queued
// against and the POI payload. The retry policy lives in scoutStorage.ts;
// this module only reads and writes rows.

import type { PoiType } from '@/types/mapEditor';

const DB_NAME = 'hereday_scout';
const DB_VERSION = 1;
const STORE_NAME = 'pending_pois';

export interface PendingPoi {
  id?: number;
  token: string;
  poi: {
    type: PoiType;
    title: string;
    description?: string;
    coordinates: [number, number];
  };
  queuedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        store.createIndex('token', 'token', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function addPending(token: string, poi: PendingPoi['poi']): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.add({ token, poi, queuedAt: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

/** Every queued item for a token, oldest first (auto-increment key order). */
export async function readAllPending(token: string): Promise<PendingPoi[]> {
  const db = await openDb();
  const items = await new Promise<PendingPoi[]>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => {
      const rows = (req.result as PendingPoi[]).filter((r) => r.token === token);
      resolve(rows);
    };
    req.onerror = () => reject(req.error);
  });
  db.close();
  return items;
}

export async function deletePending(id: number): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
