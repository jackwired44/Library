// Every lead ever scanned, from all three scanners — the Library's source
// of truth.
//
// Per Jack: "we need to make this the source of truth for leads … from raw
// lead to finished lead in this library", and "i will just upload the files
// again then store them going forward fresh library state as theyre
// uploaded".
//
// Deliberately NOT the existing Lead Library (lib/library.ts). That one
// files Strong Signal rows only, from the Main Scanner only, organised into
// up-to-3 files per month — a curated export shelf. This is the flat record
// of everything scanned, every tier, all three scanners, which is a
// different job. Neither replaces the other.
import { STORE_LEADS, dbGetAll, dbBulkPut, dbDelete } from "./db";

/** Which scanner produced the row. The three engines stay separate, so a
 *  lead carries where it came from rather than being normalised into one
 *  shape that would lose each scanner's own vocabulary. */
export type LeadSource = "main" | "smc" | "csp";

export const LEAD_SOURCE_META: Record<LeadSource, { label: string; short: string }> = {
  main: { label: "Main Scanner", short: "Main" },
  smc: { label: "Custom Scanner", short: "Custom" },
  csp: { label: "CSP Scanner", short: "CSP" },
};

/**
 * What Apollo says about this person right now.
 *
 * Written ONLY by a sync, never by a scan, and always replaced wholesale
 * rather than merged — it is a snapshot of live external state, so a
 * re-sync must be able to clear a sequence that ended, not just add new
 * ones. `syncedAt` is what makes staleness visible; a view that shows this
 * without showing its age is lying by omission.
 */
export interface ApolloLeadState {
  syncedAt: string;
  /** Every sequence this contact is in, with where it stands. A contact
   *  can hold several at once — one real contact is `finished` in one
   *  sequence and `active` in another, which a single flag would hide. */
  sequences: { name: string; status: string; step: number | null }[];
  /** Calls are AGGREGATED, not listed. Per Jack: "most people i call 5-20
   *  times each that doesnt matter … but it does for context of how many
   *  per person." 29,026 of 35,513 real calls are No Answer, so a per-call
   *  list is fourteen identical rows per lead carrying no extra meaning. */
  callCount: number;
  /** Outcome name -> how many times, e.g. {"No Answer": 14, "Left Voicemail": 2}. */
  outcomes: Record<string, number>;
  lastOutcome: string;
  lastCallAt: string;
}

export interface StoredLead {
  /** Match key: the email, else first-name + company. See leadKeyOf. */
  key: string;
  source: LeadSource;
  company: string;
  contact: string;
  title: string;
  email: string;
  phone: string;
  mobilePhone: string;
  /** The scanner's own product line / category wording, not normalised. */
  productArea: string;
  /** The scanner's own tier wording — "Strong Signal", "High priority", … */
  tier: string;
  /** The matched snippet / call brief the scanner wrote. */
  notes: string;
  score: number | null;
  firstSeenAt: string;
  lastSeenAt: string;
  sourceFiles: string[];
  timesSeen: number;
  /** Absent until a sync runs. Per Jack, nothing is written here before he
   *  uploads: "dont upload or update those numbers here or what sequence a
   *  lead is assigned to til i upload the files going forward." */
  apollo?: ApolloLeadState;
}

/* ------------------------------------------------------------ match key */

const LEGAL_SUFFIX_RE =
  /\b(inc|llc|l\.?l\.?c|ltd|limited|corp|corporation|co|company|plc|gmbh|sa|sas|bv|pty)\b/g;

/** Company names normalise through the same legal-suffix stripping the
 *  blocklist already uses, so "LCF Systems, Inc." and "LCF SYSTEMS" agree. */
export function normCompany(s: unknown): string {
  return String(s || "")
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .replace(LEGAL_SUFFIX_RE, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function normEmail(s: unknown): string {
  return String(s || "").trim().toLowerCase();
}

/**
 * The identity of a lead, for matching across uploads AND against Apollo.
 *
 * Email first: measured at 99.3% coverage across the real 7,709-row CSP
 * file, and unique.
 *
 * Fallback is FIRST name + company, not full name — measured, not
 * preferred. A real row scanned as `contact: "Josh Lewis"` became
 * `name: "Josh"` in Apollo, with the last name dropped, so a full-name key
 * misses it silently. First-name+company collides on 26 of 7,680 real keys
 * (0.34%), which is the price of matching at all.
 *
 * Returns "" when there is neither an email nor a name+company — such a row
 * cannot be keyed and is not stored, the same rule the Scanner's own
 * duplicate check and Contacts' merge already follow.
 */
export function leadKeyOf(email: unknown, contact: unknown, company: unknown): string {
  const e = normEmail(email);
  if (e.includes("@")) return `e:${e}`;
  const first = String(contact || "").trim().toLowerCase().split(/\s+/)[0] || "";
  const c = normCompany(company);
  if (!first || !c) return "";
  return `n:${first}|${c}`;
}

/* -------------------------------------------------------------- merging */

/** A lead as a scanner hands it over, before it is keyed or merged. */
export type LeadInput = Omit<
  StoredLead,
  "key" | "firstSeenAt" | "lastSeenAt" | "sourceFiles" | "timesSeen" | "apollo"
> & { sourceFile: string };

/** Keep an existing non-empty value; a later, sparser upload must never
 *  blank a field an earlier one filled in. Same rule as Contacts' merge. */
function fillBlank(existing: string, incoming: string): string {
  return String(existing || "").trim() ? existing : incoming;
}

/* ---------------------------------------------------------------- notes */

/**
 * Combining notes across uploads, per Jack: "i just want to combine the
 * notes not override with just the new one."
 *
 * Measured on his real files: of 648 people seen in more than one upload,
 * 635 carry DIFFERENT notes and only ONE is a pure subset of another. So
 * overwriting destroyed real intelligence 634 times out of 635 — the same
 * person arrives from the Main scanner with a seat count and from the CSP
 * scanner with a renewal date and billing term, and those are two reasons
 * to call, not two versions of one fact.
 *
 * Naive concatenation measured badly though: median 275 chars against 99
 * today, p90 417, one case at 50,010, and 80 notes printing the same
 * closing question twice. The CSP note is capped at 30 words precisely
 * because "our rep is just calling the lead and talking they dont need
 * super detailed specifics". So the combine is deliberate about three
 * things rather than a join:
 *
 *   1. The generated "Ask ..." / "and where the pain is" tail is
 *      scaffolding, not information about the lead, and it is identical
 *      across scans of the same product area. It is kept on the NEWEST
 *      note only and stripped from the older ones.
 *   2. A note already present is not added again, so re-uploading the
 *      same file is a no-op rather than unbounded growth. A note wholly
 *      contained in one already there is likewise skipped.
 *   3. A hard character cap, oldest segments dropped first, so one
 *      pathological row cannot grow without limit.
 */
const NOTE_SEP = "\n";
/** The generated question a brief ends on. Everything from "Ask " to the
 *  end, which is exactly how buildCallBrief and the CSP note compose it. */
const ASK_TAIL_RE = /\s*(?:Ask (?:if|how|what|who)\b.*)$/is;
/** A date marker this function wrote, so an existing combined note can be
 *  split back into its segments. */
const SEGMENT_RE = /^(\d{4}-\d{2}-\d{2}) · /;
export const NOTE_COMBINED_MAX = 600;

function stripAsk(s: string): string {
  return s.replace(ASK_TAIL_RE, "").trim();
}

/** The body of a note, for deciding whether we already hold it. */
function noteBody(s: string): string {
  return stripAsk(String(s || "").replace(SEGMENT_RE, "")).toLowerCase().replace(/\s+/g, " ").trim();
}

/** Split a stored combined note back into its dated segments, newest
 *  first. A note written before combining existed has no date marker and
 *  comes back as one undated segment, which is correct — we genuinely do
 *  not know when it was written. */
export function noteSegments(combined: string): { date: string; text: string }[] {
  const lines = String(combined || "").split(NOTE_SEP).map((l) => l.trim()).filter(Boolean);
  return lines.map((l) => {
    const m = l.match(SEGMENT_RE);
    return m ? { date: m[1], text: l.slice(m[0].length) } : { date: "", text: l };
  });
}

/**
 * Add `incoming` to `prevCombined`, newest first. Returns the combined
 * note, unchanged when there is nothing new to add.
 *
 * `when` is an ISO timestamp; only its date is kept, because two uploads
 * on the same day are the same sitting as far as a rep is concerned.
 */
export function combineNotes(prevCombined: string, incoming: string, when: string): string {
  const fresh = String(incoming || "").trim();
  const prev = String(prevCombined || "").trim();
  if (!fresh) return prev;
  // A lead's FIRST note is dated too. Returning it bare left the oldest
  // line of every timeline undated, which reads as "we don't know when
  // this was written" when in fact we do.
  if (!prev) return `${when.slice(0, 10)} · ${fresh}`;

  const segs = noteSegments(prev);
  const freshBody = noteBody(fresh);
  // Already hold it, or hold something that contains it.
  if (segs.some((s) => { const b = noteBody(s.text); return b === freshBody || b.includes(freshBody); })) {
    return prev;
  }

  const day = when.slice(0, 10);
  // The newest keeps its ask; everything older loses the scaffolding, and
  // an older segment that becomes empty once stripped is dropped.
  const older = segs
    .map((s) => {
      const body = stripAsk(s.text);
      if (!body) return null;
      return s.date ? `${s.date} · ${body}` : body;
    })
    .filter((x): x is string => x !== null);

  const out = [`${day} · ${fresh}`, ...older];
  // Cap by dropping the OLDEST first — the newest note is the one a rep
  // reads, so it must never be the part that gets cut.
  while (out.length > 1 && out.join(NOTE_SEP).length > NOTE_COMBINED_MAX) out.pop();
  return out.join(NOTE_SEP);
}

/** The single line to show in a table: the newest note, without its date
 *  marker. The full combined text goes on hover / in the detail view. */
export function newestNote(combined: string): string {
  return noteSegments(combined)[0]?.text || "";
}

/**
 * Merge freshly scanned leads into what is already stored.
 *
 * Pure — takes the current leads and returns the full next state plus what
 * changed, so the caller decides when to persist and nothing here reaches
 * for IndexedDB mid-merge.
 *
 * Re-scanning the same person UPDATES their scan-derived verdict (tier,
 * score, product area) rather than fill-blanking it: a re-upload is a
 * fresh read of that lead by the current rules, and the newer verdict is
 * the right one. Contact details still fill-blank, because a sparser
 * export dropping someone's phone number is not evidence they lost it.
 *
 * NOTES ARE THE EXCEPTION — they COMBINE rather than replace. Per Jack: "i
 * just want to combine the notes not override with just the new one." See
 * combineNotes for the measurement behind that and how the combine avoids
 * becoming a wall of text.
 *
 * `apollo` is never touched here — only a sync writes that.
 */
export function mergeLeads(
  existing: StoredLead[],
  incoming: LeadInput[],
  now = new Date().toISOString(),
): { leads: StoredLead[]; changed: StoredLead[]; added: number; updated: number; skipped: number } {
  const byKey = new Map<string, StoredLead>();
  for (const l of existing) byKey.set(l.key, l);

  const changed = new Map<string, StoredLead>();
  let added = 0, updated = 0, skipped = 0;

  for (const inc of incoming) {
    const key = leadKeyOf(inc.email, inc.contact, inc.company);
    if (!key) { skipped++; continue; }
    const prev = byKey.get(key);
    if (!prev) {
      const lead: StoredLead = {
        key,
        source: inc.source,
        company: inc.company,
        contact: inc.contact,
        title: inc.title,
        email: inc.email,
        phone: inc.phone,
        mobilePhone: inc.mobilePhone,
        productArea: inc.productArea,
        tier: inc.tier,
        notes: combineNotes("", inc.notes, now),
        score: inc.score,
        firstSeenAt: now,
        lastSeenAt: now,
        sourceFiles: inc.sourceFile ? [inc.sourceFile] : [],
        timesSeen: 1,
      };
      byKey.set(key, lead);
      changed.set(key, lead);
      added++;
      continue;
    }
    const lead: StoredLead = {
      ...prev,
      // Contact details: additive.
      company: fillBlank(prev.company, inc.company),
      contact: fillBlank(prev.contact, inc.contact),
      title: fillBlank(prev.title, inc.title),
      email: fillBlank(prev.email, inc.email),
      phone: fillBlank(prev.phone, inc.phone),
      mobilePhone: fillBlank(prev.mobilePhone, inc.mobilePhone),
      // Scan verdict: the newest scan wins.
      source: inc.source,
      productArea: inc.productArea || prev.productArea,
      tier: inc.tier || prev.tier,
      // The one scan-derived field that accumulates rather than replaces.
      notes: combineNotes(prev.notes, inc.notes, now),
      score: inc.score ?? prev.score,
      lastSeenAt: now,
      sourceFiles: inc.sourceFile && !prev.sourceFiles.includes(inc.sourceFile)
        ? [...prev.sourceFiles, inc.sourceFile]
        : prev.sourceFiles,
      timesSeen: prev.timesSeen + 1,
    };
    byKey.set(key, lead);
    changed.set(key, lead);
    updated++;
  }

  return {
    leads: [...byKey.values()],
    changed: [...changed.values()],
    added, updated, skipped,
  };
}

/* ---------------------------------------------------------- persistence */

export async function loadLeads(): Promise<StoredLead[]> {
  return dbGetAll<StoredLead>(STORE_LEADS);
}

/** One transaction for the whole batch — see dbBulkPut on why per-row
 *  writes are not an option at this volume. */
export async function saveLeads(leads: StoredLead[]): Promise<void> {
  await dbBulkPut(STORE_LEADS, leads);
}

export async function deleteLead(key: string): Promise<void> {
  await dbDelete(STORE_LEADS, key);
}

/* ------------------------------------------------------------- read-side */

/** Index for joining anything else to a lead by the same key space. */
export function buildLeadIndex(leads: StoredLead[]): Map<string, StoredLead> {
  const m = new Map<string, StoredLead>();
  for (const l of leads) m.set(l.key, l);
  return m;
}

/** Does this lead sit in a sequence that is still running? */
export function hasActiveSequence(l: StoredLead): boolean {
  return !!l.apollo?.sequences.some((s) => s.status === "active");
}

/** In Apollo, but every sequence it was in has ended. */
export function hasFinishedSequence(l: StoredLead): boolean {
  const seqs = l.apollo?.sequences ?? [];
  return seqs.length > 0 && !seqs.some((s) => s.status === "active");
}

/**
 * Never actually dialled.
 *
 * Per Jack, this is the point of the whole feature: "then i can filter
 * through leads i may never have contacted yet."
 *
 * Deliberately distinct from "not in Apollo". A lead can be sitting in a
 * sequence and still never have been called — on the real account 29,026
 * of 35,513 calls are No Answer and plenty of enrolled contacts carry none
 * at all. So this reads the call count, not the enrolment.
 *
 * A lead with NO Apollo state at all also counts as never contacted, which
 * is correct but only once a sync has run — before that every lead reads
 * this way, so the view must show the sync age beside it.
 */
export function neverContacted(l: StoredLead): boolean {
  return (l.apollo?.callCount ?? 0) === 0;
}

/** Distinct sequence names present across the whole store, for a filter. */
export function sequenceNamesIn(leads: StoredLead[]): string[] {
  const set = new Set<string>();
  for (const l of leads) for (const s of l.apollo?.sequences ?? []) set.add(s.name);
  return [...set].sort((a, b) => a.localeCompare(b));
}

/** "17 calls · No Answer x14, Voicemail x2" — the per-person context Jack
 *  asked for, without listing seventeen near-identical rows. */
export function outcomeSummary(a: ApolloLeadState | undefined): string {
  if (!a || a.callCount === 0) return "";
  const parts = Object.entries(a.outcomes)
    .sort((x, y) => y[1] - x[1])
    .map(([name, n]) => (n > 1 ? `${name} ×${n}` : name));
  return parts.join(", ");
}
