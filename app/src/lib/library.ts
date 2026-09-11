// Library — permanent, IndexedDB-backed archive of Strong Signal leads,
// organized into month folders with up to 3 category files each. Ported
// from legacy/unified-tool.js PART 5.5 + Library groups section. See
// CLAUDE.md "Library architecture" for the rules this encodes.

import { dbGetAll, dbPut, dbDelete, STORE_LIBRARY, STORE_GROUPS } from "./db";
import {
  CATEGORY_META,
  BUCKET_LABEL,
  EXPORT_LABELS,
  ACTIVE_BUCKET_KEYS,
  buildExportRow,
  type BucketKey,
  type Disposition,
  type ExportRow,
  type ResultRow,
} from "./detection";
import { toCSV } from "./csv";

export interface LibraryGroup {
  id: string;
  name: string;
  notes: string;
  createdAt: string;
  // Per-folder privacy — see CLAUDE.md. Public (the default) behaves exactly
  // as before. Private requires passwordHash/passwordSalt to be entered
  // correctly EVERY time the folder is opened (unlock state lives only in
  // memory for the current visit — see components/Library.tsx — never
  // persisted, so leaving the folder and coming back always re-prompts).
  isPrivate: boolean;
  passwordHash: string | null;
  passwordSalt: string | null;
  // Set explicitly at creation time (true from getOrCreateGroupByName's
  // month-folder path, false from createGroup's custom-folder path) —
  // NOT inferred from whether the name happens to parse as a date, which
  // used to misclassify a custom folder literally named like a month
  // (e.g. "March 2025") as an auto-managed one.
  isAutoMonthFolder: boolean;
}

// Older stored groups (from before per-folder privacy / this flag existed)
// won't have these fields at all in IndexedDB — this is what a row read
// straight out of the groups store actually looks like.
export type RawLibraryGroup = Omit<LibraryGroup, "isPrivate" | "passwordHash" | "passwordSalt" | "isAutoMonthFolder"> &
  Partial<Pick<LibraryGroup, "isPrivate" | "passwordHash" | "passwordSalt" | "isAutoMonthFolder">>;

export function normalizeGroup(g: RawLibraryGroup): LibraryGroup {
  return {
    isPrivate: false,
    passwordHash: null,
    passwordSalt: null,
    // A record saved before isAutoMonthFolder existed falls back to the
    // old name-based guess exactly once, here at load time, so real month
    // folders created in an earlier session don't stop being recognized.
    // Every group created from now on sets this explicitly instead.
    isAutoMonthFolder: monthKeyFromGroupName(g.name) !== null,
    ...g,
  };
}

export type StoredRow = ExportRow & {
  __historyEntryId: string;
  __rowKey: string;
  __dynamicsSeatCount: number | null;
  __dynamicsModuleTier: number;
  // Same view-level sub-filter flags as ResultRow (see CLAUDE.md "Google ->
  // Microsoft view" / "Business Central view") — carried through filing so
  // the same View tabs work once a lead is stored in the Library, not just
  // in the Scanner. Optional so a StoredRow filed before these flags
  // existed still loads fine (undefined reads as false everywhere used).
  __isGoogleToMicrosoft?: boolean;
  __isBusinessCentral?: boolean;
  __isSalesCrm?: boolean;
  // Personal Prospect carve-out (see detection.ts's PERSONAL_PROSPECT_LABEL/
  // scanRowUnified) — a personal-email lead whose own content already
  // cleared Strong Signal, filed into its normal category same as any
  // other Strong Signal row, just visibly tagged. Optional for the same
  // pre-existing-row reason as the flags above.
  __isPersonalProspect?: boolean;
  __disposition: Disposition;
  __dispositionNote: string;
  __priority: boolean;
  __priorityMonth: string | null;
};

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
// A single catch-all folder for everything that happened before the
// May-2026 cutoff — per Jack: "for lead library under month folders add in
// an April and Past 2026." One bucket rather than re-creating the twelve
// individual pre-May folders the cutoff was introduced to get rid of.
//
// The key is deliberately NOT a parseable month. It sorts lexically just
// before "2026-05" so the folder lands first in the grid, but nothing can
// accidentally treat it as April 2026 and start filing single-month data
// into it.
export const ARCHIVE_MONTH_KEY = "2026-04-and-past";
export const ARCHIVE_MONTH_LABEL = "April and Past 2026";

export function monthLabelFromKey(key: string): string {
  if (key === ARCHIVE_MONTH_KEY) return ARCHIVE_MONTH_LABEL;
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString(undefined, { month: "long", year: "numeric" });
}
// Best-effort reverse of monthLabelFromKey — used when a Library file is
// already sitting in a month folder, so re-filing keeps the same month
// instead of guessing. Returns null for a manually-named group.
export function monthKeyFromGroupName(name: string | null | undefined): string | null {
  if (!name) return null;
  if (name === ARCHIVE_MONTH_LABEL) return ARCHIVE_MONTH_KEY;
  const d = new Date(`1 ${name}`);
  return isNaN(d.getTime()) ? null : monthKeyFromDate(d);
}
// The months you can file INTO — deliberately the same range the Library
// keeps folders for, never wider.
//
// This used to be an independent rolling 36-month window, which meant the
// picker offered months (back to 2023) that no folder existed for. Filing
// into one created a folder older than EARLIEST_MONTH_FOLDER, which the
// prune on the next load would then delete again if it were empty — two
// lists disagreeing about the same question. Caught by a live check after
// the cutoff moved to May 2026; the picker was still offering October 2023.
export function getMonthOptionsForFiling(): { key: string; label: string }[] {
  return getRequiredMonthKeys().map((key) => ({ key, label: monthLabelFromKey(key) }));
}

// May 2026 through the current month, inclusive — the fixed starting point
// every month folder should exist for, regardless of whether anything's
// been filed into it yet.
//
// Per Jack: "remove april 2026 back to october of 2025 and just continue it
// going forward // may 2026 should be the oldest date for now." Moving this
// constant stops the older folders being RE-created on load; clearing the
// ones already sitting in the browser is `pruneEmptyMonthFoldersBefore`
// below, since the data lives in the viewer's own IndexedDB and nothing
// outside the browser can reach it.
const EARLIEST_MONTH_FOLDER = new Date(2026, 4, 1); // month is 0-indexed: 4 = May
// The cutoff, as a label, so UI copy reads from the constant instead of
// restating it. The subtitle in Library.tsx said "October 2025" for a while
// after the constant moved to May 2026 — prose that repeats a value always
// drifts eventually.
export function earliestMonthFolderLabel(): string {
  return monthLabelFromKey(monthKeyFromDate(EARLIEST_MONTH_FOLDER));
}
export function getRequiredMonthKeys(): string[] {
  const now = new Date();
  // The archive bucket always exists and always comes first.
  const keys: string[] = [ARCHIVE_MONTH_KEY];
  let d = new Date(EARLIEST_MONTH_FOLDER.getFullYear(), EARLIEST_MONTH_FOLDER.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth(), 1);
  while (d.getTime() <= end.getTime()) {
    keys.push(monthKeyFromDate(d));
    d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  }
  return keys;
}

// Creates every required month folder that doesn't already exist yet, so
// the folder grid always shows Oct 2025 -> now ready to browse/backfill,
// not just months something has already been filed into. Idempotent — safe
// to call on every app load.
// Removes auto-created month folders older than EARLIEST_MONTH_FOLDER — but
// ONLY the empty ones. A folder still holding filed leads is never touched
// and is reported back instead, so lowering the cutoff can't quietly strand
// or discard real data. That is deliberately stricter than the app's own
// `deleteGroup`, which ungroups a folder's files rather than deleting them:
// here the point is a clean list, and dumping seven months of leads into
// "Ungrouped files" would be a different mess rather than a cleanup.
//
// A CUSTOM folder is never considered, even one named like an old month:
// `monthKeyFromGroupName` is only consulted for groups that parse as a real
// month label, and `isAutoMonthFolder === false` is respected first.
export function pruneEmptyMonthFoldersBefore(
  groups: LibraryGroup[],
  entries: LibraryEntry[]
): { groups: LibraryGroup[]; removed: LibraryGroup[]; blocked: { group: LibraryGroup; fileCount: number }[] } {
  const cutoff = monthKeyFromDate(EARLIEST_MONTH_FOLDER);
  const removed: LibraryGroup[] = [];
  const blocked: { group: LibraryGroup; fileCount: number }[] = [];

  const next = groups.filter((g) => {
    // Custom folders are the user's own naming and are out of scope, even
    // if the name happens to parse as a month.
    if (g.isAutoMonthFolder === false) return true;
    const key = monthKeyFromGroupName(g.name);
    // Explicit, not incidental: the archive key sorts BELOW the cutoff
    // under the string compare below, so without this guard an empty
    // "April and Past 2026" would be pruned on every load — created by
    // ensureMonthFoldersExist, deleted by the prune, forever.
    if (key === ARCHIVE_MONTH_KEY) return true;
    if (!key || key >= cutoff) return true;
    const fileCount = entries.filter((e) => e.groupId === g.id).length;
    if (fileCount > 0) {
      blocked.push({ group: g, fileCount });
      return true;
    }
    removed.push(g);
    return false;
  });

  return { groups: next, removed, blocked };
}

export function ensureMonthFoldersExist(groups: LibraryGroup[]): { groups: LibraryGroup[]; created: LibraryGroup[] } {
  let working = groups;
  const created: LibraryGroup[] = [];
  getRequiredMonthKeys().forEach((key) => {
    const label = monthLabelFromKey(key);
    if (working.some((g) => g.name === label)) return;
    const { groups: next, group } = getOrCreateGroupByName(working, label);
    working = next;
    created.push(group);
  });
  return { groups: working, created };
}

// Does opening this folder need a password? Two independent reasons, and
// they are deliberately kept apart:
//   - isPrivate is a per-folder password the user set themselves, with its
//     own salt (lib/folderAuth.ts).
//   - every AUTO month folder is gated by one shared password, per Jack:
//     "make the password for each month folder 'wiredcio'."
// Derived rather than stamped onto the stored record, so no existing group
// has to be migrated and the "make public" control still only ever governs
// a folder the user made private themselves.
export function folderRequiresPassword(group: LibraryGroup): boolean {
  return group.isPrivate || isMonthFolder(group);
}

export function isMonthFolder(group: LibraryGroup): boolean {
  return group.isAutoMonthFolder;
}

export async function loadLibraryFromDB(): Promise<{ entries: LibraryEntry[]; groups: LibraryGroup[] }> {
  const [entries, groups] = await Promise.all([dbGetAll<LibraryEntry>(STORE_LIBRARY), dbGetAll<RawLibraryGroup>(STORE_GROUPS)]);
  return {
    entries: entries.sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()),
    groups: groups.map(normalizeGroup).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
  };
}

// Only ever called with a real month label (monthLabelFromKey) — see
// ensureMonthFoldersExist and Scanner's "save to library" filing — so the
// created group is always a genuine auto-managed month folder.
export function getOrCreateGroupByName(
  groups: LibraryGroup[],
  label: string,
  // A folder Jack names himself is a CUSTOM folder, not one of the
  // auto-managed month folders — the distinction is what keeps a custom
  // folder that happens to be named like a month from being pruned or
  // re-created by the month seeding pass (see pruneEmptyMonthFoldersBefore).
  isAutoMonthFolder = true
): { groups: LibraryGroup[]; group: LibraryGroup } {
  const existing = groups.find((g) => g.name === label);
  if (existing) return { groups, group: existing };
  const group: LibraryGroup = { id: newId("grp"), name: label, notes: "", createdAt: new Date().toISOString(), isPrivate: false, passwordHash: null, passwordSalt: null, isAutoMonthFolder };
  return { groups: [...groups, group], group };
}

// Group name is resolved live from `groups` every time (never cached in a
// filename string) — matches legacy exactly, so a folder rename is always
// reflected in any file created after it.
// groupId is `string | null` on purpose: an UNGROUPED entry stores null
// (that's what "deleting a folder only ungroups its files" leaves behind),
// and coercing that null to "" here used to create a second, unreachable
// entry whose groupId matched nothing — the moved lead was then dropped by
// the caller's persist filter and lost on reload.
export function getOrCreateMonthCategoryEntry(
  entries: LibraryEntry[],
  groups: LibraryGroup[],
  groupId: string | null,
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
    const exportRows: StoredRow[] = rows.map((r) => ({
      ...buildExportRow(r),
      __historyEntryId: historyEntryId,
      __rowKey: `${historyEntryId}-${r.id}`,
      __dynamicsSeatCount: r.dynamicsSeatCount,
      __dynamicsModuleTier: r.dynamicsModuleTier,
      __isGoogleToMicrosoft: r.isGoogleToMicrosoft,
      __isBusinessCentral: r.isBusinessCentral,
      __isSalesCrm: r.isSalesCrm,
      __isPersonalProspect: r.isPersonalProspect,
      __disposition: r.disposition,
      __dispositionNote: r.dispositionNote,
      __priority: r.priority,
      __priorityMonth: r.priorityMonth,
    }));
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

// Same per-lead status fields as the Scanner (disposition/note/priority/
// month) — edited independently here, same as every other Library row
// edit (no live sync back to the Scanner/History copy, per CLAUDE.md).
export function updateLibraryRowStatus(
  entries: LibraryEntry[],
  entryId: string,
  rowKey: string,
  patch: Partial<Pick<StoredRow, "__disposition" | "__dispositionNote" | "__priority" | "__priorityMonth">>
): LibraryEntry[] {
  const entry = entries.find((e) => e.id === entryId);
  if (!entry) return entries;
  const idx = findLibraryRowIndex(entry, rowKey);
  if (idx === -1) return entries;
  const rows = entry.rows.map((r, i) => (i === idx ? { ...r, ...patch } : r));
  return entries.map((e) => (e.id === entryId ? serialize({ ...entry, rows }) : e));
}

export function deleteLibraryRow(entries: LibraryEntry[], entryId: string, rowKey: string): LibraryEntry[] {
  const entry = entries.find((e) => e.id === entryId);
  if (!entry) return entries;
  const idx = findLibraryRowIndex(entry, rowKey);
  if (idx === -1) return entries;
  const rows = entry.rows.filter((_, i) => i !== idx);
  if (rows.length === 0) {
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
    working = entries.filter((e) => e.id !== entryId);
  } else {
    working = entries.map((e) => (e.id === entryId ? serialize({ ...source, rows: sourceRows }) : e));
  }
  const { entries: next, entry: target } = getOrCreateMonthCategoryEntry(working, groups, source.groupId ?? null, newBucket);
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

// Always a custom folder, even if the name Jack picks happens to parse as
// a date (e.g. "March 2025") — isAutoMonthFolder: false is what keeps it
// showing up under "Custom folders" (deletable) instead of being silently
// swept into "Month folders" just because of what it's named.
export function createGroup(groups: LibraryGroup[], name: string, notes: string): { groups: LibraryGroup[]; group: LibraryGroup | null } {
  const trimmed = name.trim();
  if (!trimmed) return { groups, group: null };
  const group: LibraryGroup = { id: newId("grp"), name: trimmed, notes: notes.trim(), createdAt: new Date().toISOString(), isPrivate: false, passwordHash: null, passwordSalt: null, isAutoMonthFolder: false };
  return { groups: [...groups, group], group };
}
export function renameGroup(groups: LibraryGroup[], id: string, name: string, notes: string): LibraryGroup[] {
  return groups.map((g) => (g.id === id ? { ...g, name: name.trim() || g.name, notes } : g));
}
// Turning a folder private always sets a brand-new password (the caller —
// see components/Library.tsx — hashes it via lib/folderAuth.ts first); there
// is no "keep the old password" path, matching "a password is required to
// be created" for every private toggle-on.
export function setGroupPrivate(groups: LibraryGroup[], id: string, passwordHash: string, passwordSalt: string): LibraryGroup[] {
  return groups.map((g) => (g.id === id ? { ...g, isPrivate: true, passwordHash, passwordSalt } : g));
}
export function setGroupPublic(groups: LibraryGroup[], id: string): LibraryGroup[] {
  return groups.map((g) => (g.id === id ? { ...g, isPrivate: false, passwordHash: null, passwordSalt: null } : g));
}
// Deleting a group only ungroups its files — never deletes them.
export function deleteGroup(groups: LibraryGroup[], entries: LibraryEntry[], id: string): { groups: LibraryGroup[]; entries: LibraryEntry[] } {
  return { groups: groups.filter((g) => g.id !== id), entries: entries.map((e) => (e.groupId === id ? { ...e, groupId: null } : e)) };
}

// Category filtering re-scans a file's rawText on demand (Library never
// stored detected categories separately) — cached by entry id, invalidated
// whenever rawText changes (serialize() always produces a fresh rawText,
// so callers should drop cache entries they touch).
// NOTE: a per-entry category-count cache used to live here, along with
// getLibraryEntryCategoryCounts. Nothing ever read either one, yet four
// call sites still paid to invalidate the cache on every write. Removed by
// the audit pass — dead caches are worse than no cache, because they look
// like a live invariant someone has to maintain.


// Every entry belonging to one folder: the 2 active buckets first, in a
// fixed, predictable order (Dynamics -> M365/Azure), then any bucket key
// that's no longer part of the active set (e.g. a file filed under the
// pre-merge "Power BI/Azure/Fabric" bucket — see CLAUDE.md "Category
// merge") appended after, so it stays visible/usable instead of silently
// disappearing just because nothing new gets filed there anymore.
export function getFolderEntries(entries: LibraryEntry[], groupId: string): LibraryEntry[] {
  const inFolder = entries.filter((e) => e.groupId === groupId);
  const active = ACTIVE_BUCKET_KEYS.map((bk) => inFolder.find((e) => e.bucketKey === bk)).filter((e): e is LibraryEntry => !!e);
  const legacy = inFolder.filter((e) => !ACTIVE_BUCKET_KEYS.includes(e.bucketKey));
  return [...active, ...legacy];
}

// Business Central/ERP leads first, then Sales/CRM, then everything else,
// and within each of those blocks a stated seat/user/license count wins,
// highest first — a lead with no stated count sinks below every counted
// one in its own block, never treated as a count of 0. Same rule as
// Scanner's sortByDynamicsSeatCount, mirrored here since Library rows
// carry hidden __dynamics* fields instead of the live ResultRow's. Older
// stored rows (filed before module-tier ranking existed) default to
// tier 2 ("the rest") rather than crashing on a missing field.
export function sortDynamicsStoredRows(rows: StoredRow[]): StoredRow[] {
  return [...rows].sort((a, b) => {
    const tierDiff = (a.__dynamicsModuleTier ?? 2) - (b.__dynamicsModuleTier ?? 2);
    if (tierDiff !== 0) return tierDiff;
    return (b.__dynamicsSeatCount ?? -Infinity) - (a.__dynamicsSeatCount ?? -Infinity);
  });
}

// The 4th file inside a folder: every lead from all 3 category files in
// one list. Deliberately NOT stored as its own persisted entry — it's
// derived fresh from the real category files every time, so it can never
// drift out of sync with them (the exact class of bug the "Fully editable
// folders" pass in legacy/unified-tool.js had to fix after the fact).
// Editing happens on the category file; this is read-only, for viewing the
// whole month at a glance and downloading everything in one CSV. The
// Dynamics segment is seat-count sorted like everywhere else; the other
// two categories keep their existing order.
export function getCombinedFolderExport(entries: LibraryEntry[], groupId: string): { rows: StoredRow[]; rawText: string; rowCount: number } {
  const rows = getFolderEntries(entries, groupId).flatMap((e) => (e.bucketKey === "dynamics" ? sortDynamicsStoredRows(e.rows) : e.rows));
  return { rows, rawText: toCSV(rows, EXPORT_LABELS), rowCount: rows.length };
}
