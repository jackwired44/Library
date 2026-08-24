// Backup / restore — a single portable JSON file covering the Library
// (files + groups) and History, ported from legacy/unified-tool.js's
// backupEverything()/restoreBackupFile(). Deliberately NOT a new storage
// layer, just a file Jack controls (Drive, email, wherever). Restore is a
// MERGE (upsert by id), never a wipe: an old/partial backup can only add or
// update entries, and restoring into an already-empty browser (the main
// reason to restore at all) produces the same result a full replace would.

import { normalizeGroup, type LibraryEntry, type LibraryGroup, type RawLibraryGroup } from "./library";
import type { HistoryEntry } from "./history";

export interface BackupPayload {
  exportedAt: string;
  version: 1;
  library: LibraryEntry[];
  libraryGroups: LibraryGroup[];
  history: HistoryEntry[];
}

export function buildBackupPayload(library: LibraryEntry[], libraryGroups: LibraryGroup[], history: HistoryEntry[]): BackupPayload {
  return { exportedAt: new Date().toISOString(), version: 1, library, libraryGroups, history };
}

export interface IncomingBackup {
  library: LibraryEntry[];
  libraryGroups: LibraryGroup[];
  history: HistoryEntry[];
}

function hasId(x: unknown): x is { id: string } {
  return !!x && typeof x === "object" && typeof (x as { id?: unknown }).id === "string";
}

export function parseBackupPayload(text: string): IncomingBackup {
  const payload = JSON.parse(text);
  if (!payload || typeof payload !== "object") throw new Error("File doesn't contain a recognizable backup.");
  const library = Array.isArray(payload.library) ? payload.library.filter(hasId) : [];
  // A backup taken before per-folder privacy existed won't have
  // isPrivate/passwordHash/passwordSalt on its groups — normalize on the
  // way in, same as loadLibraryFromDB does for old IndexedDB records.
  const libraryGroups = (Array.isArray(payload.libraryGroups) ? payload.libraryGroups.filter(hasId) : []).map((g: RawLibraryGroup) => normalizeGroup(g));
  const history = Array.isArray(payload.history) ? payload.history.filter(hasId) : [];
  if (!library.length && !libraryGroups.length && !history.length) {
    throw new Error("File doesn't contain any Library files, groups, or History to restore.");
  }
  return { library, libraryGroups, history };
}

function mergeById<T extends { id: string }>(existing: T[], incoming: T[], sortKey: (x: T) => string, descending: boolean): T[] {
  const map = new Map(existing.map((x) => [x.id, x]));
  incoming.forEach((x) => map.set(x.id, x));
  const merged = [...map.values()];
  merged.sort((a, b) => (descending ? new Date(sortKey(b)).getTime() - new Date(sortKey(a)).getTime() : new Date(sortKey(a)).getTime() - new Date(sortKey(b)).getTime()));
  return merged;
}

export const mergeLibraryEntries = (existing: LibraryEntry[], incoming: LibraryEntry[]) => mergeById(existing, incoming, (e) => e.uploadedAt, true);
export const mergeLibraryGroups = (existing: LibraryGroup[], incoming: LibraryGroup[]) => mergeById(existing, incoming, (g) => g.createdAt, false);
export const mergeHistoryEntries = (existing: HistoryEntry[], incoming: HistoryEntry[]) => mergeById(existing, incoming, (h) => h.importedAt, true);
