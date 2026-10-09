// Apollo state for leads the Library already holds.
//
// Per Jack: "once i upload the csv here going forward pull how many calls i
// have made to that contact from apollo and trellus and let me know every
// sequence its been assigned to current active on or finished and then i
// can filter through leads i may never have contacted yet."
//
// ---------------------------------------------------------------------
// WHY THIS IS AN IMPORT AND NOT A LIVE API CALL
// ---------------------------------------------------------------------
// The app is a static single-file bundle. It has no MCP runtime, so it
// cannot call Apollo itself — window.claude.use("mcp") exists only inside a
// published Artifact, and per CLAUDE.md this build is never published.
// Apollo is reachable from a Claude session, not from this page.
//
// The volume rules out a blind bulk pull anyway. Measured live on the real
// account: 136,371 contacts (no "in a sequence" filter, and the endpoint
// caps at 50,000 displayable), and 35,513 phone calls at roughly 5KB each
// because Apollo inlines the whole contact and account on every record.
//
// So the sync is LEAD-DRIVEN: the app knows which leads it holds, only
// those are ever looked up, and the result arrives as a small file. Nothing
// is fetched or written speculatively — Jack: "dont upload or update those
// numbers here or what sequence a lead is assigned to til i upload the
// files going forward."
import { guessColumn, type ParsedFile } from "./detection";
import { leadKeyOf, type ApolloLeadState, type ApolloSequenceState, type CallEvent, type StoredLead, type TaskEvent } from "./leadStore";

/** One contact's Apollo state, as it arrives in the sync file. */
export interface ApolloSyncRow {
  email: string;
  contact: string;
  company: string;
  sequences: ApolloSequenceState[];
  callCount: number;
  /** Emails sent. Absent when the file has no such column. */
  emailCount?: number;
  outcomes: Record<string, number>;
  lastOutcome: string;
  lastCallAt: string;
  /** Optional: a sync that carries only totals has none. */
  history?: CallEvent[];
  tasks?: TaskEvent[];
}

/* --------------------------------------------------------------- format */

// Header candidates, matched with the same tolerant guessColumn the lead
// CSVs and the Apollo company import already use — so a file exported
// straight out of Apollo's UI and one generated from the API both land,
// without a second mapper to keep in step.
const COL = {
  email: ["email", "workemail", "contactemail", "emailaddress"],
  contact: ["name", "fullname", "firstname", "contact", "contactname"],
  company: ["company", "companyname", "organization", "organizationname", "account"],
  sequences: ["sequences", "sequence", "campaign", "emailercampaign", "sequencename"],
  callCount: ["callcount", "calls", "numcalls", "totalcalls", "callsmade"],
  outcomes: ["outcomes", "calloutcomes", "dispositions", "outcome"],
  lastOutcome: ["lastoutcome", "lastdisposition", "latestoutcome"],
  lastCallAt: ["lastcall", "lastcallat", "lastcalled", "lastcalldate"],
  // Exact names only, and claimed FIRST: the matcher falls back to "header
  // contains candidate", so a loose "emails" here could grab — or be
  // grabbed by — the email ADDRESS column.
  emailCount: ["emailssent", "emailsent", "emailcount", "numemails", "emailsdelivered", "totalemails"],
  history: ["callhistory", "dispositionhistory", "callog", "calllog", "history"],
  tasks: ["tasks", "tasklog", "taskhistory", "sequencetasks"],
};

/**
 * Call history arrives as dated segments joined by `;`, newest or oldest
 * first in any order, each optionally naming the sequence and step:
 *   "2026-10-07 Meeting Booked @CSP Leads:2; 2026-10-01 No Answer @CSP Leads:1"
 * A segment with no parseable date is skipped rather than guessed at.
 */
export function parseHistoryCell(raw: unknown): CallEvent[] {
  const out: CallEvent[] = [];
  for (const chunk of String(raw || "").split(/[;|]/)) {
    const m = chunk.trim().match(/^(\d{4}-\d{2}-\d{2})(?:[T ][\d:.Z+-]*)?\s+(.+?)(?:\s*@\s*(.+?)(?::(\d+))?)?$/);
    if (!m) continue;
    out.push({
      at: m[1],
      outcome: m[2].trim(),
      ...(m[3] ? { sequence: m[3].trim() } : {}),
      ...(m[4] ? { step: Number(m[4]) } : {}),
    });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

/**
 * Sequences arrive as `Name:status:step:added:lastDone` joined by `;`, e.g.
 *   "Jack Main Sequence:active:3:2026-09-14:2026-10-02; Carly Outbound Emails:finished"
 * The two trailing dates (YYYY-MM-DD) are optional; anything that is not a
 * real day is ignored rather than stored.
 *
 * The step is optional because a finished enrolment has no meaningful
 * current step, and a plain sequence name with no status at all is read as
 * active — an Apollo UI export that lists only names still says something
 * true, and dropping those rows would be worse than assuming the common
 * case. A name is never invented: an empty segment is skipped entirely.
 */
export function parseSequenceCell(raw: unknown): ApolloSyncRow["sequences"] {
  const out: ApolloSyncRow["sequences"] = [];
  for (const chunk of String(raw || "").split(/[;|]/)) {
    const part = chunk.trim();
    if (!part) continue;
    const bits = part.split(":").map((b) => b.trim());
    const name = bits[0];
    if (!name) continue;
    const status = (bits[1] || "active").toLowerCase();
    const stepRaw = bits[2];
    const step = stepRaw && /^\d+$/.test(stepRaw) ? Number(stepRaw) : null;
    const isDay = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
    out.push({
      name, status, step,
      ...(isDay(bits[3]) ? { addedAt: bits[3] } : {}),
      ...(isDay(bits[4]) ? { lastDoneAt: bits[4] } : {}),
    });
  }
  return out;
}

/**
 * Tasks arrive as dated segments joined by `;`:
 *   "2026-10-08 call completed @Jack Main Sequence:3; 2026-10-06 call skipped @Jack Main Sequence:1"
 * A segment with no parseable date is skipped. Newest first.
 */
export function parseTaskCell(raw: unknown): TaskEvent[] {
  const out: TaskEvent[] = [];
  for (const chunk of String(raw || "").split(/[;|]/)) {
    const m = chunk.trim().match(/^(\d{4}-\d{2}-\d{2})\s+(\S+)\s+(\S+)(?:\s*@\s*(.+?)(?::(\d+))?)?$/);
    if (!m) continue;
    out.push({
      at: m[1], type: m[2], status: m[3].toLowerCase(),
      ...(m[4] ? { sequence: m[4].trim() } : {}),
      ...(m[5] ? { step: Number(m[5]) } : {}),
    });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

/**
 * Outcomes arrive as `Name xN` joined by `;`, e.g.
 *   "No Answer x14; Left Voicemail x2; Gatekeeper / Front Desk"
 *
 * A bare name with no count means one. Both the ASCII "x" and the real
 * multiplication sign are accepted, since the generated file uses the
 * latter for display and a hand-edited sheet will use the former.
 */
export function parseOutcomeCell(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const chunk of String(raw || "").split(/[;|]/)) {
    const part = chunk.trim();
    if (!part) continue;
    const m = part.match(/^(.*?)\s*[x×]\s*(\d+)$/i);
    const name = (m ? m[1] : part).trim();
    if (!name) continue;
    const n = m ? Number(m[2]) : 1;
    out[name] = (out[name] || 0) + (Number.isFinite(n) ? n : 1);
  }
  return out;
}

/** Read a sync file into rows. Unmapped columns are reported rather than
 *  guessed at, same contract as the Apollo company import. */
export function parseApolloSync(files: ParsedFile[]): {
  rows: ApolloSyncRow[];
  unmapped: string[];
  skipped: number;
} {
  const rows: ApolloSyncRow[] = [];
  const unmapped = new Set<string>();
  let skipped = 0;

  for (const f of files) {
    const taken = new Set<string>();
    const pick = (cands: string[]): string | null => {
      const col = guessColumn(f.fields, cands, taken);
      if (col) taken.add(col);
      return col;
    };
    const cEmails = pick(COL.emailCount);
    const cEmail = pick(COL.email);
    const cContact = pick(COL.contact);
    const cCompany = pick(COL.company);
    const cHist = pick(COL.history);
    const cTasks = pick(COL.tasks);
    const cSeq = pick(COL.sequences);
    const cCalls = pick(COL.callCount);
    const cOut = pick(COL.outcomes);
    const cLastOut = pick(COL.lastOutcome);
    const cLastAt = pick(COL.lastCallAt);
    for (const h of f.fields) if (!taken.has(h)) unmapped.add(h);

    const get = (r: Record<string, unknown>, c: string | null) =>
      c ? String(r[c] ?? "").trim() : "";

    for (const r of f.data) {
      const email = get(r, cEmail);
      const contact = get(r, cContact);
      const company = get(r, cCompany);
      // Unkeyable rows are counted, never silently dropped. A name with no
      // email and no company is kept: Apollo's task feed carries only the
      // contact's name, and applyApolloSync matches it by name — but only
      // when that name is unique in the store.
      if (!leadKeyOf(email, contact, company) && !contact) { skipped++; continue; }
      const history = parseHistoryCell(get(r, cHist));
      // A file carrying only the dated history still answers "how many
      // calls" and "what happened" — tallied from it, never left at zero.
      const outcomes = parseOutcomeCell(get(r, cOut));
      if (Object.keys(outcomes).length === 0) for (const h of history) outcomes[h.outcome] = (outcomes[h.outcome] || 0) + 1;
      const statedCalls = Number(get(r, cCalls));
      // A stated count wins; otherwise the outcome tallies ARE the count,
      // so a file carrying only outcomes still answers "how many calls".
      const summed = Object.values(outcomes).reduce((a, b) => a + b, 0);
      rows.push({
        email, contact, company,
        sequences: parseSequenceCell(get(r, cSeq)),
        callCount: Number.isFinite(statedCalls) && statedCalls > 0 ? statedCalls : summed,
        ...(cEmails && get(r, cEmails) !== "" && Number.isFinite(Number(get(r, cEmails)))
          ? { emailCount: Number(get(r, cEmails)) } : {}),
        outcomes,
        lastOutcome: get(r, cLastOut),
        lastCallAt: get(r, cLastAt),
        history,
        tasks: parseTaskCell(get(r, cTasks)),
      });
    }
  }
  return { rows, unmapped: [...unmapped], skipped };
}

/* ---------------------------------------------------------------- apply */

/**
 * Write Apollo state onto the leads it matches.
 *
 * Replaced wholesale, never merged: this is a snapshot of live external
 * state, so a re-sync has to be able to clear a sequence that ended or a
 * call count that was wrong, not only add to it. Merging would make the
 * record monotonically grow and quietly stop being true.
 *
 * A sync row that matches no stored lead is counted and returned, not
 * dropped — it usually means that person was never scanned here, which is
 * worth seeing rather than silently discarding.
 */
export function applyApolloSync(
  leads: StoredLead[],
  rows: ApolloSyncRow[],
  syncedAt = new Date().toISOString(),
): {
  leads: StoredLead[]; changed: StoredLead[]; matched: number; unmatched: ApolloSyncRow[];
  /** How many of `matched` were matched on full name alone. */
  matchedByName: number;
  /** Rows whose name fits more than one stored lead — left unmatched. */
  ambiguous: number;
} {
  const byKey = new Map<string, StoredLead>();
  for (const l of leads) byKey.set(l.key, l);
  // Full-name index for rows that carry nothing else. A name shared by two
  // stored leads is marked ambiguous and never guessed between.
  const byName = new Map<string, string | null>();
  for (const l of leads) {
    const n = normName(l.contact);
    if (!n || !n.includes(" ")) continue;
    byName.set(n, byName.has(n) ? null : l.key);
  }
  let matchedByName = 0;
  let ambiguous = 0;

  const changed: StoredLead[] = [];
  const unmatched: ApolloSyncRow[] = [];
  let matched = 0;

  for (const r of rows) {
    let key = leadKeyOf(r.email, r.contact, r.company);
    let lead = key ? byKey.get(key) : undefined;
    if (!lead && !r.email && !r.company) {
      const n = normName(r.contact);
      const hit = byName.get(n);
      if (hit === null) ambiguous++;
      else if (hit) { key = hit; lead = byKey.get(hit); if (lead) matchedByName++; }
    }
    if (!lead || !key) { unmatched.push(r); continue; }
    // A task-only sync (Apollo's task feed) carries sequences, tasks and a
    // call count, but no outcomes, no call history and no email count.
    // Absent is unknown, not zero, so those carry over from the last sync
    // rather than being wiped by a file that never contained them.
    const prev = lead.apollo;
    const taskOnly = !!r.tasks?.length && Object.keys(r.outcomes).length === 0 && !r.history?.length;
    const keep = taskOnly && prev;
    const apollo: ApolloLeadState = {
      syncedAt,
      sequences: r.sequences,
      callCount: keep ? Math.max(prev.callCount, r.callCount) : r.callCount,
      ...(r.emailCount !== undefined ? { emailCount: r.emailCount }
        : keep && prev.emailCount !== undefined ? { emailCount: prev.emailCount } : {}),
      outcomes: keep ? prev.outcomes : r.outcomes,
      lastOutcome: r.lastOutcome || r.history?.[0]?.outcome || (keep ? prev.lastOutcome : ""),
      lastCallAt: r.lastCallAt || r.history?.[0]?.at || (keep ? prev.lastCallAt : ""),
      ...(r.history?.length ? { history: r.history } : keep && prev.history ? { history: prev.history } : {}),
      ...(r.tasks?.length ? { tasks: r.tasks } : {}),
    };
    const next = { ...lead, apollo };
    byKey.set(key, next);
    changed.push(next);
    matched++;
  }

  return { leads: [...byKey.values()], changed, matched, unmatched, matchedByName, ambiguous };
}

const normName = (s: string) => s.toLowerCase().replace(/[^a-z\s'-]/g, " ").replace(/\s+/g, " ").trim();

/* ------------------------------------------------------------ staleness */

export const SYNC_STALE_DAYS = 14;

/** How old the newest sync is, in whole days, or null if nothing is
 *  synced. A view that shows Apollo state without showing this is lying by
 *  omission — "never contacted" reads identically to "never synced". */
export function syncAgeDays(leads: StoredLead[], now = Date.now()): number | null {
  let newest = 0;
  for (const l of leads) {
    const t = l.apollo ? Date.parse(l.apollo.syncedAt) : NaN;
    if (Number.isFinite(t) && t > newest) newest = t;
  }
  if (!newest) return null;
  return Math.max(0, Math.floor((now - newest) / 86_400_000));
}

/** The leads a sync should ask Apollo about: everything held, newest
 *  activity first so a bounded pull covers what is actually being worked.
 *  Exported so the request file can be generated from the app rather than
 *  guessed at on the Apollo side. */
export function leadsToSync(leads: StoredLead[]): StoredLead[] {
  return [...leads].sort((a, b) => (a.lastSeenAt < b.lastSeenAt ? 1 : -1));
}
