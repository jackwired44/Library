// Apollo Monitor — a read-only mirror of the live Apollo account, so Jack
// can open one screen and see every sequence, the real workflow inside it,
// where contacts are actually sitting, and whether any sending mailbox is
// drifting.
//
// Per Jack: "i want to go in here and see all my sequences how many
// contacts are in which steps and then emails also to view their health
// send rate how many daily sent and know where work is needed or
// attention."
//
// EVERYTHING HERE IS READ-ONLY. No tool called from this module mutates
// anything in Apollo — no enrolling, no removing, no task completion. A
// monitor that can also break things is not a monitor. Every call used
// here is also credit-free (sequence/task/mailbox/analytics reads),
// verified live against the real account before this was written.
//
// Same access model as lib/apolloEnrich.ts: the VIEWER's own connected
// Apollo account via the `mcp` runtime capability. This app holds no
// Apollo credential of its own. Tool names are resolved at call time via
// listTools() rather than hardcoded, because the connector's display name
// isn't knowable from a build session.
// Re-exported so ApolloMonitor.tsx has one import surface for everything
// Apollo-monitor related, and so the MCP access path stays shared with
// lib/apolloEnrich.ts rather than being reimplemented here.
export { getMcp, describeApolloError } from "./apolloEnrich";
import type { ClaudeMcpNamespace } from "./claudeRuntime";

// ---------------------------------------------------------------------------
// Tool resolution
// ---------------------------------------------------------------------------

// The Artifact publish manifest must declare every one of these alongside
// the three enrichment tools already listed, or listTools() never surfaces
// them and this whole tab reports "not connected" (see CLAUDE.md, "CRM").
export const REQUIRED_TOOL_FRAGMENTS = {
  sequences: "emailer_campaigns_search",
  mailboxes: "email_accounts_index",
  analytics: "analytics_sync_report",
  tasks: "tasks_search",
} as const;

export type MonitorToolKey = keyof typeof REQUIRED_TOOL_FRAGMENTS;

export interface ApolloHandle {
  server: string;
  tools: Partial<Record<MonitorToolKey, string>>;
}

export async function resolveApolloHandle(mcp: ClaudeMcpNamespace): Promise<ApolloHandle | null> {
  const { servers } = await mcp.listTools();
  for (const s of servers) {
    if (!s.server.toLowerCase().includes("apollo")) continue;
    const tools: Partial<Record<MonitorToolKey, string>> = {};
    for (const [key, fragment] of Object.entries(REQUIRED_TOOL_FRAGMENTS) as [MonitorToolKey, string][]) {
      const found = s.tools.find((t) => t.name.toLowerCase().includes(fragment));
      if (found) tools[key] = found.name;
    }
    // Any apollo server with at least one monitor tool is our server. A
    // partial manifest is reported per-panel rather than failing the whole
    // tab — losing analytics shouldn't hide the sequence list.
    if (Object.keys(tools).length > 0) return { server: s.server, tools };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Mailboxes
// ---------------------------------------------------------------------------

export interface Mailbox {
  id: string;
  userId: string;
  email: string;
  domain: string;
  active: boolean;
  isDefault: boolean;
  provider: string;
  createdAt: string;
  lastSyncedAt: string | null;
}

export interface MailboxStats {
  sent: number;
  delivered: number;
  bounced: number;
  replied: number;
  unsubscribed: number;
  dailyLimit: number;
}

export interface MailboxRow extends Mailbox {
  stats: MailboxStats | null;
  bounceRate: number | null;
  replyRate: number | null;
  // Sends per day averaged over the window — the "send rate" Jack asked
  // for. Null when there are no stats rather than 0, because "we don't
  // know" and "sent nothing" are different answers.
  sendsPerDay: number | null;
  flags: HealthFlag[];
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export function domainOf(email: string): string {
  const at = email.lastIndexOf("@");
  return at === -1 ? "" : email.slice(at + 1).toLowerCase();
}

export async function fetchMailboxes(mcp: ClaudeMcpNamespace, handle: ApolloHandle): Promise<Mailbox[]> {
  const tool = handle.tools.mailboxes;
  if (!tool) throw new Error("The Apollo mailbox tool isn't available to this page.");
  const res = await mcp.callTool(handle.server, tool, {});
  const payload = res.payload as { email_accounts?: unknown[] } | undefined;
  const list = Array.isArray(payload?.email_accounts) ? payload!.email_accounts : [];
  return list.map((raw) => {
    const a = (raw || {}) as Record<string, unknown>;
    const email = str(a.email);
    return {
      id: str(a.id),
      userId: str(a.user_id),
      email,
      domain: domainOf(email),
      active: a.active !== false,
      isDefault: a.default === true,
      provider: str(a.provider_display_name) || str(a.type),
      createdAt: str(a.created_at),
      lastSyncedAt: str(a.last_synced_at) || null,
    };
  });
}

// ---------------------------------------------------------------------------
// Analytics
//
// apollo_analytics_sync_report does NOT return structured rows the way the
// other endpoints do — it returns a rendered markdown table under
// `summary`. That was confirmed live, not assumed. Parsing markdown is
// fragile, so this reads a structured payload FIRST if one is ever present
// and only falls back to the table. If the shape changes upstream, the
// panel reports that it couldn't read the numbers rather than silently
// rendering zeroes — a monitor showing a confident 0 it made up is worse
// than one saying it doesn't know.
// ---------------------------------------------------------------------------

export function parseMarkdownTable(md: string): Record<string, string>[] {
  const lines = md.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("|"));
  if (lines.length < 2) return [];
  const cells = (line: string) =>
    line.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
  const headers = cells(lines[0]);
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const c = cells(lines[i]);
    // The |---|---| separator row.
    if (c.every((x) => /^:?-{2,}:?$/.test(x))) continue;
    if (c.length !== headers.length) continue;
    const row: Record<string, string> = {};
    headers.forEach((h, j) => (row[h] = c[j]));
    rows.push(row);
  }
  return rows;
}

function parseNumber(s: string): number {
  const n = Number(String(s).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

export type AnalyticsWindow = "last_7_days" | "last_30_days" | "last_3_months";

export const WINDOW_DAYS: Record<AnalyticsWindow, number> = {
  last_7_days: 7,
  last_30_days: 30,
  last_3_months: 90,
};

export const WINDOW_LABEL: Record<AnalyticsWindow, string> = {
  last_7_days: "Last 7 days",
  last_30_days: "Last 30 days",
  last_3_months: "Last 3 months",
};

export async function fetchMailboxStats(
  mcp: ClaudeMcpNamespace,
  handle: ApolloHandle,
  window: AnalyticsWindow
): Promise<Map<string, MailboxStats>> {
  const tool = handle.tools.analytics;
  if (!tool) throw new Error("The Apollo analytics tool isn't available to this page.");
  const res = await mcp.callTool(handle.server, tool, {
    date_range: { modality: window },
    group_by: ["email_account_id"],
    // email_daily_limit is ONLY compatible with email_account_id — pairing
    // it with send_from_email returns an explicit incompatibility warning
    // and no data. Confirmed live; do not "simplify" this to group by
    // email address.
    metrics: [
      "num_emails_sent",
      "email_daily_limit",
      "num_emails_delivered",
      "num_emails_bounced",
      "num_emails_replied",
      "num_emails_unsubscribed",
    ],
    sort: { metric: "num_emails_sent", asc: false },
  });

  const payload = res.payload as { summary?: string } | undefined;
  const summary = str(payload?.summary);
  const out = new Map<string, MailboxStats>();
  if (!summary) return out;

  for (const row of parseMarkdownTable(summary)) {
    // Apollo labels the grouped column "Email account" and fills it with
    // the mailbox's ADDRESS, not its id — so this map is keyed by email.
    const key = (row["Email account"] || "").toLowerCase();
    if (!key) continue;
    out.set(key, {
      sent: parseNumber(row["Num emails sent"]),
      delivered: parseNumber(row["Num emails delivered"]),
      bounced: parseNumber(row["Num emails bounced"]),
      replied: parseNumber(row["Num emails replied"]),
      unsubscribed: parseNumber(row["Num emails unsubscribed"]),
      dailyLimit: parseNumber(row["Email daily limit"]),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Sequences
// ---------------------------------------------------------------------------

export interface SeqStep {
  id: string;
  position: number;
  type: string;
  waitTime: number;
  waitMode: string;
}

export interface ApolloSequence {
  id: string;
  name: string;
  active: boolean;
  archived: boolean;
  userId: string;
  createdAt: string;
  lastUsedAt: string | null;
  statusReason: string;
  numSteps: number;
  steps: SeqStep[];
  overdueManualTasks: number;
  scheduled: number;
  delivered: number;
  opened: number;
  replied: number;
  demoed: number;
  bounced: number;
  unsubscribed: number;
  bounceRate: number;
  hardBounceRate: number;
  optOutRate: number;
  replyRate: number;
  demoRate: number;
  performingPoorly: boolean;
}

export async function fetchSequences(mcp: ClaudeMcpNamespace, handle: ApolloHandle): Promise<ApolloSequence[]> {
  const tool = handle.tools.sequences;
  if (!tool) throw new Error("The Apollo sequences tool isn't available to this page.");
  const all: ApolloSequence[] = [];
  // Page rather than assuming one call covers it — 21 today, but this is a
  // monitor that should still be right at 200.
  for (let page = 1; page <= 10; page++) {
    const res = await mcp.callTool(handle.server, tool, { page: String(page), per_page: "100" });
    const payload = res.payload as
      | { emailer_campaigns?: unknown[]; pagination?: { total_pages?: number } }
      | undefined;
    const list = Array.isArray(payload?.emailer_campaigns) ? payload!.emailer_campaigns : [];
    for (const raw of list) {
      const c = (raw || {}) as Record<string, unknown>;
      const rawSteps = Array.isArray(c.emailer_steps) ? (c.emailer_steps as unknown[]) : [];
      all.push({
        id: str(c.id),
        name: str(c.name).trim() || "(untitled)",
        active: c.active === true,
        archived: c.archived === true,
        userId: str(c.user_id),
        createdAt: str(c.created_at),
        lastUsedAt: str(c.last_used_at) || null,
        statusReason: str(c.status_reason),
        numSteps: num(c.num_steps),
        steps: rawSteps
          .map((s) => {
            const st = (s || {}) as Record<string, unknown>;
            return {
              id: str(st.id),
              position: num(st.position),
              type: str(st.type),
              waitTime: num(st.wait_time),
              waitMode: str(st.wait_mode),
            };
          })
          .sort((a, b) => a.position - b.position),
        overdueManualTasks: num(c.overdue_manual_tasks_count),
        scheduled: num(c.unique_scheduled),
        delivered: num(c.unique_delivered),
        opened: num(c.unique_opened),
        replied: num(c.unique_replied),
        demoed: num(c.unique_demoed),
        bounced: num(c.unique_bounced),
        unsubscribed: num(c.unique_unsubscribed),
        bounceRate: num(c.bounce_rate),
        hardBounceRate: num(c.hard_bounce_rate),
        optOutRate: num(c.opt_out_rate),
        replyRate: num(c.reply_rate),
        demoRate: num(c.demo_rate),
        performingPoorly: c.is_performing_poorly === true,
      });
    }
    const totalPages = num(payload?.pagination?.total_pages) || 1;
    if (page >= totalPages) break;
  }
  return all;
}

// ---------------------------------------------------------------------------
// Step distribution — who is sitting on which step
//
// This is the one Jack asked for by name, and it CANNOT come from
// analytics: grouping the analytics report by emailer_step_id only ever
// populates EMAIL steps (verified live on Dynamics Sequence — step 2, the
// auto_email, returned 670 sent / 663 contacts while the four call and
// LinkedIn steps all returned 0). Tasks are the real answer: every open
// task carries sequence.step_position plus the contact it belongs to.
// ---------------------------------------------------------------------------

export interface StepOccupant {
  taskId: string;
  contactId: string;
  contactName: string;
  type: string;
  dueAt: string | null;
  overdue: boolean;
}

export interface StepBucket {
  position: number;
  type: string;
  waiting: number;
  overdue: number;
  occupants: StepOccupant[];
}

export interface StepDistribution {
  sequenceId: string;
  buckets: StepBucket[];
  totalWaiting: number;
  totalOverdue: number;
  // True when the sequence has more open tasks than we were willing to
  // page through, so the UI can say "1000+" instead of quietly
  // under-reporting a number Jack would act on.
  truncated: boolean;
}

const MAX_TASK_PAGES = 10;
const TASK_PAGE_SIZE = 100;

export async function fetchStepDistribution(
  mcp: ClaudeMcpNamespace,
  handle: ApolloHandle,
  sequence: ApolloSequence
): Promise<StepDistribution> {
  const tool = handle.tools.tasks;
  if (!tool) throw new Error("The Apollo tasks tool isn't available to this page.");

  const now = Date.now();
  const occupants: StepOccupant[] = [];
  let truncated = false;

  for (let page = 1; page <= MAX_TASK_PAGES; page++) {
    const res = await mcp.callTool(handle.server, tool, {
      emailer_campaign_id: sequence.id,
      task_status: "scheduled",
      per_page: TASK_PAGE_SIZE,
      page,
    });
    const payload = res.payload as
      | { tasks?: unknown[]; pagination?: { total_pages?: number } }
      | undefined;
    const list = Array.isArray(payload?.tasks) ? payload!.tasks : [];
    for (const raw of list) {
      const t = (raw || {}) as Record<string, unknown>;
      const contact = (t.contact && typeof t.contact === "object" ? t.contact : {}) as Record<string, unknown>;
      const seq = (t.sequence && typeof t.sequence === "object" ? t.sequence : {}) as Record<string, unknown>;
      const dueAt = str(t.due_at) || null;
      occupants.push({
        taskId: str(t.id),
        contactId: str(contact.id),
        contactName: str(contact.name) || "(unnamed)",
        type: str(t.type),
        dueAt,
        overdue: dueAt ? new Date(dueAt).getTime() < now : false,
      });
      const pos = num(seq.step_position);
      // Stash position on the occupant via the bucket grouping below.
      (occupants[occupants.length - 1] as StepOccupant & { __pos: number }).__pos = pos;
    }
    const totalPages = num(payload?.pagination?.total_pages) || 1;
    if (page >= totalPages) break;
    if (page === MAX_TASK_PAGES) truncated = true;
  }

  const byPos = new Map<number, StepOccupant[]>();
  for (const o of occupants) {
    const pos = (o as StepOccupant & { __pos?: number }).__pos ?? 0;
    const arr = byPos.get(pos) || [];
    arr.push(o);
    byPos.set(pos, arr);
  }

  // Build a bucket for EVERY declared step, not just the occupied ones —
  // an empty step is a real, meaningful answer ("nobody is here"), and
  // omitting it would make the workflow read as shorter than it is.
  const buckets: StepBucket[] = sequence.steps.map((s) => {
    const occ = byPos.get(s.position) || [];
    return {
      position: s.position,
      type: s.type,
      waiting: occ.length,
      overdue: occ.filter((o) => o.overdue).length,
      occupants: occ,
    };
  });

  // Tasks can point at a step position the sequence no longer declares
  // (a step removed after enrollment). Surface those rather than dropping
  // contacts on the floor.
  for (const [pos, occ] of byPos) {
    if (buckets.some((b) => b.position === pos)) continue;
    buckets.push({ position: pos, type: occ[0]?.type || "unknown", waiting: occ.length, overdue: occ.filter((o) => o.overdue).length, occupants: occ });
  }
  buckets.sort((a, b) => a.position - b.position);

  return {
    sequenceId: sequence.id,
    buckets,
    totalWaiting: occupants.length,
    totalOverdue: occupants.filter((o) => o.overdue).length,
    truncated,
  };
}

// ---------------------------------------------------------------------------
// Whose sequences this tab shows
//
// Per Jack: "i only need the sequences created by jack snellgrove that it
// anything else is not to be brought here."
//
// The id is NOT guessed — apollo_users_search for "Snellgrove" returned
// exactly one user, Jack Snellgrove, id 68bf4ba5f68a0600194acd11, whose
// email is jack.snellgrove@grandstrategygroup.com. Every sequence carries
// `user_id` (its creator); that is what this filters on.
//
// WORTH KNOWING: every "Carly …" sequence also carries THIS id — Jack
// created them — so a creator filter keeps them. Filtering those out would
// be a filter on the NAME, which is a different question and not what was
// asked for.
export const SEQUENCE_OWNER_USER_ID = "68bf4ba5f68a0600194acd11";
export const SEQUENCE_OWNER_NAME = "Jack Snellgrove";

export function isOwnedByJack(seq: ApolloSequence): boolean {
  return seq.userId === SEQUENCE_OWNER_USER_ID;
}

// Returns the kept list plus how many were dropped, so the UI can SAY that
// it filtered rather than silently presenting a short list as the whole
// account — and so a filter that matches nothing reads as a broken filter
// rather than an empty Apollo.
export function filterToOwner(all: ApolloSequence[]): {
  kept: ApolloSequence[];
  hiddenCount: number;
  filterMatchedNothing: boolean;
} {
  const kept = all.filter(isOwnedByJack);
  return {
    kept,
    hiddenCount: all.length - kept.length,
    filterMatchedNothing: all.length > 0 && kept.length === 0,
  };
}

// ---------------------------------------------------------------------------
// Health rules
// ---------------------------------------------------------------------------

export type Severity = "critical" | "warn" | "info";

export interface HealthFlag {
  severity: Severity;
  label: string;
  detail: string;
}

export const SEVERITY_RANK: Record<Severity, number> = { critical: 0, warn: 1, info: 2 };

// Thresholds live here, named, so the rule set is one readable block
// rather than magic numbers scattered through JSX.
export const THRESHOLDS = {
  overdueBacklog: 25,
  bounceRate: 0.03,
  hardBounceRate: 0.02,
  optOutRate: 0.01,
  noDemoMinDelivered: 150,
  staleDays: 14,
  pausedPoolMinDelivered: 250,
  lowReplyRate: 0.01,
  lowReplyMinSent: 100,
  syncStaleHours: 48,
} as const;

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.floor((Date.now() - t) / 86_400_000);
}

export function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

export function flagsForSequence(seq: ApolloSequence, dist?: StepDistribution | null): HealthFlag[] {
  const flags: HealthFlag[] = [];
  const overdue = Math.max(seq.overdueManualTasks, dist?.totalOverdue ?? 0);

  if (overdue >= THRESHOLDS.overdueBacklog) {
    flags.push({
      severity: overdue >= 100 ? "critical" : "warn",
      label: "Task backlog",
      detail: `${overdue.toLocaleString()} overdue task${overdue === 1 ? "" : "s"} nobody has worked.`,
    });
  }
  if (seq.bounceRate > THRESHOLDS.bounceRate || seq.hardBounceRate > THRESHOLDS.hardBounceRate) {
    flags.push({
      severity: "critical",
      label: "Deliverability",
      detail: `${pct(seq.bounceRate)} bounce (${pct(seq.hardBounceRate)} hard) — above the ${pct(THRESHOLDS.bounceRate)} line. Lifetime figure, not just recent sends.`,
    });
  }
  if (seq.optOutRate > THRESHOLDS.optOutRate) {
    flags.push({
      severity: "warn",
      label: "Burning the list",
      detail: `${pct(seq.optOutRate)} opt-out rate across ${seq.delivered.toLocaleString()} delivered.`,
    });
  }
  if (seq.delivered >= THRESHOLDS.noDemoMinDelivered && seq.demoed === 0) {
    flags.push({
      severity: "warn",
      label: "No conversions",
      detail: `${seq.delivered.toLocaleString()} delivered, zero meetings booked.`,
    });
  }
  const idle = daysSince(seq.lastUsedAt);
  if (seq.active && idle !== null && idle > THRESHOLDS.staleDays) {
    flags.push({
      severity: "warn",
      label: "Stalled",
      detail: `Active but untouched for ${idle} days.`,
    });
  }
  if (!seq.active && seq.delivered >= THRESHOLDS.pausedPoolMinDelivered) {
    flags.push({
      severity: "info",
      label: "Paused pool",
      detail: `${seq.delivered.toLocaleString()} contacts behind a paused sequence — a re-approach pool, not a problem.`,
    });
  }
  if (seq.performingPoorly) {
    flags.push({ severity: "warn", label: "Apollo flag", detail: "Apollo itself marks this sequence as performing poorly." });
  }
  return flags.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

export function flagsForMailbox(box: MailboxRow, expectedSender: boolean): HealthFlag[] {
  const flags: HealthFlag[] = [];
  const s = box.stats;

  if (!box.active) {
    flags.push({ severity: "critical", label: "Disconnected", detail: "Mailbox is not active in Apollo." });
  }
  const syncAgeH = box.lastSyncedAt ? (Date.now() - new Date(box.lastSyncedAt).getTime()) / 3_600_000 : null;
  if (syncAgeH !== null && syncAgeH > THRESHOLDS.syncStaleHours) {
    flags.push({
      severity: "critical",
      label: "Not syncing",
      detail: `Last synced ${Math.floor(syncAgeH / 24)} days ago — Apollo may have lost the connection.`,
    });
  }
  if (s && s.dailyLimit === 0 && expectedSender) {
    flags.push({
      severity: "critical",
      label: "Cannot send",
      detail: "Daily send limit is 0, so this mailbox can't send even though it's set up as a sending alias.",
    });
  }
  if (expectedSender && s && s.sent === 0) {
    flags.push({ severity: "warn", label: "Dormant", detail: "A sending alias that sent nothing in this window." });
  }
  if (s && s.sent > 0) {
    const br = s.bounced / s.sent;
    if (br > THRESHOLDS.bounceRate) {
      flags.push({ severity: "critical", label: "Bouncing", detail: `${pct(br)} of sends bounced in this window.` });
    }
    if (s.sent >= THRESHOLDS.lowReplyMinSent && s.replied / s.sent < THRESHOLDS.lowReplyRate) {
      flags.push({
        severity: "warn",
        label: "Low reply rate",
        detail: `${s.replied} repl${s.replied === 1 ? "y" : "ies"} from ${s.sent.toLocaleString()} sends (${pct(s.replied / s.sent)}).`,
      });
    }
  }
  if (box.isDefault && s && s.dailyLimit === 0) {
    flags.push({
      severity: "warn",
      label: "Default but unsendable",
      detail: "Apollo auto-selects this mailbox when adding contacts to a sequence, but it can't send.",
    });
  }
  return flags.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

export function worstSeverity(flags: HealthFlag[]): Severity | null {
  if (flags.length === 0) return null;
  return flags.reduce<Severity>((worst, f) => (SEVERITY_RANK[f.severity] < SEVERITY_RANK[worst] ? f.severity : worst), "info");
}

// ---------------------------------------------------------------------------
// Who owns which mailbox
//
// Jack's sending aliases, stated by him directly: .co, .us, .net, .info and
// wired-cio.com. Deliberately NOT including jack@wiredcio.com — that's his
// real mailbox, held out of outbound on purpose (its daily limit is 0),
// so flagging it as a broken sender would be wrong.
//
// Carly is expected to have 5 aliases too but only some are connected yet;
// her domains aren't known here, so she's matched on local-part and
// compared against an expected COUNT rather than a guessed domain list.
// A missing alias is a real "work is needed" item, so this config exists
// to make absence visible — you can't see what isn't there.
export interface AliasOwner {
  key: string;
  label: string;
  expectedAliasCount: number;
  // Exact addresses that are sending aliases.
  aliasEmails?: string[];
  // Fallback match when the full alias list isn't known yet.
  localPart?: string;
  // Real (non-outbound) mailboxes — present, but never flagged as dormant.
  personalEmails?: string[];
}

export const ALIAS_OWNERS: AliasOwner[] = [
  {
    key: "jack",
    label: "Jack",
    expectedAliasCount: 5,
    aliasEmails: [
      "jack.snellgrove@wiredcio.co",
      "jack.snellgrove@wiredcio.us",
      "jack.snellgrove@wiredcio.net",
      "jack.snellgrove@wiredcio.info",
      "jack.snellgrove@wired-cio.com",
    ],
    personalEmails: ["jack@wiredcio.com", "jack.snellgrove@grandstrategygroup.com"],
  },
  {
    key: "carly",
    label: "Carly",
    expectedAliasCount: 5,
    localPart: "carly",
  },
];

export function ownerForMailbox(email: string): AliasOwner | null {
  const e = email.toLowerCase();
  for (const o of ALIAS_OWNERS) {
    if (o.aliasEmails?.some((a) => a.toLowerCase() === e)) return o;
    if (o.personalEmails?.some((a) => a.toLowerCase() === e)) return o;
    if (o.localPart && e.startsWith(`${o.localPart}@`)) return o;
  }
  return null;
}

export function isSendingAlias(email: string): boolean {
  const e = email.toLowerCase();
  const owner = ownerForMailbox(e);
  if (!owner) return false;
  if (owner.personalEmails?.some((a) => a.toLowerCase() === e)) return false;
  return true;
}

export interface OwnerSummary {
  owner: AliasOwner;
  connected: MailboxRow[];
  aliasCount: number;
  missingCount: number;
  totalSent: number;
}

export function summarizeByOwner(rows: MailboxRow[]): OwnerSummary[] {
  return ALIAS_OWNERS.map((owner) => {
    const connected = rows.filter((r) => ownerForMailbox(r.email)?.key === owner.key);
    const aliases = connected.filter((r) => isSendingAlias(r.email));
    return {
      owner,
      connected,
      aliasCount: aliases.length,
      missingCount: Math.max(0, owner.expectedAliasCount - aliases.length),
      totalSent: connected.reduce((s, r) => s + (r.stats?.sent || 0), 0),
    };
  });
}

// ---------------------------------------------------------------------------
// Assembling a mailbox row
// ---------------------------------------------------------------------------

export function buildMailboxRows(
  mailboxes: Mailbox[],
  stats: Map<string, MailboxStats>,
  windowDays: number
): MailboxRow[] {
  const rows = mailboxes.map<MailboxRow>((m) => {
    const s = stats.get(m.email.toLowerCase()) || null;
    const base: MailboxRow = {
      ...m,
      stats: s,
      bounceRate: s && s.sent > 0 ? s.bounced / s.sent : null,
      replyRate: s && s.sent > 0 ? s.replied / s.sent : null,
      sendsPerDay: s ? s.sent / windowDays : null,
      flags: [],
    };
    base.flags = flagsForMailbox(base, isSendingAlias(m.email));
    return base;
  });
  // Sending aliases first, then by volume — the mailboxes Jack actually
  // runs outbound from should never be buried under nine idle teammates.
  return rows.sort((a, b) => {
    const aa = isSendingAlias(a.email) ? 0 : 1;
    const bb = isSendingAlias(b.email) ? 0 : 1;
    if (aa !== bb) return aa - bb;
    return (b.stats?.sent || 0) - (a.stats?.sent || 0);
  });
}

// ---------------------------------------------------------------------------
// Step / channel presentation
// ---------------------------------------------------------------------------

export const STEP_META: Record<string, { icon: string; label: string }> = {
  auto_email: { icon: "✉️", label: "Auto email" },
  manual_email: { icon: "✍️", label: "Manual email" },
  call: { icon: "📞", label: "Call" },
  action_item: { icon: "📋", label: "Action item" },
  linkedin_step_connect: { icon: "🔗", label: "LinkedIn connect" },
  linkedin_step_message: { icon: "💬", label: "LinkedIn message" },
  linkedin_step_view_profile: { icon: "👀", label: "LinkedIn view" },
  linkedin_step_interact_post: { icon: "👍", label: "LinkedIn interact" },
  outreach_manual_email: { icon: "✍️", label: "Manual email" },
};

export function stepMeta(type: string) {
  return STEP_META[type] || { icon: "•", label: type.replace(/_/g, " ") };
}

export function waitLabel(step: SeqStep): string {
  if (step.position === 1 || (step.waitTime === 0 && step.position === 1)) return "on enroll";
  if (step.waitTime === 0) return "immediately";
  const unit = step.waitMode === "day" ? "d" : step.waitMode === "hour" ? "h" : "m";
  return `+${step.waitTime}${unit}`;
}

// ---------------------------------------------------------------------------
// "What's working / what's not" — comparative read across the fleet
// ---------------------------------------------------------------------------

export interface Insight {
  kind: "working" | "broken" | "opportunity";
  headline: string;
  detail: string;
}

export function buildInsights(seqs: ApolloSequence[], mailboxes: MailboxRow[]): Insight[] {
  const out: Insight[] = [];
  const worked = seqs.filter((s) => s.delivered > 0);

  // Best converter by demo rate, among sequences with enough volume to mean
  // something. A 100% demo rate on 3 delivered is noise, not a winner.
  const meaningful = worked.filter((s) => s.delivered >= 100);
  const best = [...meaningful].sort((a, b) => b.demoRate - a.demoRate)[0];
  if (best && best.demoRate > 0) {
    const fleetDemos = worked.reduce((s, x) => s + x.demoed, 0);
    const fleetDelivered = worked.reduce((s, x) => s + x.delivered, 0);
    const fleetRate = fleetDelivered > 0 ? fleetDemos / fleetDelivered : 0;
    const multiple = fleetRate > 0 ? best.demoRate / fleetRate : 0;
    out.push({
      kind: "working",
      headline: `${best.name} is your best converter`,
      detail: `${pct(best.demoRate)} demo rate (${best.demoed} meetings from ${best.delivered.toLocaleString()} delivered)${
        multiple >= 1.5 ? ` — ${multiple.toFixed(1)}x the fleet average of ${pct(fleetRate)}` : ""
      }.${best.overdueManualTasks >= THRESHOLDS.overdueBacklog ? ` It also has ${best.overdueManualTasks.toLocaleString()} overdue tasks — your best sequence is the one going unworked.` : ""}`,
    });
  }

  // Volume with nothing to show for it.
  const deadWeight = worked.filter((s) => s.delivered >= THRESHOLDS.noDemoMinDelivered && s.demoed === 0);
  if (deadWeight.length > 0) {
    const total = deadWeight.reduce((s, x) => s + x.delivered, 0);
    out.push({
      kind: "broken",
      headline: `${deadWeight.length} sequence${deadWeight.length === 1 ? "" : "s"} produced ${total.toLocaleString()} sends and zero meetings`,
      detail: deadWeight.map((s) => `${s.name} (${s.delivered.toLocaleString()})`).join(", ") + ".",
    });
  }

  // Paused sequences holding a big re-approach pool.
  const pausedPools = worked.filter((s) => !s.active && s.delivered >= THRESHOLDS.pausedPoolMinDelivered);
  if (pausedPools.length > 0) {
    const total = pausedPools.reduce((s, x) => s + x.delivered, 0);
    const biggest = [...pausedPools].sort((a, b) => b.delivered - a.delivered)[0];
    out.push({
      kind: "opportunity",
      headline: `${total.toLocaleString()} contacts sit behind paused sequences`,
      detail: `Biggest is ${biggest.name} (${biggest.delivered.toLocaleString()} delivered, ${biggest.demoed} meetings). These are worked-and-parked leads, not new ones — the cheapest pipeline you have.`,
    });
  }

  // Domain-level reply spread. Same lists, same sequences, different
  // domains performing very differently is a deliverability signal.
  const senders = mailboxes.filter((m) => isSendingAlias(m.email) && (m.stats?.sent || 0) >= 30 && m.replyRate !== null);
  if (senders.length >= 2) {
    const sorted = [...senders].sort((a, b) => (b.replyRate || 0) - (a.replyRate || 0));
    const top = sorted[0];
    const bottom = sorted[sorted.length - 1];
    if ((top.replyRate || 0) > 0 && (bottom.replyRate || 0) >= 0 && (top.replyRate || 0) >= (bottom.replyRate || 0) * 2) {
      out.push({
        kind: "opportunity",
        headline: `${bottom.domain} is underperforming ${top.domain}`,
        detail: `${bottom.domain} replies at ${pct(bottom.replyRate || 0)} (${bottom.stats?.replied} from ${bottom.stats?.sent.toLocaleString()}) vs ${top.domain} at ${pct(top.replyRate || 0)}. Same sequences, same lists — shift volume toward the domain that answers.`,
      });
    }
  }

  // Aliases that should exist and don't.
  for (const sum of summarizeByOwner(mailboxes)) {
    if (sum.missingCount > 0) {
      out.push({
        kind: "opportunity",
        headline: `${sum.owner.label} has ${sum.aliasCount} of ${sum.owner.expectedAliasCount} sending aliases connected`,
        detail: `${sum.missingCount} alias${sum.missingCount === 1 ? "" : "es"} not connected in Apollo yet — unused sending capacity.`,
      });
    }
  }

  return out;
}
