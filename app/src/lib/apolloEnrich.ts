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

async function getMcp(): Promise<ClaudeMcpNamespace | null> {
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
  errorMessage?: string;
}

// mcp.callTool rejects with a plain McpError object ({code, message, ...}),
// never a real Error instance — `err instanceof Error` is always false for
// it, so a naive check discards the runtime's actual, actionable message
// (and code-specific guidance like "reconnect Apollo") in favor of one
// generic string. See the artifact-capabilities skill's mcp.d.ts doctrine:
// branching on `code`/`message`, never collapsing every failure into one
// banner, is the explicit contract here.
function describeApolloError(err: unknown): string {
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
    if (!linkedinUrl) return { contactId: c.id, status: "no-match" as const, title };
    return { contactId: c.id, status: "matched" as const, linkedinUrl, title };
  });
}
