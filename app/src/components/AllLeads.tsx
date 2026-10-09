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
import { useEffect, useMemo, useState } from "react";
import {
  LEAD_SOURCE_META, newestNote, noteSegments, outcomeSummary,
  type LeadSource, type StoredLead,
} from "../lib/leadStore";
import { SYNC_STALE_DAYS, syncAgeDays, leadsToSync } from "../lib/apolloSync";
import { parseCSVFile, toCSV, downloadBlob } from "../lib/csv";
import type { ParsedFile } from "../lib/detection";
import { downloadCampaignCSV } from "../lib/campaignExport";
import { MIN_EMPLOYEES } from "../lib/leadQualify";
import {
  SIZE_BUCKETS, employeeCountOf, normalizeCompanyKey, profileForCompany, type CompanyProfile,
} from "../lib/companyProfiles";
import LeadDetail from "./LeadDetail";
import {
  STATUS_META, STATUS_ORDER, statusOf, wasReached,
  VERDICT_META, VERDICT_ORDER, verdictOf, type Verdict,
  CONTACT_META, CONTACT_ORDER, contactStateOf, type ContactState,
  type LeadStatus,
} from "../lib/leadStatus";
import { stepsInSequence, type ApolloFunnel } from "../lib/apolloFunnel";
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

type FilesFilter = "all" | "1" | "2" | "3";
const FILES_LABEL: Record<Exclude<FilesFilter, "all">, string> = {
  "1": "On 1 file",
  "2": "On 2+ files",
  "3": "On 3+ files",
};

type SortKey = "last" | "first" | "company" | "files" | "score" | "calls" | "nextdate" | "added" | "taskdone";
const SORT_LABEL: Record<SortKey, string> = {
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
}

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

const monthLabel = (ym: string) =>
  new Date(`${ym}-15T12:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" });

/** A tier-filter value meaning "the top verdict on any scanner": High
 *  priority (Main, CSP) or Strong Signal (Custom, older Main rows). */
const TOP = "__top";
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

const NO_INDUSTRY = "(not enriched)";
const NO_LINE = "(no product line)";

/* --------------------------------------------------------------- component */

export default function AllLeads({
  leads, companyProfiles = [], onApplySync, initialSequence = "",
  sequenceNames = [], onSetPlan, onSetStatus, funnels = [], initialStatus, initialPreset,
}: {
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
  const [sourceF, setSourceF] = useState<LeadSource | "all">("all");
  const [tierF, setTierF] = useState(initialPreset ? TOP : "all");
  const [lineF, setLineF] = useState("all");
  const [industryF, setIndustryF] = useState("all");
  const [sizeF, setSizeF] = useState("all");
  const [apolloF, setApolloF] = useState<ApolloFilter>(initialPreset ? PRESET[initialPreset].apollo : "all");
  const [seqF, setSeqF] = useState(initialSequence || "all");
  const [planF, setPlanF] = useState<PlanFilter>("all");
  const [planSeqF, setPlanSeqF] = useState("all");
  const [filesF, setFilesF] = useState<FilesFilter>("all");
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
  const [sort, setSort] = useState<SortKey>("last");
  const [pageSize, setPageSize] = useState(100);
  const [page, setPage] = useState(1);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkSeq, setBulkSeq] = useState("");
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [syncReport, setSyncReport] = useState<SyncReport | string | null>(null);
  const [syncing, setSyncing] = useState(false);

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
      m.set(l.key, {
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
        month: (l.receivedOn || l.firstSeenAt).slice(0, 7),
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
      });
    }
    return m;
  }, [leads, companyProfiles]);

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
  const fromT = from ? Date.parse(`${from}T00:00:00`) : null;
  const toT = to ? Date.parse(`${to}T23:59:59.999`) : null;

  type Key = "verdict" | "company" | "contact" | "level" | "fn" | "month" | "dates" | "status" | "search" | "source" | "tier" | "line" | "industry" | "size" | "apollo" | "seq" | "plan" | "planSeq" | "files" | "fileName" | "date";
  const tests = useMemo(() => {
    const t: Record<Key, (l: StoredLead, d: Derived) => boolean> = {
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
      search: (_l, d) => !q || d.hay.includes(q),
      source: (l) => sourceF === "all" || l.source === sourceF,
      tier: (l) => tierF === "all" || (tierF === TOP ? TOP_TIER_SET.has(l.tier) : l.tier === tierF),
      line: (_l, d) => lineF === "all" || d.line === lineF,
      industry: (_l, d) => industryF === "all" || d.industry === industryF,
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
      plan: (l) => planF === "all"
        || (planF === "none" ? !l.plan : l.plan?.status === planF),
      planSeq: (l) => planSeqF === "all" || l.plan?.sequence === planSeqF,
      files: (_l, d) => filesF === "all" || d.files >= Number(filesF) && (filesF !== "1" || d.files === 1),
      fileName: (l) => fileNameF === "all" || l.sourceFiles.includes(fileNameF),
      date: (l) => {
        if (fromT === null && toT === null) return true;
        const t = Date.parse(l.firstSeenAt);
        return (fromT === null || t >= fromT) && (toT === null || t <= toT);
      },
    };
    return t;
  }, [verdictF, companyF, companyStats, contactF, levelF, fnF, monthF, dateF, statusF, q, sourceF, tierF, lineF, industryF, sizeF, apolloF, seqF, planF, planSeqF, filesF, fileNameF, fromT, toT]);

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
      files: facet("files", (_l, d) => [d.files === 1 ? "1" : "", d.files >= 2 ? "2" : "", d.files >= 3 ? "3" : ""].filter(Boolean)),
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

  const tiers = useMemo(() => [...new Set(leads.map((l) => l.tier).filter(Boolean))].sort(), [leads]);
  const ageDays = useMemo(() => syncAgeDays(leads), [leads]);

  useEffect(() => { setPage(1); }, [tests, sort, pageSize]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const shown = filtered.slice((page - 1) * pageSize, page * pageSize);
  const allShownSelected = shown.length > 0 && shown.every((l) => selected.has(l.key));
  const selectedLeads = useMemo(() => leads.filter((l) => selected.has(l.key)), [leads, selected]);

  /* ---- active filter chips ---- */
  const chips: { label: string; clear: () => void }[] = [];
  if (contactF !== "all") chips.push({ label: contactF === "untouched" ? "Never touched (no outreach on record)" : CONTACT_META[contactF].label, clear: () => setContactF("all") });
  if (levelF !== "all") chips.push({ label: `Position: ${LEVEL_META[levelF].label}`, clear: () => setLevelF("all") });
  if (fnF !== "all") chips.push({ label: FUNCTION_META[fnF].label, clear: () => setFnF("all") });
  if (verdictF !== "all") chips.push({ label: VERDICT_META[verdictF].label, clear: () => setVerdictF("all") });
  if (companyF !== "all") chips.push({ label: companyF === "multi" ? "2+ leads at the company" : "Only lead at the company", clear: () => setCompanyF("all") });
  if (monthF !== "all") chips.push({ label: `Received ${monthLabel(monthF)}`, clear: () => setMonthF("all") });
  if (dateF !== "all") chips.push({ label: DATE_LABEL[dateF], clear: () => setDateF("all") });
  if (statusF !== "all") chips.push({ label: `Status: ${STATUS_META[statusF].label}`, clear: () => setStatusF("all") });
  if (sourceF !== "all") chips.push({ label: LEAD_SOURCE_META[sourceF].label, clear: () => setSourceF("all") });
  if (tierF !== "all") chips.push({ label: tierF === TOP ? "Top tier" : tierF, clear: () => setTierF("all") });
  if (lineF !== "all") chips.push({ label: lineF, clear: () => setLineF("all") });
  if (industryF !== "all") chips.push({ label: `Industry: ${industryF}`, clear: () => setIndustryF("all") });
  if (sizeF !== "all") chips.push({ label: `Employees: ${SIZE_BUCKETS.find((b) => b.key === sizeF)?.label ?? "unknown"}`, clear: () => setSizeF("all") });
  if (apolloF !== "all") chips.push({ label: APOLLO_LABEL[apolloF], clear: () => setApolloF("all") });
  if (seqF !== "all") chips.push({ label: `In: ${seqF}`, clear: () => setSeqF("all") });
  if (planF !== "all") chips.push({ label: PLAN_LABEL[planF], clear: () => setPlanF("all") });
  if (planSeqF !== "all") chips.push({ label: `Headed for: ${planSeqF}`, clear: () => setPlanSeqF("all") });
  if (filesF !== "all") chips.push({ label: FILES_LABEL[filesF], clear: () => setFilesF("all") });
  if (fileNameF !== "all") chips.push({ label: `File: ${fileNameF}`, clear: () => setFileNameF("all") });
  if (from || to) chips.push({ label: `First seen ${from || "…"} → ${to || "…"}`, clear: () => { setFrom(""); setTo(""); } });
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

  async function exportSet(set: StoredLead[], label: string) {
    if (!set.length || exporting) return;
    setExporting(true);
    try { await downloadCampaignCSV(set, companyProfiles, label); } finally { setExporting(false); }
  }

  async function exportLookupList() {
    const rows = leadsToSync(leads).map((l) => ({ Email: l.email, Name: l.contact, Company: l.company }));
    await downloadBlob(toCSV(rows, ["Email", "Name", "Company"] as const),
      `apollo-lookup-${rows.length}-${new Date().toISOString().slice(0, 10)}.csv`);
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
      </div>

      {/* Apollo state is only as fresh as the last sync, so its age is
          stated here, every time. */}
      <div className="panel" style={{ marginBottom: 10 }}>
        <div className="panel-body" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 12.5 }}>
          <b>Apollo</b>
          {ageDays === null ? (
            <span style={{ color: "var(--muted)" }}>
              Not synced — sequence and call columns are blank until a sync is imported, so nothing here
              reads as "in Apollo" yet.
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
        </div>
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
      </div>

      {/* ---- the vault at a glance: the three buckets, then who has been
             reached. Click to filter, click again to clear. ---- */}
      <div className="panel" style={{ marginBottom: 10 }}>
        <div className="panel-body" style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-start" }}>
          <div>
            <div className="section-label" style={{ marginBottom: 4 }}>Stored as</div>
            <div style={{ display: "flex", gap: 6 }}>
              {VERDICT_ORDER.map((v) => {
                const on = verdictF === v; const m = VERDICT_META[v];
                return (
                  <button key={v} onClick={() => setVerdictF(on ? "all" : v)} title={m.hint} aria-pressed={on}
                    className="vault-tile" style={{ borderColor: on ? m.color : undefined, background: on ? m.bg : undefined }}>
                    <span className="vault-num" style={{ color: m.color }}>{verdictCounts[v].toLocaleString()}</span>
                    <span>{m.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <div className="section-label" style={{ marginBottom: 4 }} title="From the Apollo sync only. A lead no sync has matched counts as never touched.">Outreach (from Apollo)</div>
            <div style={{ display: "flex", gap: 6 }}>
              {([
                ["untouched", "Never touched", contactCounts.never + contactCounts.unknown, "No call or email on record — in Apollo untouched, or not in Apollo at all."],
                ["attempted", "Attempted, not reached", contactCounts.attempted, "Called or emailed; every call was no answer, voicemail or gatekeeper."],
                ["made", "Contact made", contactCounts.made + contactCounts.meeting + contactCounts.no, "A real conversation is on record, whatever the outcome."],
              ] as const).map(([k, label, n, hint]) => {
                const on = contactF === k;
                return (
                  <button key={k} onClick={() => setContactF(on ? "all" : k)} title={hint} aria-pressed={on}
                    className="vault-tile" style={{ borderColor: on ? "var(--accent)" : undefined }}>
                    <span className="vault-num">{n.toLocaleString()}</span>
                    <span>{label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ---- toolbar: the basics in the open, everything else behind Filters ---- */}
      <div className="toolbar">
        <div className="toolbar-row">
          <input className="field" placeholder="Search company, contact, email, notes, industry, file…"
                 value={search} onChange={(e) => setSearch(e.target.value)}
                 style={{ flex: 1, minWidth: 220, maxWidth: 380 }} />
          <select className="field" aria-label="Scanner" value={sourceF}
                  onChange={(e) => setSourceF(e.target.value as LeadSource | "all")}>
            <option value="all">Scanner: any</option>
            {(["main", "smc", "csp"] as LeadSource[]).map((s) => <option key={s} value={s}>{LEAD_SOURCE_META[s].label}</option>)}
          </select>
          <select className="field" aria-label="Tier" value={tierF} onChange={(e) => setTierF(e.target.value)}>
            <option value="all">Tier: any</option>
            <option value={TOP}>Top tier (all scanners)</option>
            {tiers.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select className="field" aria-label="Outreach" value={contactF}
                  onChange={(e) => setContactF(e.target.value as ContactState | "all" | "untouched")}
                  title="Has anyone got through? Read from the Apollo sync.">
            <option value="all">Outreach: any</option>
            <option value="untouched">Never touched — no outreach on record ({(contactCounts.never + contactCounts.unknown).toLocaleString()})</option>
            {CONTACT_ORDER.map((x) => <option key={x} value={x}>{CONTACT_META[x].label} ({contactCounts[x].toLocaleString()})</option>)}
          </select>
          <select className="field" aria-label="At company" value={companyF}
                  onChange={(e) => setCompanyF(e.target.value as "all" | "multi" | "single")}
                  title="How many leads we hold at this lead's company">
            <option value="all">At company: any</option>
            <option value="multi">2+ leads at the company</option>
            <option value="single">Only lead at the company</option>
          </select>
          <select className="field" aria-label="Position" value={levelF}
                  onChange={(e) => setLevelF(e.target.value as TitleLevel | "all")}
                  title="Seniority read from the contact's job title. 'Contact role' is a tenant or CRM role like Company Administrator, not a job title.">
            <option value="all">Position: any</option>
            {LEVEL_ORDER.map((x) => <option key={x} value={x}>{LEVEL_META[x].label} ({levelCounts[x].toLocaleString()})</option>)}
          </select>
          <div className="filter-wrap" style={{ position: "relative" }}>
            <button className="filter-btn btn btn-sm btn-secondary" onClick={() => setFiltersOpen((v) => !v)} aria-expanded={filtersOpen}>
              Filters{chips.length > 0 && <span className="filter-count"> {chips.length}</span>}
            </button>
          </div>
          <select className="field" aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => <option key={k} value={k}>Sort: {SORT_LABEL[k]}</option>)}
          </select>
          <div className="toolbar-spacer" />
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            <b>{filtered.length.toLocaleString()}</b> of {leads.length.toLocaleString()}
          </span>
          <button className="btn btn-sm btn-primary" disabled={!filtered.length || exporting}
                  onClick={() => exportSet(filtered, filterLabel)}
                  title="Download every lead matching these filters as an Apollo import CSV. A file only — nothing is pushed to Apollo.">
            {exporting ? "Preparing…" : `⬇ Export ${filtered.length.toLocaleString()} for Apollo`}
          </button>
        </div>
      </div>

      {/* ---- the filter panel ---- */}
      {filtersOpen && facets && (
        <div className="panel" style={{ marginBottom: 10 }}>
          <div className="panel-body" style={{
            display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 12, fontSize: 12.5,
          }}>
            <label>
              <div className="section-label">Product line</div>
              <select className="field" style={{ width: "100%" }} aria-label="Product line" value={lineF} onChange={(e) => setLineF(e.target.value)}>
                <option value="all">Any</option>{opts(facets.line)}
              </select>
            </label>
            <label>
              <div className="section-label">Industry (from Apollo)</div>
              <select className="field" style={{ width: "100%" }} aria-label="Industry" value={industryF} onChange={(e) => setIndustryF(e.target.value)}>
                <option value="all">Any</option>{opts(facets.industry)}
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
              <div className="section-label">In Apollo</div>
              <select className="field" style={{ width: "100%" }} aria-label="Apollo state" value={apolloF} onChange={(e) => setApolloF(e.target.value as ApolloFilter)}>
                <option value="all">Any</option>
                {(Object.keys(APOLLO_LABEL) as (keyof typeof APOLLO_LABEL)[]).map((k) => (
                  <option key={k} value={k}>{APOLLO_LABEL[k]} ({(facets.apollo.get(k) || 0).toLocaleString()})</option>
                ))}
              </select>
            </label>
            <label>
              <div className="section-label">Apollo sequence they're in</div>
              <select className="field" style={{ width: "100%" }} aria-label="Apollo sequence" value={seqF} onChange={(e) => setSeqF(e.target.value)}>
                <option value="all">Any</option>{opts(facets.seq)}
              </select>
            </label>
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
            <label>
              <div className="section-label">How many files</div>
              <select className="field" style={{ width: "100%" }} aria-label="File count" value={filesF} onChange={(e) => setFilesF(e.target.value as FilesFilter)}>
                <option value="all">Any</option>
                {(Object.keys(FILES_LABEL) as (keyof typeof FILES_LABEL)[]).map((k) => (
                  <option key={k} value={k}>{FILES_LABEL[k]} ({(facets.files.get(k) || 0).toLocaleString()})</option>
                ))}
              </select>
            </label>
            <label>
              <div className="section-label">On this file</div>
              <select className="field" style={{ width: "100%" }} aria-label="Source file" value={fileNameF} onChange={(e) => setFileNameF(e.target.value)}>
                <option value="all">Any</option>{opts(facets.fileName)}
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
            <label>
              <div className="section-label">Received (month)</div>
              <select className="field" aria-label="Received month" style={{ width: "100%" }} value={monthF} onChange={(e) => setMonthF(e.target.value)}>
                <option value="all">Any</option>
                {[...facets.month.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([k, n]) => (
                  <option key={k} value={k}>{monthLabel(k)} ({n.toLocaleString()})</option>
                ))}
              </select>
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
            <div>
              <div className="section-label">First uploaded</div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input type="date" className="field" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="First seen from" />
                <span>→</span>
                <input type="date" className="field" value={to} onChange={(e) => setTo(e.target.value)} aria-label="First seen to" />
              </div>
            </div>
          </div>
        </div>
      )}

      {chips.length > 0 && (
        <div className="chip-row" style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8, alignItems: "center" }}>
          {chips.map((c) => (
            <button key={c.label} className="chip" onClick={c.clear} title="Remove this filter">{c.label} ✕</button>
          ))}
          <button className="btn btn-sm btn-ghost" onClick={clearAll}>Clear all</button>
        </div>
      )}

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
        <button className="btn btn-sm btn-ghost" disabled={!selected.size || exporting}
                onClick={() => exportSet(selectedLeads, "selection")}>
          ⬇ Export selection
        </button>
      </div>

      {/* ---- the table: one page at a time, scrolling inside its own box
             so the toolbar and filters stay in view ---- */}
      <div className="table-card" style={{ maxHeight: "calc(100vh - 250px)", minHeight: 260, overflow: "auto" }}>
        <table className="data-table dense-table">
          <thead>
            <tr>
              <th className="pin pin-0" style={{ width: 30 }}>
                <input type="checkbox" checked={allShownSelected} onChange={selectPage} aria-label="Select this page" />
              </th>
              <th className="pin pin-1">Company</th>
              <th>Contact</th>
              <th title="Strong Signal, Needs Review or Bad Lead — from the scanner that stored it">Stored as</th>
              <th>Product line</th>
              <th title="The date the file states, or the upload date if it states none">Received</th>
              <th className="num" title="How many different CSV files this lead was in">Uploads</th>
              <th title="Every lead we hold at this company">At company</th>
              <th title="Has anyone got through? From the Apollo sync.">Outreach</th>
              <th title="The latest call disposition in Apollo">Disposition</th>
              <th title="The Apollo sequence this lead is in, from the last sync">Sequence</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((l) => {
              const d = derived.get(l.key)!;
              const a = l.apollo;
              const co = companyStats.get(d.companyKey);
              const cm = CONTACT_META[d.contact];
              const seq = a?.sequences[0];
              const total = seq ? stepsInSequence(funnels, seq.name) : null;
              return (
                <tr key={l.key} className={selected.has(l.key) ? "is-selected" : undefined} onClick={() => setOpenKey(l.key)}>
                  <td className="pin pin-0" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(l.key)} onChange={() => toggle(l.key)} aria-label={`Select ${l.company}`} />
                  </td>
                  <td className="pin pin-1 strong" title={l.company}>{l.company || "—"}</td>
                  <td title={[l.contact, l.title, l.email].filter(Boolean).join(" · ")}>{l.contact || "—"}</td>
                  <td title={`${VERDICT_META[d.verdict].hint}\nScanner's word: ${l.tier || "—"}`}>
                    <span className="pill" style={{ color: VERDICT_META[d.verdict].color, background: VERDICT_META[d.verdict].bg }}>{VERDICT_META[d.verdict].label}</span>
                  </td>
                  <td>{d.line === NO_LINE ? <span className="muted">—</span> : d.line}</td>
                  <td>{d.month}</td>
                  <td className="num" title={l.sourceFiles.join("\n")}>{d.files}</td>
                  <td title={co ? co.names.join("\n") : undefined}>
                    {!co || co.contacts < 2 ? <span className="muted">1</span>
                      : <>{co.contacts}<span className="muted"> · {co.worked} worked</span></>}
                  </td>
                  <td title={`${cm.hint}${a ? `\n${a.callCount} call${a.callCount === 1 ? "" : "s"}${a.emailCount !== undefined ? ` · ${a.emailCount} email${a.emailCount === 1 ? "" : "s"}` : ""}` : ""}`}>
                    <span className="pill" style={{ color: cm.color, background: cm.bg }}>{cm.label}</span>
                  </td>
                  <td title={a ? outcomeSummary(a) : undefined}>
                    {!a || !a.lastOutcome ? <span className="muted">—</span>
                      : <>{a.lastOutcome}{a.lastCallAt && <span className="muted"> · {a.lastCallAt.slice(0, 10)}</span>}</>}
                  </td>
                  <td className="wide" title={a?.sequences.map((s) => `${s.name} · ${s.status}${s.step != null ? ` · step ${s.step}` : ""}${s.addedAt ? ` · added ${s.addedAt}` : ""}`).join("\n")}>
                    {!a ? <span className="muted">—</span>
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
              <tr><td colSpan={12} style={{ textAlign: "center", padding: 24, color: "var(--muted)" }}>
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
            companyProfiles={companyProfiles}
            onClose={() => setOpenKey(null)}
            sequenceNames={sequenceNames}
            onSetPlan={onSetPlan ? (sq) => onSetPlan([openLead.key], sq) : undefined}
            onSetStatus={onSetStatus ? (st) => onSetStatus([openLead.key], st) : undefined}
            onPrev={i > 0 ? () => go(i - 1) : undefined}
            onNext={i >= 0 && i < filtered.length - 1 ? () => go(i + 1) : undefined}
            position={i >= 0 ? `${(i + 1).toLocaleString()} of ${filtered.length.toLocaleString()}` : undefined}
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
