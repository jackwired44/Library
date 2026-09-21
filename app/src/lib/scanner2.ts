// Scanner 2 — a second, deliberately independent scanner.
//
// WHY THIS FILE EXISTS SEPARATELY, and why it imports nothing from
// detection.ts: Scanner 1 encodes years of Microsoft-specific product
// judgement (SKU_CATALOGUE, PLATFORM_CATALOGUE, the Auto-DQ rules, the
// two live categories). Every one of those rules is a decision Jack made
// about Microsoft leads. Reusing that machinery for a different kind of
// CSV would mean either widening those rules until they stop meaning
// anything, or bolting exceptions onto them — both of which put the
// scanner he relies on daily at risk.
//
// So this is a clean-room engine: same DISCIPLINE (one pass, an accounting
// identity that reconciles, duplicates merged not dropped silently), none
// of the same rules.
//
// The other deliberate difference: Scanner 1's rules are compiled in.
// Here they are DATA, editable in the app, because the whole point is
// "new types of data" — the shape is not known ahead of time, so the
// rules cannot be hardcoded by whoever wrote this file.
import { dbGetAll, dbPut, dbDelete, STORE_SCANNER2_RULESETS, STORE_SCANNER2_RUNS, STORE_SCANNER2_CURATION } from "./db";
import {
  type CspLead, type CspRules, type CspColumnMap,
  guessCspColumns, readCspLead, classifyCsp, resolveCspRules, cspPartnerLabel, isDialable,
  companyFromNotes, companyDomainFromEmail,
} from "./cspRenewal";
// Per Jack: the Custom Scanner's downloads must be the SAME format as the
// Main Scanner's, because that is what Apollo imports. Single-sourced from
// detection.ts rather than restated, so the two cannot drift apart. This is
// the one thing the two scanners deliberately share beyond the CSV helpers.
import { EXPORT_LABELS, CATEGORY_META, type ExportRow } from "./detection";
export type { ExportRow };

/**
 * The Custom Scanner's download columns: the Main Scanner's list minus
 * "Last Name", per Jack — one name column, holding the whole name.
 *
 * DERIVED from EXPORT_LABELS rather than retyped, so if the Main Scanner's
 * columns ever change this follows automatically instead of silently
 * drifting out of the shape Apollo expects.
 *
 * The header stays "First Name" on purpose even though it carries the full
 * name: that is a column Apollo's importer already recognises, where a
 * column called "Name" may need mapping by hand on every import.
 */
/**
 * All three scanners emit the SAME ten columns, in the same order.
 *
 * This used to drop "Last Name" (a full-name source has one field, so the
 * column read blank), which shifted every column after it one letter left:
 * Product Area landed in H and Notes in I, where the Main Scanner puts them
 * in I and J. Jack works to those letters, so a shifted file is a trap.
 * The name is split instead — see toApolloRow.
 */
export const SCANNER2_EXPORT_LABELS = EXPORT_LABELS;

/**
 * The CSP export, per Jack once he had read a real download: Title and
 * Number of Employees are structurally empty in a CSP opportunity export
 * (no such columns exist, and nothing in the seller notes states them), so
 * two dead columns were shipping on every row. Dropped here and ONLY here
 * — the SMC scanner reads both out of its blob and keeps all ten.
 */
export const CSP_EXPORT_LABELS = EXPORT_LABELS.filter(
  (l) => l !== "Title" && l !== "Number of Employees",
);

export const exportLabelsFor = (kind: ScannerKind): readonly string[] =>
  kind === "csp" ? CSP_EXPORT_LABELS : SCANNER2_EXPORT_LABELS;

/** The Main Scanner's own product-line badge colours, so the two results
 *  tables read identically. Imported, not re-picked, for the same
 *  no-drift reason as the export labels above. */
export function productLineStyle(line: ProductLine | null | undefined): { bg: string; color: string } {
  if (line === "Dynamics 365") return { bg: CATEGORY_META.dynamics365.bg, color: CATEGORY_META.dynamics365.color };
  if (line === "M365 / Azure") return { bg: CATEGORY_META.m365Tenant.bg, color: CATEGORY_META.m365Tenant.color };
  return { bg: "var(--surface-sunken)", color: "var(--muted)" };
}
export type Scanner2ExportRow = ExportRow;
import {
  parseSmcLead, parseCampaign, salesGaps, describeLead, fiscalYearNumber, productLineFor,
  resolveSmcRules, highIndexRows, hasRealBant, hotWordHit, wordHit, inferProductLine, isRenewalCampaign, bestContact, looseEmail, loosePhone, type WordHit,
  type SmcLead, type Campaign, type ProductLine, type SmcRules,
} from "./smcLead";

// ---------------------------------------------------------------- types

/** Where a row lands, as proposed by the RULES. Named differently from
 *  Scanner 1's tiers on purpose: these mean "a keyword you wrote matched",
 *  not "the Microsoft detection engine judged this lead", and conflating
 *  the two would make one set of words mean two different things. The
 *  final say is the curation decision, not this. */
export type Bucket2 = "priority" | "review" | "excluded" | "unmatched";

export const BUCKET2_ORDER: Bucket2[] = ["priority", "review", "excluded", "unmatched"];

export const BUCKET2_META: Record<Bucket2, { label: string; hint: string; color: string; bg: string }> = {
  priority: { label: "Strong Signal", hint: "Qualified: Act Now at High Fit on a Dynamics 365 or M365/Azure product they do not already own — or a keyword rule you marked Strong Signal.", color: "#0E7A72", bg: "#E3F3F1" },
  review: { label: "Needs Review", hint: "Real content, but not a clear whitespace play — propensity without a gap, BANT, or contacts only.", color: "#9A5B22", bg: "#FBF0E2" },
  excluded: { label: "Bad Leads", hint: "Stale campaign, blank/NULL row, or a keyword rule you marked Bad Lead. Bad Lead always wins.", color: "#B5443B", bg: "#FBEAE8" },
  unmatched: { label: "No Signal", hint: "Nothing qualifying was found. Not a verdict — just nothing to act on yet.", color: "#5C7379", bg: "#F1F5F5" },
};

/** A rule is a set of keywords tested against chosen columns (or every
 *  column). Kept intentionally simple: this has to be writable by hand in
 *  the UI, so no regex syntax to get wrong and no boolean algebra. */
/**
 * The CSP Scanner speaks in priority, not signal. Per Jack: "re do curation
 * and product line to be high medium low priority in that order" — the
 * buckets are the same four the engine already produces (so filters,
 * counts and downloads need no second code path), they just read as the
 * priority you would sequence them at. Same colours as the SMC labels so
 * the two scanners still look like one product.
 */
export const CSP_BUCKET_META: Record<Bucket2, { label: string; hint: string; color: string; bg: string }> = {
  priority: { label: "High priority", hint: "Scored at or above the Strong Signal line — or pinned: asking for a partner, none assigned, annual upfront. Sequence these first.", color: "#0E7A72", bg: "#E3F3F1" },
  review: { label: "Medium priority", hint: "Live and scored above the review line, but held by a partner, small, or quiet. Worth a lighter-touch sequence.", color: "#9A5B22", bg: "#FBF0E2" },
  excluded: { label: "Low priority", hint: "Dead or unresponsive language, untouched past the cutoff, or scored under the review line. Still visible, still reversible, left out of the downloads.", color: "#B5443B", bg: "#FBEAE8" },
  unmatched: { label: "No signal", hint: "No value, programme or dated note on this row. Not a verdict — nothing to act on yet.", color: "#5C7379", bg: "#F1F5F5" },
};
export const bucketMetaFor = (isCsp: boolean) => (isCsp ? CSP_BUCKET_META : BUCKET2_META);

export interface Rule2 {
  id: string;
  label: string;
  /** Plain keywords/phrases. Case-insensitive, whole-word where the term
   *  is alphanumeric so "IT" does not match "with". */
  keywords: string[];
  /** Column names to search. Empty = search every column. */
  columns: string[];
  bucket: Exclude<Bucket2, "unmatched">;
  /** All keywords must be present, rather than any one of them. */
  requireAll?: boolean;
  enabled: boolean;
}

/** Which of the Custom Scanner's tabs a saved rule set, run or curated
 *  decision belongs to. Optional on every persisted record so everything
 *  saved before the CSP tab existed reads as "smc" — no migration, no
 *  DB_VERSION bump, and an old rule set keeps working untouched. */
export type ScannerKind = "smc" | "csp";
export const SCANNER_KINDS: { key: ScannerKind; label: string; hint: string }[] = [
  { key: "smc", label: "SMC September", hint: "Microsoft SMC / Cloud Ascent propensity blobs — buying intent read from the propensity matrix." },
  { key: "csp", label: "CSP Scanner", hint: "CSP licensing renewals — qualified on how close the term end is, seat count and who holds the customer today." },
];
export const scannerKindOf = (r: { scanner?: ScannerKind } | null | undefined): ScannerKind => r?.scanner ?? "smc";

export interface RuleSet2 {
  id: string;
  name: string;
  /** Which tab this belongs to. Absent = "smc" (see ScannerKind). */
  scanner?: ScannerKind;
  /** Columns to treat as the row's identity for duplicate merging. Empty
   *  = no duplicate detection, because guessing an identity key for an
   *  unknown CSV shape would merge rows that are not the same thing. */
  dedupeColumns: string[];
  /** Which column is the company, the contact, the notes… Persisted with
   *  the rule set so a returning upload of the same shape just works. */
  fields: FieldMapping;
  /** Which columns make up the free text the rules read. Multi-column
   *  because a CRM export routinely splits the story across several
   *  fields — here campaignidname AND description (and the duplicate
   *  description_1) are all part of the note. */
  notesColumns: string[];
  /** How rows are classified. "keywords" runs the rules below;
   *  "smc" parses the Microsoft SMC / Cloud Ascent blob instead, where
   *  nobody writes a sentence about wanting anything and intent has to be
   *  read from the propensity matrix. */
  mode: "keywords" | "smc" | "csp";
  /** Columns holding the campaign code (campaignidname). */
  campaignColumns: string[];
  /** What pushes an SMC lead to Strong Signal — see SmcRules. Optional so
   *  a rule set saved before the knobs existed resolves to the defaults. */
  smcRules?: SmcRules;
  /** Campaigns older than this fiscal year are treated as stale. FY24's
   *  "COE True Up" bulk dominates the column and is two years old. */
  smcMinFiscalYear: number;
  /** What qualifies a CSP renewal. Optional so a rule set saved before the
   *  CSP tab existed resolves to the defaults. */
  cspRules?: Partial<CspRules>;
  /** Which column holds each CSP field. Persisted like `fields` is, so a
   *  returning export of the same shape just works; re-guessed when a
   *  saved choice is absent from the file being scanned. */
  cspColumns?: CspColumnMap;
  /** Columns to leave OUT of the download. Everything not listed here is
   *  exported, so a column you never think about still survives the round
   *  trip — the failure mode to avoid is a silently dropped field. */
  excludedColumns: string[];
  rules: Rule2[];
  createdAt: string;
  updatedAt: string;
}

export interface Row2 {
  id: string;
  sourceFile: string;
  row: Record<string, unknown>;
  /** Lead identity, resolved through the rule set's field mapping. */
  lead: Lead2;
  leadKey: string | null;
  /** Readable evidence for why this row landed where it did. */
  snippet: string;
  /** Present only in SMC mode. */
  smc?: SmcLead;
  /** Present only in CSP mode. */
  csp?: CspLead;
  campaign?: Campaign;
  /** Dynamics 365 or M365 / Azure — the same two lines the Main Scanner files under. */
  productLine?: ProductLine | null;
  /** ISO date this lead appears to have arrived — the blob's "as pulled
   *  on" date, else a created/received date column if the file has one.
   *  Null when nothing in the row states one; such a row always sorts
   *  BELOW every dated row rather than being guessed a date. */
  receivedOn?: string | null;
  bucket: Bucket2;
  /** Every rule that fired, in rule order — not just the winning one, so
   *  a row's classification is always explainable. */
  matched: { ruleId: string; label: string; bucket: Rule2["bucket"]; terms: string[] }[];
  dupKey: string | null;
  duplicateGroupSize?: number;
  /** Set when this row named nobody and a contact was adopted from another
   *  row in the same upload for the same account. Never set on a row that
   *  already named someone — two people are never mixed into one row. */
  contactFrom?: "tpid" | "company";
}

export interface DuplicateRow2 { key: string; sourceFile: string; mergedIntoSourceFile: string; preview: string }

export interface Scan2Result {
  rows: Row2[];
  /** Where `receivedOn` came from for this upload: a sheet column (named),
   *  the seller notes, or nothing — so the date filter can say what it is
   *  filtering on instead of just "Received". */
  dateSource: { kind: "column"; column: string } | { kind: "notes" } | { kind: "none" };
  rowsRead: number;
  duplicatesMerged: number;
  duplicateRows: DuplicateRow2[];
  columns: string[];
}

// ------------------------------------------------------------- profiling

export interface ColumnProfile {
  name: string;
  filled: number;
  total: number;
  fillRate: number;
  distinct: number;
  /** A few real values, so you can see what the column actually holds
   *  before writing a rule against it. */
  samples: string[];
  /** Cheap shape guess, only used to sort useful columns to the top. */
  kind: "empty" | "numeric" | "date" | "email" | "url" | "long-text" | "text";
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^(https?:\/\/|www\.)/i;
const NUM_RE = /^-?[\d,]+(\.\d+)?%?$/;

function guessKind(values: string[]): ColumnProfile["kind"] {
  if (values.length === 0) return "empty";
  const hit = (re: RegExp) => values.filter((v) => re.test(v)).length / values.length;
  if (hit(EMAIL_RE) > 0.6) return "email";
  if (hit(URL_RE) > 0.6) return "url";
  if (hit(NUM_RE) > 0.8) return "numeric";
  if (values.filter((v) => !Number.isNaN(Date.parse(v)) && /[-/]/.test(v)).length / values.length > 0.7) return "date";
  const avg = values.reduce((n, v) => n + v.length, 0) / values.length;
  return avg > 80 ? "long-text" : "text";
}

/** Describe an uploaded file's columns. This is the step that replaces
 *  Scanner 1's fixed FIELD_DEFS: nothing is assumed about the shape, so
 *  the first thing the UI can do is show you what arrived. */
export function profileColumns(files: { name: string; fields: string[]; data: Record<string, unknown>[] }[]): ColumnProfile[] {
  const names: string[] = [];
  for (const f of files) for (const c of f.fields) if (c && !names.includes(c)) names.push(c);
  return names.map((name) => {
    const raw: string[] = [];
    let total = 0;
    for (const f of files) {
      for (const r of f.data) {
        total++;
        const v = r[name];
        const s = v == null ? "" : String(v).trim();
        if (s) raw.push(s);
      }
    }
    const distinct = new Set(raw).size;
    const samples: string[] = [];
    for (const v of raw) {
      if (samples.length >= 3) break;
      if (!samples.includes(v)) samples.push(v.length > 70 ? `${v.slice(0, 70)}…` : v);
    }
    return { name, filled: raw.length, total, fillRate: total ? raw.length / total : 0, distinct, samples, kind: guessKind(raw.slice(0, 200)) };
  });
}


// --------------------------------------------------------- lead identity
//
// Scanner 1's bones, carried over: a row is not just cells, it is a person
// at a company. Everything below is generic CSV column-guessing — NONE of
// Scanner 1's Microsoft rules come with it, which is why this is a small
// local guesser rather than an import from detection.ts. The guess only
// has to be a good starting point, because the UI lets you override every
// field by hand.

export type LeadField = "company" | "contact" | "title" | "email" | "phone" | "mobilePhone" | "employees" | "notes";

export const LEAD_FIELDS: { key: LeadField; label: string }[] = [
  { key: "company", label: "Company" },
  { key: "contact", label: "Contact" },
  { key: "title", label: "Title" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Work phone" },
  { key: "mobilePhone", label: "Mobile phone" },
  { key: "employees", label: "Employees" },
  { key: "notes", label: "Notes" },
];

/**
 * Guess order, which is NOT the display order above. An explicit mobile
 * column is claimed before the work-phone field, so a file carrying both
 * "mobilephone" and "telephone1" maps each to the right one instead of
 * the work field swallowing whichever came first.
 */
const GUESS_ORDER: LeadField[] = ["company", "contact", "title", "email", "mobilePhone", "phone", "employees"];

export type FieldMapping = Partial<Record<LeadField, string>>;

// Most specific hint FIRST — the guess below tries them in this order, so
// "companyname" beats "accountidname" even though the account column comes
// first in the file. That ordering is the whole point: mapping identity to
// accountidname (a column this scanner drops as noise) put the wrong name
// on every lead.
const FIELD_HINTS: Record<LeadField, string[]> = {
  // "customername" sits second because a CSP / Partner Center export names
  // the company that way, and nothing here matched it — the column landed
  // unmapped and the whole download had a blank Company. Deliberately NOT
  // a bare "customer": that would claim "Customer Domain" or "Customer Id"
  // in a file with no "Customer Name", putting a domain in the company
  // column. "companyname" still wins wherever both exist, so the SMC tab
  // is unaffected.
  company: ["companyname", "customeridname", "customername", "company", "accountname", "organizationname", "organisationname", "organization", "organisation", "employer", "business", "firm", "account"],
  contact: ["fullname", "contactname", "name", "contact", "person", "lead", "owner"],
  title: ["jobtitle", "title", "role", "position", "seniority"],
  email: ["emailaddress", "email", "e-mail", "mail"],
  // "telephone1" is listed ahead of the looser "telephone" so a whole-header
  // match claims it outright: a CSP opportunity export carries BOTH
  // address1_telephone1 (71 rows filled) and telephone1 (6,580), and the
  // address one sits first in the file — without this the download read the
  // near-empty column and 6,500 real phone numbers never left the building.
  phone: ["telephone1", "telephone", "workdirectphone", "workphone", "directphone", "businessphone", "phone", "tel", "direct"],
  mobilePhone: ["mobilephone", "mobile", "cellphone", "cell"],
  employees: ["numberofemployees", "numemployees", "employeecount", "employees", "headcount"],
  notes: ["notes", "comment", "description", "summary", "detail", "message", "remark"],
};

/** Best-effort column guess. Exact-ish header match first, then substring,
 *  then a shape fallback from the profile (an email-shaped column is the
 *  email column even if its header is something odd). */
export function guessFieldMapping(profiles: ColumnProfile[]): FieldMapping {
  const out: FieldMapping = {};
  // A campaign column is a campaign code, and a notes column is the story.
  // Neither is ever a person or a company, so neither may be guessed into
  // an identity field: doing so put a campaign code in "contact", which
  // made two unrelated leads on the same campaign look like the same
  // person — a silent merge and a shared curation decision.
  const taken = new Set<string>([...guessCampaignColumns(profiles), ...guessNotesColumns(profiles)]);
  const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

  // Notes is not a single column any more — it has its own multi-select
  // (guessNotesColumns), so it is absent from GUESS_ORDER on purpose.
  for (const key of GUESS_ORDER) {
    const hints = FIELD_HINTS[key];
    let pick: ColumnProfile | undefined;
    // Whole-header match first, walking hints in priority order, then the
    // same walk allowing a substring. Hint order decides, not file order.
    for (const h of hints) {
      pick = profiles.find((p) => !taken.has(p.name) && squash(p.name) === squash(h));
      if (pick) break;
    }
    if (!pick) {
      // Substring pass. When several columns match the SAME hint, take the
      // fullest rather than whichever the file happens to list first — an
      // identity column that is 71% populated is the real one and a 0.8%
      // namesake is not. File order is not evidence of anything.
      for (const h of hints) {
        const hits = profiles.filter((p) => !taken.has(p.name) && squash(p.name).includes(squash(h)));
        if (hits.length) {
          pick = hits.reduce((best, p) => (p.fillRate > best.fillRate ? p : best), hits[0]);
          break;
        }
      }
    }
    if (!pick && key === "email") pick = profiles.find((p) => !taken.has(p.name) && p.kind === "email");
    if (pick) { out[key] = pick.name; taken.add(pick.name); }
  }
  return out;
}

/** Columns holding the Microsoft campaign code (campaignidname). */
export function guessCampaignColumns(profiles: ColumnProfile[]): string[] {
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return profiles.filter((p) => norm(p.name).includes("campaign")).map((p) => p.name);
}

export interface Lead2 { company: string; contact: string; title: string; email: string; phone: string; mobilePhone: string; employees: string; notes: string }

// ------------------------------------------------- export hygiene
// Audited against Jack's real 13,106-row Bookleads export: the Custom
// scanner was exporting 61 undialable work phones, 19 undialable mobiles,
// 10 malformed emails and one numeric surname. Apollo imports "N/A" as a
// phone number quite happily, and a call list full of "0" and "-" is worse
// than one with blanks — you cannot tell a bad number from a missing one.
//
// The CSP engine already refused these (isDialable), but that guard lives
// inside the CSP rules and applying it to SMC would make one scanner's
// export depend on another scanner's engine. This is plumbing, not a rule,
// so it lives HERE in the composer and every scanner gets it for free.

/** Placeholders that mean "no value" in a CRM export. Whole-field only: a
 *  company genuinely called "Nil" keeps its name. */
const JUNK_FIELD_RE = /^(n\/?a|n\.a\.?|none|null|nil|unknown|undefined|tbd|not\s+available|no\s+data|[-–—.,_/\\*?#]+|0+(\.0+)?)$/i;
/** A number Excel destroyed on save. The digits are unrecoverable. */
const SCIENTIFIC_RE = /\d[.,]?\d*\s*e\s*\+?\s*\d+/i;
/** Fewest digits that could be a real, dialable number. */
const MIN_PHONE_DIGITS = 7;

const isJunk = (v: string) => JUNK_FIELD_RE.test(v.trim());

/** A phone fit to hand a dialer, or "". Rejects placeholders, Excel's
 *  scientific notation, anything too short to dial, and — seen three times
 *  in the real file — an email address sitting in the phone column. */
export function exportPhone(v: unknown): string {
  const t = String(v ?? "").trim();
  if (!t || isJunk(t) || t.includes("@") || SCIENTIFIC_RE.test(t)) return "";
  return t.replace(/\D/g, "").length >= MIN_PHONE_DIGITS ? t : "";
}

/** An address fit to email, or "". A trailing separator is stripped rather
 *  than thrown away ("jacob.rivera@ocvt.info ·" is a real address with
 *  punctuation glued on), but anything that still is not an address goes. */
export function exportEmail(v: unknown): string {
  const t = String(v ?? "").trim().replace(/[\s·|,;]+$/, "").replace(/^[\s·|,;]+/, "");
  if (!t || isJunk(t)) return "";
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(t) ? t : "";
}

/** A name or company fit to print. Blanks a placeholder or a bare number —
 *  a surname of "0" came from a full name of "Manu 0". */
export function exportText(v: unknown): string {
  const t = String(v ?? "").trim();
  return !t || isJunk(t) ? "" : t;
}

function readLead(row: Record<string, unknown>, m: FieldMapping, notesCols: string[]): Lead2 {
  const g = (k: LeadField) => { const c = m[k]; return c ? String(row[c] ?? "").trim() : ""; };
  // Notes is the join of every chosen notes column, so a rule keyword
  // matches wherever in the story it appears.
  const notes = notesCols.length
    ? notesCols.map((c) => String(row[c] ?? "").trim()).filter(Boolean).join(" · ")
    : g("notes");
  return {
    company: g("company"), contact: g("contact"), title: g("title"), email: g("email"),
    phone: g("phone"), mobilePhone: g("mobilePhone"), employees: g("employees"), notes,
  };
}

/** Columns that look like free text worth reading as notes. Includes the
 *  campaign field explicitly, per Jack's note that it carries the story
 *  for this batch alongside description. */
export function guessNotesColumns(profiles: ColumnProfile[]): string[] {
  const want = ["description", "notes", "comment", "summary", "detail", "message"];
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
  // Header starts with a notes word — the SMC shape (description,
  // description_1), unchanged.
  const picked = profiles.filter((p) => want.some((w) => norm(p.name).startsWith(norm(w))));
  if (picked.length) return picked.map((p) => p.name);
  // Header CONTAINS one: a CSP opportunity export calls its story
  // msp_forecastcomments. It used to be found only when the content
  // happened to profile as long text, so an export with shorter notes
  // silently lost every seller note, every recovered date and every
  // dead / motion signal with it.
  const contains = profiles.filter((p) => want.some((w) => norm(p.name).includes(norm(w))));
  if (contains.length) return contains.map((p) => p.name);
  const long = profiles.filter((p) => p.kind === "long-text");
  return long.map((p) => p.name);
}

/** The sentence around the first matched term, so a classification is
 *  readable at a glance instead of needing the raw row opened. */
function snippetFor(text: string, terms: string[]): string {
  if (!text) return "";
  const lower = text.toLowerCase();
  let at = -1;
  for (const t of terms) { const i = lower.indexOf(t.toLowerCase()); if (i >= 0 && (at < 0 || i < at)) at = i; }
  if (at < 0) return text.length > 140 ? `${text.slice(0, 140)}\u2026` : text;
  const start = Math.max(0, text.lastIndexOf(".", at) + 1);
  const endDot = text.indexOf(".", at);
  const end = endDot > 0 ? endDot + 1 : Math.min(text.length, at + 120);
  return text.slice(start, end).trim();
}

// ------------------------------------------------- default column drops
//
// Per Jack, for the Dynamics-style export he is importing: these columns
// are noise for lead curation and should not come back in the download.
// Seeded ONLY on a first upload and only for columns actually present —
// after that the list is his, and nothing re-adds to it behind his back.
//
// NOTE: his list included a bare "codename", which is not a column on its
// own. The only column it can mean (statuscodename was listed separately)
// is industrycodename, so that is what is dropped. One toggle restores it.
//
// campaignidname is deliberately NOT here: Jack confirmed it and
// description together are the NOTES this scanner reads, so it is content
// and has to survive into the download.
export const DEFAULT_DROP_COLUMNS = [
  // Dynamics spells this "estimatedclosedate"; the earlier entry was a
  // letter short, so the column Jack asked to drop survived into every
  // download of his real file. Both spellings are listed rather than one
  // corrected, in case an export ever uses the shorter form.
  "estimatedclosedate",
  "estimatedclosedat",
  "industrycodename",
  "statuscodename",
  "revenue",
  "accountidname",
  "address1_city",
  "address1_stateorprovince",
  "msdyn_segmentidname",
];

/** Case/punctuation-insensitive match, so "Address1_City" and
 *  "address1 city" are recognised as the same column. */
export function isDefaultDropColumn(name: string): boolean {
  const n = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  return DEFAULT_DROP_COLUMNS.some((d) => d.toLowerCase().replace(/[^a-z0-9]/g, "") === n);
}

/** The columns a download will actually contain, in file order. */
export function exportColumns(all: string[], excluded: string[]): string[] {
  const drop = new Set(excluded);
  return all.filter((c) => !drop.has(c));
}

// -------------------------------------------------------------- curation
//
// Rules propose, you dispose. The rule-assigned bucket is the machine's
// opinion; the curation decision is yours, and it WINS in every export.
export type Curation = "keep" | "maybe" | "reject";

export const CURATION_META: Record<Curation, { label: string; color: string; bg: string }> = {
  keep: { label: "Keep", color: "#0E7A72", bg: "#E3F3F1" },
  maybe: { label: "Maybe", color: "#9A5B22", bg: "#FBF0E2" },
  reject: { label: "Reject", color: "#B5443B", bg: "#FBEAE8" },
};

export interface CurationRecord { key: string; decision: Curation; note?: string; at: string }

/** The manual override, in CSP: you set a lead's priority by hand and it
 *  wins over the score. Stored as the same keep / maybe / reject values the
 *  SMC tab uses, so nothing already persisted needs migrating — only the
 *  words on the buttons differ. */
export const CSP_CURATION_META: Record<Curation, { label: string; color: string; bg: string }> = {
  keep: { label: "High", color: "#0E7A72", bg: "#E3F3F1" },
  maybe: { label: "Medium", color: "#9A5B22", bg: "#FBF0E2" },
  reject: { label: "Low", color: "#B5443B", bg: "#FBEAE8" },
};
export const curationMetaFor = (isCsp: boolean) => (isCsp ? CSP_CURATION_META : CURATION_META);

/** A manual priority maps straight onto a bucket. */
export const CURATION_TO_BUCKET: Record<Curation, Bucket2> = { keep: "priority", maybe: "review", reject: "excluded" };


/**
 * Identity for a curation decision, strongest first.
 *
 * This USED to return a key when only one half of company+contact was
 * present, which quietly shared one decision across every contact-less
 * lead at the same company — a single Keep marked hundreds of unrelated
 * accounts. Measured at real volume: 584 different rows on one key.
 *
 * A curation key must be (a) stable across re-uploads, so a decision
 * survives, and (b) unique to one lead, so a decision cannot leak onto
 * another. Company alone is neither. The cascade below only ever returns
 * something that distinguishes the lead; when nothing does, it returns
 * null and the row is honestly marked as not curatable rather than
 * sharing someone else's decision.
 *
 * The Microsoft TPID is handled by the caller and beats all of these.
 */
export function curationKey(l: Lead2, website?: string): string | null {
  const c = normalizeKey(l.company);
  const p = normalizeKey(l.contact);
  if (c && p) return `${c}|${p}`;
  const e = normalizeKey(l.email);
  if (e) return `email:${e}`;
  const w = normalizeKey(website || "");
  if (c && w) return `${c}|site:${w}`;
  return null;
}

/**
 * Last resort when a lead states no TPID, no contact and no email: a hash
 * of its own text. Two rows carrying byte-identical lead text are the same
 * lead by every means available here, so one decision covering them is the
 * same conclusion a person reading them would reach. Stable across
 * re-uploads of the same file, which is what curation needs.
 *
 * FNV-1a, because this only has to be stable and well-spread, not secure.
 */
export function textKey(text: string): string | null {
  const t = normalizeKey(text);
  if (!t) return null;
  let h = 0x811c9dc5;
  for (let i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `text:${h.toString(36)}:${t.length}`;
}

/** Stricter than leadKey: BOTH halves present, or no key at all. Used for
 *  duplicate merging, where a company-only match would fold every
 *  contact-less row at one company into one — the Main Scanner's own
 *  exact name + company rule. */
export function identityKey(l: Lead2): string | null {
  const c = normalizeKey(l.company), p = normalizeKey(l.contact);
  return c && p ? `${c}|${p}` : null;
}

export async function loadCuration(): Promise<Record<string, CurationRecord>> {
  const all = await dbGetAll<CurationRecord>(STORE_SCANNER2_CURATION);
  const out: Record<string, CurationRecord> = {};
  for (const r of all) out[r.key] = r;
  return out;
}
export async function setCuration(key: string, decision: Curation, note = ""): Promise<CurationRecord> {
  const rec: CurationRecord = { key, decision, note, at: new Date().toISOString() };
  await dbPut(STORE_SCANNER2_CURATION, rec);
  return rec;
}
export async function clearCuration(key: string): Promise<void> {
  await dbDelete(STORE_SCANNER2_CURATION, key);
}

// ------------------------------------------------------- SMC classification

/**
 * Where an SMC lead lands, and WHY in one readable line.
 *
 * The signal is Cloud Ascent's own recommendation crossed with what they
 * already own: "Act Now" at "High Fit" on a product they do NOT have is
 * the whitespace play. Anything already owned is not whitespace no matter
 * how strongly it scores, which is why ownership is checked rather than
 * propensity alone. Only Dynamics 365 and M365 / Azure count — the two
 * lines the Main Scanner qualifies on. A Surface gap is context, not a
 * lead for Wired CIO.
 */
/**
 * The shape rule every Notes value obeys, applied in one place so no branch
 * can drift: one line, single-spaced, no separator hanging off either end,
 * no doubled separators, and never empty.
 */
export function tidyNote(why: string, fallback = "Scanned, nothing further stated"): string {
  const out = why
    .replace(/\s+/g, " ")
    .replace(/(?:\s*·\s*){2,}/g, " · ")
    .replace(/^[\s·]+/, "")
    .replace(/[\s·]+$/, "")
    .trim();
  return out || fallback;
}

export function classifySmc(
  lead: SmcLead,
  campaign: Campaign | undefined,
  minFiscalYear: number,
  rules: SmcRules = resolveSmcRules(undefined),
): { bucket: Bucket2; why: string } {
  if (lead.empty) return { bucket: "excluded", why: "No usable lead content (blank or NULL)" };

  // Stale campaign: excluded before anything else, because a two-year-old
  // bulk campaign is not a lead regardless of how the account scores.
  if (campaign && !campaign.empty) {
    const fy = fiscalYearNumber(campaign);
    if (fy >= 0 && fy < minFiscalYear) {
      return { bucket: "excluded", why: `Stale campaign — ${campaign.fiscalYear} ${campaign.name}` };
    }
  }

  const gaps = salesGaps(lead, rules);
  const base = describeLead(lead, rules);
  // The Campaign column is merged into this reason, so a renewal/true-up
  // campaign is dropped here rather than shown beside its own lead.
  const camp = campaign && campaign.name && !isRenewalCampaign(campaign.name)
    ? ` · ${campaign.fiscalYear || ""} ${campaign.name}`.replace(/\s+/g, " ")
    : "";

  if (gaps.length) return { bucket: "priority", why: `${base}${camp}` };
  const detail = base && base !== "Parsed, no propensity or contacts" ? ` · ${base}` : "";
  const whereTxt = (h: WordHit) => (h.where === "campaign" ? `campaign "${campaign?.name}"` : h.where === "need" ? "BANT need" : "notes");
  // Per Jack, migration / modernization language is a great-opp signal in
  // its own right — on by default, word list editable. A hot word sitting
  // next to a not-supported product (Fabric) does not fire — see hotWordHit.
  const hot = hotWordHit(lead, campaign?.name ?? "", rules);
  if (hot) return { bucket: "priority", why: `Hot signal — "${hot.word}" in ${whereTxt(hot)}${detail}` };

  // Per Jack: "we dont do fabric anymore and unless its a large power bi
  // opp no." A campaign or BANT need aimed at a not-supported product is a
  // Bad Lead; one aimed at a large-only product is never auto-Strong and
  // waits in Needs Review for a human to judge the size. A mention buried
  // in the notes only annotates the why line.
  const noGo = wordHit(lead, campaign?.name ?? "", rules.notSupported);
  const large = wordHit(lead, campaign?.name ?? "", rules.largeOnly);
  const needTainted = noGo?.where === "need" || large?.where === "need";
  // Optional pushes, each a knob Jack can turn on.
  if (rules.highIndexPushesStrong) {
    const hi = highIndexRows(lead, rules);
    if (hi.length) return { bucket: "priority", why: `High prioritization index: ${hi.map((h) => h.product).join(", ")}${camp}` };
  }
  if (rules.bantPushesStrong && hasRealBant(lead) && !needTainted) {
    return { bucket: "priority", why: `BANT on file — ${base}${camp}` };
  }
  if (noGo && noGo.where !== "notes") {
    return { bucket: "excluded", why: `Not supported — "${noGo.word}" in ${whereTxt(noGo)}${detail}${noGo.where === "campaign" ? "" : camp}` };
  }
  if (large && large.where !== "notes") {
    return { bucket: "review", why: `"${large.word}" in ${whereTxt(large)} — Strong only if a large opp, judge by hand${detail}${large.where === "campaign" ? "" : camp}` };
  }
  const mention = noGo ? ` · mentions "${noGo.word}" (not supported)` : large ? ` · mentions "${large.word}" (large opps only)` : "";

  // Every note states its verdict FIRST, then the supporting detail. These
  // four used to open with whatever detail happened to exist ("2 contacts ·
  // FY26 Expand M365 Copilot"), which describes the lead without ever saying
  // why it landed where it did — the note read as a gap rather than a reason.
  //
  // Real human BANT beats an all-Unknown propensity matrix.
  if (lead.bant.need || lead.bant.authority) {
    return { bucket: "review", why: `Needs review — BANT on file, no qualifying propensity${detail}${camp}${mention}` };
  }
  if (lead.propensity.some((p) => p.stage !== "Unknown")) {
    return { bucket: "review", why: `Needs review — propensity on file, no ${rules.stages.join("/")} + ${rules.minFit}+ Fit gap on a sold line${detail}${camp}${mention}` };
  }
  if (lead.contacts.length) {
    return { bucket: "review", why: `Needs review — contacts only, no propensity or BANT${detail}${camp}${mention}` };
  }
  return { bucket: "unmatched", why: `No signal — nothing qualifying found${detail}${camp}${mention}` };
}

// -------------------------------------------------------------- matching

/** Whole-word for alphanumeric terms, substring for anything containing
 *  punctuation (so "d365" and "co-managed" both behave sensibly). */
function termMatches(term: string, haystack: string): boolean {
  const t = term.trim().toLowerCase();
  if (!t) return false;
  if (/^[a-z0-9][a-z0-9 ]*$/.test(t)) {
    const re = new RegExp(`(?<![a-z0-9])${t.replace(/\s+/g, "\\s+")}(?![a-z0-9])`, "i");
    return re.test(haystack);
  }
  return haystack.includes(t);
}

function textFor(row: Record<string, unknown>, columns: string[]): string {
  const src = columns.length ? columns : Object.keys(row);
  return src.map((c) => { const v = row[c]; return v == null ? "" : String(v); }).join(" · ").toLowerCase();
}

export function normalizeKey(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

// ------------------------------------------------------------------ scan

/**
 * One pass over every row.
 *
 * Bucket precedence is fixed and deliberate: excluded > priority > review
 * > unmatched. Excluded wins outright for the same reason Scanner 1's
 * Auto-DQ is cross-cutting — an exclusion is a statement about the whole
 * row, so a row cannot be both worth calling and something you told the
 * tool to drop.
 *
 * Unlike Scanner 1, NOTHING is silently withheld: a row that matches no
 * rule still comes back, in the "unmatched" bucket. That is the direct
 * lesson from auditing Scanner 1, where a row with no product hit never
 * became a result row at all and could never reach the exclusion rules.
 */
/** Today as YYYY-MM-DD in the viewer's own calendar, never UTC — a
 *  renewal "in 3 days" must mean three of Jack's days. */
export function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Keep a saved CSP column choice when the column is still in the file,
 *  re-guess the rest. A stale pick is the difference between reading a
 *  renewal date and reading nothing, and silently reading nothing is how
 *  a whole upload lands in "no renewal date stated". */
export function reconcileCspColumns(saved: CspColumnMap | undefined, columns: string[]): CspColumnMap {
  const fresh = guessCspColumns(columns);
  if (!saved) return fresh;
  const present = new Set(columns);
  const out: CspColumnMap = { ...fresh };
  for (const [k, v] of Object.entries(saved) as [keyof CspColumnMap, string | undefined][]) {
    if (v && present.has(v)) out[k] = v;
  }
  return out;
}

export function scan2(
  files: { name: string; fields: string[]; data: Record<string, unknown>[] }[],
  ruleSet: RuleSet2,
): Scan2Result {
  const columns: string[] = [];
  for (const f of files) for (const c of f.fields) if (c && !columns.includes(c)) columns.push(c);

  const active = ruleSet.rules.filter((r) => r.enabled && r.keywords.length > 0);
  // CSP mode reads its own columns, independent of the identity mapping:
  // a renewal date and a seat count are not a lead's name or company, and
  // conflating the two mappings is how one would overwrite the other.
  const cspRules = resolveCspRules(ruleSet.cspRules);
  const cspCols: CspColumnMap = ruleSet.mode === "csp"
    ? reconcileCspColumns(ruleSet.cspColumns, columns)
    : {};
  // Fixed for the whole scan, so every row is measured against the same
  // day and a scan that straddles midnight cannot classify inconsistently.
  const today = localDayKey(new Date());
  const receivedCols = columns.filter((c) => RECEIVED_COLUMN_RE.test(c.replace(/[^a-z0-9]/gi, "").toLowerCase()));
  const rows: Row2[] = [];
  let rowsRead = 0;
  let seq = 0;

  for (const f of files) {
    for (const raw of f.data) {
      rowsRead++;
      const matched: Row2["matched"] = [];
      for (const rule of active) {
        const hay = textFor(raw, rule.columns);
        const hits = rule.keywords.filter((k) => termMatches(k, hay));
        const fired = rule.requireAll ? hits.length === rule.keywords.length : hits.length > 0;
        if (fired) matched.push({ ruleId: rule.id, label: rule.label, bucket: rule.bucket, terms: hits });
      }
      const bucket: Bucket2 =
        matched.some((m) => m.bucket === "excluded") ? "excluded"
        : matched.some((m) => m.bucket === "priority") ? "priority"
        : matched.some((m) => m.bucket === "review") ? "review"
        : "unmatched";

      const lead = readLead(raw, ruleSet.fields ?? {}, ruleSet.notesColumns ?? []);
      const columnDate = receivedFromColumns(raw, receivedCols);
      // Filled in below once the SMC blob has been parsed: the Microsoft
      // Customer TPID is the real identity of one of these leads, stable
      // across exports, so it beats a name/company guess when present.
      let identity: string | null = null;
      const allTerms = matched.flatMap((m) => m.terms);
      let snippet = snippetFor(lead.notes || Object.values(raw).map((v) => String(v ?? "")).join(" "), allTerms);
      let finalBucket = bucket;
      let smc: SmcLead | undefined;
      let csp: CspLead | undefined;
      let campaign: Campaign | undefined;
      let productLine: ProductLine | null | undefined;

      if (ruleSet.mode === "smc") {
        smc = parseSmcCached(raw, lead.notes);
        const campText = (ruleSet.campaignColumns ?? [])
          .map((c) => String(raw[c] ?? "").trim()).filter(Boolean).join(" ");
        campaign = parseCampaign(campText);
        const smcRules = resolveSmcRules(ruleSet.smcRules);
        const verdict = classifySmc(smc, campaign, ruleSet.smcMinFiscalYear ?? 25, smcRules);
        finalBucket = verdict.bucket;
        snippet = tidyNote(verdict.why);
        productLine = productLineFor(smc, smcRules);
        // A Strong Signal row must always carry a line, or the per-line
        // counts cannot add up to the Strong Signal total.
        if (finalBucket === "priority" && !productLine) productLine = inferProductLine(smc, campaign.name);
        // The blob is the source of identity here, not the CSV columns.
        if (smc.company) lead.company = smc.company;
        // Fill every blank identity field from the blob, independently.
        // These used to be filled ONLY when the CSV had no contact name, so a
        // row carrying a name but no email silently lost the email that was
        // sitting in its own text.
        const c0 = bestContact(smc);
        if (c0) {
          lead.contact = lead.contact || `${c0.firstName} ${c0.lastName}`.trim();
          lead.title = lead.title || c0.title;
          lead.email = lead.email || c0.email;
          lead.phone = lead.phone || c0.phone;
        }
        lead.phone = lead.phone || smc.mainPhone;
        // Nothing labelled it, but it is in the row — do not lose it.
        lead.email = lead.email || looseEmail(smc.rawText);
        lead.phone = lead.phone || loosePhone(smc.rawText);
        // Last resort for the company: the CRM account column. It is treated
        // as noise for identity because it holds record ids, and mapping
        // Company to it put "ACCT-1234" on every lead. But a lead with NO
        // company anywhere is worse than one named by its account record, so
        // it is used here and only here.
        if (!lead.company) lead.company = accountFallback(raw);
        // A Customer TPID identifies the ACCOUNT, not the person. Using it
        // alone as the identity merged two different people at one account
        // and silently dropped one of them from the table and the download.
        // Pair it with the person; TPID alone is only an identity when the
        // row names nobody, where there is nothing finer to key on.
        if (smc.tpids.length) {
          const who = normalizeKey(lead.contact);
          identity = who ? `tpid:${smc.tpids[0]}|${who}` : `tpid:${smc.tpids[0]}`;
        }
      }

      if (ruleSet.mode === "csp") {
        const c = readCspLead(raw, cspCols, lead.notes, today);
        // Excel-mangled numbers ("5.25549E+11") are dropped, not exported:
        // the real digits are unrecoverable, and a wrong number in a call
        // list is worse than a blank one. Counted so the total can be shown.
        const mangled = (!!lead.phone && !isDialable(lead.phone)) || (!!lead.mobilePhone && !isDialable(lead.mobilePhone));
        if (lead.phone && !isDialable(lead.phone)) lead.phone = "";
        if (lead.mobilePhone && !isDialable(lead.mobilePhone)) lead.mobilePhone = "";
        // Any OTHER phone-shaped column the mapping did not claim. A CSP
        // export carries address1_telephone1 alongside telephone1; it is
        // rarely the only number, but when it is, the row is callable.
        if (!lead.phone) {
          for (const [k, v] of Object.entries(raw)) {
            if (k === ruleSet.fields?.phone || k === ruleSet.fields?.mobilePhone) continue;
            if (!/phone|telephone|mobile|^tel\b/i.test(k)) continue;
            const cand = String(v ?? "").trim();
            if (cand && isDialable(cand)) { lead.phone = cand; break; }
          }
        }
        c.phoneMangled = mangled && !lead.phone && !lead.mobilePhone;
        // Reachability is scored, so the phone the notes may supply has to
        // be known BEFORE scoring — hence the order here.
        if (!lead.phone && c.notesPhone) lead.phone = c.notesPhone;
        const verdict = classifyCsp(c, cspRules, {
          hasPhone: !!(lead.phone || lead.mobilePhone),
          hasEmail: !!lead.email,
        });
        c.score = verdict.score;
        c.breakdown = verdict.breakdown;
        c.factorPoints = verdict.factorPoints;
        c.penaltyPoints = verdict.penaltyPoints;
        csp = c;
        finalBucket = verdict.bucket;
        snippet = tidyNote(verdict.why, "Scanned, nothing further stated");
        // No product line here, by design: a CSP row is an opportunity, and
        // the column that matters is who holds the customer today. See
        // cspPartnerLabel — it is what fills Product Area on the download.
        productLine = null;
        // Company must never be blank: an unnamed lead cannot be called or
        // matched in Apollo. A 44-row subset saved out of Excel had lost the
        // customeridname column entirely and every company exported empty.
        // In order of how much we trust it:
        if (!lead.company) lead.company = accountFallback(raw);
        if (!lead.company) {
          // Any column whose header names a company, even one the identity
          // mapping did not claim.
          for (const [k, v] of Object.entries(raw)) {
            if (!/company|customer|account|organi[sz]ation|^client/i.test(k)) continue;
            if (/id$|guid|number$|phone|email|country|city|state/i.test(k)) continue;
            const cand = String(v ?? "").trim();
            if (cand && !/^(null|n\/a|none)$/i.test(cand)) { lead.company = cand; break; }
          }
        }
        if (!lead.company) lead.company = companyFromNotes(lead.notes);
        if (!lead.company) lead.company = companyDomainFromEmail(lead.email);
      }

      // Duplicate key: the chosen columns if any were picked, otherwise the
      // lead's own identity — contact + company, both required, resolved
      // AFTER the SMC blob has supplied them. The same rule the Main Scanner
      // applies, per Jack: "i dont want it to be possible to dupe." A row
      // missing either half is never merged: an incomplete key is not
      // evidence two rows are the same person.
      const dupKey = ruleSet.dedupeColumns.length
        ? ruleSet.dedupeColumns.map((c) => normalizeKey(String(raw[c] ?? ""))).join("|")
        : identity ?? identityKey(lead);

      const baseKey = identity ?? curationKey(lead, smc?.website) ?? textKey(smc?.rawText || lead.notes);

      // Per Jack: "the data being previewed in the scanner is what's
      // downloaded." So placeholders are cleaned HERE — once, after both
      // branches have finished filling the lead from columns AND from the
      // SMC blob, and after the CSP branch has counted its Excel-mangled
      // phones (that count reads the raw value, so cleaning any earlier
      // would zero it). Cleaning at this single point makes a
      // preview/export divergence impossible by construction rather than
      // by keeping two code paths in step.
      //
      // Real examples from Jack's own exports: a company literally named
      // "Unknown", a surname of "0", an email of "-", "N/A" in a phone
      // column, and an email address sitting in a phone column.
      lead.company = exportText(lead.company);
      lead.contact = exportText(lead.contact);
      lead.title = exportText(lead.title);
      lead.email = exportEmail(lead.email);
      lead.phone = exportPhone(lead.phone);
      lead.mobilePhone = exportPhone(lead.mobilePhone);

      rows.push({
        id: `s2-${Date.now()}-${seq++}`, sourceFile: f.name, row: raw, lead,
        // Namespaced by tab: the same company can legitimately be a keep in
        // CSP Renewals and a reject in SMC, and one decision must never
        // silently apply to the other.
        leadKey: baseKey ? `${ruleSet.mode === "csp" ? "csp:" : ""}${baseKey}` : null,
        bucket: finalBucket, matched, dupKey, snippet, smc, csp, campaign, productLine,
        // A date on the sheet is when the lead was uploaded / created — it
        // wins. The notes' last seller touch is the fallback when the export
        // carries no date column at all (Jack's CSP file has none).
        receivedOn: columnDate ?? csp?.lastTouch ?? smc?.pulledOn ?? null,
      });
    }
  }

  // Duplicate merging: first seen wins, every repeat is itemised rather
  // than vanishing. A row missing any dedupe column is never merged —
  // an incomplete key is not evidence two rows are the same thing.
  const seen = new Map<string, Row2>();
  const duplicateRows: DuplicateRow2[] = [];
  const kept: Row2[] = [];
  for (const r of rows) {
    const complete = r.dupKey !== null && ruleSet.dedupeColumns.every((c) => String(r.row[c] ?? "").trim() !== "");
    if (!complete) { kept.push(r); continue; }
    const prior = seen.get(r.dupKey as string);
    if (prior) {
      prior.duplicateGroupSize = (prior.duplicateGroupSize ?? 1) + 1;
      duplicateRows.push({
        key: r.dupKey as string,
        sourceFile: r.sourceFile,
        mergedIntoSourceFile: prior.sourceFile,
        preview: (ruleSet.dedupeColumns.length ? ruleSet.dedupeColumns.map((c) => String(r.row[c] ?? "")) : [r.lead.contact, r.lead.company]).filter(Boolean).join(" · "),
      });
      continue;
    }
    seen.set(r.dupKey as string, r);
    kept.push(r);
  }

  // A company often appears more than once in one export: a Cloud Ascent
  // propensity pull that names nobody, plus a separate campaign row that
  // carries the full contact block. Each row is read on its own, so the
  // contactless one used to download blank — 70 of one real 99-row view.
  // Donors come from EVERY row read (including ones merged as duplicates),
  // so a contact is never lost just because its row deduped away.
  backfillContacts(rows, kept);

  const anyColumnDate = receivedCols.length > 0 && kept.some((r) => receivedFromColumns(r.row, receivedCols));
  const dateSource: Scan2Result["dateSource"] = anyColumnDate
    ? { kind: "column", column: receivedCols.find((c) => kept.some((r) => receivedFromColumns(r.row, [c]))) ?? receivedCols[0] }
    : kept.some((r) => r.receivedOn) ? { kind: "notes" } : { kind: "none" };

  return { rows: kept, dateSource, rowsRead, duplicatesMerged: duplicateRows.length, duplicateRows, columns };
}

/** The person a row actually exports, resolved the same way toApolloRow
 *  resolves it — blob contact first, then the mapped CSV columns. */
function exportedPerson(r: Row2): { name: string; title: string; email: string; phone: string; mobile: string } {
  const c0 = r.smc ? bestContact(r.smc) : undefined;
  const fromBlob = `${c0?.firstName || ""} ${c0?.lastName || ""}`.trim();
  return {
    name: fromBlob || (r.lead.contact || "").trim(),
    title: c0?.title || r.lead.title || "",
    email: c0?.email || r.lead.email || "",
    phone: r.lead.phone || c0?.phone || "",
    mobile: r.lead.mobilePhone || "",
  };
}

interface Donor { name: string; title: string; email: string; phone: string; mobile: string; score: number }
const donorScore = (d: Omit<Donor, "score">): number =>
  (d.name ? 4 : 0) + (d.email ? 3 : 0) + (d.phone ? 2 : 0) + (d.title ? 1 : 0);

/**
 * Give a row that names nobody the contact from a sibling row for the same
 * account. Deliberately all-or-nothing on the PERSON: a row that already
 * names someone is never touched, because filling one person's blank email
 * from a different person at the same company is the data-mixing bug this
 * scanner has already been bitten by once. Customer TPID matches first
 * (Microsoft's own account id, exact), company name second.
 */
function backfillContacts(all: Row2[], kept: Row2[]): void {
  const byTpid = new Map<string, Donor>();
  const byCompany = new Map<string, Donor>();
  for (const r of all) {
    const p = exportedPerson(r);
    if (!p.name && !p.email) continue;
    const d: Donor = { name: p.name, title: p.title, email: p.email, phone: p.phone, mobile: p.mobile, score: 0 };
    d.score = donorScore(d);
    const t = r.smc?.tpids?.[0];
    if (t) { const prior = byTpid.get(t); if (!prior || d.score > prior.score) byTpid.set(t, d); }
    const co = normalizeKey(r.smc?.company || r.lead.company || "");
    if (co) { const prior = byCompany.get(co); if (!prior || d.score > prior.score) byCompany.set(co, d); }
  }

  for (const r of kept) {
    const p = exportedPerson(r);
    if (p.name || p.email) continue;
    const t = r.smc?.tpids?.[0];
    const co = normalizeKey(r.smc?.company || r.lead.company || "");
    const viaTpid = t ? byTpid.get(t) : undefined;
    const d = viaTpid || (co ? byCompany.get(co) : undefined);
    if (!d) continue;
    // Adopt the person as a unit so name, title, email and number always
    // belong to the same human.
    r.lead.contact = d.name;
    r.lead.title = d.title || r.lead.title;
    r.lead.email = d.email;
    r.lead.phone = d.phone || r.lead.phone;
    r.lead.mobilePhone = d.mobile || r.lead.mobilePhone;
    r.contactFrom = viaTpid ? "tpid" : "company";
    r.snippet = `${r.snippet} \u00b7 Contact from another row for this account`;
  }
}

// A column that plausibly says when the lead arrived. Deliberately does
// NOT match a close/expected/due date — that is a forecast, not a receipt.
// Per Jack: "dates is huge for when the lead is uploaded if there's a date
// on the excel sheet." Any column that plausibly says when the row was
// created, received, uploaded or added counts; a close / expected / due
// date does not — that is a forecast, not a receipt.
const RECEIVED_COLUMN_RE = /^(createdon|createdat|createdate|createddate|datecreated|creationdate|receivedon|receiveddate|datereceived|leaddate|leadcreated|leadcreatedon|importdate|dateimported|importedon|uploaddate|uploadedon|dateuploaded|uploaded|dateadded|addedon|added|modifiedon|overriddencreatedon|date|leaddate|lastactivitydate|lastactivity)$/;

/** First parseable date among the received-ish columns, as YYYY-MM-DD. */
function receivedFromColumns(raw: Record<string, unknown>, cols: string[]): string | null {
  for (const c of cols) {
    const v = String(raw[c] ?? "").trim();
    if (!v) continue;
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    // US m/d/y with a two- OR four-digit year — Excel routinely writes
    // "9/8/26", and the notes parser already accepts it; a sheet date must
    // not be stricter than a note date. Rejects an impossible month/day
    // rather than guessing a d/m/y reading.
    const us = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})\b/.exec(v);
    if (us) {
      const m = Number(us[1]), d = Number(us[2]);
      const y = us[3].length === 2 ? 2000 + Number(us[3]) : Number(us[3]);
      if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }
  return null;
}

// Parsing a Cloud Ascent blob is the expensive step (~150µs a row), and
// every rule-knob click rescans the whole upload. The parse depends only
// on the notes text, so cache it per raw row: a rescan then only
// re-classifies. WeakMap-keyed on the row object, so it is released with
// the upload and can never outgrow what is already in memory.
const smcParseCache = new WeakMap<object, { notes: string; lead: SmcLead }>();
function parseSmcCached(raw: Record<string, unknown>, notes: string): SmcLead {
  const hit = smcParseCache.get(raw);
  if (hit && hit.notes === notes) return hit.lead;
  const lead = parseSmcLead(notes);
  smcParseCache.set(raw, { notes, lead });
  return lead;
}

/**
 * One scanned row in the Main Scanner's Apollo import shape.
 *
 * The blob is the better source of identity when it has one — a Cloud
 * Ascent lead states the person and company inside the description — so
 * that wins, with the CSV's own columns as the fallback. "Notes" is this
 * scanner's reason line, which is the same thing the Main Scanner puts
 * there (its matched snippet).
 */
/**
 * Split a single full-name field into first and last.
 *
 * Everything before the final space is the first name, so "Mary Jo van der
 * Berg" keeps its whole surname rather than losing the particles. A
 * one-word name stays entirely in First Name — guessing a surname from
 * nothing would be worse than leaving the column blank.
 */
export function splitName(full: string): { first: string; last: string } {
  const v = String(full ?? "").replace(/\s+/g, " ").trim();
  if (!v) return { first: "", last: "" };
  // "Reyes, Dana" — a comma means the file already stated the order.
  const comma = /^([^,]+),\s*(.+)$/.exec(v);
  if (comma) return { first: comma[2].trim(), last: comma[1].trim() };
  const i = v.lastIndexOf(" ");
  return i < 0 ? { first: v, last: "" } : { first: v.slice(0, i).trim(), last: v.slice(i + 1).trim() };
}

export function toApolloRow(r: Row2, productArea?: string): Scanner2ExportRow {
  const c0 = r.smc ? bestContact(r.smc) : undefined;
  // The SMC blob states first and last separately — use them verbatim
  // rather than re-splitting a joined string. Everything else is split.
  const split = c0?.firstName || c0?.lastName
    ? { first: (c0.firstName || "").trim(), last: (c0.lastName || "").trim() }
    : splitName(r.lead.contact || "");
  // A stated headcount range exports as its upper bound: Apollo wants one
  // number, and the larger end is the one that decides how a lead is sized.
  const smcEmployees = r.smc?.employeesMax ?? r.smc?.employeesMin ?? null;
  return {
    // Every identity field goes through the hygiene helpers above, so no
    // scanner can ship "N/A" as a phone or "-" as an email.
    "First Name": exportText(split.first),
    "Last Name": exportText(split.last),
    Title: exportText(c0?.title || r.lead.title || ""),
    "Company Name": exportText(r.smc?.company || r.lead.company || ""),
    Email: exportEmail(c0?.email || r.lead.email || ""),
    // Fall through to the next candidate when one is junk, rather than
    // letting a junk primary shadow a good fallback.
    "Work Direct Phone": exportPhone(r.lead.phone) || exportPhone(c0?.phone) || exportPhone(r.smc?.mainPhone),
    "Mobile Phone": exportPhone(r.lead.mobilePhone),
    "Number of Employees": r.lead.employees || (smcEmployees != null ? String(smcEmployees) : ""),
    // CSP rows carry no product line by design. The caller passes the
    // lead's effective PRIORITY (score band, or the manual override) so the
    // column is what you split sequences on in Apollo; who holds the
    // customer is already in Notes. Falls back to the partner label so a
    // caller that passes nothing still gets a true value.
    "Product Area": productArea ?? (r.csp ? cspPartnerLabel(r.csp) : (r.productLine || "")),
    Notes: r.snippet,
  };
}

/** The CRM account column's value, used only when nothing else names the
 *  company. Matched on the header rather than the mapping, because the
 *  account column is deliberately never mapped to an identity field. */
const ACCOUNT_COL_RE = /^(account(id)?name|accountid|account)$/i;
function accountFallback(raw: Record<string, unknown>): string {
  for (const [k, v] of Object.entries(raw)) {
    if (!ACCOUNT_COL_RE.test(k.trim())) continue;
    const val = String(v ?? "").trim();
    if (val && !/^null$/i.test(val)) return val;
  }
  return "";
}

/** The invariant the UI shows. Kept here so it is tested at the engine
 *  level rather than asserted in a component. */
export function reconciles(r: Scan2Result): boolean {
  return r.rowsRead === r.rows.length + r.duplicatesMerged;
}

export function bucketCounts(rows: Row2[]): Record<Bucket2, number> {
  const out: Record<Bucket2, number> = { priority: 0, review: 0, excluded: 0, unmatched: 0 };
  for (const r of rows) out[r.bucket]++;
  return out;
}

// ------------------------------------------------------------ persistence

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export function emptyRuleSet(name = "Default rules", kind: ScannerKind = "smc"): RuleSet2 {
  const now = new Date().toISOString();
  return {
    id: newId(), name, scanner: kind, dedupeColumns: [], fields: {}, notesColumns: [],
    campaignColumns: [], mode: kind === "csp" ? "csp" : "smc", smcMinFiscalYear: 25,
    excludedColumns: [], rules: [], createdAt: now, updatedAt: now,
  };
}

export function makeRule(label: string, keywords: string[], bucket: Rule2["bucket"], columns: string[] = []): Rule2 {
  return { id: newId(), label: label.trim() || "Untitled rule", keywords: keywords.map((k) => k.trim()).filter(Boolean), columns, bucket, enabled: true };
}

export async function loadRuleSets(kind: ScannerKind = "smc"): Promise<RuleSet2[]> {
  const all = await dbGetAll<RuleSet2>(STORE_SCANNER2_RULESETS);
  return all.filter((r) => scannerKindOf(r) === kind).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export async function saveRuleSet(rs: RuleSet2): Promise<RuleSet2> {
  const next = { ...rs, updatedAt: new Date().toISOString() };
  await dbPut(STORE_SCANNER2_RULESETS, next);
  return next;
}
export async function deleteRuleSet(id: string): Promise<void> {
  await dbDelete(STORE_SCANNER2_RULESETS, id);
}

/** A past run. Deliberately stores counts and the file names only, NOT
 *  every raw row: Scanner 1's History keeps full row data forever with no
 *  cap, which the capacity audit already flagged as a growing problem.
 *  Not repeating that here. */
export interface Run2 {
  id: string;
  scanner?: ScannerKind;
  at: string;
  fileNames: string[];
  ruleSetName: string;
  rowsRead: number;
  duplicatesMerged: number;
  counts: Record<Bucket2, number>;
}

export async function loadRuns(kind: ScannerKind = "smc"): Promise<Run2[]> {
  const all = await dbGetAll<Run2>(STORE_SCANNER2_RUNS);
  return all.filter((r) => scannerKindOf(r) === kind).sort((a, b) => b.at.localeCompare(a.at));
}
export async function saveRun(r: Run2): Promise<void> { await dbPut(STORE_SCANNER2_RUNS, r); }
export async function deleteRun(id: string): Promise<void> { await dbDelete(STORE_SCANNER2_RUNS, id); }

export function buildRun(files: string[], ruleSetName: string, res: Scan2Result, kind: ScannerKind = "smc"): Run2 {
  return {
    id: newId(), scanner: kind, at: new Date().toISOString(), fileNames: files, ruleSetName,
    rowsRead: res.rowsRead, duplicatesMerged: res.duplicatesMerged, counts: bucketCounts(res.rows),
  };
}
