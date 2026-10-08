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
  type NoSignalRow, type ResultRow, type Tier,
} from "./detection";
import { BUCKET2_META, CSP_BUCKET_META, type Row2, type ScannerKind } from "./scanner2";
import type { LeadInput, LeadSource } from "./leadStore";

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
    // The file's own date for this row, when it states one.
    receivedOn: r.receivedOn ? String(r.receivedOn).slice(0, 10) : undefined,
  }));
}

/** The word a no-signal row is filed under. It is not a detection verdict —
 *  such a row never reached detection at all — so it must not borrow one of
 *  the real tier labels and read as if the engine scored it. */
export const NO_SIGNAL_TIER = "No signal";

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
export function leadInputsFromNoSignal(rows: NoSignalRow[]): LeadInput[] {
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
  }));
}
