// One status per lead: where it stands, from first scan to outcome.
//
// Per Jack: "manage lead statuses … scan and store qualify and place the
// leads to get acted on", answered as "automatic, with manual override".
//
// DERIVED, NOT STORED. The status is computed from evidence the lead
// already carries — its scan tier, its queue plan, its Apollo sync — so it
// can never drift out of step with them. The only thing stored is a
// person's OVERRIDE, which wins until it is cleared, and which survives
// every re-upload (mergeLeads spreads `...prev`) and every sync
// (applyApolloSync spreads the lead too).
//
// Highest evidence wins. A lead that booked a meeting is "Meeting booked"
// whatever its scan tier says; a lead sitting in a live sequence is "In
// sequence" whether or not it was ever queued here. The order below IS the
// rule — read it top to bottom.
import type { StoredLead } from "./leadStore";

export type LeadStatus =
  | "meeting" | "not-interested"
  | "reached" | "in-sequence" | "called" | "finished"
  | "sent" | "queued"
  | "qualified" | "review" | "disqualified";

export type StatusStage = "intake" | "placed" | "working" | "outcome";

export const STATUS_META: Record<LeadStatus, {
  label: string; stage: StatusStage; color: string; bg: string; hint: string;
}> = {
  meeting: { label: "Meeting booked", stage: "outcome", color: "#0A66C2", bg: "#EAF3FC",
    hint: "An Apollo call outcome says a meeting was booked." },
  "not-interested": { label: "Not interested", stage: "outcome", color: "#B5443B", bg: "#FBEAE8",
    hint: "An Apollo call outcome says not interested, or do not contact." },
  reached: { label: "Reached", stage: "working", color: "#7A5AC8", bg: "#F1ECFB",
    hint: "A real conversation in Apollo — any call outcome other than no answer, voicemail or no disposition — with no booked meeting and no no." },
  called: { label: "Called, not reached", stage: "working", color: "#8A6D3B", bg: "#F7F1E5",
    hint: "Dialled in Apollo, never reached (only no answer, voicemail or no disposition), and not in a live sequence any more." },
  "in-sequence": { label: "In sequence", stage: "working", color: "#0E7A72", bg: "#E3F3F1",
    hint: "Active in an Apollo sequence right now, not yet reached." },
  finished: { label: "Sequence finished", stage: "working", color: "#5B6B72", bg: "#EEF1F2",
    hint: "Went through an Apollo sequence and came out with no contact and no outcome." },
  sent: { label: "Sent to Apollo", stage: "placed", color: "#2A8A5B", bg: "#E5F4EC",
    hint: "Exported from the Apollo queue. Waiting for a sync to show it in a sequence." },
  queued: { label: "Queued", stage: "placed", color: "#9A5B22", bg: "#FBF0E2",
    hint: "Assigned a target sequence in the Apollo queue, not exported yet." },
  qualified: { label: "Strong Signal", stage: "intake", color: "#0E7A72", bg: "#E3F3F1",
    hint: "Top tier on its scanner (Strong Signal / High priority), not worked yet." },
  review: { label: "Needs Review", stage: "intake", color: "#5C7379", bg: "#F1F5F5",
    hint: "Scanned and stored, but not top tier. Worth a read before dropping." },
  disqualified: { label: "Bad Lead", stage: "intake", color: "#B5443B", bg: "#FBEAE8",
    hint: "The scanner's Auto-DQ said no — a rule, not a low score." },
};

/** Pipeline order, left to right: how a lead moves. */
export const STATUS_ORDER: LeadStatus[] = [
  // Intake in Jack's order: "strong signal, bad lead, needs review".
  "qualified", "disqualified", "review",
  "queued", "sent",
  "in-sequence", "called", "reached", "finished",
  "meeting", "not-interested",
];

export const STAGE_META: Record<StatusStage, { label: string }> = {
  intake: { label: "Intake" },
  placed: { label: "Placed" },
  working: { label: "Working" },
  outcome: { label: "Outcome" },
};
export const STAGE_ORDER: StatusStage[] = ["intake", "placed", "working", "outcome"];

const TOP_TIERS = new Set(["High priority", "Strong Signal"]);
const BAD_TIERS = new Set(["Bad Leads", "Bad Lead"]);

/** Apollo outcome names, matched loosely — they arrive as display names
 *  from a sync file, in whatever case Apollo or a hand edit used. */
const MEETING_RE = /meeting\s*booked/i;
const NO_RE = /not\s*interested|do\s*not\s*contact/i;
/** Outcomes that mean the phone rang and nobody real picked up. */
const NOT_REACHED_RE = /no\s*answer|no\s*disposition|left\s*voicemail|voicemail|wrong\s*number|gatekeeper/i;

/* ----------------------------------------------------------------- verdict */

/**
 * The vault's three buckets. Per Jack: "store them as strong bad or needs
 * review". Each scanner keeps its own word on the record (High priority,
 * Strong Signal, Medium priority, No signal…); this folds them into the
 * three the vault is organised by. Anything that is neither top tier nor a
 * rule-based no is Needs Review — including No signal, which was never
 * scored and so has not earned either of the other two.
 */
export type Verdict = "strong" | "review" | "bad";
export const VERDICT_META: Record<Verdict, { label: string; color: string; bg: string; hint: string }> = {
  strong: { label: "Strong Signal", color: "#0E7A72", bg: "#E3F3F1", hint: "Top tier on its scanner: Strong Signal or High priority." },
  review: { label: "Needs Review", color: "#9A5B22", bg: "#FBF0E2", hint: "Stored but not top tier: Medium / Low priority, Needs Review, or No signal." },
  bad: { label: "Bad Lead", color: "#B5443B", bg: "#FBEAE8", hint: "A scanner rule said no (Auto-DQ). Still stored and reversible." },
};
export const VERDICT_ORDER: Verdict[] = ["strong", "review", "bad"];
export function verdictOf(tier: string): Verdict {
  if (TOP_TIERS.has(tier)) return "strong";
  if (BAD_TIERS.has(tier)) return "bad";
  return "review";
}

export interface StatusOverride {
  status: LeadStatus;
  at: string;
}

/** Whether Apollo has a real conversation on record — any outcome other
 *  than no answer, voicemail, gatekeeper or no disposition. */
export function wasReached(a: StoredLead["apollo"]): boolean {
  if (!a) return false;
  return Object.keys(a.outcomes).some((n) => !NOT_REACHED_RE.test(n) && a.outcomes[n] > 0);
}

/** What the evidence says, ignoring any override. */
export function derivedStatus(l: StoredLead): LeadStatus {
  const a = l.apollo;
  if (a) {
    const names = Object.keys(a.outcomes);
    if (names.some((n) => MEETING_RE.test(n) && a.outcomes[n] > 0)) return "meeting";
    if (names.some((n) => NO_RE.test(n) && a.outcomes[n] > 0)) return "not-interested";
    const reached = names.some((n) => !NOT_REACHED_RE.test(n) && a.outcomes[n] > 0);
    if (reached) return "reached";
    // Still being worked: a live sequence outranks "called" — no answers
    // mid-sequence are just the sequence doing its job.
    if (a.sequences.some((s) => s.status === "active")) return "in-sequence";
    if (a.callCount > 0) return "called";
    if (a.sequences.length > 0) return "finished";
  }
  if (l.plan?.status === "exported") return "sent";
  if (l.plan?.status === "queued") return "queued";
  if (BAD_TIERS.has(l.tier)) return "disqualified";
  if (TOP_TIERS.has(l.tier)) return "qualified";
  return "review";
}

/** The status shown everywhere: the override if a person set one. */
export function statusOf(l: StoredLead): LeadStatus {
  return l.statusOverride?.status ?? derivedStatus(l);
}

export function withStatusOverride(l: StoredLead, status: LeadStatus | null, now = new Date().toISOString()): StoredLead {
  if (status === null) {
    if (!l.statusOverride) return l;
    const { statusOverride: _drop, ...rest } = l;
    void _drop;
    return rest as StoredLead;
  }
  // Setting the status the evidence already gives is not an override —
  // storing it would freeze a lead that should keep moving on its own.
  if (status === derivedStatus(l)) return withStatusOverride(l, null, now);
  return { ...l, statusOverride: { status, at: now } };
}

export function countByStatus(leads: StoredLead[]): Record<LeadStatus, number> {
  const out = Object.fromEntries(STATUS_ORDER.map((s) => [s, 0])) as Record<LeadStatus, number>;
  for (const l of leads) out[statusOf(l)]++;
  return out;
}

/* ---------------------------------------------------------- contact state */

/**
 * Has anyone got through? One plain answer per lead, for scanning a list.
 *
 * Per Jack: "see if they have been attempted contact, contact made or
 * contact never made." Narrower than status on purpose — it ignores the
 * scan tier and the queue and answers only the outreach question, from the
 * Apollo sync. An email counts as an attempt; only a call outcome counts as
 * contact made, because a sent email says nothing about being reached.
 */
export type ContactState = "meeting" | "no" | "made" | "attempted" | "never" | "unknown";

export const CONTACT_META: Record<ContactState, { label: string; color: string; bg: string; hint: string }> = {
  meeting: { label: "Meeting booked", color: "#0A66C2", bg: "#EAF3FC", hint: "A call outcome says a meeting was booked." },
  no: { label: "Not interested", color: "#B5443B", bg: "#FBEAE8", hint: "Reached, and said no (or do not contact)." },
  made: { label: "Contact made", color: "#0E7A72", bg: "#E3F3F1", hint: "A real conversation is on record — not just no answer or voicemail." },
  attempted: { label: "Attempted, not reached", color: "#9A5B22", bg: "#FBF0E2", hint: "Called or emailed, but every call was no answer, voicemail or gatekeeper." },
  never: { label: "Never contacted", color: "#5C7379", bg: "#EEF1F2", hint: "In Apollo, with no call and no email logged." },
  unknown: { label: "Not in Apollo", color: "#8A9A9D", bg: "#F5F7F7", hint: "No Apollo sync has matched this lead, so contact history is unknown — not the same as never contacted." },
};

export const CONTACT_ORDER: ContactState[] = ["never", "attempted", "made", "meeting", "no", "unknown"];

export function contactStateOf(l: StoredLead): ContactState {
  const a = l.apollo;
  if (!a) return "unknown";
  const names = Object.keys(a.outcomes);
  if (names.some((n) => MEETING_RE.test(n) && a.outcomes[n] > 0)) return "meeting";
  if (names.some((n) => NO_RE.test(n) && a.outcomes[n] > 0)) return "no";
  if (wasReached(a)) return "made";
  if (a.callCount > 0 || (a.emailCount ?? 0) > 0) return "attempted";
  return "never";
}
