// Whose lead is it: Carly's or Jack's.
//
// Per Jack: "filter by owner of sequence also so i can see all carlys or all
// jacks", then "build a table for all of carlys leads and jacks" and "want
// her to have access to her assigned leads and see where they all stand".
//
// A lead belongs to the rep whose name heads a sequence it is (or was) in —
// "Carly Main Sequence", "Jack Main Backup Sequence" — from its live check
// or the pulled Apollo uploads. With no named sequence, the Apollo contact
// owner decides. With neither it is Unassigned: never guessed.
import type { StoredLead } from "./leadStore";
import { apolloHitFor, type RosterIndex } from "./apolloRoster";

export const REPS = ["Carly", "Jack"] as const;
export const UNASSIGNED = "Unassigned";

/** The reps named on these sequences, else the contact owner's first name. */
export function ownersOf(sequenceNames: string[], liveOwner?: string): string[] {
  const out = new Set<string>();
  for (const n of sequenceNames) for (const o of REPS) if (new RegExp(`\\b${o}\\b`, "i").test(n)) out.add(o);
  if (!out.size && liveOwner) out.add(liveOwner.split(/\s+/)[0]);
  return [...out];
}

export function ownersOfLead(l: StoredLead, index: RosterIndex | null): string[] {
  const seqs = (l.apollo?.sequences ?? []).map((s) => s.name);
  const hit = apolloHitFor({ email: l.email, contact: l.contact, company: l.company }, index);
  return ownersOf([...seqs, ...(hit?.sequences ?? [])], l.apollo?.live?.owner);
}
