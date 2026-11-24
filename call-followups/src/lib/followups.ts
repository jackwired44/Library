// Follow-ups — the call → email loop.
//
// Per Jack: pick a user, a call disposition (default "Info Requested") and
// a day or date range, pull every matching Apollo call, open the Trellus
// recording if needed, and click Draft to get a follow-up email written
// from what was actually said on the call.
//
// Everything in this file is PURE (no network, no IndexedDB) so it can be
// tested without a browser. The Apollo/Outlook calls live in
// lib/apolloCalls.ts; persistence lives in lib/store.ts.
//
// What a Trellus call looks like inside Apollo (confirmed live): no
// recording file, duration 0, transcribed false, and nothing in Apollo's
// conversations index. Trellus writes its own AI summary of the
// conversation into the call's note, followed by a line like
//   "Called +14085550100 (MOBILE). Recording: https://app.trellus.ai/transcripts?id=…"
// That summary is the drafting source. app.trellus.ai is behind a login,
// so the recording itself is a link for Jack to open, never something
// this page reads.
import { loadRows, saveRow } from "./store";

/* ------------------------------------------------------------------ */
/* Apollo shapes (only the fields this feature reads)                  */
/* ------------------------------------------------------------------ */

export interface ApolloCall {
  id: string;
  user_id?: string | null;
  contact_id?: string | null;
  phone_call_outcome_id?: string | null;
  start_time?: string | null;
  note?: string | null;
  note_text?: string | null;
  duration?: number | null;
  caller_name?: string | null;
  contact?: {
    id?: string;
    first_name?: string | null;
    last_name?: string | null;
    name?: string | null;
    title?: string | null;
    organization_name?: string | null;
    email?: string | null;
    time_zone?: string | null;
    typed_custom_fields?: Record<string, unknown> | null;
  } | null;
  account?: { name?: string | null; domain?: string | null } | null;
}

export interface CallOutcomeFacet {
  value: string;
  display_name: string;
  count: number;
}

// Jack's own "lead note" custom field ("Wants Business Central (100
// users). On Dynamics SL today. Timeline: 5/5/2027."). The other custom
// fields carry long generic AI research blobs and a pre-generated Apollo
// email; reading from those is exactly what makes a follow-up read like
// AI, so they are deliberately ignored.
export const LEAD_NOTE_FIELD_ID = "68abe2198cb839001d7d67c3";

export const DEFAULT_OUTCOME_NAME = "Info Requested";

// Apollo reports calls logged with no outcome under the facet value
// "other" ("No Disposition"). A call carries a null outcome id in that
// case, so selection and filtering map null to this key.
export const NO_OUTCOME = "other";
export const outcomeKeyOf = (id: string | null | undefined) => id || NO_OUTCOME;

/* ------------------------------------------------------------------ */
/* Trellus note parsing                                                */
/* ------------------------------------------------------------------ */

export interface ParsedNote {
  summary: string;
  trellusUrl: string | null;
}

const TRELLUS_URL_RE = /https:\/\/app\.trellus\.ai\/[^\s)"'<>]+/i;
// The dial line Trellus appends: "Called +1408... (MOBILE). Recording: …"
const DIAL_LINE_RE = /^\s*Called\s+\+?[\d\s().-]{6,}/i;

export function parseTrellusNote(note: string | null | undefined): ParsedNote {
  const text = (note || "").replace(/\r\n/g, "\n");
  const urlMatch = text.match(TRELLUS_URL_RE);
  const trellusUrl = urlMatch ? urlMatch[0] : null;
  const kept = text
    .split("\n")
    .filter((line) => !DIAL_LINE_RE.test(line) && !/^\s*Recording:\s*https?:/i.test(line))
    .join("\n")
    .replace(TRELLUS_URL_RE, "")
    .trim();
  return { summary: kept, trellusUrl };
}

/* ------------------------------------------------------------------ */
/* Date ranges — LOCAL calendar days, never UTC                        */
/* ------------------------------------------------------------------ */

export type RangePreset = "today" | "yesterday" | "last7" | "thisMonth" | "custom";

export interface DateRange {
  startMs: number;
  endMs: number;
  label: string;
}

const atLocalMidnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
const atLocalEnd = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
// "YYYY-MM-DD" from a date input, as a LOCAL day. new Date("2026-11-23")
// would be UTC midnight, which is the previous evening in Chicago.
function parseLocalKey(key: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key || "");
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
}
const shortDay = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });

export function resolveRange(preset: RangePreset, now: Date, fromKey?: string, toKey?: string): DateRange | null {
  if (preset === "today") return { startMs: atLocalMidnight(now).getTime(), endMs: atLocalEnd(now).getTime(), label: "Today" };
  if (preset === "yesterday") {
    const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12);
    return { startMs: atLocalMidnight(y).getTime(), endMs: atLocalEnd(y).getTime(), label: "Yesterday" };
  }
  if (preset === "last7") {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6, 12);
    return { startMs: atLocalMidnight(start).getTime(), endMs: atLocalEnd(now).getTime(), label: "Last 7 days" };
  }
  if (preset === "thisMonth") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1, 12);
    return { startMs: atLocalMidnight(start).getTime(), endMs: atLocalEnd(now).getTime(), label: "This month" };
  }
  const from = parseLocalKey(fromKey || "");
  const to = parseLocalKey(toKey || "") || from;
  if (!from || !to) return null;
  const [a, b] = from.getTime() <= to.getTime() ? [from, to] : [to, from];
  return { startMs: atLocalMidnight(a).getTime(), endMs: atLocalEnd(b).getTime(), label: `${shortDay(a)} – ${shortDay(b)}` };
}

/* ------------------------------------------------------------------ */
/* Selecting calls                                                     */
/* ------------------------------------------------------------------ */

const norm = (s: string) => s.trim().toLowerCase();

// Apollo's display names carry stray trailing spaces ("Info Requested ").
// Resolved by name every run so recreating an outcome in Apollo doesn't
// break the default.
export function findOutcomeByName(facets: CallOutcomeFacet[], name: string): CallOutcomeFacet | undefined {
  return facets.find((f) => norm(f.display_name) === norm(name));
}

export function outcomeLabel(facets: CallOutcomeFacet[], id: string | null | undefined): string {
  if (!id || id === NO_OUTCOME) return "No disposition";
  const f = facets.find((x) => x.value === id);
  return f ? f.display_name.trim() : "Unknown disposition";
}

// Group Apollo's call outcomes the way Jack splits them: did the call
// reach the person or not. Matched by name because the ids are Apollo's
// own and differ per account; anything unrecognised lands in "Other".
// Order inside each group follows Jack's own list.
const REACHED_ORDER = ["meeting booked", "call back scheduled", "info requested", "qualified", "not interested", "do not contact"];
const NOT_REACHED_ORDER = ["gatekeeper", "left voicemail", "no answer", "wrong number"];

export interface OutcomeGroup {
  label: string;
  outcomes: CallOutcomeFacet[];
}

function rank(name: string, order: string[]): number {
  const i = order.findIndex((o) => name.includes(o));
  return i === -1 ? order.length : i;
}

export function groupOutcomes(facets: CallOutcomeFacet[]): OutcomeGroup[] {
  const reached: CallOutcomeFacet[] = [];
  const notReached: CallOutcomeFacet[] = [];
  const other: CallOutcomeFacet[] = [];
  for (const f of facets) {
    if (!f.value || f.value === "active") continue;
    const n = norm(f.display_name);
    if (f.value === NO_OUTCOME || /no disposition/.test(n)) other.push(f);
    else if (/gatekeeper|front desk|voicemail|no answer|wrong number|busy|disconnected/.test(n)) notReached.push(f);
    else if (/meeting|call ?back|info|interested|do not contact|qualified|connected|referr/.test(n)) reached.push(f);
    else other.push(f);
  }
  reached.sort((a, b) => rank(norm(a.display_name), REACHED_ORDER) - rank(norm(b.display_name), REACHED_ORDER) || a.display_name.localeCompare(b.display_name));
  notReached.sort((a, b) => rank(norm(a.display_name), NOT_REACHED_ORDER) - rank(norm(b.display_name), NOT_REACHED_ORDER) || a.display_name.localeCompare(b.display_name));
  other.sort((a, b) => (a.value === NO_OUTCOME ? 1 : 0) - (b.value === NO_OUTCOME ? 1 : 0) || a.display_name.localeCompare(b.display_name));
  return [
    { label: "Reached them", outcomes: reached },
    { label: "Didn't reach them", outcomes: notReached },
    { label: "Other", outcomes: other },
  ].filter((g) => g.outcomes.length);
}

export interface CallFilter {
  outcomeIds: string[];
  userId: string | null;
  range: DateRange;
}

export function callTimeMs(c: ApolloCall): number {
  const t = c.start_time ? Date.parse(c.start_time) : NaN;
  return Number.isNaN(t) ? 0 : t;
}

export function filterCalls(calls: ApolloCall[], f: CallFilter): ApolloCall[] {
  const outcomes = new Set(f.outcomeIds);
  return calls.filter((c) => {
    const t = callTimeMs(c);
    if (t < f.range.startMs || t > f.range.endMs) return false;
    if (f.userId && c.user_id !== f.userId) return false;
    if (outcomes.size && !outcomes.has(outcomeKeyOf(c.phone_call_outcome_id))) return false;
    return true;
  });
}

// One row per contact: their most recent matching call, plus how many
// matching calls they had in the range. A call with no contact id keys by
// its own id so it is never merged with an unrelated one.
export function latestCallPerContact(calls: ApolloCall[]): { call: ApolloCall; count: number }[] {
  const byKey = new Map<string, { call: ApolloCall; count: number }>();
  for (const c of calls) {
    const key = c.contact_id || c.contact?.id || `call:${c.id}`;
    const prev = byKey.get(key);
    if (!prev) byKey.set(key, { call: c, count: 1 });
    else {
      prev.count += 1;
      if (callTimeMs(c) > callTimeMs(prev.call)) prev.call = c;
    }
  }
  return [...byKey.values()].sort((a, b) => callTimeMs(b.call) - callTimeMs(a.call));
}

/* ------------------------------------------------------------------ */
/* The persisted follow-up record                                      */
/* ------------------------------------------------------------------ */

export type FollowUpStatus = "new" | "drafted" | "sent" | "skipped";

export interface FollowUp {
  callId: string;
  apolloContactId: string | null;
  userId: string | null;
  callerName: string;
  outcomeId: string | null;
  outcomeLabel: string;
  firstName: string;
  name: string;
  title: string;
  company: string;
  email: string;
  timeZone: string | null;
  callAt: string;
  callCount: number;
  summary: string;
  trellusUrl: string | null;
  leadNote: string;

  // Sticky — a fresh pull never overwrites these.
  status: FollowUpStatus;
  pastedNotes?: string;
  draftSubject?: string;
  draftBody?: string;
  draftSource?: "ai" | "template";
  // What the draft was written from, so the panel can say so.
  draftBasis?: DraftBasis;
  draftedAt?: string;
  outlookDraftId?: string;
  outlookWebLink?: string;
  sentAt?: string;
}

export function toFollowUp(call: ApolloCall, count: number, facets: CallOutcomeFacet[]): FollowUp {
  const c = call.contact || {};
  const parsed = parseTrellusNote(call.note_text || call.note);
  const leadNoteRaw = c.typed_custom_fields?.[LEAD_NOTE_FIELD_ID];
  const name = (c.name || `${c.first_name || ""} ${c.last_name || ""}`).trim();
  return {
    callId: call.id,
    apolloContactId: call.contact_id || c.id || null,
    userId: call.user_id || null,
    callerName: call.caller_name || "",
    outcomeId: call.phone_call_outcome_id || null,
    outcomeLabel: outcomeLabel(facets, call.phone_call_outcome_id),
    firstName: (c.first_name || name.split(/\s+/)[0] || "").trim(),
    name,
    title: c.title || "",
    company: c.organization_name || call.account?.name || "",
    email: c.email || "",
    timeZone: c.time_zone || null,
    callAt: call.start_time || "",
    callCount: count,
    summary: parsed.summary,
    trellusUrl: parsed.trellusUrl,
    leadNote: typeof leadNoteRaw === "string" ? leadNoteRaw.trim() : "",
    status: "new",
  };
}

const STICKY: (keyof FollowUp)[] = [
  "status", "pastedNotes", "draftSubject", "draftBody", "draftSource", "draftBasis",
  "draftedAt", "outlookDraftId", "outlookWebLink", "sentAt",
];

// A refresh updates what Apollo knows (summary, contact details, call
// count) but never touches Jack's own work on a row.
export function mergeFollowUp(existing: FollowUp | undefined, fresh: FollowUp): FollowUp {
  if (!existing) return fresh;
  const out = { ...fresh } as Record<string, unknown>;
  for (const k of STICKY) {
    if (existing[k] !== undefined) out[k] = existing[k];
  }
  return out as unknown as FollowUp;
}

// What a draft is written from: Jack's pasted notes win (he pasted them
// because the summary was missing or wrong), else the Trellus summary.
export function draftSource(f: FollowUp): string {
  return (f.pastedNotes || "").trim() || f.summary.trim();
}

export const hasDraftSource = (f: FollowUp) => draftSource(f).length > 0;

// A pasted Trellus transcript reads very differently from a few notes:
// long, and speaker-by-speaker ("Jack: …", "00:41 Neil: …"). Detected so
// the prompt can treat it as a raw conversation to read, not as notes.
export type DraftBasis = "transcript" | "notes" | "summary";

export function looksLikeTranscript(text: string): boolean {
  const t = (text || "").trim();
  if (!t) return false;
  const speakerLines = (t.match(/^\s*(?:\[?\d{1,2}:\d{2}(?::\d{2})?\]?\s*)?[A-Z][\w .'-]{0,30}:\s/gm) || []).length;
  const stamps = (t.match(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g) || []).length;
  return speakerLines >= 3 || stamps >= 3 || t.length >= 600;
}

export function draftBasis(f: FollowUp): DraftBasis | null {
  const pasted = (f.pastedNotes || "").trim();
  if (pasted) return looksLikeTranscript(pasted) ? "transcript" : "notes";
  return f.summary.trim() ? "summary" : null;
}

export const DRAFT_BASIS_LABEL: Record<DraftBasis, string> = {
  transcript: "Drafted from the transcript",
  notes: "Drafted from your notes",
  summary: "Drafted from the call summary",
};

// Long enough for a 30+ minute call; anything past it is almost always
// hold music, a voicemail tail or a second call stitched on.
export const MAX_TRANSCRIPT_CHARS = 40000;

/* ------------------------------------------------------------------ */
/* Drafting rules                                                      */
/* ------------------------------------------------------------------ */

// Jack's structure, verbatim intent: "high level what we talked about,
// what we agreed to for next steps, and to reach out if there are any
// questions — use first name as a hi {{first name}}, following up after
// our call."
export const openerLine = (first: string) => `Hi ${first || "there"}, following up after our call.`;
export const CLOSER_LINE = "If any questions come up in the meantime, feel free to reach out.";

export const BANNED_PHRASES = [
  "streamline", "streamlining", "synergy", "value proposition", "touch base", "circle back",
  "game changer", "game-changer", "revolutionary", "transformative", "supercharge", "delve",
  "unparalleled", "groundbreaking", "cutting-edge", "cutting edge", "innovative", "seamless",
  "seamlessly", "robust", "leverage", "leveraging", "utilize", "utilizing", "best-in-class",
  "holistic", "proactive", "cyber threats", "cybersecurity", "hacked", "breach", "attacked",
  "vulnerability", "vulnerabilities", "gaps", "critical", "urgent", "hope this email finds you",
  "hope this finds you", "just wanted to", "i'd love to", "excited to",
];

export function findBannedPhrases(text: string): string[] {
  const lower = text.toLowerCase();
  const hits = BANNED_PHRASES.filter((p) => {
    const re = new RegExp(`(^|[^a-z])${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`, "i");
    return re.test(lower);
  });
  if (/[—–]/.test(text)) hits.push("em dash");
  if (text.includes("!")) hits.push("exclamation point");
  return hits;
}

export const wordCount = (s: string) => (s.trim().match(/\S+/g) || []).length;

export interface DraftCheck {
  words: number;
  banned: string[];
  hasUrl: boolean;
  problems: string[];
}

export const MIN_WORDS = 50;
export const MAX_WORDS = 140;

export function checkDraft(subject: string, body: string, f: FollowUp): DraftCheck {
  const problems: string[] = [];
  const words = wordCount(body);
  const banned = findBannedPhrases(`${subject}\n${body}`);
  const hasUrl = /https?:\/\/|www\./i.test(body);
  if (banned.length) problems.push(`Avoid: ${banned.join(", ")}`);
  if (hasUrl) problems.push("Has a link");
  if (words > MAX_WORDS) problems.push(`${words} words (aim under ${MAX_WORDS})`);
  if (f.firstName && !body.includes(f.firstName)) problems.push(`Doesn't greet ${f.firstName} by name`);
  if (!subject.trim()) problems.push("No subject");
  return { words, banned, hasUrl, problems };
}

// Plain-text body, paragraphs separated by one blank line.
export function normalizeBody(body: string): string {
  return body
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s*\n\s*/g, " ").replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n\n");
}

/* ------------------------------------------------------------------ */
/* The AI prompt                                                       */
/* ------------------------------------------------------------------ */

export function buildDraftPrompt(f: FollowUp, senderFirstName: string): string {
  const greetingName = f.firstName;
  const basis = draftBasis(f);
  const transcript = basis === "transcript";
  const source = transcript
    ? [
        `CALL TRANSCRIPT (raw and word for word; ${senderFirstName || "the rep"} is the rep, ${greetingName || "the prospect"} is the prospect):`,
        (f.pastedNotes || "").trim().slice(0, MAX_TRANSCRIPT_CHARS),
        ``,
        f.summary.trim() ? `TRELLUS SUMMARY (orientation only; where it disagrees with the transcript, the transcript wins):\n${f.summary.trim()}\n` : "",
      ]
    : [`CALL NOTES (${basis === "notes" ? "written by the rep after the call" : "from the call recording summary"}):`, draftSource(f), ``];
  return [
    `You are ${senderFirstName || "the rep"}, a salesperson at Wired CIO, an IT company that does Microsoft Dynamics 365 / Business Central implementations, custom CRM/ERP builds and integrations, Microsoft 365 and Azure, managed IT, backup, and compliance support for small and midsize businesses.`,
    `You just got off a phone call. Write the follow-up email you would type yourself right after hanging up.`,
    ``,
    `EXACT STRUCTURE (four short paragraphs, plain text):`,
    `1. First paragraph is exactly this one line: "${openerLine(greetingName)}"`,
    `2. A high-level recap of what you talked about, in one or two sentences, written to them ("you mentioned…", "sounds like…"). Use their own words from the call where you can.`,
    `3. What you agreed to as next steps, in one or two sentences. Only steps that are actually in the call notes. If the notes give timing ("after the NetSuite demo"), use it. Never invent a date, meeting, price, or commitment that isn't in the notes.`,
    `4. Last line is exactly: "${CLOSER_LINE}"`,
    ``,
    `RULES:`,
    `- 60 to 120 words total. Short sentences. Sounds like a real person, not marketing.`,
    `- No signature, no sign-off name (Outlook adds it). No links. No bullets. No em dashes. No exclamation points.`,
    `- Do not reintroduce yourself or the company. Do not say "I hope this finds you well".`,
    `- Never use these words or phrases: ${BANNED_PHRASES.join(", ")}.`,
    `- No fear or urgency language. No made-up pain points, numbers, or claims about competitors.`,
    `- If the notes are thin, write a shorter email. Don't pad.`,
    ...(transcript
      ? [
          `- This is a raw transcript. Build the recap and next steps from what ${greetingName || "the prospect"} actually said, in their phrasing. A detail they cared about (a system, a date, a number, a problem in their words) is worth more than a general summary.`,
          `- Ignore greetings, small talk, voicemail, hold music and transcription glitches. Something the rep proposed only counts as a next step if the prospect agreed to it on the call.`,
        ]
      : []),
    `- Subject: 2 to 5 words, all lowercase, specific to this call (e.g. "business central next steps"), never salesy.`,
    ``,
    ...source,
    f.leadNote ? `BACKGROUND ON THE LEAD (secondary, use only if it fits):\n${f.leadNote}\n` : "",
    `THEM: ${f.name || "unknown"}${f.title ? `, ${f.title}` : ""}${f.company ? ` at ${f.company}` : ""}.`,
    ``,
    `Respond with ONLY a JSON object: {"subject": "...", "body": "..."} where body uses \\n\\n between paragraphs.`,
  ].filter((l) => l !== "").join("\n");
}

export function parseDraftJson(raw: unknown): { subject: string; body: string } | null {
  let v: unknown = raw;
  if (typeof v === "string") {
    const m = v.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { v = JSON.parse(m[0]); } catch { return null; }
  }
  if (!v || typeof v !== "object") return null;
  const o = v as { subject?: unknown; body?: unknown };
  if (typeof o.subject !== "string" || typeof o.body !== "string") return null;
  return { subject: o.subject.trim().toLowerCase(), body: normalizeBody(o.body) };
}

/* ------------------------------------------------------------------ */
/* Template fallback — no model needed                                 */
/* ------------------------------------------------------------------ */

const PRODUCT_SUBJECTS: [RegExp, string][] = [
  [/business central|\bbc\b/i, "business central"],
  [/dynamics|\bd365\b|\bcrm\b|\berp\b/i, "dynamics"],
  [/azure/i, "azure"],
  [/google workspace|gmail/i, "microsoft 365 move"],
  [/microsoft 365|\bm365\b|office 365|\bo365\b|licens/i, "microsoft 365"],
  [/backup|disaster recovery/i, "backup"],
  [/managed it|help ?desk|it support/i, "it support"],
];

// Turns Trellus's third-person summary ("Jack reached Neil, who is…") into
// second person addressed to the lead. Deliberately simple and labeled
// "Template draft" in the UI so it is never mistaken for the AI version.
export function toSecondPerson(summary: string, f: FollowUp, senderFirstName: string): string {
  let s = summary.trim();
  const first = f.firstName;
  if (senderFirstName && first) {
    // "Jack reached Dana, who is evaluating…" → "you're evaluating…"
    const lead = new RegExp(`^${senderFirstName}\\s+(?:reached|spoke with|spoke to|talked to|talked with|called|connected with)\\s+${first}\\s*,?\\s*(?:who\\s+(is|was|has|wants|needs)\\s+)?`, "i");
    s = s.replace(lead, (_m, verb?: string) => {
      const v = (verb || "").toLowerCase();
      return v === "is" ? "you're " : v === "was" ? "you were " : v === "has" ? "you have " : v === "wants" ? "you want " : v === "needs" ? "you need " : "";
    });
  }
  if (first) {
    s = s
      .replace(new RegExp(`\\b${first}\\s+is\\b`, "g"), "you're")
      .replace(new RegExp(`\\b${first}\\s+was\\b`, "g"), "you were")
      .replace(new RegExp(`\\b${first}\\s+has\\b`, "g"), "you have")
      .replace(new RegExp(`\\b${first}'s\\b`, "g"), "your")
      .replace(new RegExp(`\\b${first}\\b`, "g"), "you");
  }
  s = s
    .replace(/\b(He|She|They) (is|are)\b/g, "You're")
    .replace(/\b(he|she|they) (is|are)\b/g, "you're")
    .replace(/\b(He|She)\b/g, "You")
    .replace(/\b(he|she)\b/g, "you")
    .replace(/\b(His|Her)\b/g, "Your")
    .replace(/\b(his|her|their)\b/g, "your")
    .replace(/\b(him)\b/g, "you")
    .replace(/\byou requested\b/gi, "you asked for")
    .replace(/\byou suggested\b/gi, "you suggested")
    .replace(/\byou is\b/g, "you're")
    .replace(/\byou was\b/g, "you were")
    .replace(/\byou has\b/g, "you have")
    .replace(/\byou looks\b/g, "you look")
    .replace(/\byou wants\b/g, "you want")
    .replace(/\byou needs\b/g, "you need");
  if (senderFirstName) s = s.replace(new RegExp(`\\b${senderFirstName}\\b`, "g"), "I");
  // The email itself IS the follow-up they asked for; saying so reads odd.
  s = s.replace(/\byou (?:asked for|requested) a follow[- ]?up (?:email|call)?\s*(?:and\s+)?/gi, "you ").replace(/\byou\s+\./g, ".");
  // Capitalize every sentence start.
  s = s.replace(/(^|[.?!]\s+)([a-z])/g, (_m, pre: string, ch: string) => pre + ch.toUpperCase());
  return s;
}

export function templateDraft(f: FollowUp, senderFirstName: string): { subject: string; body: string } {
  // A raw transcript can't be turned into prose by a rewrite rule. Without
  // Claude, fall back to Trellus's summary, which is already prose.
  const src = draftBasis(f) === "transcript" ? f.summary.trim() : draftSource(f);
  const product = PRODUCT_SUBJECTS.find(([re]) => re.test(`${src} ${f.leadNote}`));
  const subject = `${product ? product[1] : "our call"} next steps`;
  const sentences = toSecondPerson(src, f, senderFirstName)
    .split(/(?<=[.?!])\s+/)
    .map((x) => x.trim())
    .filter(Boolean);
  const isNextStep = (x: string) => /follow[- ]?up|next step|reconnect|send|demo|call back|meeting|schedule|after/i.test(x);
  const recap = sentences.filter((x) => !isNextStep(x)).slice(0, 2).join(" ");
  const steps = sentences.filter(isNextStep).slice(0, 2).join(" ");
  const paras = [
    openerLine(f.firstName),
    recap ? `Quick recap of what we covered: ${lowerFirst(recap)}` : "",
    steps ? `For next steps, ${lowerFirst(steps)}` : "As discussed, I'll send over what you asked for and we can pick it up from there.",
    CLOSER_LINE,
  ].filter(Boolean);
  return { subject, body: paras.join("\n\n") };
}

function lowerFirst(s: string): string {
  if (/^(I|I'm|I'll)\b/.test(s)) return s;
  return s.charAt(0).toLowerCase() + s.slice(1);
}

/* ------------------------------------------------------------------ */
/* Persistence                                                         */
/* ------------------------------------------------------------------ */

export async function loadFollowUps(): Promise<FollowUp[]> {
  return loadRows<FollowUp>();
}

export async function saveFollowUp(f: FollowUp): Promise<void> {
  await saveRow(f);
}
