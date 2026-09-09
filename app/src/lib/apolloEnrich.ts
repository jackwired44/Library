// Live Apollo enrichment — per Jack's explicit approval, this is a real
// network dependency shipped in the product (flagged per CLAUDE.md's
// ask-first rule on that specifically), gated entirely behind the
// VIEWER's own connected Apollo account via the `mcp` runtime capability
// (see artifact-capabilities skill) — nothing here uses any credential
// this app holds itself; there isn't one.
//
// Explicit, visible, viewer-driven only: per Jack, "this should be as i
// select i dont want to have too much going on in the background yet i
// cant see" — there is no automatic/background enrichment anywhere. It
// only ever runs when the viewer selects specific contacts in Contacts.tsx
// and clicks "Enrich via Apollo," and every contact's outcome is shown
// individually (matched / no match / error), never collapsed into one
// silent pass or a generic spinner.
//
// The connector's exact display name isn't knowable from this build
// session (Contacts data — and the Apollo connection itself — lives in
// the viewer's own claude.ai account, not here). findApolloServer()
// resolves it defensively at call time via listTools() rather than
// hardcoding a guessed name — see CLAUDE.md "Contacts: Apollo
// enrichment" for the two candidate names declared in the Artifact
// publish manifest.
import type { Contact } from "./contacts";
import type { ClaudeMcpNamespace } from "./claudeRuntime";

export type ApolloAvailability = "available" | "not-connected" | "unsupported";

export async function getMcp(): Promise<ClaudeMcpNamespace | null> {
  try {
    if (typeof window === "undefined" || !window.claude?.use) return null;
    return await window.claude.use("mcp");
  } catch {
    return null;
  }
}

interface ApolloServerHandle {
  server: string;
  bulkMatchTool: string;
}

// Any connector whose display name contains "apollo" (case-insensitive)
// among what's ACTUALLY resolvable for this viewer right now — the
// intersection of the Artifact's published manifest and the viewer's own
// connected connectors (see mcp.d.ts's listTools doc). Also requires a
// tool whose name contains "bulk_match" (the one this module calls).
async function findApolloServer(mcp: ClaudeMcpNamespace): Promise<ApolloServerHandle | null> {
  const { servers } = await mcp.listTools();
  for (const s of servers) {
    if (!s.server.toLowerCase().includes("apollo")) continue;
    const bulkTool = s.tools.find((t) => t.name.toLowerCase().includes("bulk_match"));
    if (bulkTool) return { server: s.server, bulkMatchTool: bulkTool.name };
  }
  return null;
}

export async function checkApolloAvailability(): Promise<ApolloAvailability> {
  const mcp = await getMcp();
  if (!mcp) return "unsupported";
  try {
    const handle = await findApolloServer(mcp);
    return handle ? "available" : "not-connected";
  } catch {
    return "not-connected";
  }
}

export interface EnrichOutcome {
  contactId: string;
  status: "matched" | "no-match" | "error";
  linkedinUrl?: string;
  title?: string;
  // Company website as Apollo has it (organization.website_url /
  // primary_domain), for cross-referencing against the email-domain
  // derivation this app already does (lib/contacts.ts deriveCompanyWebsite).
  website?: string;
  // Person location, for the time-zone resolver (lib/timezones.ts).
  city?: string;
  state?: string;
  country?: string;
  errorMessage?: string;
}

// mcp.callTool rejects with a plain McpError object ({code, message, ...}),
// never a real Error instance — `err instanceof Error` is always false for
// it, so a naive check discards the runtime's actual, actionable message
// (and code-specific guidance like "reconnect Apollo") in favor of one
// generic string. See the artifact-capabilities skill's mcp.d.ts doctrine:
// branching on `code`/`message`, never collapsing every failure into one
// banner, is the explicit contract here.
export function describeApolloError(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as { code?: string; message?: string };
    if (e.code === "needs_reauth") return "Apollo's connection needs to be reconnected — check claude.ai Settings → Connectors.";
    if (e.code === "server_not_connected" || e.code === "selection_required") return "Apollo isn't connected — add it in claude.ai Settings → Connectors, then try again.";
    if (e.message) return e.message;
  }
  if (err instanceof Error) return err.message;
  return "Apollo call failed.";
}

// Apollo's bulk endpoint caps at 10 people per call — enforced by the
// caller (Contacts.tsx disables the button past 10 selected) rather than
// silently chunking into several background calls, per Jack's explicit
// "as I select... not too much going on in the background."
const MAX_BATCH = 10;

export async function enrichContactsViaApollo(contacts: Contact[]): Promise<EnrichOutcome[]> {
  if (contacts.length === 0) return [];
  if (contacts.length > MAX_BATCH) throw new Error(`Select ${MAX_BATCH} or fewer contacts to enrich at once.`);

  const mcp = await getMcp();
  if (!mcp) throw new Error("Apollo enrichment isn't available in this view.");
  let handle: ApolloServerHandle | null;
  try {
    handle = await findApolloServer(mcp);
  } catch (err) {
    throw new Error(describeApolloError(err));
  }
  if (!handle) throw new Error("Apollo isn't connected — add it in claude.ai Settings → Connectors, then try again.");

  const details = contacts.map((c) => ({
    first_name: c.firstName || undefined,
    last_name: c.lastName || undefined,
    name: !c.firstName && !c.lastName ? c.fullName || undefined : undefined,
    organization_name: c.company || undefined,
    email: c.email || undefined,
  }));

  let result;
  try {
    result = await mcp.callTool(handle.server, handle.bulkMatchTool, { details });
  } catch (err) {
    const message = describeApolloError(err);
    return contacts.map((c) => ({ contactId: c.id, status: "error" as const, errorMessage: message }));
  }

  const payload = result.payload as { matches?: (Record<string, unknown> | null)[] } | undefined;
  const matches = payload?.matches || [];

  return contacts.map((c, i) => {
    const match = matches[i];
    if (!match) return { contactId: c.id, status: "no-match" as const };
    const linkedinUrl = typeof match.linkedin_url === "string" ? match.linkedin_url : undefined;
    const title = typeof match.title === "string" ? match.title : undefined;
    const org = (match.organization && typeof match.organization === "object" ? match.organization : {}) as Record<string, unknown>;
    const website =
      typeof org.website_url === "string" ? org.website_url
      : typeof org.primary_domain === "string" ? `https://${org.primary_domain}`
      : undefined;
    const city = typeof match.city === "string" ? match.city : undefined;
    const state = typeof match.state === "string" ? match.state : undefined;
    const country = typeof match.country === "string" ? match.country : undefined;
    if (!linkedinUrl) return { contactId: c.id, status: "no-match" as const, title, website, city, state, country };
    return { contactId: c.id, status: "matched" as const, linkedinUrl, title, website, city, state, country };
  });
}


// ---------------------------------------------------------------------
// Company enrichment — per Jack: "keep data enriching as new contacts are
// uploaded here if apollo has data on the company." Calls Apollo's
// organization-enrich tool ({domain} → one org) for each NEW company at
// upload time. Apollo's own contract for this tool: exactly 1 credit when
// a company is found, 0 when not, and an explicit confirmation stating the
// total count/credits before any batch — so the caller (Scanner) always
// shows "N companies — up to N credits — enrich now?" and only runs on a
// click, never silently. Every domain's outcome is reported individually.
// Response fields below are the ones observed live earlier in this
// project (industry, estimated_num_employees, city/state/country/
// raw_address, short_description, website_url, linkedin_url, phone when
// present, annual_revenue_printed, founded_year, keywords) — see
// CLAUDE.md "Company enrichment."
// ---------------------------------------------------------------------
export interface CompanyEnrichFields {
  name?: string;
  website?: string;
  industry?: string;
  employees?: string;
  city?: string;
  state?: string;
  country?: string;
  phone?: string;
  linkedinUrl?: string;
  keywords?: string;
  annualRevenue?: string;
  foundedYear?: string;
  description?: string;
  apolloAccountId?: string;
}
export interface CompanyEnrichOutcome {
  domain: string;
  status: "found" | "not-found" | "error";
  fields?: CompanyEnrichFields;
  errorMessage?: string;
}

// Prefers Apollo's BULK organization endpoint (10 domains per call) and
// falls back to the single-domain one. Per Jack: "raise the amount i can
// enrich at once from 25 for company data." The old ceiling was a
// self-imposed guard around a one-call-per-domain loop; chunking the bulk
// endpoint means the same work costs a tenth of the round trips, so the
// per-click ceiling can rise without the run taking minutes.
//
// Credit cost is identical either way: exactly 1 per MATCHED company, 0
// for a miss. Apollo's contract requires the total count and cost to be
// stated and confirmed before any call — the Scanner panel's "Enrich N
// now" button does that, and nothing here runs without it.
async function findApolloOrgTool(
  mcp: ClaudeMcpNamespace
): Promise<{ server: string; tool: string; bulk: boolean } | null> {
  const { servers } = await mcp.listTools();
  for (const s of servers) {
    if (!s.server.toLowerCase().includes("apollo")) continue;
    const bulk = s.tools.find((t) => t.name.toLowerCase().includes("organizations_bulk_enrich"));
    if (bulk) return { server: s.server, tool: bulk.name, bulk: true };
    const single = s.tools.find((t) => t.name.toLowerCase().includes("organizations_enrich"));
    if (single) return { server: s.server, tool: single.name, bulk: false };
  }
  return null;
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : undefined);

function mapOrg(org: Record<string, unknown>): CompanyEnrichFields {
  return {
    name: str(org.name),
    website: str(org.website_url) || (str(org.primary_domain) ? `https://${str(org.primary_domain)}` : undefined),
    industry: str(org.industry),
    employees: str(org.estimated_num_employees),
    city: str(org.city),
    state: str(org.state),
    country: str(org.country),
    phone: str(org.phone) || str(org.sanitized_phone) || str(org.primary_phone && (org.primary_phone as Record<string, unknown>).number),
    linkedinUrl: str(org.linkedin_url),
    keywords: Array.isArray(org.keywords) ? (org.keywords as unknown[]).map(String).join(", ") : str(org.keywords),
    annualRevenue: str(org.annual_revenue_printed) || str(org.annual_revenue),
    foundedYear: str(org.founded_year),
    description: str(org.short_description) || str(org.seo_description),
    apolloAccountId: str(org.id),
  };
}

// Sequential on purpose: each call is a credit decision Jack has already
// confirmed for THIS batch; running them one at a time keeps the outcome
// list readable and means a failure part-way can't fan out.
// Apollo's bulk organization endpoint takes at most 10 domains per call,
// so a run is chunked. The per-click ceiling is the number of companies
// the button will accept at once, not an Apollo limit.
export const APOLLO_BULK_CHUNK = 10;
export const MAX_COMPANY_BATCH = 100;

export async function enrichCompaniesViaApollo(domains: string[]): Promise<CompanyEnrichOutcome[]> {
  const unique = Array.from(new Set(domains.map((d) => d.trim().toLowerCase()).filter(Boolean))).slice(0, MAX_COMPANY_BATCH);
  if (unique.length === 0) return [];
  const mcp = await getMcp();
  if (!mcp) throw new Error("Apollo enrichment isn't available in this view.");
  let handle: { server: string; tool: string; bulk: boolean } | null;
  try {
    handle = await findApolloOrgTool(mcp);
  } catch (err) {
    throw new Error(describeApolloError(err));
  }
  if (!handle) throw new Error("Apollo isn't connected — add it in claude.ai Settings → Connectors, then try again.");

  const out: CompanyEnrichOutcome[] = [];
  const readOrg = (payload: unknown): Record<string, unknown> | null => {
    if (!payload || typeof payload !== "object") return null;
    const p = payload as Record<string, unknown>;
    const org = ("organization" in p ? p.organization : p) as Record<string, unknown> | null | undefined;
    return org && Object.keys(org).length ? org : null;
  };

  if (handle.bulk) {
    for (let i = 0; i < unique.length; i += APOLLO_BULK_CHUNK) {
      const chunk = unique.slice(i, i + APOLLO_BULK_CHUNK);
      try {
        const result = await mcp.callTool(handle.server, handle.tool, { domains: chunk });
        const payload = result.payload as Record<string, unknown> | undefined;
        // Apollo returns the matches parallel to the input array, with a
        // null hole for anything it couldn't match — so read it BY INDEX
        // rather than trying to re-match by name, which would silently
        // attach one company's data to another.
        const orgs = (payload?.organizations || payload?.matches || []) as unknown[];
        chunk.forEach((domain, j) => {
          const org = readOrg(Array.isArray(orgs) ? orgs[j] : null);
          out.push(org ? { domain, status: "found", fields: mapOrg(org) } : { domain, status: "not-found" });
        });
      } catch (err) {
        const message = describeApolloError(err);
        chunk.forEach((domain) => out.push({ domain, status: "error", errorMessage: message }));
      }
    }
    return out;
  }

  // Single-domain fallback: sequential on purpose, so one failure part-way
  // can't fan out and the outcome list stays readable.
  for (const domain of unique) {
    try {
      const result = await mcp.callTool(handle.server, handle.tool, { domain });
      const org = readOrg(result.payload);
      out.push(org ? { domain, status: "found", fields: mapOrg(org) } : { domain, status: "not-found" });
    } catch (err) {
      out.push({ domain, status: "error", errorMessage: describeApolloError(err) });
    }
  }
  return out;
}

