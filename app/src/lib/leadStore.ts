// Every lead ever scanned, from all three scanners — the Library's source
// of truth.
//
// Per Jack: "we need to make this the source of truth for leads … from raw
// lead to finished lead in this library", and "i will just upload the files
// again then store them going forward fresh library state as theyre
// uploaded".
//
// Deliberately NOT the existing Lead Library (lib/library.ts). That one
// files Strong Signal rows only, from the Main Scanner only, organised into
// up-to-3 files per month — a curated export shelf. This is the flat record
// of everything scanned, every tier, all three scanners, which is a
// different job. Neither replaces the other.
import { STORE_LEADS, dbGetAll, dbBulkPut, dbDelete } from "./db";

/** Which scanner produced the row. The three engines stay separate, so a
 *  lead carries where it came from rather than being normalised into one
 *  shape that would lose each scanner's own vocabulary. */
export type LeadSource = "main" | "smc" | "csp";

export const LEAD_SOURCE_META: Record<LeadSource, { label: string; short: string }> = {
  main: { label: "Main Scanner", short: "Main" },
  smc: { label: "Custom Scanner", short: "Custom" },
  csp: { label: "CSP Scanner", short: "CSP" },
};

/**
 * What Apollo says about this person right now.
 *
 * Written ONLY by a sync, never by a scan, and always replaced wholesale
 * rather than merged — it is a snapshot of live external state, so a
 * re-sync must be able to clear a sequence that ended, not just add new
 * ones. `syncedAt` is what makes staleness visible; a view that shows this
 * without showing its age is lying by omission.
 */
export interface ApolloLeadState {
  syncedAt: string;
  /** Every sequence this contact is in, with where it stands. A contact
   *  can hold several at once — one real contact is `finished` in one
   *  sequence and `active` in another, which a single flag would hide. */
  sequences: { name: string; status: string; step: number | null }[];
  /** Calls are AGGREGATED, not listed. Per Jack: "most people i call 5-20
   *  times each that doesnt matter … but it does for context of how many
   *  per person." 29,026 of 35,513 real calls are No Answer, so a per-call
   *  list is fourteen identical rows per lead carrying no extra meaning. */
  callCount: number;
  /** Outcome name -> how many times, e.g. {"No Answer": 14, "Left Voicemail": 2}. */
  outcomes: Record<string, number>;
  lastOutcome: string;
  lastCallAt: string;
}

export interface StoredLead {
  /** Match key: the email, else first-name + company. See leadKeyOf. */
  key: string;
  source: LeadSource;
  company: string;
  contact: string;
  title: string;
  email: string;
  phone: string;
  mobilePhone: string;
  /** The scanner's own product line / category wording, not normalised. */
  productArea: string;
  /** The scanner's own tier wording — "Strong Signal", "High priority", … */
  tier: string;
  /** The matched snippet / call brief the scanner wrote. */
  notes: string;
  score: number | null;
  firstSeenAt: string;
  lastSeenAt: string;
  sourceFiles: string[];
  timesSeen: number;
  /** Absent until a sync runs. Per Jack, nothing is written here before he
   *  uploads: "dont upload or update those numbers here or what sequence a
   *  lead is assigned to til i upload the files going forward." */
  apollo?: ApolloLeadState;
}

/* ------------------------------------------------------------ match key */

const LEGAL_SUFFIX_RE =
  /\b(inc|llc|l\.?l\.?c|ltd|limited|corp|corporation|co|company|plc|gmbh|sa|sas|bv|pty)\b/g;

/** Company names normalise through the same legal-suffix stripping the
 *  blocklist already uses, so "LCF Systems, Inc." and "LCF SYSTEMS" agree. */
export function normCompany(s: unknown): string {
  return String(s || "")
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .replace(LEGAL_SUFFIX_RE, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function normEmail(s: unknown): string {
  return String(s || "").trim().toLowerCase();
}

/**
 * The identity of a lead, for matching across uploads AND against Apollo.
 *
 * Email first: measured at 99.3% coverage across the real 7,709-row CSP
 * file, and unique.
 *
 * Fallback is FIRST name + company, not full name — measured, not
 * preferred. A real row scanned as `contact: "Josh Lewis"` became
 * `name: "Josh"` in Apollo, with the last name dropped, so a full-name key
 * misses it silently. First-name+company collides on 26 of 7,680 real keys
 * (0.34%), which is the price of matching at all.
 *
 * Returns "" when there is neither an email nor a name+company — such a row
 * cannot be keyed and is not stored, the same rule the Scanner's own
 * duplicate check and Contacts' merge already follow.
 */
export function leadKeyOf(email: unknown, contact: unknown, company: unknown): string {
  const e = normEmail(email);
  if (e.includes("@")) return `e:${e}`;
  const first = String(contact || "").trim().toLowerCase().split(/\s+/)[0] || "";
  const c = normCompany(company);
  if (!first || !c) return "";
  return `n:${first}|${c}`;
}

/* -------------------------------------------------------------- merging */

/** A lead as a scanner hands it over, before it is keyed or merged. */
export type LeadInput = Omit<
  StoredLead,
  "key" | "firstSeenAt" | "lastSeenAt" | "sourceFiles" | "timesSeen" | "apollo"
> & { sourceFile: string };

/** Keep an existing non-empty value; a later, sparser upload must never
 *  blank a field an earlier one filled in. Same rule as Contacts' merge. */
function fillBlank(existing: string, incoming: string): string {
  return String(existing || "").trim() ? existing : incoming;
}

/**
 * Merge freshly scanned leads into what is already stored.
 *
 * Pure — takes the current leads and returns the full next state plus what
 * changed, so the caller decides when to persist and nothing here reaches
 * for IndexedDB mid-merge.
 *
 * Re-scanning the same person UPDATES their scan-derived fields (tier,
 * score, notes, product area) rather than fill-blanking them: a re-upload
 * is a fresh read of that lead by the current rules, and the newer verdict
 * is the right one. Contact details still fill-blank, because a sparser
 * export dropping someone's phone number is not evidence they lost it.
 * `apollo` is never touched here — only a sync writes that.
 */
export function mergeLeads(
  existing: StoredLead[],
  incoming: LeadInput[],
  now = new Date().toISOString(),
): { leads: StoredLead[]; changed: StoredLead[]; added: number; updated: number; skipped: number } {
  const byKey = new Map<string, StoredLead>();
  for (const l of existing) byKey.set(l.key, l);

  const changed = new Map<string, StoredLead>();
  let added = 0, updated = 0, skipped = 0;

  for (const inc of incoming) {
    const key = leadKeyOf(inc.email, inc.contact, inc.company);
    if (!key) { skipped++; continue; }
    const prev = byKey.get(key);
    if (!prev) {
      const lead: StoredLead = {
        key,
        source: inc.source,
        company: inc.company,
        contact: inc.contact,
        title: inc.title,
        email: inc.email,
        phone: inc.phone,
        mobilePhone: inc.mobilePhone,
        productArea: inc.productArea,
        tier: inc.tier,
        notes: inc.notes,
        score: inc.score,
        firstSeenAt: now,
        lastSeenAt: now,
        sourceFiles: inc.sourceFile ? [inc.sourceFile] : [],
        timesSeen: 1,
      };
      byKey.set(key, lead);
      changed.set(key, lead);
      added++;
      continue;
    }
    const lead: StoredLead = {
      ...prev,
      // Contact details: additive.
      company: fillBlank(prev.company, inc.company),
      contact: fillBlank(prev.contact, inc.contact),
      title: fillBlank(prev.title, inc.title),
      email: fillBlank(prev.email, inc.email),
      phone: fillBlank(prev.phone, inc.phone),
      mobilePhone: fillBlank(prev.mobilePhone, inc.mobilePhone),
      // Scan verdict: the newest scan wins.
      source: inc.source,
      productArea: inc.productArea || prev.productArea,
      tier: inc.tier || prev.tier,
      notes: inc.notes || prev.notes,
      score: inc.score ?? prev.score,
      lastSeenAt: now,
      sourceFiles: inc.sourceFile && !prev.sourceFiles.includes(inc.sourceFile)
        ? [...prev.sourceFiles, inc.sourceFile]
        : prev.sourceFiles,
      timesSeen: prev.timesSeen + 1,
    };
    byKey.set(key, lead);
    changed.set(key, lead);
    updated++;
  }

  return {
    leads: [...byKey.values()],
    changed: [...changed.values()],
    added, updated, skipped,
  };
}

/* ---------------------------------------------------------- persistence */

export async function loadLeads(): Promise<StoredLead[]> {
  return dbGetAll<StoredLead>(STORE_LEADS);
}

/** One transaction for the whole batch — see dbBulkPut on why per-row
 *  writes are not an option at this volume. */
export async function saveLeads(leads: StoredLead[]): Promise<void> {
  await dbBulkPut(STORE_LEADS, leads);
}

export async function deleteLead(key: string): Promise<void> {
  await dbDelete(STORE_LEADS, key);
}

/* ------------------------------------------------------------- read-side */

/** Index for joining anything else to a lead by the same key space. */
export function buildLeadIndex(leads: StoredLead[]): Map<string, StoredLead> {
  const m = new Map<string, StoredLead>();
  for (const l of leads) m.set(l.key, l);
  return m;
}

/** Does this lead sit in a sequence that is still running? */
export function hasActiveSequence(l: StoredLead): boolean {
  return !!l.apollo?.sequences.some((s) => s.status === "active");
}

/** In Apollo, but every sequence it was in has ended. */
export function hasFinishedSequence(l: StoredLead): boolean {
  const seqs = l.apollo?.sequences ?? [];
  return seqs.length > 0 && !seqs.some((s) => s.status === "active");
}

/**
 * Never actually dialled.
 *
 * Per Jack, this is the point of the whole feature: "then i can filter
 * through leads i may never have contacted yet."
 *
 * Deliberately distinct from "not in Apollo". A lead can be sitting in a
 * sequence and still never have been called — on the real account 29,026
 * of 35,513 calls are No Answer and plenty of enrolled contacts carry none
 * at all. So this reads the call count, not the enrolment.
 *
 * A lead with NO Apollo state at all also counts as never contacted, which
 * is correct but only once a sync has run — before that every lead reads
 * this way, so the view must show the sync age beside it.
 */
export function neverContacted(l: StoredLead): boolean {
  return (l.apollo?.callCount ?? 0) === 0;
}

/** Distinct sequence names present across the whole store, for a filter. */
export function sequenceNamesIn(leads: StoredLead[]): string[] {
  const set = new Set<string>();
  for (const l of leads) for (const s of l.apollo?.sequences ?? []) set.add(s.name);
  return [...set].sort((a, b) => a.localeCompare(b));
}

/** "17 calls · No Answer x14, Voicemail x2" — the per-person context Jack
 *  asked for, without listing seventeen near-identical rows. */
export function outcomeSummary(a: ApolloLeadState | undefined): string {
  if (!a || a.callCount === 0) return "";
  const parts = Object.entries(a.outcomes)
    .sort((x, y) => y[1] - x[1])
    .map(([name, n]) => (n > 1 ? `${name} ×${n}` : name));
  return parts.join(", ");
}
