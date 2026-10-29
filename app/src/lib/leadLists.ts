// Custom Lead Lists — Jack hand-picks specific leads (any tier, not just
// Strong Signal) out of a Scanner batch and groups them into his own named
// lists, downloadable as CSV any time. Deliberately separate from the Lead
// Library (which only ever files Strong Signal rows, auto-organized by
// month/category) — this is the opposite: any lead, grouped however Jack
// wants. See CLAUDE.md "Custom Lead Lists."

import { dbGetAll, dbPut, dbDelete, STORE_LEAD_LISTS } from "./db";
import { buildExportRow, getFullName, normalizeDupKey, EXPORT_LABELS, type CategoryKey, type ExportRow, type ResultRow, type Tier } from "./detection";
import { toCSV } from "./csv";
import { buildContactIndex, lookupContact, type Contact } from "./contacts";
import type { SmartRule } from "./smartRules";
import { normCompany, normEmail } from "./leadStore";

export type ListedLeadRow = ExportRow & {
  __rowKey: string;
  /** Main / SMC scanners only. A CSP row has no product line by design, so
   *  this is absent there and `__band` carries the label instead. */
  __category?: CategoryKey;
  __tier?: Tier;
  /** Which scanner the row came from, so a list can mix sources honestly. */
  __scanner?: "main" | "smc" | "csp";
  /** The CSP priority band ("High priority"), shown where a category would be. */
  __band?: string;
  /** The CSP score, so a list stays in the order that matters. */
  __score?: number;
};

export interface LeadList {
  id: string;
  name: string;
  createdAt: string;
  rows: ListedLeadRow[];
  // Campaign fields. Per Jack: "have these added leads stored as lists with
  // the created date and taggs so then i can move them but maintain who i am
  // contacting", cycled "every 45 or 60 days … to push to a new campign".
  // All optional: a list saved before these existed is a plain list.
  tags?: string[];
  /** The campaign this list feeds, e.g. "Q4 M365 licensing". */
  campaign?: string;
  /** Days after `createdAt` the list is due to be cycled into a new one. */
  cycleDays?: number | null;
  /** "cycled" once its leads were moved into a newer list. */
  status?: "active" | "cycled";
  /** The list this one was cycled from, if any. */
  cycledFrom?: string;
  /** A smart list: the saved rule its rows are re-run from. Per Jack,
   *  "saved rules that refresh" — see lib/smartRules.ts. A list without
   *  one is a plain list whose rows only change by hand. */
  rule?: SmartRule;
  /** The words the rule was read from, kept so the list says what it is. */
  ruleText?: string;
  ruleRefreshedAt?: string;
  /** Refresher (lib/refresher.ts): the Apollo sequence this list was handed
   *  off for, when its import CSV was downloaded, and which suggestion it
   *  came from. Read-only toward Apollo: the list reads "In sequence" once a
   *  check sees its leads there. */
  targetSequence?: string;
  handedOffAt?: string;
  refresherId?: string;
  /** Per Jack: a lead an Apollo check shows ACTIVE in a sequence stays on
   *  the list but is left out of the list's download, unless overridden —
   *  for the whole list (`includeActive`) or one lead at a time
   *  (`includeRowKeys`). Both optional: unset = leave them out. */
  includeActive?: boolean;
  includeRowKeys?: string[];
  /** Rows sent to Apollo from this list: rowKey → when. Stamped when the
   *  list is downloaded (or marked sent by hand), so a later list, or a
   *  re-check, can tell the lead was already handed off. Per Jack: "i
   *  uploaded 830 into apollo … we need it to catch the already added ones
   *  for the future". */
  sentAt?: Record<string, string>;
  /** Include leads already sent to Apollo from another list in this list's
   *  download. Off by default. */
  includeSent?: boolean;
  /** Per Jack: "pull up a seuqnece here … side by side to see which leads got
   *  added and which didnt so i can note why". The Apollo sequence this list
   *  is compared against (its name is `targetSequence`), who owns it, and a
   *  note per row on why it wasn't added. All optional. */
  targetSequenceId?: string;
  targetSequenceOwner?: string;
  /** The day Apollo created that sequence (YYYY-MM-DD), from the picker.
   *  A lead checked before this day cannot show as in it yet. */
  targetSequenceCreatedAt?: string;
  rowNotes?: Record<string, string>;
}

/** Replace a smart list's rows with a fresh run of its rule. Rows already
 *  in it keep their key, so "Also on" and removal stay stable. */
export function setSmartListRows(lists: LeadList[], id: string, rows: ListedLeadRow[], at = new Date().toISOString()): LeadList[] {
  return lists.map((l) => (l.id === id ? { ...l, rows, ruleRefreshedAt: at } : l));
}

/** Same key the add-to-list paths use (first name + company), so a lead is
 *  the same row whether a smart list or a hand-built list holds it. */
export function listRowKey(row: ExportRow): string {
  const name = normalizeDupKey(row["First Name"] || "");
  const company = normalizeDupKey(row["Company Name"] || "");
  return name && company ? `${name}::${company}` : `row-${normalizeDupKey(row["Email"] || "") || Math.random().toString(36).slice(2, 10)}`;
}

export const CYCLE_CHOICES = [45, 60] as const;

/** The day a campaign list is due to cycle, or null when it has no cycle. */
export function cycleDueOn(list: LeadList): string | null {
  if (!list.cycleDays || list.cycleDays <= 0) return null;
  const d = new Date(list.createdAt);
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + list.cycleDays);
  return d.toISOString().slice(0, 10);
}
/** Days until (positive) or past (negative) the cycle date. */
export function daysToCycle(list: LeadList, today = new Date()): number | null {
  const due = cycleDueOn(list);
  if (!due) return null;
  const t = new Date(today.toISOString().slice(0, 10) + "T00:00:00Z").getTime();
  return Math.round((new Date(due + "T00:00:00Z").getTime() - t) / 86_400_000);
}
export const isCampaignList = (l: LeadList) => !!(l.campaign || l.cycleDays || l.tags?.length);
/** A list that is still being worked: a campaign list not yet cycled. */
export const isActiveCampaign = (l: LeadList) => isCampaignList(l) && l.status !== "cycled";

/** Every active campaign list each lead is on, keyed by the list row key
 *  (name + company). This is "maintain who I am contacting": a lead on two
 *  live campaigns is visible as such before it is contacted twice. */
export function campaignMembership(lists: LeadList[]): Map<string, LeadList[]> {
  const m = new Map<string, LeadList[]>();
  for (const l of lists) {
    if (!isActiveCampaign(l)) continue;
    for (const r of l.rows) {
      if (!r.__rowKey || r.__rowKey.startsWith("row-")) continue;
      const arr = m.get(r.__rowKey) ?? [];
      arr.push(l); m.set(r.__rowKey, arr);
    }
  }
  return m;
}

/* ------------------------------------------------- "already on a list" */
// Per Jack: "filter out leads added to a list so if i upload a csv to scan i
// can remove ones i added to a list or even in all leads". The lists that
// count are the ones he BUILT: hand-picked, snapshots, Refresher hand-offs,
// cycled ones included (those leads were still worked). A smart list (one
// with a `rule`) is a live view re-run from the leads, not a record of who
// was picked, so it never hides anyone.
export type ListPick = "any" | string;

export interface ListMatchIndex {
  byName: Map<string, LeadList[]>;
  byEmail: Map<string, LeadList[]>;
  /** The built lists, newest first, for a picker. */
  lists: LeadList[];
}

export const isBuiltList = (l: LeadList) => !l.rule;

function nameKey(name: unknown, company: unknown): string {
  const n = String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const c = normCompany(company);
  return n && c ? `${n}::${c}` : "";
}
function emailKey(email: unknown): string {
  const e = normEmail(email);
  return e.includes("@") ? e : "";
}

export function listMatchIndex(lists: LeadList[]): ListMatchIndex {
  const byName = new Map<string, LeadList[]>();
  const byEmail = new Map<string, LeadList[]>();
  const add = (m: Map<string, LeadList[]>, k: string, l: LeadList) => {
    if (!k) return;
    const arr = m.get(k);
    if (!arr) m.set(k, [l]); else if (!arr.includes(l)) arr.push(l);
  };
  const built = lists.filter(isBuiltList);
  for (const l of built) {
    for (const r of l.rows) {
      add(byName, nameKey(`${r["First Name"] || ""} ${r["Last Name"] || ""}`, r["Company Name"]), l);
      add(byEmail, emailKey(r.Email), l);
    }
  }
  const lists2 = [...built].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  return { byName, byEmail, lists: lists2 };
}

/** Every built list this person is on: same email, or same full name at
 *  the same company. A lead with neither can't be matched and isn't. */
export function listsHolding(idx: ListMatchIndex, lead: { contact?: string; company?: string; email?: string }): LeadList[] {
  const out: LeadList[] = [];
  for (const l of idx.byEmail.get(emailKey(lead.email)) ?? []) out.push(l);
  for (const l of idx.byName.get(nameKey(lead.contact, lead.company)) ?? []) if (!out.includes(l)) out.push(l);
  return out;
}

/** On the picked list ("any" = any built list). */
export function onPickedList(idx: ListMatchIndex, lead: { contact?: string; company?: string; email?: string }, pick: ListPick): boolean {
  if (!idx.byName.size && !idx.byEmail.size) return false;
  const on = listsHolding(idx, lead);
  return pick === "any" ? on.length > 0 : on.some((l) => l.id === pick);
}

export function updateLeadListMeta(lists: LeadList[], id: string, patch: Partial<Pick<LeadList, "tags" | "campaign" | "cycleDays" | "status" | "includeActive" | "includeRowKeys" | "sentAt" | "includeSent" | "targetSequence" | "targetSequenceId" | "targetSequenceOwner" | "targetSequenceCreatedAt" | "rowNotes">>): LeadList[] {
  return lists.map((l) => (l.id === id ? { ...l, ...patch } : l));
}
/** "a, b ,c" -> ["a","b","c"], deduped, case kept from first sight. */
export function parseTags(text: string): string[] {
  const seen = new Set<string>(); const out: string[] = [];
  for (const t of text.split(",").map((x) => x.trim()).filter(Boolean)) {
    const k = t.toLowerCase(); if (seen.has(k)) continue; seen.add(k); out.push(t);
  }
  return out;
}

/**
 * Cycle a campaign list: its leads move into a NEW list (today's created
 * date, same tags and cycle, named for the campaign and today), sorted by
 * company so the summarized notes for one company sit together, and the old
 * list is marked cycled. Nothing is deleted; the old list stays as history
 * of who was contacted when. Leads chosen by `keep` only (default: all).
 */
export function cycleLeadList(lists: LeadList[], id: string, name?: string, keep?: (r: ListedLeadRow) => boolean, now = new Date()): { lists: LeadList[]; list: LeadList | null } {
  const src = lists.find((l) => l.id === id);
  if (!src) return { lists, list: null };
  const day = now.toISOString().slice(0, 10);
  const rows = src.rows.filter(keep ?? (() => true))
    .slice().sort((a, b) => String(a["Company Name"] || "").localeCompare(String(b["Company Name"] || "")));
  const list: LeadList = {
    id: newId(), name: (name || `${src.campaign || src.name} \u2014 ${day}`).trim(), createdAt: now.toISOString(), rows,
    tags: src.tags ? [...src.tags] : undefined, campaign: src.campaign, cycleDays: src.cycleDays ?? null,
    status: "active", cycledFrom: src.id,
  };
  const marked = lists.map((l) => (l.id === id ? { ...l, status: "cycled" as const } : l));
  return { lists: [list, ...marked], list };
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

/**
 * Add rows that are ALREADY in the export shape — the CSP scanner builds
 * its own (its Product Area is a priority band, not a product line), so it
 * has no ResultRow to hand over. Same name+company dedupe as the path
 * above, so adding the same lead twice is still a no-op.
 */
export function addExportRowsToList(
  lists: LeadList[],
  listId: string,
  rows: { row: ExportRow; scanner: "main" | "smc" | "csp"; band?: string; score?: number }[],
): { lists: LeadList[]; added: number; skipped: number } {
  const list = lists.find((l) => l.id === listId);
  if (!list) return { lists, added: 0, skipped: 0 };
  const existingKeys = new Set(list.rows.map((r) => r.__rowKey));
  const toAdd: ListedLeadRow[] = [];
  let skipped = 0;
  for (const { row, scanner, band, score } of rows) {
    const name = normalizeDupKey(row["First Name"] || "");
    const company = normalizeDupKey(row["Company Name"] || "");
    const dedupeKey = name && company ? `${name}::${company}` : null;
    if (dedupeKey && existingKeys.has(dedupeKey)) { skipped++; continue; }
    if (dedupeKey) existingKeys.add(dedupeKey);
    toAdd.push({
      ...row,
      __rowKey: dedupeKey || `row-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      __scanner: scanner,
      __band: band,
      __score: score,
    });
  }
  if (!toAdd.length) return { lists, added: 0, skipped };
  const updated: LeadList = { ...list, rows: [...list.rows, ...toAdd] };
  return { lists: lists.map((l) => (l.id === listId ? updated : l)), added: toAdd.length, skipped };
}

export function removeRowFromList(lists: LeadList[], listId: string, rowKey: string): LeadList[] {
  return lists.map((l) => (l.id === listId ? { ...l, rows: l.rows.filter((r) => r.__rowKey !== rowKey) } : l));
}

export function leadListRawText(list: LeadList): string {
  return toCSV(list.rows, EXPORT_LABELS);
}

// Resolves a list's own row snapshots (plain export columns — a list row
// has no direct link back to a Contact id) onto the real, live Contacts
// they came from, so a whole list can be bulk-enrolled into a Sequence in
// one action — per Jack: "will scan leads assign to lists then post to
// sequences basically." Same email-first/name+company-fallback lookup
// every other cross-referencing in this app already uses (see
// lib/contacts.ts's buildContactIndex/lookupContact). A row that matches
// no Contact (e.g. the source upload predates that person ever being
// scanned, or they were manually added to the list some other way) is
// counted but skipped rather than guessed at — the caller surfaces that
// count so it isn't silent.
export function resolveListContacts(list: LeadList, contacts: Contact[]): { resolved: Contact[]; unresolvedCount: number } {
  const index = buildContactIndex(contacts);
  const seen = new Set<string>();
  const resolved: Contact[] = [];
  let unresolvedCount = 0;
  list.rows.forEach((r) => {
    const fullName = `${r["First Name"] || ""} ${r["Last Name"] || ""}`.trim();
    const company = r["Company Name"] || "";
    const email = r["Email"] || "";
    const contact = lookupContact(index, fullName, company, email);
    if (!contact) { unresolvedCount++; return; }
    if (seen.has(contact.id)) return;
    seen.add(contact.id);
    resolved.push(contact);
  });
  return { resolved, unresolvedCount };
}

// Which lists a given contact is on, and which product-line categories
// their rows carry in each — the inverse of resolveListContacts above,
// for the contact record-details view (per Jack: "lists they're attached
// to ... the product lines and categories associated"). Same email-first/
// name+company-fallback matching, so a list row and a live Contact line
// up exactly the way they do everywhere else in this app.
export function listsForContact(
  lists: LeadList[],
  contacts: Contact[],
  contactId: string
): { list: LeadList; categories: CategoryKey[] }[] {
  const index = buildContactIndex(contacts);
  const out: { list: LeadList; categories: CategoryKey[] }[] = [];
  lists.forEach((list) => {
    const categories = new Set<CategoryKey>();
    let onList = false;
    list.rows.forEach((r) => {
      const fullName = `${r["First Name"] || ""} ${r["Last Name"] || ""}`.trim();
      const match = lookupContact(index, fullName, r["Company Name"] || "", r["Email"] || "");
      if (match && match.id === contactId) {
        onList = true;
        if (r.__category) categories.add(r.__category);
      }
    });
    if (onList) out.push({ list, categories: [...categories] });
  });
  return out;
}

/** Where a person was already sent to Apollo from a list. */
export interface SentRecord { listId: string; listName: string; sequence: string; at: string }
export interface SentIndex { byName: Map<string, SentRecord[]>; byEmail: Map<string, SentRecord[]> }

/** Every lead stamped as sent from any list, keyed the same way the list
 *  matcher is: the same email, or the full name at the same company. */
export function sentIndex(lists: LeadList[]): SentIndex {
  const byName = new Map<string, SentRecord[]>();
  const byEmail = new Map<string, SentRecord[]>();
  const add = (m: Map<string, SentRecord[]>, k: string, rec: SentRecord) => {
    if (!k) return;
    const arr = m.get(k);
    if (!arr) m.set(k, [rec]); else if (!arr.some((x) => x.listId === rec.listId)) arr.push(rec);
  };
  for (const l of lists) {
    if (!l.sentAt) continue;
    for (const r of l.rows) {
      const at = l.sentAt[r.__rowKey];
      if (!at) continue;
      const rec = { listId: l.id, listName: l.name, sequence: l.targetSequence || "", at };
      add(byEmail, emailKey(r.Email), rec);
      add(byName, nameKey(`${r["First Name"] || ""} ${r["Last Name"] || ""}`, r["Company Name"]), rec);
    }
  }
  return { byName, byEmail };
}

/** Lists this person was sent to Apollo from, oldest first. */
export function sentRecordsFor(idx: SentIndex, lead: { contact?: string; company?: string; email?: string }): SentRecord[] {
  const out: SentRecord[] = [];
  for (const x of idx.byEmail.get(emailKey(lead.email)) ?? []) out.push(x);
  for (const x of idx.byName.get(nameKey(lead.contact, lead.company)) ?? []) if (!out.some((y) => y.listId === x.listId)) out.push(x);
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

/** Stamp these rows as sent now (keeps an earlier stamp). */
export function stampSent(list: LeadList, rowKeys: string[], at = new Date().toISOString()): Record<string, string> {
  const next = { ...(list.sentAt ?? {}) };
  for (const k of rowKeys) if (!next[k]) next[k] = at;
  return next;
}
