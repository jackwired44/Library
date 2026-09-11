// Contacts — a searchable, permanent directory of every person ever seen
// in a CSV upload, deduplicated across uploads (see lib/contacts.ts for the
// dedup rules). The CSV-sourced fields (name/title/company/email/phone)
// stay read-only here — that data still lives on the lead itself in
// Scanner/Library — but a contact CAN be turned into a dated, prioritized
// follow-up task (see CLAUDE.md "Contact tasks"), and clicking a contact's
// name opens ContactDetail.tsx, where LinkedIn and outreach tracking
// (calls/emails/status) ARE directly editable (see CLAUDE.md "Contacts:
// detail view, LinkedIn, and outreach tracking"). Selecting contacts here
// and clicking "Enrich via Apollo" runs a live, viewer-driven Apollo
// people-match pass (see lib/apolloEnrich.ts) — never automatic.
import { Fragment, useEffect, useMemo, useState } from "react";
import { OUTREACH_STATUS_META, hasLeadData, isWorked, type Contact, searchContacts } from "../lib/contacts";
import { CATEGORY_META, DISPOSITION_GROUP_LABEL, TIER_META, TIER_ORDER, type Tier } from "../lib/detection";
import { dispositionMetaFor, dispositionOptions, type CustomDisposition, isConnectedDisposition } from "../lib/dispositions";
import { checkApolloAvailability, enrichContactsViaApollo, type EnrichOutcome } from "../lib/apolloEnrich";
import ContactDetail from "./ContactDetail";
import { groupAttemptsByContact, summarizeAttempts, ATTEMPT_CHANNEL_META, type OutreachAttempt, type AttemptChannel } from "../lib/outreachAttempts";
import BookedStamp from "./BookedStamp";
import OnCrmBadge from "./OnCrmBadge";
import LocalTime from "./LocalTime";
import { useNow } from "../lib/useNow";
import { resolveContactTimeZone, timeZoneFromLocation, zoneLabel } from "../lib/timezones";
import { deriveCompanyWebsite } from "../lib/contacts";
import { localDayKeyFromIso } from "../lib/tasks";
import type { Task, TaskPriority } from "../lib/tasks";
import type { LeadList } from "../lib/leadLists";
import type { Sequence, SequenceEnrollment } from "../lib/sequences";
import type { PlatformUser } from "../lib/users";

const MAX_ENRICH_BATCH = 10;
// Same page size Scanner's results table uses — see the pagination note
// below for the measured render cost this avoids.
const PAGE_SIZE = 25;
const PAGE_SIZE_CHOICES = [25, 50, 100, 250, 500] as const;


interface ContactsProps {
  contacts: Contact[];
  loading: boolean;
  error: string | null;
  tasks: Task[];
  onAddContactTask: (contactId: string, date: string, priority: TaskPriority, text: string, channel?: "call" | "email", time?: string | null) => void;
  onToggleTask: (id: string) => void;
  onDeleteTask: (id: string) => void;
  onUpdateContact: (id: string, patch: Partial<Contact>) => void;
  // Record-details cross-references for the contact detail modal (owner,
  // lists, sequences) — see components/ContactDetail.tsx.
  users: PlatformUser[];
  leadLists: LeadList[];
  sequences: Sequence[];
  enrollments: SequenceEnrollment[];
  dispositions: CustomDisposition[];
  attempts: OutreachAttempt[];
  onLogAttempt: (input: { contactId: string; channel: AttemptChannel; outcome?: string; note?: string }) => void;
  onRemoveAttempt: (id: string) => void;
  onManageDispositions: () => void;
  // Seeds the search box on mount — set when arriving here from the header
  // search (see App.tsx/HeaderSearch.tsx). This component remounts fresh
  // each time Engage's Contacts tab is selected, so an initial-only state
  // seed is enough; no need to react to later prop changes.
  initialSearch?: string;
  // Seeded once on mount from Home's pipeline tiles. Seed-only, exactly
  // like initialSearch — Engage remounts on every navigation into it.
  initialTier?: Tier | "all";
  initialWorkedFilter?: WorkedFilter;
}

type SortKey = "recent" | "name" | "company" | "fileCount";

const PRIORITY_META: Record<TaskPriority, { label: string; color: string; bg: string; rank: number }> = {
  high: { label: "High", color: "#B5443B", bg: "#FBE4E1", rank: 0 },
  medium: { label: "Medium", color: "#9A6B00", bg: "#FCEFC7", rank: 1 },
  low: { label: "Low", color: "#2E6B4A", bg: "#E1F2E7", rank: 2 },
};

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function Contacts({ contacts, loading, error, tasks, onAddContactTask, onToggleTask, onDeleteTask, onUpdateContact, users, leadLists, sequences, enrollments, dispositions, onManageDispositions, initialSearch, initialTier, initialWorkedFilter, attempts, onLogAttempt, onRemoveAttempt }: ContactsProps) {
  // One index pass, not a filter per rendered row — the Reached cell is
  // computed for every visible contact.
  const attemptsByContact = useMemo(() => groupAttemptsByContact(attempts), [attempts]);
  const [search, setSearch] = useState(initialSearch || "");
  const [sort, setSort] = useState<SortKey>("recent");
  // Disposition-grouped view — per Jack: a place to see where every lead
  // stands (contacted, how many times, meeting booked/not interested/etc.)
  // at a glance. Filters on top of search/sort rather than replacing them.
  // Multi-select, per Jack: "make sure it can be filtered through in a
  // check box way." An empty set means "no disposition filter" (show all)
  // rather than "show nothing" — same convention as an untouched filter.
  const [dispositionFilter, setDispositionFilter] = useState<Set<string>>(new Set());
  const now = useNow();
  // Tier + date filtering — per Jack: "i do want to be able to filter by
  // dates as well as strong signal or not as well as needs review or bad
  // leads." Tier is a snapshot from the same scan pass that already sets
  // category/disposition (see lib/contacts.ts's Contact.tier); a contact
  // with no tier (never cleared detection on any scan) only shows up
  // under "All". Date filters against lastSeenAt — already a real,
  // full-precision timestamp on every contact, so no new "collected on"
  // field was needed.
  const [tierFilter, setTierFilter] = useState<Tier | "all">(initialTier || "all");
  // "Not worked yet" = no call and no email logged against them. The one
  // filter Home's pipeline tile needs that the list didn't already have.
  const [workedFilter, setWorkedFilter] = useState<WorkedFilter>(initialWorkedFilter || "all");
  // "Does this contact have anything the engine actually scored?" — the
  // gap Jack asked to surface, filterable so it can be worked, not just
  // counted. Reads hasLeadData; adds no field of its own.
  const [leadDataFilter, setLeadDataFilter] = useState<"all" | "has" | "none">("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [addingForId, setAddingForId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  // Apollo enrichment — per Jack, explicit and selection-driven only ("as
  // i select i dont want to have too much going on in the background yet
  // i cant see"): nothing runs until contacts are checked here and the
  // button is clicked, and every contact's outcome is shown individually
  // below, not collapsed into one spinner.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZE);
  const [enriching, setEnriching] = useState(false);
  const [enrichOutcomes, setEnrichOutcomes] = useState<EnrichOutcome[] | null>(null);
  const [enrichError, setEnrichError] = useState<string | null>(null);

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // Profile Agent — per Jack: "pull accurate website links with the
  // contacts email domain and cross reference with linkedin and their
  // name and email to pull a great profile with their accurate title and
  // whats uploaded." One explicit run over the selected contacts:
  //   1. website from the email domain (deriveCompanyWebsite — already
  //      how companyWebsite is auto-filled; re-applied here for any
  //      contact still missing one),
  //   2. Apollo people-match on name + company + email — the ONLY
  //      cross-reference source this app can actually reach (there is no
  //      LinkedIn API here, and LinkedIn can't be scraped from a browser
  //      page), which returns the verified LinkedIn URL, Apollo's title,
  //      the org's website and the person's location,
  //   3. auto-apply what's safe (LinkedIn URL, a blank website, a time zone
  //      when no manual override exists) and put anything that CONFLICTS
  //      with the upload — a different title, a different website — in
  //      front of Jack with an explicit "Use Apollo's" button, never
  //      silently overwriting what was uploaded.
  async function runEnrichment() {
    const targets = contacts.filter((c) => selected.has(c.id));
    if (targets.length === 0 || targets.length > MAX_ENRICH_BATCH) return;
    setEnriching(true);
    setEnrichError(null);
    setEnrichOutcomes(null);
    // Step 1 needs no network: fill any blank website from the email domain.
    targets.forEach((c) => {
      if (!c.companyWebsite) {
        const derived = deriveCompanyWebsite(c.email);
        if (derived) onUpdateContact(c.id, { companyWebsite: derived });
      }
    });
    try {
      const availability = await checkApolloAvailability();
      if (availability !== "available") {
        setEnrichError(
          availability === "not-connected"
            ? "Websites were filled from email domains. Apollo isn't connected for the LinkedIn/title cross-reference — add it in claude.ai Settings → Connectors, then run again."
            : "Websites were filled from email domains. The Apollo cross-reference isn't available in this view."
        );
        return;
      }
      const outcomes = await enrichContactsViaApollo(targets);
      outcomes.forEach((o) => {
        const c = contactById.get(o.contactId);
        if (!c) return;
        const patch: Partial<Contact> = {};
        if (o.status === "matched" && o.linkedinUrl) patch.linkedinUrl = o.linkedinUrl;
        // Title: fill a blank, never overwrite an uploaded one silently —
        // a conflict is shown in the report with an accept button.
        if (o.title && !c.title.trim()) patch.title = o.title;
        // Website: same rule.
        if (o.website && !c.companyWebsite && !deriveCompanyWebsite(c.email)) patch.companyWebsite = o.website;
        // Time zone from Apollo's location, only when there's no manual
        // override and the phone couldn't resolve one.
        if (!c.timeZone && resolveContactTimeZone(c).zone == null) {
          const z = timeZoneFromLocation(o.state, o.country);
          if (z) patch.timeZone = z;
        }
        if (Object.keys(patch).length) onUpdateContact(o.contactId, patch);
      });
      setEnrichOutcomes(outcomes);
    } catch (err) {
      setEnrichError(err instanceof Error ? err.message : "Profile agent failed.");
    } finally {
      setEnriching(false);
    }
  }

  const contactById = useMemo(() => new Map(contacts.map((c) => [c.id, c])), [contacts]);
  // Open tasks only, capped. Enrolling a 1,000-lead list generated 1,000+
  // rows here — completed ones included, with no "hide done" — rendered on
  // every visit to Contacts and re-rendered on every keystroke in the
  // search box, recreating the multi-second tab switch that pagination
  // already fixed for the table below. This panel is a "what matters
  // most, at a glance" view, so it shows the top of the priority order
  // and says how many more there are.
  const allContactTasks = useMemo(
    () =>
      tasks
        .filter((t): t is Task & { contactId: string; priority: TaskPriority } => Boolean(t.contactId && t.priority && contactById.has(t.contactId)))
        .filter((t) => !t.done)
        .sort((a, b) => PRIORITY_META[a.priority].rank - PRIORITY_META[b.priority].rank || a.date.localeCompare(b.date)),
    [tasks, contactById]
  );
  const CONTACT_TASK_LIMIT = 25;
  const contactTasks = useMemo(() => allContactTasks.slice(0, CONTACT_TASK_LIMIT), [allContactTasks]);

  function submitContactTask(contact: Contact, date: string, priority: TaskPriority, note: string, time?: string) {
    const base = `Follow up with ${contact.fullName || contact.company}${contact.company && contact.fullName ? ` (${contact.company})` : ""}`;
    const text = note.trim() ? `${base} — ${note.trim()}` : base;
    onAddContactTask(contact.id, date, priority, text, undefined, time || null);
    setAddingForId(null);
  }

  const searched = useMemo(() => {
    const list = searchContacts(contacts, search);
    const sorted = [...list];
    if (sort === "recent") sorted.sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime());
    else if (sort === "name") sorted.sort((a, b) => a.fullName.localeCompare(b.fullName));
    else if (sort === "company") sorted.sort((a, b) => a.company.localeCompare(b.company));
    else if (sort === "fileCount") sorted.sort((a, b) => b.sourceFiles.length - a.sourceFiles.length);
    return sorted;
  }, [contacts, search, sort]);

  // Counts reflect the current search (so a typed filter narrows these
  // too), but never the disposition filter itself — every bucket's count
  // needs to stay visible regardless of which one is currently selected.
  const dispositionCounts = useMemo(() => {
    // Built dynamically rather than from a fixed literal, since Jack can
    // add his own dispositions (lib/dispositions.ts) — an unknown/removed
    // value still gets counted under its own key rather than dropped.
    const counts: Record<string, number> = {};
    dispositionOptions(dispositions).forEach((o) => { counts[o.key] = 0; });
    searched.forEach((c) => {
      const key = c.disposition || "none";
      counts[key] = (counts[key] || 0) + 1;
    });
    return counts;
  }, [searched, dispositions]);

  const tierCounts = useMemo(() => {
    const counts: Record<Tier, number> = { signal: 0, mention: 0, dq: 0 };
    searched.forEach((c) => { if (c.tier) counts[c.tier]++; });
    return counts;
  }, [searched]);

  const filtered = useMemo(() => {
    let list = searched;
    if (dispositionFilter.size > 0) list = list.filter((c) => dispositionFilter.has(c.disposition || "none"));
    if (tierFilter !== "all") list = list.filter((c) => c.tier === tierFilter);
    if (workedFilter === "unworked") list = list.filter((c) => !isWorked(c));
    if (workedFilter === "worked") list = list.filter((c) => isWorked(c));
    if (leadDataFilter === "has") list = list.filter((c) => hasLeadData(c));
    if (leadDataFilter === "none") list = list.filter((c) => !hasLeadData(c));
    // Compare LOCAL calendar days on both ends. lastSeenAt is a UTC ISO
    // stamp, so a contact merged at 8pm Central on the 8th reads as the
    // 9th in UTC and used to fall outside a "to the 8th" filter — every
    // evening upload landed outside its own day.
    if (dateFrom) list = list.filter((c) => localDayKeyFromIso(c.lastSeenAt) >= dateFrom);
    if (dateTo) list = list.filter((c) => localDayKeyFromIso(c.lastSeenAt) <= dateTo);
    return list;
  }, [searched, dispositionFilter, tierFilter, workedFilter, leadDataFilter, dateFrom, dateTo]);

  const workedCounts = useMemo(() => {
    let worked = 0;
    searched.forEach((c) => { if (isWorked(c)) worked += 1; });
    return { all: searched.length, worked, unworked: searched.length - worked };
  }, [searched]);

  // Pagination — per Jack: "companies, lists, and contacts take time to
  // load." Measured on a real 3,000-contact directory: rendering every
  // row at once put ~77,500 DOM nodes in this view and took ~5 SECONDS to
  // switch into, with ~250ms of lag on every keystroke in the search box
  // (each one re-rendered all 3,000 rows). Scanner already solved exactly
  // this with a 25-per-page slice; this is the same fix, same shape.
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const pageItems = useMemo(
    () => filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [filtered, currentPage, pageSize]
  );

  // Mass selection, same contract as Scanner's: the header checkbox acts
  // on THIS PAGE only (set the page size to choose how many that is), and
  // reaching past it takes the explicit "Select all N matching" link — so
  // an enrichment run can never quietly include rows you never saw.
  const pageAllSelected = pageItems.length > 0 && pageItems.every((c) => selected.has(c.id));
  const pageSomeSelected = pageItems.some((c) => selected.has(c.id));
  function toggleSelectPage() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (pageAllSelected) pageItems.forEach((c) => next.delete(c.id));
      else pageItems.forEach((c) => next.add(c.id));
      return next;
    });
  }
  // Any filter/search/sort change puts you back on page 1 — otherwise
  // narrowing 3,000 contacts down to 12 while sitting on page 40 shows an
  // empty table rather than the results.
  useEffect(() => { setPage(1); }, [search, sort, dispositionFilter, tierFilter, workedFilter, dateFrom, dateTo]);

  // Aggregate outreach summary for whichever bucket is currently selected
  // — per Jack: "know where a lead stands, how many times they've been
  // contacted." Only shown once a specific disposition is picked, since
  // "All" summed together isn't a meaningful number on its own.
  const bucketSummary = useMemo(() => {
    if (dispositionFilter.size === 0) return null;
    return filtered.reduce(
      (acc, c) => ({ calls: acc.calls + (c.callCount || 0), emails: acc.emails + (c.emailCount || 0) }),
      { calls: 0, emails: 0 }
    );
  }, [filtered, dispositionFilter]);

  // How many filters are actually narrowing the list — drives the count
  // badge on the Filters button and whether the chip row renders at all.
  const leadDataCounts = useMemo(() => {
    let has = 0;
    searched.forEach((c) => { if (hasLeadData(c)) has++; });
    return { has, none: searched.length - has };
  }, [searched]);

  const activeFilterCount =
    (tierFilter !== "all" ? 1 : 0) + dispositionFilter.size + (dateFrom || dateTo ? 1 : 0) + (workedFilter !== "all" ? 1 : 0) + (leadDataFilter !== "all" ? 1 : 0);
  function clearAllFilters() {
    setTierFilter("all");
    setWorkedFilter("all");
    setLeadDataFilter("all");
    setDispositionFilter(new Set());
    setDateFrom("");
    setDateTo("");
  }

  if (loading) return <div style={{ color: "var(--muted)", fontSize: 13 }}>Loading contacts…</div>;
  if (error) return <div style={{ color: "#B5443B", fontSize: 13 }}>{error}</div>;

  return (
    <div>
      {/* Page header + one control strip. Per Jack: filters "hidden
          under drop downs and not displayed just across the screen" —
          tier, disposition and the date range all moved into the single
          Filters popover below, leaving search and sort in the open. */}
      <div className="page-head">
        <div>
          <h1 className="page-title">Contacts</h1>
          <p className="page-sub">
            {contacts.length} contact{contacts.length === 1 ? "" : "s"} across every upload, deduplicated by email, then name and company.
          </p>
        </div>
      </div>

      <div className="control-strip">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, company, title, email, or phone…"
          className="field"
          style={{ flex: "1 1 280px", height: 32 }}
        />
        <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="field" style={{ height: 32 }}>
          <option value="recent">Most recently seen</option>
          <option value="name">Name (A–Z)</option>
          <option value="company">Company (A–Z)</option>
          <option value="fileCount">In most files</option>
        </select>
        <div className="filter-wrap">
          <button className={`filter-btn${activeFilterCount > 0 ? " on" : ""}`} onClick={() => setFiltersOpen((v) => !v)}>
            <span aria-hidden="true">⚟</span> Filters
            {activeFilterCount > 0 && <span className="filter-count">{activeFilterCount}</span>}
          </button>
          {filtersOpen && (
            <>
              <div className="filter-pop-backdrop" onClick={() => setFiltersOpen(false)} />
              <div className="filter-pop">
                <div className="filter-group">
                  <div className="filter-group-title">Lead data</div>
                  <label className="filter-opt">
                    <input type="radio" name="leaddata" checked={leadDataFilter === "all"} onChange={() => setLeadDataFilter("all")} />
                    All
                    <span className="filter-opt-count">{searched.length}</span>
                  </label>
                  <label className="filter-opt">
                    <input type="radio" name="leaddata" checked={leadDataFilter === "has"} onChange={() => setLeadDataFilter("has")} />
                    Has lead data
                    <span className="filter-opt-count">{leadDataCounts.has}</span>
                  </label>
                  <label className="filter-opt" title="Detection never scored these — no product line, tier or matched snippet on any upload they appeared in">
                    <input type="radio" name="leaddata" checked={leadDataFilter === "none"} onChange={() => setLeadDataFilter("none")} />
                    No lead data
                    <span className="filter-opt-count">{leadDataCounts.none}</span>
                  </label>
                </div>
                <div className="filter-group">
                  <div className="filter-group-title">Tier</div>
                  <label className="filter-opt">
                    <input type="radio" name="tier" checked={tierFilter === "all"} onChange={() => setTierFilter("all")} />
                    All tiers
                    <span className="filter-opt-count">{searched.length}</span>
                  </label>
                  {TIER_ORDER.map((t) => (
                    <label key={t} className="filter-opt">
                      <input type="radio" name="tier" checked={tierFilter === t} onChange={() => setTierFilter(t)} />
                      {TIER_META[t].label}
                      <span className="filter-opt-count">{tierCounts[t]}</span>
                    </label>
                  ))}
                </div>
                <div className="filter-group">
                  <div className="filter-group-title">Disposition</div>
                  {dispositionOptions(dispositions).map((o, i, arr) => {
                    const groupStart = o.group !== "none" && (i === 0 || arr[i - 1].group !== o.group);
                    return (
                      <span key={o.key} style={{ display: "contents" }}>
                        {groupStart && <div className="filter-group-title" style={{ marginTop: 8 }}>{DISPOSITION_GROUP_LABEL[o.group]}</div>}
                        <label className="filter-opt">
                          <input
                            type="checkbox"
                            checked={dispositionFilter.has(o.key)}
                            onChange={(e) => {
                              setDispositionFilter((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(o.key); else next.delete(o.key);
                                return next;
                              });
                            }}
                          />
                          {o.label}
                          <span className="filter-opt-count">{dispositionCounts[o.key] || 0}</span>
                        </label>
                      </span>
                    );
                  })}
                </div>
                <div className="filter-group">
                  <div className="filter-group-title">Outreach</div>
                  {(["all", "unworked", "worked"] as const).map((k) => (
                    <label key={k} className="filter-opt">
                      <input type="radio" name="worked" checked={workedFilter === k} onChange={() => setWorkedFilter(k)} />
                      {WORKED_LABEL[k]}
                      <span className="filter-opt-count">{workedCounts[k]}</span>
                    </label>
                  ))}
                </div>
                <div className="filter-group">
                  <div className="filter-group-title">Last seen</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="field" style={{ height: 30, flex: 1 }} />
                    <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>to</span>
                    <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="field" style={{ height: 30, flex: 1 }} />
                  </div>
                </div>
                {activeFilterCount > 0 && (
                  <div style={{ marginTop: 12, textAlign: "right" }}>
                    <button className="chip-clear" onClick={clearAllFilters}>Clear all filters</button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
        <button className="filter-btn" onClick={onManageDispositions} title="Add or remove call dispositions">⚙ Manage</button>
      </div>

      {activeFilterCount > 0 && (
        <div className="chip-row">
          {tierFilter !== "all" && (
            <span className="chip">{TIER_META[tierFilter].label}<button onClick={() => setTierFilter("all")} title="Remove">✕</button></span>
          )}
          {[...dispositionFilter].map((d) => (
            <span key={d} className="chip">
              {dispositionMetaFor(d, dispositions).label}
              <button title="Remove" onClick={() => setDispositionFilter((prev) => { const n = new Set(prev); n.delete(d); return n; })}>✕</button>
            </span>
          ))}
          {leadDataFilter !== "all" && (
            <span className="chip">{leadDataFilter === "has" ? "Has lead data" : "No lead data"}<button onClick={() => setLeadDataFilter("all")} title="Remove">✕</button></span>
          )}
          {workedFilter !== "all" && (
            <span className="chip">{WORKED_LABEL[workedFilter]}<button onClick={() => setWorkedFilter("all")} title="Remove">✕</button></span>
          )}
          {(dateFrom || dateTo) && (
            <span className="chip">
              Seen {dateFrom || "any"} to {dateTo || "any"}
              <button title="Remove" onClick={() => { setDateFrom(""); setDateTo(""); }}>✕</button>
            </span>
          )}
          <button className="chip-clear" onClick={clearAllFilters}>Clear all</button>
        </div>
      )}


      <div style={{ marginBottom: 22 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
          <h3 style={{ margin: 0, fontSize: 14 }}>Tasks</h3>
          <span style={{ fontSize: 11.5, color: "var(--muted)" }}>Sorted by priority, then date — highest priority first</span>
        </div>
        {contactTasks.length === 0 ? (
          <div style={{ fontSize: 12.5, color: "var(--muted)", border: "1px dashed var(--border)", borderRadius: 10, padding: "14px 16px" }}>
            No contact tasks yet — use "+ Task" on any contact below to schedule a dated, prioritized follow-up.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {allContactTasks.length > CONTACT_TASK_LIMIT && (
              <div style={{ fontSize: 11.5, color: "var(--muted)", padding: "4px 0 8px" }}>
                Showing the {CONTACT_TASK_LIMIT} highest-priority of {allContactTasks.length} open tasks — the rest are
                in Engage → Tasks.
              </div>
            )}
            {contactTasks.map((t) => {
              const contact = contactById.get(t.contactId);
              const meta = PRIORITY_META[t.priority];
              return (
                <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "8px 12px" }}>
                  <input type="checkbox" checked={t.done} onChange={() => onToggleTask(t.id)} />
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: meta.color, background: meta.bg, borderRadius: 999, padding: "2px 9px", flexShrink: 0 }}>{meta.label}</span>
                  <span style={{ fontSize: 12, color: "var(--muted)", flexShrink: 0, whiteSpace: "nowrap" }}>{t.date}</span>
                  <span style={{ fontSize: 13, flex: 1, textDecoration: t.done ? "line-through" : "none", color: t.done ? "var(--muted)" : "var(--ink)" }}>
                    {t.text}
                  </span>
                  {contact && <span style={{ fontSize: 11.5, color: "var(--muted)" }}>{contact.company}</span>}
                  <button onClick={() => onDeleteTask(t.id)} title="Delete task" style={{ border: "none", background: "none", color: "#B5443B", fontSize: 13, cursor: "pointer" }}>✕</button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {bucketSummary && (
        <div style={{ display: "flex", gap: 18, alignItems: "center", background: "var(--surface-sunken)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 14px", marginBottom: 16, fontSize: 12.5 }}>
          <span style={{ fontWeight: 700 }}>{filtered.length} contact{filtered.length === 1 ? "" : "s"}</span>
          <span style={{ color: "var(--muted)" }}>{bucketSummary.calls} total calls made</span>
          <span style={{ color: "var(--muted)" }}>{bucketSummary.emails} total emails sent</span>
        </div>
      )}

      {contacts.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--muted)", padding: "24px 0" }}>
          No contacts yet — every CSV you upload through the Scanner or file directly into a Lead Library folder adds its rows here automatically.
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--muted)", padding: "24px 0" }}>
          No contacts match{search ? ` "${search}"` : ""}
          {dispositionFilter.size > 0
            ? ` with disposition ${[...dispositionFilter].map((d) => `"${dispositionMetaFor(d, dispositions).label}"`).join(" or ")}`
            : ""}
          {tierFilter !== "all" ? ` in tier "${TIER_META[tierFilter].label}"` : ""}
          {dateFrom || dateTo ? ` last seen ${dateFrom ? `on/after ${dateFrom}` : ""}${dateFrom && dateTo ? " and " : ""}${dateTo ? `on/before ${dateTo}` : ""}` : ""}.
        </div>
      ) : (
        <>
        {selected.size > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#EAF3FC", border: "1px solid #CFE3F7", borderRadius: 11, padding: "10px 14px", marginBottom: 12, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700, color: "#0A4A85" }}>{selected.size} selected</span>
            {pageAllSelected && selected.size < filtered.length && (
              <button className="bulkbar-selectall" onClick={() => setSelected(new Set(filtered.map((c) => c.id)))}>
                Select all {filtered.length.toLocaleString()} matching
              </button>
            )}
            <button
              onClick={runEnrichment}
              disabled={enriching || selected.size > MAX_ENRICH_BATCH}
              title={selected.size > MAX_ENRICH_BATCH ? `Select ${MAX_ENRICH_BATCH} or fewer to enrich at once` : "Website from email domain, then Apollo cross-reference on name + company + email for LinkedIn, title and location. Conflicts with what was uploaded are shown for you to accept, never overwritten silently."}
              style={{ border: "none", borderRadius: 8, padding: "7px 14px", fontWeight: 700, fontSize: 12.5, background: enriching || selected.size > MAX_ENRICH_BATCH ? "#CFE3F7" : "#0A66C2", color: "#fff", cursor: enriching || selected.size > MAX_ENRICH_BATCH ? "not-allowed" : "pointer" }}
            >
              {enriching ? "Running profile agent…" : "▶ Run profile agent"}
            </button>
            {selected.size > MAX_ENRICH_BATCH && <span style={{ fontSize: 11.5, color: "#8A5A00" }}>Select {MAX_ENRICH_BATCH} or fewer at once.</span>}
            <button onClick={() => setSelected(new Set())} style={{ background: "none", border: "none", textDecoration: "underline", fontSize: 12 }}>Clear selection</button>
          </div>
        )}
        {enrichError && <div style={{ marginBottom: 12, color: "#B5443B", fontSize: 12.5 }}>{enrichError}</div>}
        {enrichOutcomes && (
          <div className="panel" style={{ marginBottom: 12 }}>
            <div className="panel-head">
              <div className="panel-title">Profile agent report</div>
              <div className="panel-sub">Uploaded vs. found. Auto-applied: LinkedIn, blank titles/websites, time zone from location. Conflicts wait for you.</div>
            </div>
            <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {enrichOutcomes.map((o) => {
                const c = contactById.get(o.contactId);
                if (!c) return null;
                const titleConflict = Boolean(o.title && c.title.trim() && o.title.trim().toLowerCase() !== c.title.trim().toLowerCase());
                const emailSite = deriveCompanyWebsite(c.email);
                const apolloSite = o.website || "";
                const siteConflict = Boolean(apolloSite && c.companyWebsite && apolloSite.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "") !== c.companyWebsite.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""));
                const zoneFromLoc = timeZoneFromLocation(o.state, o.country);
                return (
                  <div key={o.contactId} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px", fontSize: 12 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 4 }}>
                      <span style={{ fontWeight: 700 }}>{c.fullName || c.company}</span>
                      <span style={{ color: "var(--muted)" }}>{c.company}</span>
                      {o.status === "matched" && <span style={{ color: "#2CC295", fontWeight: 700 }}>✓ Apollo match — LinkedIn saved</span>}
                      {o.status === "no-match" && <span style={{ color: "var(--muted)" }}>No confident Apollo match</span>}
                      {o.status === "error" && <span style={{ color: "#B5443B" }}>Error — {o.errorMessage}</span>}
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "110px 1fr 1fr auto", gap: "4px 12px", alignItems: "center" }}>
                      <span className="rd-label" style={{ marginBottom: 0 }}></span>
                      <span className="rd-label" style={{ marginBottom: 0 }}>Uploaded</span>
                      <span className="rd-label" style={{ marginBottom: 0 }}>Found</span>
                      <span></span>

                      <span style={{ color: "var(--muted)" }}>Title</span>
                      <span>{c.title || <em style={{ color: "var(--muted)" }}>blank</em>}</span>
                      <span style={{ fontWeight: titleConflict ? 700 : 400 }}>{o.title || "—"}</span>
                      <span>
                        {titleConflict && (
                          <button onClick={() => onUpdateContact(c.id, { title: o.title! })} className="btn btn-sm btn-secondary">Use Apollo's</button>
                        )}
                        {o.title && !titleConflict && c.title && <span style={{ color: "#2CC295", fontSize: 11 }}>agrees</span>}
                      </span>

                      <span style={{ color: "var(--muted)" }}>Website</span>
                      <span style={{ wordBreak: "break-all" }}>{c.companyWebsite || <em style={{ color: "var(--muted)" }}>{emailSite ? "filled from email domain" : "no domain to derive"}</em>}</span>
                      <span style={{ wordBreak: "break-all", fontWeight: siteConflict ? 700 : 400 }}>{apolloSite || "—"}</span>
                      <span>
                        {siteConflict && (
                          <button onClick={() => onUpdateContact(c.id, { companyWebsite: apolloSite })} className="btn btn-sm btn-secondary">Use Apollo's</button>
                        )}
                        {apolloSite && !siteConflict && c.companyWebsite && <span style={{ color: "#2CC295", fontSize: 11 }}>agrees</span>}
                      </span>

                      <span style={{ color: "var(--muted)" }}>LinkedIn</span>
                      <span style={{ wordBreak: "break-all" }}>{c.linkedinUrl ? c.linkedinUrl.replace(/^https?:\/\/(www\.)?/, "") : <em style={{ color: "var(--muted)" }}>none</em>}</span>
                      <span style={{ wordBreak: "break-all" }}>{o.linkedinUrl ? o.linkedinUrl.replace(/^https?:\/\/(www\.)?/, "") : "—"}</span>
                      <span></span>

                      <span style={{ color: "var(--muted)" }}>Location</span>
                      <span>{resolveContactTimeZone(c).zone ? zoneLabel(resolveContactTimeZone(c).zone as string) : <em style={{ color: "var(--muted)" }}>unknown</em>}</span>
                      <span>{[o.city, o.state, o.country].filter(Boolean).join(", ") || "—"}{zoneFromLoc ? ` → ${zoneLabel(zoneFromLoc)}` : ""}</span>
                      <span></span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 10 }}>
          <table>
            <thead>
              <tr style={{ background: "var(--bg)", textAlign: "left" }}>
                <th style={{ width: 30 }}>
                  <input
                    type="checkbox"
                    aria-label={pageAllSelected ? "Clear selection on this page" : "Select every contact on this page"}
                    title={pageAllSelected ? "Clear this page's selection" : `Select all ${pageItems.length} on this page`}
                    checked={pageAllSelected}
                    ref={(el) => { if (el) el.indeterminate = !pageAllSelected && pageSomeSelected; }}
                    onChange={toggleSelectPage}
                    disabled={pageItems.length === 0}
                  />
                </th>
                <th style={{ padding: "9px 12px" }}>Contact</th>
                <th style={{ padding: "9px 12px" }}>Company</th>
                <th style={{ padding: "9px 12px" }}>Title</th>
                <th style={{ padding: "9px 12px" }}>Email</th>
                <th style={{ padding: "9px 12px" }}>Phone</th>
                <th style={{ padding: "9px 12px" }} title="Their current local time — from a manual override or the phone's area code">Local time</th>
                <th style={{ padding: "9px 12px" }}>Product line</th>
                <th style={{ padding: "9px 12px" }}>Disposition</th>
                <th style={{ padding: "9px 12px" }}>Matched snippet</th>
                <th style={{ padding: "9px 12px" }}>Outreach</th>
                <th style={{ padding: "9px 12px" }} title="How many times this lead has been tried, and how the last attempt went">Reached</th>
                <th style={{ padding: "9px 12px" }} title="How many distinct uploaded files this contact appears in — not how many rows mentioned them">In files</th>
                <th style={{ padding: "9px 12px" }}>Sources</th>
                <th style={{ padding: "9px 12px" }}></th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((c) => (
                <Fragment key={c.id}>
                  <tr
                    style={{
                      borderTop: "1px solid var(--border)",
                      background:
                        c.disposition === "meeting-booked"
                          ? dispositionMetaFor("meeting-booked", dispositions).bg
                          : c.disposition === "not-interested"
                            ? dispositionMetaFor("not-interested", dispositions).bg
                            : undefined,
                    }}
                  >
                    <td style={{ textAlign: "center" }}>
                      <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleSelected(c.id)} />
                    </td>
                    <td style={{ padding: "9px 12px", fontWeight: 600 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <button
                          onClick={() => setDetailId(c.id)}
                          style={{ border: "none", background: "none", padding: 0, font: "inherit", fontWeight: 600, color: "var(--ink)", textDecoration: c.crossedOut ? "line-through" : "underline", cursor: "pointer" }}
                        >
                          {c.fullName || "—"}
                        </button>
                        {c.onCrm && <OnCrmBadge />}
                      </div>
                    </td>
                    <td style={{ padding: "9px 12px" }}>
                      {c.disposition === "meeting-booked" && <BookedStamp />}
                      <div>{c.company || "—"}</div>
                    </td>
                    <td style={{ padding: "9px 12px", color: "var(--muted)" }}>{c.title || "—"}</td>
                    <td style={{ padding: "9px 12px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <span>{c.email || "—"}</span>
                        {c.companyWebsite && (
                          <a
                            href={c.companyWebsite}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={`Open ${c.companyWebsite}`}
                            onClick={(e) => e.stopPropagation()}
                            style={{ color: "var(--accent)", fontSize: 12, textDecoration: "none" }}
                          >
                            🌐
                          </a>
                        )}
                        {c.linkedinUrl && (
                          <a
                            href={c.linkedinUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Open LinkedIn profile"
                            onClick={(e) => e.stopPropagation()}
                            style={{ color: "#0A66C2", fontSize: 12, textDecoration: "none", fontWeight: 700 }}
                          >
                            in
                          </a>
                        )}
                      </div>
                    </td>
                    <td style={{ padding: "9px 12px" }}>{c.workPhone || c.mobilePhone || "—"}</td>
                    <td style={{ padding: "9px 12px" }}>
                      {(() => { const tz = resolveContactTimeZone(c); return <LocalTime zone={tz.zone} source={tz.source} now={now} />; })()}
                    </td>
                    <td style={{ padding: "9px 12px" }}>
                      {c.category ? (
                        <span style={{ fontSize: 10.5, fontWeight: 700, color: CATEGORY_META[c.category].color, background: CATEGORY_META[c.category].bg, borderRadius: 999, padding: "2px 9px", whiteSpace: "nowrap" }}>
                          {CATEGORY_META[c.category].label}
                        </span>
                      ) : hasLeadData(c) ? (
                        <span style={{ color: "var(--muted)" }}>—</span>
                      ) : (
                        <span
                          style={{ fontSize: 10.5, fontWeight: 700, color: "#8A5A00", background: "#FFF7E5", borderRadius: 999, padding: "2px 9px", whiteSpace: "nowrap" }}
                          title="Detection never scored this contact on any upload they appeared in — no product line, no tier, no matched snippet."
                        >
                          No lead data
                        </span>
                      )}
                    </td>
                    <td style={{ padding: "9px 12px" }}>
                      {c.disposition && c.disposition !== "none" ? (
                        <span
                          title={c.dispositionNote || undefined}
                          style={{ fontSize: 10.5, fontWeight: 700, color: dispositionMetaFor(c.disposition, dispositions).color, background: dispositionMetaFor(c.disposition, dispositions).bg, borderRadius: 999, padding: "2px 9px", whiteSpace: "nowrap" }}
                        >
                          {dispositionMetaFor(c.disposition, dispositions).label}
                        </span>
                      ) : (
                        <span style={{ color: "var(--muted)" }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: "9px 12px", maxWidth: 220, color: "var(--muted)", fontSize: 12 }} title={c.matchedSnippet || undefined}>
                      {c.matchedSnippet ? (
                        <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.matchedSnippet}</span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td style={{ padding: "9px 12px" }}>
                      <span style={{ fontSize: 10.5, fontWeight: 700, color: OUTREACH_STATUS_META[c.outreachStatus || "not-contacted"].color, background: OUTREACH_STATUS_META[c.outreachStatus || "not-contacted"].bg, borderRadius: 999, padding: "2px 9px", whiteSpace: "nowrap" }}>
                        {OUTREACH_STATUS_META[c.outreachStatus || "not-contacted"].label}
                      </span>
                      {((c.callCount || 0) > 0 || (c.emailCount || 0) > 0) && (
                        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>{c.callCount || 0} calls · {c.emailCount || 0} emails</div>
                      )}
                    </td>
                    <td style={{ padding: "9px 12px" }}>
                      {(() => {
                        const list = attemptsByContact.get(c.id) || [];
                        if (!list.length) return <span style={{ color: "var(--muted)" }}>—</span>;
                        const sum = summarizeAttempts(list, (o) => isConnectedDisposition(o, dispositions));
                        const meta = dispositionMetaFor(sum.latest?.outcome, dispositions);
                        return (
                          <div className="reached-cell" title={`${sum.total} attempt${sum.total === 1 ? "" : "s"} · ${sum.reached} reached`}>
                            <span className="reached-count">{sum.total}×</span>
                            {sum.latest && <span>{ATTEMPT_CHANNEL_META[sum.latest.channel].icon}</span>}
                            <span className="status-pill" style={{ background: meta.bg, color: meta.color }}>{meta.label}</span>
                          </div>
                        );
                      })()}
                    </td>
                    <td
                      style={{ padding: "9px 12px", whiteSpace: "nowrap" }}
                      title={`Appears in ${c.sourceFiles.length} uploaded file${c.sourceFiles.length === 1 ? "" : "s"}. Last seen ${new Date(c.lastSeenAt).toLocaleString()}. Raw row occurrences across every upload: ${c.timesSeen}.`}
                    >
                      In {c.sourceFiles.length} file{c.sourceFiles.length === 1 ? "" : "s"} · {new Date(c.lastSeenAt).toLocaleDateString()}
                    </td>
                    <td style={{ padding: "9px 12px", color: "var(--muted)", fontSize: 12 }} title={c.sourceFiles.join(", ")}>
                      {c.sourceFiles.length === 1 ? c.sourceFiles[0] : `${c.sourceFiles.length} files`}
                    </td>
                    <td style={{ padding: "9px 12px", whiteSpace: "nowrap" }}>
                      <button
                        onClick={() => setAddingForId(addingForId === c.id ? null : c.id)}
                        style={{ border: "1px solid var(--border)", background: addingForId === c.id ? "linear-gradient(90deg, var(--accent), var(--accent-blue))" : "var(--surface)", color: addingForId === c.id ? "#fff" : "var(--ink)", borderRadius: 7, padding: "5px 10px", fontSize: 11.5, fontWeight: 700 }}
                      >
                        + Task
                      </button>
                    </td>
                  </tr>
                  {addingForId === c.id && (
                    <tr style={{ background: "var(--bg)" }}>
                      <td colSpan={14} style={{ padding: "10px 12px" }}>
                        <AddContactTaskForm contact={c} onSubmit={(date, priority, note, time) => submitContactTask(c, date, priority, note, time)} onCancel={() => setAddingForId(null)} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length > PAGE_SIZE_CHOICES[0] && (
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 12, alignItems: "center", fontSize: 12.5 }}>
            <span style={{ color: "var(--muted)" }}>
              Showing {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, filtered.length)} of {filtered.length}
            </span>
            <label className="pager-size">
              Rows
              <select
                aria-label="Rows per page"
                value={pageSize}
                onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
              >
                {PAGE_SIZE_CHOICES.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <button
              disabled={currentPage <= 1}
              onClick={() => setPage(currentPage - 1)}
              style={{ border: "1px solid var(--border)", background: "var(--surface)", borderRadius: 7, padding: "5px 11px" }}
            >
              Prev
            </button>
            <span>Page {currentPage} of {totalPages}</span>
            <button
              disabled={currentPage >= totalPages}
              onClick={() => setPage(currentPage + 1)}
              style={{ border: "1px solid var(--border)", background: "var(--surface)", borderRadius: 7, padding: "5px 11px" }}
            >
              Next
            </button>
          </div>
        )}
        </>
      )}

      {detailId && contactById.get(detailId) && (
        <ContactDetail
          contact={contactById.get(detailId)!}
          onClose={() => setDetailId(null)}
          onUpdate={(patch) => onUpdateContact(detailId, patch)}
          users={users}
          tasks={tasks}
          leadLists={leadLists}
          sequences={sequences}
          enrollments={enrollments}
          dispositions={dispositions}
          attempts={attempts}
          onLogAttempt={onLogAttempt}
          onRemoveAttempt={onRemoveAttempt}
        />
      )}
    </div>
  );
}

function AddContactTaskForm({ contact, onSubmit, onCancel }: { contact: Contact; onSubmit: (date: string, priority: TaskPriority, note: string, time: string) => void; onCancel: () => void }) {
  const [date, setDate] = useState(todayKey());
  // Optional time of day (Task.time) — blank means an untimed task, exactly
  // how every task behaved before the field existed. See CLAUDE.md's
  // "Home: start-of-day dashboard" section.
  const [time, setTime] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [note, setNote] = useState("");

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <span style={{ fontSize: 12, fontWeight: 700 }}>Task for {contact.fullName || contact.company}:</span>
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ border: "1px solid var(--border)", borderRadius: 7, padding: "5px 8px", fontSize: 12.5 }} />
      <input
        type="time"
        value={time}
        onChange={(e) => setTime(e.target.value)}
        title="Optional time of day"
        style={{ border: "1px solid var(--border)", borderRadius: 7, padding: "5px 8px", fontSize: 12.5 }}
      />
      <select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)} style={{ border: "1px solid var(--border)", borderRadius: 7, padding: "5px 8px", fontSize: 12.5, fontWeight: 600 }}>
        <option value="high">High priority</option>
        <option value="medium">Medium priority</option>
        <option value="low">Low priority</option>
      </select>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note (optional)"
        style={{ flex: "1 1 200px", border: "1px solid var(--border)", borderRadius: 7, padding: "5px 8px", fontSize: 12.5 }}
      />
      <button onClick={() => onSubmit(date, priority, note, time)} style={{ border: "none", background: "#2CC295", color: "#081E22", borderRadius: 7, padding: "6px 12px", fontSize: 12, fontWeight: 700 }}>
        Add
      </button>
      <button onClick={onCancel} style={{ border: "1px solid var(--border)", background: "var(--surface)", borderRadius: 7, padding: "6px 12px", fontSize: 12, fontWeight: 600 }}>
        Cancel
      </button>
    </div>
  );
}


// Whether a contact has ever been called or emailed. "Not worked yet"
// means zero of both — the same definition Home's pipeline tile uses, so
// clicking that tile and reading this filter can never disagree.
export type WorkedFilter = "all" | "unworked" | "worked";
export const WORKED_LABEL: Record<WorkedFilter, string> = {
  all: "Any",
  unworked: "Not worked yet",
  worked: "Worked at least once",
};
// Kept as a re-export so existing importers are unaffected; the
// definition lives in lib/contacts.ts.
export { isWorked };
