// Real examples of what a sequence's AI email prompts actually produce.
//
// Apollo has no "generate a preview" API — checked. What it does have is
// every email the sequence has already SENT, and those bodies were
// written by the same prompts the step carries. So instead of inventing
// a sample (which would be fiction) or faking a generation (which this
// app has no model to do), the preview pulls real delivered output.
//
// Runs only when the viewer clicks, only inside the published Artifact
// where their own Apollo connector is reachable, and reads nothing but
// the team's own sent mail. These calls consume no Apollo credits.
import type { ClaudeMcpNamespace } from "./claudeRuntime";
import { getMcp, describeApolloError } from "./apolloEnrich";

export interface SentSample {
  id: string;
  subject: string;
  body: string;
  sentAt: string;
  to: string;
}

async function findApolloTools(
  mcp: ClaudeMcpNamespace
): Promise<{ server: string; search: string; content: string } | null> {
  const { servers } = await mcp.listTools();
  for (const s of servers) {
    if (!s.server.toLowerCase().includes("apollo")) continue;
    const search = s.tools.find((t) => t.name.toLowerCase().includes("emailer_messages_search"));
    const content = s.tools.find((t) => t.name.toLowerCase().includes("emailer_messages_get_content"));
    if (search && content) return { server: s.server, search: search.name, content: content.name };
  }
  return null;
}

// Apollo's signature block is appended by the mailbox, not written by the
// prompt, so it is noise when judging a prompt. Cut everything from the
// sender's own name onward, and collapse the padding Apollo leaves behind.
function stripSignature(body: string, senderName?: string): string {
  let text = String(body || "").replace(/\r/g, "");
  const name = (senderName || "").trim();
  if (name) {
    const i = text.indexOf(name);
    if (i > 40) text = text.slice(0, i);
  }
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

export async function fetchSentSamples(
  campaignId: string,
  limit = 3,
  senderName?: string
): Promise<{ samples: SentSample[]; error?: string }> {
  const mcp = await getMcp();
  if (!mcp) {
    return {
      samples: [],
      error: "Apollo isn't reachable from this view. Open the published app with Apollo connected to pull real examples.",
    };
  }
  let handle;
  try {
    handle = await findApolloTools(mcp);
  } catch (err) {
    return { samples: [], error: describeApolloError(err) };
  }
  if (!handle) {
    return { samples: [], error: "Apollo isn't connected — add it in claude.ai Settings → Connectors, then try again." };
  }

  try {
    const listed = await mcp.callTool(handle.server, handle.search, {
      emailer_campaign_id: campaignId,
      emailer_message_stats: ["delivered"],
      per_page: String(Math.min(10, Math.max(1, limit))),
    });
    const payload = listed.payload as Record<string, unknown> | undefined;
    const rows = (payload?.emailer_messages || []) as Record<string, unknown>[];
    const ids = rows.map((r) => String(r.id || "")).filter(Boolean).slice(0, limit);
    if (ids.length === 0) return { samples: [], error: "This sequence hasn't sent anything yet, so there is no real output to show." };

    const got = await mcp.callTool(handle.server, handle.content, { ids, body_format: "plain" });
    const cPayload = got.payload as Record<string, unknown> | undefined;
    const msgs = (cPayload?.emailer_messages || []) as Record<string, unknown>[];
    return {
      samples: msgs.map((m) => ({
        id: String(m.id || ""),
        subject: String(m.subject || ""),
        body: stripSignature(String(m.body || ""), senderName),
        sentAt: String(m.sent_at || ""),
        to: String((Array.isArray(m.recipients) && (m.recipients[0] as Record<string, unknown>)?.email) || ""),
      })),
    };
  } catch (err) {
    return { samples: [], error: describeApolloError(err) };
  }
}
