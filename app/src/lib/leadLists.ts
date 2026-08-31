// Custom Lead Lists — Jack hand-picks specific leads (any tier, not just
// Strong Signal) out of a Scanner batch and groups them into his own named
// lists, downloadable as CSV any time. Deliberately separate from the Lead
// Library (which only ever files Strong Signal rows, auto-organized by
// month/category) — this is the opposite: any lead, grouped however Jack
// wants. See CLAUDE.md "Custom Lead Lists."

import { dbGetAll, dbPut, dbDelete, STORE_LEAD_LISTS } from "./db";
import { buildExportRow, getFullName, normalizeDupKey, EXPORT_LABELS, type CategoryKey, type ExportRow, type ResultRow, type Tier } from "./detection";
import { toCSV } from "./csv";

export type ListedLeadRow = ExportRow & {
  __rowKey: string;
  __category: CategoryKey;
  __tier: Tier;
};

export interface LeadList {
  id: string;
  name: string;
  createdAt: string;
  rows: ListedLeadRow[];
}

function newId() {
  return `list-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function loadLeadListsFromDB(): Promise<LeadList[]> {
  const lists = await dbGetAll<LeadList>(STORE_LEAD_LISTS);
  return lists.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}
export async function persistLeadList(list: LeadList) {
  await dbPut(STORE_LEAD_LISTS, list);
}
export async function deleteLeadListFromDB(id: string) {
  await dbDelete(STORE_LEAD_LISTS, id);
}

export function createLeadList(lists: LeadList[], name: string): { lists: LeadList[]; list: LeadList | null } {
  const trimmed = name.trim();
  if (!trimmed) return { lists, list: null };
  const list: LeadList = { id: newId(), name: trimmed, createdAt: new Date().toISOString(), rows: [] };
  return { lists: [list, ...lists], list };
}
export function renameLeadList(lists: LeadList[], id: string, name: string): LeadList[] {
  return lists.map((l) => (l.id === id ? { ...l, name: name.trim() || l.name } : l));
}
export function deleteLeadList(lists: LeadList[], id: string): LeadList[] {
  return lists.filter((l) => l.id !== id);
}

// Same "skip the check if either field is missing" rule as the Scanner's
// own batch duplicate detection (see CLAUDE.md "Duplicate detection") — a
// lead with no name or no company has no reliable key to dedupe against,
// so it's always added rather than guessed at.
function dedupeKeyOf(r: ResultRow): string | null {
  const f = r.row.__f;
  const name = normalizeDupKey(getFullName(f));
  const company = normalizeDupKey(f.company);
  if (!name || !company) return null;
  return `${name}::${company}`;
}

// Adds the given rows to one list, skipping any lead already in it (exact
// name+company match) — so re-selecting an already-added lead and hitting
// "Add to list" again is a harmless no-op, not a second copy. Returns how
// many were actually added so the caller can show real feedback.
export function addRowsToList(lists: LeadList[], listId: string, rows: ResultRow[]): { lists: LeadList[]; added: number } {
  const list = lists.find((l) => l.id === listId);
  if (!list) return { lists, added: 0 };
  // Every existing __rowKey, no prefix filtering — a random `row-...`
  // fallback key (used only when a lead has no name or no company to key
  // off of) can never collide with a real `name::company` dedupeKey below,
  // so there's nothing to gain from excluding it, and excluding by prefix
  // wrongly dropped a legitimate dedupe key that happened to start with
  // "row-" (e.g. a lead literally named "Row").
  const existingKeys = new Set(list.rows.map((r) => r.__rowKey));
  const toAdd: ListedLeadRow[] = [];
  rows.forEach((r) => {
    const dedupeKey = dedupeKeyOf(r);
    if (dedupeKey && existingKeys.has(dedupeKey)) return;
    if (dedupeKey) existingKeys.add(dedupeKey);
    const rowKey = dedupeKey || `row-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    toAdd.push({ ...buildExportRow(r), __rowKey: rowKey, __category: r.category, __tier: r.tier });
  });
  if (!toAdd.length) return { lists, added: 0 };
  const updated: LeadList = { ...list, rows: [...list.rows, ...toAdd] };
  return { lists: lists.map((l) => (l.id === listId ? updated : l)), added: toAdd.length };
}

export function removeRowFromList(lists: LeadList[], listId: string, rowKey: string): LeadList[] {
  return lists.map((l) => (l.id === listId ? { ...l, rows: l.rows.filter((r) => r.__rowKey !== rowKey) } : l));
}

export function leadListRawText(list: LeadList): string {
  return toCSV(list.rows, EXPORT_LABELS);
}
