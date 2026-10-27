// The recycle queue: leads that were worked and never answered, coming back
// round after a rest.
//
// Per Jack: "see when a lead that hasnt been contacted should be recontacted
// after x amount of unanswered attempts so i can recycle it down the road",
// then: "itll sit in a queue where i can then re download those ones and
// assign them to a sequence in apollo … unless i can just build a
// manageable workflow here that i can see".
//
// So the queue is a WORKFLOW, worked from here, and Apollo stays read-only:
//
//   Resting  ->  Ready  ->  Downloaded  ->  Back in a sequence
//
// Resting and Ready come from the calls Apollo has on record OR, per Jack
// ("i need a simple way to check leads in here agasint apollo so i know when
// to recycle a lead to a new sequence"), from a sequence that ended with no
// reply or conversation — the live Apollo check always reads that, even
// where it cannot read call history. Downloaded is
// the one thing stored here (lead.recycle.downloadedAt), stamped when the
// rep downloads the Ready leads to load into Apollo. Back in a sequence is
// confirmed by the next Apollo check showing a live sequence again; nothing
// is ever written to Apollo from this platform.
//
// DERIVED like lead status: the stage is computed from evidence every time,
// so a lead that is re-sequenced, rings out again and finishes simply comes
// back to Resting with a new date. No stage can go stale.
import type { StoredLead } from "./leadStore";
import { engagementOf } from "./engagements";
import { statusOf } from "./leadStatus";

export interface RecycleRules {
  /** Unanswered calls before a never-reached lead can be recycled. */
  attempts: number;
  /** Days to rest after the last attempt. */
  restDays: number;
  /** Months before a "Not interested" comes back. */
  notInterestedMonths: number;
}

/** Per Jack: 3 unanswered attempts, 22 days rest, Not interested after 6
 *  months. */
export const DEFAULT_RECYCLE_RULES: RecycleRules = { attempts: 3, restDays: 22, notInterestedMonths: 6 };

const RULES_KEY = "recycleRules";

export function loadRecycleRules(): RecycleRules {
  try {
    const raw = localStorage.getItem(RULES_KEY);
    if (!raw) return { ...DEFAULT_RECYCLE_RULES };
    return cleanRules({ ...DEFAULT_RECYCLE_RULES, ...(JSON.parse(raw) as Partial<RecycleRules>) });
  } catch { return { ...DEFAULT_RECYCLE_RULES }; }
}

export function saveRecycleRules(r: RecycleRules): void {
  try { localStorage.setItem(RULES_KEY, JSON.stringify(cleanRules(r))); } catch { /* preference only */ }
}

/** A blank or silly value (0 attempts, a negative rest) is never stored:
 *  it would put every lead in the queue at once. */
export function cleanRules(r: RecycleRules): RecycleRules {
  const n = (v: unknown, lo: number, hi: number, d: number) => {
    const x = Math.round(Number(v));
    return Number.isFinite(x) && x >= lo ? Math.min(x, hi) : d;
  };
  return {
    attempts: n(r.attempts, 1, 50, DEFAULT_RECYCLE_RULES.attempts),
    restDays: n(r.restDays, 1, 365, DEFAULT_RECYCLE_RULES.restDays),
    notInterestedMonths: n(r.notInterestedMonths, 1, 36, DEFAULT_RECYCLE_RULES.notInterestedMonths),
  };
}

/* ------------------------------------------------------------- outcomes */

/** The phone rang and nobody real picked up. Wrong number is NOT here: a
 *  wrong number is a dead number, not an unanswered one. */
export const UNANSWERED_RE = /no\s*answer|no\s*disposition|voicemail|gatekeeper|front\s*desk|busy/i;
const MEETING_RE = /meeting\s*booked/i;
const DNC_RE = /do\s*not\s*(contact|call)|\bdnc\b|opt(ed)?[\s-]*out|unsubscrib/i;
const NOT_INTERESTED_RE = /not\s*interested/i;
const WRONG_NUMBER_RE = /wrong\s*number|bad\s*number|invalid\s*number|disconnected/i;
const BAD_TIERS = new Set(["Bad Leads", "Bad Lead"]);
/** Apollo's own reason a sequence ended, when it says someone answered. */
const REACHED_REASON_RE = /talk|spoke|conversation|repl|demo|interest|info|pending\s*review|call\s*back|callback/i;
const BOUNCED_RE = /bounc/i;

/* ---------------------------------------------------------------- stage */

export type RecycleStage =
  | "ready" | "resting" | "downloaded" | "back"
  | "building" | "fresh" | "working" | "excluded" | "unchecked";

export const RECYCLE_META: Record<RecycleStage, { label: string; hint: string; color: string; bg: string }> = {
  ready: { label: "Ready to recycle", hint: "Rested long enough. Download them and load them into a sequence in Apollo.", color: "#0E7A72", bg: "#E3F3F1" },
  resting: { label: "Resting", hint: "Worked and unanswered, waiting out the rest period.", color: "#9A5B22", bg: "#FBF0E2" },
  downloaded: { label: "Downloaded", hint: "Downloaded for Apollo. Waiting for the next Apollo check to show them in a sequence again.", color: "#0A66C2", bg: "#EAF3FC" },
  back: { label: "Back in a sequence", hint: "Downloaded here, and an Apollo check now shows them in a live sequence.", color: "#3B6E22", bg: "#E8F3E1" },
  building: { label: "Fewer attempts", hint: "Called, but not yet enough unanswered attempts to recycle.", color: "#5C7379", bg: "#EEF1F2" },
  working: { label: "Being worked", hint: "In a live sequence now, or reached someone. Not for recycling.", color: "#5C7379", bg: "#EEF1F2" },
  excluded: { label: "Not recycled", hint: "Account manager only, do not contact, wrong number, a meeting booked, or a Bad Lead.", color: "#8A9A9D", bg: "#F5F7F7" },
  fresh: { label: "Never sequenced", hint: "Checked: not in Apollo, or in Apollo with no sequence. Give it a first sequence; it isn't a recycle.", color: "#0A66C2", bg: "#EAF3FC" },
  unchecked: { label: "Not checked", hint: "Not looked up in Apollo yet — click Check in Apollo. Not guessed.", color: "#8A9A9D", bg: "#F5F7F7" },
};

/** The workflow, in order. The rest are outside the queue. */
export const RECYCLE_FLOW: RecycleStage[] = ["ready", "resting", "downloaded", "back"];
export const RECYCLE_ORDER: RecycleStage[] = [...RECYCLE_FLOW, "building", "fresh", "working", "excluded", "unchecked"];

export interface RecycleInfo {
  stage: RecycleStage;
  /** Unanswered calls on record. */
  unanswered: number;
  /** Newest attempt Apollo has a date for, ISO. "" when none is dated. */
  lastAttemptAt: string;
  /** When it comes back, YYYY-MM-DD. "" when not in the queue, or when the
   *  last attempt carries no date (then it reads Ready, and says why). */
  recycleOn: string;
  /** "unanswered" (the attempts rule), "sequence-ended" (a sequence finished
   *  with no reply or conversation) or "not-interested" (the 6-month rule). */
  why: "unanswered" | "sequence-ended" | "not-interested" | "";
  /** Why it is outside the queue, for excluded / building / working. */
  reason: string;
}

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function addDays(iso: string, days: number): string {
  const d = new Date(iso); d.setDate(d.getDate() + days); return dayKey(d);
}
function addMonths(iso: string, months: number): string {
  const d = new Date(iso); const day = d.getDate();
  d.setDate(1); d.setMonth(d.getMonth() + months);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return dayKey(d);
}

const validIso = (s: string | undefined) => !!s && !Number.isNaN(Date.parse(s));

/** The newest dated attempt: a call, else a completed sequence task. */
export function lastAttemptOf(a: NonNullable<StoredLead["apollo"]>): string {
  const dates: string[] = [];
  if (validIso(a.lastCallAt)) dates.push(a.lastCallAt);
  if (a.history?.[0] && validIso(a.history[0].at)) dates.push(a.history[0].at);
  for (const s of a.sequences) {
    if (validIso(s.lastDoneAt)) dates.push(s.lastDoneAt!);
    if (validIso(s.finishedAt)) dates.push(s.finishedAt!);
  }
  if (!dates.length) return "";
  return dates.reduce((m, d) => (Date.parse(d) > Date.parse(m) ? d : m));
}

/** Unanswered calls: the outcomes that say so, or — when the outcome names
 *  are missing but nobody was ever reached — every call on record. */
export function unansweredOf(a: NonNullable<StoredLead["apollo"]>): number {
  let named = 0, other = 0;
  for (const [k, v] of Object.entries(a.outcomes)) {
    if (UNANSWERED_RE.test(k)) named += v; else other += v;
  }
  if (other === 0) return Math.max(named, a.callCount);
  return named;
}

export function recycleOf(l: StoredLead, rules: RecycleRules = DEFAULT_RECYCLE_RULES, today = dayKey(new Date())): RecycleInfo {
  const base = { unanswered: 0, lastAttemptAt: "", recycleOn: "", why: "" as const, reason: "" };
  if (engagementOf(l)) return { ...base, stage: "excluded", reason: "Account manager only" };
  if (BAD_TIERS.has(l.tier)) return { ...base, stage: "excluded", reason: "Bad Lead" };
  // Per Jack: "the end goal is to never add the same lead to two sequences
  // or add a lead we have already spoken with and have clear next steps to
  // a sequence again since its already been handled". The platform's own
  // status (Apollo evidence, the pulled Apollo uploads, or a status set by
  // hand) is checked first, so none of those can ever read Ready.
  const st = statusOf(l);
  if (st === "meeting") return { ...base, stage: "excluded", reason: "Meeting booked" };
  if (st === "reached") return { ...base, stage: "working", reason: "Spoken with, already handled" };
  if (st === "in-sequence") return { ...base, stage: l.recycle?.downloadedAt ? "back" : "working", reason: "In a live sequence" };
  const a = l.apollo;
  // Looked up and not in Apollo: never sequenced, not a recycle.
  if (!a) return { ...base, stage: l.apolloCheckedAt ? "fresh" : "unchecked" };
  const callsKnown = !a.callsUnknown;
  if (!callsKnown && !a.sequences.length) {
    // In Apollo, but no calls read and no sequence ever: never worked.
    return { ...base, stage: "fresh" };
  }

  // Call outcomes (when the calls could be read) and Apollo's own reasons
  // the sequences ended, read as one set of signals.
  const names = callsKnown ? Object.keys(a.outcomes).filter((n) => a.outcomes[n] > 0) : [];
  const ended = a.sequences.filter((x) => x.status !== "active");
  const reasons = ended.map((x) => x.reason || "").filter(Boolean);
  const signals = [...names, ...reasons];
  const unanswered = callsKnown ? unansweredOf(a) : 0;
  const lastAttemptAt = lastAttemptOf(a);
  const info = { ...base, unanswered, lastAttemptAt };
  if (signals.some((n) => DNC_RE.test(n))) return { ...info, stage: "excluded", reason: "Do not contact" };
  if (signals.some((n) => MEETING_RE.test(n) || /\bbook/i.test(n))) return { ...info, stage: "excluded", reason: "Meeting booked" };
  if (names.some((n) => WRONG_NUMBER_RE.test(n)) && !names.some((n) => UNANSWERED_RE.test(n) || NOT_INTERESTED_RE.test(n)))
    return { ...info, stage: "excluded", reason: "Wrong number" };
  if (reasons.length && reasons.every((r) => BOUNCED_RE.test(r))) return { ...info, stage: "excluded", reason: "Email bounced" };

  const active = a.sequences.some((x) => x.status === "active");
  const downloadedAt = l.recycle?.downloadedAt || "";
  // A download only counts for THIS round: once Apollo logs a newer
  // attempt, the lead was worked again and the old stamp is history.
  const downloadCurrent = !!downloadedAt && (!lastAttemptAt || Date.parse(downloadedAt) >= Date.parse(lastAttemptAt));

  if (active) {
    if (downloadedAt) return { ...info, stage: "back", reason: "In a live sequence" };
    return { ...info, stage: "working", reason: "In a live sequence" };
  }

  const notInterested = signals.some((n) => NOT_INTERESTED_RE.test(n));
  const reachedByCall = names.some((n) => !UNANSWERED_RE.test(n) && !WRONG_NUMBER_RE.test(n) && !NOT_INTERESTED_RE.test(n));
  const reachedByReason = reasons.some((r) => REACHED_REASON_RE.test(r) && !NOT_INTERESTED_RE.test(r));
  let why: RecycleInfo["why"];
  let recycleOn = "";
  if (notInterested) {
    why = "not-interested";
    if (lastAttemptAt) recycleOn = addMonths(lastAttemptAt, rules.notInterestedMonths);
  } else if (reachedByCall || reachedByReason) {
    return { ...info, stage: "working", reason: "Spoken with, already handled" };
  } else if (callsKnown && unanswered >= rules.attempts) {
    why = "unanswered";
    if (lastAttemptAt) recycleOn = addDays(lastAttemptAt, rules.restDays);
  } else if (ended.length) {
    // Per Jack's "Both": a sequence that finished with nobody reached is
    // ready too, whatever the call count, after the same rest.
    why = "sequence-ended";
    if (lastAttemptAt) recycleOn = addDays(lastAttemptAt, rules.restDays);
  } else {
    return { ...info, stage: "building", reason: `${unanswered} of ${rules.attempts} unanswered attempts` };
  }
  const out = { ...info, why, recycleOn };
  if (downloadCurrent) return { ...out, stage: "downloaded" };
  if (recycleOn && recycleOn > today) return { ...out, stage: "resting" };
  return { ...out, stage: "ready", reason: recycleOn ? "" : "No date on the last attempt" };
}

/** What a recycle reason says, in words. */
export function recycleWhyLabel(r: RecycleInfo): string {
  if (r.why === "not-interested") return "Not interested, rested";
  if (r.why === "sequence-ended") return r.unanswered ? `Sequence ended, ${r.unanswered} unanswered` : "Sequence ended, no reply";
  return `${r.unanswered} unanswered attempts`;
}

/** "Recycle on 12 Nov (in 23d)" / "Ready since 2 Oct". */
export function recycleLabel(r: RecycleInfo, today = dayKey(new Date())): string {
  if (!r.recycleOn) return r.stage === "ready" ? "Ready (no date on last attempt)" : "";
  const d = new Date(`${r.recycleOn}T12:00:00`);
  const pretty = d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
  const days = Math.round((Date.parse(`${r.recycleOn}T12:00:00`) - Date.parse(`${today}T12:00:00`)) / 86400000);
  return days > 0 ? `Recycle on ${pretty} (in ${days}d)` : `Ready since ${pretty}`;
}

export function countRecycle(leads: StoredLead[], rules: RecycleRules, today = dayKey(new Date())) {
  const by = Object.fromEntries(RECYCLE_ORDER.map((k) => [k, 0])) as Record<RecycleStage, number>;
  const month = today.slice(0, 7);
  let thisMonth = 0;
  for (const l of leads) {
    const r = recycleOf(l, rules, today);
    by[r.stage]++;
    if (r.stage === "resting" && r.recycleOn.slice(0, 7) === month) thisMonth++;
  }
  return { by, thisMonth };
}

export { dayKey as recycleDayKey };
