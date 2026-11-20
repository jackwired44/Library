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
import { getSequenceScannerMcp, describeApolloError } from "./apolloEnrich";
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
export const FIELD_NOTE = "68abe2198cb839001d7d67c3";
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
  firstName: string;
  lastName: string;
  title: string;
  phones: string[]; // digits only
  note: string; // the Notes field on its own (what a merge chooses between)
  crmSynced: boolean; // has a HubSpot / Salesforce id
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
  | "repeat-finished"
  | "callback-undated"
  | "prior-contact";

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
  "callback-undated": { label: "Call back not dated", severity: "review" },
  "prior-contact": { label: "Called before this sequence", severity: "review" },
};

export interface Flag {
  kind: FlagKind;
  evidence: string;
}

// Per Jack: "see if any leads get added to a sequence from a fresh batch ...
// have they been added or contacted in the past, where the call disposition
// landed." One summary per lead, from that contact's own calls.
export interface LeadHistory {
  calls: number;
  callsBeforeAdd: number;
  lastOutcome: string;      // label, "" when the last call had no outcome
  lastOutcomeId: string | null;
  lastDate: string;         // YYYY-MM-DD, "" when never called
  lastCaller: string;
  lastNote: string;
  everNotInterested: boolean;
  outcomeTally: Record<string, number>;
}

export interface MemberResult extends SequenceMember {
  history: LeadHistory;
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
  const mcp = await getSequenceScannerMcp();
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

export function phoneKey(raw: string): string {
  const d = raw.replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : "";
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
        fields: [{ contacts: ["id", "name", "first_name", "last_name", "title", "email", { phone_numbers: ["sanitized_number"] },
          "hubspot_vid", "salesforce_id", "salesforce_contact_id", "salesforce_lead_id", "organization_name", "account_id", "contact_stage_id",
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
        contactId: String(c.id), name: String(c.name || ""),
        firstName: String(c.first_name || "").trim() || String(c.name || "").trim().split(/\s+/)[0] || "",
        lastName: String(c.last_name || "").trim(),
        title: String(c.title || ""),
        phones: [...new Set(((c.phone_numbers as { sanitized_number?: string }[]) || []).map((x) => phoneKey(x.sanitized_number || "")).filter(Boolean))],
        note: typeof tf[FIELD_NOTE] === "string" ? String(tf[FIELD_NOTE]) : "",
        crmSynced: Boolean(c.hubspot_vid || c.salesforce_id || c.salesforce_contact_id || c.salesforce_lead_id),
        company: String(c.organization_name || ""),
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

// Calls for one contact. NOT by account: Apollo's phone_calls_search ignores
// account_id and returns the whole team's calls (verified 2026-11-20: a made-up
// account id returned all 39,655). contact_id is honoured; the returned calls
// are still filtered to that contact in case it ever stops being.
async function fetchContactCalls(h: Handle, contactId: string, accountId: string): Promise<CallRecord[]> {
  const out: CallRecord[] = [];
  for (let page = 1; page <= 5; page++) {
    const p = await call<{ phone_calls?: Record<string, unknown>[]; pagination?: { total_pages?: number } }>(h, "phone_calls_search",
      { contact_id: contactId, per_page: 100, page, sort_by_field: "start_time" });
    for (const c of p.phone_calls || []) {
      if (String(c.contact_id || "") !== contactId) continue;
      out.push({
        id: String(c.id), contactId, accountId,
        duration: Number(c.duration || 0), outcomeId: (c.phone_call_outcome_id as string) || null,
        note: String(c.note_text || c.note || ""), startTime: String(c.start_time || ""),
        caller: String(c.caller_name || ""),
      });
    }
    if (!p.pagination || (p.pagination.total_pages ?? 1) <= page) break;
  }
  return out;
}

/** Every person's own calls, grouped by company so a colleague's call counts —
 *  for colleagues among the people checked (Apollo can't list a company's calls). */
async function callsByCompany(h: Handle, people: { contactId: string; accountId: string }[], tick: () => void) {
  const uniq = [...new Map(people.map((p) => [p.contactId, p])).values()];
  const byAccount = new Map<string, CallRecord[]>();
  const failedContacts = new Set<string>();
  await pool(uniq, 5, async (p) => {
    try {
      const calls = await fetchContactCalls(h, p.contactId, p.accountId);
      const k = p.accountId || `contact:${p.contactId}`;
      byAccount.set(k, [...(byAccount.get(k) || []), ...calls]);
    } catch { failedContacts.add(p.contactId); }
  }, tick);
  return { byAccount, failedContacts };
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

// Per Jack: a Call Back Scheduled must be "properly dated and noted". The
// note has to say WHEN: a weekday, a month/day, a numeric date, a relative
// day, or a clock time. Anything else gets flagged for a fix in Apollo.
const CALLBACK_WHEN_RE = /\b(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(day)?\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b|\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b|\b(tomorrow|next week|next month|end of (the )?(week|month)|in \d+ (days?|weeks?|months?)|q[1-4])\b|\b\d{1,2}(:\d{2})?\s?(am|pm)\b/i;

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

  let done = 0;
  const people = members.map((m) => ({ contactId: m.contactId, accountId: m.accountId }));
  const total = new Set(people.map((p) => p.contactId)).size;
  const { byAccount: callsByAccount, failedContacts } = await callsByCompany(h, people, () => onStatus(`Checking call history… ${++done}/${total} contacts`));
  if (failedContacts.size) gaps.push(`Call history couldn't be read for ${failedContacts.size} contact${failedContacts.size === 1 ? "" : "s"}.`);
  gaps.push("A colleague's call only counts when that colleague is in one of the checked sequences — Apollo can't list every call at a company.");

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
    const calls = callsByAccount.get(m.accountId || `contact:${m.contactId}`) || [];
    const mine = calls.filter((c) => c.contactId === m.contactId);
    const d = (c: CallRecord) => c.startTime.slice(0, 10);

    for (const c of mine) {
      const label = c.outcomeId ? OUTCOME_LABEL[c.outcomeId] : "";
      if (c.outcomeId === OUTCOME.meetingBooked || c.outcomeId === OUTCOME.qualified)
        flags.push({ kind: "meeting", evidence: `${label} · ${c.caller} · ${d(c)}` });
      else if (c.outcomeId === OUTCOME.infoRequested || c.outcomeId === OUTCOME.notInterested || c.outcomeId === OUTCOME.doNotContact)
        flags.push({ kind: "reached", evidence: `${label} · ${c.caller} · ${d(c)}` });
      else if (c.outcomeId === OUTCOME.callBack) {
        flags.push({ kind: "callback", evidence: `${c.caller} · ${d(c)}${c.note ? " · " + c.note.slice(0, 120) : ""}` });
        if (!c.note.trim()) flags.push({ kind: "callback-undated", evidence: `Call Back Scheduled ${d(c)} by ${c.caller} with no note — no callback date` });
        else if (!CALLBACK_WHEN_RE.test(c.note)) flags.push({ kind: "callback-undated", evidence: `Note has no callback date or time: "${c.note.slice(0, 100)}"` });
      }
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

    const sorted = [...mine].sort((a, b) => b.startTime.localeCompare(a.startTime));
    const last = sorted[0];
    const tally: Record<string, number> = {};
    for (const c of mine) { const k = c.outcomeId ? (OUTCOME_LABEL[c.outcomeId] || "Other outcome") : "No outcome logged"; tally[k] = (tally[k] || 0) + 1; }
    const before = m.addedAt ? mine.filter((c) => c.startTime && c.startTime < m.addedAt!) : [];
    const history: LeadHistory = {
      calls: mine.length,
      callsBeforeAdd: before.length,
      lastOutcome: last?.outcomeId ? (OUTCOME_LABEL[last.outcomeId] || "Other outcome") : "",
      lastOutcomeId: last?.outcomeId || null,
      lastDate: last ? d(last) : "",
      lastCaller: last?.caller || "",
      lastNote: last?.note || "",
      everNotInterested: mine.some((c) => c.outcomeId === OUTCOME.notInterested || c.outcomeId === OUTCOME.doNotContact),
      outcomeTally: tally,
    };
    if (before.length) {
      const b = [...before].sort((a, b2) => b2.startTime.localeCompare(a.startTime))[0];
      flags.push({ kind: "prior-contact", evidence: `Called ${before.length}× before being added on ${m.addedAt!.slice(0, 10)}; last: ${b.outcomeId ? OUTCOME_LABEL[b.outcomeId] || "other outcome" : "no outcome logged"} by ${b.caller} on ${d(b)}` });
    }
    return { ...m, flags, history };
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


// ---------------------------------------------------------------- duplicates

// Per Jack: "in case a last name doesnt upload so then theres two contacts of
// the same person at the same company one with their first name the other
// with first and last" — plus phone and email, "email can confirm it with the
// highest success". Two DIFFERENT Apollo contacts are one person when, at the
// same company: the email matches (confirmed), or a phone matches, or the
// first names match and one has no last name (or the full names match).
// Shared inboxes never count as an email match.
export type DupReason = "email" | "phone" | "name";
export const DUP_REASON_META: Record<DupReason, { label: string; rank: number }> = {
  email: { label: "Same email, confirmed", rank: 0 },
  phone: { label: "Same phone", rank: 1 },
  name: { label: "Same name at the same company", rank: 2 },
};
const SHARED_INBOX_RE = /^(info|sales|admin|office|contact|hello|support|accounts?|billing|team|hr|it|help|service|marketing)@/i;

export interface DupGroup {
  key: string;
  company: string;
  reason: DupReason;          // strongest reason linking the group
  reasons: string[];          // plain-English evidence
  contacts: MemberResult[][]; // one entry per Apollo contact: every sequence membership it has
}

// One Apollo contact active in two or more of the checked sequences.
export interface MultiSequence { contactId: string; memberships: MemberResult[] }

// Same company, different people — across every checked sequence.
export interface CompanyGroup { key: string; company: string; members: MemberResult[] }

const lc = (s: string) => s.toLowerCase().trim();
const companyKeyOf = (m: SequenceMember) => m.domain || normCompany(m.company);

export function findDuplicates(members: MemberResult[]): DupGroup[] {
  const byId = new Map<string, MemberResult[]>();
  for (const m of members) (byId.get(m.contactId) || byId.set(m.contactId, []).get(m.contactId)!).push(m);
  const ids = [...byId.keys()];
  const parent = new Map(ids.map((i) => [i, i]));
  const find = (x: string): string => { while (parent.get(x) !== x) x = parent.get(x)!; return x; };
  const edges: { a: string; r: DupReason; ev: string }[] = [];
  const link = (a: string, b: string, r: DupReason, ev: string) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
    edges.push({ a, r, ev });
  };

  const index = (keyOf: (m: MemberResult) => string[]) => {
    const map = new Map<string, string[]>();
    for (const id of ids) for (const k of keyOf(byId.get(id)![0])) if (k) (map.get(k) || map.set(k, []).get(k)!).push(id);
    return map;
  };
  for (const [k, group] of index((m) => [m.email && !SHARED_INBOX_RE.test(m.email) ? lc(m.email) : ""]))
    for (const o of group.slice(1)) link(group[0], o, "email", `Same email: ${k}`);
  for (const [k, group] of index((m) => m.phones.map((p) => `${companyKeyOf(m)}|${p}`)))
    for (const o of group.slice(1)) link(group[0], o, "phone", `Same phone: ${k.split("|")[1]}`);
  for (const [, group] of index((m) => companyKeyOf(m) && m.firstName ? [`${companyKeyOf(m)}|${lc(m.firstName)}`] : [])) {
    for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
      const a = byId.get(group[i])![0], b = byId.get(group[j])![0];
      const la = lc(a.lastName), lb = lc(b.lastName);
      if (la && lb && la !== lb) continue;
      const ev = !la || !lb
        ? `"${(!la ? a : b).name}" has no last name, "${(!la ? b : a).name}" does`
        : `Same name: ${a.name}`;
      link(group[i], group[j], "name", ev);
    }
  }
  const best = new Map<string, DupReason>();
  const why = new Map<string, Set<string>>();
  for (const e of edges) {
    const root = find(e.a);
    const prev = best.get(root);
    if (!prev || DUP_REASON_META[e.r].rank < DUP_REASON_META[prev].rank) best.set(root, e.r);
    (why.get(root) || why.set(root, new Set()).get(root)!).add(e.ev);
  }

  const groups = new Map<string, string[]>();
  for (const id of ids) { const r = find(id); (groups.get(r) || groups.set(r, []).get(r)!).push(id); }
  return [...groups.entries()].filter(([, g]) => g.length > 1).map(([root, g]) => {
    const contacts = g.map((id) => byId.get(id)!);
    return {
      key: root,
      company: contacts.map((c) => c[0].company).find(Boolean) || contacts[0][0].domain,
      reason: best.get(root) || "name",
      reasons: [...(why.get(root) || [])],
      contacts,
    };
  }).sort((a, b) => DUP_REASON_META[a.reason].rank - DUP_REASON_META[b.reason].rank || a.company.localeCompare(b.company));
}

export function findMultiSequence(members: MemberResult[]): MultiSequence[] {
  const byId = new Map<string, MemberResult[]>();
  for (const m of members) (byId.get(m.contactId) || byId.set(m.contactId, []).get(m.contactId)!).push(m);
  return [...byId.entries()].filter(([, ms]) => new Set(ms.map((m) => m.sequenceId)).size > 1)
    .map(([contactId, memberships]) => ({ contactId, memberships }));
}

export function findCompanyGroups(members: MemberResult[]): CompanyGroup[] {
  const by = new Map<string, MemberResult[]>();
  for (const m of members) { const k = companyKeyOf(m); if (k) (by.get(k) || by.set(k, []).get(k)!).push(m); }
  return [...by.entries()]
    .filter(([, ms]) => new Set(ms.map((m) => m.contactId)).size > 1)
    .map(([key, ms]) => ({ key, company: ms.map((m) => m.company).find(Boolean) || key, members: ms }))
    .sort((a, b) => b.members.length - a.members.length || a.company.localeCompare(b.company));
}

/** Merge duplicates into the contact Jack chose to keep (Apollo's own merge:
 *  the kept contact keeps its values and gains the others' sequences, calls
 *  and history; the duplicates are deleted). Then, if Jack picked a note
 *  other than the kept contact's own, write that note onto it. */
export async function mergeContacts(masterId: string, duplicateIds: string[], note: string | null): Promise<void> {
  const h = await apollo();
  await call(h, "duplicate_contacts_merge", { contacts: [{ master_contact_id: masterId, duplicate_contact_ids: duplicateIds }] });
  if (note !== null) await call(h, "contacts_update", { id: masterId, typed_custom_fields: { [FIELD_NOTE]: note } });
}


// ---------------------------------------------------------------- recycle

// Per Jack: "a button in sequence scanner so i can click refresh and push to
// recycled sequences last 30 days or whatever i set the timeframe to". The
// rule is Carly Main Recycled's own description: leads that finished the main
// sequence with only no answer / gatekeeper / voicemail, pushed four business
// days after their tasks finished.
export const RECYCLE_REST_BUSINESS_DAYS = 4;
const RECYCLE_BLOCK_OUTCOMES = new Set<string>([
  OUTCOME.meetingBooked, OUTCOME.qualified, OUTCOME.infoRequested, OUTCOME.notInterested,
  OUTCOME.doNotContact, OUTCOME.callBack, OUTCOME.wrongNumber,
]);
// An early end (reply, bounce, unsubscribe, interest, a manual stop) is not a
// recycle; finishing the last step is.
const EARLY_END_RE = /repl|bounce|unsub|opt|interest|meeting|manual|stop|remov|ooo|out_of_office|spam|invalid/i;

export function addBusinessDays(iso: string, n: number): Date {
  const d = new Date(iso);
  let left = n;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) left--;
  }
  return d;
}

export interface RecycleCandidate {
  contactId: string;
  name: string;
  company: string;
  email: string;
  finishedAt: string;
  readyOn: string;   // YYYY-MM-DD
  ready: boolean;
  calls: number;
  lastOutcome: string;
}
export interface RecycleExcluded { contactId: string; name: string; company: string; reason: string }
export interface RecycleResult {
  sourceId: string;
  targetId: string;
  finished: number;
  keep: RecycleCandidate[];
  excluded: RecycleExcluded[];
}

/** Everyone who finished `source` in the last `days` days and belongs in
 *  `target`. Read-only; nothing is enrolled here. */
export async function findRecycleCandidates(
  source: ApolloSequence, target: ApolloSequence, days: number,
  recycledIds: string[], onStatus: (m: string) => void,
): Promise<RecycleResult> {
  const h = await apollo();
  const since = Date.now() - days * 86_400_000;
  const now = Date.now();
  type Raw = { c: Record<string, unknown>; st: Record<string, unknown>; all: Record<string, unknown>[] };
  const finished: Raw[] = [];
  for (let page = 1; page <= 100; page++) {
    onStatus(`Reading ${source.name}… page ${page}`);
    const p = await call<{ contacts?: Record<string, unknown>[]; pagination?: { total_pages?: number } }>(h, "contacts_search", {
      emailer_campaign_ids: [source.id], per_page: 100, page,
      fields: [{ contacts: ["id", "name", "email", "email_status", "email_unsubscribed", "organization_name", "account_id", "contact_stage_id", "deals",
        { contact_campaign_statuses: ["emailer_campaign_id", "status", "finished_at", "inactive_reason"] }] }],
    });
    for (const c of p.contacts || []) {
      const all = (c.contact_campaign_statuses as Record<string, unknown>[]) || [];
      const st = all.find((x) => x.emailer_campaign_id === source.id);
      const f = st?.finished_at ? Date.parse(String(st.finished_at)) : NaN;
      if (st && st.status === "finished" && f >= since) finished.push({ c, st, all });
    }
    if (!p.pagination || (p.pagination.total_pages ?? 1) <= page) break;
  }

  let replied = new Set<string>();
  try { replied = await fetchRepliedContactIds(h, source.id); } catch { /* counted below as unknown */ }

  let done = 0;
  const { byAccount: callsByAccount, failedContacts } = await callsByCompany(h,
    finished.map((r) => ({ contactId: String(r.c.id), accountId: String(r.c.account_id || "") })),
    () => onStatus(`Checking calls… ${++done}/${finished.length} contacts`));

  const keep: RecycleCandidate[] = []; const excluded: RecycleExcluded[] = [];
  const recycled = new Set(recycledIds);
  for (const { c, st, all } of finished) {
    const base = { contactId: String(c.id), name: String(c.name || ""), company: String(c.organization_name || "") };
    const no = (reason: string) => excluded.push({ ...base, reason });
    const reason = String(st.inactive_reason || "");
    const calls = failedContacts.has(base.contactId) ? null : (callsByAccount.get(String(c.account_id || "") || `contact:${base.contactId}`) || []);
    const mine = (calls || []).filter((x) => x.contactId === base.contactId);
    if (all.some((x) => x.status === "active" || x.status === "paused")) { no("Active in another sequence"); continue; }
    if (all.some((x) => recycled.has(String(x.emailer_campaign_id)))) { no("Already in a recycled sequence"); continue; }
    if (EARLY_END_RE.test(reason)) { no(`Ended early: ${reason.replace(/_/g, " ")}`); continue; }
    if (c.email_unsubscribed) { no("Unsubscribed"); continue; }
    if (/invalid|bounce/i.test(String(c.email_status || ""))) { no("Bad email"); continue; }
    if (c.contact_stage_id === STAGE_NOT_INTERESTED) { no("Stage: Not Interested"); continue; }
    if (Array.isArray(c.deals) && c.deals.length) { no("Has a deal"); continue; }
    if (replied.has(base.contactId)) { no("Replied"); continue; }
    if (calls === null) { no("Calls couldn't be read"); continue; }
    const bad = mine.find((x) => x.outcomeId && RECYCLE_BLOCK_OUTCOMES.has(x.outcomeId));
    if (bad) { no(OUTCOME_LABEL[bad.outcomeId!] || "Reached"); continue; }
    if ((calls || []).some((x) => x.duration >= RULES.deepCallSeconds)) { no("Call over 4 min at this company (among people checked)"); continue; }
    if (mine.some((x) => !x.outcomeId && x.note && CONVERSATION_RE.test(x.note))) { no("Call note shows a conversation"); continue; }
    const readyAt = addBusinessDays(String(st.finished_at), RECYCLE_REST_BUSINESS_DAYS);
    const last = [...mine].sort((a, b) => b.startTime.localeCompare(a.startTime))[0];
    keep.push({
      ...base, email: String(c.email || ""), finishedAt: String(st.finished_at).slice(0, 10),
      readyOn: readyAt.toISOString().slice(0, 10), ready: readyAt.getTime() <= now,
      calls: mine.length, lastOutcome: last ? (last.outcomeId ? OUTCOME_LABEL[last.outcomeId] || "Other" : "No outcome logged") : "",
    });
  }
  keep.sort((a, b) => a.finishedAt.localeCompare(b.finishedAt));
  return { sourceId: source.id, targetId: target.id, finished: finished.length, keep, excluded };
}

export interface PushResult { enrolled: string[]; skipped: Record<string, string> }

/** Enroll recycled leads. They finished the main sequence, so that check is
 *  waived; every other Apollo guard (active elsewhere, unverified email, same
 *  company already in the sequence) stays on. */
export async function pushToRecycled(targetId: string, contactIds: string[], mailboxId: string): Promise<PushResult> {
  const h = await apollo();
  const enrolled: string[] = []; const skipped: Record<string, string> = {};
  for (let i = 0; i < contactIds.length; i += 50) {
    const batch = contactIds.slice(i, i + 50);
    const p = await call<{ contacts?: { id: string; contact_campaign_statuses?: { emailer_campaign_id: string }[] }[]; skipped_contact_ids?: Record<string, string> }>(h,
      "emailer_campaigns_add_contact_ids", {
        id: targetId, emailer_campaign_id: targetId, contact_ids: batch,
        send_email_from_email_account_id: mailboxId, status: "active",
        sequence_finished_in_other_campaigns: true,
      });
    Object.assign(skipped, p.skipped_contact_ids || {});
    for (const c of p.contacts || [])
      if (!skipped[c.id] && (c.contact_campaign_statuses || []).some((s) => s.emailer_campaign_id === targetId)) enrolled.push(c.id);
  }
  return { enrolled, skipped };
}
