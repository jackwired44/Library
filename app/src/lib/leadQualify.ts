// The qualification gate that runs BEFORE a lead is stored.
//
// Per Jack: "we need to pull data back in here so we can confirm if it is
// an it related company or microsoft partner or computer business to
// automaticlly exclude it from being stored but other than that i want to
// filter in company employee size if we can to rule out companies under 10
// employees so before i put it into apollo the leads are already qualified".
//
// WHY THIS IS A SEPARATE PASS, not a rule inside an engine: the two facts
// it decides on — industry and headcount — live on a CompanyProfile, which
// none of the three scanners can see and which may not exist at all when a
// row is scanned. Same reasoning and the same shape as applyCompetitorDQ
// (lib/companyProfiles.ts), which this deliberately mirrors.
//
// WHAT IS DIFFERENT, and it is the whole point: applyCompetitorDQ marks a
// row disqualified and the row STAYS, visible and reversible, merely out of
// the downloads. This gate DISCARDS — the lead is never written to the
// store at all. That is Jack's explicit choice, made against the
// recommendation to keep an auditable copy:
//
//   Q: "Thrown away outright, or stored but hidden?"  A: "Discard at store time"
//
// So the only visibility that survives is the transient report this
// function returns. Callers MUST show it — naming the companies, not just
// a count — because once the upload screen is gone there is no record of
// what was cut. A silent discard here is data loss with no trace.
import {
  isCompetitorIndustry, isCompetitorName, COMPETITOR_DQ_LABEL,
} from "./detection";
import {
  employeeCountOf, normalizeCompanyKey, profileForCompany, type CompanyProfile,
} from "./companyProfiles";
import type { LeadInput, StoredLead } from "./leadStore";

/** Under this many confirmed employees, a company is not worth a sequence.
 *  Per Jack: "rule out companies under 10 employees". Strictly under — a
 *  company of exactly 10 is kept. */
export const MIN_EMPLOYEES = 10;

export const TOO_SMALL_LABEL = "Under 10 employees";
export const SIZE_UNKNOWN_LABEL = "Company size unknown";

export type DiscardReason = typeof COMPETITOR_DQ_LABEL | typeof TOO_SMALL_LABEL;

export interface DiscardedLead {
  company: string;
  contact: string;
  reason: DiscardReason;
  /** What specifically decided it — the matched industry, or the count.
   *  Shown next to the name so a wrong cut is recognisable on sight. */
  detail: string;
}

export interface QualifyOutcome {
  kept: LeadInput[];
  discarded: DiscardedLead[];
  /** Kept leads whose company has no headcount on file. Per Jack these are
   *  NOT cut — "keep it flag as unknown" — but he wants them confirmable,
   *  so they are counted and the company names collected for the Company
   *  Overview export. Distinct company names, not lead count. */
  sizeUnknown: string[];
}

/**
 * Decide one company, given whatever profile we hold for it.
 *
 * Returns the discard reason, or null to keep. Order matters: the IT check
 * runs first because it is the one Jack called out as automatic, and
 * because an IT company under 10 people should read as an IT company
 * rather than as a small one.
 */
export function discardReasonFor(
  company: string,
  email: string,
  profiles: CompanyProfile[],
): { reason: DiscardReason; detail: string } | null {
  const name = String(company || "").trim();
  if (!name) return null; // nothing to judge — the store's own key check handles it

  // 1. IT / MSP / Microsoft partner / computer business.
  //
  // Two signals, both already built and already measured (see
  // COMPETITOR_DQ_LABEL in detection.ts): the enriched INDUSTRY, matched
  // whole against Apollo's fixed vocabulary, and the company NAME, matched
  // against a deliberately narrow phrase list that was verified not to fire
  // on "Acme Technologies", "Vertex Health Systems" or "Baker Solutions".
  const profile = profileForCompany(profiles, normalizeCompanyKey(name), [String(email || "")]);
  if (profile && isCompetitorIndustry(profile.industry)) {
    return { reason: COMPETITOR_DQ_LABEL, detail: profile.industry };
  }
  if (isCompetitorName(name)) {
    return { reason: COMPETITOR_DQ_LABEL, detail: "company name" };
  }

  // 2. Headcount, but ONLY when it is confirmed.
  //
  // employeeCountOf returns null rather than 0 for a company with no
  // headcount on file, precisely so an unknown can never fall into the
  // "under 10" bucket by accident. Per Jack an unknown is kept and flagged,
  // never cut.
  const n = employeeCountOf(profile);
  if (n !== null && n < MIN_EMPLOYEES) {
    return { reason: TOO_SMALL_LABEL, detail: `${n} employee${n === 1 ? "" : "s"}` };
  }

  return null;
}

/** True when we hold no confirmed headcount for this company. */
export function sizeIsUnknown(company: string, email: string, profiles: CompanyProfile[]): boolean {
  const name = String(company || "").trim();
  if (!name) return false;
  const profile = profileForCompany(profiles, normalizeCompanyKey(name), [String(email || "")]);
  return employeeCountOf(profile) === null;
}

/**
 * Run the gate over a batch on its way into the store.
 *
 * Decided ONCE PER COMPANY and cached, not per lead: a 9,265-row upload
 * carries roughly a tenth as many distinct companies, and profileForCompany
 * walks the profile list on every call. Without the cache this is the one
 * place a 25k upload would feel slow.
 */
export function qualifyLeadInputs(
  inputs: LeadInput[],
  profiles: CompanyProfile[],
): QualifyOutcome {
  const kept: LeadInput[] = [];
  const discarded: DiscardedLead[] = [];
  const unknown = new Set<string>();
  const verdicts = new Map<string, { reason: DiscardReason; detail: string } | null>();
  const unknownSeen = new Map<string, boolean>();

  for (const input of inputs) {
    const company = String(input.company || "").trim();
    const ck = normalizeCompanyKey(company);

    let verdict = verdicts.get(ck);
    if (verdict === undefined) {
      verdict = discardReasonFor(company, input.email, profiles);
      verdicts.set(ck, verdict);
    }

    if (verdict) {
      discarded.push({
        company,
        contact: String(input.contact || ""),
        reason: verdict.reason,
        detail: verdict.detail,
      });
      continue;
    }

    let isUnknown = unknownSeen.get(ck);
    if (isUnknown === undefined) {
      isUnknown = sizeIsUnknown(company, input.email, profiles);
      unknownSeen.set(ck, isUnknown);
    }
    if (isUnknown && company) unknown.add(company);

    kept.push(input);
  }

  return { kept, discarded, sizeUnknown: [...unknown] };
}

/**
 * The same gate re-applied to leads ALREADY in the store, after an
 * enrichment run has taught us new industries and headcounts.
 *
 * This is the half that makes the gate actually work. A lead whose company
 * had no profile when it was scanned passes the gate at store time; the
 * profile arrives later and says "Information Technology & Services". Per
 * Jack's rule that an IT company is excluded "automatically", that lead has
 * to go then — otherwise the gate only ever catches the companies that
 * happened to be enriched first, which is most of them missed.
 *
 * Returns the leads to KEEP and the ones to delete, so the caller can write
 * both the state and the store in one pass and report what went.
 */
export function requalifyStoredLeads(
  leads: StoredLead[],
  profiles: CompanyProfile[],
): { kept: StoredLead[]; discarded: (DiscardedLead & { key: string })[] } {
  if (!profiles.length) return { kept: leads, discarded: [] };
  const kept: StoredLead[] = [];
  const discarded: (DiscardedLead & { key: string })[] = [];
  const verdicts = new Map<string, { reason: DiscardReason; detail: string } | null>();

  for (const lead of leads) {
    const company = String(lead.company || "").trim();
    const ck = normalizeCompanyKey(company);
    let verdict = verdicts.get(ck);
    if (verdict === undefined) {
      verdict = discardReasonFor(company, lead.email, profiles);
      verdicts.set(ck, verdict);
    }
    if (verdict) {
      discarded.push({ key: lead.key, company, contact: lead.contact, reason: verdict.reason, detail: verdict.detail });
    } else {
      kept.push(lead);
    }
  }
  return { kept, discarded };
}

/** Group a discard list by reason, for a one-line report. */
export function summarizeDiscards(discarded: DiscardedLead[]): { reason: string; count: number; companies: string[] }[] {
  const by = new Map<string, { count: number; companies: Set<string> }>();
  for (const d of discarded) {
    let e = by.get(d.reason);
    if (!e) { e = { count: 0, companies: new Set() }; by.set(d.reason, e); }
    e.count++;
    if (d.company) e.companies.add(d.company);
  }
  return [...by.entries()].map(([reason, e]) => ({
    reason,
    count: e.count,
    companies: [...e.companies].sort(),
  }));
}
