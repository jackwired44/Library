// Company profiles — the "known info" layer for Companies, fed by a bulk
// Apollo export. Per Jack: "get ready to enrich data coming from apollo
// in a large dump process to build out companies and known info."
//
// HOW THIS WORKS, and what it deliberately is NOT:
// - It is a CSV IMPORT of an Apollo export (companies export or people
//   export — both carry company columns), not a live Apollo API call. A
//   large dump is exactly the case where a file beats per-row API credits,
//   and it keeps the "explicit, selection-driven, nothing in the
//   background" rule Jack set for every Apollo touchpoint (see CLAUDE.md).
// - Column names are matched by candidate list against Apollo's standard
//   export headers ("Company", "# Employees", "Industry", "Company City",
//   "Company State", "Company Country", "Company Phone", "Website",
//   "Company Linkedin Url", "Keywords", "Annual Revenue", "Founded Year",
//   "Short Description", "SEO Description", "Technologies", "Apollo
//   Account Id"…) using the same tolerant matcher the Scanner uses for
//   lead CSVs (guessColumn). An export whose headers don't match simply
//   reports which fields went unmapped — nothing is guessed.
// - Profiles are keyed by the SAME normalized company name Companies
//   groups contacts by (lib/companies.ts), with website domain as a
//   secondary match, so a profile lines up with the roll-up it enriches.
// - Merging is additive (fillBlank): a later, sparser import never blanks
//   a field an earlier one filled. Re-importing the same dump is a no-op.
// - The HQ city/state/country feeds the company's time zone (lib/
//   timezones.ts) — the first real location signal this app has had.
import { dbGetAll, dbPut, dbDelete, STORE_COMPANY_PROFILES } from "./db";
import { guessColumn, getEmailDomain, isFreeEmailDomain, isCompetitorIndustry, COMPETITOR_DQ_LABEL, type ResultRow } from "./detection";

export interface CompanyProfile {
  key: string; // normalized company name — same key lib/companies.ts uses
  name: string;
  website: string;
  domain: string; // bare host, e.g. "acme.com" — secondary match key
  industry: string;
  employees: string; // kept as text — Apollo exports "51-200" style ranges as well as numbers
  city: string;
  state: string;
  country: string;
  phone: string;
  linkedinUrl: string;
  keywords: string;
  annualRevenue: string;
  foundedYear: string;
  description: string;
  technologies: string;
  apolloAccountId: string;
  sourceFiles: string[];
  importedAt: string;
  updatedAt: string;
}

export type ProfileField = Exclude<keyof CompanyProfile, "key" | "domain" | "sourceFiles" | "importedAt" | "updatedAt">;

// Candidate header lists — Apollo's own export headers first, then the
// generic spellings a hand-edited sheet might use. Matched via guessColumn
// (exact normalized match, then substring), same as the Scanner.
export const PROFILE_FIELD_DEFS: { key: ProfileField; label: string; candidates: string[] }[] = [
  { key: "name", label: "Company", candidates: ["company", "companyname", "companynameforemails", "organization", "account", "accountname"] },
  { key: "website", label: "Website", candidates: ["website", "websiteurl", "companywebsite", "domain", "url"] },
  { key: "industry", label: "Industry", candidates: ["industry", "companyindustry", "sector"] },
  { key: "employees", label: "# Employees", candidates: ["#employees", "numberofemployees", "employees", "employeecount", "headcount", "companysize", "numemployees", "estimatednumemployees"] },
  { key: "city", label: "Company City", candidates: ["companycity", "city", "hqcity"] },
  { key: "state", label: "Company State", candidates: ["companystate", "state", "hqstate", "stateprovince", "region"] },
  { key: "country", label: "Company Country", candidates: ["companycountry", "country", "hqcountry"] },
  { key: "phone", label: "Company Phone", candidates: ["companyphone", "corporatephone", "hqphone", "mainphone", "phonenumber"] },
  { key: "linkedinUrl", label: "Company Linkedin Url", candidates: ["companylinkedinurl", "linkedinurl", "linkedin", "companylinkedin"] },
  { key: "keywords", label: "Keywords", candidates: ["keywords", "tags"] },
  { key: "annualRevenue", label: "Annual Revenue", candidates: ["annualrevenue", "revenue", "estimatedannualrevenue"] },
  { key: "foundedYear", label: "Founded Year", candidates: ["foundedyear", "founded", "yearfounded"] },
  { key: "description", label: "Short Description", candidates: ["shortdescription", "seodescription", "description", "about", "companydescription"] },
  { key: "technologies", label: "Technologies", candidates: ["technologies", "techstack", "tech"] },
  { key: "apolloAccountId", label: "Apollo Account Id", candidates: ["apolloaccountid", "accountid", "apolloid", "organizationid"] },
];

export function normalizeCompanyKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function domainOf(website: string): string {
  const w = website.trim();
  if (!w) return "";
  try {
    const url = new URL(w.includes("://") ? w : `https://${w}`);
    return url.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return w.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].toLowerCase();
  }
}

export async function loadCompanyProfilesFromDB(): Promise<CompanyProfile[]> {
  return dbGetAll<CompanyProfile>(STORE_COMPANY_PROFILES);
}
export async function persistCompanyProfile(p: CompanyProfile) {
  await dbPut(STORE_COMPANY_PROFILES, p);
}
export async function deleteCompanyProfileFromDB(key: string) {
  await dbDelete(STORE_COMPANY_PROFILES, key);
}

function fillBlank(existing: string, incoming: string): string {
  return existing.trim() ? existing : incoming.trim();
}

export interface ColumnMapping {
  mapped: Partial<Record<ProfileField, string>>;
  unmapped: ProfileField[];
}

// Which export column feeds which profile field, for a preview before
// import. `name` is required — a file with no recognizable company column
// can't be imported at all.
export function mapProfileColumns(fields: string[]): ColumnMapping {
  const mapped: Partial<Record<ProfileField, string>> = {};
  const unmapped: ProfileField[] = [];
  PROFILE_FIELD_DEFS.forEach((def) => {
    const col = guessColumn(fields, def.candidates);
    if (col) mapped[def.key] = col;
    else unmapped.push(def.key);
  });
  return { mapped, unmapped };
}

export interface ImportResult {
  profiles: CompanyProfile[];
  created: number;
  updated: number;
  skippedNoName: number;
  rowsRead: number;
  mapping: ColumnMapping;
}

// Folds one parsed export into the existing profile set. Pure — the caller
// persists whatever comes back and decides what to show.
export function importCompanyRows(
  fileName: string,
  fields: string[],
  rows: Record<string, unknown>[],
  existing: CompanyProfile[]
): ImportResult {
  const mapping = mapProfileColumns(fields);
  const byKey = new Map(existing.map((p) => [p.key, p]));
  const byDomain = new Map(existing.filter((p) => p.domain).map((p) => [p.domain, p]));
  const nowIso = new Date().toISOString();
  let created = 0;
  let updated = 0;
  let skippedNoName = 0;
  const touched = new Set<string>();

  const read = (row: Record<string, unknown>, f: ProfileField): string => {
    const col = mapping.mapped[f];
    if (!col) return "";
    const v = row[col];
    return v == null ? "" : String(v).trim();
  };

  rows.forEach((row) => {
    const name = read(row, "name");
    if (!name) { skippedNoName++; return; }
    const key = normalizeCompanyKey(name);
    const website = read(row, "website");
    const domain = domainOf(website);
    const match = byKey.get(key) || (domain ? byDomain.get(domain) : undefined);
    if (match) {
      const before = JSON.stringify(match);
      match.website = fillBlank(match.website, website);
      match.domain = match.domain || domain;
      match.industry = fillBlank(match.industry, read(row, "industry"));
      match.employees = fillBlank(match.employees, read(row, "employees"));
      match.city = fillBlank(match.city, read(row, "city"));
      match.state = fillBlank(match.state, read(row, "state"));
      match.country = fillBlank(match.country, read(row, "country"));
      match.phone = fillBlank(match.phone, read(row, "phone"));
      match.linkedinUrl = fillBlank(match.linkedinUrl, read(row, "linkedinUrl"));
      match.keywords = fillBlank(match.keywords, read(row, "keywords"));
      match.annualRevenue = fillBlank(match.annualRevenue, read(row, "annualRevenue"));
      match.foundedYear = fillBlank(match.foundedYear, read(row, "foundedYear"));
      match.description = fillBlank(match.description, read(row, "description"));
      match.technologies = fillBlank(match.technologies, read(row, "technologies"));
      match.apolloAccountId = fillBlank(match.apolloAccountId, read(row, "apolloAccountId"));
      if (!match.sourceFiles.includes(fileName)) match.sourceFiles.push(fileName);
      if (JSON.stringify(match) !== before) { match.updatedAt = nowIso; if (!touched.has(match.key)) updated++; }
      touched.add(match.key);
      return;
    }
    const profile: CompanyProfile = {
      key,
      name,
      website,
      domain,
      industry: read(row, "industry"),
      employees: read(row, "employees"),
      city: read(row, "city"),
      state: read(row, "state"),
      country: read(row, "country"),
      phone: read(row, "phone"),
      linkedinUrl: read(row, "linkedinUrl"),
      keywords: read(row, "keywords"),
      annualRevenue: read(row, "annualRevenue"),
      foundedYear: read(row, "foundedYear"),
      description: read(row, "description"),
      technologies: read(row, "technologies"),
      apolloAccountId: read(row, "apolloAccountId"),
      sourceFiles: [fileName],
      importedAt: nowIso,
      updatedAt: nowIso,
    };
    byKey.set(key, profile);
    if (domain) byDomain.set(domain, profile);
    touched.add(key);
    created++;
  });

  return { profiles: Array.from(byKey.values()), created, updated, skippedNoName, rowsRead: rows.length, mapping };
}

// Finds the profile for a Companies roll-up: exact name key first, then
// the domain of any contact's company website / email.
export function profileForCompany(
  profiles: CompanyProfile[],
  companyKey: string,
  contactEmailsOrSites: string[]
): CompanyProfile | null {
  const byName = profiles.find((p) => p.key === companyKey);
  if (byName) return byName;
  for (const s of contactEmailsOrSites) {
    const d = s.includes("@") ? getEmailDomain(s) : domainOf(s);
    if (!d) continue;
    const hit = profiles.find((p) => p.domain && p.domain === d);
    if (hit) return hit;
  }
  return null;
}

// "Chicago, IL, United States" — whatever parts exist.
export function profileLocationLabel(p: CompanyProfile | null | undefined): string {
  if (!p) return "";
  return [p.city, p.state, p.country].filter(Boolean).join(", ");
}


// Folds one live Apollo organization result into the profile set — same
// additive fillBlank rules as a CSV import, keyed by domain first (that's
// what was looked up) then by name. `companyName` is the roll-up name the
// contacts carry, so the profile lines up with lib/companies.ts even when
// Apollo spells the legal name differently.
export function upsertProfileFromApollo(
  existing: CompanyProfile[],
  companyName: string,
  domain: string,
  f: {
    name?: string; website?: string; industry?: string; employees?: string; city?: string; state?: string; country?: string;
    phone?: string; linkedinUrl?: string; keywords?: string; annualRevenue?: string; foundedYear?: string; description?: string; apolloAccountId?: string;
  },
  sourceLabel: string = "Apollo (live enrich)"
): CompanyProfile[] {
  const nowIso = new Date().toISOString();
  const key = normalizeCompanyKey(companyName);
  const idx = existing.findIndex((p) => (domain && p.domain === domain) || p.key === key);
  const base: CompanyProfile = idx >= 0 ? { ...existing[idx] } : {
    key, name: companyName, website: "", domain, industry: "", employees: "", city: "", state: "", country: "", phone: "",
    linkedinUrl: "", keywords: "", annualRevenue: "", foundedYear: "", description: "", technologies: "", apolloAccountId: "",
    sourceFiles: [], importedAt: nowIso, updatedAt: nowIso,
  };
  const fb = (a: string, b?: string) => (a.trim() ? a : (b || "").trim());
  base.website = fb(base.website, f.website);
  base.domain = base.domain || domain || domainOf(base.website);
  base.industry = fb(base.industry, f.industry);
  base.employees = fb(base.employees, f.employees);
  base.city = fb(base.city, f.city);
  base.state = fb(base.state, f.state);
  base.country = fb(base.country, f.country);
  base.phone = fb(base.phone, f.phone);
  base.linkedinUrl = fb(base.linkedinUrl, f.linkedinUrl);
  base.keywords = fb(base.keywords, f.keywords);
  base.annualRevenue = fb(base.annualRevenue, f.annualRevenue);
  base.foundedYear = fb(base.foundedYear, f.foundedYear);
  base.description = fb(base.description, f.description);
  base.apolloAccountId = fb(base.apolloAccountId, f.apolloAccountId);
  if (!base.sourceFiles.includes(sourceLabel)) base.sourceFiles.push(sourceLabel);
  base.updatedAt = nowIso;
  const next = [...existing];
  if (idx >= 0) next[idx] = base; else next.push(base);
  return next;
}

// Companies in a fresh batch of contacts that have NO profile yet, with the
// email domain to look them up by. Free-provider domains are skipped (a
// gmail address says nothing about the employer). This is what the
// upload-time "enrich now?" prompt is built from.
export function companiesNeedingEnrichment(
  contacts: { company: string; email: string }[],
  profiles: CompanyProfile[]
): { companyName: string; domain: string }[] {
  const have = new Set(profiles.map((p) => p.key));
  const haveDomain = new Set(profiles.map((p) => p.domain).filter(Boolean));
  const seen = new Map<string, { companyName: string; domain: string }>();
  contacts.forEach((c) => {
    const name = c.company.trim();
    if (!name) return;
    const key = normalizeCompanyKey(name);
    if (have.has(key) || seen.has(key)) return;
    const domain = getEmailDomain(c.email);
    if (!domain || isFreeEmailDomain(domain) || haveDomain.has(domain)) return;
    seen.set(key, { companyName: name, domain });
  });
  return Array.from(seen.values());
}

/* ------------------------------------------------------------------ */
/* Competitor Auto-DQ by enriched industry                              */
/* ------------------------------------------------------------------ */
// The reliable half of the competitor rule (see lib/detection.ts's
// COMPETITOR_DQ_LABEL for the full reasoning). Detection itself never sees
// company profiles — a profile may not exist when a row is scanned, and
// may only arrive later via Apollo enrichment — so this runs as a separate
// pass, in the same shape and the same position as applyStickyState:
//
//   scanParsedFiles(...) -> applyStickyState(rows, contacts)
//                        -> applyCompetitorDQ(rows, profiles)
//
// and again over the rows on screen after an enrichment run, so newly
// learned industries disqualify immediately rather than at the next scan.
//
// Mutates in place and returns how many rows it newly disqualified, so a
// caller can report "N companies disqualified as IT services" rather than
// changing tiers silently.
export function applyCompetitorDQ(rows: ResultRow[], profiles: CompanyProfile[]): number {
  if (!profiles.length) return 0;
  let changed = 0;
  for (const row of rows) {
    if (row.dqReasons.includes(COMPETITOR_DQ_LABEL)) continue; // already flagged by name
    const f = row.row.__f as { company?: unknown; email?: unknown };
    const company = String(f.company || "").trim();
    if (!company) continue;
    const profile = profileForCompany(profiles, normalizeCompanyKey(company), [String(f.email || "")]);
    if (!profile || !isCompetitorIndustry(profile.industry)) continue;
    row.dqReasons = [...row.dqReasons, COMPETITOR_DQ_LABEL];
    row.tier = "dq";
    changed++;
  }
  return changed;
}

// Which of these companies are competitors by enriched industry — used by
// the Companies view to badge and bulk-remove them.
export function competitorCompanyKeys(profiles: CompanyProfile[]): Set<string> {
  return new Set(profiles.filter((p) => isCompetitorIndustry(p.industry)).map((p) => p.key));
}


// Employee-count buckets. Shared so the Companies filter and the Tasks
// work filter can never disagree about what "51–200" means.
export const SIZE_BUCKETS: { key: string; label: string; test: (n: number) => boolean }[] = [
  { key: "1-10", label: "1–10", test: (n) => n <= 10 },
  { key: "11-50", label: "11–50", test: (n) => n > 10 && n <= 50 },
  { key: "51-200", label: "51–200", test: (n) => n > 50 && n <= 200 },
  { key: "201-1000", label: "201–1,000", test: (n) => n > 200 && n <= 1000 },
  { key: "1000+", label: "1,000+", test: (n) => n > 1000 },
];

// Apollo exports employee counts as either a number or a range string
// ("51-200"). Read the first number in either case; a value with no
// digits at all is genuinely unknown, so it returns null rather than 0 —
// a company with no headcount on file must not fall into the "1–10"
// bucket by accident.
export function employeeCountOf(profile: { employees?: string } | null | undefined): number | null {
  const raw = (profile?.employees || "").replace(/,/g, "");
  const m = raw.match(/\d+/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}
