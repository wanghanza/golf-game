// Recordings stored in IndexedDB (per device, inside the app).

const DB = 'golf-swing-reader';
const STORE = 'recordings';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    const out = fn(store);
    t.oncomplete = () => resolve(out?.result ?? out);
    t.onerror = () => reject(t.error);
  });
}

export const recordings = {
  async list() {
    try {
      const all = await tx('readonly', (s) => s.getAll());
      return (all || []).sort((a, b) => (a.meta.createdAt < b.meta.createdAt ? 1 : -1));
    } catch (e) {
      console.warn('IndexedDB unavailable', e);
      return [];
    }
  },
  async put(rec) {
    return tx('readwrite', (s) => s.put(rec));
  },
  async remove(id) {
    return tx('readwrite', (s) => s.delete(id));
  },
};
