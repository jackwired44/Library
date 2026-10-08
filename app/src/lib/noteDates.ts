// Dates a lead's notes MENTION — a renewal, a timeline, a go-live, a
// meeting — pulled out so a lead can be filtered and read by them.
//
// Per Jack: "do a deep analysis to see if any notes indicate dates."
//
// Composer-level and self-contained on purpose: the three scanners each
// read dates their own way for their own rules (the CSP renewal engine
// above all), and none of them imports another. This reads the RAW note
// for every scanner the same way, for oversight, and decides nothing about
// qualification.
//
// WHAT IT DELIBERATELY IGNORES:
//   - "18/Jun" style stamps. CRM notes prefix every entry with one ("JS -
//     18/Jun - …"), so they say when a seller TYPED, not when anything
//     happens. Counting them would flag nearly every CSP row.
//   - Numbers that only look like dates: a phone number, a version, a
//     seat count. Every pattern needs a month name, a 20xx year, or a
//     separator shape a phone number cannot have.
//   - Fiscal years are kept as text with NO resolved day: Microsoft's FY
//     and a customer's FY start in different months, and guessing which
//     would put a wrong date on the lead.

export type NoteDateKind = "date" | "month" | "quarter" | "fiscal" | "relative";

export interface NoteDate {
  /** The wording as written, e.g. "Q3 2026", "renews 8/1/2026". */
  text: string;
  kind: NoteDateKind;
  /** Best-effort day it points at (YYYY-MM-DD), or absent when it cannot
   *  be pinned — a fiscal year, an "end of quarter" with no anchor. */
  iso?: string;
  /** What the date is about, from the words around it: renewal, timeline… */
  about?: string;
  /** ~120 characters around it, so the date can be read in context. */
  snippet: string;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_RE_SRC = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const monthIndex = (m: string) => MONTHS.indexOf(m.slice(0, 3).toLowerCase());
const YEAR_OK = (y: number) => y >= 2015 && y <= 2035;
const fullYear = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));
const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const lastDay = (y: number, m: number) => new Date(y, m + 1, 0).getDate();

/** What a date is about, read from the words just before and after it. */
const ABOUT: [RegExp, string][] = [
  // An inbound booking: "Date: 9/23/2026 ? Time: 09:00". A scheduled
  // session, which the "Time:" alone would otherwise misread as a BANT
  // timeline.
  [/\bdate\s*:\s*[\d/]+\W{0,6}time\s*:/i, "meeting"],
  [/renew|expir|term\s*end|contract\s*end|anniversar/i, "renewal"],
  [/go[\s-]?live|cut\s*over|launch|rollout|implement|deploy|migrat/i, "go-live"],
  [/timeline|\btime\s*:|target|deadline|by\s+when|complete|finish/i, "timeline"],
  [/clos(e|ing)|\bECD\b|\bTSD\b|signature|decision|sign|purchase|buy|po\b/i, "close"],
  [/budget|fiscal|fy/i, "budget"],
  [/meet|call|demo|follow[\s-]?up|present/i, "meeting"],
];

/**
 * A date that records when something was LOGGED, not when anything is
 * going to happen. Measured on Jack's real files, these are most of the
 * full dates in seller notes:
 *   "APA - 25/Sep - APA 9/25/2026 Oppty & Account info corrected"
 *   "Date of Call: June 17, 2026", "Order Date: Sep 25, 2026"
 *   "2026-09-23 06:00:32 PDT : Call me."
 * They stay visible as context, but they never count as an upcoming date.
 */
const LOGGED_BEFORE_RE = /(?:date\s+of\s+call|order\s+date|call\s+date|created(?:\s+(?:on|by|at))?|updated|logged|submitted|as\s+of|pulled(?:\s+from\s+[\w ]{1,30})?\s+on|sent\s*:\s*(?:[a-z]+day,?\s*)?)\s*:?\s*$/i;
/** A seller's entry stamp ("JV - 20/May -") within a few words before. */
const STAMP_BEFORE_RE = /\b\d{1,2}\/[A-Za-z]{3}\b[^.\n]{0,32}$/;
/** A system timestamp: the date is followed by a seconds-precision time. */
const TIMESTAMP_AFTER_RE = /^\s*\d{1,2}:\d{2}:\d{2}/;

function isLogged(before: string, after: string): boolean {
  return LOGGED_BEFORE_RE.test(before) || STAMP_BEFORE_RE.test(before) || TIMESTAMP_AFTER_RE.test(after);
}

function aboutOf(ctx: string): string | undefined {
  for (const [re, label] of ABOUT) if (re.test(ctx)) return label;
  return undefined;
}

/**
 * A fresh copy of a string. In V8 a regex match or a `slice()` can be a
 * view into the source string rather than its own copy, so storing one
 * keeps the WHOLE source alive. Here the source is a lead's raw note
 * (~4,000 characters on CSP), which is deliberately kept out of memory in
 * its own store — and a stored date pinning it back in measured as 61 MB
 * held after Start over on the perf suite. Round-tripping through JSON is
 * the one copy every engine is guaranteed to make.
 */
const fresh = (x: string): string => JSON.parse(JSON.stringify(x));

function snippetAt(text: string, start: number, end: number): string {
  const a = Math.max(0, start - 60), b = Math.min(text.length, end + 60);
  return fresh((a > 0 ? "…" : "") + text.slice(a, b).replace(/\s+/g, " ").trim() + (b < text.length ? "…" : ""));
}

/**
 * Every date mention in `text`, in reading order, de-duplicated.
 *
 * `anchor` is when the note was received; relative wording ("next 90
 * days", "end of the year") is resolved against it, not against today,
 * because "next quarter" written in March means something else read in
 * October.
 */
export function extractNoteDates(text: string, anchor: Date = new Date(), max = 12): NoteDate[] {
  const src = String(text || "");
  if (!src) return [];
  const out: (NoteDate & { at: number })[] = [];
  const taken: [number, number][] = [];
  const overlaps = (s: number, e: number) => taken.some(([a, b]) => s < b && e > a);

  const add = (m: RegExpExecArray, kind: NoteDateKind, isoVal?: string) => {
    const s = m.index, e = m.index + m[0].length;
    if (overlaps(s, e)) return;
    taken.push([s, e]);
    const ctx = src.slice(Math.max(0, s - 40), Math.min(src.length, e + 25));
    const logged = isLogged(src.slice(Math.max(0, s - 45), s), src.slice(e, e + 12));
    out.push({
      at: s, text: fresh(m[0].trim()), kind, iso: isoVal,
      about: logged ? "logged" : aboutOf(ctx),
      snippet: snippetAt(src, s, e),
    });
  };

  const run = (re: RegExp, fn: (m: RegExpExecArray) => void) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) fn(m);
  };

  // 2026-10-08
  run(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/g, (m) => {
    const y = +m[1], mo = +m[2] - 1, d = +m[3];
    if (YEAR_OK(y) && mo >= 0 && mo < 12 && d >= 1 && d <= lastDay(y, mo)) add(m, "date", iso(y, mo, d));
  });
  // 10/8/2026 or 10/08/26 — US order. A phone number never has two
  // slashes, and a 2-digit year must be preceded by a full m/d.
  run(/\b(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})\b/g, (m) => {
    const mo = +m[1] - 1, d = +m[2], y = fullYear(m[3]);
    if (YEAR_OK(y) && mo >= 0 && mo < 12 && d >= 1 && d <= lastDay(y, mo)) add(m, "date", iso(y, mo, d));
  });
  // October 8, 2026 / Oct 8th 2026
  run(new RegExp(`\\b${MONTH_RE_SRC}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(20\\d{2})\\b`, "gi"), (m) => {
    const mo = monthIndex(m[1]), d = +m[2], y = +m[3];
    if (YEAR_OK(y) && d >= 1 && d <= lastDay(y, mo)) add(m, "date", iso(y, mo, d));
  });
  // 8 October 2026
  run(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_RE_SRC}\\.?,?\\s+(20\\d{2})\\b`, "gi"), (m) => {
    const d = +m[1], mo = monthIndex(m[2]), y = +m[3];
    if (YEAR_OK(y) && d >= 1 && d <= lastDay(y, mo)) add(m, "date", iso(y, mo, d));
  });
  // October 2026 — resolved to the END of the month, since "renews in
  // October" is not over until October is.
  run(new RegExp(`\\b${MONTH_RE_SRC}\\.?,?\\s+(20\\d{2})\\b`, "gi"), (m) => {
    const mo = monthIndex(m[1]), y = +m[2];
    if (YEAR_OK(y)) add(m, "month", iso(y, mo, lastDay(y, mo)));
  });
  // Q3 2026 / Q3'26 / 2026 Q3 — resolved to the quarter's last day.
  run(/\bQ([1-4])\s*['’]?\s*(20\d{2}|\d{2})\b|\b(20\d{2})\s*Q([1-4])\b/gi, (m) => {
    const q = +(m[1] || m[4]) - 1, y = fullYear(m[2] || m[3]);
    if (YEAR_OK(y)) add(m, "quarter", iso(y, q * 3 + 2, lastDay(y, q * 3 + 2)));
  });
  // FY27 / FY2027 / FY 2026 — kept as text, no day (see the note above).
  run(/\bFY\s*'?(20\d{2}|\d{2})\b/gi, (m) => {
    if (YEAR_OK(fullYear(m[1]))) add(m, "fiscal");
  });
  // Relative, against the anchor.
  run(/\b(?:in|within|next|over the next)\s+(\d{1,3})\s*(day|week|month)s?\b/gi, (m) => {
    const n = +m[1], unit = m[2].toLowerCase();
    if (n <= 0 || (unit === "month" && n > 36) || (unit === "day" && n > 730)) return;
    const d = new Date(anchor);
    if (unit === "day") d.setDate(d.getDate() + n);
    else if (unit === "week") d.setDate(d.getDate() + n * 7);
    else d.setMonth(d.getMonth() + n);
    add(m, "relative", iso(d.getFullYear(), d.getMonth(), d.getDate()));
  });
  run(/\b(?:by\s+)?(?:the\s+)?end\s+of\s+(?:the\s+)?(year|quarter|month)\b|\b(EOY|EOQ|EOM)\b/gi, (m) => {
    const u = (m[1] || m[2]).toLowerCase();
    const y = anchor.getFullYear(), mo = anchor.getMonth();
    if (u === "year" || u === "eoy") add(m, "relative", iso(y, 11, 31));
    else if (u === "quarter" || u === "eoq") { const qe = Math.floor(mo / 3) * 3 + 2; add(m, "relative", iso(y, qe, lastDay(y, qe))); }
    else add(m, "relative", iso(y, mo, lastDay(y, mo)));
  });
  run(/\bnext\s+(year|quarter)\b/gi, (m) => {
    const y = anchor.getFullYear(), mo = anchor.getMonth();
    if (m[1].toLowerCase() === "year") add(m, "relative", iso(y + 1, 11, 31));
    else { const qe = Math.floor(mo / 3) * 3 + 5; const yy = y + Math.floor(qe / 12); const mm = qe % 12; add(m, "relative", iso(yy, mm, lastDay(yy, mm))); }
  });

  const seen = new Set<string>();
  return out
    .sort((a, b) => a.at - b.at)
    .filter((d) => { const k = `${d.text.toLowerCase()}|${d.iso ?? ""}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, max)
    .map(({ at: _at, ...d }) => { void _at; return d; });
}

/** Merge newly found dates into a lead's existing set, keeping it small. */
export function mergeNoteDates(prev: NoteDate[] | undefined, next: NoteDate[], max = 16): NoteDate[] {
  const out = [...(prev ?? [])];
  const seen = new Set(out.map((d) => `${d.text.toLowerCase()}|${d.iso ?? ""}`));
  for (const d of next) {
    const k = `${d.text.toLowerCase()}|${d.iso ?? ""}`;
    if (!seen.has(k)) { seen.add(k); out.push(d); }
  }
  return out.slice(0, max);
}

export type DateFilter = "any" | "upcoming" | "past" | "none";

/** A date that says something is going to happen — not a log stamp. */
export const isIntentDate = (d: NoteDate) => d.about !== "logged";

/** Whether a lead's note dates include one still ahead of `today`. Log
 *  stamps never count: a future-dated log entry is a typo, not a plan. */
export function hasUpcomingDate(dates: NoteDate[] | undefined, today = new Date().toISOString().slice(0, 10)): boolean {
  return (dates ?? []).some((d) => d.iso && d.iso >= today && isIntentDate(d));
}

export function soonestUpcoming(dates: NoteDate[] | undefined, today = new Date().toISOString().slice(0, 10)): NoteDate | null {
  let best: NoteDate | null = null;
  for (const d of dates ?? []) if (d.iso && d.iso >= today && isIntentDate(d) && (!best || d.iso < best.iso!)) best = d;
  return best;
}
