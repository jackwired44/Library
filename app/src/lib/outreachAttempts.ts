// Per-attempt outreach history — the record behind "how many times we've
// tried them and the result each time."
//
// Per Jack: "add a section column for reached status for the leads so it
// shows how many times weve called them or tried reaching them and the
// result each time in a mini board also."
//
// WHY THIS EXISTS AS ITS OWN STORE. `Contact.disposition` is ONE latest
// value. Three voicemails to the same person leave one value, not three,
// and `Contact.callCount` is a bare counter with no date and no outcome
// attached. Neither can answer "the result each time." This store is the
// missing per-attempt row — the same shape a `call` record needs when a
// real dialer lands, so the dialer inherits it rather than replacing it.
//
// WHAT IT DOES NOT CHANGE. `Contact.disposition` stays exactly what it has
// always been and is still the field every existing consumer reads —
// sticky state across uploads, sequence advancement via
// isConnectedDisposition, Home's hot leads and call backs, every filter.
// Logging an attempt WRITES that field as a side effect (see
// contactPatchForAttempt) rather than replacing it, so nothing downstream
// changes behaviour. The attempt log is additive history, not a new source
// of truth competing with the old one.
import { dbGetAll, dbPut, dbDelete, STORE_OUTREACH_ATTEMPTS } from "./db";
import type { Disposition } from "./detection";
import { localDayKeyFromIso } from "./tasks";

export type AttemptChannel = "call" | "email" | "linkedin";

export const ATTEMPT_CHANNEL_META: Record<AttemptChannel, { label: string; icon: string }> = {
  call: { label: "Call", icon: "📞" },
  email: { label: "Email", icon: "✉️" },
  linkedin: { label: "LinkedIn", icon: "🔗" },
};

export interface OutreachAttempt {
  id: string;
  contactId: string;
  channel: AttemptChannel;
  // The outcome of THIS attempt — the same disposition vocabulary used
  // everywhere else (built-in or custom), so the two can never drift into
  // parallel taxonomies. "none" is allowed: a logged attempt with no
  // outcome chosen yet is still a real attempt that happened.
  outcome: Disposition;
  note?: string;
  // When the attempt happened. Full ISO — unlike Task.date, which is a
  // calendar day, an attempt is a moment.
  at: string;
  // Set when the attempt was logged by completing a channel Task, so an
  // attempt can be traced back to the task that produced it.
  taskId?: string | null;
  // Who made the attempt (lib/users.ts). Optional — an attempt logged
  // before a roster existed, or by the single local user, reads unassigned.
  userId?: string | null;
}

function newId() {
  return `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createAttempt(input: {
  contactId: string;
  channel: AttemptChannel;
  outcome?: Disposition;
  note?: string;
  at?: string;
  taskId?: string | null;
  userId?: string | null;
}): OutreachAttempt {
  return {
    id: newId(),
    contactId: input.contactId,
    channel: input.channel,
    outcome: input.outcome || "none",
    note: input.note?.trim() || undefined,
    at: input.at || new Date().toISOString(),
    taskId: input.taskId ?? null,
    userId: input.userId ?? null,
  };
}

/* ------------------------------------------------------------------ */
/* Persistence                                                          */
/* ------------------------------------------------------------------ */
export async function loadAttemptsFromDB(): Promise<OutreachAttempt[]> {
  return dbGetAll<OutreachAttempt>(STORE_OUTREACH_ATTEMPTS);
}
export async function persistAttempt(a: OutreachAttempt) {
  await dbPut(STORE_OUTREACH_ATTEMPTS, a);
}
export async function deleteAttemptFromDB(id: string) {
  await dbDelete(STORE_OUTREACH_ATTEMPTS, id);
}

/* ------------------------------------------------------------------ */
/* Reading                                                              */
/* ------------------------------------------------------------------ */

// Newest first — the mini board reads top-down as "most recent thing that
// happened," which is the order a rep actually wants.
export function attemptsForContact(attempts: OutreachAttempt[], contactId: string): OutreachAttempt[] {
  return attempts
    .filter((a) => a.contactId === contactId)
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

// One index pass instead of filtering the whole array per contact — the
// Contacts table renders a Reached cell for every visible row, and
// Companies rolls up across every contact it holds.
export function groupAttemptsByContact(attempts: OutreachAttempt[]): Map<string, OutreachAttempt[]> {
  const map = new Map<string, OutreachAttempt[]>();
  for (const a of attempts) {
    const list = map.get(a.contactId);
    if (list) list.push(a);
    else map.set(a.contactId, [a]);
  }
  for (const list of map.values()) list.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return map;
}

export interface AttemptSummary {
  total: number;
  calls: number;
  emails: number;
  linkedin: number;
  // The most recent attempt, whatever its channel — what the table cell
  // shows as "where this stands."
  latest: OutreachAttempt | null;
  // Attempts that actually reached the person. Computed by the caller
  // passing a predicate, because "connected" lives in lib/dispositions.ts
  // and importing it here would make this module depend on the custom
  // disposition list just to count.
  reached: number;
}

export function summarizeAttempts(
  list: OutreachAttempt[],
  isConnected: (outcome: Disposition) => boolean
): AttemptSummary {
  const sorted = [...list].sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return {
    total: sorted.length,
    calls: sorted.filter((a) => a.channel === "call").length,
    emails: sorted.filter((a) => a.channel === "email").length,
    linkedin: sorted.filter((a) => a.channel === "linkedin").length,
    latest: sorted[0] || null,
    reached: sorted.filter((a) => isConnected(a.outcome)).length,
  };
}

// How long since the last attempt, in whole local days. null when there
// has never been one — deliberately not 0, which would read as "tried
// today." Same "a missing value never becomes 0" rule the rest of this
// app follows.
export function daysSinceLastAttempt(list: OutreachAttempt[], now = new Date()): number | null {
  if (!list.length) return null;
  const latest = list.reduce((a, b) => (String(a.at) > String(b.at) ? a : b));
  const then = new Date(`${localDayKeyFromIso(latest.at)}T12:00:00`);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  return Math.max(0, Math.round((today.getTime() - then.getTime()) / 86400000));
}

/* ------------------------------------------------------------------ */
/* Keeping Contact in step                                              */
/* ------------------------------------------------------------------ */

// The patch to apply to the Contact when an attempt is logged. Everything
// downstream (sticky state, sequence advancement, Home, filters) reads
// Contact.disposition and the two counters, so logging an attempt has to
// update them or the new history and the old fields would disagree.
//
// The counters are INCREMENTED rather than recomputed from the attempt
// list on purpose: a contact can carry counts from before this store
// existed (see the note in CLAUDE.md), and recomputing would silently
// erase them. Incrementing keeps that older total intact and adds to it.
export function contactPatchForAttempt(
  attempt: OutreachAttempt,
  current: { callCount?: number; emailCount?: number }
): { callCount?: number; emailCount?: number; disposition?: Disposition } {
  const patch: { callCount?: number; emailCount?: number; disposition?: Disposition } = {};
  if (attempt.channel === "call") patch.callCount = (current.callCount || 0) + 1;
  if (attempt.channel === "email") patch.emailCount = (current.emailCount || 0) + 1;
  // A logged attempt with no outcome chosen must not wipe a real
  // disposition already on the record.
  if (attempt.outcome && attempt.outcome !== "none") patch.disposition = attempt.outcome;
  return patch;
}

// Counts that existed BEFORE this store did have no attempt rows behind
// them — no date, no outcome, because none were ever recorded. They can't
// be back-filled, and inventing rows for them would be fabricating data.
// The mini board shows this as an explicit "before history" line instead.
export function untrackedCount(
  contact: { callCount?: number; emailCount?: number },
  list: OutreachAttempt[]
): number {
  const logged = list.filter((a) => a.channel === "call" || a.channel === "email").length;
  const stated = (contact.callCount || 0) + (contact.emailCount || 0);
  return Math.max(0, stated - logged);
}
