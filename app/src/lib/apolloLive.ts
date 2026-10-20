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
import { getMcp, describeApolloError, requestApolloConsent } from "./apolloEnrich";
import { normEmail } from "./leadStore";
import type { ApolloRosterEntry } from "./apolloRoster";
import type { ApolloLeadState, ApolloSequenceState, StoredLead } from "./leadStore";

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
  /** Calls and sequence emails, for touchpoint counts. Null when the page's
   *  Apollo grant doesn't list them; the check then reads sequences only. */
  callsTool?: string | null;
  emailsTool?: string | null;
}

/** The viewer's Apollo connector, if this page can reach it. */
export async function connectApollo(): Promise<LiveHandle> {
  const mcp = await getMcp();
  if (!mcp) throw new Error("Apollo can only be reached from the published page in Claude, not a downloaded copy.");
  await requestApolloConsent();
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
    const calls = s.tools.find((t) => t.name.toLowerCase().endsWith("phone_calls_search"));
    const emails = s.tools.find((t) => t.name.toLowerCase().endsWith("emailer_messages_search"));
    return { mcp, server: s.server, contactsTool: contacts.name, sequencesTool: seqs?.name ?? null,
      callsTool: calls?.name ?? null, emailsTool: emails?.name ?? null };
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
export function rosterEntryOf(c: Rec, names: Map<string, string>, at: string, meta?: Map<string, SequenceMeta>): ApolloRosterEntry | null {
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
    // Per Jack: "store date added for leads in terms of the rep and
    // sequence" and "show the step on each" — each sequence's status, step
    // and the day the contact was added to it, when Apollo states them.
    ...(meta && meta.size ? { seqStates: sequencesOf(c, meta) } : {}),
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
  // Sequence meta carries the names AND each sequence's step positions, so
  // the pull can store "step 3 of 5" and the day added for every contact.
  const meta = await loadSequenceMeta(h).catch(() => new Map<string, SequenceMeta>());
  const names = meta.size
    ? new Map([...meta].map(([id, m]) => [id, m.name] as [string, string]))
    : await loadSequenceNames(h).catch(() => new Map<string, string>());
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
      const e = rosterEntryOf(c, names, at, meta);
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

/* ------------------------------------------- per-lead live status check */
//
// Per Jack: "pull in apollo data for any lead here and see if they are in a
// sequence finished or where it [is] … where every lead stands", scoped to
// "the contacts in the all leads here for strong signal only".
//
// One free, read-only contacts search per lead, by email (exact: rehearsed
// live, an email search returns that one contact), else by full name with
// the company required to agree. What comes back is written to the lead's
// own Apollo record, which every view already reads (status, filters, the
// export exclusion). Nothing is written to Apollo.

export interface SequenceMeta { name: string; steps: number; stepPos: Map<string, number> }

/** Sequence id -> name, step count and step positions. Sequence search
 *  carries `emailer_steps`, so "step 3 of 5" needs no extra tool. */
export async function loadSequenceMeta(h: LiveHandle): Promise<Map<string, SequenceMeta>> {
  const out = new Map<string, SequenceMeta>();
  if (!h.sequencesTool) return out;
  for (let page = 1; page <= 20; page++) {
    const res = await h.mcp.callTool(h.server, h.sequencesTool, { page: String(page), per_page: "100" }, { cache: false });
    const p = (res.payload ?? {}) as Rec;
    const list = Array.isArray(p.emailer_campaigns) ? (p.emailer_campaigns as Rec[]) : [];
    for (const c of list) {
      const steps = Array.isArray(c.emailer_steps) ? (c.emailer_steps as Rec[]) : [];
      const stepPos = new Map<string, number>();
      for (const st of steps) if (str(st.id)) stepPos.set(str(st.id), Number(st.position) || 0);
      if (str(c.id)) out.set(str(c.id), { name: str(c.name) || "Unnamed sequence", steps: Number(c.num_steps) || steps.length, stepPos });
    }
    const pg = (p.pagination ?? {}) as Rec;
    if (!list.length || page >= Number(pg.total_pages || 0)) break;
  }
  return out;
}

const day = (v: unknown) => str(v).slice(0, 10);
const normCo = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ")
  .replace(/\b(inc|llc|ltd|corp|corporation|co|company|the|group|holdings)\b/g, " ").replace(/\s+/g, " ").trim();

/** Every sequence on an Apollo contact, in the lead's own record shape. */
export function sequencesOf(c: Rec, meta: Map<string, SequenceMeta>): ApolloSequenceState[] {
  const list = Array.isArray(c.contact_campaign_statuses) ? (c.contact_campaign_statuses as Rec[]) : [];
  return list
    .slice()
    .sort((a, b) => str(b.added_at).localeCompare(str(a.added_at)))
    .map((s) => {
      const m = meta.get(str(s.emailer_campaign_id));
      const pos = Number(s.current_step_position) || m?.stepPos.get(str(s.current_step_id)) || null;
      return {
        name: m?.name || "Archived sequence",
        status: str(s.status) || "unknown",
        step: pos,
        ...(m?.steps ? { steps: m.steps } : {}),
        ...(day(s.added_at) ? { addedAt: day(s.added_at) } : {}),
        ...(day(s.finished_at) ? { finishedAt: day(s.finished_at) } : {}),
        ...(str(s.inactive_reason) ? { reason: str(s.inactive_reason) } : {}),
      };
    });
}

/** Which of the returned contacts is this lead. Email: any address on the
 *  contact. Name: exactly one contact with that full name AND a company
 *  that agrees — two candidates are never guessed between. */
export function pickContact(lead: StoredLead, contacts: Rec[]): Rec | null {
  const e = normEmail(lead.email);
  if (e.includes("@")) {
    return contacts.find((c) => [str(c.email), ...(Array.isArray(c.contact_emails) ? (c.contact_emails as Rec[]).map((x) => str(x.email)) : [])]
      .map(normEmail).includes(e)) ?? null;
  }
  const n = lead.contact.toLowerCase().replace(/\s+/g, " ").trim();
  const co = normCo(lead.company);
  if (!n.includes(" ") || !co) return null;
  const hits = contacts.filter((c) => {
    const cn = (str(c.name) || `${str(c.first_name)} ${str(c.last_name)}`).toLowerCase().replace(/\s+/g, " ").trim();
    const cc = normCo(str(c.organization_name) || str((c.account as Rec | undefined)?.name));
    return cn === n && !!cc && (cc === co || cc.startsWith(co) || co.startsWith(cc));
  });
  return hits.length === 1 ? hits[0] : null;
}

/** The lead's Apollo record from a live contact. Call numbers carry over
 *  from an earlier sync file; with none, they are marked unknown. */
/** Apollo's verdict on ONE address: the matching entry in contact_emails
 *  when there is one (a contact can hold several), else the contact's own
 *  fields. Rehearsed live: email_status "verified", email_domain_catchall
 *  false, email_domain_catchall_verdict "allow". */
export function emailVerdictOf(c: Rec, email: string): { emailStatus?: string; catchAll?: boolean; catchAllVerdict?: string; freeDomain?: boolean } {
  const e = normEmail(email);
  const list = Array.isArray(c.contact_emails) ? (c.contact_emails as Rec[]) : [];
  const hit = (e.includes("@") && list.find((x) => normEmail(str(x.email)) === e)) || (normEmail(str(c.email)) === e ? c : null) || list[0] || c;
  const status = str(hit.email_status) || str(c.email_status);
  const ca = hit.email_domain_catchall ?? c.email_domain_catchall;
  const verdict = str(hit.email_domain_catchall_verdict) || str(c.email_domain_catchall_verdict);
  const free = hit.free_domain ?? c.free_domain;
  return {
    ...(status ? { emailStatus: status } : {}),
    ...(typeof ca === "boolean" ? { catchAll: ca } : {}),
    ...(verdict ? { catchAllVerdict: verdict } : {}),
    ...(typeof free === "boolean" ? { freeDomain: free } : {}),
  };
}

export function apolloStateFrom(c: Rec, meta: Map<string, SequenceMeta>, prev: ApolloLeadState | undefined, at: string, email = ""): ApolloLeadState {
  const owner = TEAM_USERS[str(c.owner_id)] || "";
  return {
    ...(prev ?? { callCount: 0, outcomes: {}, lastOutcome: "", lastCallAt: "", callsUnknown: true }),
    syncedAt: at,
    sequences: sequencesOf(c, meta),
    live: {
      ...(owner ? { owner } : {}),
      ...(day(c.last_activity_date) ? { lastActivityAt: day(c.last_activity_date) } : {}),
      ...(day(c.created_at) ? { uploadedAt: day(c.created_at) } : {}),
      ...emailVerdictOf(c, email || str(c.email)),
    },
  };
}

/* ------------------------------------------------------- touchpoints */
//
// Per Jack: "this platform manages leads and where they stand in apollo so i
// can better manage all the leads and understand how many touch points have
// been made calls or emails". Every Trellus dial is logged into Apollo as a
// call, so Apollo's call log covers both dialers.
//
// Shapes observed from real calls in the build session:
//   phone_calls_search {contact_id} -> phone_calls[].{start_time, caller_name,
//     phone_call_outcome_id, campaign_name, campaign_position},
//     faceting.phone_call_stats_facets[].{value, display_name, count},
//     pagination.total_entries
//   emailer_messages_search {emailer_campaign_id, q_keywords} ->
//     emailer_messages[].{contact_id, status, delivered, opened, replied, bounced}
//     (it cannot filter by contact, so each sequence is searched by name and
//     narrowed to this contact's id).

export interface Touchpoints {
  callCount: number; outcomes: Record<string, number>; lastOutcome: string; lastCallAt: string;
  history: import("./leadStore").CallEvent[];
  emailCount?: number; emailStats?: { sent: number; opened: number; replied: number; bounced: number };
}

const MAX_CALL_PAGES = 5;

export async function readTouchpoints(h: LiveHandle, c: Rec, signal?: AbortSignal): Promise<Touchpoints | null> {
  const id = str(c.id);
  if (!id || !h.callsTool) return null;
  const outcomeName = new Map<string, string>();
  const calls: Rec[] = [];
  let total = 0;
  for (let page = 1; page <= MAX_CALL_PAGES; page++) {
    const res = await h.mcp.callTool(h.server, h.callsTool,
      { contact_id: id, per_page: 100, page, sort_by_field: "start_time", sort_ascending: false }, { cache: false, signal });
    const p = (res.payload ?? {}) as Rec;
    const list = Array.isArray(p.phone_calls) ? (p.phone_calls as Rec[]) : [];
    const facets = Array.isArray((p.faceting as Rec | undefined)?.phone_call_stats_facets) ? ((p.faceting as Rec).phone_call_stats_facets as Rec[]) : [];
    for (const f of facets) if (str(f.value)) outcomeName.set(str(f.value), str(f.display_name).trim());
    // The search can return calls for other contacts if a filter is ignored;
    // only this contact's count.
    calls.push(...list.filter((x) => !str(x.contact_id) || str(x.contact_id) === id));
    total = Number(((p.pagination ?? {}) as Rec).total_entries || 0);
    if (!list.length || calls.length >= total) break;
  }
  const history = calls.map((x) => ({
    at: str(x.start_time).slice(0, 10),
    outcome: outcomeName.get(str(x.phone_call_outcome_id)) || "No disposition",
    ...(str(x.caller_name) ? { by: str(x.caller_name) } : {}),
    ...(str(x.campaign_name) ? { sequence: str(x.campaign_name) } : {}),
    ...(x.campaign_position != null ? { step: Number(x.campaign_position) || null } : {}),
  })).sort((a, b) => b.at.localeCompare(a.at));
  const outcomes: Record<string, number> = {};
  for (const e of history) outcomes[e.outcome] = (outcomes[e.outcome] ?? 0) + 1;
  const out: Touchpoints = {
    callCount: Math.max(total, history.length), outcomes,
    lastOutcome: history[0]?.outcome ?? "", lastCallAt: history[0]?.at ?? "", history,
  };
  if (h.emailsTool) {
    const seqIds = [...new Set((Array.isArray(c.contact_campaign_statuses) ? (c.contact_campaign_statuses as Rec[]) : [])
      .map((x) => str(x.emailer_campaign_id)).filter(Boolean))];
    const name = str(c.name) || `${str(c.first_name)} ${str(c.last_name)}`.trim();
    const stats = { sent: 0, opened: 0, replied: 0, bounced: 0 };
    let read = true;
    for (const sid of seqIds) {
      if (!name) { read = false; break; }
      const res = await h.mcp.callTool(h.server, h.emailsTool,
        { emailer_campaign_id: sid, q_keywords: name, per_page: "50" }, { cache: false, signal });
      const list = Array.isArray((res.payload as Rec | undefined)?.emailer_messages) ? ((res.payload as Rec).emailer_messages as Rec[]) : [];
      for (const m of list) {
        if (str(m.contact_id) !== id) continue;
        if (m.delivered === true || str(m.status) === "completed") stats.sent++;
        if (m.opened === true) stats.opened++;
        if (m.replied === true) stats.replied++;
        if (m.bounced === true) stats.bounced++;
      }
    }
    if (read) { out.emailCount = stats.sent; out.emailStats = stats; }
  }
  return out;
}

/** Apollo allows this many contact searches an hour (measured: the 401st
 *  call in an hour is refused with a rate-limit error). */
export const APOLLO_LOOKUPS_PER_HOUR = 400;
export interface CheckProgress { total: number; done: number; found: number; notFound: number; skipped: number; errors: number; finished: boolean; lastError?: string;
  /** Set when Apollo's hourly limit stopped the run: leads not reached stay unchecked, so the next run picks them up. */
  rateLimitedAt?: string }

const RATE_LIMIT_RE = /rate.?limit|too many requests|\b429\b|per hour|quota/i;
export function isRateLimitError(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  return !!e && (e.code === "rate_limited" || RATE_LIMIT_RE.test(String(e.message ?? err)));
}
export interface CheckResult { key: string; at: string; apollo: ApolloLeadState | null }

/** Look up each lead in Apollo, a few at a time, handing results over in
 *  small batches so Stop keeps everything already read. */
export async function checkLeadsInApollo(opts: {
  leads: StoredLead[];
  onResults: (r: CheckResult[]) => Promise<void> | void;
  onProgress: (p: CheckProgress) => void;
  signal?: AbortSignal;
  concurrency?: number;
}): Promise<CheckProgress> {
  const h = await connectApollo();
  const meta = await loadSequenceMeta(h).catch(() => new Map<string, SequenceMeta>());
  const queue = opts.leads.slice();
  const p: CheckProgress = { total: queue.length, done: 0, found: 0, notFound: 0, skipped: 0, errors: 0, finished: false };
  let batch: CheckResult[] = [];
  const flush = async () => { if (batch.length) { const b = batch; batch = []; await opts.onResults(b); } };

  /** False only when Apollo's hourly cap refused this lead — it stays unchecked. */
  async function one(lead: StoredLead): Promise<boolean> {
    const e = normEmail(lead.email);
    const query = e.includes("@") ? e : lead.contact.trim().split(/\s+/).length >= 2 ? lead.contact.trim() : "";
    if (!query) { p.skipped++; return true; }
    try {
      const res = await h.mcp.callTool(h.server, h.contactsTool, { q_keywords: query, per_page: 10 }, { cache: false, signal: opts.signal });
      const list = Array.isArray((res.payload as Rec | undefined)?.contacts) ? ((res.payload as Rec).contacts as Rec[]) : [];
      const c = pickContact(lead, list);
      const at = new Date().toISOString();
      if (c) {
        p.found++;
        let state = apolloStateFrom(c, meta, lead.apollo, at, lead.email);
        // Touchpoints are a second read; one failing never loses the match.
        try {
          const t = await readTouchpoints(h, c, opts.signal);
          if (t) state = { ...state, ...t, callsUnknown: false };
        } catch (err) {
          if (opts.signal?.aborted) return false;
          if (isRateLimitError(err) && !p.rateLimitedAt) p.rateLimitedAt = new Date().toISOString();
        }
        batch.push({ key: lead.key, at, apollo: state });
      }
      else { p.notFound++; batch.push({ key: lead.key, at, apollo: null }); }
    } catch (err) {
      if (opts.signal?.aborted) return false;
      // Apollo's hourly cap: stop the whole run, write nothing for this lead,
      // and say when to come back. Hammering on would only fail every lead.
      if (isRateLimitError(err)) {
        if (!p.rateLimitedAt) p.rateLimitedAt = new Date().toISOString();
        queue.length = 0;
        return false;
      }
      p.errors++;
      p.lastError = describeApolloError(err);
    }
    return true;
  }

  const workers = Array.from({ length: Math.max(1, opts.concurrency ?? 4) }, async () => {
    while (queue.length && !opts.signal?.aborted) {
      const lead = queue.shift()!;
      if (!(await one(lead))) break;
      p.done++;
      if (batch.length >= 100) await flush();
      opts.onProgress({ ...p });
      // Every call failing means the connector is down; stop rather than
      // grind through thousands of identical errors.
      if (p.errors >= 20 && p.found + p.notFound === 0) { queue.length = 0; }
    }
  });
  await Promise.all(workers);
  await flush();
  p.finished = true;
  opts.onProgress({ ...p });
  return p;
}

/** Fold check results into the stored leads. A lead Apollo didn't have
 *  keeps any earlier sync record — a miss is never allowed to erase one. */
export function applyCheckResults(leads: StoredLead[], results: CheckResult[]): { leads: StoredLead[]; changed: StoredLead[] } {
  const by = new Map(results.map((r) => [r.key, r]));
  const changed: StoredLead[] = [];
  const next = leads.map((l) => {
    const r = by.get(l.key);
    if (!r) return l;
    const u: StoredLead = r.apollo ? { ...l, apollo: r.apollo, apolloCheckedAt: r.at } : { ...l, apolloCheckedAt: r.at };
    changed.push(u);
    return u;
  });
  return { leads: next, changed };
}
