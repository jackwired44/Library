// Who is already in Apollo — kept here so a new upload can be checked
// against it before anything goes back into Apollo.
//
// Per Jack: "if i upload a new set of leads [see] if any of those have been
// added in apollo already so i can remove them from the csv — set up a
// parallel here."
//
// The roster is a MIRROR, filled only from Apollo sync files you import
// (All leads → Import sync). It keeps EVERY person in those files, not just
// the ones that matched a stored lead — 1,333 of the first task sync's
// 1,841 people matched nobody here, and those are exactly the people a new
// upload most needs checking against. Nothing here calls Apollo.
//
// Matching, strongest first:
//   - email — definite.
//   - full name (two words or more), when only ONE roster person has it —
//     likely, and labelled as such, because Apollo's task feed carries a
//     name and nothing else. A name shared by two roster people is never
//     guessed between.
import { STORE_APOLLO_ROSTER, dbBulkPut, dbGetAll } from "./db";
import { normEmail, type StoredLead } from "./leadStore";
import type { ApolloSyncRow } from "./apolloSync";

export interface ApolloRosterEntry {
  /** "e:<email>" or "x:<full name>". */
  key: string;
  name: string;
  email: string;
  company: string;
  /** Sequence names, with "(active)" on the live ones. */
  sequences: string[];
  /** When the sync that last mentioned this person was imported. */
  syncedAt: string;
  /** Every address Apollo holds for them (a pulled contact can have
   *  several). Each one matches. */
  emails?: string[];
  /** When the contact was uploaded into Apollo — from a live pull only. */
  uploadedAt?: string;
}

export type ApolloHow = "email" | "name";
export interface ApolloHit {
  how: ApolloHow;
  name: string;
  sequences: string[];
  uploadedAt?: string;
}

export const normPersonName = (s: unknown) =>
  String(s ?? "").toLowerCase().replace(/[^a-z\s'-]/g, " ").replace(/\s+/g, " ").trim();

function rosterKey(email: string, name: string): string {
  const e = normEmail(email);
  if (e.includes("@")) return `e:${e}`;
  const n = normPersonName(name);
  return n.includes(" ") ? `x:${n}` : "";
}

function sequenceLabels(seqs: { name: string; status: string }[]): string[] {
  return seqs.map((s) => (s.status === "active" ? `${s.name} (active)` : s.name));
}

/** Every person in a sync file, keyed. Rows that carry neither an email nor
 *  a two-word name have nothing to check a new upload against, and are
 *  counted by the caller rather than stored. */
export function rosterFromSync(rows: ApolloSyncRow[], syncedAt = new Date().toISOString()): ApolloRosterEntry[] {
  const out = new Map<string, ApolloRosterEntry>();
  for (const r of rows) {
    const key = rosterKey(r.email, r.contact);
    if (!key) continue;
    const prev = out.get(key);
    const sequences = [...new Set([...(prev?.sequences ?? []), ...sequenceLabels(r.sequences)])];
    out.set(key, {
      key, name: r.contact || prev?.name || "", email: r.email || prev?.email || "",
      company: r.company || prev?.company || "", sequences, syncedAt,
    });
  }
  return [...out.values()];
}

export interface RosterIndex {
  byEmail: Map<string, ApolloHit>;
  /** null = two different people share the name; never guessed between. */
  byName: Map<string, ApolloHit | null>;
  size: number;
}

/** One index over the roster plus any stored lead that a sync has already
 *  matched (those are in Apollo too, and may carry the email the roster
 *  row lacked). */
export function buildRosterIndex(roster: ApolloRosterEntry[], leads: StoredLead[] = []): RosterIndex {
  const byEmail = new Map<string, ApolloHit>();
  const byName = new Map<string, ApolloHit | null>();
  const people = new Set<string>();
  const add = (email: string, name: string, sequences: string[], uploadedAt?: string, more: string[] = []) => {
    const e = normEmail(email);
    const n = normPersonName(name);
    const hit = { name, sequences, ...(uploadedAt ? { uploadedAt } : {}) };
    if (e.includes("@")) { byEmail.set(e, { how: "email", ...hit }); people.add(`e:${e}`); }
    for (const x of more.map(normEmail)) if (x.includes("@") && !byEmail.has(x)) byEmail.set(x, { how: "email", ...hit });
    if (n.includes(" ")) {
      const prev = byName.get(n);
      // Same person seen twice (same email, or no email) is not ambiguity.
      const same = prev && (!e.includes("@") || prev.name === name);
      byName.set(n, prev === undefined ? { how: "name", ...hit } : same ? prev : null);
      if (!e.includes("@")) people.add(`x:${n}`);
    }
  };
  for (const r of roster) add(r.email, r.name, r.sequences, r.uploadedAt, r.emails);
  for (const l of leads) {
    if (!l.apollo) continue;
    add(l.email, l.contact, sequenceLabels(l.apollo.sequences));
  }
  return { byEmail, byName, size: people.size };
}

/** Is this row's person already in Apollo? Email first, then a unique name. */
export function apolloHitFor(
  row: { email?: unknown; contact?: unknown },
  index: RosterIndex | null,
): ApolloHit | null {
  if (!index || index.size === 0) return null;
  const e = normEmail(row.email);
  if (e.includes("@")) {
    const hit = index.byEmail.get(e);
    if (hit) return hit;
  }
  const n = normPersonName(row.contact);
  if (!n.includes(" ")) return null;
  return index.byName.get(n) ?? null;
}

export async function loadApolloRoster(): Promise<ApolloRosterEntry[]> {
  return dbGetAll<ApolloRosterEntry>(STORE_APOLLO_ROSTER);
}

export async function saveApolloRoster(entries: ApolloRosterEntry[]): Promise<void> {
  if (entries.length) await dbBulkPut(STORE_APOLLO_ROSTER, entries);
}

/** Merge new entries over old by key: a person's latest sync wins. */
export function mergeRoster(prev: ApolloRosterEntry[], next: ApolloRosterEntry[]): ApolloRosterEntry[] {
  const m = new Map(prev.map((e) => [e.key, e]));
  for (const e of next) m.set(e.key, e);
  return [...m.values()];
}

/** The Apollo sequences a stored lead is in, as far as anything here knows:
 *  an imported sync first (it carries status), else the pulled uploads.
 *  null = not known to be in Apollo at all. */
export function apolloSequencesFor(
  l: StoredLead, index: RosterIndex | null,
): { name: string; active: boolean }[] | null {
  if (l.apollo) return l.apollo.sequences.map((s) => ({ name: s.name, active: s.status === "active" }));
  const hit = apolloHitFor({ email: l.email, contact: l.contact }, index);
  if (!hit) return null;
  return hit.sequences.map((label) => ({ name: label.replace(/\s*\(active\)$/, ""), active: /\(active\)$/.test(label) }));
}
