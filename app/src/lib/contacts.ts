// Contacts — a permanent, cross-upload directory of every person seen in
// any CSV upload (Scanner or Library's direct-into-folder flow) — every row
// of every upload, per Jack's explicit call, not just rows the detection
// engine found a Dynamics/M365/licensing signal on. Broader than both the
// Scanner's results (Strong Signal/Needs Review/Bad Leads only — a row
// with zero signal never becomes a ResultRow at all, see scanRowUnified)
// and the Library itself (which only ever files Strong Signal leads) —
// this is the full universe of contacts ever uploaded, deduplicated
// permanently rather than the Scanner's own single-batch-scoped duplicate
// check.
//
// Dedup key, per Jack's explicit call: email first (the most stable
// identity for the same real person across different lead lists, since
// company name/spelling can vary upload to upload), name+company fallback
// (same normalization as the Scanner's batch-scoped duplicate check —
// case/whitespace-insensitive, exact match, no fuzzy matching) when a row
// has no email. A row with neither still gets a Contact record, it's just
// never matched as a duplicate of anything else.
import { dbGetAll, dbPut, dbDelete, STORE_CONTACTS } from "./db";
import { computeFileFieldMapping, getEmailDomain, getFullName, isFreeEmailDomain, resolveRowFields, type CategoryKey, type Disposition, type ParsedFile, type ResolvedFields, type ResultRow, type Tier } from "./detection";

export interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  title: string;
  company: string;
  email: string;
  workPhone: string;
  mobilePhone: string;
  employees: string;
  productArea: string;
  sourceFiles: string[];
  firstSeenAt: string;
  lastSeenAt: string;
  timesSeen: number;
  // Scan-derived, at-a-glance fields — per Jack: "find the contacts matched
  // snippet/summarized note post scan... same with the product line and
  // disposition from a glance." Optional because most contacts never clear
  // detection (see the module comment above) — those just read blank.
  // Deliberately a SNAPSHOT of the most recent scan that touched this
  // contact, not a live sync of later Scanner/Library edits — same
  // no-auto-sync precedent as filed Library rows (see CLAUDE.md). A
  // re-upload/re-scan of the same person is what refreshes these.
  category?: CategoryKey;
  // Strong Signal / Needs Review / Bad Lead, from the same scan pass that
  // set category/matchedSnippet — added so Contacts can be filtered by
  // tier (see CLAUDE.md "Contacts: tier + date filtering"). Same snapshot
  // semantics as category/matchedSnippet, not disposition's sticky/
  // persistent contract below.
  tier?: Tier;
  matchedSnippet?: string;
  disposition?: Disposition;
  dispositionNote?: string;
  // Sticky, per-person state — per Jack: "if a contact ever becomes
  // crossed out it should stay crossed out... even with new uploads,"
  // same for disposition. Unlike category/matchedSnippet above (a pure
  // scan-time snapshot), crossedOut and disposition here are the
  // PERSISTENT source of truth: every fresh upload carries them forward
  // onto that person's new row (see applyStickyState below) instead of
  // resetting to false/"none", and the only way to change them is an
  // explicit manual edit in Scanner (which writes back here the same way
  // it always has).
  crossedOut?: boolean;
  // When this contact's disposition first became "meeting-booked".
  // Needed because disposition itself carries no timestamp, so
  // "meetings booked this week" had no way to scope to a week — Home's
  // start-of-day dashboard could only ever show an all-time count.
  // Stamped once, on the transition into meeting-booked, and cleared if
  // the disposition later moves away from it (so a re-book re-stamps).
  meetingBookedAt?: string | null;
  // Manual outreach tracking — per Jack: "how many calls have been made to
  // the client and how many emails as well as the dispositions so we know
  // if they have been contacted, contacted successfully, not interested or
  // meeting booked." Deliberately separate from `disposition` above:
  // that field is a read-only snapshot of the Scanner's own lead-
  // qualification status, this is a directly-editable outreach-activity
  // tracker lived on Contacts/Companies, with its own state set (including
  // call/email counts that have no Scanner equivalent at all). Edited from
  // the contact detail view — see components/ContactDetail.tsx.
  callCount?: number;
  emailCount?: number;
  outreachStatus?: OutreachStatus;
  // Which platform user (lib/users.ts) owns this record — per Jack's
  // "record details ... plus the user owner." Set only by hand from the
  // contact detail view; never inferred from a scan, an upload or a task
  // assignment, since none of those carry real ownership. Optional, so
  // every contact captured before this field existed simply reads as
  // unowned rather than being attributed to someone by guesswork.
  ownerId?: string | null;
  // Manual time zone override (IANA id). When unset, the zone is derived
  // from the phone's area code at display time — see lib/timezones.ts for
  // the full resolution order and why phone is the only real location
  // signal this app has today.
  timeZone?: string | null;
  // Manually pasted in once found — see components/ContactDetail.tsx's
  // "Search LinkedIn" link, which opens a LinkedIn people-search prefilled
  // with name+company (no automatic verified match — see CLAUDE.md
  // "Contacts: LinkedIn" for why a deterministic hyperlink isn't possible).
  linkedinUrl?: string;
  // Auto-derived from the contact's email domain (see deriveCompanyWebsite
  // below) the first time a contact with an email and no website on file
  // is merged — never overwrites an already-set value, whether that value
  // came from auto-derivation or a manual edit. Editable in
  // ContactDetail.tsx the same way linkedinUrl is.
  companyWebsite?: string;
  // "On CRM" — per Jack, a way to mark a contact as already logged in the
  // real CRM (Dynamics 365/HubSpot), distinct from disposition/
  // outreachStatus (which track lead-qualification/outreach state, not
  // whether the person is on file elsewhere). Purely manual, toggled from
  // ContactDetail.tsx — never set automatically by any scan or sync path.
  onCrm?: boolean;
}

// Per Jack: "set a rule to use the email domain to figure that out and map
// it properly." Uses the SAME free/personal-provider list detection.ts's
// Auto-DQ rule checks (getEmailDomain/isFreeEmailDomain, see
// detection.ts's FREE_EMAIL_DOMAINS comment) — a gmail/outlook/etc.
// address should never be used to guess a company website, same reasoning
// as why it never exempts a lead from the personal-email DQ rule either.
// Returns null for a missing/free-provider/malformed email — callers
// treat null as "leave companyWebsite untouched," never as clearing an
// already-set value.
export function deriveCompanyWebsite(email: unknown): string | null {
  const domain = getEmailDomain(email);
  if (!domain || isFreeEmailDomain(domain)) return null;
  return `https://${domain}`;
}

export type OutreachStatus = "not-contacted" | "contacted" | "contacted-successfully" | "not-interested" | "meeting-booked";
export const OUTREACH_STATUS_ORDER: OutreachStatus[] = ["not-contacted", "contacted", "contacted-successfully", "not-interested", "meeting-booked"];
export const OUTREACH_STATUS_META: Record<OutreachStatus, { label: string; color: string; bg: string }> = {
  "not-contacted": { label: "Not contacted", color: "#5b6b72", bg: "#F4F6F7" },
  contacted: { label: "Contacted", color: "#3A4B8C", bg: "#EEF2FF" },
  "contacted-successfully": { label: "Contacted successfully", color: "#2CC295", bg: "#E7F1EA" },
  "not-interested": { label: "Not interested", color: "#B5443B", bg: "#FBEAE8" },
  "meeting-booked": { label: "Intro meeting booked", color: "#8A5A00", bg: "#FFF7E5" },
};

function newId() {
  return `contact-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeText(s: unknown): string {
  return String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
}

// Both keys are derived live from a Contact's CURRENT fields every merge
// run, never persisted — a contact first seen with no email (matched only
// by name+company) still needs to be found once a later upload supplies
// its email, so lookups always try both keys rather than trusting whatever
// key identified it the first time.
function emailKeyOf(email: unknown): string | null {
  const e = normalizeText(email);
  return e ? `email:${e}` : null;
}
function nameCompanyKeyOf(fullName: unknown, company: unknown): string | null {
  const n = normalizeText(fullName);
  const co = normalizeText(company);
  return n && co ? `namecompany:${n}|||${co}` : null;
}

// Third and fourth rungs of the dedup ladder, added because the first two
// left a real hole: a row carrying only a name, or only a company, keyed
// as null under BOTH of the rules above and therefore matched nothing —
// so re-uploading the same export filed a brand new record for that row
// every single time. Reproduced with a 4-row file uploaded three times:
// the name-only and company-only rows ended up as three records each,
// while the email and name+company rows correctly stayed at one.
//
// These two rungs are deliberately narrower than the first two, because
// a single field is weaker evidence of identity:
//   - name-only matches ONLY when exactly one contact on file carries
//     that name. Two different Ana Cruzes at two different companies
//     stay separate, and the row files fresh exactly as it does today.
//   - company-only matches ONLY another company-only record — never a
//     named person at that company, which would silently attach a
//     nameless placeholder row onto a real human being.
function nameOnlyKeyOf(fullName: unknown): string | null {
  const n = normalizeText(fullName);
  return n ? `name:${n}` : null;
}
function companyOnlyKeyOf(company: unknown): string | null {
  const co = normalizeText(company);
  return co ? `company:${co}` : null;
}

function fillBlank(oldVal: string, newVal: unknown): string {
  return oldVal || String(newVal || "").trim();
}

// Shared lookup — email first, name+company fallback — used everywhere a
// caller needs to find an EXISTING contact for a resolved name/company/
// email triple without folding new data into it (attachScanResultsToContacts,
// applyStickyState). mergeContactInputs below keeps its own index since it
// mutates/re-registers entries as it folds a batch in.
export interface ContactIndex {
  byEmail: Map<string, Contact>;
  byNameCompany: Map<string, Contact>;
  // null marks an AMBIGUOUS name — two or more contacts on file share it,
  // so a name-only row must not be auto-attached to either of them.
  byNameOnly: Map<string, Contact | null>;
  // Only ever holds records that have a company and NO name — the
  // nameless "company placeholder" rows. See companyOnlyKeyOf.
  byCompanyOnly: Map<string, Contact>;
}

export function newContactIndex(): ContactIndex {
  return { byEmail: new Map(), byNameCompany: new Map(), byNameOnly: new Map(), byCompanyOnly: new Map() };
}

// Registering is idempotent per contact id, so a record that is re-indexed
// after being merged into (mergeContactInputs does exactly that) never
// makes its own name look ambiguous against itself.
export function registerInContactIndex(index: ContactIndex, c: Contact): void {
  const ek = emailKeyOf(c.email);
  if (ek) index.byEmail.set(ek, c);
  const nk = nameCompanyKeyOf(c.fullName, c.company);
  if (nk) index.byNameCompany.set(nk, c);
  const nameKey = nameOnlyKeyOf(c.fullName);
  if (nameKey) {
    const prior = index.byNameOnly.get(nameKey);
    if (prior === undefined) index.byNameOnly.set(nameKey, c);
    else if (prior && prior.id !== c.id) index.byNameOnly.set(nameKey, null);
    else if (prior && prior.id === c.id) index.byNameOnly.set(nameKey, c);
  }
  if (!normalizeText(c.fullName)) {
    const coKey = companyOnlyKeyOf(c.company);
    if (coKey) index.byCompanyOnly.set(coKey, c);
  }
}

export function buildContactIndex(contacts: Contact[]): ContactIndex {
  const index = newContactIndex();
  contacts.forEach((c) => registerInContactIndex(index, c));
  return index;
}

// The dedup ladder, in strength order. The first two rungs are unchanged
// from the original design; the last two exist only to catch rows that
// carry a single identifying field, which previously keyed as nothing at
// all and so duplicated on every re-upload. Each weaker rung is gated so
// it can only fire when the stronger evidence is genuinely absent from
// the ROW (not merely absent from the match), which is why a name+company
// row never falls through to the name-only rung: a differing company is
// real evidence that these are different people.
export function lookupContact(index: ContactIndex, fullName: string, company: string, email: string): Contact | undefined {
  const emailKey = emailKeyOf(email);
  if (emailKey) {
    const hit = index.byEmail.get(emailKey);
    if (hit) return hit;
  }
  const nameCompanyKey = nameCompanyKeyOf(fullName, company);
  if (nameCompanyKey) {
    const hit = index.byNameCompany.get(nameCompanyKey);
    if (hit) return hit;
  }
  const hasName = Boolean(normalizeText(fullName));
  const hasCompany = Boolean(normalizeText(company));
  if (hasName && !hasCompany) {
    const nameKey = nameOnlyKeyOf(fullName);
    // `null` here means ambiguous, and ambiguous must read as "no match"
    // rather than as a match on whichever record happened to be indexed
    // first.
    const hit = nameKey ? index.byNameOnly.get(nameKey) : undefined;
    if (hit) return hit;
  }
  if (!hasName && hasCompany) {
    const coKey = companyOnlyKeyOf(company);
    const hit = coKey ? index.byCompanyOnly.get(coKey) : undefined;
    if (hit) return hit;
  }
  return undefined;
}

// "Worked" means real outreach activity is recorded against this person.
// Defined once here because three surfaces ask the question — Home's
// "Not worked yet" tile, Contacts' worked filter, and the metrics
// integrity check — and a metric that is computed two ways eventually
// disagrees with itself.
export function isWorked(c: { callCount?: number; emailCount?: number }): boolean {
  return Boolean((c.callCount || 0) || (c.emailCount || 0));
}

export async function loadContactsFromDB(): Promise<Contact[]> {
  return dbGetAll<Contact>(STORE_CONTACTS);
}
export async function persistContact(contact: Contact) {
  await dbPut(STORE_CONTACTS, contact);
}

// Permanently removes contacts. Until now nothing in the app could delete
// one — the directory only ever grew — so this is the path behind
// Companies' "Remove" action (per Jack: "filter out and delete"). It only
// touches the Contacts store: filed Lead Library rows, History entries and
// list snapshots are separate copies and are deliberately left alone.
export async function deleteContactsFromDB(ids: string[]) {
  await Promise.all(ids.map((id) => dbDelete(STORE_CONTACTS, id)));
}

export interface ContactInput {
  resolved: ResolvedFields;
  sourceFile: string;
}

// Every raw row of every uploaded file, regardless of tier or whether the
// detection engine found any Dynamics/M365/licensing signal on it at all —
// per Jack: "adds contacts as they're added through the csv uploads,"
// answered explicitly as every row, every upload, not just the ones that
// clear the Scanner's own detection rules. Deliberately built from the
// ParsedFile[] the Scanner/Library upload handlers already have, NOT from
// the ResultRow[] scanParsedFiles returns — that array has already dropped
// every row with zero detection signal (see scanRowUnified's early
// returns), which would silently exclude plenty of real contacts.
function contactInputsFromParsedFiles(parsedFiles: ParsedFile[]): ContactInput[] {
  const inputs: ContactInput[] = [];
  parsedFiles.forEach((pf) => {
    const fileMapping = computeFileFieldMapping(pf);
    pf.data.forEach((row) => {
      inputs.push({ resolved: resolveRowFields(row, fileMapping), sourceFile: pf.name });
    });
  });
  return inputs;
}

// Folds a batch of resolved-field inputs into the existing Contacts
// directory (additive merge — a later, sparser input never blanks out a
// field a prior one already filled in). Returns the full updated array
// plus just the touched records, so the caller can persist only those
// instead of rewriting the whole store on every merge. Shared by both the
// CSV-upload path (mergeContactsFromParsedFiles) and the manual-add path
// (mergeManualContact) — same dedup rules either way, so manually adding
// someone who's already in the directory merges into their existing
// record instead of creating a duplicate. Uses the shared ContactIndex
// rather than a private copy of the rules, so the ladder cannot drift
// between this path and every read-only lookup elsewhere.
export function mergeContactInputs(existing: Contact[], inputs: ContactInput[]): { contacts: Contact[]; touched: Contact[]; added: number; updated: number } {
  const byId = new Map<string, Contact>(existing.map((c) => [c.id, c]));
  // Same index, same ladder, same ambiguity rules as every other lookup
  // in this file — previously this path kept its own two-rung copy, which
  // is how the name-only/company-only hole went unnoticed here.
  const idx = buildContactIndex(existing);
  const index = (c: Contact) => registerInContactIndex(idx, c);
  const touchedIds = new Set<string>();
  const now = new Date().toISOString();
  let added = 0;
  let updated = 0;

  inputs.forEach(({ resolved: f, sourceFile }) => {
    const fullName = getFullName(f);
    const company = String(f.company || "").trim();
    const email = String(f.email || "").trim();
    if (!fullName && !company && !email) return;

    // Full ladder, in lookupContact — every rung is checked against what
    // is already on file, not just whichever key this particular row
    // happens to carry, so a contact first seen without an email is still
    // found once a later upload supplies one.
    const match = lookupContact(idx, fullName, company, email);

    if (match) {
      const merged: Contact = {
        ...match,
        firstName: fillBlank(match.firstName, f.firstName),
        lastName: fillBlank(match.lastName, f.lastName),
        fullName: match.fullName || fullName,
        title: fillBlank(match.title, f.title),
        company: match.company || company,
        email: match.email || email,
        workPhone: fillBlank(match.workPhone, f.workPhone),
        mobilePhone: fillBlank(match.mobilePhone, f.mobilePhone),
        employees: fillBlank(match.employees, f.employees),
        productArea: fillBlank(match.productArea, f.productArea),
        sourceFiles: match.sourceFiles.includes(sourceFile) ? match.sourceFiles : [...match.sourceFiles, sourceFile],
        companyWebsite: match.companyWebsite || deriveCompanyWebsite(email) || undefined,
        lastSeenAt: now,
        timesSeen: match.timesSeen + 1,
      };
      byId.set(merged.id, merged);
      index(merged);
      touchedIds.add(merged.id);
      updated++;
    } else {
      const contact: Contact = {
        id: newId(),
        firstName: String(f.firstName || "").trim(),
        lastName: String(f.lastName || "").trim(),
        fullName,
        title: String(f.title || "").trim(),
        company,
        email,
        workPhone: String(f.workPhone || "").trim(),
        mobilePhone: String(f.mobilePhone || "").trim(),
        employees: String(f.employees || "").trim(),
        productArea: String(f.productArea || "").trim(),
        sourceFiles: [sourceFile],
        companyWebsite: deriveCompanyWebsite(email) || undefined,
        firstSeenAt: now,
        lastSeenAt: now,
        timesSeen: 1,
      };
      byId.set(contact.id, contact);
      index(contact);
      touchedIds.add(contact.id);
      added++;
    }
  });

  const contacts = Array.from(byId.values());
  const touched = contacts.filter((c) => touchedIds.has(c.id));
  return { contacts, touched, added, updated };
}

export function mergeContactsFromParsedFiles(existing: Contact[], parsedFiles: ParsedFile[]): { contacts: Contact[]; touched: Contact[]; added: number; updated: number } {
  return mergeContactInputs(existing, contactInputsFromParsedFiles(parsedFiles));
}

// Layers scan-derived fields (product line/matched snippet/disposition)
// onto EXISTING Contact records — never creates a new one, since every row
// a ResultRow could come from already became a Contact via
// mergeContactsFromParsedFiles at the same upload (see App.tsx's
// recordHistory, which runs both in the same pass). Matched the same way
// every other contact lookup is: email first, name+company fallback.
// Overwrites rather than fillBlank-merges — this is meant to reflect the
// CURRENT scan, not accumulate stale values from earlier ones. Rows with
// zero detection signal never became a ResultRow at all (scanRowUnified's
// early return), so most contacts simply keep no scan-derived fields —
// expected, not a gap.
export function attachScanResultsToContacts(existing: Contact[], resultRows: ResultRow[]): { contacts: Contact[]; touched: Contact[] } {
  const byId = new Map<string, Contact>(existing.map((c) => [c.id, c]));
  const index = buildContactIndex(existing);

  const touchedIds = new Set<string>();
  resultRows.forEach((r) => {
    const f = r.row.__f;
    const match = lookupContact(index, getFullName(f), String(f.company || "").trim(), String(f.email || "").trim());
    if (!match) return;

    // A ResultRow carries a SNAPSHOT of the disposition as the Scanner
    // last saw it. An outcome logged since — from Calls, Emails, or the
    // Reached board — lives on the Contact and is newer. Writing the
    // snapshot back unconditionally meant that clicking a row's tier tab
    // in Scanner silently erased a "Meeting booked" logged an hour
    // earlier, along with its meetingBookedAt stamp, so Home's "Booked
    // this week" lost the lead. The row only wins when it actually
    // carries a disposition; "none" means "the Scanner has nothing to
    // say", not "clear whatever is there".
    const rowHasDisposition = Boolean(r.disposition && r.disposition !== "none");
    const disposition = rowHasDisposition ? r.disposition : match.disposition;
    const dispositionNote = rowHasDisposition ? r.dispositionNote || "" : match.dispositionNote || "";
    // crossedOut deliberately still takes the row's value: un-crossing a
    // row in Scanner is an explicit action and CLAUDE.md's sticky-state
    // rule requires that undo to stick across later uploads. Preserving
    // the contact's value here would make a cross-out un-undoable.

    const updated: Contact = {
      ...match,
      category: r.category,
      tier: r.tier,
      matchedSnippet: r.notesSummary || "",
      disposition,
      dispositionNote,
      crossedOut: r.crossedOut,
      // Stamp on the transition INTO meeting-booked; keep an existing
      // stamp while it stays booked; clear it if it moves away.
      meetingBookedAt:
        disposition === "meeting-booked"
          ? match.meetingBookedAt || new Date().toISOString()
          : null,
    };
    byId.set(updated.id, updated);
    touchedIds.add(updated.id);
  });

  const contacts = Array.from(byId.values());
  const touched = contacts.filter((c) => touchedIds.has(c.id));
  return { contacts, touched };
}

// Carries a person's sticky crossedOut/disposition FORWARD onto a freshly
// scanned row, before that row is ever shown or recorded — per Jack: "if a
// contact ever becomes crossed out it should stay crossed out until that
// command is undone manually even with new uploads." Every fresh scan
// otherwise starts a row at crossedOut:false/disposition:"none" (see
// scanParsedFiles); this seeds it from the matching Contact's already-
// sticky state instead, so the only way to actually clear it is the
// explicit manual toggle in Scanner (which flows back through
// attachScanResultsToContacts above, same as always). Mutates rows in
// place — called by every fresh-scan call site (Scanner.tsx's handleFiles/
// loadFromLibraryPicker, App.tsx's loadParsedFilesIntoScanner) immediately
// after scanParsedFiles, before setResults/recordHistory.
export function applyStickyState(rows: ResultRow[], contacts: Contact[]): void {
  const index = buildContactIndex(contacts);
  rows.forEach((r) => {
    const f = r.row.__f;
    const match = lookupContact(index, getFullName(f), String(f.company || "").trim(), String(f.email || "").trim());
    if (!match) return;
    if (match.crossedOut) r.crossedOut = true;
    if (match.disposition && match.disposition !== "none") {
      r.disposition = match.disposition;
      r.dispositionNote = match.dispositionNote || "";
    }
  });
}

// Manual "+ Add contact" entry point — per Jack, added from the Companies
// view: "company also (because it could be a parent or separate entity)"
// — the company field is pre-filled with the row you added from but stays
// freely editable, since the new contact might actually belong to a
// related/parent entity rather than that exact company. Goes through the
// same mergeContactInputs dedup as every CSV-derived contact, so manually
// adding someone already on file merges into their existing record rather
// than creating a duplicate. sourceFile is a fixed label rather than a
// real file name, same idea as History's own manual-entry tags elsewhere.
export interface ManualContactInput {
  firstName: string;
  lastName: string;
  title: string;
  company: string;
  email: string;
  workPhone: string;
}
export function mergeManualContact(existing: Contact[], input: ManualContactInput): { contacts: Contact[]; touched: Contact[]; added: number; updated: number } {
  const resolved: ResolvedFields = {
    firstName: input.firstName,
    lastName: input.lastName,
    title: input.title,
    company: input.company,
    email: input.email,
    workPhone: input.workPhone,
  };
  return mergeContactInputs(existing, [{ resolved, sourceFile: "Manually added" }]);
}

// Does this contact carry anything the detection engine actually scored?
// Per Jack: "i just need to know when theres no lead data with that
// contact or company overall, not how many times the system has flat out
// seen the name." A contact with no tier, no category and no matched
// snippet never cleared detection on any upload it appeared in — the row
// existed, it simply had no Dynamics/M365/licensing signal on it (see
// scanRowUnified's early returns). That is the real gap worth surfacing,
// and it is a derived read of fields that already exist — no new field,
// no new store.
export function hasLeadData(c: Contact): boolean {
  return Boolean(c.tier || c.category || String(c.matchedSnippet || "").trim());
}

// Which of two records survives a merge. Richer wins, so the merged row
// keeps the better identity rather than whichever happened to be created
// first: an email beats no email, then more populated fields, then the
// earlier firstSeenAt as a stable tiebreak so the result does not depend
// on array order.
function dedupeKeepRank(c: Contact): number {
  let score = 0;
  if (normalizeText(c.email)) score += 1000;
  if (normalizeText(c.fullName)) score += 100;
  if (normalizeText(c.company)) score += 100;
  [c.title, c.workPhone, c.mobilePhone, c.linkedinUrl, c.companyWebsite].forEach((v) => {
    if (String(v || "").trim()) score += 1;
  });
  return score;
}

// Folds `dup` into `keep`. Additive in exactly the same sense as
// mergeContactInputs — a value already on `keep` is never blanked — with
// two deliberate exceptions that are SUMMED rather than picked, because
// they are cumulative counts rather than facts about the person:
// timesSeen, callCount and emailCount. If a duplicate record accrued its
// own call/email activity while it was masquerading as a separate person,
// that activity really happened and must survive the merge.
function foldContact(keep: Contact, dup: Contact): Contact {
  const merged: Contact = {
    ...keep,
    firstName: fillBlank(keep.firstName, dup.firstName),
    lastName: fillBlank(keep.lastName, dup.lastName),
    fullName: keep.fullName || dup.fullName,
    title: fillBlank(keep.title, dup.title),
    company: keep.company || dup.company,
    email: keep.email || dup.email,
    workPhone: fillBlank(keep.workPhone, dup.workPhone),
    mobilePhone: fillBlank(keep.mobilePhone, dup.mobilePhone),
    employees: fillBlank(keep.employees, dup.employees),
    productArea: fillBlank(keep.productArea, dup.productArea),
    sourceFiles: Array.from(new Set([...keep.sourceFiles, ...dup.sourceFiles])),
    firstSeenAt: keep.firstSeenAt < dup.firstSeenAt ? keep.firstSeenAt : dup.firstSeenAt,
    lastSeenAt: keep.lastSeenAt > dup.lastSeenAt ? keep.lastSeenAt : dup.lastSeenAt,
    timesSeen: (keep.timesSeen || 0) + (dup.timesSeen || 0),
    callCount: (keep.callCount || 0) + (dup.callCount || 0),
    emailCount: (keep.emailCount || 0) + (dup.emailCount || 0),
    category: keep.category || dup.category,
    tier: keep.tier || dup.tier,
    matchedSnippet: keep.matchedSnippet || dup.matchedSnippet,
    // Sticky/manual state: whichever record carries a real value wins, and
    // a true flag always beats an unset one — un-merging is not possible,
    // so losing a manual mark is the worse failure.
    disposition: keep.disposition && keep.disposition !== "none" ? keep.disposition : dup.disposition,
    dispositionNote: fillBlank(String(keep.dispositionNote || ""), dup.dispositionNote) || undefined,
    crossedOut: Boolean(keep.crossedOut || dup.crossedOut),
    onCrm: Boolean(keep.onCrm || dup.onCrm),
    meetingBookedAt: keep.meetingBookedAt || dup.meetingBookedAt,
    outreachStatus: keep.outreachStatus || dup.outreachStatus,
    ownerId: keep.ownerId || dup.ownerId,
    timeZone: keep.timeZone || dup.timeZone,
    linkedinUrl: keep.linkedinUrl || dup.linkedinUrl,
    companyWebsite: keep.companyWebsite || dup.companyWebsite,
  };
  if (!merged.dispositionNote) delete merged.dispositionNote;
  return merged;
}

// One-time (and thereafter idempotent) cleanup of duplicates that piled up
// in the directory BEFORE the name-only/company-only rungs existed. Nothing
// is deleted on a guess: two records only collapse if the live ladder in
// lookupContact says they are the same identity, which is the same rule
// every future upload will use.
//
// `remap` is not optional bookkeeping — OutreachAttempt.contactId and
// Task.contactId both point at a contact id, so a caller that deletes a
// folded record without re-pointing those would orphan real logged calls
// and real open tasks. The caller is expected to apply it.
export function dedupeExistingContacts(contacts: Contact[]): { contacts: Contact[]; merged: number; remap: Map<string, string> } {
  const byId = new Map<string, Contact>();
  const index = newContactIndex();
  const remap = new Map<string, string>();
  let merged = 0;

  // Strongest records first, so the survivor of any collision is the one
  // the ladder would have matched against anyway.
  const ordered = [...contacts].sort((a, b) => dedupeKeepRank(b) - dedupeKeepRank(a) || String(a.firstSeenAt).localeCompare(String(b.firstSeenAt)));

  ordered.forEach((c) => {
    const hit = lookupContact(index, c.fullName, c.company, c.email);
    if (hit && hit.id !== c.id) {
      const folded = foldContact(hit, c);
      byId.set(folded.id, folded);
      byId.delete(c.id);
      remap.set(c.id, folded.id);
      registerInContactIndex(index, folded);
      merged++;
      return;
    }
    byId.set(c.id, c);
    registerInContactIndex(index, c);
  });

  // Preserve the caller's original ordering for everything that survived,
  // so a cleanup with nothing to do returns a list in the same order it
  // came in and the UI does not reshuffle for no reason.
  const survivors = contacts.map((c) => byId.get(c.id)).filter((c): c is Contact => Boolean(c));
  return { contacts: survivors, merged, remap };
}

export function searchContacts(contacts: Contact[], query: string): Contact[] {
  const q = query.trim().toLowerCase();
  if (!q) return contacts;
  return contacts.filter((c) =>
    [c.fullName, c.company, c.title, c.email, c.workPhone, c.mobilePhone].some((v) => v.toLowerCase().includes(q))
  );
}
