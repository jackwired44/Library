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
import type { ApolloSequenceState } from "./leadStore";

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
  /** Each sequence with its status, step and the day the contact was added
   *  to it, when the source states them (a live pull, or a sync file). */
  seqStates?: ApolloSequenceState[];
}

export type ApolloHow = "email" | "name";
export interface ApolloHit {
  how: ApolloHow;
  name: string;
  /** The company Apollo has them at, when known. A name-only match must
   *  agree with it (see apolloHitFor). */
  company?: string;
  sequences: string[];
  uploadedAt?: string;
  /** Status, step and date added per sequence, when the pull stated them. */
  seqStates?: ApolloSequenceState[];
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
    const seqStates = [...(prev?.seqStates ?? []), ...r.sequences.filter((x) => !(prev?.seqStates ?? []).some((y) => y.name === x.name))];
    out.set(key, {
      key, name: r.contact || prev?.name || "", email: r.email || prev?.email || "",
      company: r.company || prev?.company || "", sequences, syncedAt,
      ...(seqStates.length ? { seqStates } : {}),
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
  /** The email first seen for each name, so a second person with the same
   *  name and a different email reads as ambiguous rather than as the first. */
  const nameEmail = new Map<string, string>();
  const add = (email: string, name: string, sequences: string[], uploadedAt?: string, more: string[] = [], company = "", seqStates?: ApolloSequenceState[]) => {
    const e = normEmail(email);
    const n = normPersonName(name);
    const hit = { name, sequences, ...(company ? { company } : {}), ...(uploadedAt ? { uploadedAt } : {}), ...(seqStates?.length ? { seqStates } : {}) };
    if (e.includes("@")) { byEmail.set(e, { how: "email", ...hit }); people.add(`e:${e}`); }
    for (const x of more.map(normEmail)) if (x.includes("@") && !byEmail.has(x)) byEmail.set(x, { how: "email", ...hit });
    if (n.includes(" ")) {
      const prev = byName.get(n);
      // Same person seen twice (same email, or no email) is not ambiguity.
      const firstEmail = nameEmail.get(n) || "";
      const same = prev && (!e.includes("@") || !firstEmail || firstEmail === e);
      if (e.includes("@") && !firstEmail) nameEmail.set(n, e);
      byName.set(n, prev === undefined ? { how: "name", ...hit } : same ? prev : null);
      if (!e.includes("@")) people.add(`x:${n}`);
    }
  };
  for (const r of roster) add(r.email, r.name, r.sequences, r.uploadedAt, r.emails, r.company, r.seqStates);
  for (const l of leads) {
    // A live check's result is shown, but never feeds the "already in
    // Apollo" exclusion. Per Jack: "no calls or downloads".
    if (!l.apollo || l.apollo.live) continue;
    add(l.email, l.contact, sequenceLabels(l.apollo.sequences), undefined, [], l.company);
  }
  return { byEmail, byName, size: people.size };
}

/** A company name reduced to what identifies it ("Acme, Inc." → "acme"). */
export function normCompanyName(s: unknown): string {
  return String(s ?? "").toLowerCase()
    .replace(/&/g, " and ").replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(?:the|inc|incorporated|llc|l l c|ltd|limited|corp|corporation|co|company|plc|pllc|lp|llp|group|holdings)\b/g, " ")
    .replace(/\s+/g, " ").trim();
}
/** Do two company names plausibly name the same company? One reduced name
 *  contains the other ("Acme" / "Acme Manufacturing"). */
export function sameCompany(a: unknown, b: unknown): boolean {
  const x = normCompanyName(a), y = normCompanyName(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

/**
 * Is this row's person already in Apollo? Email first, then a unique name.
 *
 * A name-only match needs the company to agree. "John Smith" at a different
 * company is a different person, and calling him "in Apollo" takes a real
 * new lead out of every download. When either side has no company there is
 * nothing to check against, so the name match stands (labelled "name only").
 */
export function apolloHitFor(
  row: { email?: unknown; contact?: unknown; company?: unknown },
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
  const hit = index.byName.get(n) ?? null;
  if (!hit) return null;
  const rowCo = normCompanyName(row.company);
  if (rowCo && hit.company && normCompanyName(hit.company) && !sameCompany(rowCo, hit.company)) return null;
  return hit;
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
  const hit = apolloHitFor({ email: l.email, contact: l.contact, company: l.company }, index);
  if (!hit) return null;
  if (hit.seqStates?.length) return hit.seqStates.map((s) => ({ name: s.name, active: s.status === "active" }));
  return hit.sequences.map((label) => ({ name: label.replace(/\s*\(active\)$/, ""), active: /\(active\)$/.test(label) }));
}
