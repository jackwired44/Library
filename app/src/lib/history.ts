// History — every scan/import kept automatically (unlike the Library,
// which only keeps what's opted in), searchable, and combinable into one
// working Scanner view. Ported from legacy/unified-tool.js's History
// section. See CLAUDE.md for the product rules this encodes.

import { dbGetAll, dbPut, dbDelete, STORE_HISTORY } from "./db";
import type { ResultRow, ParsedFile } from "./detection";

export interface HistoryEntry {
  id: string;
  fileName: string;
  files: { name: string; rows: number }[];
  importedAt: string;
  rowsScanned: number;
  // How many rows this import recognized as duplicates (exact name+company
  // match already seen earlier in the same batch) and merged into their
  // matching contact rather than filing separately — see CLAUDE.md
  // "Duplicate detection." Optional so an entry recorded before this field
  // existed still loads fine (reads as 0/undefined everywhere it's shown).
  duplicatesRemoved?: number;
  // Size of the largest duplicate group in this import (e.g. 6 if one
  // lead appeared 6 times) — surfaced so a big merge reads as "recognized
  // and consolidated," not as data quietly vanishing.
  largestDuplicateGroup?: number;
  results: ResultRow[];
  tag: string;
  notes: string;
  libraryEntryIds: string[];
}

function newId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function buildHistoryEntry(
  parsedFiles: ParsedFile[],
  scan: { results: ResultRow[]; rowsScanned: number; duplicatesRemoved?: number; largestDuplicateGroup?: number },
  opts: { tag?: string; libraryEntryIds?: string[] } = {}
): HistoryEntry {
  return {
    id: newId(),
    fileName: parsedFiles.map((pf) => pf.name).join(", "),
    files: parsedFiles.map((pf) => ({ name: pf.name, rows: pf.data.length })),
    importedAt: new Date().toISOString(),
    rowsScanned: scan.rowsScanned,
    duplicatesRemoved: scan.duplicatesRemoved || 0,
    largestDuplicateGroup: scan.largestDuplicateGroup || 0,
    results: scan.results,
    tag: opts.tag || "",
    notes: "",
    libraryEntryIds: opts.libraryEntryIds || [],
  };
}

export async function loadHistoryFromDB(): Promise<HistoryEntry[]> {
  const entries = await dbGetAll<HistoryEntry>(STORE_HISTORY);
  return entries.sort((a, b) => new Date(b.importedAt).getTime() - new Date(a.importedAt).getTime());
}
export async function persistHistoryEntry(entry: HistoryEntry) {
  await dbPut(STORE_HISTORY, entry);
}
export async function deleteHistoryEntryFromDB(id: string) {
  await dbDelete(STORE_HISTORY, id);
}

// Local calendar-day key (YYYY-MM-DD) — NOT toISOString().slice(0,10),
// which converts to UTC first and silently shifts the date for anyone not
// at UTC+0 (an import at 11pm in a positive-UTC-offset timezone would file
// under the wrong, earlier day). Same approach as lib/tasks.ts's dateKey().
function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/* ------------------------------------------------------------------ */
/* Week grouping                                                        */
/* ------------------------------------------------------------------ */
function startOfWeek(d: Date): Date {
  const date = new Date(d);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + diff);
  return date;
}
function weekKeyOf(d: Date): string {
  return localDateKey(startOfWeek(d));
}
function weekLabelOf(key: string): string {
  const start = new Date(`${key}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const fmt = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const sameYear = start.getFullYear() === end.getFullYear();
  return `${fmt(start)} – ${fmt(end)}${sameYear ? `, ${end.getFullYear()}` : ""}`;
}
export interface Week {
  key: string;
  label: string;
  entries: HistoryEntry[];
}
export function getWeeks(history: HistoryEntry[]): Week[] {
  const map = new Map<string, HistoryEntry[]>();
  history.forEach((h) => {
    const k = weekKeyOf(new Date(h.importedAt));
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(h);
  });
  const keys = [...map.keys()].sort((a, b) => b.localeCompare(a));
  return keys.map((k) => ({
    key: k,
    label: weekLabelOf(k),
    entries: map.get(k)!.sort((a, b) => new Date(b.importedAt).getTime() - new Date(a.importedAt).getTime()),
  }));
}

/* ------------------------------------------------------------------ */
/* Day grouping — the actual audit trail: which calendar day each file  */
/* was brought in on, at the granularity Jack asked for ("track the     */
/* days files are inputted"), one level finer than the week tabs above. */
/* ------------------------------------------------------------------ */
function dayKeyOf(d: Date): string {
  return localDateKey(d);
}
function dayLabelOf(key: string): string {
  return new Date(`${key}T00:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}
export interface Day {
  key: string;
  label: string;
  entries: HistoryEntry[];
}
export function getDays(history: HistoryEntry[]): Day[] {
  const map = new Map<string, HistoryEntry[]>();
  history.forEach((h) => {
    const k = dayKeyOf(new Date(h.importedAt));
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(h);
  });
  const keys = [...map.keys()].sort((a, b) => b.localeCompare(a));
  return keys.map((k) => ({
    key: k,
    label: dayLabelOf(k),
    entries: map.get(k)!.sort((a, b) => new Date(b.importedAt).getTime() - new Date(a.importedAt).getTime()),
  }));
}

/* ------------------------------------------------------------------ */
/* Audit trail export — one row per import: exactly when it landed and  */
/* what it was, as a flat CSV Jack can hand to someone else or keep     */
/* outside the app. Distinct from the full JSON backup (backup.ts) —    */
/* this is metadata-only, readable in a spreadsheet, not a restorable   */
/* copy of every scanned row.                                           */
/* ------------------------------------------------------------------ */
export function buildAuditTrailRows(history: HistoryEntry[]): Record<string, string>[] {
  return [...history]
    .sort((a, b) => new Date(b.importedAt).getTime() - new Date(a.importedAt).getTime())
    .map((h) => {
      const imported = new Date(h.importedAt);
      const signalCount = h.results.filter((r) => r.tier === "signal").length;
      return {
        Date: imported.toLocaleDateString(),
        Time: imported.toLocaleTimeString(),
        Files: h.files.map((f) => f.name).join("; "),
        "Rows Scanned": String(h.rowsScanned),
        "Strong Signal": String(signalCount),
        Tag: h.tag,
        Notes: h.notes,
      };
    });
}
export const AUDIT_TRAIL_COLUMNS = ["Date", "Time", "Files", "Rows Scanned", "Strong Signal", "Tag", "Notes"] as const;

/* ------------------------------------------------------------------ */
/* Search — across ALL of history, not just the active week            */
/* ------------------------------------------------------------------ */
export function getFilteredHistory(history: HistoryEntry[], search: string): HistoryEntry[] {
  if (!search.trim()) return history;
  const q = search.toLowerCase();
  return history.filter((h) => {
    if (h.tag.toLowerCase().includes(q)) return true;
    if (h.files.some((f) => f.name.toLowerCase().includes(q))) return true;
    return h.results.some((r) => {
      const f = r.row.__f;
      return String(f.company || "").toLowerCase().includes(q) || `${f.firstName || ""} ${f.lastName || ""}`.toLowerCase().includes(q);
    });
  });
}

/* ------------------------------------------------------------------ */
/* Combine into Scanner                                                 */
/* ------------------------------------------------------------------ */
// Shallow copies with synthesized ids and __sourceEntryId/__sourceRowId —
// NOT the original shared objects. Two different imports can easily both
// have a row id like "0-0" (ids are only ever scoped to one import at a
// time), so a plain merge risks one row's edit landing on a different
// import's row that happens to share the same id.
export function combineHistoryEntries(entries: HistoryEntry[]): { results: ResultRow[]; rowsScanned: number } {
  const results: ResultRow[] = [];
  let rowsScanned = 0;
  entries.forEach((h) => {
    h.results.forEach((r) => {
      results.push({ ...r, id: `${h.id}::${r.id}`, __sourceEntryId: h.id, __sourceRowId: r.id });
    });
    rowsScanned += h.rowsScanned;
  });
  return { results, rowsScanned };
}

// Writes a category/tier/cross-out/disposition/priority edit made on a row
// tagged with __sourceEntryId back to the row it was copied from inside
// `history`, and returns the updated history array (or the same array,
// unchanged, if this row isn't tied to any history entry — an ordinary
// fresh-scan row). Doesn't persist — the caller decides when/whether to
// write through to IndexedDB.
export function syncRowIntoHistory(history: HistoryEntry[], row: ResultRow): HistoryEntry[] {
  if (!row.__sourceEntryId) return history;
  const entryIdx = history.findIndex((h) => h.id === row.__sourceEntryId);
  if (entryIdx === -1) return history;
  const entry = history[entryIdx];
  const rowIdx = entry.results.findIndex((r) => r.id === row.__sourceRowId);
  if (rowIdx === -1) return history;
  const updatedResults = entry.results.map((r, i) =>
    i === rowIdx
      ? {
          ...r,
          category: row.category,
          tier: row.tier,
          crossedOut: row.crossedOut,
          disposition: row.disposition,
          dispositionNote: row.dispositionNote,
          priority: row.priority,
          priorityMonth: row.priorityMonth,
        }
      : r
  );
  const updatedEntry = { ...entry, results: updatedResults };
  return history.map((h, i) => (i === entryIdx ? updatedEntry : h));
}
