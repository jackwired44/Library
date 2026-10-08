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
  qualified: { label: "Qualified", stage: "intake", color: "#0E7A72", bg: "#E3F3F1",
    hint: "Top tier on its scanner (High priority / Strong Signal), not placed yet." },
  review: { label: "Needs review", stage: "intake", color: "#5C7379", bg: "#F1F5F5",
    hint: "Scanned and stored, but not top tier. Worth a read before dropping." },
  disqualified: { label: "Disqualified", stage: "intake", color: "#B5443B", bg: "#FBEAE8",
    hint: "The scanner's Auto-DQ said no — a rule, not a low score." },
};

/** Pipeline order, left to right: how a lead moves. */
export const STATUS_ORDER: LeadStatus[] = [
  "review", "qualified", "disqualified",
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

export interface StatusOverride {
  status: LeadStatus;
  at: string;
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
