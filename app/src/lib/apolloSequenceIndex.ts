// Apollo sequence index — "has this lead ever been put in a sequence?"
//
// Per Jack: "when the leads are uploaded we know if they have ever been
// added to apollo sequences so we dont duplicate leads to sequences and we
// know where each contact stands."
//
// WHY AN INDEX RATHER THAN A LOOKUP PER UPLOAD. Apollo's contact search has
// no filter for "these N emails" and no campaign filter at all (verified
// against the live account, 30 Sep 2026) — the only way to ask about one
// person is a search per person. A 500-row CSV would mean 500 calls before
// the Scanner could draw a single row. So instead this syncs ONCE into a
// local index keyed by email, and every upload afterwards answers from
// memory with zero network. The index is explicitly refreshed, never
// silently in the background — same rule as every other Apollo touchpoint
// here (Jack: "i dont want too much going on in the background i cant
// see").
//
// WHY THE TASK ROSTER IS NOT USED. apollo_tasks_search looks like the
// natural way to list who is in a sequence, but a task's contact is
// {id, name, linkedin_url} with NO email and NO company — it cannot be
// matched back to a Scanner lead. apollo_contacts_search returns the email
// AND emailer_campaign_ids on the same record, which is what makes one
// pass sufficient.
//
// SCOPE. Only sequences owned by the people in OWNER_EMAILS count, per
// Jack: "just jack and carly that is it." A lead sitting in someone else's
// sequence is deliberately NOT reported as already-sequenced, because it
// isn't in a cadence either of them runs.
import { dbGetAll, dbPutMany, dbClear, STORE_APOLLO_INDEX } from "./db";
import { getMcp, describeApolloError } from "./apolloEnrich";
import type { ClaudeMcpNamespace } from "./claudeRuntime";
import { normalizeDupKey } from "./detection";
import type { ResultRow } from "./detection";
import type { Contact } from "./contacts";

/** Whose sequences count. Matched on email so an Apollo user id change
 *  can't silently empty the index. */
export const OWNER_EMAILS = ["jack@wiredcio.com", "carly@wiredcio.com"];

/** Apollo pages contacts at 100; anything larger is refused upstream. */
const PAGE_SIZE = 100;
/** A hard ceiling so a runaway sync can't page forever. 300 pages covers
 *  ~30,000 contacts, comfortably past the ~19,700 loaded in six months. */
const MAX_PAGES = 300;

export interface ApolloSequenceRef {
  id: string;
  name: string;
  /** Apollo's own enrollment status: "active", "finished", "paused", … */
  status: string;
  /** Why it stopped, when Apollo says (e.g. "Completed last step"). */
  reason?: string;
  /** Which step the contact reached. */
  step?: number;
  addedAt?: string;
  finishedAt?: string;
}

export interface ApolloIndexEntry {
  /** Normalised email — the store's key. */
  key: string;
  apolloContactId: string;
  email: string;
  name?: string;
  company?: string;
  /** In-scope sequences only (see SCOPE above). Empty array means the
   *  contact exists in Apollo but has never been in one of theirs. */
  sequences: ApolloSequenceRef[];
  /** How many sequences the contact is in overall, including other
   *  people's. Kept so "in someone else's cadence" is still visible
   *  rather than reading as untouched. */
  totalSequences: number;
  lastActivityAt?: string | null;
  syncedAt: string;
}

export function emailKey(email: string | undefined | null): string {
  return String(email || "").trim().toLowerCase();
}

/* ------------------------------------------------------------------ */
/* Persistence                                                         */
/* ------------------------------------------------------------------ */

export async function loadApolloIndex(): Promise<Map<string, ApolloIndexEntry>> {
  const rows = await dbGetAll<ApolloIndexEntry>(STORE_APOLLO_INDEX);
  const map = new Map<string, ApolloIndexEntry>();
  rows.forEach((r) => { if (r && r.key) map.set(r.key, r); });
  return map;
}

export async function persistApolloEntries(entries: ApolloIndexEntry[]): Promise<void> {
  await dbPutMany(STORE_APOLLO_INDEX, entries);
}

export async function clearApolloIndex(): Promise<void> {
  await dbClear(STORE_APOLLO_INDEX);
}

/* ------------------------------------------------------------------ */
/* Reading the index                                                   */
/* ------------------------------------------------------------------ */

/** Email first, then the same normalised name+company key the Scanner's
 *  own duplicate check and Contacts' merge fallback already use — so a
 *  lead with no email on the CSV still resolves when Apollo has one. */
export function lookupApollo(
  index: Map<string, ApolloIndexEntry>,
  email: string,
  fullName: string,
  company: string
): ApolloIndexEntry | null {
  const ek = emailKey(email);
  if (ek) {
    const hit = index.get(ek);
    if (hit) return hit;
  }
  const nk = nameCompanyKey(fullName, company);
  if (!nk) return null;
  for (const entry of index.values()) {
    if (nameCompanyKey(entry.name || "", entry.company || "") === nk) return entry;
  }
  return null;
}

function nameCompanyKey(name: string, company: string): string {
  const n = normalizeDupKey(name);
  const c = normalizeDupKey(company);
  return n && c ? `${n}|${c}` : "";
}

/** What to show on a row. `unknown` means the index has never been synced,
 *  which must never be drawn as "never sequenced" — that would be a
 *  confident wrong answer. */
export type SequenceStanding = "unknown" | "not-in-apollo" | "never-sequenced" | "in-sequence" | "finished" | "other-owner";

export interface LeadStanding {
  standing: SequenceStanding;
  sequences: ApolloSequenceRef[];
  label: string;
}

export function standingFor(entry: ApolloIndexEntry | null, synced: boolean): LeadStanding {
  if (!synced) return { standing: "unknown", sequences: [], label: "Not checked" };
  if (!entry) return { standing: "not-in-apollo", sequences: [], label: "Not in Apollo" };
  if (entry.sequences.length) {
    const active = entry.sequences.filter((s) => s.status === "active");
    if (active.length) {
      return {
        standing: "in-sequence",
        sequences: entry.sequences,
        label: active.length === 1 ? `In ${active[0].name}` : `In ${active.length} sequences`,
      };
    }
    return {
      standing: "finished",
      sequences: entry.sequences,
      label: entry.sequences.length === 1 ? `Finished ${entry.sequences[0].name}` : "Finished sequences",
    };
  }
  if (entry.totalSequences > 0) {
    return { standing: "other-owner", sequences: [], label: "In someone else's sequence" };
  }
  return { standing: "never-sequenced", sequences: [], label: "Never sequenced" };
}

/** Everything we already know about a freshly scanned lead. Three
 *  independent questions, per Jack: has this person been in one of our
 *  sequences, have they ever actually been contacted, and have we seen
 *  them (or anyone at their company) in a past upload.
 *
 *  Only the first needs Apollo. The other two come from the Contacts
 *  directory this app already keeps, which captures every row of every
 *  upload — so they cost nothing and work even with Apollo disconnected. */
export interface LeadHistory {
  apolloStanding: SequenceStanding;
  apolloStandingLabel: string;
  apolloSequences: ApolloSequenceRef[];
  /** This exact person has appeared in an earlier upload. */
  seenBefore: boolean;
  timesSeen: number;
  firstSeenAt?: string;
  /** Files they appeared in before today's upload. */
  priorFiles: string[];
  /** Somebody at this company has been worked or sequenced, even if this
   *  particular person is new to us. */
  companyPriorContacts: number;
  companyInSequence: boolean;
  /** A real outreach record exists: a logged call/email, a disposition, or
   *  Apollo activity. */
  contactedBefore: boolean;
}

interface HistoryContext {
  contacts: Contact[];
  index: Map<string, ApolloIndexEntry>;
  synced: boolean;
}

/** Stamp freshly scanned rows with their history, in place, before
 *  anything is shown or recorded — the same position and contract as
 *  applyStickyState. Costs no network: it reads the already-synced index
 *  and the local Contacts directory. */
export function applyLeadHistory(
  rows: ResultRow[],
  ctx: HistoryContext
): { inSequence: number; seenBefore: number; contactedBefore: number; fresh: number; unknown: number } {
  // Company rollups, built once per call rather than scanned per row.
  const byCompany = new Map<string, Contact[]>();
  ctx.contacts.forEach((c) => {
    const k = normalizeDupKey(c.company || "");
    if (!k) return;
    const list = byCompany.get(k);
    if (list) list.push(c); else byCompany.set(k, [c]);
  });
  const sequencedCompanies = new Set<string>();
  ctx.index.forEach((e) => {
    if (!e.sequences.length) return;
    const k = normalizeDupKey(e.company || "");
    if (k) sequencedCompanies.add(k);
  });

  const contactIdx = new Map<string, Contact>();
  ctx.contacts.forEach((c) => {
    const ek = emailKey(c.email);
    if (ek) contactIdx.set(ek, c);
  });

  let inSequence = 0, seenBefore = 0, contactedBefore = 0, fresh = 0, unknown = 0;

  rows.forEach((r) => {
    const f = r.row.__f;
    const email = String(f.email || "");
    const company = String(f.company || "");
    const name = getRowName(f);

    const entry = lookupApollo(ctx.index, email, name, company);
    const st = standingFor(entry, ctx.synced);

    // Prior uploads. timesSeen is incremented by the merge that runs AFTER
    // this, so a value already >= 1 here means an earlier upload, not this
    // one. A contact matched only by name+company still counts.
    const prior = contactIdx.get(emailKey(email)) ||
      ctx.contacts.find((c) =>
        normalizeDupKey(getFullNameOf(c)) === normalizeDupKey(name) &&
        normalizeDupKey(c.company || "") === normalizeDupKey(company) &&
        normalizeDupKey(name) !== "" && normalizeDupKey(company) !== "") || null;

    const companyKey = normalizeDupKey(company);
    const companyPeers = companyKey ? (byCompany.get(companyKey) || []) : [];
    const peersExcludingSelf = prior
      ? companyPeers.filter((c) => c.id !== prior.id).length
      : companyPeers.length;

    const wasContacted = Boolean(
      prior && (
        (prior.callCount || 0) > 0 ||
        (prior.emailCount || 0) > 0 ||
        (prior.disposition && prior.disposition !== "none")
      )
    ) || Boolean(entry && entry.lastActivityAt);

    const history: LeadHistory = {
      apolloStanding: st.standing,
      apolloStandingLabel: st.label,
      apolloSequences: st.sequences,
      seenBefore: Boolean(prior),
      timesSeen: prior?.timesSeen || 0,
      firstSeenAt: prior?.firstSeenAt,
      priorFiles: prior?.sourceFiles ? prior.sourceFiles.slice(0, 6) : [],
      companyPriorContacts: peersExcludingSelf,
      companyInSequence: companyKey ? sequencedCompanies.has(companyKey) : false,
      contactedBefore: wasContacted,
    };
    r.leadHistory = history;

    if (st.standing === "in-sequence" || st.standing === "finished") inSequence += 1;
    if (history.seenBefore) seenBefore += 1;
    if (history.contactedBefore) contactedBefore += 1;
    if (st.standing === "unknown") unknown += 1;
    if (!history.seenBefore && !history.contactedBefore &&
        st.standing !== "in-sequence" && st.standing !== "finished") fresh += 1;
  });

  return { inSequence, seenBefore, contactedBefore, fresh, unknown };
}

function getFullNameOf(c: Contact): string {
  return (c.fullName || `${c.firstName || ""} ${c.lastName || ""}`).trim();
}

function getRowName(f: { firstName?: unknown; lastName?: unknown; fullName?: unknown }): string {
  const full = String(f.fullName || "").trim();
  if (full) return full;
  return `${String(f.firstName || "").trim()} ${String(f.lastName || "").trim()}`.trim();
}

/* ------------------------------------------------------------------ */
/* Syncing                                                             */
/* ------------------------------------------------------------------ */

export interface SyncProgress {
  page: number;
  scanned: number;
  indexed: number;
  inSequence: number;
  done: boolean;
  message?: string;
}

interface ApolloHandle {
  server: string;
  contactsTool: string;
  usersTool: string;
  campaignsTool: string;
}

async function resolveHandle(mcp: ClaudeMcpNamespace): Promise<ApolloHandle | null> {
  const { servers } = await mcp.listTools();
  for (const s of servers) {
    if (!s.server.toLowerCase().includes("apollo")) continue;
    const find = (frag: string) => s.tools.find((t) => t.name.toLowerCase().includes(frag))?.name;
    const contactsTool = find("contacts_search");
    const usersTool = find("users_search");
    const campaignsTool = find("emailer_campaigns_search");
    if (contactsTool && campaignsTool) {
      return { server: s.server, contactsTool, usersTool: usersTool || "", campaignsTool };
    }
  }
  return null;
}

function payloadOf(res: { payload?: unknown }): Record<string, unknown> {
  const p = res.payload;
  return p && typeof p === "object" ? (p as Record<string, unknown>) : {};
}

/** The in-scope sequences: owned by OWNER_EMAILS. Returns id -> name. */
async function resolveScopedSequences(
  mcp: ClaudeMcpNamespace,
  h: ApolloHandle
): Promise<{ map: Map<string, string>; ownerCount: number }> {
  const ownerIds = new Set<string>();
  if (h.usersTool) {
    const res = await mcp.callTool(h.server, h.usersTool, { per_page: 100 }, { cache: { staleTime: 300000 } });
    const users = (payloadOf(res).users as Array<Record<string, unknown>>) || [];
    users.forEach((u) => {
      const em = String(u.email || "").trim().toLowerCase();
      if (OWNER_EMAILS.includes(em)) ownerIds.add(String(u.id));
    });
  }
  const res = await mcp.callTool(h.server, h.campaignsTool, { per_page: "100", page: "1" }, { cache: { staleTime: 300000 } });
  const campaigns = (payloadOf(res).emailer_campaigns as Array<Record<string, unknown>>) || [];
  const map = new Map<string, string>();
  campaigns.forEach((c) => {
    // With no user roster resolvable, fall back to every sequence rather
    // than silently indexing nothing — an empty scope would make every
    // lead read "never sequenced", which is the dangerous wrong answer.
    if (!ownerIds.size || ownerIds.has(String(c.user_id))) {
      map.set(String(c.id), String(c.name || "Untitled sequence"));
    }
  });
  return { map, ownerCount: ownerIds.size };
}

/**
 * Walks Apollo's contacts newest-first and builds the index. Explicit,
 * resumable (pass the page it stopped at) and stoppable. Every call is a
 * read and consumes no Apollo credits.
 */
export async function syncApolloSequenceIndex(opts: {
  onProgress: (p: SyncProgress) => void;
  shouldStop: () => boolean;
  startPage?: number;
  /** Stop once a page's contacts are all older than this ISO date. */
  createdAfter?: string;
}): Promise<{ ok: boolean; message: string; lastPage: number; indexed: number }> {
  const mcp = await getMcp();
  if (!mcp) {
    return { ok: false, message: "Apollo isn't reachable from this view. Open the platform from claude.ai.", lastPage: 0, indexed: 0 };
  }

  let h: ApolloHandle | null;
  let scoped: { map: Map<string, string>; ownerCount: number };
  try {
    h = await resolveHandle(mcp);
    if (!h) {
      return { ok: false, message: "No Apollo connector with contact search is available to you.", lastPage: 0, indexed: 0 };
    }
    scoped = await resolveScopedSequences(mcp, h);
  } catch (err) {
    return { ok: false, message: describeApolloError(err), lastPage: 0, indexed: 0 };
  }

  const startPage = Math.max(1, opts.startPage || 1);
  let scanned = 0;
  let indexed = 0;
  let inSequence = 0;
  let page = startPage;

  for (; page <= MAX_PAGES; page++) {
    if (opts.shouldStop()) {
      return { ok: true, message: `Stopped at page ${page}. ${indexed.toLocaleString()} leads indexed.`, lastPage: page, indexed };
    }
    let contacts: Array<Record<string, unknown>>;
    try {
      const res = await mcp.callTool(h.server, h.contactsTool, {
        per_page: PAGE_SIZE,
        page,
        sort_by_field: "contact_created_at",
        sort_ascending: false,
      }, { cache: { staleTime: 60000 } });
      contacts = (payloadOf(res).contacts as Array<Record<string, unknown>>) || [];
    } catch (err) {
      return { ok: false, message: `${describeApolloError(err)} (stopped at page ${page})`, lastPage: page, indexed };
    }

    if (!contacts.length) break;

    const batch: ApolloIndexEntry[] = [];
    let allOlder = Boolean(opts.createdAfter);
    for (const c of contacts) {
      scanned += 1;
      const created = String(c.created_at || "");
      if (opts.createdAfter && created >= opts.createdAfter) allOlder = false;

      const email = String(c.email || "").trim();
      const key = emailKey(email);
      // No email and no usable name+company is unmatchable — skip rather
      // than store a row nothing can ever look up.
      const nm = String(c.name || "").trim();
      const co = String(c.organization_name || "").trim();
      if (!key && !nameCompanyKey(nm, co)) continue;

      const allIds = (c.emailer_campaign_ids as string[]) || [];
      const statuses = (c.contact_campaign_statuses as Array<Record<string, unknown>>) || [];
      const sequences: ApolloSequenceRef[] = [];
      statuses.forEach((s) => {
        const cid = String(s.emailer_campaign_id || "");
        const name = scoped.map.get(cid);
        if (!name) return; // out of scope — someone else's sequence
        sequences.push({
          id: cid,
          name,
          status: String(s.status || "unknown"),
          reason: s.inactive_reason ? String(s.inactive_reason) : undefined,
          step: typeof s.current_step_position === "number" ? s.current_step_position : undefined,
          addedAt: s.added_at ? String(s.added_at) : undefined,
          finishedAt: s.finished_at ? String(s.finished_at) : undefined,
        });
      });
      // A contact can carry a campaign id with no status row; count it as
      // in-scope membership anyway rather than losing it.
      allIds.forEach((cid) => {
        const name = scoped.map.get(cid);
        if (name && !sequences.some((s) => s.id === cid)) {
          sequences.push({ id: cid, name, status: "unknown" });
        }
      });

      if (sequences.length) inSequence += 1;
      batch.push({
        key: key || `nc:${nameCompanyKey(nm, co)}`,
        apolloContactId: String(c.id || ""),
        email,
        name: nm || undefined,
        company: co || undefined,
        sequences,
        totalSequences: allIds.length,
        lastActivityAt: c.last_activity_date ? String(c.last_activity_date) : null,
        syncedAt: new Date().toISOString(),
      });
    }

    await persistApolloEntries(batch);
    indexed += batch.length;
    opts.onProgress({ page, scanned, indexed, inSequence, done: false });

    if (contacts.length < PAGE_SIZE) break;
    if (allOlder) break;
  }

  opts.onProgress({ page, scanned, indexed, inSequence, done: true });
  const scopeNote = scoped.ownerCount
    ? ""
    : " (couldn't resolve Jack or Carly in Apollo, so every sequence was counted — check the owner emails)";
  return {
    ok: true,
    message: `Indexed ${indexed.toLocaleString()} leads · ${inSequence.toLocaleString()} already in a sequence${scopeNote}.`,
    lastPage: page,
    indexed,
  };
}
