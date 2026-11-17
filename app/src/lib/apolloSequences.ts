// Sequence Cleaner — live Apollo sequence audit + move/remove.
//
// Per Jack: "build a tool here to check sequences i can select them and
// which i want to compare or move tasks around" — the same checks run by
// hand across Jack/Carly M365 and Dynamics sequences, made repeatable.
//
// Everything goes through the VIEWER's own Apollo connector via the
// Artifact `mcp` capability (same mechanism as lib/apolloEnrich.ts) — no
// credential lives in this app. Reads run only when the viewer clicks
// "Run check"; writes (move/remove) only after an explicit confirm screen
// that states the count, the target sequence and the mailbox. This is the
// first place the app WRITES to Apollo — approved by Jack, see CLAUDE.md
// "Sequence Cleaner".
//
// Honest scope: meetings and deals are judged from what Apollo knows (call
// outcomes Meeting Booked / Qualified). Echo meetings and HubSpot deals are
// not connected here; the UI says so rather than reading as "clean".
import { getMcp, describeApolloError } from "./apolloEnrich";
import type { ClaudeMcpNamespace } from "./claudeRuntime";

// ---------------------------------------------------------------- ids

export const OUTCOME = {
  meetingBooked: "6a024dabd777bd000d626376",
  callBack: "6a73be64a0f3de000c6be57f",
  infoRequested: "6a0f3f736d2f76001c1d81e9",
  qualified: "6aa2c9e5aaca8f0020ba173e",
  notInterested: "66203bd7183e310422980485",
  doNotContact: "6a989d8ec49089001c19afd7",
  noAnswer: "66203bd7183e31042298047d",
  gatekeeper: "6a7df381b85a6000143a839e",
  leftVm: "6a85f9f01aba53000c122e8c",
  wrongNumber: "6a7df36eda04890018573da9",
} as const;

export const OUTCOME_LABEL: Record<string, string> = {
  [OUTCOME.meetingBooked]: "Meeting Booked",
  [OUTCOME.callBack]: "Call Back Scheduled",
  [OUTCOME.infoRequested]: "Info Requested",
  [OUTCOME.qualified]: "Qualified, Pending Review",
  [OUTCOME.notInterested]: "Not interested",
  [OUTCOME.doNotContact]: "Do Not Contact",
  [OUTCOME.noAnswer]: "No Answer",
  [OUTCOME.gatekeeper]: "Gatekeeper",
  [OUTCOME.leftVm]: "Left Voicemail",
  [OUTCOME.wrongNumber]: "Wrong Number",
};

export const STAGE_NOT_INTERESTED = "66203bd7183e31042298045e";
const FIELD_PRODUCT_LINE = "68abe22a26a866001d3e1a08";
const FIELD_RESEARCH = "696fb0360a128f000d7103ed"; // long AI research blob — ignored

// The rules, fixed for now (Jack's call: built in, not editable yet).
export const RULES = {
  deepCallSeconds: 240,
} as const;

// "Dynamics-related" per Jack: Dynamics, BC, ERP, CRM, Sales platform,
// and anything Power Apps / Automate / Platform / Pages / Dataverse.
// Word-bounded so "usage" never reads as "sage".
const DYNAMICS_RE =
  /\b(?:dynamics|d365|business central|ERP|CRM|customer engagement|customer insights|NAV|great plains|GP|F&O|FnO|finance (?:and|&) operations|supply chain management|field service|salesforce|netsuite|quickbooks|sage|acumatica|odoo|epicor|syspro|power ?apps?|power ?automate|power ?platform|power ?pages|dataverse)\b/gi;

const FREE_DOMAINS = new Set(["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "aol.com", "icloud.com", "live.com", "msn.com", "comcast.net", "att.net", "verizon.net", "me.com", "protonmail.com"]);

// ---------------------------------------------------------------- types

export interface ApolloSequence {
  id: string;
  name: string;
  ownerId: string;
  active: boolean;
  numSteps: number;
  steps: { id: string; position: number; type: string }[];
}

export interface SequenceMember {
  contactId: string;
  name: string;
  company: string;
  email: string;
  domain: string;
  accountId: string;
  stageId: string;
  productLine: string;
  notes: string; // every short custom field joined, research blob excluded
  sequenceId: string;
  status: string; // active | paused
  stepPosition: number | null;
  finishedAt: string | null;
  addedAt: string | null;
  // Every OTHER sequence this contact has finished before (Apollo keeps the
  // finished status on the contact even after the sequence ends).
  priorFinished: { sequenceId: string; finishedAt: string | null; reason: string }[];
}

export interface CallRecord {
  id: string;
  contactId: string;
  accountId: string;
  duration: number;
  outcomeId: string | null;
  note: string;
  startTime: string;
  caller: string;
}

export type FlagKind =
  | "meeting"
  | "reached"
  | "deep-call"
  | "stage"
  | "replied"
  | "dupe-person"
  | "dupe-company"
  | "wrong-sequence"
  | "callback"
  | "zombie"
  | "repeat-finished";

export const FLAG_META: Record<FlagKind, { label: string; severity: "remove" | "review" | "info" }> = {
  meeting: { label: "Meeting booked / qualified", severity: "remove" },
  reached: { label: "Already reached", severity: "remove" },
  "deep-call": { label: "Call over 4 min", severity: "remove" },
  stage: { label: "Stage: Not Interested", severity: "remove" },
  replied: { label: "Replied", severity: "remove" },
  "dupe-person": { label: "Same person in 2+ sequences", severity: "review" },
  "dupe-company": { label: "Same company twice", severity: "review" },
  "wrong-sequence": { label: "Wrong product line", severity: "review" },
  callback: { label: "Call back scheduled", severity: "info" },
  zombie: { label: "Finished but shown active", severity: "remove" },
  "repeat-finished": { label: "Finished a sequence before", severity: "review" },
};

export interface Flag {
  kind: FlagKind;
  evidence: string;
}

export interface MemberResult extends SequenceMember {
  flags: Flag[];
}

export interface CompanyCheckRow {
  sequenceId: string;
  company: string;
  contacts: { name: string; email: string; step: number | null }[];
}

export interface AuditResult {
  members: MemberResult[];
  // Per Jack: "check across each sequence ... not more than 1 contact from a
  // company added to each" — one row per (sequence, company) with 2+ people.
  companyCheck: CompanyCheckRow[];
  checkedCalls: number;
  gaps: string[];
}

// ---------------------------------------------------------------- connector

interface Handle {
  mcp: ClaudeMcpNamespace;
  server: string;
  tools: string[];
}

async function apollo(): Promise<Handle> {
  const mcp = await getMcp();
  if (!mcp) throw new Error("Apollo isn't available in this view. Open the app from claude.ai with Apollo connected.");
  let servers;
  try {
    ({ servers } = await mcp.listTools());
  } catch (err) {
    throw new Error(describeApolloError(err));
  }
  const s = servers.find((x) => x.server.toLowerCase().includes("apollo"));
  if (!s) throw new Error("Apollo isn't connected — add it in claude.ai Settings → Connectors, then try again.");
  return { mcp, server: s.server, tools: s.tools.map((t) => t.name) };
}

function toolName(h: Handle, suffix: string): string {
  const t = h.tools.find((n) => n === suffix || n.endsWith(suffix));
  if (!t) throw new Error(`Apollo tool "${suffix}" isn't enabled for this page.`);
  return t;
}

async function call<T>(h: Handle, suffix: string, input: unknown): Promise<T> {
  try {
    const r = await h.mcp.callTool(h.server, toolName(h, suffix), input);
    return (r.payload ?? {}) as T;
  } catch (err) {
    throw new Error(describeApolloError(err));
  }
}

// ---------------------------------------------------------------- reads

export async function listSequences(): Promise<ApolloSequence[]> {
  const h = await apollo();
  const out: ApolloSequence[] = [];
  for (let page = 1; page <= 5; page++) {
    const p = await call<{ emailer_campaigns?: Record<string, unknown>[]; pagination?: { total_pages?: number } }>(
      h, "emailer_campaigns_search", { per_page: "100", page: String(page) });
    for (const c of p.emailer_campaigns || []) {
      const steps = ((c.emailer_steps as Record<string, unknown>[]) || []).map((s) => ({
        id: String(s.id), position: Number(s.position), type: String(s.type),
      }));
      out.push({
        id: String(c.id), name: String(c.name), ownerId: String(c.user_id || ""),
        active: Boolean(c.active), numSteps: Number(c.num_steps || steps.length), steps,
      });
    }
    if (!p.pagination || (p.pagination.total_pages ?? 1) <= page) break;
  }
  return out;
}

export interface Mailbox { id: string; email: string; ownerId: string; ownerName: string; isDefault: boolean }

export async function listMailboxes(): Promise<Mailbox[]> {
  const h = await apollo();
  const p = await call<{ email_accounts?: Record<string, unknown>[] }>(h, "email_accounts_index",
    { fetch_current_user_emails: false, only_sendable: true });
  return (p.email_accounts || [])
    .filter((a) => a.email)
    .map((a) => ({ id: String(a.id), email: String(a.email), ownerId: String(a.user_id || ""),
      ownerName: String(a.owner_name || ""), isDefault: Boolean(a.default) }));
}

function domainOf(email: string): string {
  const d = (email.split("@")[1] || "").toLowerCase().trim();
  return FREE_DOMAINS.has(d) ? "" : d;
}

export function normCompany(s: string): string {
  return s.toLowerCase()
    .replace(/&amp;|&/g, " and ")
    .replace(/[.,'’"()]/g, " ")
    .replace(/\b(inc|llc|l\.l\.c|ltd|corp|corporation|co|company|pllc|pc|lp|llp|group)\b/g, " ")
    .replace(/\s+/g, " ").trim();
}

export async function fetchMembers(seq: ApolloSequence, onProgress?: (n: number) => void): Promise<SequenceMember[]> {
  const h = await apollo();
  const stepPos = new Map(seq.steps.map((s) => [s.id, s.position]));
  const members: SequenceMember[] = [];
  for (let page = 1; page <= 100; page++) {
    const p = await call<{ contacts?: Record<string, unknown>[]; pagination?: { total_pages?: number } }>(
      h, "contacts_search", {
        emailer_campaign_ids: [seq.id], per_page: 100, page,
        fields: [{ contacts: ["id", "name", "email", "organization_name", "account_id", "contact_stage_id",
          { account: ["domain"] }, "typed_custom_fields",
          { contact_campaign_statuses: ["emailer_campaign_id", "status", "current_step_id", "finished_at", "added_at", "inactive_reason"] }] }],
      });
    for (const c of p.contacts || []) {
      const allSt = (c.contact_campaign_statuses as Record<string, unknown>[]) || [];
      const st = allSt.find((s) => s.emailer_campaign_id === seq.id);
      const priorFinished = allSt
        .filter((s) => s.emailer_campaign_id !== seq.id && s.status === "finished")
        .map((s) => ({ sequenceId: String(s.emailer_campaign_id), finishedAt: (s.finished_at as string) || null, reason: String(s.inactive_reason || "") }));
      if (!st || (st.status !== "active" && st.status !== "paused")) continue;
      const tf = (c.typed_custom_fields as Record<string, unknown>) || {};
      const notes = Object.entries(tf)
        .filter(([k]) => k !== FIELD_RESEARCH && k !== FIELD_PRODUCT_LINE)
        .map(([, v]) => (typeof v === "string" ? v : v && typeof v === "object" ? "" : String(v ?? "")))
        .filter((v) => v && v.length <= 1500)
        .join(" | ");
      const email = String(c.email || "");
      const acct = (c.account as { domain?: string }) || {};
      members.push({
        contactId: String(c.id), name: String(c.name || ""), company: String(c.organization_name || ""),
        email, domain: domainOf(email) || String(acct.domain || "").toLowerCase(),
        accountId: String(c.account_id || ""), stageId: String(c.contact_stage_id || ""),
        productLine: String(tf[FIELD_PRODUCT_LINE] || ""), notes,
        sequenceId: seq.id, status: String(st.status),
        stepPosition: stepPos.get(String(st.current_step_id)) ?? null,
        finishedAt: (st.finished_at as string) || null, addedAt: (st.added_at as string) || null,
        priorFinished,
      });
    }
    onProgress?.(members.length);
    if (!p.pagination || (p.pagination.total_pages ?? 1) <= page) break;
  }
  return members;
}

// Calls for one account (company-level, so a colleague's deep call counts).
async function fetchAccountCalls(h: Handle, accountId: string): Promise<CallRecord[]> {
  const p = await call<{ phone_calls?: Record<string, unknown>[] }>(h, "phone_calls_search",
    { account_id: accountId, per_page: 100, page: 1, sort_by_field: "start_time" });
  return (p.phone_calls || []).map((c) => ({
    id: String(c.id), contactId: String(c.contact_id || ""), accountId,
    duration: Number(c.duration || 0), outcomeId: (c.phone_call_outcome_id as string) || null,
    note: String(c.note_text || c.note || ""), startTime: String(c.start_time || ""),
    caller: String(c.caller_name || ""),
  }));
}

async function fetchRepliedContactIds(h: Handle, seqId: string): Promise<Set<string>> {
  const ids = new Set<string>();
  for (let page = 1; page <= 20; page++) {
    const p = await call<{ emailer_messages?: Record<string, unknown>[]; pagination?: { total_pages?: number } }>(
      h, "emailer_messages_search", { emailer_campaign_id: seqId, emailer_message_stats: ["replied"], per_page: "100", page: String(page) });
    for (const m of p.emailer_messages || []) if (m.contact_id) ids.add(String(m.contact_id));
    if (!p.pagination || (p.pagination.total_pages ?? 1) <= page) break;
  }
  return ids;
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>, tick?: () => void): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); tick?.(); }
  }));
  return out;
}

// ---------------------------------------------------------------- the check

const CONVERSATION_RE = /\b(spoke (with|to)|talked (with|to)|reached (?!voicemail)|discussed|said (they|she|he)|expressed interest|confirmed)\b/i;

export function sequenceKind(name: string): "dynamics" | "m365" | null {
  const n = name.toLowerCase();
  if (n.includes("dynamics")) return "dynamics";
  if (n.includes("m365") || n.includes("main")) return "m365";
  return null;
}

export async function runAudit(
  sequences: ApolloSequence[],
  onStatus: (msg: string) => void,
  allSequences: ApolloSequence[] = sequences,
): Promise<AuditResult> {
  const anyName = new Map(allSequences.map((x) => [x.id, x.name]));
  const h = await apollo();
  const gaps = ["Meetings and deals are judged from Apollo call outcomes only — Echo and HubSpot aren't connected to this page."];
  let members: SequenceMember[] = [];
  for (const s of sequences) {
    onStatus(`Reading ${s.name}…`);
    members = members.concat(await fetchMembers(s, (n) => onStatus(`Reading ${s.name}… ${n} active`)));
  }

  const accounts = [...new Set(members.map((m) => m.accountId).filter(Boolean))];
  let done = 0;
  const callsByAccount = new Map<string, CallRecord[]>();
  const results = await pool(accounts, 5, async (a) => {
    try { return [a, await fetchAccountCalls(h, a)] as const; }
    catch { return [a, null] as const; }
  }, () => onStatus(`Checking call history… ${++done}/${accounts.length} companies`));
  let failed = 0;
  for (const [a, calls] of results) { if (calls) callsByAccount.set(a, calls); else failed++; }
  if (failed) gaps.push(`Call history couldn't be read for ${failed} compan${failed === 1 ? "y" : "ies"}.`);
  const noAccount = members.filter((m) => !m.accountId).length;
  if (noAccount) gaps.push(`${noAccount} contact(s) have no Apollo account, so company-level call checks were skipped for them.`);

  const replied = new Set<string>();
  for (const s of sequences) {
    onStatus(`Checking replies in ${s.name}…`);
    try { for (const id of await fetchRepliedContactIds(h, s.id)) replied.add(id); }
    catch { gaps.push(`Replies couldn't be read for ${s.name}.`); }
  }

  // Cross-sequence maps.
  const byPerson = new Map<string, SequenceMember[]>();
  const byCompany = new Map<string, SequenceMember[]>();
  for (const m of members) {
    for (const k of [m.contactId, m.email.toLowerCase(), m.name.toLowerCase() + "|" + normCompany(m.company)]) {
      if (!k || k.startsWith("|")) continue;
      (byPerson.get(k) || byPerson.set(k, []).get(k)!).push(m);
    }
    const ck = m.domain || normCompany(m.company);
    if (ck) (byCompany.get(ck) || byCompany.set(ck, []).get(ck)!).push(m);
  }
  const seqName = new Map(sequences.map((s) => [s.id, s.name]));
  const seqById = new Map(sequences.map((s) => [s.id, s]));

  onStatus("Applying rules…");
  const out: MemberResult[] = members.map((m) => {
    const flags: Flag[] = [];
    const calls = callsByAccount.get(m.accountId) || [];
    const mine = calls.filter((c) => c.contactId === m.contactId);
    const d = (c: CallRecord) => c.startTime.slice(0, 10);

    for (const c of mine) {
      const label = c.outcomeId ? OUTCOME_LABEL[c.outcomeId] : "";
      if (c.outcomeId === OUTCOME.meetingBooked || c.outcomeId === OUTCOME.qualified)
        flags.push({ kind: "meeting", evidence: `${label} · ${c.caller} · ${d(c)}` });
      else if (c.outcomeId === OUTCOME.infoRequested || c.outcomeId === OUTCOME.notInterested || c.outcomeId === OUTCOME.doNotContact)
        flags.push({ kind: "reached", evidence: `${label} · ${c.caller} · ${d(c)}` });
      else if (c.outcomeId === OUTCOME.callBack)
        flags.push({ kind: "callback", evidence: `${c.caller} · ${d(c)}${c.note ? " · " + c.note.slice(0, 120) : ""}` });
      else if (!c.outcomeId && c.note && CONVERSATION_RE.test(c.note))
        flags.push({ kind: "reached", evidence: `Note: "${c.note.slice(0, 120)}" · ${c.caller} · ${d(c)}` });
    }
    for (const c of calls) {
      if (c.duration >= RULES.deepCallSeconds) {
        const who = c.contactId === m.contactId ? "" : " (colleague at same company)";
        flags.push({ kind: "deep-call", evidence: `${Math.round(c.duration / 60)} min · ${c.caller} · ${d(c)}${who}` });
        break;
      }
    }
    if (m.stageId === STAGE_NOT_INTERESTED) flags.push({ kind: "stage", evidence: "Contact stage is Not Interested" });
    if (replied.has(m.contactId)) flags.push({ kind: "replied", evidence: "Replied to a sequence email" });
    if (m.priorFinished.length) {
      const names = m.priorFinished.map((p) => `${anyName.get(p.sequenceId) || "an archived sequence"}${p.finishedAt ? ` (${p.finishedAt.slice(0, 10)})` : ""}${p.reason ? ` — ${p.reason.replace(/_/g, " ")}` : ""}`);
      flags.push({ kind: "repeat-finished", evidence: `Finished ${m.priorFinished.length} sequence${m.priorFinished.length === 1 ? "" : "s"} before: ${names.join("; ")}` });
    }
    if (m.finishedAt) flags.push({ kind: "zombie", evidence: `Finished ${m.finishedAt.slice(0, 10)} but still listed active` });

    const otherSeqs = new Set<string>();
    for (const k of [m.contactId, m.email.toLowerCase(), m.name.toLowerCase() + "|" + normCompany(m.company)])
      for (const o of byPerson.get(k) || []) if (o.sequenceId !== m.sequenceId) otherSeqs.add(seqName.get(o.sequenceId)!);
    if (otherSeqs.size) flags.push({ kind: "dupe-person", evidence: `Also active in ${[...otherSeqs].join(", ")}` });

    const ck = m.domain || normCompany(m.company);
    const peers = (byCompany.get(ck) || []).filter((o) => o.contactId !== m.contactId);
    if (peers.length) {
      const where = peers.map((o) => `${o.name} (${seqName.get(o.sequenceId)})`).slice(0, 4).join(", ");
      flags.push({ kind: "dupe-company", evidence: `Same company: ${where}${peers.length > 4 ? ` +${peers.length - 4}` : ""}` });
    }

    const kind = sequenceKind(seqById.get(m.sequenceId)!.name);
    const hits = [...new Set((m.notes.match(DYNAMICS_RE) || []).map((x) => x.toLowerCase()))];
    if (kind === "m365" && hits.length)
      flags.push({ kind: "wrong-sequence", evidence: `Notes mention ${hits.join(", ")} — belongs in a Dynamics sequence` });
    if (kind === "dynamics" && !hits.length && m.notes)
      flags.push({ kind: "wrong-sequence", evidence: "No Dynamics / ERP / CRM / Power Platform wording in notes" });

    return { ...m, flags };
  });

  const perSeq = new Map<string, MemberResult[]>();
  for (const m of out) {
    const ck = m.domain || normCompany(m.company);
    if (!ck) continue;
    const k = `${m.sequenceId}|${ck}`;
    (perSeq.get(k) || perSeq.set(k, []).get(k)!).push(m);
  }
  const companyCheck: CompanyCheckRow[] = [...perSeq.values()].filter((g) => g.length > 1).map((g) => ({
    sequenceId: g[0].sequenceId, company: g[0].company || g[0].domain,
    contacts: g.map((m) => ({ name: m.name, email: m.email, step: m.stepPosition })),
  })).sort((a, b) => b.contacts.length - a.contacts.length);

  return { members: out, companyCheck, checkedCalls: [...callsByAccount.values()].reduce((n, c) => n + c.length, 0), gaps };
}

// ---------------------------------------------------------------- writes

export interface MoveResult { moved: string[]; skipped: Record<string, string>; removed: string[] }

export async function removeFromSequence(contactIds: string[], seqId: string): Promise<string[]> {
  const h = await apollo();
  const removed: string[] = [];
  for (let i = 0; i < contactIds.length; i += 50) {
    const batch = contactIds.slice(i, i + 50);
    const p = await call<{ contacts?: { id: string; emailer_campaign_ids?: string[] }[] }>(h,
      "emailer_campaigns_remove_or_stop_contact_ids", { contact_ids: batch, emailer_campaign_ids: [seqId], mode: "remove" });
    for (const c of p.contacts || []) if (!(c.emailer_campaign_ids || []).includes(seqId)) removed.push(c.id);
  }
  return removed;
}

// Move = enroll in the target first, then remove from the source only the
// contacts the target actually accepted — never strands anyone in neither.
export async function moveToSequence(contactIds: string[], fromSeqId: string, toSeqId: string, mailboxId: string): Promise<MoveResult> {
  const h = await apollo();
  const moved: string[] = [];
  const skipped: Record<string, string> = {};
  for (let i = 0; i < contactIds.length; i += 50) {
    const batch = contactIds.slice(i, i + 50);
    const p = await call<{ contacts?: { id: string; contact_campaign_statuses?: { emailer_campaign_id: string }[] }[]; skipped_contact_ids?: Record<string, string> }>(h,
      "emailer_campaigns_add_contact_ids", {
        id: toSeqId, emailer_campaign_id: toSeqId, contact_ids: batch,
        send_email_from_email_account_id: mailboxId,
        sequence_active_in_other_campaigns: true, sequence_finished_in_other_campaigns: true,
        contacts_without_ownership_permission: true,
      });
    Object.assign(skipped, p.skipped_contact_ids || {});
    for (const c of p.contacts || [])
      if ((c.contact_campaign_statuses || []).some((s) => s.emailer_campaign_id === toSeqId) && !skipped[c.id]) moved.push(c.id);
  }
  const removed = moved.length ? await removeFromSequence(moved, fromSeqId) : [];
  return { moved, skipped, removed };
}
