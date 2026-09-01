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
import { dbGetAll, dbPut, STORE_CONTACTS } from "./db";
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
  "meeting-booked": { label: "Meeting booked", color: "#8A5A00", bg: "#FFF7E5" },
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

function fillBlank(oldVal: string, newVal: unknown): string {
  return oldVal || String(newVal || "").trim();
}

// Shared lookup — email first, name+company fallback — used everywhere a
// caller needs to find an EXISTING contact for a resolved name/company/
// email triple without folding new data into it (attachScanResultsToContacts,
// applyStickyState). mergeContactInputs below keeps its own index since it
// mutates/re-registers entries as it folds a batch in.
export function buildContactIndex(contacts: Contact[]): { byEmail: Map<string, Contact>; byNameCompany: Map<string, Contact> } {
  const byEmail = new Map<string, Contact>();
  const byNameCompany = new Map<string, Contact>();
  contacts.forEach((c) => {
    const ek = emailKeyOf(c.email);
    if (ek) byEmail.set(ek, c);
    const nk = nameCompanyKeyOf(c.fullName, c.company);
    if (nk) byNameCompany.set(nk, c);
  });
  return { byEmail, byNameCompany };
}
export function lookupContact(index: { byEmail: Map<string, Contact>; byNameCompany: Map<string, Contact> }, fullName: string, company: string, email: string): Contact | undefined {
  const emailKey = emailKeyOf(email);
  const nameCompanyKey = nameCompanyKeyOf(fullName, company);
  return (emailKey && index.byEmail.get(emailKey)) || (nameCompanyKey && index.byNameCompany.get(nameCompanyKey)) || undefined;
}

export async function loadContactsFromDB(): Promise<Contact[]> {
  return dbGetAll<Contact>(STORE_CONTACTS);
}
export async function persistContact(contact: Contact) {
  await dbPut(STORE_CONTACTS, contact);
}

interface ContactInput {
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
// record instead of creating a duplicate.
function mergeContactInputs(existing: Contact[], inputs: ContactInput[]): { contacts: Contact[]; touched: Contact[]; added: number; updated: number } {
  const byId = new Map<string, Contact>(existing.map((c) => [c.id, c]));
  const byEmail = new Map<string, Contact>();
  const byNameCompany = new Map<string, Contact>();
  const index = (c: Contact) => {
    const ek = emailKeyOf(c.email);
    if (ek) byEmail.set(ek, c);
    const nk = nameCompanyKeyOf(c.fullName, c.company);
    if (nk) byNameCompany.set(nk, c);
  };
  existing.forEach(index);
  const touchedIds = new Set<string>();
  const now = new Date().toISOString();
  let added = 0;
  let updated = 0;

  inputs.forEach(({ resolved: f, sourceFile }) => {
    const fullName = getFullName(f);
    const company = String(f.company || "").trim();
    const email = String(f.email || "").trim();
    if (!fullName && !company && !email) return;

    // Email first, name+company fallback — but check BOTH against what's
    // already on file, not just whichever key this particular row happens
    // to carry. Otherwise a contact first seen with no email (matched only
    // by name+company) would never be found again once a later upload
    // supplies their email, and would get filed as a brand new duplicate
    // instead of merged.
    const emailKey = emailKeyOf(email);
    const nameCompanyKey = nameCompanyKeyOf(fullName, company);
    const match = (emailKey && byEmail.get(emailKey)) || (nameCompanyKey && byNameCompany.get(nameCompanyKey)) || undefined;

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

    const updated: Contact = {
      ...match,
      category: r.category,
      tier: r.tier,
      matchedSnippet: r.notesSummary || "",
      disposition: r.disposition,
      dispositionNote: r.dispositionNote || "",
      crossedOut: r.crossedOut,
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

export function searchContacts(contacts: Contact[], query: string): Contact[] {
  const q = query.trim().toLowerCase();
  if (!q) return contacts;
  return contacts.filter((c) =>
    [c.fullName, c.company, c.title, c.email, c.workPhone, c.mobilePhone].some((v) => v.toLowerCase().includes(q))
  );
}
