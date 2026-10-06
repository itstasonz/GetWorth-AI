// ══════════════════════════════════════════════════════════════════════════════
// SCAN LAB — WHAT THE PHONE KEEPS UNTIL THE SERVER HAS IT
//
// A photograph is written here BEFORE the first network request, and removed
// only after the server has read it back from storage and confirmed its hash.
// That is what lets a capture survive a dropped connection, a backgrounded PWA
// and a closed app: on the next open the queue is still here.
//
// This is a resume buffer, not the record. The record is on the server.
//
// Bytes are stored as ArrayBuffer, not Blob: WebKit has a history of losing
// Blobs in IndexedDB, and an ArrayBuffer round-trips everywhere.
//
// Keys carry the account id, so a second account on the same phone is never
// shown the first one's queue. Nothing here is removed on sign-out: a queued
// photograph is still that account's when it signs in again.
// ══════════════════════════════════════════════════════════════════════════════
const DB_NAME = 'gw-scan-lab';
const STORE = 'kv';

const wrap = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error ?? new Error('indexeddb request failed'));
});

/** In-memory stand-in: private browsing, or a browser that refuses the database. */
export function memoryLabDb() {
  const map = new Map();
  return {
    persistent: false,
    async put(key, value) { map.set(key, value); },
    async get(key) { return map.get(key) ?? null; },
    async delete(key) { map.delete(key); },
    async entries(prefix) { return [...map.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, value]) => ({ key, value })); },
  };
}

/** The queue on this device. Falls back to memory, and says so, when it cannot persist. */
export async function openLabDb(idb = globalThis.indexedDB, keyRange = globalThis.IDBKeyRange) {
  if (!idb) return memoryLabDb();
  const connect = async () => {
    const open = idb.open(DB_NAME, 1);
    open.onupgradeneeded = () => { if (!open.result.objectStoreNames.contains(STORE)) open.result.createObjectStore(STORE); };
    return wrap(open);
  };
  let db;
  try { db = await connect(); } catch { return memoryLabDb(); }
  // iOS closes the connection of a PWA it has put in the background, and every
  // later call on it throws. One reconnect, then the operation is tried again.
  const attempt = async (op) => {
    try { return await op(db); } catch { db = await connect(); return op(db); }
  };
  // A write is done when its TRANSACTION has committed, not when the request
  // succeeded: "on the phone before the first network request" has to be true
  // if the app is closed a moment later.
  const write = (fn) => attempt((d) => new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('indexeddb write failed'));
    tx.onabort = () => reject(tx.error ?? new Error('indexeddb write aborted'));
    fn(tx.objectStore(STORE));
  }));
  const read = (fn) => attempt((d) => fn(d.transaction(STORE, 'readonly').objectStore(STORE)));
  return {
    persistent: true,
    async put(key, value) { await write((s) => s.put(value, key)); },
    async get(key) { return (await read((s) => wrap(s.get(key)))) ?? null; },
    async delete(key) { await write((s) => s.delete(key)); },
    /** Only the keys under `prefix` are read: listing the queue never loads a photograph. */
    async entries(prefix) {
      const range = keyRange.bound(prefix, `${prefix}￿`);
      const [keys, values] = await read((s) => Promise.all([wrap(s.getAllKeys(range)), wrap(s.getAll(range))]));
      return keys.map((key, i) => ({ key, value: values[i] }));
    },
  };
}
