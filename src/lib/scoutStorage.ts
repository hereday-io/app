// Mobile POI Scout — offline buffer.
//
// Last-resort stash for scout POI submissions that failed with a network
// error. We do not pretend to be a full offline-first sync engine — this
// is a single-queue write-and-retry, nothing more.
//
// Implementation uses the native IndexedDB API directly to avoid adding
// a dependency for what amounts to <100 lines of glue. The store has a
// single object store keyed by auto-increment id; each entry records
// the token it was queued against and the POI payload.

import type { PoiType } from '@/types/mapEditor';
import { submitScoutedPoi } from '@/lib/scoutApi';

const DB_NAME = 'hereday_scout';
const DB_VERSION = 1;
const STORE_NAME = 'pending_pois';

interface PendingPoi {
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

/** Stash a POI that failed to submit so it can be retried later. */
export async function saveScoutPending(
  token: string,
  poi: PendingPoi['poi'],
): Promise<void> {
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

async function readAllPending(token: string): Promise<PendingPoi[]> {
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

async function deletePending(id: number): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

/**
 * Attempt to flush every pending POI for a given token. Silent — callers
 * fire-and-forget. Items that succeed are removed; items that fail stay
 * queued and will be retried the next time this runs.
 */
export async function flushScoutPending(token: string): Promise<number> {
  if (!navigator.onLine) return 0;
  let flushed = 0;
  try {
    const pending = await readAllPending(token);
    for (const entry of pending) {
      try {
        await submitScoutedPoi({ token: entry.token, poi: entry.poi });
        if (entry.id != null) await deletePending(entry.id);
        flushed += 1;
      } catch (err) {
        // Stop flushing on the first failure — assume the network is
        // still bad and we'll try again on the next trigger.
        console.warn('[scoutStorage] flush item failed, will retry later', err);
        break;
      }
    }
  } catch (err) {
    console.warn('[scoutStorage] flush read failed', err);
  }
  return flushed;
}

/** Count pending items for a token, for UI badges. */
export async function countScoutPending(token: string): Promise<number> {
  try {
    const items = await readAllPending(token);
    return items.length;
  } catch {
    return 0;
  }
}
