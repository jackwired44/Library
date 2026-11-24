// Backup / restore.
//
// v1 covered three stores (Library files, Library folders, History). That
// left twelve more — Contacts, Tasks, Sequences, enrollments, Lead Lists,
// custom dispositions, company profiles, outreach attempts and the rest —
// completely unprotected while the button said "Backup everything." v2
// covers every store in lib/db.ts.
//
// The restore contract is unchanged and load-bearing: a restore MERGES by
// key (upsert), it never wipes. A row already in the browser and absent
// from the backup file survives; a row present in both is overwritten by
// the file's copy. That is what makes restoring a stale backup safe.
import type { LibraryEntry, LibraryGroup } from "./library";
import { normalizeGroup } from "./library";
import type { HistoryEntry } from "./history";
import {
  dbGetAll,
  dbPut,
  STORE_RULE_OVERRIDES,
  STORE_TASKS,
  STORE_CONTACTS,
  STORE_PLATFORM_NOTES,
  STORE_PROFILE,
  STORE_LEAD_LISTS,
  STORE_SEQUENCES,
  STORE_SEQUENCE_ENROLLMENTS,
  STORE_WEEKLY_GOALS,
  STORE_USERS,
  STORE_SEQUENCE_GROUPS,
  STORE_EMAIL_ACCOUNTS,
  STORE_DISPOSITIONS,
  STORE_COMPANY_PROFILES,
  STORE_OUTREACH_ATTEMPTS,
} from "./db";

// Every store BEYOND the three v1 already carried, with the key each one
// is keyed by (see lib/db.ts's createObjectStore calls — these must stay
// in step, which is why the key is stated here rather than assumed "id").
export const EXTRA_STORES: { store: string; key: string; label: string }[] = [
  { store: STORE_CONTACTS, key: "id", label: "Contacts" },
  { store: STORE_TASKS, key: "id", label: "Tasks" },
  { store: STORE_LEAD_LISTS, key: "id", label: "Lead lists" },
  { store: STORE_SEQUENCES, key: "id", label: "Sequences" },
  { store: STORE_SEQUENCE_ENROLLMENTS, key: "id", label: "Sequence enrollments" },
  { store: STORE_SEQUENCE_GROUPS, key: "id", label: "Sequence groups" },
  { store: STORE_OUTREACH_ATTEMPTS, key: "id", label: "Outreach attempts" },
  { store: STORE_COMPANY_PROFILES, key: "key", label: "Company profiles" },
  { store: STORE_DISPOSITIONS, key: "id", label: "Custom dispositions" },
  { store: STORE_EMAIL_ACCOUNTS, key: "id", label: "Email accounts" },
  { store: STORE_USERS, key: "id", label: "Users" },
  { store: STORE_WEEKLY_GOALS, key: "weekKey", label: "Weekly goals" },
  { store: STORE_PLATFORM_NOTES, key: "id", label: "Platform notes" },
  { store: STORE_PROFILE, key: "id", label: "Profile" },
  { store: STORE_RULE_OVERRIDES, key: "id", label: "Rule overrides" },
];

export type StoreRows = Record<string, unknown[]>;

export interface BackupPayload {
  exportedAt: string;
  // 1 = the original three-store file. 2 adds `stores`. A v1 file still
  // restores exactly as it always did; a v2 file opened by an older build
  // would restore its three top-level arrays and ignore `stores` rather
  // than failing, which is why those three stayed at the top level.
  version: 1 | 2;
  library: LibraryEntry[];
  libraryGroups: LibraryGroup[];
  history: HistoryEntry[];
  stores?: StoreRows;
}

// Reads every remaining store straight from IndexedDB rather than taking
// them as arguments: App.tsx mirrors most of them in React state, but not
// all (profile, platform notes and rule overrides are owned by their own
// components), and a backup that silently skipped those would repeat the
// exact bug this replaces.
export async function collectExtraStores(): Promise<StoreRows> {
  const out: StoreRows = {};
  for (const { store } of EXTRA_STORES) {
    try {
      out[store] = await dbGetAll<unknown>(store);
    } catch {
      // A store that can't be read is omitted rather than written as an
      // empty array — an empty array in the file would look like "this
      // store really is empty" and could not be told apart from a failure.
    }
  }
  return out;
}

export async function buildBackupPayload(
  library: LibraryEntry[],
  libraryGroups: LibraryGroup[],
  history: HistoryEntry[]
): Promise<BackupPayload> {
  return {
    exportedAt: new Date().toISOString(),
    version: 2,
    library,
    libraryGroups,
    history,
    stores: await collectExtraStores(),
  };
}

export interface IncomingBackup {
  library: LibraryEntry[];
  libraryGroups: LibraryGroup[];
  history: HistoryEntry[];
  stores: StoreRows;
  version: number;
}

const hasId = (x: unknown): x is { id: string } =>
  Boolean(x && typeof x === "object" && typeof (x as { id?: unknown }).id === "string");

export function parseBackupPayload(text: string): IncomingBackup {
  const raw = JSON.parse(text) as Partial<BackupPayload>;
  if (!raw || typeof raw !== "object") throw new Error("That file isn't a backup file.");
  const library = Array.isArray(raw.library) ? raw.library.filter(hasId) : [];
  const libraryGroups = Array.isArray(raw.libraryGroups) ? raw.libraryGroups.filter(hasId).map(normalizeGroup) : [];
  const history = Array.isArray(raw.history) ? raw.history.filter(hasId) : [];
  const stores: StoreRows = {};
  const incomingStores = (raw.stores && typeof raw.stores === "object" ? raw.stores : {}) as StoreRows;
  for (const { store, key } of EXTRA_STORES) {
    const rows = incomingStores[store];
    if (!Array.isArray(rows)) continue;
    // A row with no value under that store's own key can never be written
    // (IndexedDB rejects it), so drop it here rather than failing the
    // whole restore part-way through.
    stores[store] = rows.filter(
      (r) => r && typeof r === "object" && typeof (r as Record<string, unknown>)[key] === "string"
    );
  }
  const version = typeof raw.version === "number" ? raw.version : 1;
  if (!library.length && !libraryGroups.length && !history.length && Object.keys(stores).length === 0) {
    throw new Error("That backup file has no Library, History or platform records in it.");
  }
  return { library, libraryGroups, history, stores, version };
}

export function countIncoming(incoming: IncomingBackup): number {
  return (
    incoming.library.length +
    incoming.libraryGroups.length +
    incoming.history.length +
    Object.values(incoming.stores).reduce((n, rows) => n + rows.length, 0)
  );
}

// Writes the non-v1 stores back. dbPut is an upsert keyed by that store's
// own keyPath, so this is the same merge contract as mergeById below:
// anything already in the browser and absent from the file is untouched.
export async function restoreExtraStores(stores: StoreRows): Promise<{ written: number; failed: string[] }> {
  let written = 0;
  const failed: string[] = [];
  for (const { store } of EXTRA_STORES) {
    const rows = stores[store];
    if (!Array.isArray(rows) || rows.length === 0) continue;
    try {
      for (const row of rows) {
        await dbPut(store, row);
        written += 1;
      }
    } catch {
      failed.push(store);
    }
  }
  return { written, failed };
}

function mergeById<T extends { id: string }>(existing: T[], incoming: T[], sortKey: (x: T) => string, descending: boolean): T[] {
  const map = new Map(existing.map((x) => [x.id, x]));
  incoming.forEach((x) => map.set(x.id, x));
  const merged = Array.from(map.values());
  merged.sort((a, b) => (descending ? sortKey(b).localeCompare(sortKey(a)) : sortKey(a).localeCompare(sortKey(b))));
  return merged;
}

export const mergeLibraryEntries = (existing: LibraryEntry[], incoming: LibraryEntry[]) =>
  mergeById(existing, incoming, (e) => e.uploadedAt, true);
export const mergeLibraryGroups = (existing: LibraryGroup[], incoming: LibraryGroup[]) =>
  mergeById(existing, incoming, (g) => g.createdAt, false);
export const mergeHistoryEntries = (existing: HistoryEntry[], incoming: HistoryEntry[]) =>
  mergeById(existing, incoming, (h) => h.importedAt, true);
