// Live HubSpot pull — the same Meetings lock that already works from an
// imported CSV (lib/engagements.ts), fed straight from the viewer's own
// HubSpot connector instead.
//
// Per Jack: "can we connect hubspot to make sure to flag or scratch a lead
// off from download or search if they are in deals in hubspot or an active
// client", then "even if it is a lost" — so ANY deal counts, open, won or
// lost. Then, naming a real case (a live deal sitting in Jacks Dynamics
// Sequence): "remove anyone like this, this is an active deal."
//
// It writes into the existing STORE_ENGAGEMENTS as source "hubspot", so the
// Account-manager-only standing, the Meetings column, exportBlocked and the
// red banner on the lead record all work unchanged — this adds a feed, not a
// second concept.
//
// WHAT IT READS, and why companies rather than deals: the lock blocks by
// company on purpose ("once a company is in a deal, nobody there is
// cold-called again"), and a deal record carries no email or web domain to
// match a lead on — its company does. So this pages COMPANY where the
// company has at least one deal OR is a customer, and takes name + domain.
// Measured live 2026-11-24: 202 such companies, and some carry no domain at
// all (SpaceGuard), which is why engagementsFor's company-name fallback
// matters and is not dead code.
//
// NOTHING IS EVER WRITTEN TO HUBSPOT. Same rule the Apollo side follows, and
// enforced the same way: an allowlist, checked before the call leaves the
// page. HubSpot's write tools are named manage_*, import-* and the like, so
// a "looks like a read" regex would not be airtight; an allowlist is.
import type { ClaudeMcpNamespace } from "./claudeRuntime";
import type { Engagement } from "./engagements";
import { normDomain } from "./engagements";

/** The only HubSpot tools this platform may ever call. Anything not on this
 *  list — every manage_*, every import, every send — is refused here. */
export const HUBSPOT_READ_TOOLS = [
  "search_crm_objects",
  "get_crm_objects",
  "get_properties",
  "search_properties",
  "discover_hubspot_schema",
  "get_user_details",
] as const;

export function isHubspotReadOnlyTool(tool: string): boolean {
  const t = tool.toLowerCase().replace(/^hubspot[_-]/, "");
  return (HUBSPOT_READ_TOOLS as readonly string[]).includes(t);
}

function readOnly(mcp: ClaudeMcpNamespace): ClaudeMcpNamespace {
  // Not a Proxy: the live runtime hands back a frozen namespace, and a Proxy
  // may not return a different value for a frozen property. Same shape as
  // apolloEnrich's guard, for the same reason.
  const guarded = Object.create(mcp) as ClaudeMcpNamespace;
  Object.defineProperty(guarded, "callTool", {
    value: (server: string, tool: string, input?: unknown, options?: { cache?: false; signal?: AbortSignal }) => {
      if (/hubspot/i.test(server) && !isHubspotReadOnlyTool(tool)) {
        return Promise.reject({ code: "write_blocked", message: `Blocked: this platform never writes to HubSpot (${tool}).` });
      }
      return mcp.callTool(server, tool, input, options);
    },
  });
  return guarded;
}

export async function getHubspotMcp(): Promise<ClaudeMcpNamespace | null> {
  try {
    if (typeof window === "undefined" || !window.claude?.use) return null;
    const mcp = await window.claude.use("mcp");
    return mcp ? readOnly(mcp) : null;
  } catch {
    return null;
  }
}

/** Ask the viewer to allow HubSpot for this page, inside the click that
 *  started the pull. Never throws: a "no" is read by the call that follows. */
export async function requestHubspotConsent(): Promise<void> {
  try {
    const perms = await window.claude?.use?.("permissions");
    if (!perms) return;
    const st = await perms.state("mcp:HubSpot").catch(() => "unavailable");
    if (st === "granted") return;
    await perms.request(st === "unavailable" ? ["mcp"] : ["mcp:HubSpot"]).catch(() => undefined);
  } catch { /* fall through to the call itself */ }
}

interface HubspotHandle { server: string; searchTool: string }

/** Any connector whose display name contains "hubspot" among what is
 *  ACTUALLY resolvable for this viewer right now, carrying the one tool this
 *  module calls. Resolved at call time rather than hardcoded, same as the
 *  Apollo side: the viewer's own connector naming isn't knowable from a
 *  build session. */
async function findHubspot(mcp: ClaudeMcpNamespace): Promise<HubspotHandle | null> {
  const { servers } = await mcp.listTools();
  for (const s of servers) {
    if (!s.server.toLowerCase().includes("hubspot")) continue;
    const t = s.tools.find((x) => x.name.toLowerCase().includes("search_crm_objects"));
    if (t) return { server: s.server, searchTool: t.name };
  }
  return null;
}

export type HubspotAvailability = "available" | "not-connected" | "unsupported";

export async function checkHubspotAvailability(): Promise<HubspotAvailability> {
  const mcp = await getHubspotMcp();
  if (!mcp) return "unsupported";
  try {
    return (await findHubspot(mcp)) ? "available" : "not-connected";
  } catch {
    return "not-connected";
  }
}

/* ------------------------------------------------------------------ pull */

interface CompanyRow {
  id: number | string;
  properties?: Record<string, string | null | undefined>;
}
interface SearchPayload {
  results?: CompanyRow[];
  total?: number;
  offset?: number;
  urlTemplate?: string;
}

const PAGE = 100;
/** A company's own deals are what block it, so a portal with tens of
 *  thousands of them still stops somewhere rather than paging forever. */
const MAX_PAGES = 40;

/** lifecyclestage -> the words that go in the Meetings column. "customer"
 *  has to read as won, because isWon() is what tells a customer apart from a
 *  live prospect everywhere else in the app. */
function stageLabel(lifecycle: string, deals: number): string {
  const l = (lifecycle || "").toLowerCase();
  if (l === "customer") return "Won (customer)";
  if (l === "opportunity") return deals > 1 ? `Open deal (${deals})` : "Open deal";
  if (l === "evangelist") return "Won (customer)";
  if (l) return `${l.charAt(0).toUpperCase()}${l.slice(1)}${deals ? ` · ${deals} deal${deals === 1 ? "" : "s"}` : ""}`;
  return deals ? `Has a deal${deals > 1 ? ` (${deals})` : ""}` : "In HubSpot";
}

export interface HubspotPull {
  rows: Engagement[];
  /** HubSpot's own match count for the first page, so the UI can say
   *  whether paging stopped early rather than quietly truncating. */
  total: number;
  truncated: boolean;
}

/**
 * Every company that has at least one deal (any stage — open, won or lost,
 * per Jack's "even if it is a lost") or is already a customer.
 *
 * The two conditions are separate filterGroups because HubSpot ORs groups
 * and ANDs the filters inside one: a customer with no deal record still has
 * to come back.
 */
export async function pullHubspotEngagements(onStatus?: (s: string) => void): Promise<HubspotPull> {
  const mcp = await getHubspotMcp();
  if (!mcp) throw { code: "unsupported", message: "HubSpot isn't available in this view." };
  const h = await findHubspot(mcp);
  if (!h) throw { code: "not_connected", message: "HubSpot isn't connected for this page." };

  const rows: Engagement[] = [];
  const seen = new Set<string>();
  let offset = 0;
  let total = 0;
  let truncated = false;

  for (let page = 0; ; page++) {
    if (page >= MAX_PAGES) { truncated = true; break; }
    onStatus?.(`Reading HubSpot companies… ${rows.length}${total ? ` of ${total}` : ""}`);
    const res = await mcp.callTool(h.server, h.searchTool, {
      objectType: "COMPANY",
      limit: PAGE,
      offset,
      properties: ["name", "domain", "lifecyclestage", "num_associated_deals", "createdate"],
      filterGroups: [
        { filters: [{ propertyName: "num_associated_deals", operator: "GT", value: "0" }] },
        { filters: [{ propertyName: "lifecyclestage", operator: "EQ", value: "customer" }] },
      ],
      chatInsights: {
        userIntent: "List companies with deals so leads there are excluded from cold outreach",
        satisfaction: "NEUTRAL",
      },
    });
    const p = (res.payload ?? {}) as SearchPayload;
    const batch = p?.results || [];
    if (page === 0) total = Number(p?.total) || 0;
    const urlTemplate = p?.urlTemplate || "";

    for (const c of batch) {
      const props = c.properties || {};
      const company = String(props.name || "").trim();
      const domain = normDomain(props.domain);
      if (!company && !domain) continue;
      const deals = Number(props.num_associated_deals) || 0;
      const stage = stageLabel(String(props.lifecyclestage || ""), deals);
      const at = String(props.createdate || "").slice(0, 10);
      const id = `hubspot:${domain || company.toLowerCase()}:${stage}:${at}`;
      if (seen.has(id)) continue;
      seen.add(id);
      rows.push({
        id, source: "hubspot", company, domain,
        // A company record carries no single contact address, and the lock
        // matches by domain and name anyway. Left blank rather than guessed.
        email: "", contact: "",
        stage, at,
        url: urlTemplate && c.id ? urlTemplate.replace("{id}", String(c.id)) : "",
      });
    }

    if (batch.length < PAGE) break;
    // HubSpot returns the next cursor; fall back to counting our own paging
    // so a payload without one cannot spin on page 0 forever.
    const next = Number(p?.offset);
    offset = Number.isFinite(next) && next > offset ? next : offset + PAGE;
  }

  onStatus?.(`Read ${rows.length} compan${rows.length === 1 ? "y" : "ies"} from HubSpot.`);
  return { rows, total: total || rows.length, truncated };
}
