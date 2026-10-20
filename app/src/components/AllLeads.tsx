// Every lead ever scanned, from all three scanners — the Library's source
// of truth, built to be worked at volume.
//
// Per Jack: "i want to be able to filter by industry here as well as
// employee range and which sequence it is tied to in apollo for each lead
// but at a mass volume level as well and include any basic filter options
// as well as scroll abilities … upload scan store and then over see the
// lead if they are assigned as a task in apollo if they have never been
// uploaded when how many different csv files they are on."
//
// PERFORMANCE RULES this file follows, all learned the hard way elsewhere:
//   - Everything a predicate reads is derived ONCE per lead set into one
//     map (`derived`), never inside a filter. A per-keystroke rebuild cost
//     1,033 ms on 9,265 rows in Scanner2 before that was fixed.
//   - The table renders one page at a time, at most 500 rows. 77,500 DOM
//     nodes is what an unpaginated Contacts table measured at 3,000 rows.
//   - Selection is a Set of keys, so it survives paging and refiltering.
import RateLimitNote from "./RateLimitNote";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  LEAD_SOURCE_META, newestNote, noteSegments, outcomeSummary,
  type LeadSource, type StoredLead,
} from "../lib/leadStore";
import { SYNC_STALE_DAYS, syncAgeDays, leadsToSync } from "../lib/apolloSync";
import { parseCSVFile, toCSV, downloadBlob } from "../lib/csv";
import Customize, { loadHiddenSet, saveHiddenSet } from "./Customize";
import { arrivalOf, isPreMaySheet, sheetNumberOf, sheetEstimateOf, monthLabelOf, PRE_MAY_2026_MONTH } from "../lib/leadFiling";
import { engagementOf, engagementLabel, isCustomer, ENGAGEMENT_SOURCE_META, type EngagementMatch } from "../lib/engagements";
import type { ParsedFile } from "../lib/detection";
import { MAX_COMPANY_BATCH } from "../lib/apolloEnrich";
import { orgIdsOf, TRACKED_DOMAIN, type VisitProgress } from "../lib/webVisits";
import { partnerStanceOf } from "../lib/detection";
import { downloadCampaignCSV } from "../lib/campaignExport";
import { MIN_EMPLOYEES } from "../lib/leadQualify";
import {
  SIZE_BUCKETS, employeeCountOf, normalizeCompanyKey, profileForCompany, companiesNeedingEnrichment, type CompanyProfile,
} from "../lib/companyProfiles";
import LeadDetail from "./LeadDetail";
import { REPS, ownersOf } from "../lib/reps";
import { DEFAULT_RECYCLE_RULES, RECYCLE_FLOW, RECYCLE_META, recycleLabel, recycleOf, type RecycleRules } from "../lib/recycle";
import {
  STATUS_META, STATUS_ORDER, statusOf, wasReached,
  VERDICT_META, VERDICT_ORDER, verdictOf, type Verdict,
  CONTACT_META, CONTACT_ORDER, contactStateOf, type ContactState,
  type LeadStatus,
} from "../lib/leadStatus";
import { stepsInSequence, type ApolloFunnel } from "../lib/apolloFunnel";
import { apolloHitFor, type ApolloHit, type RosterIndex } from "../lib/apolloRoster";
import { DEFAULT_PULL_MONTHS, type PullProgress, type CheckProgress } from "../lib/apolloLive";
import { loadRawNoteSearchIndex } from "../lib/rawNotes";
import { matchesKeywords, parseKeywords } from "../lib/keywords";
import type { LeadList } from "../lib/leadLists";
import { laneOf, indexChecks, emailsToVerify, isGreenLit, LANE_META, LANE_ORDER, DEFAULT_CATCH_ALL_MIN, type Lane, type EmailCheck, type VerifierImport } from "../lib/deliverability";
import type { ExportRow } from "../lib/detection";
import { apolloStandingOf, listRowForLead, NEEDS, NO_SEQUENCE, STATUS_META as STANDING_META, STATUS_ORDER as STANDING_ORDER, type Status as Standing } from "./ApolloStatus";
import { isIntentDate, soonestUpcoming, type NoteDate } from "../lib/noteDates";
import {
  FUNCTION_META, LEVEL_META, LEVEL_ORDER, titleFunction, titleLevel,
  type TitleFunction, type TitleLevel,
} from "../lib/titleLevel";

const PAGE_SIZES = [25, 100, 250, 500];

export interface SyncReport {
  rows: number; matched: number; unmatched: number; unmapped: string[]; skipped: number;
  matchedByName?: number; ambiguous?: number;
}

/* ----------------------------------------------------------- filter types */

type ApolloFilter =
  | "all" | "active" | "finished" | "never-sequenced" | "called" | "never-called" | "never-reached" | "no-record";

const APOLLO_LABEL: Record<Exclude<ApolloFilter, "all">, string> = {
  active: "Active in a sequence",
  finished: "Finished a sequence",
  "never-sequenced": "Never in a sequence",
  called: "Has been called",
  "never-called": "Never called",
  "never-reached": "Called, never reached",
  "no-record": "No Apollo record",
};

type PlanFilter = "all" | "none" | "queued" | "exported";
const PLAN_LABEL: Record<Exclude<PlanFilter, "all">, string> = {
  none: "Not queued",
  queued: "Queued for Apollo",
  exported: "Exported to Apollo",
};

type FilesFilter = "all" | "1" | "2" | "2c" | "3";
const FILES_LABEL: Record<Exclude<FilesFilter, "all">, string> = {
  "1": "On 1 file",
  "2": "On 2+ files",
  "2c": "On 2+ files, notes changed",
  "3": "On 3+ files",
};

type SortKey = "received" | "last" | "first" | "company" | "files" | "score" | "calls" | "nextdate" | "added" | "taskdone";
const SORT_LABEL: Record<SortKey, string> = {
  received: "CSV date (newest)",
  last: "Last seen (newest)",
  first: "First seen (newest)",
  company: "Company A–Z",
  files: "Most files",
  score: "Highest score",
  calls: "Most calls",
  nextdate: "Soonest date in notes",
  added: "Added to sequence (newest)",
  taskdone: "Last task done (newest)",
};

/** Everything a filter, a facet count or a cell reads, resolved once. */
interface Derived {
  hay: string;
  lane: Lane;
  standing: Standing;
  industry: string;
  employees: number | null;
  sizeKey: string; // a SIZE_BUCKETS key, or "unknown"
  line: string;
  active: boolean;
  finished: boolean;
  sequenced: boolean;
  calls: number;
  has: boolean;
  files: number;
  status: LeadStatus;
  /** A real conversation is on record (not just no-answers). */
  reached: boolean;
  /** YYYY-MM the lead was received: the file's own date, else first upload. */
  month: string;
  /** "upcoming" / "past" / "logged" (stamps only) / "none". */
  dateKind: "upcoming" | "past" | "logged" | "none";
  nextDate: NoteDate | null;
  level: TitleLevel;
  fn: TitleFunction;
  contact: ContactState;
  companyKey: string;
  /** How many dated notes the lead has combined across uploads. */
  segs: number;
  verdict: Verdict;
  /** Newest sequence enrolment date, from the Apollo task sync. "" if none. */
  addedAt: string;
  /** Newest completed task's due date. "" if none. */
  taskDoneAt: string;
  /** In Apollo already: matched by a sync, or found among the uploads
   *  pulled from Apollo. Null when neither knows them. */
  inApollo: ApolloHit | { how: "sync"; name: string; sequences: string[]; uploadedAt?: string } | null;
  /** Whose sequences this lead is in: the name on the sequence ("Carly Main
   *  Sequence", "Jack Main Backup Sequence"), else the Apollo contact owner. */
  owners: string[];
  /** Left out of downloads: pulled uploads or an imported sync, or a deal
   *  or meeting on file (Account manager only). */
  exportBlocked: boolean;
  /** A deal or sales meeting covering this lead — HubSpot, Notion or Echo. */
  engaged: EngagementMatch | null;
}

type InApolloFilter = "all" | "not" | "in" | "checked-in" | "checked-not" | "unchecked";

function dateKindOf(dates: NoteDate[] | undefined): Derived["dateKind"] {
  if (!dates?.length) return "none";
  const intent = dates.filter(isIntentDate);
  if (!intent.length) return "logged";
  const today = new Date().toISOString().slice(0, 10);
  return intent.some((d) => d.iso && d.iso >= today) ? "upcoming" : "past";
}

const DATE_LABEL: Record<Derived["dateKind"], string> = {
  upcoming: "Mentions an upcoming date",
  past: "Mentions only past dates",
  logged: "Only log stamps",
  none: "No dates mentioned",
};

const monthLabel = (ym: string) => monthLabelOf(ym);

/** A tier-filter value meaning "the top verdict on any scanner": High
 *  priority (Main, CSP) or Strong Signal (Custom, older Main rows). */
const TOP = "__top";
/** The owners a filter offers: the people whose names head the sequences. */
const SEQUENCE_OWNERS = REPS;
async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* sandboxed frame: fall back */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch { return false; }
}
const TOP_TIER_SET = new Set(["High priority", "Strong Signal"]);

/** The two views Jack asked for by name: strong leads nobody has touched,
 *  and strong leads someone tried but never got through to. */
export type LeadsPreset = "top-uncontacted" | "top-unreached";
const PRESET: Record<LeadsPreset, { label: string; apollo: ApolloFilter; hint: string }> = {
  "top-uncontacted": {
    label: "Strong signal · never contacted", apollo: "never-called",
    hint: "Top tier on any scanner, with no call logged in Apollo. Includes leads Apollo has no record of — until a sync matches them, no call is known.",
  },
  "top-unreached": {
    label: "Strong signal · tried, not reached", apollo: "never-reached",
    hint: "Top tier on any scanner, called at least once in Apollo, never reached — only no answer, voicemail or gatekeeper.",
  },
};

const PARTS_KEY = "allLeadsHiddenParts";
const FILTERS_OPEN_KEY = "allLeadsFiltersOpen";
/** What Customize can show or hide on All leads. Column ids are "col-" +
 *  the table's data-col. Company and the checkbox always show. */
const ALL_LEADS_PARTS = [
  { id: "apollo", group: "Panels", label: "Apollo (pull, lookup list, import)" },
  { id: "standing", group: "Panels", label: "Apollo standing tiles" },
  { id: "deliverability", group: "Panels", label: "Email deliverability" },
  { id: "filters", group: "Panels", label: "Search & filters" },
  { id: "bulk", group: "Panels", label: "Actions bar (check, list, export)" },
  { id: "col-contact", group: "Table columns", label: "Contact" },
  { id: "col-stored", group: "Table columns", label: "Stored as" },
  { id: "col-line", group: "Table columns", label: "Product line" },
  { id: "col-received", group: "Table columns", label: "Received" },
  { id: "col-uploads", group: "Table columns", label: "Uploads" },
  { id: "col-atco", group: "Table columns", label: "At company" },
  { id: "col-meetings", group: "Table columns", label: "Meetings" },
  { id: "col-inapollo", group: "Table columns", label: "In Apollo" },
  { id: "col-touches", group: "Table columns", label: "Touchpoints" },
  { id: "col-recycle", group: "Table columns", label: "Recycle" },
  { id: "col-outreach", group: "Table columns", label: "Outreach" },
  { id: "col-disposition", group: "Table columns", label: "Disposition" },
  { id: "col-sequence", group: "Table columns", label: "Sequence" },
  { id: "col-notes", group: "Table columns", label: "Scanned note" },
] as const;

const NO_INDUSTRY = "(not enriched)";
/** The words every scanner's note uses for a stated partner ask: the Main
 *  note's "Wants to work with a partner." / Dynamics "Wants a partner.",
 *  and the CSP note's "⚑ Wants partner". */
const PARTNER_NOTE_RE = /\bwants?\s+(?:to\s+work\s+with\s+)?a?\s*partner\b|⚑\s*wants\s+partner/i;
const NO_LINE = "(no product line)";

/* --------------------------------------------------------------- component */

export default function AllLeads({
  leads, companyProfiles = [], onApplySync, initialSequence = "",
  sequenceNames = [], onSetPlan, onSetStatus, funnels = [], initialStatus, initialPreset,
  apolloIndex = null, rosterPulledAt = "", onPullApollo, onCheckLeads, onEnrichCompanies, onCheckVisits, lists = [], onAddToList,
  emailChecks = [], onImportVerifier, noteRefresh = null, onRefreshNotes,
  engagementCount = 0, onImportEngagements, recycleRules = DEFAULT_RECYCLE_RULES,
}: {
  /** Recycle rules — see lib/recycle.ts. */
  recycleRules?: RecycleRules;
  /** Deals and meetings on file — see lib/engagements.ts. */
  engagementCount?: number;
  onImportEngagements?: (files: ParsedFile[]) => Promise<{ imported: number; skipped: number; bySource: Record<string, number> }>;
  /** Rewriting stored Main notes with today's rules — see lib/noteRefresh.ts. */
  noteRefresh?: { done: number; total: number; changed: number; finished: boolean } | null;
  onRefreshNotes?: () => void;
  /** Verifier results per email — see lib/deliverability.ts. */
  emailChecks?: EmailCheck[];
  onImportVerifier?: (files: ParsedFile[]) => Promise<VerifierImport>;
  /** Per Jack: "a lead bank that i search through and can create lists". */
  lists?: LeadList[];
  onAddToList?: (rows: { row: ExportRow; scanner: "main" | "smc" | "csp" }[], opts: { existingId?: string; newName?: string }) => { listId: string; added: number; skipped: number } | null;
  /** Live Apollo lookup: sequence, step and status per lead. Read-only. */
  onCheckLeads?: (leads: StoredLead[], onProgress: (p: CheckProgress) => void, signal: AbortSignal) => Promise<CheckProgress>;
  /** Apollo company enrichment for the given leads' companies (credits). */
  onEnrichCompanies?: (leads: StoredLead[]) => Promise<{ found: number; missed: number; errors: number; message?: string }>;
  /** Apollo website-visitor check (wiredcio.com) for these leads' companies. */
  onCheckVisits?: (leads: StoredLead[], onProgress: (p: VisitProgress) => void, signal: AbortSignal) => Promise<VisitProgress>;
  /** Everyone known to be in Apollo — see lib/apolloRoster.ts. */
  apolloIndex?: RosterIndex | null;
  /** When Apollo uploads were last pulled. "" if never. */
  rosterPulledAt?: string;
  onPullApollo?: (months: number, onProgress: (p: PullProgress) => void, signal: AbortSignal) => Promise<PullProgress>;
  leads: StoredLead[];
  companyProfiles?: CompanyProfile[];
  onApplySync?: (files: ParsedFile[]) => Promise<SyncReport>;
  /** Seeded once on mount, from a campaign card's "open these leads". App
   *  keys this component on it, so arriving twice for the same sequence
   *  still remounts and re-seeds. */
  initialSequence?: string;
  sequenceNames?: string[];
  onSetPlan?: (keys: string[], sequence: string | null) => void;
  /** Hand-set (or clear, with null) the status of these leads. */
  onSetStatus?: (keys: string[], status: LeadStatus | null) => void;
  /** For "step 5 of 6" — total steps per sequence, when a funnel is held. */
  funnels?: ApolloFunnel[];
  /** Seeded once on mount, from a Home status link. */
  initialStatus?: LeadStatus;
  /** Seeded once on mount, from a Home tile. */
  initialPreset?: LeadsPreset;
}) {
  const [search, setSearch] = useState("");
  // Per Jack: "search through the notes with keywords". Its own box, read
  // as keywords, over the scan note AND the original CSV note text.
  const [noteSearch, setNoteSearch] = useState("");
  // Per Jack: "make it customizable like the home page". Which panels and
  // table columns show, and whether the search-and-filters section is open:
  // display preferences in this browser only.
  const [hiddenParts, setHiddenPartsState] = useState<Set<string>>(() => loadHiddenSet(PARTS_KEY, ALL_LEADS_PARTS));
  const setHiddenParts = (h: Set<string>) => { setHiddenPartsState(h); saveHiddenSet(PARTS_KEY, h); };
  const show = (id: string) => !hiddenParts.has(id);
  const hiddenCols = ALL_LEADS_PARTS.filter((p) => p.group === "Table columns" && hiddenParts.has(p.id)).map((p) => p.id.slice(4));
  const [filtersShown, setFiltersShownState] = useState(() => { try { return localStorage.getItem(FILTERS_OPEN_KEY) !== "0"; } catch { return true; } });
  const setFiltersShown = (v: boolean) => { setFiltersShownState(v); try { localStorage.setItem(FILTERS_OPEN_KEY, v ? "1" : "0"); } catch { /* preference only */ } };
  const [standingF, setStandingF] = useState<Standing | "needs" | "noseq" | "all">("all");
  // Per Jack: catch-alls "hurt but the numbers are great … i need a middle
  // ground". The score that earns the catch-all email lane is his to set.
  const [catchAllMin, setCatchAllMinState] = useState(() => {
    try { const v = Number(localStorage.getItem("catchAllMin")); return v > 0 && v <= 100 ? v : DEFAULT_CATCH_ALL_MIN; } catch { return DEFAULT_CATCH_ALL_MIN; }
  });
  const setCatchAllMin = (v: number) => { setCatchAllMinState(v); try { localStorage.setItem("catchAllMin", String(v)); } catch { /* preference only */ } };
  const [laneF, setLaneF] = useState<Lane | "green" | "all">("all");
  // Per Jack: "thin these large numbers down so i can add them to
  // sequences". Ready = an email Apollo won't flag (green-lit) AND a lead
  // that needs a sequence (never reached, no sequence, or not in Apollo).
  const [readyOnly, setReadyOnly] = useState(false);
  const [verifyNote, setVerifyNote] = useState("");
  const checkIndex = useMemo(() => indexChecks(emailChecks), [emailChecks]);
  const [rawIndex, setRawIndex] = useState<Map<string, string> | null>(null);
  const [partnerF, setPartnerF] = useState(false);
  const [rawIndexState, setRawIndexState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [sourceF, setSourceF] = useState<LeadSource | "all">("all");
  const [tierF, setTierF] = useState(initialPreset ? TOP : "all");
  const [lineF, setLineF] = useState("all");
  const [industryF, setIndustryF] = useState("all");
  // Per Jack: filter by "indsutry or excluded industry employee range and
  // the contacts not in active sequences".
  const [exclIndustries, setExclIndustries] = useState<string[]>([]);
  const [hideActive, setHideActive] = useState(false);
  const [visitedOnly, setVisitedOnly] = useState(false);
  const [sizeF, setSizeF] = useState("all");
  const [apolloF, setApolloF] = useState<ApolloFilter>(initialPreset ? PRESET[initialPreset].apollo : "all");
  const [seqF, setSeqF] = useState(initialSequence || "all");
  // Per Jack: "filter by owner of sequence also so i can see all carlys or all jacks".
  const [ownerF, setOwnerF] = useState<string>("all");
  const [copiedKey, setCopiedKey] = useState("");
  const [planF, setPlanF] = useState<PlanFilter>("all");
  const [planSeqF, setPlanSeqF] = useState("all");
  const [filesF, setFilesF] = useState<FilesFilter>("all");
  // Per Jack: "run it against specific csv files i upload … any csv file
  // that has been uploaded i should be able to go through in all leads".
  const [batchN, setBatchN] = useState(400);
  const [listTarget, setListTarget] = useState("");
  const [newListName, setNewListName] = useState("");
  const [listNotice, setListNotice] = useState("");
  const [fileNameF, setFileNameF] = useState("all");
  const [statusF, setStatusF] = useState<LeadStatus | "all">(initialStatus ?? "all");
  // "untouched" = no outreach on record at all: in Apollo with no call or
  // email, OR never matched by any sync. Per Jack, the point of the store is
  // to "filter down all never contacted leads and put them to action".
  const [contactF, setContactF] = useState<ContactState | "all" | "untouched">("all");
  const [monthF, setMonthF] = useState("all");
  const [levelF, setLevelF] = useState<TitleLevel | "all">("all");
  const [fnF, setFnF] = useState<TitleFunction | "all">("all");
  const [dateF, setDateF] = useState<Derived["dateKind"] | "all">("all");
  /** Per Jack: "if the company has more than one lead we have on file". */
  const [companyF, setCompanyF] = useState<"all" | "multi" | "single">("all");
  /** The vault's three buckets — see verdictOf. */
  const [verdictF, setVerdictF] = useState<Verdict | "all">("all");
  const [bulkStatus, setBulkStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  // Per Jack: "auto filter according to the csv date it was uploaded from" —
  // newest file first, by the date the CSV states (else its upload date).
  const [sort, setSort] = useState<SortKey>("received");
  const [pageSize, setPageSize] = useState(100);
  const [page, setPage] = useState(1);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkSeq, setBulkSeq] = useState("");
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [syncReport, setSyncReport] = useState<SyncReport | string | null>(null);
  const [syncing, setSyncing] = useState(false);
  /** Per Jack: never re-upload someone already in Apollo. */
  const [inApolloF, setInApolloF] = useState<InApolloFilter>("all");
  const [pull, setPull] = useState<PullProgress | null>(null);
  const [pullError, setPullError] = useState("");
  const [pullMonths, setPullMonths] = useState(DEFAULT_PULL_MONTHS);
  const pullAbort = useRef<AbortController | null>(null);
  const [check, setCheck] = useState<CheckProgress | null>(null);
  const [checkError, setCheckError] = useState("");
  const [recheck, setRecheck] = useState(false);
  const checkAbort = useRef<AbortController | null>(null);

  /* ---- derived, once per lead set ---- */
  const derived = useMemo(() => {
    const byCompany = new Map<string, { industry: string; employees: number | null }>();
    const m = new Map<string, Derived>();
    for (const l of leads) {
      const ck = normalizeCompanyKey(l.company);
      let c = byCompany.get(ck);
      if (!c) {
        const p = companyProfiles.length ? profileForCompany(companyProfiles, ck, [l.email]) : null;
        c = { industry: (p?.industry || "").trim(), employees: employeeCountOf(p) };
        byCompany.set(ck, c);
      }
      const a = l.apollo;
      const seqs = a?.sequences ?? [];
      const bucket = c.employees === null ? null : SIZE_BUCKETS.find((b) => b.test(c!.employees!));
      const engaged = engagementOf(l);
      m.set(l.key, {
        lane: laneOf(l.email, checkIndex.get((l.email || "").trim().toLowerCase()), catchAllMin, l.apollo?.live),
        standing: apolloStandingOf(l, apolloIndex),
        hay: [
          l.company, l.contact, l.title, l.email, l.phone, l.mobilePhone,
          l.productArea, l.tier, l.notes, c.industry, l.plan?.sequence ?? "",
          ...seqs.map((x) => x.name), ...l.sourceFiles,
        ].join(" \u0001").toLowerCase(),
        industry: c.industry || NO_INDUSTRY,
        employees: c.employees,
        sizeKey: bucket ? bucket.key : "unknown",
        line: l.productArea || NO_LINE,
        active: seqs.some((x) => x.status === "active"),
        finished: seqs.length > 0 && !seqs.some((x) => x.status === "active"),
        sequenced: seqs.length > 0,
        calls: a?.callCount ?? 0,
        has: !!a,
        files: l.sourceFiles.length,
        status: statusOf(l),
        reached: wasReached(a),
        month: arrivalOf(l).month,
        dateKind: dateKindOf(l.noteDates),
        nextDate: soonestUpcoming(l.noteDates),
        level: titleLevel(l.title),
        fn: titleFunction(l.title),
        contact: contactStateOf(l),
        companyKey: ck,
        segs: noteSegments(l.notes).length,
        verdict: verdictOf(l.tier),
        addedAt: seqs.reduce((m, x) => (x.addedAt && x.addedAt > m ? x.addedAt : m), ""),
        taskDoneAt: (a?.tasks ?? []).reduce((m, t) => (t.status === "completed" && t.at > m ? t.at : m), ""),
        inApollo: apolloHitFor({ email: l.email, contact: l.contact, company: l.company }, apolloIndex)
          ?? (a ? { how: "sync" as const, name: l.contact, sequences: seqs.map((x) => (x.status === "active" ? `${x.name} (active)` : x.name)) } : null),
        owners: ownersOf([...seqs.map((x) => x.name), ...(apolloHitFor({ email: l.email, contact: l.contact, company: l.company }, apolloIndex)?.sequences ?? [])], a?.live?.owner),
        // What a download leaves out — exactly as before the live check:
        // the pulled uploads and an imported sync, never a live result.
        // A deal or meeting on file: account manager only, never downloaded.
        exportBlocked: !!engaged || !!apolloHitFor({ email: l.email, contact: l.contact, company: l.company }, apolloIndex) || (!!a && !a.live),
        engaged,
      });
    }
    return m;
  }, [leads, companyProfiles, apolloIndex, checkIndex, catchAllMin]);

  /* ---- every contact stored at each company, and how far they got ---- */
  const companyStats = useMemo(() => {
    const m = new Map<string, { contacts: number; worked: number; made: number; names: string[] }>();
    for (const l of leads) {
      const d = derived.get(l.key)!;
      if (!d.companyKey) continue;
      let c = m.get(d.companyKey);
      if (!c) { c = { contacts: 0, worked: 0, made: 0, names: [] }; m.set(d.companyKey, c); }
      c.contacts++;
      if (d.contact === "attempted" || d.contact === "made" || d.contact === "meeting" || d.contact === "no") c.worked++;
      if (d.contact === "made" || d.contact === "meeting" || d.contact === "no") c.made++;
      if (c.names.length < 12) c.names.push(`${l.contact || "—"} — ${CONTACT_META[d.contact].label}`);
    }
    return m;
  }, [leads, derived]);

  /* ---- the predicates, one per filter, so each facet can skip its own ---- */
  const q = search.trim().toLowerCase();
  const kq = useMemo(() => parseKeywords(search), [search]);
  const nq = useMemo(() => parseKeywords(noteSearch), [noteSearch]);
  // Load the original notes the first time the notes search is used, and
  // again when the lead count changes (a new upload wrote new ones).
  useEffect(() => {
    if (nq.empty && !partnerF) return;
    let live = true;
    setRawIndexState("loading");
    loadRawNoteSearchIndex()
      .then((m) => { if (live) { setRawIndex(m); setRawIndexState("ready"); } })
      .catch(() => { if (live) setRawIndexState("error"); });
    return () => { live = false; };
  }, [nq.empty, partnerF, leads.length]);
  // Per Jack: "filter by … if someone states they want a partner". The same
  // confirmed-ask rule as the ⚑ badge and the notes line (partnerStanceOf),
  // read over the original CSV note, plus the scanned note's own words for
  // a lead stored before raw notes were kept. Worked out only while the
  // filter is on: it reads every note.
  const partnerKeys = useMemo(() => {
    if (!partnerF) return null;
    const out = new Set<string>();
    for (const l of leads) {
      const raw = rawIndex?.get(l.key);
      if (PARTNER_NOTE_RE.test(l.notes || "") || (raw && partnerStanceOf(raw).wantsPartner)) out.add(l.key);
    }
    return out;
  }, [partnerF, leads, rawIndex]);
  const fromT = from ? Date.parse(`${from}T00:00:00`) : null;
  const toT = to ? Date.parse(`${to}T23:59:59.999`) : null;

  type Key = "visited" | "partner" | "inApollo" | "verdict" | "company" | "contact" | "level" | "fn" | "month" | "dates" | "status" | "search" | "notes" | "standing" | "lane" | "ready" | "source" | "tier" | "line" | "industry" | "size" | "apollo" | "seq" | "owner" | "plan" | "planSeq" | "files" | "fileName" | "date";
  const tests = useMemo(() => {
    const t: Record<Key, (l: StoredLead, d: Derived) => boolean> = {
      inApollo: (l, d) => inApolloF === "all"
        || (inApolloF === "in" ? !!d.inApollo
          : inApolloF === "not" ? !d.inApollo
          : inApolloF === "checked-in" ? !!l.apolloCheckedAt && !!l.apollo?.live
          : inApolloF === "checked-not" ? !!l.apolloCheckedAt && !l.apollo?.live
          : !l.apolloCheckedAt),
      verdict: (_l, d) => verdictF === "all" || d.verdict === verdictF,
      company: (_l, d) => {
        if (companyF === "all") return true;
        const n = d.companyKey ? companyStats.get(d.companyKey)?.contacts ?? 1 : 1;
        return companyF === "multi" ? n > 1 : n <= 1;
      },
      status: (_l, d) => statusF === "all" || d.status === statusF,
      month: (_l, d) => monthF === "all" || d.month === monthF,
      level: (_l, d) => levelF === "all" || d.level === levelF,
      contact: (_l, d) => contactF === "all" || d.contact === contactF
        || (contactF === "untouched" && (d.contact === "never" || d.contact === "unknown"))
        // "Contact made" means any real conversation, whatever its outcome.
        || (contactF === "made" && (d.contact === "meeting" || d.contact === "no")),
      fn: (_l, d) => fnF === "all" || d.fn === fnF,
      dates: (_l, d) => dateF === "all" || d.dateKind === dateF,
      search: (_l, d) => !q || matchesKeywords(d.hay, kq),
      ready: (_l, d) => !readyOnly || (isGreenLit(d.lane) && NEEDS.has(d.standing)),
      lane: (_l, d) => laneF === "all" || (laneF === "green" ? isGreenLit(d.lane) : d.lane === laneF),
      standing: (_l, d) => (standingF === "all" || (standingF === "needs" ? NEEDS.has(d.standing) : standingF === "noseq" ? NO_SEQUENCE.has(d.standing) : d.standing === standingF))
        && !(hideActive && d.standing === "active"),
      partner: (l) => !partnerKeys || partnerKeys.has(l.key),
      visited: (l) => !visitedOnly || !!l.webVisits?.visited,
      notes: (l) => nq.empty || matchesKeywords(`${(l.notes || "").toLowerCase()} \u0001${rawIndex?.get(l.key) ?? ""}`, nq),
      source: (l) => sourceF === "all" || l.source === sourceF,
      tier: (l) => tierF === "all" || (tierF === TOP ? TOP_TIER_SET.has(l.tier) : l.tier === tierF),
      line: (_l, d) => lineF === "all" || d.line === lineF,
      industry: (_l, d) => (industryF === "all" || d.industry === industryF)
        && !(exclIndustries.length && d.industry && exclIndustries.includes(d.industry)),
      size: (_l, d) => sizeF === "all" || d.sizeKey === sizeF,
      apollo: (_l, d) => {
        switch (apolloF) {
          case "all": return true;
          case "active": return d.active;
          case "finished": return d.finished;
          case "never-sequenced": return !d.sequenced;
          case "called": return d.calls > 0;
          case "never-called": return d.calls === 0;
          case "never-reached": return d.calls > 0 && !d.reached;
          case "no-record": return !d.has;
        }
      },
      seq: (l) => seqF === "all" || (l.apollo?.sequences ?? []).some((x) => x.name === seqF),
      owner: (_l, d) => ownerF === "all" || (ownerF === "none" ? d.owners.length === 0 : d.owners.includes(ownerF)),
      plan: (l) => planF === "all"
        || (planF === "none" ? !l.plan : l.plan?.status === planF),
      planSeq: (l) => planSeqF === "all" || l.plan?.sequence === planSeqF,
      files: (_l, d) => filesF === "all"
        || (filesF === "2c" ? d.files >= 2 && d.segs > 1 : d.files >= Number(filesF) && (filesF !== "1" || d.files === 1)),
      fileName: (l) => fileNameF === "all" || l.sourceFiles.includes(fileNameF),
      date: (l) => {
        if (fromT === null && toT === null) return true;
        // The CSV's own date (the date the file states, else when it was
        // uploaded), so a range walks back through the files by month.
        const arr = arrivalOf(l);
        const t = Date.parse(arr.approx || l.receivedOn ? `${arr.date}T12:00:00` : l.firstSeenAt);
        return (fromT === null || t >= fromT) && (toT === null || t <= toT);
      },
    };
    return t;
  }, [inApolloF, verdictF, companyF, companyStats, contactF, levelF, fnF, monthF, dateF, statusF, q, kq, nq, rawIndex, standingF, laneF, readyOnly, sourceF, tierF, lineF, industryF, sizeF, apolloF, seqF, ownerF, planF, planSeqF, filesF, fileNameF, fromT, toT, partnerKeys, exclIndustries, hideActive, visitedOnly]);

  const passes = (l: StoredLead, skip?: Key) => {
    const d = derived.get(l.key)!;
    for (const k in tests) {
      if (k === skip) continue;
      if (!tests[k as Key](l, d)) return false;
    }
    return true;
  };

  const filtered = useMemo(() => {
    const out = leads.filter((l) => passes(l));
    const d = (l: StoredLead) => derived.get(l.key)!;
    const cmp: Record<SortKey, (a: StoredLead, b: StoredLead) => number> = {
      received: (a, b) => arrivalOf(b).date.localeCompare(arrivalOf(a).date) || b.lastSeenAt.localeCompare(a.lastSeenAt),
      last: (a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt),
      first: (a, b) => b.firstSeenAt.localeCompare(a.firstSeenAt),
      company: (a, b) => (a.company || "￿").localeCompare(b.company || "￿"),
      files: (a, b) => d(b).files - d(a).files || b.lastSeenAt.localeCompare(a.lastSeenAt),
      // A lead with no score sinks rather than being read as 0.
      score: (a, b) => (b.score ?? -1) - (a.score ?? -1),
      calls: (a, b) => d(b).calls - d(a).calls,
      // Leads with no upcoming date sink below every dated one.
      nextdate: (a, b) => (d(a).nextDate?.iso ?? "\uffff").localeCompare(d(b).nextDate?.iso ?? "\uffff"),
      // Undated leads sink, never read as the oldest date.
      added: (a, b) => (d(b).addedAt || "").localeCompare(d(a).addedAt || ""),
      taskdone: (a, b) => (d(b).taskDoneAt || "").localeCompare(d(a).taskDoneAt || ""),
    };
    return out.sort(cmp[sort]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leads, derived, tests, sort]);

  /** Counts for one facet, honouring every OTHER filter. */
  function facet(skip: Key, keyOf: (l: StoredLead, d: Derived) => string | string[]): Map<string, number> {
    const m = new Map<string, number>();
    for (const l of leads) {
      if (!passes(l, skip)) continue;
      const k = keyOf(l, derived.get(l.key)!);
      for (const v of Array.isArray(k) ? k : [k]) m.set(v, (m.get(v) || 0) + 1);
    }
    return m;
  }

  // Per Jack: "i need to see how many leads have been scanned against
  // apollo also and where they stand". Always visible, honouring every
  // other filter, so it answers for whatever slice is on screen.
  const standingCounts = useMemo(() => {
    const m = facet("standing", (_l, d) => d.standing);
    const by = Object.fromEntries(STANDING_ORDER.map((k) => [k, m.get(k) || 0])) as Record<Standing, number>;
    const total = STANDING_ORDER.reduce((n, k) => n + by[k], 0);
    return { by, total, checked: total - by.unchecked, needs: by.finished + by.none + by.out, noseq: by.none + by.out };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leads, derived, tests]);

  /** Every uploaded CSV, newest first, with how many leads match the other filters. */
  const fileOptions = useMemo(() => {
    const m = facet("fileName", (l) => l.sourceFiles);
    const first = new Map<string, string>();
    for (const l of leads) for (const f of l.sourceFiles) {
      const at = l.fileSeen?.find((x) => x.file === f)?.at || l.firstSeenAt || "";
      if (!first.has(f) || at > first.get(f)!) first.set(f, at);
    }
    return [...m.entries()].sort((a, b) => (first.get(b[0]) || "").localeCompare(first.get(a[0]) || "") || a[0].localeCompare(b[0]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leads, derived, tests]);

  const ownerCounts = useMemo(() => facet("owner", (_l, d) => (d.owners.length ? d.owners : ["none"])),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [leads, derived, tests]);

  /** Every month a CSV is dated, newest first, counted against the other filters. */
  const csvMonths = useMemo(() => [...facet("month", (_l, d) => d.month).entries()].sort((a, b) => b[0].localeCompare(a[0])),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [leads, derived, tests]);

  /** The uploaded files filed under the month each CSV is dated, newest
   *  month first. A file's date is the date in its name ("Book9-30",
   *  "10-1-26 big") when it states one, else the date its leads say they
   *  were received, else the upload date. */
  const fileMonths = useMemo(() => {
    const upload = new Map<string, string>();
    const recv = new Map<string, string>();
    for (const l of leads) for (const f of l.sourceFiles) {
      const at = l.fileSeen?.find((x) => x.file === f)?.at || l.firstSeenAt || "";
      if (at && (!upload.has(f) || at < upload.get(f)!)) upload.set(f, at);
      if (l.receivedOn && (!recv.has(f) || l.receivedOn > recv.get(f)!)) recv.set(f, l.receivedOn);
    }
    const dateOf = (f: string): string => {
      const up = (upload.get(f) || "").slice(0, 10);
      const year = up.slice(0, 4) || String(new Date().getFullYear());
      const m = /(?:^|[^\d])(\d{1,2})[-_.](\d{1,2})(?:[-_.](\d{2,4}))?(?:[^\d]|$)/.exec(f);
      if (m) {
        const mo = Number(m[1]), dd = Number(m[2]);
        if (mo >= 1 && mo <= 12 && dd >= 1 && dd <= 31) {
          const y = m[3] ? (m[3].length === 2 ? `20${m[3]}` : m[3]) : year;
          return `${y}-${String(mo).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
        }
      }
      // A Sheet file is pre-May: its estimate, or no day at all.
      if (isPreMaySheet(f)) return sheetEstimateOf(f) ?? "";
      return (recv.get(f) || up).slice(0, 10);
    };
    const groups = new Map<string, [string, number, string][]>();
    for (const [f, n] of fileOptions) {
      const d = dateOf(f);
      // An early numbered sheet has no date, only "before May 2026".
      const mk = isPreMaySheet(f) ? (d ? `${d.slice(0, 7)}~` : PRE_MAY_2026_MONTH) : d ? d.slice(0, 7) : "";
      if (!groups.has(mk)) groups.set(mk, []);
      groups.get(mk)!.push([f, n, d]);
    }
    for (const list of groups.values()) list.sort((a, b) => b[2].localeCompare(a[2]) || (sheetNumberOf(b[0]) ?? 0) - (sheetNumberOf(a[0]) ?? 0) || a[0].localeCompare(b[0]));
    return [...groups.entries()].sort((a, b) => (b[0] || "").localeCompare(a[0] || ""));
  }, [leads, fileOptions]);

  const laneCounts = useMemo(() => {
    const m = facet("lane", (_l, d) => d.lane);
    const by = Object.fromEntries(LANE_ORDER.map((k) => [k, m.get(k) || 0])) as Record<Lane, number>;
    let ready = 0;
    for (const l of leads) {
      if (!passes(l, "ready")) continue;
      const d = derived.get(l.key)!;
      if (isGreenLit(d.lane) && NEEDS.has(d.standing)) ready++;
    }
    return { by, ready, green: LANE_ORDER.filter(isGreenLit).reduce((n, k) => n + by[k], 0), total: LANE_ORDER.reduce((n, k) => n + by[k], 0) };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leads, derived, tests]);

  // Facets are computed only while the panel is open — at 25,000 leads a
  // dozen of them is real work, and nobody reads a count they cannot see.
  const facets = useMemo(() => {
    if (!filtersOpen) return null;
    return {
      line: facet("line", (_l, d) => d.line),
      industry: facet("industry", (_l, d) => d.industry),
      size: facet("size", (_l, d) => d.sizeKey),
      apollo: facet("apollo", (_l, d) => [
        ...(d.active ? ["active"] : []), ...(d.finished ? ["finished"] : []),
        d.sequenced ? "" : "never-sequenced", d.calls > 0 ? "called" : "never-called",
        d.calls > 0 && !d.reached ? "never-reached" : "",
        d.has ? "" : "no-record",
      ].filter(Boolean)),
      seq: facet("seq", (l) => (l.apollo?.sequences ?? []).map((x) => x.name)),
      plan: facet("plan", (l) => (l.plan ? l.plan.status : "none")),
      planSeq: facet("planSeq", (l) => (l.plan ? [l.plan.sequence] : [])),
      files: facet("files", (_l, d) => [d.files === 1 ? "1" : "", d.files >= 2 ? "2" : "", d.files >= 2 && d.segs > 1 ? "2c" : "", d.files >= 3 ? "3" : ""].filter(Boolean)),
      fileName: facet("fileName", (l) => l.sourceFiles),
      month: facet("month", (_l, d) => d.month),
      fn: facet("fn", (_l, d) => d.fn),
      dates: facet("dates", (_l, d) => d.dateKind),
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersOpen, leads, derived, tests]);

  // The verdict strip is a facet like any other: each count is what that
  // bucket would show given every OTHER filter.
  const verdictCounts = useMemo(() => {
    const m: Record<Verdict, number> = { strong: 0, review: 0, bad: 0 };
    for (const l of leads) if (passes(l, "verdict")) m[derived.get(l.key)!.verdict]++;
    return m;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leads, derived, tests]);

  const contactCounts = useMemo(() => {
    const m = Object.fromEntries(CONTACT_ORDER.map((x) => [x, 0])) as Record<ContactState, number>;
    for (const l of leads) if (passes(l, "contact")) m[derived.get(l.key)!.contact]++;
    return m;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leads, derived, tests]);

  const levelCounts = useMemo(() => {
    const m = Object.fromEntries(LEVEL_ORDER.map((x) => [x, 0])) as Record<TitleLevel, number>;
    for (const l of leads) if (passes(l, "level")) m[derived.get(l.key)!.level]++;
    return m;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leads, derived, tests]);

  const inApolloCounts = useMemo(() => {
    const m = { in: 0, not: 0 };
    for (const l of leads) if (passes(l, "inApollo")) m[derived.get(l.key)!.inApollo ? "in" : "not"]++;
    return m;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leads, derived, tests]);

  // Per Jack: the Scanner filter shows how many leads came from each one.
  const sourceCounts = useMemo(() => {
    const m: Record<LeadSource, number> = { main: 0, smc: 0, csp: 0 };
    for (const l of leads) if (passes(l, "source") && l.source in m) m[l.source]++;
    return m;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leads, derived, tests]);

  const tiers = useMemo(() => [...new Set(leads.map((l) => l.tier).filter(Boolean))].sort(), [leads]);
  const ageDays = useMemo(() => syncAgeDays(leads), [leads]);

  useEffect(() => { setPage(1); }, [tests, sort, pageSize]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const shown = filtered.slice((page - 1) * pageSize, page * pageSize);
  // Per Jack: "only have summarized note visible". The raw CSV note is not
  // shown in this table at all; it lives in the lead record, behind its own
  // password (lib/rawNoteLock.ts).
  const allShownSelected = shown.length > 0 && shown.every((l) => selected.has(l.key));
  const selectedLeads = useMemo(() => leads.filter((l) => selected.has(l.key)), [leads, selected]);

  /* ---- active filter chips ---- */
  const chips: { label: string; clear: () => void }[] = [];
  if (readyOnly) chips.push({ label: "Ready to sequence", clear: () => setReadyOnly(false) });
  if (partnerF) chips.push({ label: "⚑ Wants a partner", clear: () => setPartnerF(false) });
  if (laneF !== "all") chips.push({ label: `Email: ${laneF === "green" ? "Green-lit" : LANE_META[laneF].label}`, clear: () => setLaneF("all") });
  if (standingF !== "all") chips.push({ label: `Apollo: ${standingF === "needs" ? "Needs a sequence" : standingF === "noseq" ? "Never sequenced" : STANDING_META[standingF].label}`, clear: () => setStandingF("all") });
  if (!nq.empty) chips.push({ label: `Notes: ${noteSearch.trim()}`, clear: () => setNoteSearch("") });
  if (inApolloF !== "all") chips.push({ label: inApolloF === "in" ? "Already in Apollo" : "Not in Apollo", clear: () => setInApolloF("all") });
  if (contactF !== "all") chips.push({ label: contactF === "untouched" ? "Never touched (no outreach on record)" : CONTACT_META[contactF].label, clear: () => setContactF("all") });
  if (levelF !== "all") chips.push({ label: `Position: ${LEVEL_META[levelF].label}`, clear: () => setLevelF("all") });
  if (fnF !== "all") chips.push({ label: FUNCTION_META[fnF].label, clear: () => setFnF("all") });
  if (verdictF !== "all") chips.push({ label: VERDICT_META[verdictF].label, clear: () => setVerdictF("all") });
  if (companyF !== "all") chips.push({ label: companyF === "multi" ? "2+ leads at the company" : "Only lead at the company", clear: () => setCompanyF("all") });
  if (monthF !== "all") chips.push({ label: `CSV month ${monthLabel(monthF)}`, clear: () => setMonthF("all") });
  if (dateF !== "all") chips.push({ label: DATE_LABEL[dateF], clear: () => setDateF("all") });
  if (statusF !== "all") chips.push({ label: `Status: ${STATUS_META[statusF].label}`, clear: () => setStatusF("all") });
  if (sourceF !== "all") chips.push({ label: LEAD_SOURCE_META[sourceF].label, clear: () => setSourceF("all") });
  if (tierF !== "all") chips.push({ label: tierF === TOP ? "Top tier" : tierF, clear: () => setTierF("all") });
  if (lineF !== "all") chips.push({ label: lineF, clear: () => setLineF("all") });
  if (industryF !== "all") chips.push({ label: `Industry: ${industryF}`, clear: () => setIndustryF("all") });
  for (const x of exclIndustries) chips.push({ label: `Not ${x}`, clear: () => setExclIndustries((v) => v.filter((y) => y !== x)) });
  if (hideActive) chips.push({ label: "Hiding active in a sequence", clear: () => setHideActive(false) });
  if (visitedOnly) chips.push({ label: `🌐 Visited ${TRACKED_DOMAIN}`, clear: () => setVisitedOnly(false) });
  if (sizeF !== "all") chips.push({ label: `Employees: ${SIZE_BUCKETS.find((b) => b.key === sizeF)?.label ?? "unknown"}`, clear: () => setSizeF("all") });
  if (apolloF !== "all") chips.push({ label: APOLLO_LABEL[apolloF], clear: () => setApolloF("all") });
  if (seqF !== "all") chips.push({ label: `In: ${seqF}`, clear: () => setSeqF("all") });
  if (ownerF !== "all") chips.push({ label: ownerF === "none" ? "No sequence owner" : `${ownerF}'s sequences`, clear: () => setOwnerF("all") });
  if (planF !== "all") chips.push({ label: PLAN_LABEL[planF], clear: () => setPlanF("all") });
  if (planSeqF !== "all") chips.push({ label: `Headed for: ${planSeqF}`, clear: () => setPlanSeqF("all") });
  if (filesF !== "all") chips.push({ label: FILES_LABEL[filesF], clear: () => setFilesF("all") });
  if (fileNameF !== "all") chips.push({ label: `File: ${fileNameF}`, clear: () => setFileNameF("all") });
  if (from || to) chips.push({ label: `CSV date ${from || "…"} → ${to || "…"}`, clear: () => { setFrom(""); setTo(""); } });
  // How many of the More filters panel's own filters are on — the badge on
  // its button. The open filters and the tiles show their own state.
  const moreCount = [lineF, tierF, levelF, fnF, industryF, sizeF, companyF, seqF, ownerF, inApolloF, monthF, dateF, filesF, planF, planSeqF]
    .filter((v) => v !== "all").length + (from || to ? 1 : 0);
  const clearAll = () => chips.forEach((c) => c.clear());

  /* ---- actions ---- */
  function toggle(key: string) {
    setSelected((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });
  }
  function selectPage() {
    setSelected((s) => {
      const n = new Set(s);
      if (allShownSelected) shown.forEach((l) => n.delete(l.key)); else shown.forEach((l) => n.add(l.key));
      return n;
    });
  }

  /** Per Jack: "make sure i am not reuploading leads that have already been
   *  uploaded in apollo". Anyone already in Apollo is left out of every
   *  export, and the button says how many. */
  const notInApollo = (set: StoredLead[]) => set.filter((l) => !derived.get(l.key)?.exportBlocked);
  async function exportSet(set: StoredLead[], label: string) {
    const clean = notInApollo(set);
    if (!clean.length || exporting) return;
    setExporting(true);
    try { await downloadCampaignCSV(clean, companyProfiles, label); } finally { setExporting(false); }
  }

  // Per Jack: check "this mass or one by one select page what not" — the
  // selection when there is one, otherwise everything matched.
  const weekAgo = useMemo(() => new Date(Date.now() - 7 * 86_400_000).toISOString(), [check?.finished]);
  const checkBase = selected.size ? selectedLeads : filtered;
  // Strong Signal first, then a batch at a time — Apollo allows 400
  // lookups an hour, so "next 400" is the natural unit at 38,000 leads.
  const checkDue = useMemo(() => {
    const due = recheck ? [...checkBase] : checkBase.filter((l) => !(l.apolloCheckedAt && l.apolloCheckedAt > weekAgo));
    const rank = (l: StoredLead) => ({ strong: 0, review: 1, bad: 2 })[verdictOf(l.tier)];
    return due.sort((a, b) => rank(a) - rank(b));
  }, [checkBase, recheck, weekAgo]);
  const checkTargets = useMemo(() => (batchN && !selected.size ? checkDue.slice(0, batchN) : checkDue), [checkDue, batchN, selected.size]);
  const checkCounts = useMemo(() => {
    let found = 0, notFound = 0, unchecked = 0;
    for (const l of leads) {
      if (!l.apolloCheckedAt) unchecked++;
      else if (l.apollo?.live) found++;
      else notFound++;
    }
    return { found, notFound, unchecked };
  }, [leads]);
  const checking = !!check && !check.finished;

  // Per Jack: "apollo enrichment for company data is very powerful". The
  // companies behind the selection (or everything matched) that have no
  // profile yet, looked up once each, credit cost stated before anything runs.
  const [enriching, setEnriching] = useState(false);
  const [enrichNote, setEnrichNote] = useState("");
  const enrichTargets = useMemo(() => {
    const pool = selected.size ? leads.filter((l) => selected.has(l.key)) : filtered;
    return companiesNeedingEnrichment(pool.map((l) => ({ company: l.company, email: l.email })), companyProfiles);
  }, [selected, leads, filtered, companyProfiles]);
  async function runEnrich() {
    if (!onEnrichCompanies || enriching || !enrichTargets.length) return;
    const n = Math.min(enrichTargets.length, MAX_COMPANY_BATCH);
    if (!window.confirm(`Enrich ${n.toLocaleString()} compan${n === 1 ? "y" : "ies"} from Apollo? This will consume up to ${n.toLocaleString()} Apollo credits (no charge for any not found).${enrichTargets.length > n ? ` The first ${n} of ${enrichTargets.length.toLocaleString()} per click.` : ""}`)) return;
    setEnriching(true); setEnrichNote("");
    const pool = selected.size ? leads.filter((l) => selected.has(l.key)) : filtered;
    const r = await onEnrichCompanies(pool);
    setEnriching(false);
    setEnrichNote(`Apollo: ${r.found} found, ${r.missed} not found${r.errors ? `, ${r.errors} failed${r.message ? ` (${r.message})` : ""}` : ""}.`);
  }

  // Website visits: per Jack, "if their company searched us and we have a
  // contact there". Only leads a live Apollo check has matched carry the
  // company id this needs.
  const [visits, setVisits] = useState<VisitProgress | null>(null);
  const [visitErr, setVisitErr] = useState("");
  const visitAbort = useRef<AbortController | null>(null);
  const visitPool = useMemo(() => (selected.size ? leads.filter((l) => selected.has(l.key)) : filtered), [selected, leads, filtered]);
  const visitOrgs = useMemo(() => orgIdsOf(visitPool), [visitPool]);
  async function runVisits() {
    if (!onCheckVisits || (visits && !visits.finished) || !visitOrgs.length) return;
    const ac = new AbortController(); visitAbort.current = ac; setVisitErr("");
    try { setVisits(await onCheckVisits(visitPool, setVisits, ac.signal)); }
    catch (e) { setVisitErr(e instanceof Error ? e.message : String(e)); setVisits(null); }
    finally { visitAbort.current = null; }
  }

  async function runCheck(only?: StoredLead[]) {
    const targets = only ?? checkTargets;
    if (!onCheckLeads || checking || !targets.length) return;
    const ac = new AbortController();
    checkAbort.current = ac;
    setCheckError("");
    setCheck({ total: targets.length, done: 0, found: 0, notFound: 0, skipped: 0, errors: 0, finished: false });
    try {
      const p = await onCheckLeads(targets, setCheck, ac.signal);
      setCheck({ ...p, finished: true });
    } catch (e) {
      setCheckError(e instanceof Error ? e.message : String(e));
      setCheck((x) => (x ? { ...x, finished: true } : x));
    } finally { checkAbort.current = null; }
  }

  async function runPull() {
    if (!onPullApollo || pull && !pull.done) return;
    const ac = new AbortController();
    pullAbort.current = ac;
    setPullError("");
    setPull({ pages: 0, scanned: 0, kept: 0, reachedDate: "", done: false, hitCeiling: false });
    try {
      const p = await onPullApollo(pullMonths, (x) => setPull(x), ac.signal);
      setPull({ ...p, done: true });
    } catch (e) {
      setPullError(e instanceof Error ? e.message : String(e));
      setPull((x) => (x ? { ...x, done: true } : x));
    } finally { pullAbort.current = null; }
  }

  async function exportLookupList() {
    const rows = leadsToSync(leads).map((l) => ({ Email: l.email, Name: l.contact, Company: l.company }));
    await downloadBlob(toCSV(rows, ["Email", "Name", "Company"] as const),
      `apollo-lookup-${rows.length}-${new Date().toISOString().slice(0, 10)}.csv`);
  }

  /** Emails worth paying a verifier for: in the current filter (or the
   *  selection), not already green-lit or confirmed bad, and with no fresh
   *  verifier result. Apollo's free check should run first — it settles
   *  every address Apollo already holds. */
  const verifyBase = selected.size ? selectedLeads : filtered;
  const toVerify = useMemo(() => emailsToVerify(
    verifyBase.filter((l) => { const ln = derived.get(l.key)?.lane; return ln === "unverified" || ln === "catch-all-call"; }),
    checkIndex,
  ), [verifyBase, derived, checkIndex]);
  async function exportForVerifier() {
    if (!toVerify.length) return;
    const rows = toVerify.map((l) => {
      const [first, ...rest] = (l.contact || "").trim().split(/\s+/);
      return { Email: l.email.trim(), "First Name": first || "", "Last Name": rest.join(" "), Company: l.company };
    });
    await downloadBlob(toCSV(rows, ["Email", "First Name", "Last Name", "Company"] as const),
      `emails-to-verify-${rows.length}-${new Date().toISOString().slice(0, 10)}.csv`);
  }
  async function importVerifierFile(files: FileList | null) {
    if (!files?.length || !onImportVerifier) return;
    try {
      const parsed = await Promise.all([...files].map((f) => parseCSVFile(f)));
      const r = await onImportVerifier(parsed as ParsedFile[]);
      if (!r.mapping.email || !r.mapping.status) {
        setVerifyNote(`Couldn't read that file: no ${!r.mapping.email ? "email" : "status/result"} column found.`);
        return;
      }
      setVerifyNote(`Imported ${r.checks.length.toLocaleString()} results: ${r.byStatus.valid} valid · ${r.byStatus["catch-all"]} catch-all · ${r.byStatus.risky + r.byStatus.unknown} risky/unknown · ${r.byStatus.invalid} invalid${r.skipped ? ` · ${r.skipped} rows skipped` : ""}${r.mapping.score ? "" : " · no score column, so catch-alls stay call-first unless Apollo allows them"}.`);
    } catch (e) {
      setVerifyNote(e instanceof Error ? e.message : String(e));
    }
  }

  const [engageNote, setEngageNote] = useState("");
  async function importEngagementFile(files: FileList | null) {
    if (!files?.length || !onImportEngagements) return;
    try {
      const parsed = await Promise.all([...files].map((f) => parseCSVFile(f)));
      const r = await onImportEngagements(parsed as ParsedFile[]);
      const parts = Object.entries(r.bySource).map(([k, n]) => `${n.toLocaleString()} ${ENGAGEMENT_SOURCE_META[k as keyof typeof ENGAGEMENT_SOURCE_META]?.label ?? k}`);
      setEngageNote(r.imported
        ? `Imported ${r.imported.toLocaleString()} deals and meetings (${parts.join(" · ")})${r.skipped ? ` · ${r.skipped} rows skipped` : ""}. Leads they cover are now Account manager only.`
        : `Nothing imported${r.skipped ? ` — ${r.skipped} rows had no source or nothing to match on` : ""}. The file needs Source, Company, Domain or Email columns.`);
    } catch (e) {
      setEngageNote(e instanceof Error ? e.message : String(e));
    }
  }

  async function importSyncFile(files: FileList | null) {
    if (!files?.length || !onApplySync || syncing) return;
    setSyncing(true); setSyncReport(null);
    try {
      const parsed = await Promise.all([...files].map((f) => parseCSVFile(f)));
      setSyncReport(await onApplySync(parsed as ParsedFile[]));
    } catch (e) {
      setSyncReport(e instanceof Error ? e.message : String(e));
    } finally { setSyncing(false); }
  }

  const filterLabel = chips.map((c) => c.label).join(" ") || "all";
  const openLead = openKey ? leads.find((l) => l.key === openKey) : null;

  /* ---- an option list with counts, for a select inside the filter panel ---- */
  const opts = (m: Map<string, number> | undefined, labelOf: (k: string) => string = (k) => k) =>
    [...(m ?? new Map()).entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => (
      <option key={k} value={k}>{labelOf(k)} ({n.toLocaleString()})</option>
    ));

  if (leads.length === 0) {
    return (
      <>
        <div className="page-head">
          <div><h2>All leads</h2><p className="page-sub">Every lead scanned, from all three scanners.</p></div>
        </div>
        <div className="calm-state">
          <div className="calm-title">Nothing stored yet</div>
          <div className="calm-body">Every lead you scan from here on is kept — all three scanners, every tier.</div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h2>All leads</h2>
          <p className="page-sub">
            {leads.length.toLocaleString()} lead{leads.length === 1 ? "" : "s"} stored from all three scanners
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
          <Customize items={ALL_LEADS_PARTS} hidden={hiddenParts} onChange={setHiddenParts} label="Customize all leads" />
        {onRefreshNotes && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
            {noteRefresh && (
              <span className="muted" aria-live="polite">
                {noteRefresh.finished
                  ? `Notes refreshed · ${noteRefresh.changed.toLocaleString()} updated`
                  : `Refreshing notes… ${noteRefresh.done.toLocaleString()} of ${noteRefresh.total.toLocaleString()}`}
              </span>
            )}
            <button
              className="btn btn-secondary btn-sm"
              disabled={!!noteRefresh && !noteRefresh.finished}
              onClick={onRefreshNotes}
              title="Rewrite every Main Scanner lead's newest note from its stored CSV row with today's rules, including its tier and score. Apollo data, lists and anything marked not-a-fit are not changed."
            >↻ Refresh with today's rules</button>
          </div>
        )}
        </div>
      </div>

      {/* Apollo state is only as fresh as the last sync, so its age is
          stated here, every time. */}
      {show("apollo") && (<>
      <details className="panel fold" style={{ marginBottom: 10 }}>
        <summary className="fold-head"><b>Apollo</b><span className="muted">{rosterPulledAt ? ` · uploads pulled ${rosterPulledAt.slice(0, 10)}` : " · uploads not pulled yet"} · pull, lookup list, import sync</span></summary>
        <div className="panel-body" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 12.5 }}>
          <b>Apollo</b>
          {ageDays === null ? (
            <span style={{ color: "var(--muted)" }}>
              {checkCounts.found + checkCounts.notFound > 0
                ? <>No sync imported. <b style={{ color: "var(--ink)" }}>{(checkCounts.found + checkCounts.notFound).toLocaleString()}</b> checked live in Apollo
                    ({checkCounts.found.toLocaleString()} found) · {checkCounts.unchecked.toLocaleString()} not checked yet — select leads and press ⟳ Check in Apollo.</>
                : <>Not synced and not checked yet, so nothing here reads as "in Apollo" yet. Select one lead, a page, or none for
                    everything matched, then press ⟳ Check in Apollo below.</>}
            </span>
          ) : (
            <span style={{ color: ageDays > SYNC_STALE_DAYS ? "#B5443B" : "var(--muted)" }}>
              Synced {ageDays === 0 ? "today" : `${ageDays} day${ageDays === 1 ? "" : "s"} ago`}
              {ageDays > SYNC_STALE_DAYS ? " — stale, re-sync before trusting these." : "."}
            </span>
          )}
          {onApplySync && (
            <>
              <div className="toolbar-spacer" />
              {onPullApollo && (
                <>
                  <select className="field" aria-label="How far back" value={pullMonths}
                          onChange={(e) => setPullMonths(Number(e.target.value))} disabled={!!pull && !pull.done}>
                    {[1, 2, 3, 4, 6].map((m) => <option key={m} value={m}>Last {m} month{m === 1 ? "" : "s"}</option>)}
                  </select>
                  {pull && !pull.done ? (
                    <button className="btn btn-sm btn-secondary" onClick={() => pullAbort.current?.abort()}>Stop</button>
                  ) : (
                    <button className="btn btn-sm btn-primary" onClick={runPull}
                            title="Read the CSV uploads you made into Apollo for you and Carly, and check every lead here against them. Read-only — nothing is written to Apollo.">
                      ⟳ Pull Apollo uploads
                    </button>
                  )}
                </>
              )}
              <button className="btn btn-sm btn-ghost" onClick={exportLookupList}
                      title="Download the people to look up in Apollo: email, name, company.">⬇ Lookup list</button>
              <label className="btn btn-sm btn-ghost" style={{ cursor: syncing ? "default" : "pointer" }}
                     title="Load a sync file from Apollo. Sequence and call state are replaced, not merged.">
                {syncing ? "Reading…" : "⬆ Import sync"}
                <input type="file" accept=".csv,text/csv" multiple hidden disabled={syncing}
                       onChange={(e) => { importSyncFile(e.target.files); e.target.value = ""; }} />
              </label>
            </>
          )}
          {onImportEngagements && (
            <label className="btn btn-sm btn-ghost" style={{ cursor: "pointer" }}
                   title="Deals and sales meetings from HubSpot, Notion and Echo. A lead they cover becomes Account manager only: kept, never downloaded, never in 'needs a sequence'. Re-importing a source replaces it.">
              ⬆ Import deals &amp; meetings{engagementCount ? ` (${engagementCount.toLocaleString()} on file)` : ""}
              <input type="file" accept=".csv,text/csv" multiple hidden aria-label="Import deals and meetings"
                     onChange={(e) => { void importEngagementFile(e.target.files); e.target.value = ""; }} />
            </label>
          )}
        </div>
        {engageNote && <div className="panel-body" style={{ paddingTop: 0, fontSize: 12 }} aria-label="Deals and meetings notice">{engageNote}</div>}
        {(pull || pullError || apolloIndex) && (
          <div className="panel-body" style={{ paddingTop: 0, fontSize: 12 }} aria-label="Apollo uploads">
            {pull && !pull.done && (
              <>Reading Apollo… {pull.scanned.toLocaleString()} contacts read, back to {pull.reachedDate || "—"} ·{" "}
                <b>{pull.kept.toLocaleString()}</b> uploaded by you or Carly kept.</>
            )}
            {pull && pull.done && !pullError && (
              <>Pulled <b>{pull.kept.toLocaleString()}</b> Apollo uploads from {pull.reachedDate ? `${pull.reachedDate} on` : "the window"}.
                {pull.hitCeiling && " Apollo's 50,000-contact limit stopped it early — pick a shorter window."}{" "}</>
            )}
            {pullError && <span style={{ color: "#B5443B" }}>Apollo pull stopped: {pullError} </span>}
            {(!pull || pull.done) && apolloIndex && apolloIndex.size > 0 && (
              <span style={{ color: "var(--muted)" }}>
                {apolloIndex.size.toLocaleString()} people known to be in Apollo
                {rosterPulledAt ? ` · uploads last pulled ${rosterPulledAt.slice(0, 10)}` : " · uploads not pulled yet"}
                {" · "}<b style={{ color: "var(--ink)" }}>{inApolloCounts.in.toLocaleString()}</b> of the leads here are already in Apollo.
              </span>
            )}
          </div>
        )}
        {syncReport && (
          <div className="panel-body" style={{ paddingTop: 0, fontSize: 12 }}>
            {typeof syncReport === "string" ? (
              <span style={{ color: "#B5443B" }}>Sync failed: {syncReport}</span>
            ) : (
              <>
                <b>{syncReport.matched.toLocaleString()}</b> of {syncReport.rows.toLocaleString()} rows matched a stored lead.
                {(syncReport.matchedByName ?? 0) > 0 && <> {syncReport.matchedByName!.toLocaleString()} of those on full name alone (the file carried no email or company).</>}
                {syncReport.unmatched > 0 && <> {syncReport.unmatched.toLocaleString()} matched nobody here.</>}
                {(syncReport.ambiguous ?? 0) > 0 && <> {syncReport.ambiguous!.toLocaleString()} left unmatched because the name fits more than one stored lead.</>}
                {syncReport.skipped > 0 && <> {syncReport.skipped.toLocaleString()} could not be keyed.</>}
                {syncReport.unmapped.length > 0 && <div style={{ color: "var(--muted)" }}>Unmapped: {syncReport.unmapped.join(", ")}</div>}
                <button className="btn btn-sm btn-ghost" style={{ marginLeft: 6 }} onClick={() => setSyncReport(null)}>Dismiss</button>
              </>
            )}
          </div>
        )}
      </details>

      </>)}

      {/* ---- where every lead stands in Apollo ---- */}
      {show("standing") && (<>
      <div className="panel" aria-label="Apollo standing" style={{ marginBottom: 10 }}>
        <div className="panel-head" style={{ fontSize: 12.5 }}>
          <span><b>{standingCounts.checked.toLocaleString()}</b> of {standingCounts.total.toLocaleString()} leads checked against Apollo
            {standingCounts.total > 0 && <span className="muted"> ({Math.round((standingCounts.checked / standingCounts.total) * 100)}%)</span>}</span>
        </div>
        <div className="panel-body" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button className="vault-tile" aria-pressed={standingF === "noseq" && verdictF === "strong"}
                  title="Strong Signal (and CSP High priority) leads that are not in Apollo, or are in Apollo with no sequence."
                  style={{ borderColor: standingF === "noseq" && verdictF === "strong" ? "#B5443B" : undefined, borderWidth: 2 }}
                  onClick={() => { const on = standingF === "noseq" && verdictF === "strong"; setStandingF(on ? "all" : "noseq"); setVerdictF(on ? "all" : "strong"); }}>
            <span className="vault-num" style={{ color: "#B5443B" }}>★</span>
            <span><b>Strong Signal, never sequenced</b></span>
          </button>
          <button className="vault-tile" aria-pressed={standingF === "needs"} title="Never reached, never put in a sequence, or not in Apollo."
                  style={{ borderColor: standingF === "needs" ? "#B5443B" : undefined }}
                  onClick={() => setStandingF(standingF === "needs" ? "all" : "needs")}>
            <span className="vault-num" style={{ color: "#B5443B" }}>{standingCounts.needs.toLocaleString()}</span>
            <span>Needs a sequence</span>
          </button>
          <button className="vault-tile" aria-pressed={standingF === "noseq"} title="Never put in a sequence: not in Apollo, or in Apollo with no sequence."
                  style={{ borderColor: standingF === "noseq" ? "#B5443B" : undefined }}
                  onClick={() => setStandingF(standingF === "noseq" ? "all" : "noseq")}>
            <span className="vault-num" style={{ color: "#B5443B" }}>{standingCounts.noseq.toLocaleString()}</span>
            <span>Never sequenced</span>
          </button>
          {STANDING_ORDER.map((k) => {
            const on = standingF === k; const m = STANDING_META[k];
            return (
              <button key={k} className="vault-tile" aria-pressed={on} title={m.hint}
                      style={{ borderColor: on ? m.color : undefined, background: on ? m.bg : undefined }}
                      onClick={() => setStandingF(on ? "all" : k)}>
                <span className="vault-num" style={{ color: m.color }}>{standingCounts.by[k].toLocaleString()}</span>
                <span>{m.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      </>)}

      {/* ---- email deliverability: recognised and green-lit before Apollo ---- */}
      {show("deliverability") && (<>
      <details className="panel fold" aria-label="Email deliverability" style={{ marginBottom: 10 }}>
        <summary className="fold-head"><b>Email deliverability</b><span className="muted"> · {laneCounts.green.toLocaleString()} of {laneCounts.total.toLocaleString()} green-lit</span></summary>
        <div className="panel-head" style={{ fontSize: 12.5, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span><b style={{ color: "#1F7A4D" }}>{laneCounts.green.toLocaleString()}</b> of {laneCounts.total.toLocaleString()} green-lit to email
            <span className="muted"> · Apollo's own verdict from the check, plus any verifier results</span></span>
          <span style={{ flex: 1 }} />
          <label style={{ display: "flex", gap: 6, alignItems: "center" }} title="A catch-all address with a verifier score at or above this goes in the email lane. Apollo's 'allow' verdict green-lights it regardless.">
            Catch-all score to email ≥
            <input className="field" type="number" min={1} max={100} value={catchAllMin} style={{ width: 64 }} aria-label="Catch-all score cutoff"
                   onChange={(e) => { const v = Number(e.target.value); if (v >= 1 && v <= 100) setCatchAllMin(v); }} />
          </label>
          <button className="btn btn-sm btn-secondary" disabled={!toVerify.length} onClick={exportForVerifier}
                  title="Emails in this filter (or selection) that Apollo couldn't settle: not verified yet, or a catch-all it screens. Each address is paid for once — anything with a fresh result is skipped.">
            ⬇ Export {toVerify.length.toLocaleString()} to verify
          </button>
          {onImportVerifier && (
            <label className="btn btn-sm btn-secondary" style={{ cursor: "pointer" }} title="The results file from Bouncer, ZeroBounce, NeverBounce, Kickbox or Scrubby — any of them; the columns are detected.">
              ⬆ Import verifier results
              <input type="file" accept=".csv" multiple hidden aria-label="Import verifier results" onChange={(e) => { void importVerifierFile(e.target.files); e.target.value = ""; }} />
            </label>
          )}
        </div>
        <div className="panel-body" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button className="vault-tile" aria-pressed={readyOnly} aria-label="Ready to sequence"
                  title="Green-lit email (Apollo won't flag it) AND needs a sequence: never reached, no sequence, or not in Apollo. Leads not checked against Apollo yet aren't counted — check them first."
                  style={{ borderColor: readyOnly ? "var(--accent, #0E7A72)" : undefined, background: readyOnly ? "#E3F3F1" : undefined }}
                  onClick={() => setReadyOnly(!readyOnly)}>
            <span className="vault-num" style={{ color: "var(--accent, #0E7A72)" }}>{laneCounts.ready.toLocaleString()}</span>
            <span>🚀 Ready to sequence</span>
          </button>
          <button className="vault-tile" aria-pressed={laneF === "green"} title="Verified, plus catch-alls Apollo allows or the verifier scores high."
                  style={{ borderColor: laneF === "green" ? "#1F7A4D" : undefined }}
                  onClick={() => setLaneF(laneF === "green" ? "all" : "green")}>
            <span className="vault-num" style={{ color: "#1F7A4D" }}>{laneCounts.green.toLocaleString()}</span>
            <span>✓ Green-lit</span>
          </button>
          {LANE_ORDER.map((k) => {
            const on = laneF === k; const m = LANE_META[k];
            return (
              <button key={k} className="vault-tile" aria-pressed={on} title={m.hint}
                      style={{ borderColor: on ? m.color : undefined, background: on ? m.bg : undefined }}
                      onClick={() => setLaneF(on ? "all" : k)}>
                <span className="vault-num" style={{ color: m.color }}>{laneCounts.by[k].toLocaleString()}</span>
                <span>{m.label}</span>
              </button>
            );
          })}
        </div>
        {verifyNote && <div className="panel-body" style={{ paddingTop: 0, fontSize: 12 }} aria-label="Verifier notice">{verifyNote}</div>}
      </details>

      </>)}

      {/* ---- search and filters, behind their own arrow. Per Jack: "a drop
             down arrow for the below section so i can hide it if i want". ---- */}
      {show("filters") && (<>
      <button className="fold-head" aria-expanded={filtersShown} aria-label="Search and filters"
              onClick={() => setFiltersShown(!filtersShown)}
              style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", background: "none", border: "none", padding: "4px 2px", marginBottom: 4, cursor: "pointer", fontSize: 13, color: "var(--ink)", textAlign: "left" }}>
        <span aria-hidden="true">{filtersShown ? "▾" : "▸"}</span>
        <b>Search &amp; filters</b>
        <span className="muted">{filtersShown ? "" : ` · ${filtered.length.toLocaleString()} of ${leads.length.toLocaleString()} shown${chips.length ? ` · ${chips.length} filter${chips.length === 1 ? "" : "s"} on` : ""}`}</span>
      </button>
      {filtersShown && (<>
      {/* ---- toolbar. Per Jack: "dont have duplicates of filter options make
             this more straight forward". Every filter lives in exactly one
             place: the four most-used in the open, the rest grouped under
             More filters, Apollo standing on its tiles above. ---- */}
      <div className="toolbar">
        <div className="toolbar-row">
          <input className="field" placeholder="Search company, contact, email, notes, industry, file…"
                 value={search} onChange={(e) => setSearch(e.target.value)}
                 style={{ flex: 1, minWidth: 220, maxWidth: 380 }} />
          <input className="field" aria-label="Keywords in notes" placeholder='Keywords in notes: renewal "no partner" -gmail'
                 title={'Searches the scan note and the original CSV note text.\nword = must appear · "two words" = exact phrase · -word = must not appear · a OR b = either'}
                 value={noteSearch} onChange={(e) => setNoteSearch(e.target.value)}
                 style={{ flex: 1, minWidth: 220, maxWidth: 340 }} />
          {!nq.empty && rawIndexState === "loading" && <span className="muted" style={{ fontSize: 12 }}>Reading original notes…</span>}
          {!nq.empty && rawIndexState === "error" && <span style={{ fontSize: 12, color: "#B5443B" }}>Original notes could not be read; searching scan notes only.</span>}
          <select className="field" aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => <option key={k} value={k}>Sort: {SORT_LABEL[k]}</option>)}
          </select>
          <div className="toolbar-spacer" />
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            <b>{filtered.length.toLocaleString()}</b> of {leads.length.toLocaleString()}
          </span>
          {(() => {
            const clean = notInApollo(filtered).length;
            const left = filtered.length - clean;
            return (
              <button className="btn btn-sm btn-primary" disabled={!clean || exporting}
                      onClick={() => exportSet(filtered, filterLabel)}
                      title={`Download the leads matching these filters as an Apollo import CSV. Anyone already in Apollo is left out${left ? ` (${left.toLocaleString()} here)` : ""}. A file only — nothing is pushed to Apollo.`}>
                {exporting ? "Preparing…" : `⬇ Export ${clean.toLocaleString()} for Apollo${left ? ` · ${left.toLocaleString()} already in Apollo left out` : ""}`}
              </button>
            );
          })()}
        </div>
        <div className="toolbar-row">
          <select className="field" aria-label="Stored as" value={verdictF} onChange={(e) => setVerdictF(e.target.value as Verdict | "all")}
                  title="Strong Signal, Needs Review or Bad Lead — the verdict from the scanner that stored it.">
            <option value="all">Stored as: any</option>
            {VERDICT_ORDER.map((v) => <option key={v} value={v}>{VERDICT_META[v].label} ({verdictCounts[v].toLocaleString()})</option>)}
          </select>
          <select className="field" aria-label="Outreach" value={contactF}
                  onChange={(e) => setContactF(e.target.value as ContactState | "all" | "untouched")}
                  title="Has anyone got through? From Apollo's calls and emails.">
            <option value="all">Outreach: any</option>
            <option value="untouched">Never touched ({(contactCounts.never + contactCounts.unknown).toLocaleString()})</option>
            {CONTACT_ORDER.map((x) => <option key={x} value={x}>{CONTACT_META[x].label} ({contactCounts[x].toLocaleString()})</option>)}
          </select>
          <select className="field" aria-label="Scanner" value={sourceF}
                  onChange={(e) => setSourceF(e.target.value as LeadSource | "all")}>
            <option value="all">Scanner: any ({(sourceCounts.main + sourceCounts.smc + sourceCounts.csp).toLocaleString()})</option>
            {(["main", "smc", "csp"] as LeadSource[]).map((s) => <option key={s} value={s}>{LEAD_SOURCE_META[s].label} ({sourceCounts[s].toLocaleString()})</option>)}
          </select>
          <button className={`filter-btn${partnerF ? " on" : ""}`} aria-pressed={partnerF} onClick={() => setPartnerF((v) => !v)}
                  title="Leads whose notes say they want to work with a partner, MSP or CSP. Same rule as the ⚑ partner tag; never a lead that wants to buy direct. Reads the original CSV note too.">
            ⚑ Wants a partner{partnerF && partnerKeys && rawIndexState !== "loading" ? ` (${partnerKeys.size.toLocaleString()})` : ""}
            {partnerF && rawIndexState === "loading" ? " · reading notes…" : ""}
          </button>
          <button className={`filter-btn${hideActive ? " on" : ""}`} aria-pressed={hideActive} onClick={() => setHideActive((v) => !v)}
                  title="Leave out every lead that is active in an Apollo sequence right now, so a new campaign never doubles up on someone already being worked.">
            Hide active in a sequence
          </button>
          <button className={`filter-btn${visitedOnly ? " on" : ""}`} aria-pressed={visitedOnly} onClick={() => setVisitedOnly((v) => !v)}
                  title={`Leads whose company visited ${TRACKED_DOMAIN}, from Apollo's website-visitor report. Run "Check … for site visits" first.`}>
            🌐 Visited {TRACKED_DOMAIN} ({leads.filter((l) => l.webVisits?.visited).length.toLocaleString()})
          </button>
          <select className="field" aria-label="Uploaded file" value={fileNameF} onChange={(e) => setFileNameF(e.target.value)}
                  title="Every CSV you have uploaded, filed under the month it is dated, newest first." style={{ maxWidth: 260 }}>
            <option value="all">Uploaded file: any ({fileOptions.length.toLocaleString()})</option>
            {fileMonths.map(([mk, files]) => (
              <optgroup key={mk} label={mk ? monthLabel(mk) : "Undated"}>
                {files.map(([f, n, d]) => <option key={f} value={f}>{f}{d ? ` · ${isPreMaySheet(f) ? "~" : ""}${d.slice(5).replace("-", "/")}` : ""} ({n.toLocaleString()})</option>)}
              </optgroup>
            ))}
          </select>
          <div className="filter-wrap" style={{ position: "relative" }}>
            <button className="filter-btn btn btn-sm btn-secondary" aria-label="More filters" onClick={() => setFiltersOpen((v) => !v)} aria-expanded={filtersOpen}>
              More filters{moreCount > 0 && <span className="filter-count"> {moreCount}</span>}
            </button>
          </div>
        </div>
      </div>

      {/* ---- More filters: each filter once, grouped by what it asks ---- */}
      {filtersOpen && facets && (
        <div className="panel" style={{ marginBottom: 10 }}>
          <div className="panel-body" style={{
            display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 12, fontSize: 12.5,
          }}>
            <div className="filter-group-title" style={{ gridColumn: "1 / -1", fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--muted)", marginTop: 4 }}>The lead</div>
            <label>
              <div className="section-label">Product line</div>
              <select className="field" style={{ width: "100%" }} aria-label="Product line" value={lineF} onChange={(e) => setLineF(e.target.value)}>
                <option value="all">Any</option>{opts(facets.line)}
              </select>
            </label>
            <label>
              <div className="section-label">Scanner's own tier</div>
              <select className="field" style={{ width: "100%" }} aria-label="Tier" value={tierF} onChange={(e) => setTierF(e.target.value)}
                      title="The scanner's exact word — High / Medium / Low priority, Strong Signal, Needs Review. Stored as (above) groups these into three.">
                <option value="all">Any</option>
                <option value={TOP}>Top tier (all scanners)</option>
                {tiers.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label>
              <div className="section-label">Position</div>
              <select className="field" style={{ width: "100%" }} aria-label="Position" value={levelF}
                      onChange={(e) => setLevelF(e.target.value as TitleLevel | "all")}
                      title="Seniority read from the contact's job title.">
                <option value="all">Any</option>
                {LEVEL_ORDER.map((x) => <option key={x} value={x}>{LEVEL_META[x].label} ({levelCounts[x].toLocaleString()})</option>)}
              </select>
            </label>
            <label>
              <div className="section-label">Function</div>
              <select className="field" aria-label="Function" style={{ width: "100%" }} value={fnF}
                      onChange={(e) => setFnF(e.target.value as TitleFunction | "all")}>
                <option value="all">Any</option>
                {(Object.keys(FUNCTION_META) as TitleFunction[]).map((k) => (
                  <option key={k} value={k}>{FUNCTION_META[k].label} ({(facets.fn.get(k) || 0).toLocaleString()})</option>
                ))}
              </select>
            </label>
            <div className="filter-group-title" style={{ gridColumn: "1 / -1", fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--muted)", marginTop: 4 }}>The company</div>
            <label>
              <div className="section-label">Industry (from Apollo)</div>
              <select className="field" style={{ width: "100%" }} aria-label="Industry" value={industryF} onChange={(e) => setIndustryF(e.target.value)}>
                <option value="all">Any</option>{opts(facets.industry)}
              </select>
            </label>
            <label>
              <div className="section-label">Exclude industry</div>
              <select className="field" style={{ width: "100%" }} aria-label="Exclude industry" value=""
                      onChange={(e) => { const v = e.target.value; if (v) setExclIndustries((x) => x.includes(v) ? x : [...x, v]); }}>
                <option value="">{exclIndustries.length ? `${exclIndustries.length} excluded — add another` : "None excluded"}</option>
                {opts(facets.industry)}
              </select>
            </label>
            <label>
              <div className="section-label">Employees</div>
              <select className="field" style={{ width: "100%" }} aria-label="Employees" value={sizeF} onChange={(e) => setSizeF(e.target.value)}>
                <option value="all">Any</option>
                {SIZE_BUCKETS.map((b) => (
                  <option key={b.key} value={b.key}>{b.label} ({(facets.size.get(b.key) || 0).toLocaleString()})</option>
                ))}
                <option value="unknown">Unknown — not enriched ({(facets.size.get("unknown") || 0).toLocaleString()})</option>
              </select>
            </label>
            <label>
              <div className="section-label">Leads at the company</div>
              <select className="field" style={{ width: "100%" }} aria-label="At company" value={companyF}
                      onChange={(e) => setCompanyF(e.target.value as "all" | "multi" | "single")}>
                <option value="all">Any</option>
                <option value="multi">2+ leads at the company</option>
                <option value="single">Only lead at the company</option>
              </select>
            </label>
            <div className="filter-group-title" style={{ gridColumn: "1 / -1", fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--muted)", marginTop: 4 }}>Apollo</div>
            <label>
              <div className="section-label">Sequence they're in</div>
              <select className="field" style={{ width: "100%" }} aria-label="Apollo sequence" value={seqF} onChange={(e) => setSeqF(e.target.value)}>
                <option value="all">Any</option>{opts(facets.seq)}
              </select>
            </label>
            <label>
              <div className="section-label">Sequence owner</div>
              <select className="field" style={{ width: "100%" }} aria-label="Sequence owner" value={ownerF} onChange={(e) => setOwnerF(e.target.value)}
                      title="The name on the sequence (Carly Main Sequence, Jack Main Sequence), else the Apollo contact owner.">
                <option value="all">Anyone</option>
                {[...new Set([...SEQUENCE_OWNERS, ...[...ownerCounts.keys()].filter((k) => k !== "none")])].map((o) => (
                  <option key={o} value={o}>{o}'s ({(ownerCounts.get(o) || 0).toLocaleString()})</option>
                ))}
                <option value="none">No sequence owner ({(ownerCounts.get("none") || 0).toLocaleString()})</option>
              </select>
            </label>
            <label>
              <div className="section-label">In your Apollo uploads</div>
              <select className="field" style={{ width: "100%" }} aria-label="In Apollo" value={inApolloF}
                      onChange={(e) => setInApolloF(e.target.value as InApolloFilter)}
                      title="Matched among the uploads pulled from Apollo or an imported sync — the leads a download leaves out. Where each lead stands after a live check is on the Apollo standing tiles.">
                <option value="all">Any</option>
                <option value="not">Not in Apollo — safe to upload ({inApolloCounts.not.toLocaleString()})</option>
                <option value="in">Already in Apollo ({inApolloCounts.in.toLocaleString()})</option>
              </select>
            </label>
            <div className="filter-group-title" style={{ gridColumn: "1 / -1", fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--muted)", marginTop: 4 }}>Dates and files</div>
            <label>
              <div className="section-label">CSV month</div>
              <select className="field" style={{ width: "100%" }} aria-label="CSV month" value={monthF} onChange={(e) => setMonthF(e.target.value)}
                      title="The month the CSV is dated. Goes back as far as your files do.">
                <option value="all">Any</option>
                {csvMonths.map(([k, n]) => (
                  <option key={k} value={k}>{monthLabel(k)} ({n.toLocaleString()})</option>
                ))}
              </select>
            </label>
            <label>
              <div className="section-label">CSV date range</div>
              <span style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <input type="date" className="field" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="CSV date from" style={{ flex: 1, minWidth: 0 }} />
                <span className="muted">→</span>
                <input type="date" className="field" value={to} onChange={(e) => setTo(e.target.value)} aria-label="CSV date to" style={{ flex: 1, minWidth: 0 }} />
              </span>
            </label>
            <label>
              <div className="section-label">Dates in the notes</div>
              <select className="field" aria-label="Dates in notes" style={{ width: "100%" }} value={dateF}
                      onChange={(e) => setDateF(e.target.value as Derived["dateKind"] | "all")}>
                <option value="all">Any</option>
                {(Object.keys(DATE_LABEL) as Derived["dateKind"][]).map((k) => (
                  <option key={k} value={k}>{DATE_LABEL[k]} ({(facets.dates.get(k) || 0).toLocaleString()})</option>
                ))}
              </select>
            </label>
            <label>
              <div className="section-label">How many files</div>
              <select className="field" style={{ width: "100%" }} aria-label="File count" value={filesF} onChange={(e) => setFilesF(e.target.value as FilesFilter)}>
                <option value="all">Any</option>
                {(Object.keys(FILES_LABEL) as (keyof typeof FILES_LABEL)[]).map((k) => (
                  <option key={k} value={k}>{FILES_LABEL[k]} ({(facets.files.get(k) || 0).toLocaleString()})</option>
                ))}
              </select>
            </label>
            {onSetPlan && (<>
            <div className="filter-group-title" style={{ gridColumn: "1 / -1", fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--muted)", marginTop: 4 }}>Queue</div>
            <label>
              <div className="section-label">Queue status</div>
              <select className="field" style={{ width: "100%" }} aria-label="Queue status" value={planF} onChange={(e) => setPlanF(e.target.value as PlanFilter)}>
                <option value="all">Any</option>
                {(Object.keys(PLAN_LABEL) as (keyof typeof PLAN_LABEL)[]).map((k) => (
                  <option key={k} value={k}>{PLAN_LABEL[k]} ({(facets.plan.get(k) || 0).toLocaleString()})</option>
                ))}
              </select>
            </label>
            <label>
              <div className="section-label">Headed for (target sequence)</div>
              <select className="field" style={{ width: "100%" }} aria-label="Headed for" value={planSeqF} onChange={(e) => setPlanSeqF(e.target.value)}>
                <option value="all">Any</option>{opts(facets.planSeq)}
              </select>
            </label>
            </>)}
          </div>
        </div>
      )}

      </>)}
      </>)}

      {chips.length > 0 && (
        <div className="chip-row" style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8, alignItems: "center" }}>
          {chips.map((c) => (
            <button key={c.label} className="chip" onClick={c.clear} title="Remove this filter">{c.label} ✕</button>
          ))}
          <button className="btn btn-sm btn-ghost" onClick={clearAll}>Clear all</button>
        </div>
      )}

      {show("bulk") && (<>
      {/* ---- bulk bar: acts on the selection, or on everything matched ---- */}
      <div className="bulkbar" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8, fontSize: 12.5 }}>
        <span>
          {selected.size > 0
            ? <><b>{selected.size.toLocaleString()}</b> selected</>
            : <span style={{ color: "var(--muted)" }}>Select leads, or act on all {filtered.length.toLocaleString()} matched</span>}
        </span>
        {filtered.length > 0 && selected.size < filtered.length && (
          <button className="btn btn-sm btn-ghost" onClick={() => setSelected(new Set(filtered.map((l) => l.key)))}>
            Select all {filtered.length.toLocaleString()} matched
          </button>
        )}
        {selected.size > 0 && <button className="btn btn-sm btn-ghost" onClick={() => setSelected(new Set())}>Clear selection</button>}
        {onSetPlan && (
          <>
            <span className="bulkbar-divider" style={{ width: 1, height: 18, background: "var(--border)" }} />
            <input className="field" list="all-leads-seqs" style={{ width: 210 }} placeholder="Queue into sequence…"
                   value={bulkSeq} onChange={(e) => setBulkSeq(e.target.value)} aria-label="Queue into sequence" />
            <datalist id="all-leads-seqs">{sequenceNames.map((n) => <option key={n} value={n} />)}</datalist>
            <button className="btn btn-sm btn-secondary" disabled={!selected.size || !bulkSeq.trim()}
                    onClick={() => { onSetPlan([...selected], bulkSeq.trim()); setBulkSeq(""); setSelected(new Set()); }}>
              Queue {selected.size ? selected.size.toLocaleString() : ""}
            </button>
            <button className="btn btn-sm btn-ghost" disabled={!selected.size}
                    onClick={() => {
                      if (window.confirm(`Remove ${selected.size} lead(s) from the Apollo queue? They stay stored.`)) {
                        onSetPlan([...selected], null); setSelected(new Set());
                      }
                    }}>
              Remove from queue
            </button>
          </>
        )}
        {onSetStatus && (
          <>
            <span style={{ width: 1, height: 18, background: "var(--border)" }} />
            <select className="field" aria-label="Set status" style={{ width: 170 }} value={bulkStatus}
                    onChange={(e) => setBulkStatus(e.target.value)}>
              <option value="">Set status…</option>
              {STATUS_ORDER.map((x) => <option key={x} value={x}>{STATUS_META[x].label}</option>)}
              <option value="__auto">Back to automatic</option>
            </select>
            <button className="btn btn-sm btn-secondary" disabled={!selected.size || !bulkStatus}
                    onClick={() => {
                      onSetStatus([...selected], bulkStatus === "__auto" ? null : (bulkStatus as LeadStatus));
                      setBulkStatus(""); setSelected(new Set());
                    }}>
              Apply{selected.size ? ` to ${selected.size.toLocaleString()}` : ""}
            </button>
          </>
        )}
        {onCheckVisits && (
          <>
            <span style={{ width: 1, height: 18, background: "var(--border)" }} />
            {visits && !visits.finished
              ? <button className="btn btn-sm btn-secondary" onClick={() => visitAbort.current?.abort()}>Stop · {visits.done}/{visits.total}</button>
              : <button className="btn btn-sm btn-secondary" disabled={!visitOrgs.length} onClick={() => void runVisits()}
                        title={`Asks Apollo whether each company behind these leads visited ${TRACKED_DOMAIN} since July 2025, and tags every lead there. Read-only, no credits. Needs the leads to have been checked in Apollo first (that is where the company id comes from).`}>
                  🌐 Check {visitOrgs.length.toLocaleString()} compan{visitOrgs.length === 1 ? "y" : "ies"} for site visits
                </button>}
            {visits?.finished && <span className="muted" style={{ fontSize: 12 }}>{visits.visited} visited {TRACKED_DOMAIN}, {visits.done - visits.visited} did not{visits.errors ? `, ${visits.errors} failed` : ""}.</span>}
            {visitErr && <span style={{ fontSize: 12, color: "#B5443B" }}>{visitErr}</span>}
          </>
        )}
        {onEnrichCompanies && (
          <>
            <span style={{ width: 1, height: 18, background: "var(--border)" }} />
            <button className="btn btn-sm btn-secondary" disabled={enriching || !enrichTargets.length} onClick={() => void runEnrich()}
                    title="Look up industry and employee count in Apollo for the companies behind these leads that have no company profile yet. Costs Apollo credits (1 per company found); you confirm the count first.">
              {enriching ? "Enriching…" : `🏢 Enrich ${Math.min(enrichTargets.length, MAX_COMPANY_BATCH).toLocaleString()} compan${enrichTargets.length === 1 ? "y" : "ies"}${selected.size ? " (selected)" : ""}`}
            </button>
            {enrichNote && <span className="muted" style={{ fontSize: 12 }}>{enrichNote}</span>}
          </>
        )}
        {onCheckLeads && (
          <>
            <span style={{ width: 1, height: 18, background: "var(--border)" }} />
            {checking
              ? <button className="btn btn-sm btn-secondary" onClick={() => checkAbort.current?.abort()}>Stop Apollo check</button>
              : <button className="btn btn-sm btn-primary" disabled={!checkTargets.length} onClick={() => runCheck()}
                        title={"Looks each lead up in Apollo: whether they're a contact, which sequence, which step, finished and why.\nAlso reads every call and sequence email Apollo logged to them, so Touchpoints fills in. Read-only searches: nothing is written to Apollo."}>
                  ⟳ Check {checkTargets.length.toLocaleString()} in Apollo{selected.size ? " (selected)" : checkDue.length > checkTargets.length ? ` of ${checkDue.length.toLocaleString()} due` : ""}
                </button>}
            {!selected.size && (
              <select className="field" aria-label="Apollo batch" value={batchN} disabled={checking} onChange={(e) => setBatchN(Number(e.target.value))}>
                {[100, 200, 400].map((n) => <option key={n} value={n}>Batch of {n}{n === 400 ? " (hourly max)" : ""}</option>)}
                <option value={0}>All due</option>
              </select>
            )}
            <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12 }} title="Leads checked in the last 7 days are skipped unless this is ticked">
              <input type="checkbox" checked={recheck} disabled={checking} onChange={(e) => setRecheck(e.target.checked)} />
              Re-check this week's
            </label>
          </>
        )}
        {onAddToList && (
          <>
            <span style={{ width: 1, height: 18, background: "var(--border)" }} />
            <select className="field" aria-label="Add to list" value={listTarget} onChange={(e) => setListTarget(e.target.value)} style={{ maxWidth: 190 }}>
              <option value="">＋ New list…</option>
              {lists.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.rows.length.toLocaleString()})</option>)}
            </select>
            {!listTarget && <input className="field" placeholder="List name" aria-label="New list name" value={newListName}
                                   onChange={(e) => setNewListName(e.target.value)} style={{ width: 150 }} />}
            <button className="btn btn-sm btn-secondary" disabled={(!listTarget && !newListName.trim()) || !(selected.size || filtered.length)}
                    onClick={() => {
                      const picked = selected.size ? selectedLeads : filtered;
                      const res = onAddToList(picked.map((l) => ({ row: listRowForLead(l, apolloIndex), scanner: l.source })),
                        listTarget ? { existingId: listTarget } : { newName: newListName.trim() });
                      if (!res) { setListNotice("Couldn't add to that list."); return; }
                      const name = lists.find((x) => x.id === res.listId)?.name ?? newListName.trim();
                      setListNotice(`Added ${res.added.toLocaleString()} to "${name}"${res.skipped ? ` (${res.skipped.toLocaleString()} already there)` : ""}. Download or edit it in Lists.`);
                      setListTarget(res.listId); setNewListName(""); setSelected(new Set());
                    }}>
              Add {(selected.size || filtered.length).toLocaleString()} to list
            </button>
            {listNotice && <span style={{ color: "var(--success, #1F7A4D)" }} aria-label="List notice">{listNotice}</span>}
          </>
        )}
        <button className="btn btn-sm btn-ghost" disabled={!selected.size || exporting}
                onClick={() => exportSet(selectedLeads, "selection")}
                title="Anyone already in Apollo is left out">
          ⬇ Export selection{selected.size ? ` (${notInApollo(selectedLeads).length.toLocaleString()} not in Apollo)` : ""}
        </button>
      </div>

      </>)}

      {(check || checkError) && (
        <div className="panel" style={{ marginBottom: 8 }}>
          <div className="panel-body" style={{ fontSize: 12 }} aria-label="Apollo check">
            {check && <>
              {check.finished ? "Apollo check done:" : "Checking Apollo…"} <b>{check.done.toLocaleString()}</b> of {check.total.toLocaleString()}
              {" · "}<b>{check.found.toLocaleString()}</b> in Apollo · {check.notFound.toLocaleString()} not in Apollo
              {check.skipped > 0 && <> · {check.skipped.toLocaleString()} skipped (no email or full name)</>}
              {check.errors > 0 && <span style={{ color: "#B5443B" }}> · {check.errors} failed{check.lastError ? `: ${check.lastError}` : ""}</span>}
                <RateLimitNote progress={check} />
              {!check.finished && check.total > 200 && <span className="muted"> · about {Math.max(1, Math.round((check.total - check.done) / 240))} min left; Stop keeps everything already read</span>}
            </>}
            {checkError && <span style={{ color: "#B5443B" }}> Apollo check stopped: {checkError}</span>}
          </div>
        </div>
      )}

      {/* Per Jack: "in all leads need to be able filter by needs review strong
          signal or bad lead" — always in view, the same filter as "Stored as". */}
      <div className="seg" role="group" aria-label="Verdict" style={{ margin: "0 0 8px" }}>
        <button className={`seg-btn${verdictF === "all" ? " active" : ""}`} onClick={() => setVerdictF("all")}>
          All ({(verdictCounts.strong + verdictCounts.review + verdictCounts.bad).toLocaleString()})
        </button>
        {VERDICT_ORDER.map((v) => (
          <button key={v} className={`seg-btn${verdictF === v ? " active" : ""}`} title={VERDICT_META[v].hint}
                  onClick={() => setVerdictF(v)}>
            {VERDICT_META[v].label} ({verdictCounts[v].toLocaleString()})
          </button>
        ))}
      </div>

      {/* ---- the table: one page at a time, scrolling inside its own box
             so the toolbar and filters stay in view ---- */}
      <div className="table-card" style={{ maxHeight: "calc(100vh - 250px)", minHeight: 260, overflow: "auto" }}>
        {hiddenCols.length > 0 && <style>{hiddenCols.map((c) => `.all-leads-table [data-col="${c}"]`).join(",") + "{display:none}"}</style>}
        <table className="data-table dense-table all-leads-table">
          <thead>
            <tr>
              <th className="pin pin-0" style={{ width: 30 }}>
                <input type="checkbox" checked={allShownSelected} onChange={selectPage} aria-label="Select this page" />
              </th>
              <th className="pin pin-1">Company</th>
              <th data-col="contact">Contact</th>
              <th data-col="stored" title="Strong Signal, Needs Review or Bad Lead — from the scanner that stored it">Stored as</th>
              <th data-col="line">Product line</th>
              <th data-col="received" title="The date the file states, or the upload date if it states none">Received</th>
              <th data-col="uploads" className="num" title="How many different CSV files this lead was in">Uploads</th>
              <th data-col="atco" title="Every lead we hold at this company">At company</th>
              <th data-col="meetings" title="A deal or sales meeting on file in HubSpot, Notion or Echo. These are Account manager only: not to be reached out to again.">Meetings</th>
              <th data-col="inapollo" title="Already a contact in Apollo — from your pulled uploads or a sync">In Apollo</th>
              <th data-col="touches" className="num" title="Calls and emails Apollo has logged to this lead">Touchpoints</th>
              <th data-col="recycle" title="When an unanswered or not-interested lead comes back for a new sequence — see the Recycle tab">Recycle</th>
              <th data-col="outreach" title="Has anyone got through? From the Apollo sync.">Outreach</th>
              <th data-col="disposition" title="The latest call disposition in Apollo">Disposition</th>
              <th data-col="sequence" title="The Apollo sequence this lead is in, from the last sync">Sequence</th>
              <th data-col="notes" title="The note the scanner wrote">Scanned note</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((l) => {
              const d = derived.get(l.key)!;
              const a = l.apollo;
              const co = companyStats.get(d.companyKey);
              const cm = CONTACT_META[d.contact];
              const rc = recycleOf(l, recycleRules);
              const seq = a?.sequences[0];
              const total = seq ? stepsInSequence(funnels, seq.name) : null;
              return (
                <tr key={l.key} className={selected.has(l.key) ? "is-selected" : undefined} onClick={() => setOpenKey(l.key)}>
                  <td className="pin pin-0" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(l.key)} onChange={() => toggle(l.key)} aria-label={`Select ${l.company}`} />
                  </td>
                  <td className="pin pin-1 strong" title={l.company}>{l.company || "—"}</td>
                  <td data-col="contact" title={[l.contact, l.title, l.email, LANE_META[d.lane].hint].filter(Boolean).join(" · ")}>
                    {l.contact || "—"}
                    {(l.contact || l.company) && (
                      <button className="btn btn-sm btn-ghost" style={{ padding: "0 4px", marginLeft: 4, fontSize: 11 }}
                              aria-label={`Copy ${l.contact || l.company}`}
                              title="Copy name and company"
                              onClick={async (e) => {
                                e.stopPropagation();
                                if (await copyText([l.contact, l.company].filter(Boolean).join(" — "))) {
                                  setCopiedKey(l.key); setTimeout(() => setCopiedKey((k) => (k === l.key ? "" : k)), 1200);
                                }
                              }}>{copiedKey === l.key ? "✓" : "⧉"}</button>
                    )}
                    {d.lane !== "no-email" && <span className="pill" data-lane={d.lane} style={{ marginLeft: 6, fontSize: 10.5, color: LANE_META[d.lane].color, background: LANE_META[d.lane].bg }}>{LANE_META[d.lane].short}</span>}
                    {l.webVisits?.visited && (
                      <span className="pill" aria-label="Visited wiredcio.com" style={{ marginLeft: 6, fontSize: 10.5, color: "#0A66C2", background: "#EAF3FC" }}
                            title={`Their company visited ${l.webVisits.domain} (${l.webVisits.from} to ${l.webVisits.to})${l.webVisits.visits != null ? ` · ${l.webVisits.visits} visits` : ""}${l.webVisits.uniqueVisitors != null ? ` · ${l.webVisits.uniqueVisitors} people` : ""}${l.webVisits.pages?.length ? `\nPages: ${l.webVisits.pages.join(", ")}` : ""}`}>
                        🌐 Visited us
                      </span>
                    )}
                  </td>
                  <td data-col="stored" title={`${VERDICT_META[d.verdict].hint}\nScanner's word: ${l.tier || "—"}`}>
                    <span className="pill" style={{ color: VERDICT_META[d.verdict].color, background: VERDICT_META[d.verdict].bg }}>{VERDICT_META[d.verdict].label}</span>
                  </td>
                  <td data-col="line">{d.line === NO_LINE ? <span className="muted">—</span> : d.line}</td>
                  <td data-col="received">{monthLabelOf(d.month)}</td>
                  <td data-col="uploads" className="num" title={l.sourceFiles.join("\n")}>
                    {d.files}{d.files > 1 && d.segs > 1 && <span className="muted" title="The notes differ between these uploads"> · changed</span>}
                  </td>
                  <td data-col="atco" title={co ? co.names.join("\n") : undefined}>
                    {!co || co.contacts < 2 ? <span className="muted">1</span>
                      : <>{co.contacts}<span className="muted"> · {co.worked} worked</span></>}
                  </td>
                  <td data-col="meetings" title={d.engaged ? d.engaged.items.map((e) => `${ENGAGEMENT_SOURCE_META[e.source].label} ${ENGAGEMENT_SOURCE_META[e.source].kind}: ${[e.company, e.stage, e.at].filter(Boolean).join(" · ")}`).concat(`Matched by ${d.engaged.how}`).join("\n") : "No deal or meeting on file"}>
                    {d.engaged ? (
                      <>
                        <span className="pill" style={{ color: "#7A1F1F", background: "#F6E3E3" }}>{isCustomer(d.engaged) ? "Customer · AM only" : "Account manager only"}</span>
                        <div className="muted" style={{ fontSize: 11 }}>{engagementLabel(d.engaged)}</div>
                        {d.active && <div style={{ fontSize: 11, color: "#B5443B" }}>⚠ still active in a sequence</div>}
                      </>
                    ) : <span className="muted">—</span>}
                  </td>
                  <td data-col="inapollo" title={d.inApollo ? [`Matched by ${d.inApollo.how === "sync" ? "an Apollo sync" : d.inApollo.how}`, d.inApollo.uploadedAt ? `Uploaded to Apollo ${d.inApollo.uploadedAt}` : "", ...d.inApollo.sequences].filter(Boolean).join("\n") : "Not found among your Apollo uploads"}>
                    {d.inApollo
                      ? <span className="pill" style={{ color: "#0A66C2", background: "#EAF3FC" }}>In Apollo{d.inApollo.uploadedAt ? ` · ${d.inApollo.uploadedAt}` : ""}</span>
                      : l.apolloCheckedAt
                        ? <span className="muted" title={`Searched Apollo ${l.apolloCheckedAt.slice(0, 10)} — no matching contact`}>Not found · {l.apolloCheckedAt.slice(5, 10)}</span>
                        : <span className="muted">No</span>}
                  </td>
                  <td data-col="touches" className="num" title={a ? (a.callsUnknown ? "Calls not read yet — run an Apollo check" : outcomeSummary(a) || "No calls logged") : "Not matched in Apollo"}>
                    {!a ? <span className="muted">—</span> : <>
                      {a.callsUnknown ? <span className="muted">?</span> : a.callCount} call{a.callCount === 1 && !a.callsUnknown ? "" : "s"}
                      <span className="muted"> · {a.emailCount ?? "?"} email{a.emailCount === 1 ? "" : "s"}</span>
                      {a.emailStats && (a.emailStats.opened > 0 || a.emailStats.replied > 0) && (
                        <div className="muted" style={{ fontSize: 11 }}>{a.emailStats.opened} opened · {a.emailStats.replied} replied</div>
                      )}
                    </>}
                  </td>
                  <td data-col="recycle" title={RECYCLE_META[rc.stage].hint}>
                    {RECYCLE_FLOW.includes(rc.stage)
                      ? <><span className="pill" style={{ color: RECYCLE_META[rc.stage].color, background: RECYCLE_META[rc.stage].bg }}>{RECYCLE_META[rc.stage].label}</span>
                          {rc.recycleOn && rc.stage === "resting" && <div className="muted" style={{ fontSize: 11 }}>{recycleLabel(rc)}</div>}</>
                      : <span className="muted" style={{ fontSize: 12 }}>{rc.stage === "building" ? rc.reason : "—"}</span>}
                  </td>
                  <td data-col="outreach" title={`${cm.hint}${a ? `\n${a.callCount} call${a.callCount === 1 ? "" : "s"}${a.emailCount !== undefined ? ` · ${a.emailCount} email${a.emailCount === 1 ? "" : "s"}` : ""}` : ""}`}>
                    <span className="pill" style={{ color: cm.color, background: cm.bg }}>{cm.label}</span>
                  </td>
                  <td data-col="disposition" title={a ? outcomeSummary(a) : undefined}>
                    {!a || !a.lastOutcome ? <span className="muted">—</span>
                      : <>{a.lastOutcome}{a.lastCallAt && <span className="muted"> · {a.lastCallAt.slice(0, 10)}</span>}</>}
                  </td>
                  <td data-col="sequence" className="wide" title={a?.sequences.map((s) => `${s.name} · ${s.status}${s.step != null ? ` · step ${s.step}` : ""}${s.addedAt ? ` · added ${s.addedAt}` : ""}`).join("\n")}>
                    {!a ? (d.inApollo?.sequences.length
                        ? <>{d.inApollo.sequences[0]}{d.inApollo.sequences.length > 1 && <span className="muted"> +{d.inApollo.sequences.length - 1}</span>}</>
                        : d.inApollo ? <span className="muted">none</span> : <span className="muted">—</span>)
                      : !seq ? <span className="muted">none</span>
                      : <>
                          {seq.name}
                          <span className={seq.status === "active" ? "accent" : "muted"}>
                            {" · "}{seq.status}{seq.step != null ? ` · step ${seq.step}${total ? `/${total}` : ""}` : ""}
                          </span>
                          {a.sequences.length > 1 && <span className="muted"> +{a.sequences.length - 1}</span>}
                        </>}
                  </td>
                  <td data-col="notes" title={l.notes} style={{ maxWidth: 260 }}>
                    {newestNote(l.notes) || "—"}
                    {d.segs > 1 && <span className="muted"> +{d.segs - 1} earlier</span>}
                  </td>
                </tr>
              );
            })}
            {shown.length === 0 && (
              <tr><td colSpan={14} style={{ textAlign: "center", padding: 24, color: "var(--muted)" }}>
                No leads match these filters. <button className="btn btn-sm btn-ghost" onClick={clearAll}>Clear all</button>
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="pager" style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
        <button className="btn btn-sm btn-ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</button>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          {filtered.length === 0 ? "0" : `${((page - 1) * pageSize + 1).toLocaleString()}–${Math.min(page * pageSize, filtered.length).toLocaleString()}`}
          {" "}of {filtered.length.toLocaleString()} · page {page} of {pages}
        </span>
        <button className="btn btn-sm btn-ghost" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</button>
        <div className="toolbar-spacer" />
        <label style={{ fontSize: 12, color: "var(--muted)" }}>
          Rows per page{" "}
          <select className="field" value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
            {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </div>

      {companyProfiles.length === 0 && (
        <div style={{ marginTop: 8, fontSize: 12, color: "var(--muted)" }}>
          Industry and employee filters read from enriched company profiles, and none are loaded yet — every lead
          reads "not enriched" until companies are enriched from the Scanner or imported from Apollo. The
          {" "}{MIN_EMPLOYEES}-employee floor only applies to companies with a known headcount.
        </div>
      )}

      {openLead && (() => {
        // Prev/Next walk the list exactly as filtered and sorted on screen.
        const i = filtered.findIndex((l) => l.key === openLead.key);
        const go = (j: number) => {
          const next = filtered[j];
          if (!next) return;
          setOpenKey(next.key);
          // Keep the table's page in step with the record being read.
          setPage(Math.floor(j / pageSize) + 1);
        };
        return (
          <LeadDetail
            lead={openLead}
            apolloIndex={apolloIndex}
            companyProfiles={companyProfiles}
            onClose={() => setOpenKey(null)}
            sequenceNames={sequenceNames}
            onSetPlan={onSetPlan ? (sq) => onSetPlan([openLead.key], sq) : undefined}
            onSetStatus={onSetStatus ? (st) => onSetStatus([openLead.key], st) : undefined}
            onPrev={i > 0 ? () => go(i - 1) : undefined}
            onNext={i >= 0 && i < filtered.length - 1 ? () => go(i + 1) : undefined}
            position={i >= 0 ? `${(i + 1).toLocaleString()} of ${filtered.length.toLocaleString()}` : undefined}
            onCheckApollo={onCheckLeads ? () => runCheck([openLead]) : undefined}
            recycleRules={recycleRules}
            checkingApollo={checking}
            funnels={funnels}
            companyLeads={(() => {
              const ck = derived.get(openLead.key)?.companyKey;
              return ck ? leads.filter((x) => derived.get(x.key)?.companyKey === ck) : [openLead];
            })()}
            onOpenLead={setOpenKey}
          />
        );
      })()}
    </>
  );
}
