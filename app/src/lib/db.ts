// Shared IndexedDB plumbing for Library files, Library groups, and History
// — one database, three object stores, same schema legacy/unified-tool.js
// used. No server, no shared backend (see CLAUDE.md, Access & ownership).

export const DB_NAME = "wiredCioUnifiedLeadScannerLibrary_v1";
export const DB_VERSION = 14;
export const STORE_LIBRARY = "files";
export const STORE_GROUPS = "groups";
export const STORE_HISTORY = "history";
export const STORE_RULE_OVERRIDES = "ruleOverrides";
export const STORE_TASKS = "tasks";
export const STORE_CONTACTS = "contacts";
export const STORE_PLATFORM_NOTES = "platformNotes";
export const STORE_PROFILE = "profile";
export const STORE_LEAD_LISTS = "leadLists";
export const STORE_SEQUENCES = "sequences";
export const STORE_SEQUENCE_ENROLLMENTS = "sequenceEnrollments";
export const STORE_WEEKLY_GOALS = "weeklyGoals";
export const STORE_USERS = "users";
export const STORE_SEQUENCE_GROUPS = "sequenceGroups";
export const STORE_EMAIL_ACCOUNTS = "emailAccounts";
export const STORE_DISPOSITIONS = "dispositions";
export const STORE_COMPANY_PROFILES = "companyProfiles";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error("This browser doesn't support local file storage."));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_LIBRARY)) db.createObjectStore(STORE_LIBRARY, { keyPath: "id" });
      if (!db.objectStoreNames.contains(STORE_GROUPS)) db.createObjectStore(STORE_GROUPS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(STORE_HISTORY)) db.createObjectStore(STORE_HISTORY, { keyPath: "id" });
      if (!db.objectStoreNames.contains(STORE_RULE_OVERRIDES)) db.createObjectStore(STORE_RULE_OVERRIDES, { keyPath: "id" });
      if (!db.objectStoreNames.contains(STORE_TASKS)) db.createObjectStore(STORE_TASKS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(STORE_CONTACTS)) db.createObjectStore(STORE_CONTACTS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(STORE_PLATFORM_NOTES)) db.createObjectStore(STORE_PLATFORM_NOTES, { keyPath: "id" });
      if (!db.objectStoreNames.contains(STORE_PROFILE)) db.createObjectStore(STORE_PROFILE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(STORE_LEAD_LISTS)) db.createObjectStore(STORE_LEAD_LISTS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(STORE_SEQUENCES)) db.createObjectStore(STORE_SEQUENCES, { keyPath: "id" });
      if (!db.objectStoreNames.contains(STORE_SEQUENCE_ENROLLMENTS)) db.createObjectStore(STORE_SEQUENCE_ENROLLMENTS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(STORE_WEEKLY_GOALS)) db.createObjectStore(STORE_WEEKLY_GOALS, { keyPath: "weekKey" });
      if (!db.objectStoreNames.contains(STORE_USERS)) db.createObjectStore(STORE_USERS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(STORE_SEQUENCE_GROUPS)) db.createObjectStore(STORE_SEQUENCE_GROUPS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(STORE_EMAIL_ACCOUNTS)) db.createObjectStore(STORE_EMAIL_ACCOUNTS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(STORE_DISPOSITIONS)) db.createObjectStore(STORE_DISPOSITIONS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(STORE_COMPANY_PROFILES)) db.createObjectStore(STORE_COMPANY_PROFILES, { keyPath: "key" });
    };
    req.onsuccess = () => {
      const db = req.result;
      // Another tab opening a NEWER version later would otherwise leave
      // this connection blocking it forever. Close on demand so the other
      // tab can upgrade, and tell this one to reload rather than sitting
      // on a dead handle.
      db.onversionchange = () => {
        db.close();
        if (typeof window !== "undefined") {
          window.alert("This app was updated in another tab. Reload this tab to continue.");
        }
      };
      resolve(db);
    };
    // Fires when ANOTHER tab still holds an older version open. Without
    // this handler neither onsuccess nor onerror ever fires and the whole
    // app hangs on its loading state with no message at all — the one
    // storage failure mode that looks like a frozen page rather than an
    // error. Found by the code audit.
    req.onblocked = () =>
      reject(
        new Error(
          "Another tab has an older version of this app open. Close the other tabs and reload."
        )
      );
    req.onerror = () => reject(req.error || new Error("Could not open local file storage."));
  });
}

// Every call below opens its own fresh connection via openDB() (simplest
// way to share one function across a page that's never tracking a long-
// lived handle) — closed once its transaction settles, either way, so a
// long editing session doesn't accumulate hundreds of open connections,
// and a future DB_VERSION bump isn't stalled behind old open ones.
export async function dbGetAll<T>(storeName: string): Promise<T[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
    tx.onerror = () => db.close();
    tx.onabort = () => db.close();
  });
}

export async function dbPut<T>(storeName: string, entry: T): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put(entry);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => db.close();
  });
}

export async function dbDelete(storeName: string, id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).delete(id);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => db.close();
  });
}
