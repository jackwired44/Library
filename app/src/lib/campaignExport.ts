// The output end of the funnel: a qualified set of stored leads, written
// as a CSV in the shape Apollo's own importer reads.
//
// Per Jack: "i want to essientally qualifiy a few thousand companies to
// push into apollo email cmapaigns", and "so before i put it into apollo
// the leads are already qualified and i know where they are active in
// apollo."
//
// WHY A FILE AND NOT AN API PUSH. Apollo's connector does expose
// apollo_contacts_bulk_create and apollo_emailer_campaigns_add_contact_ids,
// so pushing straight into a live sequence is technically possible. Every
// Apollo touchpoint in this app so far only ever READS Apollo and writes to
// local data; writing contacts into Jack's live production sequences is a
// materially bigger step and his call to make, not one to take while
// building an export. Flagged in the UI rather than decided here.
//
// The column set deliberately mirrors Apollo's OWN export headers, the same
// convention lib/companyProfiles.ts follows for the import direction, so a
// file written here and a file exported from Apollo line up.
import { toCSV, downloadBlob } from "./csv";
import { employeeCountOf, normalizeCompanyKey, profileForCompany, type CompanyProfile } from "./companyProfiles";
import { newestNote, type StoredLead } from "./leadStore";

export const CAMPAIGN_COLUMNS = [
  "First Name", "Last Name", "Title", "Company", "Email",
  "Work Direct Phone", "Mobile Phone", "Website", "Industry", "# Employees",
  "Product Area", "Lead Tier", "Scanner", "Notes",
] as const;

/**
 * Split a stored name into first and last.
 *
 * The lead store keeps ONE name string because that is what the scanners
 * hand over; Apollo's importer wants them apart. A single-word name gets an
 * empty last name rather than being duplicated into both — a fabricated
 * surname would be worse than a blank one, and Apollo matches on email
 * first anyway.
 */
export function splitName(full: string): { first: string; last: string } {
  const parts = String(full || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "", last: "" };
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

/**
 * One lead as a campaign row, joined against whatever company profile we
 * hold. Industry and headcount are read at export time rather than stored
 * on the lead, so a company enriched after the lead was scanned exports
 * with its current data instead of a stale copy.
 */
export function campaignRow(
  lead: StoredLead,
  profiles: CompanyProfile[],
): Record<string, string> {
  const { first, last } = splitName(lead.contact);
  const profile = profiles.length
    ? profileForCompany(profiles, normalizeCompanyKey(lead.company), [lead.email])
    : null;
  const n = employeeCountOf(profile);
  return {
    "First Name": first,
    "Last Name": last,
    "Title": lead.title || "",
    "Company": lead.company || "",
    "Email": lead.email || "",
    "Work Direct Phone": lead.phone || "",
    "Mobile Phone": lead.mobilePhone || "",
    "Website": profile?.website || "",
    "Industry": profile?.industry || "",
    "# Employees": n === null ? "" : String(n),
    "Product Area": lead.productArea || "",
    "Lead Tier": lead.tier || "",
    "Scanner": lead.source,
    // The newest note only. The full dated timeline can run to 600
    // characters across several uploads, and an Apollo contact note that
    // long is unreadable in their UI — the whole history stays here, where
    // it is actually browsable.
    "Notes": newestNote(lead.notes) || "",
  };
}

/** A filename stating what the file holds and when it was cut. */
export function campaignFileName(label: string, count: number): string {
  const slug = String(label || "leads").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "leads";
  return `apollo-push-${slug}-${count}-${new Date().toISOString().slice(0, 10)}.csv`;
}

export async function downloadCampaignCSV(
  leads: StoredLead[],
  profiles: CompanyProfile[],
  label: string,
): Promise<void> {
  const rows = leads.map((l) => campaignRow(l, profiles));
  await downloadBlob(toCSV(rows, CAMPAIGN_COLUMNS), campaignFileName(label, leads.length));
}

/* ------------------------------------------------------- size filtering */

/** How a lead's company reads on headcount. `unknown` is its own value on
 *  purpose — per Jack it is kept, not cut, so it must be distinguishable
 *  from a confirmed small company rather than lumped in with it. */
export type SizeBand = "unknown" | "under" | "ok";

export function sizeBandOf(
  lead: StoredLead,
  profiles: CompanyProfile[],
  minEmployees: number,
): SizeBand {
  if (!profiles.length) return "unknown";
  const profile = profileForCompany(profiles, normalizeCompanyKey(lead.company), [lead.email]);
  const n = employeeCountOf(profile);
  if (n === null) return "unknown";
  return n < minEmployees ? "under" : "ok";
}

/** Resolved once per lead set, not per filter pass — the same rule the
 *  search haystacks and Apollo state maps in AllLeads already follow. */
export function buildSizeBands(
  leads: StoredLead[],
  profiles: CompanyProfile[],
  minEmployees: number,
): Map<string, SizeBand> {
  const byCompany = new Map<string, SizeBand>();
  const out = new Map<string, SizeBand>();
  for (const l of leads) {
    const ck = normalizeCompanyKey(l.company);
    let band = byCompany.get(ck);
    if (band === undefined) {
      band = sizeBandOf(l, profiles, minEmployees);
      byCompany.set(ck, band);
    }
    out.set(l.key, band);
  }
  return out;
}

/** The distinct company names whose headcount we do not know — the set the
 *  Company Overview Agent export is built from. */
export function companiesWithUnknownSize(
  leads: StoredLead[],
  bands: Map<string, SizeBand>,
): string[] {
  const names = new Set<string>();
  for (const l of leads) {
    if (bands.get(l.key) === "unknown" && l.company) names.add(l.company);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}
