// Library — permanent, IndexedDB-backed archive of Strong Signal leads,
// organized into month folders with up to 3 category files each. Ported
// from legacy/unified-tool.js PART 5.5 + Library groups section. See
// CLAUDE.md "Library architecture" for the rules this encodes.

import { dbGetAll, dbPut, dbDelete, STORE_LIBRARY, STORE_GROUPS } from "./db";
import {
  CATEGORY_META,
  BUCKET_LABEL,
  EXPORT_LABELS,
  FIELD_DEFS,
  buildExportRow,
  guessColumn,
  scanRowUnified,
  type BucketKey,
  type CategoryKey,
  type ExportRow,
  type ResolvedFields,
  type ResultRow,
} from "./detection";
import { toCSV, parseCSVText } from "./csv";

export interface LibraryGroup {
  id: string;
  name: string;
  notes: string;
  createdAt: string;
}

export type StoredRow = ExportRow & { __historyEntryId: string; __rowKey: string };

export interface LibraryEntry {
  id: string;
  fileName: string;
  rawText: string;
  rows: StoredRow[];
  rowCount: number;
  uploadedAt: string;
  receivedAt: string | null;
  groupId: string | null;
  bucketKey: BucketKey;
}

function newId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function monthKeyFromDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
export function monthLabelFromKey(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString(undefined, { month: "long", year: "numeric" });
}
// Best-effort reverse of monthLabelFromKey — used when a Library file is
// already sitting in a month folder, so re-filing keeps the same month
// instead of guessing. Returns null for a manually-named group.
export function monthKeyFromGroupName(name: string | null | undefined): string | null {
  if (!name) return null;
  const d = new Date(`1 ${name}`);
  return isNaN(d.getTime()) ? null : monthKeyFromDate(d);
}
// Rolling 36-month range — comfortably covers backfilling, keeps rolling
// forward automatically.
export function getMonthOptionsForFiling(): { key: string; label: string }[] {
  const now = new Date();
  const options: { key: string; label: string }[] = [];
  for (let i = 35; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = monthKeyFromDate(d);
    options.push({ key, label: monthLabelFromKey(key) });
  }
  return options;
}

export async function loadLibraryFromDB(): Promise<{ entries: LibraryEntry[]; groups: LibraryGroup[] }> {
  const [entries, groups] = await Promise.all([dbGetAll<LibraryEntry>(STORE_LIBRARY), dbGetAll<LibraryGroup>(STORE_GROUPS)]);
  return {
    entries: entries.sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()),
    groups: groups.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
  };
}

export function getOrCreateGroupByName(groups: LibraryGroup[], label: string): { groups: LibraryGroup[]; group: LibraryGroup } {
  const existing = groups.find((g) => g.name === label);
  if (existing) return { groups, group: existing };
  const group: LibraryGroup = { id: newId("grp"), name: label, notes: "", createdAt: new Date().toISOString() };
  return { groups: [...groups, group], group };
}

// Group name is resolved live from `groups` every time (never cached in a
// filename string) — matches legacy exactly, so a folder rename is always
// reflected in any file created after it.
export function getOrCreateMonthCategoryEntry(
  entries: LibraryEntry[],
  groups: LibraryGroup[],
  groupId: string,
  bucketKey: BucketKey
): { entries: LibraryEntry[]; entry: LibraryEntry } {
  const existing = entries.find((e) => e.groupId === groupId && e.bucketKey === bucketKey);
  if (existing) return { entries, entry: existing };
  const groupName = groups.find((g) => g.id === groupId)?.name || "Unfiled";
  const entry: LibraryEntry = {
    id: newId("lib"),
    fileName: `${BUCKET_LABEL[bucketKey]} — ${groupName}.csv`,
    rawText: "",
    rows: [],
    rowCount: 0,
    uploadedAt: new Date().toISOString(),
    receivedAt: null,
    groupId,
    bucketKey,
  };
  return { entries: [entry, ...entries], entry };
}

// Every mutation that changes an entry's rows goes through here — rawText
// is regenerated and the cached category count for this id is dropped
// (same id, new content: a stale cache entry would otherwise undercount).
function serialize(entry: LibraryEntry): LibraryEntry {
  invalidateCategoryCount(entry.id);
  return { ...entry, rowCount: entry.rows.length, rawText: toCSV(entry.rows, EXPORT_LABELS) };
}

// Splits a batch's Strong Signal rows by category and merges each group into
// that month's matching category file (appending if it already exists).
// Returns the updated entries array plus the touched entry ids (so a batch's
// History record can remember exactly which files it landed in).
export function fileSignalRowsIntoGroup(
  entries: LibraryEntry[],
  groups: LibraryGroup[],
  groupId: string,
  signalRows: ResultRow[],
  historyEntryId: string
): { entries: LibraryEntry[]; touchedIds: string[] } {
  const byBucket = new Map<BucketKey, ResultRow[]>();
  signalRows.forEach((r) => {
    const bk = CATEGORY_META[r.category].bucket;
    if (!byBucket.has(bk)) byBucket.set(bk, []);
    byBucket.get(bk)!.push(r);
  });
  let working = entries;
  const touchedIds: string[] = [];
  byBucket.forEach((rows, bk) => {
    const { entries: next, entry } = getOrCreateMonthCategoryEntry(working, groups, groupId, bk);
    const exportRows: StoredRow[] = rows.map((r) => ({ ...buildExportRow(r), __historyEntryId: historyEntryId, __rowKey: `${historyEntryId}-${r.id}` }));
    const updated = serialize({ ...entry, rows: [...entry.rows, ...exportRows] });
    working = next.map((e) => (e.id === entry.id ? updated : e));
    touchedIds.push(entry.id);
  });
  return { entries: working, touchedIds };
}

// Pulls one batch's own rows back out of wherever it was previously filed
// (used when re-filing to a different month) — deletes a category file
// entirely if that empties it.
export function removeBatchSignalRows(entries: LibraryEntry[], historyEntryId: string, libraryEntryIds: string[]): LibraryEntry[] {
  let working = entries;
  libraryEntryIds.forEach((libId) => {
    const entry = working.find((e) => e.id === libId);
    if (!entry) return;
    const remaining = entry.rows.filter((r) => r.__historyEntryId !== historyEntryId);
    if (remaining.length === 0) {
      invalidateCategoryCount(entry.id);
      working = working.filter((e) => e.id !== libId);
    } else {
      working = working.map((e) => (e.id === libId ? serialize({ ...entry, rows: remaining }) : e));
    }
  });
  return working;
}

export function findLibraryRowIndex(entry: LibraryEntry, rowKey: string): number {
  const byKey = entry.rows.findIndex((r) => r.__rowKey === rowKey);
  if (byKey !== -1) return byKey;
  const asIndex = Number(rowKey);
  return Number.isInteger(asIndex) && asIndex >= 0 && asIndex < entry.rows.length ? asIndex : -1;
}

export function updateLibraryRowField(entries: LibraryEntry[], entryId: string, rowKey: string, field: keyof ExportRow, value: string): LibraryEntry[] {
  const entry = entries.find((e) => e.id === entryId);
  if (!entry) return entries;
  const idx = findLibraryRowIndex(entry, rowKey);
  if (idx === -1) return entries;
  const rows = entry.rows.map((r, i) => (i === idx ? { ...r, [field]: value } : r));
  return entries.map((e) => (e.id === entryId ? serialize({ ...entry, rows }) : e));
}

export function deleteLibraryRow(entries: LibraryEntry[], entryId: string, rowKey: string): LibraryEntry[] {
  const entry = entries.find((e) => e.id === entryId);
  if (!entry) return entries;
  const idx = findLibraryRowIndex(entry, rowKey);
  if (idx === -1) return entries;
  const rows = entry.rows.filter((_, i) => i !== idx);
  if (rows.length === 0) {
    invalidateCategoryCount(entry.id);
    return entries.filter((e) => e.id !== entryId);
  }
  return entries.map((e) => (e.id === entryId ? serialize({ ...entry, rows }) : e));
}

// Moves one lead into a different category within the same month folder.
export function moveLibraryRowToBucket(entries: LibraryEntry[], groups: LibraryGroup[], entryId: string, rowKey: string, newBucket: BucketKey): LibraryEntry[] {
  const source = entries.find((e) => e.id === entryId);
  if (!source || newBucket === source.bucketKey) return entries;
  const idx = findLibraryRowIndex(source, rowKey);
  if (idx === -1) return entries;
  const row: StoredRow = { ...source.rows[idx], "Product Area": BUCKET_LABEL[newBucket] };
  const sourceRows = source.rows.filter((_, i) => i !== idx);
  let working: LibraryEntry[];
  if (sourceRows.length === 0) {
    invalidateCategoryCount(source.id);
    working = entries.filter((e) => e.id !== entryId);
  } else {
    working = entries.map((e) => (e.id === entryId ? serialize({ ...source, rows: sourceRows }) : e));
  }
  const { entries: next, entry: target } = getOrCreateMonthCategoryEntry(working, groups, source.groupId ?? "", newBucket);
  working = next.map((e) => (e.id === target.id ? serialize({ ...target, rows: [...target.rows, row] }) : e));
  return working;
}

export async function persistLibraryEntries(entries: LibraryEntry[]) {
  await Promise.all(entries.map((e) => dbPut(STORE_LIBRARY, e)));
}
export async function persistLibraryEntry(entry: LibraryEntry) {
  await dbPut(STORE_LIBRARY, entry);
}
export async function deleteLibraryEntryFromDB(id: string) {
  await dbDelete(STORE_LIBRARY, id);
}
export async function persistGroup(group: LibraryGroup) {
  await dbPut(STORE_GROUPS, group);
}
export async function deleteGroupFromDB(id: string) {
  await dbDelete(STORE_GROUPS, id);
}

export function createGroup(groups: LibraryGroup[], name: string, notes: string): { groups: LibraryGroup[]; group: LibraryGroup | null } {
  const trimmed = name.trim();
  if (!trimmed) return { groups, group: null };
  const group: LibraryGroup = { id: newId("grp"), name: trimmed, notes: notes.trim(), createdAt: new Date().toISOString() };
  return { groups: [...groups, group], group };
}
export function renameGroup(groups: LibraryGroup[], id: string, name: string, notes: string): LibraryGroup[] {
  return groups.map((g) => (g.id === id ? { ...g, name: name.trim() || g.name, notes } : g));
}
// Deleting a group only ungroups its files — never deletes them.
export function deleteGroup(groups: LibraryGroup[], entries: LibraryEntry[], id: string): { groups: LibraryGroup[]; entries: LibraryEntry[] } {
  return { groups: groups.filter((g) => g.id !== id), entries: entries.map((e) => (e.groupId === id ? { ...e, groupId: null } : e)) };
}

export function getGroupCounts(entries: LibraryEntry[], groups: LibraryGroup[]): Record<string, number> {
  const counts: Record<string, number> = { all: entries.length, ungrouped: 0 };
  groups.forEach((g) => (counts[g.id] = 0));
  entries.forEach((e) => {
    if (e.groupId && counts[e.groupId] !== undefined) counts[e.groupId]++;
    else counts.ungrouped++;
  });
  return counts;
}

// Category filtering re-scans a file's rawText on demand (Library never
// stored detected categories separately) — cached by entry id, invalidated
// whenever rawText changes (serialize() always produces a fresh rawText,
// so callers should drop cache entries they touch).
const categoryCountCache = new Map<string, Record<CategoryKey, number>>();
export function invalidateCategoryCount(entryId: string) {
  categoryCountCache.delete(entryId);
}
export function getLibraryEntryCategoryCounts(entry: LibraryEntry): Record<CategoryKey, number> {
  const cached = categoryCountCache.get(entry.id);
  if (cached) return cached;
  const counts: Record<CategoryKey, number> = { m365Tenant: 0, dynamics365: 0, dataPlatform: 0 };
  try {
    const pf = parseCSVText(entry.fileName, entry.rawText);
    const mapping: Partial<Record<keyof ResolvedFields, string>> = {};
    FIELD_DEFS.forEach((f) => { mapping[f.key] = guessColumn(pf.fields, f.candidates) || undefined; });
    pf.data.forEach((row) => {
      const resolved: ResolvedFields = {};
      FIELD_DEFS.forEach((f) => {
        const col = mapping[f.key];
        (resolved as Record<string, unknown>)[f.key] = col ? row[col] ?? "" : "";
      });
      const scan = scanRowUnified(row, pf.fields, resolved);
      if (scan) counts[scan.category]++;
    });
  } catch {
    // A malformed file just contributes zero counts.
  }
  categoryCountCache.set(entry.id, counts);
  return counts;
}

export function getFilteredLibrary(
  entries: LibraryEntry[],
  groups: LibraryGroup[],
  groupFilter: string,
  categoryFilter: CategoryKey | "all",
  search: string
): LibraryEntry[] {
  let list = entries;
  if (groupFilter === "ungrouped") list = list.filter((e) => !e.groupId);
  else if (groupFilter !== "all") list = list.filter((e) => e.groupId === groupFilter);
  if (categoryFilter !== "all") list = list.filter((e) => getLibraryEntryCategoryCounts(e)[categoryFilter] > 0);
  if (search.trim()) {
    const q = search.toLowerCase();
    list = list.filter((e) => {
      const group = e.groupId ? groups.find((g) => g.id === e.groupId) : null;
      return e.fileName.toLowerCase().includes(q) || (group && group.name.toLowerCase().includes(q));
    });
  }
  return list;
}
