// Which of our contacts' companies visited wiredcio.com — from Apollo's
// website-visitor data. Per Jack: "pull website vistiors tabb from apollo in
// here with wiredcio domain and try to store it as a tag with companies if
// their company searched us and we have a contact there", then "use the
// website visitor tab in apollo to populate that data and run against our
// contacts and their company".
//
// HOW (rehearsed live in the build session, 2026-10-20):
//   - Apollo has no "list every visiting company" call. Its report is per
//     company: apollo_website_visitors_domain_aggregates {organization_id,
//     domain, from, to} -> visit counts, unique visitors, top pages, or
//     {error: "stats not found"} for a company that never visited.
//   - The organization_id comes free with each contact (contacts_search),
//     so it is stored on the lead by the live Apollo check (apollo.live.
//     orgId). No enrichment, no credits.
//   - wiredcio.com is one of the team's tracked domains. Apollo's tracker
//     last received data on 2026-07-19, so a run today may well find
//     nothing recent; the window reaches back to July 2025.
//
// The SUCCESS payload shape could not be observed (no visits on record in
// the window when this was built), so it is read defensively: any count
// whose key says visit/unique, any list of paths. A shape we cannot read is
// recorded as "visited, details unknown" rather than guessed.
//
// Read-only. Every call goes through getMcp's write guard.
import { getMcp, describeApolloError, requestApolloConsent } from "./apolloEnrich";
import type { StoredLead, WebVisits } from "./leadStore";

export const TRACKED_DOMAIN = "wiredcio.com";
export const VISIT_WINDOW_FROM = "2025-07-01";

type Rec = Record<string, unknown>;
const ymd = (iso: string) => iso.replace(/-/g, "");

/** Read a success payload whatever its exact shape. */
export function readVisitPayload(p: unknown): { visited: boolean; visits?: number; uniqueVisitors?: number; pages?: string[] } {
  if (!p || typeof p !== "object") return { visited: false };
  const r = p as Rec;
  if (typeof r.error === "string" && /not found/i.test(r.error)) return { visited: false };
  let visits: number | undefined, uniqueVisitors: number | undefined;
  const pages: string[] = [];
  const walk = (o: unknown, depth: number) => {
    if (!o || typeof o !== "object" || depth > 4) return;
    if (Array.isArray(o)) {
      for (const x of o) {
        if (typeof x === "string" && /\//.test(x)) pages.push(x);
        else if (x && typeof x === "object") {
          const path = (x as Rec).path ?? (x as Rec).url ?? (x as Rec).page;
          if (typeof path === "string") pages.push(path);
          walk(x, depth + 1);
        }
      }
      return;
    }
    for (const [k, v] of Object.entries(o as Rec)) {
      if (typeof v === "number") {
        if (/unique/i.test(k)) uniqueVisitors = uniqueVisitors ?? v;
        else if (/visit|view/i.test(k)) visits = visits ?? v;
      } else walk(v, depth + 1);
    }
  };
  walk(r, 0);
  const visited = (visits ?? 0) > 0 || (uniqueVisitors ?? 0) > 0 || pages.length > 0 || !("error" in r);
  return { visited, ...(visits !== undefined ? { visits } : {}), ...(uniqueVisitors !== undefined ? { uniqueVisitors } : {}),
    ...(pages.length ? { pages: [...new Set(pages)].slice(0, 5) } : {}) };
}

/** Companies (by Apollo org id) behind these leads that can be checked. */
export function orgIdsOf(leads: StoredLead[]): string[] {
  return [...new Set(leads.map((l) => l.apollo?.live?.orgId || "").filter(Boolean))];
}

export interface VisitProgress { total: number; done: number; visited: number; errors: number; finished: boolean }

/** Check each company once. Returns org id -> result. Stops on abort. */
export async function checkWebVisits(
  orgIds: string[],
  onProgress: (p: VisitProgress) => void,
  signal?: AbortSignal,
  today = new Date().toISOString().slice(0, 10),
): Promise<Map<string, WebVisits>> {
  const mcp = await getMcp();
  if (!mcp) throw new Error("Apollo can only be reached from the published page in Claude, not a downloaded copy.");
  await requestApolloConsent();
  let server = "", tool = "";
  try {
    const { servers } = await mcp.listTools();
    for (const s of servers) {
      if (!s.server.toLowerCase().includes("apollo")) continue;
      const t = s.tools.find((x) => x.name.toLowerCase().endsWith("website_visitors_domain_aggregates"));
      if (t) { server = s.server; tool = t.name; break; }
    }
  } catch (err) { throw new Error(describeApolloError(err)); }
  if (!tool) throw new Error("This page's Apollo access doesn't include the website-visitor report (apollo_website_visitors_domain_aggregates).");
  const out = new Map<string, WebVisits>();
  const p: VisitProgress = { total: orgIds.length, done: 0, visited: 0, errors: 0, finished: false };
  onProgress({ ...p });
  for (const id of orgIds) {
    if (signal?.aborted) break;
    try {
      const res = await mcp.callTool(server, tool, { organization_id: id, domain: TRACKED_DOMAIN, from: ymd(VISIT_WINDOW_FROM), to: ymd(today) }, { cache: false, signal });
      const v = readVisitPayload(res.payload);
      out.set(id, { checkedAt: new Date().toISOString(), domain: TRACKED_DOMAIN, from: VISIT_WINDOW_FROM, to: today, ...v });
      if (v.visited) p.visited++;
    } catch (err) {
      // A "not found" can arrive as a tool error too; that is a clean "no".
      const msg = describeApolloError(err);
      if (/not found/i.test(msg)) out.set(id, { checkedAt: new Date().toISOString(), domain: TRACKED_DOMAIN, from: VISIT_WINDOW_FROM, to: today, visited: false });
      else p.errors++;
    }
    p.done++;
    onProgress({ ...p });
  }
  p.finished = true;
  onProgress({ ...p });
  return out;
}

/** Every lead at a checked company gets that company's result. */
export function applyWebVisits(leads: StoredLead[], byOrg: Map<string, WebVisits>): StoredLead[] {
  const changed: StoredLead[] = [];
  for (const l of leads) {
    const id = l.apollo?.live?.orgId;
    const v = id ? byOrg.get(id) : undefined;
    if (v) changed.push({ ...l, webVisits: v });
  }
  return changed;
}
