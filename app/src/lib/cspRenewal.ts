/**
 * CSP opportunity scoring — the CSP Scanner.
 *
 * Nothing here is shared with the SMC / Cloud Ascent engine, and per Jack
 * this scanner does NOT score on product line: a CSP row is a Microsoft
 * opportunity record, and what matters is whether the deal is alive,
 * whether there is a lane in, and whether it is worth the call.
 *
 * The file is a Dynamics opportunity export. The story lives in
 * msp_forecastcomments — Microsoft sellers' own running notes, newest
 * entry first, each prefixed with initials and a date ("MA - 17/Aug -",
 * "GD - 4/Sep - 9/4/26:"). Everything time-based below is recovered from
 * that text, because the export carries no date column at all.
 */

/* ------------------------------------------------------------- posture */

export type PartnerPosture = "unassigned" | "unresolved" | "microsoft" | "named";

export const POSTURE_META: Record<PartnerPosture, { label: string; short: string; color: string; bg: string; open: boolean }> = {
  unassigned: { label: "No partner assigned", short: "Open", color: "#0E7A72", bg: "#E6F4F2", open: true },
  unresolved: { label: "Partner ID unresolved", short: "Open", color: "#0E7A72", bg: "#E6F4F2", open: true },
  microsoft:  { label: "Microsoft direct", short: "Direct", color: "#0A66C2", bg: "#EAF3FC", open: true },
  named:      { label: "Named partner", short: "Held", color: "#8A6D1F", bg: "#FBF3DF", open: false },
};

/** Microsoft writes an unresolvable reseller as "Partner with non-existing
 *  MPN ID 4518310". Nobody real is on that record. */
const UNRESOLVED_RE = /non[-\s]?existing|unknown\s+partner/i;
const NO_PARTNER_RE = /^(|null|none|n\/a|no\s+partner\s+assigned|unassigned)$/i;
const MICROSOFT_RE = /^microsoft(\s+corporation)?$/i;

export function posturize(raw: string): PartnerPosture {
  const v = String(raw ?? "").trim();
  if (NO_PARTNER_RE.test(v)) return "unassigned";
  if (UNRESOLVED_RE.test(v)) return "unresolved";
  if (MICROSOFT_RE.test(v)) return "microsoft";
  return "named";
}

/** Resellers that turn up in these notes. Used ONLY to notice that the
 *  partner column says "unassigned" while the story plainly names someone
 *  — a conflict worth seeing before you call, never a silent overwrite. */
const KNOWN_RESELLERS = [
  "CDW", "Insight", "SHI", "Softchoice", "PC Connection", "Connection",
  "Trusted Tech Team", "eGroup", "Presidio", "Zones", "Sirius", "ePlus",
  "Carahsoft", "Dell", "CompuCom", "Crayon", "Bytes", "SoftwareOne",
  "Rackspace", "Ingram", "TD Synnex", "Sherweb", "Pax8", "AppSmart",
];
const RESELLER_RE = new RegExp(`\\b(${KNOWN_RESELLERS.map((r) => r.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "i");

export function resellerNamedInNotes(notes: string): string {
  const m = RESELLER_RE.exec(notes || "");
  return m ? m[1] : "";
}

/* --------------------------------------------------------------- dates */

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};
// "9/4/26:" and "8/26/2026" — carries its own year.
const FULL_DATE_RE = /\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/g;
// "17/Aug", "4-Sep" — the running prefix on every seller entry, no year.
const DAY_MONTH_RE = /\b(\d{1,2})\s*[/-]\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\b/gi;

const isReal = (y: number, m: number, d: number): boolean => {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};
const key = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/**
 * The most recent date the notes mention, as YYYY-MM-DD, never later than
 * `today`.
 *
 * A dated entry with its own year wins. A bare "17/Aug" is resolved to the
 * most recent occurrence that is not in the future — Microsoft's notes run
 * newest-first within a rolling year, so a September file reading "12/Dec"
 * means last December, not a date three months out.
 *
 * Dates more than `maxYearsBack` in the past are ignored outright: one
 * malformed string in a note ("1/1/0007") otherwise marked a live lead as
 * 666,267 days stale.
 */
export function lastTouchFrom(notes: string, today: string, maxYearsBack = 5): string | null {
  const text = String(notes ?? "");
  if (!text) return null;
  const [ty, tm, td] = today.split("-").map(Number);
  const floorY = ty - maxYearsBack;
  let best: string | null = null;
  const take = (k: string) => { if (k <= today && k.slice(0, 4) >= String(floorY) && (!best || k > best)) best = k; };

  FULL_DATE_RE.lastIndex = 0;
  for (let m = FULL_DATE_RE.exec(text); m; m = FULL_DATE_RE.exec(text)) {
    let y = Number(m[3]);
    if (y < 100) y += 2000;
    const mo = Number(m[1]), d = Number(m[2]);   // US m/d/y, as the notes are written
    if (isReal(y, mo, d)) take(key(y, mo, d));
  }
  if (best) return best;

  DAY_MONTH_RE.lastIndex = 0;
  for (let m = DAY_MONTH_RE.exec(text); m; m = DAY_MONTH_RE.exec(text)) {
    const d = Number(m[1]), mo = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (!isReal(ty, mo, d) && !isReal(ty - 1, mo, d)) continue;
    const thisYear = isReal(ty, mo, d) ? key(ty, mo, d) : "";
    take(thisYear && thisYear <= today ? thisYear : key(ty - 1, mo, d));
  }
  void tm; void td;
  return best;
}

export function daysBetween(fromDay: string, toDay: string): number {
  const a = new Date(`${fromDay}T12:00:00`).getTime();
  const b = new Date(`${toDay}T12:00:00`).getTime();
  return Math.round((b - a) / 86400000);
}

/* ------------------------------------------------------- notes signals */

/** The deal is over, or the customer has gone dark. Cross-cutting: it wins
 *  regardless of value, recency or how open the partner lane looks. */
export const DEAD_PATTERNS: { label: string; re: RegExp }[] = [
  { label: "marked lost / closing out", re: /\b(mark(ed)?\s+as\s+lost|closed?\s+lost|clos(e|ing)\s+(out\s+)?(this\s+)?opp|lost\s+due\s+to|no\s+longer\s+pursu)/i },
  { label: "no-show / no response", re: /\b(no[-\s]?show|did\s+not\s+attend|no\s+response\s+(has\s+been\s+)?receiv|unresponsive|lack\s+of\s+(engagement|communication))/i },
  { label: "not interested", re: /\b(not\s+interested|no\s+interest|declined|passed\s+on\s+(the\s+)?(offer|opportunity))/i },
  { label: "opportunity not valid", re: /\b(oppty?\s+not\s+valid|not\s+a\s+valid\s+opp|invalid\s+opp|duplicate\s+opp)/i },
];

/** Real forward motion on the deal. */
/**
 * WANTS A PARTNER — the top-quality signal, per Jack: "if it states wants a
 * partner that needs to be flagged for top quality."
 *
 * Getting this right mattered more than adding the flag. The original
 * pattern fired on 961 of Jack's 9,265 real rows and 857 of those (89%)
 * had a partner NAMED in the partner column — so the strongest thing a
 * note can say was mostly firing on leads somebody else already holds.
 * Three separate causes, measured against the real file:
 *
 *  1. `partner (recommendation|referral|introduction)` alone accounted for
 *     846 of the 961, and essentially none were a customer talking. They
 *     are Microsoft's own CRM furniture — "Partner Recommendation" is a
 *     template FIELD, and "Converted partner referral" / "DAS ACC: Partner
 *     referral follow up" is Microsoft's own referral workflow, i.e. a
 *     referral Microsoft already made. Dropped outright.
 *  2. Microsoft's template text sits around the remaining matches:
 *     "Partner: Not discovered - recommend initiating partner discovery",
 *     "PCM program: Open to partner introduction", "Partner Contact: N/A".
 *     Those are form values with a fixed vocabulary, not a statement.
 *     PARTNER_TEMPLATE_RE excludes them by context. 204 -> 123.
 *  3. Negations read as wants: "does not want a reseller to be the middle
 *     man", "explicitly not seeking partner implementation". That is the
 *     OPPOSITE signal and must never be flagged top quality.
 *     PARTNER_NEGATION_RE excludes them. 123 -> 118.
 *
 * Final: 118 rows of 9,265 (1.3%), 24 of them with no partner assigned.
 * A real call list rather than a badge on a ninth of the file.
 */
export const WANTS_PARTNER_RE =
  /\b(look(ing|s)?\s+for\s+(a\s+)?(new\s+)?(partner|reseller|csp|msp|provider)|need(s|ing)?\s+(a\s+)?(new\s+)?(partner|reseller|csp|msp)|want(s|ing)?\s+(a\s+)?(new\s+)?(partner|reseller|csp|msp)|no\s+partner\s+(yet|identified|selected|in\s+place|assigned)|open\s+to\s+(a\s+)?(new\s+)?partner|unhappy\s+with\s+(their\s+)?(current\s+)?(partner|reseller|provider)|switch(ing)?\s+partners?|(seeking|requested|asked\s+for)\s+(a\s+)?partner)/i;

/** Microsoft's own CRM template and workflow language. A match inside this
 *  context is a form field, not a customer asking for anything. */
export const PARTNER_TEMPLATE_RE =
  /(partner\s*:\s*(not\s+)?discovered|partner\s+not\s+discovered|recommend\s+initiating\s+partner\s+discovery|partner\s+recommendation|partner\s+referral|partner\s+poc|partner\s+summary|das\s+acc|opportunity\s+insights|solution\s+(area|play)|orchestration\s+note|task\s+subject|pcm\s+program|partner\s+contact\s*:)/i;

/** "do not want a partner" is not "want a partner". */
export const PARTNER_NEGATION_RE =
  /\b(do(es)?\s+n[o']t|did\s+n[o']t|no[nt]\s+needed|not\s+seeking|not\s+looking|never|no\s+longer|without\s+a)\s+(\w+\s+){0,3}(want|need|seek|require|involv|partner|reseller)/i;

/** How far either side of the match to read for template/negation context.
 *  110 characters each way: wide enough to catch the label a form value
 *  hangs off, narrow enough not to reach an unrelated sentence. */
const PARTNER_CONTEXT_CHARS = 110;

/**
 * Does the customer actually state they want a partner? The one question
 * the top-quality flag turns on, so it is a named function rather than an
 * inline regex test — and the only place the three rules above combine.
 */
export function wantsPartnerStated(notes: string): boolean {
  const t = String(notes ?? "");
  const m = WANTS_PARTNER_RE.exec(t);
  if (!m) return false;
  const around = t.slice(
    Math.max(0, m.index - PARTNER_CONTEXT_CHARS),
    Math.min(t.length, m.index + m[0].length + PARTNER_CONTEXT_CHARS),
  );
  return !PARTNER_TEMPLATE_RE.test(around) && !PARTNER_NEGATION_RE.test(around);
}

/**
 * A stated partner ask, attributed to the dated seller entry it was
 * written in, with a short reason.
 *
 * Per Jack: "if they want a partner just a brief statement of they want
 * one, when it was noted and why they want one." The date has to come from
 * the entry holding the ask, NOT from the row's `lastTouch` — an ask
 * written in March on a row touched last week is a five-month-old ask, and
 * saying "5d" there would be a lie. Measured on the real file: 99% of the
 * 119 rows that state an ask can be dated this way.
 */
export interface PartnerAsk {
  /** YYYY-MM-DD of the entry the ask sits in, null if that entry is undated. */
  when: string | null;
  /** The clause the ask sits in, filler stripped. May be empty. */
  why: string;
}

/** Sellers open with boilerplate that eats the word budget and says
 *  nothing: "During the conversation, the customer confirmed interest in
 *  X" is worth exactly "interest in X". */
const ASK_FILLER_RES: RegExp[] = [
  /^during (?:the|our) (?:conversation|call|meeting)[,:]?\s*/i,
  /^(?:the\s+)?(?:customer|client|they|he|she|account)\s+(?:is\s+|are\s+|has\s+|have\s+|was\s+|were\s+)?/i,
  /^asks?\s*:\s*/i,
  /^(?:confirmed|stated|mentioned|indicated|noted|said)\s+(?:that\s+)?(?:they\s+)?/i,
  // Stripping "the customer" then "confirmed they" strands the auxiliary:
  // "…confirmed they are open to X" was landing as "Are open to X".
  /^(?:is|are|was|were|has|have|had)\s+/i,
  // CRM form scaffolding that sits in the same clause as the ask and reads
  // as a sentence but says nothing: "Forecast status: Uncommitted Reason of
  // the forecast status: …", "- ? Last Action STU presentation to …".
  /^[-\s?•]+/,
  /^(?:forecast\s+status|reason\s+of\s+the\s+forecast\s+status|last\s+action|next\s+action|sales\s+stage|deal\s+health)\s*:\s*\w+\s*/i,
];

export function partnerAskFrom(notes: string, today: string): PartnerAsk | null {
  const t = String(notes ?? "");
  if (!t) return null;
  for (const chunk of allEntries(t)) {
    const m = WANTS_PARTNER_RE.exec(chunk);
    if (!m) continue;
    // The same three guards wantsPartnerStated applies, so this can never
    // report an ask the engine itself does not count.
    const around = chunk.slice(
      Math.max(0, m.index - PARTNER_CONTEXT_CHARS),
      Math.min(chunk.length, m.index + m[0].length + PARTNER_CONTEXT_CHARS),
    );
    if (PARTNER_TEMPLATE_RE.test(around) || PARTNER_NEGATION_RE.test(around)) continue;

    const before = chunk.slice(0, m.index);
    const start = Math.max(before.lastIndexOf("."), before.lastIndexOf("|"), before.lastIndexOf(" - ")) + 1;
    const rest = chunk.slice(start);
    const end = rest.search(/[.|]\s|$/);
    let why = rest.slice(0, end > 0 ? end : rest.length).replace(/\s+/g, " ").trim();
    // Leading punctuation has to go FIRST and the list has to run to a
    // fixed point. The entry separator leaves a "- " on the front, and
    // every filler pattern is anchored to ^ — so with the punctuation
    // still there not one of them could match, and "During the
    // conversation, the customer confirmed they are…" survived whole.
    // Stripping one layer is also not enough: real clauses stack two or
    // three of these openers.
    for (let i = 0; i < 4; i++) {
      const before2 = why;
      why = why.replace(/^[-\s?•:]+/, "");
      for (const re of ASK_FILLER_RES) why = why.replace(re, "").trim();
      if (why === before2) break;
    }
    why = why.charAt(0).toUpperCase() + why.slice(1);
    return { when: lastTouchFrom(chunk, today), why };
  }
  return null;
}

export const WANTS_PARTNER_LABEL = "wants a partner";

export const MOTION_PATTERNS: { label: string; re: RegExp }[] = [
  // Per Jack, the strongest note there is: the customer is asking for a
  // partner. That is the exact conversation this list exists to have.
  // Uses the tightened test above, NOT a bare regex — the notes factor
  // weights this at 15, which saturates it, so a false fire here was
  // promoting held accounts on the strength of Microsoft's own boilerplate.
  { label: "wants a partner", re: WANTS_PARTNER_RE },
  { label: "meeting booked", re: /\b(meeting\s+(is\s+)?(set|scheduled|booked)|call\s+scheduled|scheduled\s+(a\s+)?(call|meeting)|intro\s+call)/i },
  { label: "pricing / quote", re: /\b(quote[ds]?|proposal|\bsow\b|statement\s+of\s+work|pric(e|ing)|cost(s|ing)?\s+(breakdown|estimate|comparison)|budget(ed|ary)?\s+(approv|confirm|allocat|of|is|for)|estimate\s+sent)/i },
  { label: "stated need", re: /\b(interested\s+in|wants?\s+to\s+(move|migrate|buy|purchase|consolidate|add|upgrade|renew)|looking\s+to\s+(move|migrate|buy|purchase|consolidate|add|upgrade|renew)|needs?\s+to\s+(move|migrate|consolidate|upgrade|renew)|would\s+like\s+to|plans?\s+to\s+(move|migrate|buy|purchase|renew))\b/i },
  { label: "POC / pilot / assessment", re: /\b(proof\s+of\s+concept|\bpoc\b|pilot|assessment|workshop)/i },
  { label: "seat expansion", re: /\b(add(ing)?\s+seats|additional\s+licen|more\s+seats|increase\s+seats|upsell|expand(ing)?\s+(the\s+)?(footprint|deployment))/i },
  { label: "next step stated", re: /\bnext\s+(steps?|action)\b/i },
];

/**
 * How strong the seller's notes are, as a single number.
 *
 * Per Jack, a CSP lead is qualified "in order from indicating if they want
 * to do annual upfront and the notes on them" — so billing shape leads and
 * this is the second key. Weights are ordered by how close the note puts
 * the deal to a decision: a booked meeting beats a quote out, which beats
 * a pilot, which beats a bare "next steps" line.
 */
export const MOTION_WEIGHT: Record<string, number> = {
  // Saturates the notes factor by itself (see NOTES_SATURATION): per Jack
  // this is the strongest thing a note can say.
  "wants a partner": 15,
  "meeting booked": 5,
  "pricing / quote": 4,
  "stated need": 3,
  "POC / pilot / assessment": 3,
  "seat expansion": 2,
  "next step stated": 1,
};
export function notesStrength(motion: string[]): number {
  return motion.reduce((n, m) => n + (MOTION_WEIGHT[m] ?? 0), 0);
}

/**
 * License SKUs the notes refer to. Per Jack: "remove product line other
 * than what license sku it refers to you can keep" — there is no
 * Dynamics / M365 bucket on this scanner, but if the seller wrote down
 * WHICH licenses are in play, that is worth carrying into the notes line.
 * Matched as whole tokens; an unmatched note simply yields nothing.
 */
const SKU_PATTERNS: { label: string; re: RegExp }[] = [
  { label: "M365 E7", re: /\b(m365\s*)?e7\b/i },
  { label: "M365 E5", re: /\b(m365\s*|o365\s*|office\s*365\s*|microsoft\s*365\s*)?e5\b/i },
  { label: "M365 E3", re: /\b(m365\s*|o365\s*|office\s*365\s*|microsoft\s*365\s*)?e3\b/i },
  { label: "O365 E1", re: /\b(o365\s*|office\s*365\s*)?e1\b/i },
  { label: "Business Premium", re: /\bbusiness\s+premium\b/i },
  { label: "Business Standard", re: /\bbusiness\s+standard\b/i },
  { label: "Business Basic", re: /\bbusiness\s+basic\b/i },
  { label: "F1/F3", re: /\b(m365\s*)?f[13]\b/i },
  { label: "Copilot", re: /\bcopilot\b/i },
  { label: "Teams Phone", re: /\bteams\s+phone\b/i },
  { label: "Entra ID", re: /\bentra(\s+id)?(\s+p[12])?\b/i },
  { label: "Defender", re: /\bdefender\b/i },
  { label: "Intune", re: /\bintune\b/i },
  { label: "Purview", re: /\bpurview\b/i },
  { label: "Azure", re: /\bazure\b/i },
  { label: "Dynamics 365", re: /\b(dynamics(\s*365)?|d365)\b/i },
  { label: "Business Central", re: /\bbusiness\s+central\b/i },
  { label: "Power BI", re: /\bpower\s*bi\b/i },
  { label: "Windows 365", re: /\bwindows\s*365\b/i },
];
export function skusMentioned(notes: string): string[] {
  const t = String(notes ?? "");
  return SKU_PATTERNS.filter((p) => p.re.test(t)).map((p) => p.label);
}

/**
 * The newest seller entry in a forecast-comments blob. Microsoft's notes
 * are a running log, NEWEST FIRST, each entry prefixed with initials and a
 * date ("MA - 17/Aug -", "GD - 4/Sep - 9/4/26:"). The first entry is what
 * the account looks like today; a "no-show" three entries down is history.
 * Per Jack, every lead gets scored on its merits, so dead language is
 * weighed by WHERE it sits — latest entry versus older — rather than
 * killing the row on any mention anywhere.
 */
const ENTRY_PREFIX_RE = /(?:^|\s)[A-Z]{1,4}\s*-\s*\d{1,2}\s*[/-]\s*(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\b\s*-?/gi;
export function latestEntry(notes: string): string {
  const t = String(notes ?? "");
  ENTRY_PREFIX_RE.lastIndex = 0;
  const first = ENTRY_PREFIX_RE.exec(t);
  if (!first) return t;
  ENTRY_PREFIX_RE.lastIndex = first.index + first[0].length;
  const second = ENTRY_PREFIX_RE.exec(t);
  return t.slice(first.index, second ? second.index : t.length);
}

/** Every seller entry in the blob, each still carrying its own date
 *  prefix, newest first. `latestEntry` above is the first of these; this is
 *  all of them, which is what lets a fact be attributed to the entry it was
 *  actually written in rather than to the row as a whole. */
export function allEntries(notes: string): string[] {
  const t = String(notes ?? "");
  if (!t) return [];
  ENTRY_PREFIX_RE.lastIndex = 0;
  const marks: number[] = [];
  for (let m = ENTRY_PREFIX_RE.exec(t); m; m = ENTRY_PREFIX_RE.exec(t)) marks.push(m.index);
  if (!marks.length) return [t];
  return marks.map((s, i) => t.slice(s, marks[i + 1] ?? t.length));
}

/** The first "Next Step / Next Action" sentence.
 *
 *  The character class must exclude the entry prefix, not just sentence
 *  punctuation. Seller entries are separated by " LDH - 18/Jun - ", which
 *  contains no ".", "·" or "|" — so the original pattern ran straight
 *  through the separator and swallowed the next two entries whole, ending
 *  on the CRM's own "Show less" UI text. Stop at a dated prefix as well. */
const NEXT_STEP_RE = /next\s+(?:steps?|action)\s*[:-]?\s*([^.·|]{8,180})/i;
const ENTRY_START_RE = /\s[A-Z]{1,4}\s*-\s*\d{1,2}\s*[/-]\s*(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\b/i;
export function nextStepFrom(notes: string): string {
  const m = NEXT_STEP_RE.exec(String(notes ?? ""));
  if (!m) return "";
  let s = m[1];
  const cut = s.search(ENTRY_START_RE);
  if (cut > 0) s = s.slice(0, cut);
  return s.replace(/\s*Show (?:less|more)\s*$/i, "")
    .replace(/\s+/g, " ").trim().replace(/[,;\s-]+$/, "");
}

/**
 * Is this string a number you could actually dial?
 *
 * Excel turns a long phone number into scientific notation ("5.25549E+11")
 * when the column is typed as a number — 52 rows in one real CSP export.
 * The precision is GONE at that point: the true digits cannot be recovered
 * from the float, so the only honest thing is to drop it rather than
 * export a plausible-looking wrong number into a call list. Also rejects
 * anything without at least 7 digits.
 */
export function isDialable(raw: string): boolean {
  const v = String(raw ?? "").trim();
  if (!v) return false;
  if (/\d[.,]?\d*\s*[eE]\s*[+-]?\s*\d+/.test(v)) return false;   // 5.25549E+11
  return (v.match(/\d/g) || []).length >= 7;
}

/**
 * A company name the notes state outright ("Company Name: SOFVARE").
 * Used only when the export carries no company column at all — a subset
 * file saved out of Excel routinely loses it, and a lead with no company
 * cannot be called or matched in Apollo.
 */
const NOTES_COMPANY_RE = /\bcompany\s*name\s*[:-]\s*([^\n;|]{2,80})/i;
// These blobs run several labelled fields together on one line
// ("Company Name: SOFVARE Website: https://…"), so the value has to stop at
// the next label. Cutting at "any capitalised word before a colon" splits
// the company itself — "New Leaf Publishing Group Website:" cut to "New
// Leaf" — so the labels are named explicitly instead.
const NEXT_LABEL_RE = new RegExp(
  "\\s+(?:website|main\\s*phone(?:\\s*number)?|first\\s*name|middle\\s*name|last\\s*name|job\\s*title|title|phone|email|linkedin|customer\\s*tpids?|smc\\s*type|contact\\s*id|country(?:/region)?|product|partner)\\s*:",
  "i",
);
export function companyFromNotes(notes: string): string {
  const m = NOTES_COMPANY_RE.exec(String(notes ?? ""));
  if (!m) return "";
  let v = m[1];
  const cut = NEXT_LABEL_RE.exec(v);
  if (cut) v = v.slice(0, cut.index);
  v = v.trim().replace(/\s+/g, " ").replace(/[.,;]+$/, "");
  if (v.length > 60) v = v.slice(0, 60).trim();
  return /^(null|n\/a|none|not discovered|unknown)$/i.test(v) || v.length < 2 ? "" : v;
}

/**
 * The company's own web domain, out of a work email. Last resort for a
 * blank company: Apollo matches on a domain, so "adriansteel.com" is a
 * usable value where an empty cell is not. Free/personal providers are
 * skipped — a gmail address says nothing about an employer.
 */
const FREE_MAIL = new Set([
  "gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com", "aol.com",
  "live.com", "msn.com", "proton.me", "protonmail.com", "mail.com", "gmx.com",
  "yandex.com", "zoho.com", "comcast.net", "verizon.net", "att.net", "me.com",
]);
export function companyDomainFromEmail(email: string): string {
  const d = String(email ?? "").trim().toLowerCase().split("@")[1];
  if (!d || !d.includes(".")) return "";
  const clean = d.replace(/^www\./, "");
  return FREE_MAIL.has(clean) ? "" : clean;
}

/**
 * A phone number the notes explicitly LABEL as one.
 *
 * Labelled-only, and never a bare run of digits: measured against the real
 * export, the unlabelled numbers in phoneless rows are overwhelmingly the
 * PARTNER's rep — "Connecting with partner Alex Padua ph# 7609306400",
 * "Partner AE Fred Gingras … 5146737553". Dialling one of those is calling
 * a competitor's seller, which is worse than having no number at all. Nine
 * of the thirty-nine candidates were exactly that; only two or three were
 * genuinely our contact.
 *
 * Even a LABELLED number is rejected when partner/reseller language sits
 * immediately before it, for the same reason.
 */
const LABELLED_PHONE_RE = /(?:business|work|direct|mobile|cell|office|main)?\s*phone\s*(?:number)?\s*[:-]\s*(\+?[\d][\d\s().-]{7,})/i;
const PARTNER_CONTEXT_RE = /\b(partner|reseller|distributor|\bAE\b|account\s+executive|co-?sell)\b/i;
export function labelledPhoneFrom(notes: string): string {
  const text = String(notes ?? "");
  const m = LABELLED_PHONE_RE.exec(text);
  if (!m) return "";
  // Whose number is this? If the run-up names a partner, it is not ours.
  const before = text.slice(Math.max(0, m.index - 80), m.index);
  if (PARTNER_CONTEXT_RE.test(before)) return "";
  const v = m[1].trim().replace(/[\s.-]+$/, "");
  if (!isDialable(v)) return "";
  // A repeated-digit placeholder ("8888888888") is not a phone number.
  const digits = v.replace(/\D/g, "").replace(/^1/, "");
  if (/^(\d)\1{6,}$/.test(digits)) return "";
  return (v.match(/\d/g) || []).length >= 10 ? v : "";
}

/* --------------------------------------------------------------- lead */

/**
 * Billing shape, ranked by how good a lead it is. Per Jack: "annual new
 * upfront is the best quality lead ... which indicates how they want to be
 * billed" — an annual term paid upfront is real commitment and real cash,
 * and a month-to-month with no term is the weakest thing on the list.
 *
 * 0 is best. The rank is a first-class scoring input AND the tie-break
 * that orders the table and the download.
 */
export type BillingQuality = 0 | 1 | 2 | 3 | 4;

export const BILLING_META: { rank: BillingQuality; label: string; short: string; re: RegExp }[] = [
  { rank: 0, label: "Annual, new, paid upfront", short: "Annual new · upfront", re: /annual\s+new\s+upfront/i },
  { rank: 1, label: "Annual renewal, paid upfront", short: "Annual renewal · upfront", re: /annual\s+renewal\s+upfront/i },
  { rank: 2, label: "Annual, new, billed monthly", short: "Annual new · monthly", re: /annual\s+new\s+monthly/i },
  { rank: 3, label: "Annual renewal, billed monthly", short: "Annual renewal · monthly", re: /annual\s+renewal\s+monthly/i },
  { rank: 4, label: "Month to month", short: "Monthly", re: /monthly/i },
];

/** Rank a licensing programme string. An unrecognised programme ranks
 *  last rather than being guessed into a better band. */
export function billingQuality(program: string): BillingQuality {
  const p = String(program ?? "");
  for (const b of BILLING_META) if (b.re.test(p)) return b.rank;
  return 4;
}
export function billingLabel(program: string): string {
  const p = String(program ?? "");
  for (const b of BILLING_META) if (b.re.test(p)) return b.short;
  return p ? p.replace(/^CSP\s*\|\s*/, "") : "";
}

export interface CspLead {
  /** msp_licensingprogramname verbatim, e.g. "CSP | Annual Renewal Upfront Billing". */
  program: string;
  isRenewal: boolean;
  /** Billing shape read out of the programme name, and how good a lead
   *  that shape is (0 = annual new upfront, the best). */
  billing: string;
  billingRank: BillingQuality;
  /** estimatedvalue, null when the column is absent or unparseable. */
  value: number | null;
  /** msp_rollupestrevenue — the account roll-up, usually equal to value. */
  rollupValue: number | null;
  partner: string;
  posture: PartnerPosture;
  /** A reseller named in the notes while the column says nobody is on it. */
  partnerConflict: string;
  lastTouch: string | null;
  ageDays: number | null;
  deadReasons: string[];
  /** True when dead language sits in the NEWEST seller entry — the account
   *  is dead today. False when it only appears in older entries, which is
   *  history the score discounts rather than a verdict. */
  deadInLatest: boolean;
  motion: string[];
  nextStep: string;
  /** Weighted strength of the motion language in the notes — the second
   *  ranking key after billing shape. */
  strength: number;
  /** License SKUs the seller's notes refer to, for the notes line. */
  skus: string[];
  /** A labelled phone found in the notes, for a row whose columns have none. */
  notesPhone: string;
  /** The source column held a value Excel had already destroyed
   *  ("5.25549E+11"), so the row exports no phone. Counted and surfaced so
   *  the export can be fixed at source rather than the loss going unseen. */
  phoneMangled: boolean;
  /** Jack's definition of the strongest lead on the list, all three at
   *  once: the notes say they are looking for a partner, No Partner
   *  Assigned on the record, and annual new upfront billing. Pinned to
   *  the top of the table and every download regardless of score. */
  /** The customer themselves states they want a partner — Jack's
   *  top-quality flag. Forces High priority regardless of score and ranks
   *  directly below a pinned lead. Guarded three ways, see
   *  wantsPartnerStated: this is 118 of 9,265 real rows, not 961. */
  wantsPartner: boolean;
  /** When the ask was written and why, attributed to its own dated entry.
   *  Null when no ask is stated, or when the ask is stated but the entry
   *  holding it carries no date (1% of real rows). */
  partnerAsk: PartnerAsk | null;
  perfect: boolean;
  /** 0–100, set by classifyCsp. The single number the table and the
   *  downloads are ordered by. */
  score: number;
  /** Where the points came from, one entry per factor that scored. */
  breakdown: string[];
  /** Points each factor contributed (normalised to the 0–100 scale) and
   *  the total taken off in penalties — what the priority breakdown panel
   *  aggregates per band, so it never has to parse the strings above. */
  factorPoints: Record<keyof CspWeights, number>;
  penaltyPoints: number;
}

/**
 * Rank order for CSP leads: score first, then the tie-breaks in the order
 * of the factors Jack named — billing intent, then notes strength, then
 * value, then recency. A row missing a value or a date is never treated
 * as zero: it sinks below every row that states one, in the order it
 * already had — the same rule the Dynamics seat sort follows.
 *
 * 1. Billing shape — annual new upfront at the top, month-to-month last.
 * 2. Notes strength — a booked meeting above a bare "next steps".
 * 3. Estimated value, largest first.
 * 4. Most recently touched.
 *
 * A row missing a value or a date is never treated as zero: it sinks
 * below every row that states one, within its own billing band, in the
 * order it already had — the same rule the Dynamics seat sort follows.
 */
export function compareCspLeads(a: CspLead | undefined, b: CspLead | undefined): number {
  if (!a || !b) return a ? -1 : b ? 1 : 0;
  if (a.perfect !== b.perfect) return a.perfect ? -1 : 1;
  // Top quality next, per Jack: stating they want a partner outranks a
  // higher score that does not say it.
  if (a.wantsPartner !== b.wantsPartner) return a.wantsPartner ? -1 : 1;
  if (a.score !== b.score) return b.score - a.score;
  if (a.billingRank !== b.billingRank) return a.billingRank - b.billingRank;
  if (a.strength !== b.strength) return b.strength - a.strength;
  const av = a.value, bv = b.value;
  if (av != null && bv != null && av !== bv) return bv - av;
  if (av != null && bv == null) return -1;
  if (bv != null && av == null) return 1;
  const ad = a.lastTouch, bd = b.lastTouch;
  if (ad && bd && ad !== bd) return ad < bd ? 1 : -1;
  if (ad && !bd) return -1;
  if (bd && !ad) return 1;
  return 0;
}

const squash = (s: string) => s.replace(/[^a-z0-9]/gi, "").toLowerCase();

export const CSP_COLUMN_HINTS: Record<string, string[]> = {
  program: ["licensingprogramname", "licensingprogram", "program", "licenseprogram"],
  value: ["estimatedvalue", "estvalue", "opportunityvalue", "dealvalue", "amount", "value"],
  rollupValue: ["rollupestrevenue", "rollupestimatedrevenue", "estimatedrevenue", "rollup"],
  partner: ["partneraccountidname", "partneraccount", "partnerofrecord", "partnername", "resellername", "partner", "reseller"],
};

export type CspColumnMap = Partial<Record<keyof typeof CSP_COLUMN_HINTS, string>>;

export function guessCspColumns(columns: string[]): CspColumnMap {
  const out: CspColumnMap = {};
  const claimed = new Set<string>();
  for (const key of Object.keys(CSP_COLUMN_HINTS) as (keyof typeof CSP_COLUMN_HINTS)[]) {
    for (const hint of CSP_COLUMN_HINTS[key]) {
      const hit = columns.find((c) => !claimed.has(c) && squash(c).includes(hint));
      if (hit) { out[key] = hit; claimed.add(hit); break; }
    }
  }
  return out;
}

const parseMoney = (raw: string): number | null => {
  const v = String(raw ?? "").replace(/[$,\s]/g, "");
  if (!v || /^(null|n\/a|none|-)$/i.test(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const clean = (raw: unknown): string => {
  const v = String(raw ?? "").trim();
  return /^(null|n\/a|none|-)$/i.test(v) ? "" : v;
};

export function readCspLead(
  raw: Record<string, unknown>,
  cols: CspColumnMap,
  notes: string,
  today: string,
): CspLead {
  const get = (k: keyof CspColumnMap): string => (cols[k] ? clean(raw[cols[k] as string]) : "");
  const program = get("program");
  const partner = get("partner");
  const posture = posturize(partner);
  const lastTouch = lastTouchFrom(notes, today);
  const named = resellerNamedInNotes(notes);
  // "wants a partner" goes through wantsPartnerStated so the template and
  // negation guards apply; every other label is a plain pattern test.
  const motion = MOTION_PATTERNS.filter((p) =>
    p.label === WANTS_PARTNER_LABEL ? wantsPartnerStated(notes) : p.re.test(notes),
  ).map((p) => p.label);
  const wantsPartner = motion.includes(WANTS_PARTNER_LABEL);
  const billingRank = billingQuality(program);
  return {
    program,
    isRenewal: /renewal/i.test(program),
    billing: billingLabel(program),
    billingRank,
    value: parseMoney(get("value")),
    rollupValue: parseMoney(get("rollupValue")),
    partner,
    posture,
    partnerConflict: posture === "unassigned" || posture === "unresolved" ? named : "",
    lastTouch,
    ageDays: lastTouch ? daysBetween(lastTouch, today) : null,
    deadReasons: DEAD_PATTERNS.filter((p) => p.re.test(notes)).map((p) => p.label),
    deadInLatest: DEAD_PATTERNS.some((p) => p.re.test(latestEntry(notes))),
    motion,
    nextStep: nextStepFrom(notes),
    strength: notesStrength(motion),
    skus: skusMentioned(notes),
    wantsPartner,
    partnerAsk: wantsPartner ? partnerAskFrom(notes, today) : null,
    perfect: posture === "unassigned" && wantsPartner && billingRank === 0,
    score: 0,
    breakdown: [],
    factorPoints: { lane: 0, billing: 0, recency: 0, notes: 0, value: 0, contact: 0 },
    penaltyPoints: 0,
    notesPhone: labelledPhoneFrom(notes),
    phoneMangled: false,
  };
}

/* --------------------------------------------------------------- rules */

/**
 * How many points each factor is worth, out of the total. Per Jack:
 * "there's multiple factors to score here of data pointing to a good lead
 * or not" — so the model is a transparent sum, and every factor's weight
 * is a setting. Each factor scores a fraction of its weight; the sum is
 * normalised to 0–100 so the thresholds below stay meaningful when a
 * weight is changed.
 */
export interface CspWeights {
  /** Billing intent — annual new upfront is the best lead on the list. */
  billing: number;
  /** Partner lane — nobody on the record beats a named reseller. */
  lane: number;
  /** How recently a seller touched it. */
  recency: number;
  /** How much forward motion the notes show. */
  notes: number;
  /** Estimated deal value. */
  value: number;
  /** Whether you can actually reach them — a phone, an email. */
  contact: number;
}

// Per Jack: "No Partner Assigned is the strongest indicator" — so the
// lane outweighs billing intent, which outweighs everything else.
export const DEFAULT_CSP_WEIGHTS: CspWeights = {
  lane: 30, billing: 25, recency: 18, notes: 15, value: 12, contact: 8,
};

export const WEIGHT_META: { key: keyof CspWeights; label: string; hint: string }[] = [
  { key: "lane", label: "Partner lane", hint: "No Partner Assigned scores full marks; a named reseller scores zero unless the notes show the deal moving." },
  { key: "billing", label: "Billing intent", hint: "Annual new upfront scores full marks; month-to-month scores almost nothing." },
  { key: "recency", label: "Recency", hint: "Touched by a seller this week scores full marks; six months ago scores almost nothing; no dated note scores zero." },
  { key: "notes", label: "Notes strength", hint: "Meeting booked, quote out, POC, seat expansion, next step — weighted, capped." },
  { key: "value", label: "Deal value", hint: "$250k+ scores full marks; under $1k scores zero. A blank value scores zero rather than being guessed." },
  { key: "contact", label: "Reachable", hint: "A phone is most of it, an email the rest. You cannot sequence a row with neither." },
];

export interface CspRules {
  weights: CspWeights;
  /** Score at or above this is High priority. */
  strongAt: number;
  /** Score at or above this is Medium priority; below is Low. */
  reviewAt: number;
  /** Untouched for longer than this costs `stalePenalty` points. */
  staleDays: number;
  stalePenalty: number;
  /** Points taken off when the NEWEST entry says the deal is dead —
   *  closed lost, no-show, unresponsive, not interested. */
  deadLatestPenalty: number;
  /** Points taken off when dead language appears only in OLDER entries. */
  deadOlderPenalty: number;
  /** Legacy hard stop: dead language in the latest entry forces Low
   *  priority regardless of score. Off by default — per Jack, every lead
   *  gets a chance to be scored on its merits. */
  hardStopDead: boolean;
}

export const DEFAULT_CSP_RULES: CspRules = {
  weights: DEFAULT_CSP_WEIGHTS,
  strongAt: 60,
  reviewAt: 25,
  staleDays: 270,
  stalePenalty: 20,
  deadLatestPenalty: 35,
  deadOlderPenalty: 10,
  hardStopDead: false,
};

export function resolveCspRules(r?: Partial<CspRules> & { weights?: Partial<CspWeights>; dqDead?: boolean }): CspRules {
  const out: CspRules = {
    ...DEFAULT_CSP_RULES,
    ...(r ?? {}),
    weights: { ...DEFAULT_CSP_WEIGHTS, ...(r?.weights ?? {}) },
  };
  // A rule set saved when dead language was a hard stop (`dqDead: true`)
  // keeps behaving that way until it is edited — never a silent change.
  if (r && "dqDead" in r && typeof r.dqDead === "boolean" && !("hardStopDead" in r)) out.hardStopDead = r.dqDead;
  return out;
}

const money = (n: number): string =>
  n >= 1000000 ? `$${(n / 1000000).toFixed(n >= 10000000 ? 0 : 1)}M`
  : n >= 1000 ? `$${Math.round(n / 1000)}k`
  : `$${Math.round(n)}`;

/* -------------------------------------------------------------- factors */

const BILLING_FRACTION: Record<BillingQuality, number> = { 0: 1, 1: 0.8, 2: 0.55, 3: 0.4, 4: 0.15 };

function recencyFraction(age: number | null): number {
  if (age == null) return 0;
  if (age <= 7) return 1;
  if (age <= 14) return 0.9;
  if (age <= 30) return 0.8;
  if (age <= 60) return 0.6;
  if (age <= 90) return 0.45;
  if (age <= 180) return 0.2;
  return 0.05;
}

function valueFraction(v: number | null): number {
  if (v == null || v <= 0) return 0;
  if (v >= 250000) return 1;
  if (v >= 100000) return 0.85;
  if (v >= 50000) return 0.7;
  if (v >= 25000) return 0.55;
  if (v >= 10000) return 0.4;
  if (v >= 1000) return 0.2;
  return 0.08;
}

/** Notes strength saturates at "wants a partner" plus a booked meeting
 *  plus pricing talk (6+5+4): past that, more words are not more signal. */
const NOTES_SATURATION = 15;

function laneFraction(lead: CspLead): number {
  let f = lead.posture === "unassigned" ? 1 : lead.posture === "unresolved" ? 0.9 : lead.posture === "microsoft" ? 0.7 : 0;
  // A held deal that is visibly moving is still a deal you can be part of.
  if (lead.posture === "named" && lead.strength > 0) f = 0.3;
  // The column says nobody, the notes name someone — less open than it looks.
  if (lead.partnerConflict) f = Math.max(0, f - 0.3);
  return f;
}

export interface CspVerdict {
  bucket: "priority" | "review" | "excluded" | "unmatched";
  why: string;
  score: number;
  breakdown: string[];
  factorPoints: Record<keyof CspWeights, number>;
  penaltyPoints: number;
}

/**
 * Score a CSP opportunity 0–100 and place it.
 *
 * Two things are decided BEFORE the score and override it: dead language
 * (the customer said no, or went dark) and staleness. No amount of deal
 * size or open lane makes those calls worth making. Everything else is
 * the weighted sum, which is also the rank order for the table, the
 * downloads and — the point of all this — the sequence you load them into.
 *
 * `hasPhone` / `hasEmail` come from the identity columns, which this
 * module does not read; the caller passes them in.
 */
/**
 * The Notes line, written for a rep who is about to dial — not a brief.
 *
 * Per Jack, measured against the old line on his real 9,265-row file: it
 * ran a median of 150 characters and a p90 of 315, and 30% of all that
 * text was the seller's own internal next step, 99.9% of which ended
 * mid-sentence. "Our rep is just calling the lead and talking, they don't
 * need super detailed specifics."
 *
 * So: a hard word cap, and a stated order for what gets shed when a row is
 * over budget. A row that states a partner ask gets a larger budget,
 * because that ask is the single best reason to call and clipping it to
 * six words made every one of them read as an unfinished thought.
 */
export const CSP_NOTE_MAX_WORDS = 20;
export const CSP_NOTE_MAX_WORDS_ASK = 26;
const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;
/** "2026-06-12" -> "12 Jun". Parsed by field, never through Date, so it
 *  cannot shift a day across a timezone. */
export function shortAskDate(iso: string): string {
  const mo = MONTH_ABBR[Number(iso.slice(5, 7)) - 1];
  return mo ? `${Number(iso.slice(8, 10))} ${mo}` : "";
}
/** Held by a named partner reads better as one word than as a CRM string:
 *  "Encore Business Solutions Inc." is "Encore". */
const firstWord = (s: string) => (String(s).trim().split(/\s+/)[0] ?? "").replace(/[,.;:]+$/, "");

export function cspNote(lead: CspLead, score: number, flags: string[] = [], pin = ""): string {
  const value = lead.value != null && lead.value > 0 ? money(lead.value) : "";
  // Three, not two: a CSP renewal call turns on what they are actually
  // on, and capping at two dropped the Copilot in "E5 to E7, Copilot".
  // The shed ladder still removes them whole when a row is tight.
  const skus = lead.skus.slice(0, 3).join(", ");
  // BILLING_META.short already carries its own separator; a comma keeps it
  // reading as one fact rather than two.
  const billing = lead.billing.replace(/\s*·\s*/g, ", ").toLowerCase().trim();
  const lane = lead.posture === "named" && lead.partner
    ? `Held: ${firstWord(lead.partner)}`
    : POSTURE_META[lead.posture].short === "Open" ? "Open lane"
      : POSTURE_META[lead.posture].short === "Direct" ? "MS direct"
      : POSTURE_META[lead.posture].short;
  const conflict = lead.partnerConflict ? `${firstWord(lead.partnerConflict)} on record` : "";
  const age = lead.ageDays == null ? "" : lead.ageDays === 0 ? "touched today" : `${lead.ageDays}d cold`;
  // "older note: no-show / no response" is six words for a caution. Where
  // the flag sits still matters — an older entry is history, the latest one
  // is a verdict — so that is kept and the rest is trimmed.
  const warn = flags.length
    ? `⚠ ${flags[0].replace(/^older note: /, "older: ").replace(/^latest note: /, "now: ")
        .split(/\s+/).filter(Boolean).slice(0, 5).join(" ")}`
    : "";
  const rank = `(${score})`;

  const ask = lead.wantsPartner ? lead.partnerAsk : null;
  // The mark comes from the FLAG, never from whether the ask's own entry
  // could be parsed. 11 of 119 real asks sit in an entry with no readable
  // date or clause; tying the mark to the parse dropped their ⚑ entirely,
  // and since the flag also overrides the score band that put unmarked
  // sub-60 leads into the High file with nothing saying why.
  if (!lead.wantsPartner) {
    // Shed billing, then licences. Never the lane, the age or the rank —
    // those are what decide whether to dial at all.
    const shed: string[][] = [
      [value, skus, billing, lane, conflict, warn, age, rank],
      [value, skus, lane, conflict, warn, age, rank],
      [value, lane, conflict, warn, age, rank],
      [value, lane, age, rank],
    ];
    for (const parts of shed) {
      const s = parts.filter(Boolean).join(" · ");
      if (wordCount(pin + s) <= CSP_NOTE_MAX_WORDS) return s;
    }
    return shed[shed.length - 1].filter(Boolean).join(" · ");
  }

  // An ask row spends its words on the reason. The tail is deliberately
  // shorter than a standard row's — licences and billing are scoring
  // facts, and the reason they asked is the thing you open the call with.
  // ★ means all three signals at once (asked, nobody assigned, annual
  // upfront); ⚑ means the ask alone. A pinned lead shows the star and NOT
  // the chip — the star already implies the ask, and showing both reads as
  // two separate findings. The date and reason stay either way: a pinned
  // lead is the one you most want them for.
  const mark = lead.perfect ? "★" : "⚑";
  const stem = `${mark} Wants partner${ask?.when ? ` (${shortAskDate(ask.when)})` : ""}`;
  const tails = [
    [value, billing, lane, conflict, warn, age, rank],
    [value, lane, conflict, warn, age, rank],
    [value, lane, warn, age, rank],
    [value, lane, age, rank],
  ].map((t) => t.filter(Boolean).join(" · "));
  // Take the richest tail that leaves room for at least a short reason,
  // else the shortest tail there is.
  const tail = tails.find((t) => CSP_NOTE_MAX_WORDS_ASK - wordCount(`${pin}${stem} · ${t}`) >= 3)
    ?? tails[tails.length - 1];
  const spare = CSP_NOTE_MAX_WORDS_ASK - wordCount(`${pin}${stem} · ${tail}`);
  const reason = (ask?.why ?? "").split(/\s+/).filter(Boolean);
  // Below three words there is no room to say anything true, so say
  // nothing rather than a fragment.
  const why = spare >= 3 && reason.length
    ? reason.slice(0, spare).join(" ") + (reason.length > spare ? "…" : "")
    : "";
  return `${stem}${why ? `: ${why}` : ""} · ${tail}`;
}

export function classifyCsp(lead: CspLead, rules: CspRules, reach: { hasPhone: boolean; hasEmail: boolean }): CspVerdict {
  const w = rules.weights;
  const total = w.billing + w.lane + w.recency + w.notes + w.value + w.contact || 1;
  const parts: { label: string; pts: number }[] = [];
  const rawPts: Record<keyof CspWeights, number> = { lane: 0, billing: 0, recency: 0, notes: 0, value: 0, contact: 0 };
  const add = (key: keyof CspWeights, label: string, weight: number, fraction: number) => {
    const pts = Math.round(weight * Math.max(0, Math.min(1, fraction)));
    if (pts > 0) parts.push({ label, pts });
    rawPts[key] = pts;
    return pts;
  };

  let raw = 0;
  raw += add("billing", lead.billing ? lead.billing.toLowerCase() : "billing unknown", w.billing, BILLING_FRACTION[lead.billingRank]);
  raw += add("lane",
    lead.posture === "named"
      ? (lead.strength > 0 ? `held by ${lead.partner}, but moving` : `held by ${lead.partner}`)
      : lead.partnerConflict ? `${POSTURE_META[lead.posture].label.toLowerCase()}, notes mention ${lead.partnerConflict}` : POSTURE_META[lead.posture].label.toLowerCase(),
    w.lane, laneFraction(lead));
  raw += add("recency", lead.ageDays == null ? "no dated note" : lead.ageDays === 0 ? "touched today" : `touched ${lead.ageDays}d ago`, w.recency, recencyFraction(lead.ageDays));
  raw += add("notes", lead.motion.length ? lead.motion.slice(0, 2).join(", ") : "no motion in notes", w.notes, Math.min(1, lead.strength / NOTES_SATURATION));
  raw += add("value", lead.value != null && lead.value > 0 ? money(lead.value) : "no value stated", w.value, valueFraction(lead.value));
  raw += add("contact", reach.hasPhone && reach.hasEmail ? "phone + email" : reach.hasPhone ? "phone only" : reach.hasEmail ? "email only" : "no phone or email",
    w.contact, (reach.hasPhone ? 0.65 : 0) + (reach.hasEmail ? 0.35 : 0));
  // Same normalisation as the score, so the panel's per-factor averages
  // add up to the band's average score (minus penalties).
  const factorPoints = Object.fromEntries(
    (Object.keys(rawPts) as (keyof CspWeights)[]).map((k) => [k, Math.round((100 * rawPts[k]) / total)]),
  ) as Record<keyof CspWeights, number>;

  const base = Math.round((100 * raw) / total);
  const breakdown = parts.map((p) => `${p.label} +${p.pts}`);
  if (lead.perfect) breakdown.unshift("\u2605 asking for a partner, none assigned, annual upfront \u2014 pinned to the top");
  else if (lead.wantsPartner) breakdown.unshift("\u2691 the customer states they want a partner \u2014 top quality, forced to High priority");

  // Penalties. Every lead is scored first and THEN marked down, so a big,
  // open, annual-upfront deal with a no-show four entries ago still lands
  // where its merits put it minus a discount — not in the bin.
  let penalty = 0;
  const flags: string[] = [];
  if (lead.deadReasons.length) {
    if (lead.deadInLatest) {
      penalty += rules.deadLatestPenalty;
      breakdown.push(`${lead.deadReasons.join(", ")} in the latest entry \u2212${rules.deadLatestPenalty}`);
      flags.push(`latest note: ${lead.deadReasons.join(", ")}`);
    } else {
      penalty += rules.deadOlderPenalty;
      breakdown.push(`${lead.deadReasons.join(", ")} in an older entry \u2212${rules.deadOlderPenalty}`);
      flags.push(`older note: ${lead.deadReasons.join(", ")}`);
    }
  }
  if (lead.ageDays != null && lead.ageDays > rules.staleDays) {
    penalty += rules.stalePenalty;
    breakdown.push(`untouched ${lead.ageDays}d, past ${rules.staleDays} \u2212${rules.stalePenalty}`);
    flags.push(`untouched ${lead.ageDays} days`);
  }
  const score = Math.max(0, base - penalty);

  const detail = cspNote(lead, score, flags);

  if (lead.value == null && !lead.program && lead.ageDays == null && !lead.motion.length && !lead.deadReasons.length) {
    return { bucket: "unmatched", why: "No signal \u2014 no value, programme or dated note on this row", score, breakdown, factorPoints, penaltyPoints: penalty };
  }
  // The head used to restate the band ("Score 46 \u2691 TOP QUALITY \u2014 states
  // they want a partner \u2014 High priority") on every row, in a download
  // already split by band and beside a Tier column saying the same thing.
  // The score now rides at the end of the note as "(46)" and the ask is a
  // \u2691 on the front, so nothing is lost and three clauses go.
  if (rules.hardStopDead && lead.deadInLatest) {
    return { bucket: "excluded", why: detail, score, breakdown, factorPoints, penaltyPoints: penalty };
  }
  // Per Jack: "if it states wants a partner that needs to be flagged for
  // top quality." So the flag OVERRIDES the score band the same way a
  // pinned lead does — a customer asking for a partner is the whole pitch,
  // and it should never sit in Medium because its deal value is unstated.
  if (lead.perfect || lead.wantsPartner || score >= rules.strongAt) {
    return { bucket: "priority", why: detail, score, breakdown, factorPoints, penaltyPoints: penalty };
  }
  if (score >= rules.reviewAt) {
    return { bucket: "review", why: detail, score, breakdown, factorPoints, penaltyPoints: penalty };
  }
  return { bucket: "excluded", why: detail, score, breakdown, factorPoints, penaltyPoints: penalty };
}

/** What goes in the download's Product Area column for a CSP row. Per
 *  Jack this scanner has no product line — the play is becoming their
 *  partner of record, so the column answers "is a partner known, and who".
 */
export function cspPartnerLabel(lead: CspLead): string {
  if (lead.posture === "named") return `Held \u2014 ${lead.partner}`;
  if (lead.posture === "microsoft") return "Microsoft direct";
  const base = lead.posture === "unresolved" ? "Open \u2014 partner ID unresolved" : "Open \u2014 no partner assigned";
  return lead.partnerConflict ? `${base} (notes mention ${lead.partnerConflict})` : base;
}
