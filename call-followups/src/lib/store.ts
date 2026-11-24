// Where follow-up rows live.
//
// Inside the claude.ai viewer: the Artifact `db` capability, under the
// viewer's PRIVATE path (data/users/<id>/…), so statuses and drafts survive
// a cleared browser and follow Jack across devices. Outside a viewer (local
// dev, tests): this browser's IndexedDB. Same interface either way.
import { useCapability, type ClaudeDb, type ClaudeUser, type DbCollectionRef } from "./runtime";

const IDB_NAME = "wiredCioCallFollowups_v1";
const IDB_STORE = "followUps";

let cloudPromise: Promise<DbCollectionRef | null> | null = null;
function cloud(): Promise<DbCollectionRef | null> {
  if (!cloudPromise) {
    cloudPromise = (async () => {
      const [db, user] = await Promise.all([useCapability<ClaudeDb>("db"), useCapability<ClaudeUser>("user")]);
      if (!db || !user) return null;
      try {
        const id = await user.id();
        return id ? db.collection(`data/users/${id}`) : null;
      } catch {
        return null;
      }
    })();
  }
  return cloudPromise;
}

export async function storageMode(): Promise<"cloud" | "browser"> {
  return (await cloud()) ? "cloud" : "browser";
}

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error("This browser can't store follow-ups."));
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) req.result.createObjectStore(IDB_STORE, { keyPath: "callId" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("Couldn't open local storage."));
    req.onblocked = () => reject(new Error("Another tab has an older version open. Close it and reload."));
  });
}

// db documents reject `undefined` values; drop them.
function clean<T extends object>(row: T): Record<string, unknown> {
  return JSON.parse(JSON.stringify(row));
}

export async function loadRows<T>(): Promise<T[]> {
  const col = await cloud();
  if (col) {
    const snap = await col.limit(1000).get();
    return snap.docs.filter((d) => d.exists && d.id.startsWith("fu_")).map((d) => d.data() as T);
  }
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).getAll();
    req.onsuccess = () => resolve((req.result || []) as T[]);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

export async function saveRow<T extends { callId: string }>(row: T): Promise<void> {
  const col = await cloud();
  if (col) {
    await col.doc(`fu_${row.callId}`).set(clean(row));
    return;
  }
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(row);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error || new Error("Storage is full.")); };
  });
}
