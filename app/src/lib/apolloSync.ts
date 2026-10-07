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
import { leadKeyOf, type ApolloLeadState, type StoredLead } from "./leadStore";

/** One contact's Apollo state, as it arrives in the sync file. */
export interface ApolloSyncRow {
  email: string;
  contact: string;
  company: string;
  sequences: { name: string; status: string; step: number | null }[];
  callCount: number;
  outcomes: Record<string, number>;
  lastOutcome: string;
  lastCallAt: string;
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
};

/**
 * Sequences arrive as `Name:status:step` joined by `;`, e.g.
 *   "Jack Main Sequence:active:3; Carly Outbound Emails:finished"
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
    out.push({ name, status, step });
  }
  return out;
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
    const cEmail = pick(COL.email);
    const cContact = pick(COL.contact);
    const cCompany = pick(COL.company);
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
      // Unkeyable rows are counted, never silently dropped.
      if (!leadKeyOf(email, contact, company)) { skipped++; continue; }
      const outcomes = parseOutcomeCell(get(r, cOut));
      const statedCalls = Number(get(r, cCalls));
      // A stated count wins; otherwise the outcome tallies ARE the count,
      // so a file carrying only outcomes still answers "how many calls".
      const summed = Object.values(outcomes).reduce((a, b) => a + b, 0);
      rows.push({
        email, contact, company,
        sequences: parseSequenceCell(get(r, cSeq)),
        callCount: Number.isFinite(statedCalls) && statedCalls > 0 ? statedCalls : summed,
        outcomes,
        lastOutcome: get(r, cLastOut),
        lastCallAt: get(r, cLastAt),
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
): { leads: StoredLead[]; changed: StoredLead[]; matched: number; unmatched: ApolloSyncRow[] } {
  const byKey = new Map<string, StoredLead>();
  for (const l of leads) byKey.set(l.key, l);

  const changed: StoredLead[] = [];
  const unmatched: ApolloSyncRow[] = [];
  let matched = 0;

  for (const r of rows) {
    const key = leadKeyOf(r.email, r.contact, r.company);
    const lead = key ? byKey.get(key) : undefined;
    if (!lead) { unmatched.push(r); continue; }
    const apollo: ApolloLeadState = {
      syncedAt,
      sequences: r.sequences,
      callCount: r.callCount,
      outcomes: r.outcomes,
      lastOutcome: r.lastOutcome,
      lastCallAt: r.lastCallAt,
    };
    const next = { ...lead, apollo };
    byKey.set(key, next);
    changed.push(next);
    matched++;
  }

  return { leads: [...byKey.values()], changed, matched, unmatched };
}

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
