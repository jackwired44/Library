// Pull the contacts Jack has uploaded into Apollo, so every lead here can
// be checked against them before anything goes back in.
//
// Per Jack: "i want to be able to download strong leads here but confirm
// they are not already in apollo being worked or from the past … make sure
// i am not reuploading leads that have already been uploaded in apollo",
// then, scoping it: "NOT AGAINST THE 137K JUST CSV JACK HAS UPLOADED FOR HIM
// AND CARLY LAST 4 MONTHS".
//
// So the pull walks Apollo's contacts newest-first and keeps only those
// that came in by CSV upload and were uploaded by, or belong to, Jack or
// Carly — stopping at the cutoff date. Measured 2026-10-13: Apollo's newest
// 20,000 contacts reach back to 1 April, so four months is well inside the
// 50,000 a single search can show.
//
// What is kept per contact is small — name, emails, company, sequences,
// upload date — and goes into the Apollo roster (lib/apolloRoster.ts),
// which every scanner and All leads already check against. Read-only: it
// calls Apollo's contact search and sequence list, both free, and writes
// nothing to Apollo. Runs only on a click, with a running count and Stop.
//
// Field names below were observed from real calls in the build session:
// contacts[].{id,name,email,contact_emails[].email,organization_name,
// source,creator_id,owner_id,created_at,contact_campaign_statuses[]},
// contact_campaign_statuses[].{emailer_campaign_id,status,added_at},
// emailer_campaigns[].{id,name}, pagination.total_pages.
import type { ClaudeMcpNamespace } from "./claudeRuntime";
import { getMcp, describeApolloError } from "./apolloEnrich";
import { normEmail } from "./leadStore";
import type { ApolloRosterEntry } from "./apolloRoster";

/** Jack and Carly's Apollo user ids — the two people uploads are made for.
 *  Team configuration, not prospect data. */
export const TEAM_USERS: Record<string, string> = {
  "68bf4ba5f68a0600194acd11": "Jack",
  "6a738903389433001cdab5da": "Carly",
};

export const DEFAULT_PULL_MONTHS = 4;
/** Apollo's own ceiling for one search: 500 pages of 100. */
const MAX_PAGES = 500;

export interface LiveHandle {
  mcp: ClaudeMcpNamespace;
  server: string;
  contactsTool: string;
  sequencesTool: string | null;
}

/** The viewer's Apollo connector, if this page can reach it. */
export async function connectApollo(): Promise<LiveHandle> {
  const mcp = await getMcp();
  if (!mcp) throw new Error("Apollo can only be reached from the published page in Claude, not a downloaded copy.");
  let servers: { server: string; tools: { name: string }[] }[];
  try {
    ({ servers } = await mcp.listTools());
  } catch (err) {
    throw new Error(describeApolloError(err));
  }
  for (const s of servers) {
    if (!s.server.toLowerCase().includes("apollo")) continue;
    const contacts = s.tools.find((t) => t.name.toLowerCase().endsWith("contacts_search"));
    if (!contacts) continue;
    const seqs = s.tools.find((t) => t.name.toLowerCase().endsWith("emailer_campaigns_search"));
    return { mcp, server: s.server, contactsTool: contacts.name, sequencesTool: seqs?.name ?? null };
  }
  throw new Error("Apollo isn't connected for this page — connect it in claude.ai Settings → Connectors, then try again.");
}

type Rec = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");

/** Sequence id -> name. Archived sequences can be missing from the list;
 *  those read "Archived sequence" rather than a raw id. */
export async function loadSequenceNames(h: LiveHandle): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (!h.sequencesTool) return names;
  for (let page = 1; page <= 20; page++) {
    const res = await h.mcp.callTool(h.server, h.sequencesTool, { page: String(page), per_page: "100" }, { cache: false });
    const p = (res.payload ?? {}) as Rec;
    const list = Array.isArray(p.emailer_campaigns) ? (p.emailer_campaigns as Rec[]) : [];
    for (const c of list) if (str(c.id)) names.set(str(c.id), str(c.name) || "Unnamed sequence");
    const pg = (p.pagination ?? {}) as Rec;
    if (!list.length || page >= Number(pg.total_pages || 0)) break;
  }
  return names;
}

/** Sequence labels in the roster's own form: "Name (active)" for live ones. */
export function sequenceLabelsOf(c: Rec, names: Map<string, string>): string[] {
  const list = Array.isArray(c.contact_campaign_statuses) ? (c.contact_campaign_statuses as Rec[]) : [];
  const out = list
    .slice()
    .sort((a, b) => str(b.added_at).localeCompare(str(a.added_at)))
    .map((s) => {
      const name = names.get(str(s.emailer_campaign_id)) || "Archived sequence";
      return str(s.status) === "active" ? `${name} (active)` : name;
    });
  return [...new Set(out)];
}

/** Is this one of the CSV uploads the check is about? */
export function isTeamUpload(c: Rec): boolean {
  const viaCsv = str(c.source) === "csv_import" || str(c.original_source) === "csv_import";
  return viaCsv && (str(c.creator_id) in TEAM_USERS || str(c.owner_id) in TEAM_USERS);
}

/** One Apollo contact as a roster entry, or null if it can't be keyed. */
export function rosterEntryOf(c: Rec, names: Map<string, string>, at: string): ApolloRosterEntry | null {
  const emails = [str(c.email), ...(Array.isArray(c.contact_emails) ? (c.contact_emails as Rec[]).map((e) => str(e.email)) : [])]
    .map(normEmail).filter((e) => e.includes("@"));
  const unique = [...new Set(emails)];
  const name = str(c.name) || `${str(c.first_name)} ${str(c.last_name)}`.trim();
  const n = name.toLowerCase().replace(/[^a-z\s'-]/g, " ").replace(/\s+/g, " ").trim();
  const key = unique[0] ? `e:${unique[0]}` : n.includes(" ") ? `x:${n}` : "";
  if (!key) return null;
  return {
    key, name, email: unique[0] || "",
    company: str(c.organization_name) || str((c.account as Rec | undefined)?.name),
    sequences: sequenceLabelsOf(c, names),
    syncedAt: at,
    ...(unique.length > 1 ? { emails: unique } : {}),
    ...(str(c.created_at) ? { uploadedAt: str(c.created_at).slice(0, 10) } : {}),
  };
}

export interface PullProgress {
  pages: number;
  scanned: number;
  kept: number;
  /** Upload date of the oldest contact read so far — how far back it got. */
  reachedDate: string;
  done: boolean;
  /** True when Apollo's 50,000-contact ceiling stopped it before the cutoff. */
  hitCeiling: boolean;
}

/** The cutoff as a YYYY-MM-DD, `months` back from now. */
export function cutoffFor(months: number, now = new Date()): string {
  const d = new Date(now);
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

/**
 * Walk Apollo's contacts newest-first until the cutoff, handing each page's
 * kept entries to `onEntries` as it goes — so Stop, or a closed tab, keeps
 * everything already read.
 */
export async function pullTeamUploads(opts: {
  months?: number;
  onEntries: (entries: ApolloRosterEntry[]) => Promise<void> | void;
  onProgress: (p: PullProgress) => void;
  signal?: AbortSignal;
}): Promise<PullProgress> {
  const h = await connectApollo();
  const names = await loadSequenceNames(h).catch(() => new Map<string, string>());
  const cutoff = cutoffFor(opts.months ?? DEFAULT_PULL_MONTHS);
  const at = new Date().toISOString();
  const p: PullProgress = { pages: 0, scanned: 0, kept: 0, reachedDate: "", done: false, hitCeiling: false };
  for (let page = 1; page <= MAX_PAGES; page++) {
    if (opts.signal?.aborted) return p;
    let res;
    try {
      res = await h.mcp.callTool(h.server, h.contactsTool,
        { page, per_page: 100, sort_by_field: "contact_created_at", sort_ascending: false },
        { cache: false, signal: opts.signal });
    } catch (err) {
      if (opts.signal?.aborted) return p;
      throw new Error(describeApolloError(err));
    }
    const payload = (res.payload ?? {}) as Rec;
    const list = Array.isArray(payload.contacts) ? (payload.contacts as Rec[]) : [];
    p.pages = page;
    const kept: ApolloRosterEntry[] = [];
    let pastCutoff = false;
    for (const c of list) {
      const created = str(c.created_at).slice(0, 10);
      if (created && created < cutoff) { pastCutoff = true; break; }
      p.scanned++;
      if (created) p.reachedDate = created;
      if (!isTeamUpload(c)) continue;
      const e = rosterEntryOf(c, names, at);
      if (e) kept.push(e);
    }
    if (kept.length) { await opts.onEntries(kept); p.kept += kept.length; }
    const totalPages = Number(((payload.pagination ?? {}) as Rec).total_pages || 0);
    if (pastCutoff || !list.length || (totalPages && page >= totalPages)) {
      p.done = true;
      opts.onProgress({ ...p });
      return p;
    }
    opts.onProgress({ ...p });
  }
  p.hitCeiling = true;
  p.done = true;
  opts.onProgress({ ...p });
  return p;
}
