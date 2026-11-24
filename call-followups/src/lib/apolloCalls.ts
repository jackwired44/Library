// Network side of Follow-ups: Apollo calls + users through the viewer's
// own Apollo connector, Outlook drafts through the viewer's Microsoft 365
// connector, and the email draft through the `sample` capability. All of
// it runs only on an explicit click — nothing pulls in the background.
//
// Apollo's phone-call search has NO outcome or date filter. The only way
// to get "Info Requested calls in the last 7 days" is to page newest-first
// and stop once a page reaches past the range start, filtering locally.
// Call reads cost 0 Apollo credits.
import { useCapability, describeConnectorError, type ClaudeMcpNamespace, type ClaudeSampleFn } from "./runtime";

const getMcp = () => useCapability<ClaudeMcpNamespace>("mcp");
const describeApolloError = (err: unknown) => describeConnectorError(err, "Apollo");
import type { ApolloCall, CallOutcomeFacet } from "./followups";
import { callTimeMs } from "./followups";

export const MAX_PAGES = 60;
const PER_PAGE_TRY = [100, 50, 25];

export interface ApolloUser {
  id: string;
  name: string;
}

interface ServerHandle {
  server: string;
  tool: string;
}

async function findTool(mcp: ClaudeMcpNamespace, serverHint: RegExp, toolHint: string): Promise<ServerHandle | null> {
  const { servers } = await mcp.listTools();
  for (const s of servers) {
    if (!serverHint.test(s.server)) continue;
    const t = s.tools.find((x) => x.name.toLowerCase().includes(toolHint));
    if (t) return { server: s.server, tool: t.name };
  }
  return null;
}

// Some connectors hand back the JSON as a string; normalize once.
function payloadOf(result: { payload?: unknown }): Record<string, unknown> {
  let p: unknown = result?.payload;
  if (typeof p === "string") {
    try { p = JSON.parse(p); } catch { return {}; }
  }
  return p && typeof p === "object" ? (p as Record<string, unknown>) : {};
}

export class FollowUpError extends Error {}

async function requireMcp(): Promise<ClaudeMcpNamespace> {
  const mcp = await getMcp();
  if (!mcp) throw new FollowUpError("Apollo isn't available in this view. Open the platform from claude.ai to pull calls.");
  return mcp;
}

async function requireApollo(mcp: ClaudeMcpNamespace, toolHint: string): Promise<ServerHandle> {
  let h: ServerHandle | null;
  try {
    h = await findTool(mcp, /apollo/i, toolHint);
  } catch (err) {
    throw new FollowUpError(describeApolloError(err));
  }
  if (!h) throw new FollowUpError("Apollo isn't connected, or this page wasn't granted its call tools. Check claude.ai Settings → Connectors.");
  return h;
}

/* ------------------------------------------------------------------ */
/* Users                                                               */
/* ------------------------------------------------------------------ */

export async function loadApolloUsers(): Promise<{ me: ApolloUser | null; users: ApolloUser[] }> {
  const mcp = await requireMcp();
  let me: ApolloUser | null = null;
  const users: ApolloUser[] = [];
  try {
    const prof = await requireApollo(mcp, "users_api_profile");
    const p = payloadOf(await mcp.callTool(prof.server, prof.tool, {}));
    if (typeof p.id === "string") {
      me = { id: p.id, name: `${p.first_name || ""} ${p.last_name || ""}`.trim() || "Me" };
    }
  } catch {
    // Not fatal: the Owner picker still works without a "Me" default.
  }
  try {
    const search = await requireApollo(mcp, "users_search");
    for (let page = 1; page <= 5; page++) {
      const p = payloadOf(await mcp.callTool(search.server, search.tool, { page, per_page: 50 }));
      const list = Array.isArray(p.users) ? (p.users as Record<string, unknown>[]) : [];
      for (const u of list) {
        if (typeof u.id !== "string" || u.deleted === true) continue;
        users.push({ id: u.id, name: String(u.name || `${u.first_name || ""} ${u.last_name || ""}`).trim() || "Unnamed" });
      }
      const pag = p.pagination as { total_pages?: number } | undefined;
      if (!pag?.total_pages || page >= pag.total_pages) break;
    }
  } catch {
    // Same: the picker falls back to "Me" + "Everyone".
  }
  users.sort((a, b) => a.name.localeCompare(b.name));
  return { me, users };
}

/* ------------------------------------------------------------------ */
/* Calls                                                               */
/* ------------------------------------------------------------------ */

export interface CallPullProgress {
  pages: number;
  scanned: number;
  oldestMs: number | null;
}

export interface CallPullResult {
  calls: ApolloCall[];
  facets: CallOutcomeFacet[];
  pages: number;
  scanned: number;
  reachedStart: boolean;
  hitCap: boolean;
}

// Just the disposition list: one 1-row page, read for its facets. Used to
// fill the Disposition picker before the first pull. 0 credits.
export async function loadOutcomes(): Promise<CallOutcomeFacet[]> {
  const mcp = await requireMcp();
  const h = await requireApollo(mcp, "phone_calls_search");
  try {
    const p = payloadOf(await mcp.callTool(h.server, h.tool, { page: 1, per_page: 1 }));
    const fac = (p.faceting as { phone_call_stats_facets?: CallOutcomeFacet[] } | undefined)?.phone_call_stats_facets;
    return Array.isArray(fac) ? fac.filter((f) => f && f.value && f.value !== "active") : [];
  } catch (err) {
    throw new FollowUpError(describeApolloError(err));
  }
}

export async function pullCallsSince(opts: {
  startMs: number;
  userId: string | null;
  onProgress?: (p: CallPullProgress) => void;
  maxPages?: number;
}): Promise<CallPullResult> {
  const mcp = await requireMcp();
  const h = await requireApollo(mcp, "phone_calls_search");
  const maxPages = opts.maxPages ?? MAX_PAGES;

  const calls: ApolloCall[] = [];
  let facets: CallOutcomeFacet[] = [];
  let perPageIdx = 0;
  let page = 1;
  let pages = 0;
  let reachedStart = false;
  let oldestMs: number | null = null;

  while (pages < maxPages) {
    const input: Record<string, unknown> = {
      page,
      per_page: PER_PAGE_TRY[perPageIdx],
      sort_by_field: "start_time",
      sort_ascending: false,
    };
    if (opts.userId) input.user_id = opts.userId;
    let p: Record<string, unknown>;
    try {
      p = payloadOf(await mcp.callTool(h.server, h.tool, input));
    } catch (err) {
      // A too-large page size is the one failure worth stepping down from,
      // and only on the very first page — after that the size is known good.
      if (page === 1 && perPageIdx < PER_PAGE_TRY.length - 1 && (err as { code?: string })?.code === "tool_error") {
        perPageIdx++;
        continue;
      }
      throw new FollowUpError(describeApolloError(err));
    }
    pages++;
    if (page === 1) {
      const fac = (p.faceting as { phone_call_stats_facets?: CallOutcomeFacet[] } | undefined)?.phone_call_stats_facets;
      facets = Array.isArray(fac) ? fac.filter((f) => f && f.value && f.value !== "active") : [];
    }
    const batch = Array.isArray(p.phone_calls) ? (p.phone_calls as ApolloCall[]) : [];
    calls.push(...batch);
    for (const c of batch) {
      const t = callTimeMs(c);
      if (t && (oldestMs === null || t < oldestMs)) oldestMs = t;
    }
    opts.onProgress?.({ pages, scanned: calls.length, oldestMs });
    if (batch.length === 0) { reachedStart = true; break; }
    if (oldestMs !== null && oldestMs < opts.startMs) { reachedStart = true; break; }
    const pag = p.pagination as { total_pages?: number } | undefined;
    if (pag?.total_pages && page >= pag.total_pages) { reachedStart = true; break; }
    page++;
  }
  return { calls, facets, pages, scanned: calls.length, reachedStart, hitCap: !reachedStart };
}

/* ------------------------------------------------------------------ */
/* Outlook draft — create only, never send                             */
/* ------------------------------------------------------------------ */

export async function outlookAvailable(): Promise<boolean> {
  const mcp = await getMcp();
  if (!mcp) return false;
  try {
    return !!(await findTool(mcp, /microsoft|outlook|m365|office/i, "create_draft"));
  } catch {
    return false;
  }
}

export async function createOutlookDraft(msg: { to: string; subject: string; body: string }): Promise<{ id: string | null; webLink: string | null }> {
  const mcp = await getMcp();
  if (!mcp) throw new FollowUpError("Outlook isn't available in this view. Use Copy instead.");
  let h: ServerHandle | null;
  try {
    h = await findTool(mcp, /microsoft|outlook|m365|office/i, "create_draft");
  } catch (err) {
    throw new FollowUpError(describeConnectorError(err, "Microsoft 365"));
  }
  if (!h) throw new FollowUpError("Microsoft 365 isn't connected to this page. Use Copy, or connect it in claude.ai Settings → Connectors.");
  const input: Record<string, unknown> = { subject: msg.subject, body: msg.body, bodyType: "text" };
  if (msg.to) input.to = [msg.to];
  let p: Record<string, unknown>;
  try {
    p = payloadOf(await mcp.callTool(h.server, h.tool, input));
  } catch (err) {
    throw new FollowUpError(describeConnectorError(err, "Microsoft 365"));
  }
  // The documented response is "the draft's immutable message id and a
  // webLink". Exact key names were not observed (creating a real draft just
  // to learn its shape isn't acceptable), so read the plausible spellings.
  const pick = (...keys: string[]) => {
    for (const k of keys) if (typeof p[k] === "string" && p[k]) return p[k] as string;
    return null;
  };
  const webLink = pick("webLink", "web_link", "weblink", "url");
  return {
    id: pick("id", "messageId", "message_id", "draftId", "draft_id"),
    webLink: webLink && webLink.startsWith("https://") ? webLink : null,
  };
}

/* ------------------------------------------------------------------ */
/* AI draft through `sample`                                           */
/* ------------------------------------------------------------------ */

export async function getSample(): Promise<ClaudeSampleFn | null> {
  return useCapability<ClaudeSampleFn>("sample");
}

export function describeSampleError(err: unknown): string {
  const code = (err as { code?: string })?.code;
  if (code === "not_granted") return "Claude drafting was declined for this page. Using the template instead.";
  if (code === "rate_limited") return "Too many drafts at once. Wait a moment, then try again.";
  const m = (err as { message?: string })?.message;
  return m ? `Draft failed: ${m}` : "Draft failed.";
}
