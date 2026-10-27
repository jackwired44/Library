// Turning a scanned row into a StoredLead, for all three scanners.
//
// Lives apart from leadStore.ts so that store stays free of engine types,
// and apart from the engines so none of them learns about the others —
// detection.ts, smcLead.ts and cspRenewal.ts gain nothing here. This is
// composer-level plumbing, the same place scanner2.ts's export hygiene
// already sits.
//
// Each scanner keeps its OWN vocabulary. The Main Scanner says "Strong
// Signal", CSP says "High priority"; normalising those into one invented
// scale would lose the meaning Jack set per scanner, so a lead records the
// word its scanner used and which scanner that was.
import {
  CATEGORY_META, PRIORITY_META, getFullName,
  type DuplicateRow, type NoSignalRow, type ResultRow, type Tier,
} from "./detection";
import { BUCKET2_META, CSP_BUCKET_META, type Row2, type ScannerKind } from "./scanner2";
import { rawFieldsOf } from "./rawNotes";
import { NO_SIGNAL_TIER, leadKeyOfInput, type LeadInput, type LeadSource } from "./leadStore";

/**
 * The date a file states in its own name, as YYYY-MM-DD.
 *
 * Jack's Main exports carry no date column at all — the only record of
 * when a batch arrived is the name he saved it under: "Book(5-7-26).csv",
 * "Book(9-20).csv". Without this every lead from a May-to-September
 * backfill read as received the day it was uploaded.
 *
 * Month-day-year with "-" only. A name with no year takes the most recent
 * such date that is not in the future. Anything that does not form a real
 * calendar date ("Book82626", "Sheet83") gives nothing rather than a guess.
 */
export function receivedOnFromFileName(name: string, now = new Date()): string | undefined {
  const m = String(name || "").match(/(?:^|[^\d])(\d{1,2})-(\d{1,2})(?:-(\d{4}|\d{2}))?(?!\d)/);
  if (!m) return undefined;
  const mo = Number(m[1]), d = Number(m[2]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return undefined;
  let y = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : now.getFullYear();
  const iso = (yy: number) => `${yy}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const real = (yy: number) => {
    const t = new Date(`${iso(yy)}T12:00:00`);
    return t.getMonth() + 1 === mo && t.getDate() === d ? t : null;
  };
  if (!m[3] && (real(y)?.getTime() ?? 0) > now.getTime()) y -= 1;
  return real(y) ? iso(y) : undefined;
}

/**
 * Jack's numbered sheets ("BookSheet75", "Sheet 80") carry no date at all.
 * Per Jack: "if the file csv has sheet then a number its pre may 2026", then
 * "really anything from sheet 45 - sheet 82" — "so lets try and guess its month"
 * and "reogranize it in all leads for filtering purposes".
 *
 * The guess (`estimateSheetMonths`) is evidence-based and always marked as a
 * guess: the latest real date (before May 2026) that the sheet's own leads'
 * notes mention is the earliest the sheet can have been exported, so that is
 * its month. A sheet with no dated notes borrows from the nearest
 * LOWER-numbered sheet (numbers rise over time), and estimates never go
 * backwards as the number rises. A sheet nothing can place stays "Before May
 * 2026". Shown as "~March 2026 (est.)", month key "2026-03~".
 */
export const PRE_MAY_2026_MONTH = "0000-00~"; // sorts after every real or estimated month
export const PRE_MAY_2026_DATE = "2026-04-30";
export const PRE_MAY_2026_LABEL = "Before May 2026";
const PRE_MAY_CUTOFF = "2026-04-30";

export function sheetNumberOf(name: string): number | null {
  const m = /sheet\s*[-_#]?\s*(\d{1,4})(?!\d)/i.exec(String(name || ""));
  return m ? Number(m[1]) : null;
}
/** Per Jack: "anything from sheet 45 - sheet 82 its all pre may 2026"
 *  (82 included). The lower end stays 10, as before, so Excel's default
 *  "Sheet1"–"Sheet9" names are never read as one of these. Sheet 83 and up
 *  are dated the normal way. */
export const PRE_MAY_SHEET_MIN = 10;
export const PRE_MAY_SHEET_MAX = 82;
export function isPreMaySheet(name: string): boolean {
  const n = sheetNumberOf(name);
  return n !== null && n >= PRE_MAY_SHEET_MIN && n <= PRE_MAY_SHEET_MAX;
}

/** sheet file -> the estimated day (YYYY-MM-DD) it was exported. */
let sheetEstimates = new Map<string, string>();
export function setSheetEstimates(m: Map<string, string>): void { sheetEstimates = m; }
export function sheetEstimateOf(file: string): string | null { return sheetEstimates.get(file) ?? null; }

/** Per Jack: "october of 2025 is the ltest back to go" (was July 2025).
 *  Sheet 45 is about October 2025 and Sheet 82 about April 2026; nothing
 *  is estimated earlier than October 2025. */
export const SHEET_WINDOW = { firstSheet: 45, lastSheet: 82, from: "2025-10", to: "2026-04" } as const;

/** The month a sheet number falls in, spread evenly across the window. */
export function sheetMonthByNumber(n: number): string {
  const [fy, fm] = SHEET_WINDOW.from.split("-").map(Number);
  const [ty, tm] = SHEET_WINDOW.to.split("-").map(Number);
  const span = (ty - fy) * 12 + (tm - fm);
  const t = Math.min(1, Math.max(0, (n - SHEET_WINDOW.firstSheet) / (SHEET_WINDOW.lastSheet - SHEET_WINDOW.firstSheet)));
  const k = fm - 1 + Math.round(t * span);
  return `${fy + Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, "0")}`;
}

/**
 * The estimated day each pre-May Sheet file was exported. Start from its
 * number (spread over October 2025 – April 2026). Where the sheet's own leads'
 * notes mention a dated event inside that window, the latest such date is
 * the earliest the sheet can have been exported, so the estimate moves up
 * to it. Then estimates never go backwards as the number rises. Pure; App
 * sets the result with setSheetEstimates.
 */
export function estimateSheetMonths(leads: { sourceFiles: string[]; noteDates?: { iso?: string; kind: string; text: string }[] }[]): Map<string, string> {
  const lo = `${SHEET_WINDOW.from}-01`, hi = PRE_MAY_CUTOFF;
  const evidence = new Map<string, string>();
  const sheets = new Set<string>();
  for (const l of leads) {
    const own = l.sourceFiles.filter(isPreMaySheet);
    if (!own.length) continue;
    for (const f of own) sheets.add(f);
    // Only a date written with its year: a bare month or a relative window
    // was resolved against the upload day, which says nothing about an old
    // sheet.
    let best = "";
    for (const d of l.noteDates ?? []) {
      if (!d.iso || d.iso > hi || d.iso < lo) continue;
      if (!(d.kind === "date" || (d.kind === "month" && /20\d\d/.test(d.text)))) continue;
      if (d.iso > best) best = d.iso;
    }
    if (!best) continue;
    // A lead in several files can't say which one its notes belong to;
    // it counts for the lowest-numbered sheet (its first sighting).
    const f = own.slice().sort((a, b) => (sheetNumberOf(a) ?? 0) - (sheetNumberOf(b) ?? 0))[0];
    if (best > (evidence.get(f) ?? "")) evidence.set(f, best);
  }
  const ordered = [...sheets].sort((a, b) => (sheetNumberOf(a) ?? 0) - (sheetNumberOf(b) ?? 0) || a.localeCompare(b));
  const out = new Map<string, string>();
  let running = "";
  for (const f of ordered) {
    const byNumber = `${sheetMonthByNumber(sheetNumberOf(f) ?? SHEET_WINDOW.firstSheet)}-15`;
    const e = evidence.get(f) ?? "";
    let est = e > byNumber ? e : byNumber;
    if (est > hi) est = hi;
    if (running > est) est = running;
    running = est;
    out.set(f, est);
  }
  return out;
}

/** "2026-03~" -> "~March 2026 (est.)"; the pre-May bucket; else the month. */
export function monthLabelOf(key: string): string {
  if (key === PRE_MAY_2026_MONTH) return PRE_MAY_2026_LABEL;
  const est = key.endsWith("~");
  const ym = est ? key.slice(0, 7) : key;
  if (!/^\d{4}-\d{2}$/.test(ym)) return key;
  const name = new Date(`${ym}-15T12:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  return est ? `~${name} (est.)` : name;
}

/** When a lead arrived, for grouping and filtering: the file's own date,
 *  else "before May 2026" when its earliest file is an early numbered
 *  sheet, else the upload date. `month` is a YYYY-MM key, or
 *  PRE_MAY_2026_MONTH. */
export function arrivalOf(l: { receivedOn?: string; firstSeenAt: string; sourceFiles: string[] }): { date: string; month: string; approx: boolean } {
  // Per Jack, a Sheet file is pre-May whatever else the row says.
  const sheet = l.sourceFiles.filter(isPreMaySheet).sort((a, b) => (sheetNumberOf(a) ?? 0) - (sheetNumberOf(b) ?? 0))[0];
  if (sheet) {
    const est = sheetEstimateOf(sheet);
    return est ? { date: est, month: `${est.slice(0, 7)}~`, approx: true } : { date: PRE_MAY_2026_DATE, month: PRE_MAY_2026_MONTH, approx: true };
  }
  if (l.receivedOn) return { date: l.receivedOn.slice(0, 10), month: l.receivedOn.slice(0, 7), approx: false };
  return { date: l.firstSeenAt.slice(0, 10), month: l.firstSeenAt.slice(0, 7), approx: false };
}

/** Scanner2's kind is the lead source directly; Main is its own. */
export function sourceOfKind(kind: ScannerKind): LeadSource {
  return kind === "csp" ? "csp" : "smc";
}

/**
 * Main Scanner rows.
 *
 * `tier` prefers the priority BAND when the row has one, because that is
 * the four-value High/Medium/Low/Bad vocabulary Jack actually works from;
 * it falls back to the three-value tier for a row restored from an older
 * History entry that was scanned before scoring was wired.
 */
const TIER_WORDS: Record<Tier, string> = {
  signal: "Strong Signal",
  mention: "Needs Review",
  dq: "Bad Lead",
};

export function leadInputsFromResults(rows: ResultRow[]): LeadInput[] {
  return rows.map((r) => {
    const f = r.row.__f;
    return {
      source: "main" as LeadSource,
      company: String(f.company || ""),
      contact: getFullName(f),
      title: String(f.title || ""),
      email: String(f.email || ""),
      phone: String(f.workPhone || ""),
      mobilePhone: String(f.mobilePhone || ""),
      productArea: CATEGORY_META[r.category]?.label || "",
      tier: r.priorityBand
        ? PRIORITY_META[r.priorityBand]?.label || ""
        : TIER_WORDS[r.tier] || "",
      notes: r.notesSummary || "",
      score: r.mainScore ? r.mainScore.score : null,
      sourceFile: r.sourceFile || "",
      // The Comments cell exactly as the file had it, before the scanner
      // condensed it into a call brief.
      rawNotes: String(f.comments || ""),
      rawFields: rawFieldsOf(r.row, String(f.comments || "")),
      receivedOn: receivedOnFromFileName(r.sourceFile || ""),
    };
  });
}

/**
 * Custom and CSP rows.
 *
 * CSP relabels the same underlying buckets as High / Medium / Low priority
 * (CSP_BUCKET_META) rather than Strong Signal / Needs Review / Bad Leads,
 * so the bucket is read through the right map for the scanner that
 * produced it — otherwise a CSP lead would be filed under a word that
 * appears nowhere in the CSP scanner.
 *
 * CSP has no product line at all, by design: every CSP lead is a licensing
 * renewal. That reads as an empty product area, not an invented one.
 */
export function leadInputsFromRows2(rows: Row2[], kind: ScannerKind): LeadInput[] {
  const isCsp = kind === "csp";
  const meta = isCsp ? CSP_BUCKET_META : BUCKET2_META;
  return rows.map((r) => ({
    source: sourceOfKind(kind),
    company: String(r.lead.company || ""),
    contact: String(r.lead.contact || ""),
    title: String(r.lead.title || ""),
    email: String(r.lead.email || ""),
    phone: String(r.lead.phone || ""),
    mobilePhone: String(r.lead.mobilePhone || ""),
    productArea: isCsp ? "" : (r.productLine ? String(r.productLine) : ""),
    tier: meta[r.bucket]?.label || "",
    notes: r.snippet || "",
    score: isCsp ? (r.csp?.score ?? null) : (r.smcScore?.score ?? null),
    sourceFile: r.sourceFile || "",
    rawNotes: String(r.lead.notes || ""),
    rawFields: rawFieldsOf(r.row, String(r.lead.notes || "")),
    // The file's own date for this row, when it states one.
    receivedOn: r.receivedOn ? String(r.receivedOn).slice(0, 10) : receivedOnFromFileName(r.sourceFile || ""),
  }));
}

/** The word a no-signal row is filed under. It is not a detection verdict —
 *  such a row never reached detection at all — so it must not borrow one of
 *  the real tier labels and read as if the engine scored it. Defined in
 *  leadStore.ts, because mergeLeads has to recognise it. */
export { NO_SIGNAL_TIER };

/**
 * Rows the Main Scanner's engine skipped entirely.
 *
 * `scanRowUnified` returns null for a row with no Dynamics / M365 /
 * licensing language at all, so it never becomes a ResultRow and is
 * invisible everywhere except the Non Relevant tab — 342 of 500 rows on
 * Jack's own real file. Per Jack the Library shows "every lead filtered
 * out", so these are stored too, tagged for what they are rather than
 * given a tier they never earned.
 */
/** Resolves a Main Scanner row id ("3-41", "nosignal-3-41", "dup-3-41") back
 *  to the raw CSV row it came from. Supplied by the caller, which holds the
 *  parsed files; the scan output itself keeps no raw row for skipped or
 *  merged rows. */
export type RawRowOf = (id: string) => Record<string, unknown> | undefined;

export function leadInputsFromNoSignal(rows: NoSignalRow[], rawOf?: RawRowOf): LeadInput[] {
  return rows.map((r) => ({
    source: "main" as LeadSource,
    company: r.company || "",
    contact: r.contact || "",
    title: r.title || "",
    email: r.email || "",
    phone: r.phone || "",
    mobilePhone: "",
    productArea: "",
    tier: NO_SIGNAL_TIER,
    notes: r.notes || "",
    score: null,
    sourceFile: r.sourceFile || "",
    rawNotes: r.notes || "",
    rawFields: rawFieldsOf(rawOf?.(r.id), r.notes || ""),
    receivedOn: receivedOnFromFileName(r.sourceFile || ""),
  }));
}

/**
 * Duplicate rows the Main Scanner merged away, filed ONLY for the file they
 * came from.
 *
 * The scanner keeps the first-seen copy of a person and drops the rest, so
 * a lead on three of Jack's files was stored as being on one — 148 of 422
 * merges on six real files were across files. These inputs carry no tier,
 * notes or score, so mergeLeads changes nothing on the lead except adding
 * the file. Only rows whose lead key is already in this batch are kept:
 * the scanner matches on full name + company, the store on email, so a
 * repeat with a different email would otherwise become a second, empty
 * record of the same person.
 */
export function leadInputsFromDuplicates(rows: DuplicateRow[], batchKeys: Set<string>, rawOf?: RawRowOf): LeadInput[] {
  const out: LeadInput[] = [];
  for (const r of rows) {
    if (!batchKeys.has(leadKeyOfInput(r))) continue;
    out.push({
      source: "main" as LeadSource,
      company: r.company || "", contact: r.contact || "", title: r.title || "",
      email: r.email || "", phone: r.phone || "", mobilePhone: "",
      productArea: "", tier: "", notes: "", score: null,
      sourceFile: r.sourceFile || "",
      // Its own raw row: a repeat from another file can say something the
      // kept copy did not. Notes too — the before-view should show every
      // version that arrived, not only the first.
      rawFields: rawFieldsOf(rawOf?.(r.id)),
      receivedOn: receivedOnFromFileName(r.sourceFile || ""),
    });
  }
  return out;
}
