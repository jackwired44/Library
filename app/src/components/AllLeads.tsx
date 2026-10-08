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
import StatusPill from "./StatusPill";
import {
  STAGE_META, STAGE_ORDER, STATUS_META, STATUS_ORDER, statusOf, wasReached,
  type LeadStatus,
} from "../lib/leadStatus";
import { stepsInSequence, type ApolloFunnel } from "../lib/apolloFunnel";
import { isIntentDate, soonestUpcoming, type NoteDate } from "../lib/noteDates";

const PAGE_SIZES = [25, 100, 250, 500];

export interface SyncReport {
  rows: number; matched: number; unmatched: number; unmapped: string[]; skipped: number;
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

type SortKey = "last" | "first" | "company" | "files" | "score" | "calls" | "nextdate";
const SORT_LABEL: Record<SortKey, string> = {
  last: "Last seen (newest)",
  first: "First seen (newest)",
  company: "Company A–Z",
  files: "Most files",
  score: "Highest score",
  calls: "Most calls",
  nextdate: "Soonest date in notes",
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

const NO_INDUSTRY = "(not enriched)";
const NO_LINE = "(no product line)";

/* --------------------------------------------------------------- component */

export default function AllLeads({
  leads, companyProfiles = [], onApplySync, initialSequence = "",
  sequenceNames = [], onSetPlan, onSetStatus, funnels = [], initialStatus,
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
}) {
  const [search, setSearch] = useState("");
  const [sourceF, setSourceF] = useState<LeadSource | "all">("all");
  const [tierF, setTierF] = useState("all");
  const [lineF, setLineF] = useState("all");
  const [industryF, setIndustryF] = useState("all");
  const [sizeF, setSizeF] = useState("all");
  const [apolloF, setApolloF] = useState<ApolloFilter>("all");
  const [seqF, setSeqF] = useState(initialSequence || "all");
  const [planF, setPlanF] = useState<PlanFilter>("all");
  const [planSeqF, setPlanSeqF] = useState("all");
  const [filesF, setFilesF] = useState<FilesFilter>("all");
  const [fileNameF, setFileNameF] = useState("all");
  const [statusF, setStatusF] = useState<LeadStatus | "all">(initialStatus ?? "all");
  const [monthF, setMonthF] = useState("all");
  const [dateF, setDateF] = useState<Derived["dateKind"] | "all">("all");
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
      });
    }
    return m;
  }, [leads, companyProfiles]);

  /* ---- the predicates, one per filter, so each facet can skip its own ---- */
  const q = search.trim().toLowerCase();
  const fromT = from ? Date.parse(`${from}T00:00:00`) : null;
  const toT = to ? Date.parse(`${to}T23:59:59.999`) : null;

  type Key = "month" | "dates" | "status" | "search" | "source" | "tier" | "line" | "industry" | "size" | "apollo" | "seq" | "plan" | "planSeq" | "files" | "fileName" | "date";
  const tests = useMemo(() => {
    const t: Record<Key, (l: StoredLead, d: Derived) => boolean> = {
      status: (_l, d) => statusF === "all" || d.status === statusF,
      month: (_l, d) => monthF === "all" || d.month === monthF,
      dates: (_l, d) => dateF === "all" || d.dateKind === dateF,
      search: (_l, d) => !q || d.hay.includes(q),
      source: (l) => sourceF === "all" || l.source === sourceF,
      tier: (l) => tierF === "all" || l.tier === tierF,
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
  }, [monthF, dateF, statusF, q, sourceF, tierF, lineF, industryF, sizeF, apolloF, seqF, planF, planSeqF, filesF, fileNameF, fromT, toT]);

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
      dates: facet("dates", (_l, d) => d.dateKind),
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersOpen, leads, derived, tests]);

  // The status strip is a facet like any other: each count is what that
  // status would show given every OTHER filter.
  const statusCounts = useMemo(() => {
    const m = Object.fromEntries(STATUS_ORDER.map((x) => [x, 0])) as Record<LeadStatus, number>;
    for (const l of leads) if (passes(l, "status")) m[derived.get(l.key)!.status]++;
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
  if (monthF !== "all") chips.push({ label: `Received ${monthLabel(monthF)}`, clear: () => setMonthF("all") });
  if (dateF !== "all") chips.push({ label: DATE_LABEL[dateF], clear: () => setDateF("all") });
  if (statusF !== "all") chips.push({ label: `Status: ${STATUS_META[statusF].label}`, clear: () => setStatusF("all") });
  if (sourceF !== "all") chips.push({ label: LEAD_SOURCE_META[sourceF].label, clear: () => setSourceF("all") });
  if (tierF !== "all") chips.push({ label: tierF, clear: () => setTierF("all") });
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
                {syncReport.unmatched > 0 && <> {syncReport.unmatched.toLocaleString()} matched nobody here.</>}
                {syncReport.skipped > 0 && <> {syncReport.skipped.toLocaleString()} could not be keyed.</>}
                {syncReport.unmapped.length > 0 && <div style={{ color: "var(--muted)" }}>Unmapped: {syncReport.unmapped.join(", ")}</div>}
                <button className="btn btn-sm btn-ghost" style={{ marginLeft: 6 }} onClick={() => setSyncReport(null)}>Dismiss</button>
              </>
            )}
          </div>
        )}
      </div>

      {/* ---- the status pipeline. Click a status to work just those leads;
             click it again to clear. Grouped by stage, left to right, in
             the order a lead moves. ---- */}
      <div className="panel" style={{ marginBottom: 10 }}>
        <div className="panel-body" style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-start" }}>
          {STAGE_ORDER.map((stage) => (
            <div key={stage} style={{ minWidth: 0 }}>
              <div className="section-label" style={{ marginBottom: 4 }}>{STAGE_META[stage].label}</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {STATUS_ORDER.filter((x) => STATUS_META[x].stage === stage).map((x) => {
                  const on = statusF === x;
                  const m = STATUS_META[x];
                  return (
                    <button
                      key={x}
                      onClick={() => setStatusF(on ? "all" : x)}
                      title={m.hint}
                      aria-pressed={on}
                      style={{
                        border: `1px solid ${on ? m.color : "var(--border)"}`,
                        background: on ? m.bg : "var(--bg-surface, #fff)",
                        color: on ? m.color : "var(--ink, #081E22)",
                        borderRadius: 8, padding: "5px 10px", cursor: "pointer", textAlign: "left",
                        fontSize: 12, lineHeight: 1.25,
                      }}
                    >
                      <div style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums", fontSize: 15, color: m.color }}>
                        {statusCounts[x].toLocaleString()}
                      </div>
                      {m.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
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
            {tiers.map((t) => <option key={t} value={t}>{t}</option>)}
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
      <div className="table-card" style={{ maxHeight: "calc(100vh - 290px)", minHeight: 240, overflow: "auto" }}>
        <table className="data-table">
          <thead style={{ position: "sticky", top: 0, zIndex: 2, background: "var(--bg-surface, #fff)" }}>
            <tr>
              <th style={{ width: 28 }}>
                <input type="checkbox" checked={allShownSelected} onChange={selectPage} aria-label="Select this page" />
              </th>
              <th>Company</th><th>Contact</th><th>Status</th>
              <th title="The Apollo sequence this lead is in, from the last sync">Sequence</th>
              <th title="Calls logged in Apollo, from the last sync">Calls</th>
              <th>Scan</th><th>Notes</th><th>Files · seen</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((l) => {
              const d = derived.get(l.key)!;
              const a = l.apollo;
              const segs = noteSegments(l.notes).length;
              return (
                <tr key={l.key} style={{ cursor: "pointer", background: selected.has(l.key) ? "var(--bg-selected, #eef6f5)" : undefined }}
                    onClick={() => setOpenKey(l.key)}>
                  <td onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(l.key)} onChange={() => toggle(l.key)} aria-label={`Select ${l.company}`} />
                  </td>
                  <td style={{ minWidth: 160 }}>
                    <b>{l.company || "—"}</b>
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>
                      {d.industry === NO_INDUSTRY ? "industry —" : d.industry}
                      {" · "}{d.employees === null ? "size —" : `${d.employees.toLocaleString()} emp`}
                    </div>
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {l.contact || "—"}
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>{l.title || l.email || ""}</div>
                  </td>
                  {/* Status, then the two things Jack asked to see at a
                      glance: which sequence they are in, and how many times
                      they have been called. */}
                  <td style={{ whiteSpace: "nowrap" }}>
                    <StatusPill lead={l} />
                    {l.plan && (
                      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                        → {l.plan.sequence}
                        {l.plan.status === "exported" ? ` · exported ${(l.plan.exportedAt || "").slice(0, 10)}` : " · queued"}
                      </div>
                    )}
                  </td>
                  <td style={{ fontSize: 12, minWidth: 150 }}>
                    {!a ? <span style={{ color: "var(--muted)" }} title="No Apollo sync has matched this lead">—</span>
                      : a.sequences.length === 0 ? <span style={{ color: "var(--muted)" }}>Not in a sequence</span>
                      : (
                        <>
                          {a.sequences.slice(0, 2).map((s, i) => {
                            const total = stepsInSequence(funnels, s.name);
                            return (
                              <div key={i} style={{ whiteSpace: "nowrap" }}>
                                <b style={{ fontWeight: 600 }}>{s.name}</b>
                                <div style={{ fontSize: 11, color: s.status === "active" ? "var(--accent)" : "var(--muted)" }}>
                                  {s.status}
                                  {s.step != null ? ` · step ${s.step}${total ? ` of ${total}` : ""}` : ""}
                                </div>
                              </div>
                            );
                          })}
                          {a.sequences.length > 2 && (
                            <div style={{ fontSize: 11, color: "var(--muted)" }} title={a.sequences.map((s) => s.name).join("\n")}>
                              +{a.sequences.length - 2} more
                            </div>
                          )}
                        </>
                      )}
                  </td>
                  <td style={{ whiteSpace: "nowrap", fontSize: 12 }} title={a ? outcomeSummary(a) : undefined}>
                    {!a ? <span style={{ color: "var(--muted)" }}>—</span>
                      : a.callCount === 0 ? <span style={{ color: "var(--muted)" }}>Not called</span>
                      : (
                        <>
                          <b style={{ fontSize: 14, fontVariantNumeric: "tabular-nums" }}>{a.callCount}</b>
                          {" "}call{a.callCount === 1 ? "" : "s"}
                          <div style={{ fontSize: 11, color: "var(--muted)" }}>
                            {a.lastOutcome || "—"}{a.lastCallAt ? ` · ${a.lastCallAt.slice(0, 10)}` : ""}
                          </div>
                        </>
                      )}
                  </td>
                  <td style={{ whiteSpace: "nowrap", fontSize: 12 }}>
                    {LEAD_SOURCE_META[l.source].short} · {l.tier || "—"}
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>{l.productArea || "no product line"}</div>
                  </td>
                  <td title={l.notes} style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12 }}>
                    {d.nextDate && (
                      <div style={{ fontSize: 11, color: "var(--accent)", fontWeight: 600 }}>
                        📅 {d.nextDate.iso}{d.nextDate.about ? ` · ${d.nextDate.about}` : ""}
                      </div>
                    )}
                    {newestNote(l.notes) || "—"}
                    {segs > 1 && <span style={{ color: "var(--muted)", fontSize: 11 }}> +{segs - 1} earlier</span>}
                  </td>
                  <td title={l.sourceFiles.join("\n")} style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                    <b>{d.files}</b> file{d.files === 1 ? "" : "s"} · ×{l.timesSeen}
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>
                      {l.firstSeenAt.slice(0, 10)}{l.lastSeenAt.slice(0, 10) !== l.firstSeenAt.slice(0, 10) ? ` → ${l.lastSeenAt.slice(0, 10)}` : ""}
                    </div>
                  </td>
                </tr>
              );
            })}
            {shown.length === 0 && (
              <tr><td colSpan={9} style={{ textAlign: "center", padding: 24, color: "var(--muted)" }}>
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
          />
        );
      })()}
    </>
  );
}
