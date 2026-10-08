// Every lead ever scanned, from all three scanners — the Library's source
// of truth, and where Apollo state is read.
//
// Per Jack: "i will be able to filter through all strong signals here if
// they are active in a sequence finished their apollo and trellus selected
// disposition but from raw lead to finished lead in this library", and
// "then i can filter through leads i may never have contacted yet".
import { useEffect, useMemo, useState } from "react";
import {
  LEAD_SOURCE_META, hasActiveSequence, hasFinishedSequence, neverContacted,
  newestNote, noteSegments, outcomeSummary, sequenceNamesIn,
  type LeadSource, type StoredLead,
} from "../lib/leadStore";
import { SYNC_STALE_DAYS, syncAgeDays, leadsToSync } from "../lib/apolloSync";
import { parseCSVFile, toCSV, downloadBlob } from "../lib/csv";
import type { ParsedFile } from "../lib/detection";
import {
  buildSizeBands, companiesWithUnknownSize, downloadCampaignCSV, type SizeBand,
} from "../lib/campaignExport";
import { MIN_EMPLOYEES } from "../lib/leadQualify";
import type { CompanyProfile } from "../lib/companyProfiles";
import LeadDetail from "./LeadDetail";

const PAGE = 25;

/** How many dated notes a lead has accumulated across uploads. */
const segCount = (notes: string) => noteSegments(notes).length;

/** Apollo-state filter. Kept as one control rather than several toggles so
 *  the states stay mutually exclusive and a count can be shown per option
 *  — the same shape the CSP Partner-interest filter uses. */
type ApolloFilter =
  | "all" | "active" | "finished" | "never-contacted" | "contacted" | "no-apollo";

const APOLLO_LABEL: Record<Exclude<ApolloFilter, "all">, string> = {
  active: "Active in a sequence",
  finished: "Finished a sequence",
  "never-contacted": "Never contacted",
  contacted: "Has been called",
  "no-apollo": "No Apollo record",
};

/** Company-size filter. `unknown` is a first-class option because per Jack
 *  an unknown-headcount company is kept, not cut — so it has to be findable
 *  in order to be confirmed, rather than hiding inside "any". */
type SizeFilter = "all" | SizeBand;

const SIZE_LABEL: Record<SizeBand, string> = {
  ok: `${MIN_EMPLOYEES}+ employees`,
  under: `Under ${MIN_EMPLOYEES}`,
  unknown: "Size unknown",
};

export interface SyncReport {
  rows: number; matched: number; unmatched: number; unmapped: string[]; skipped: number;
}

export default function AllLeads({
  leads, companyProfiles = [], onApplySync, initialSequence = "",
}: {
  leads: StoredLead[];
  companyProfiles?: CompanyProfile[];
  onApplySync?: (files: ParsedFile[]) => Promise<SyncReport>;
  /** Seeded once on mount, from a campaign card's "open these leads". App
   *  keys this component on it, so arriving twice for the same sequence
   *  still remounts and re-seeds — the repeat-value staleness bug this
   *  codebase has already hit on Engage's tab prop. */
  initialSequence?: string;
}) {
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<LeadSource | "all">("all");
  const [tierFilter, setTierFilter] = useState<string>("all");
  const [apolloFilter, setApolloFilter] = useState<ApolloFilter>("all");
  const [sequenceFilter, setSequenceFilter] = useState<string>(initialSequence || "all");
  const [sizeFilter, setSizeFilter] = useState<SizeFilter>("all");
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [syncReport, setSyncReport] = useState<SyncReport | string | null>(null);
  const [syncing, setSyncing] = useState(false);

  // Search text is joined ONCE per lead set, not inside the filter.
  // Rebuilding a per-row haystack inside a predicate is the defect that
  // cost 1,033 ms per keystroke in Scanner2 before it was fixed; this view
  // can hold tens of thousands of leads and would reproduce it exactly.
  const haystacks = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of leads) {
      m.set(l.key, [
        l.company, l.contact, l.title, l.email, l.phone, l.mobilePhone,
        l.productArea, l.tier, l.notes,
        ...(l.apollo?.sequences ?? []).map((s) => s.name),
      ].join(" \u0001").toLowerCase());
    }
    return m;
  }, [leads]);

  // Each lead's Apollo state resolved once per lead set, for the same
  // reason: the predicates and every facet count read these booleans
  // rather than re-deriving them per pass.
  const state = useMemo(() => {
    const m = new Map<string, { active: boolean; finished: boolean; never: boolean; has: boolean }>();
    for (const l of leads) {
      m.set(l.key, {
        active: hasActiveSequence(l),
        finished: hasFinishedSequence(l),
        never: neverContacted(l),
        has: !!l.apollo,
      });
    }
    return m;
  }, [leads]);

  const tiers = useMemo(() => {
    const set = new Set<string>();
    for (const l of leads) if (l.tier) set.add(l.tier);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [leads]);

  const sequences = useMemo(() => sequenceNamesIn(leads), [leads]);
  const ageDays = useMemo(() => syncAgeDays(leads), [leads]);

  // Resolved once per lead set, like the haystacks and Apollo state above —
  // profileForCompany walks the profile list, so doing it inside a
  // predicate would re-walk it on every keystroke.
  const sizeBands = useMemo(
    () => buildSizeBands(leads, companyProfiles, MIN_EMPLOYEES),
    [leads, companyProfiles],
  );

  const q = search.trim().toLowerCase();
  const matchesApollo = (l: StoredLead, f: ApolloFilter) => {
    if (f === "all") return true;
    const s = state.get(l.key)!;
    if (f === "active") return s.active;
    if (f === "finished") return s.finished;
    if (f === "never-contacted") return s.never;
    if (f === "contacted") return !s.never;
    return !s.has;
  };

  const filtered = useMemo(() => leads.filter((l) =>
    (!q || (haystacks.get(l.key) || "").includes(q)) &&
    (sourceFilter === "all" || l.source === sourceFilter) &&
    (tierFilter === "all" || l.tier === tierFilter) &&
    (sequenceFilter === "all" || (l.apollo?.sequences ?? []).some((s) => s.name === sequenceFilter)) &&
    (sizeFilter === "all" || sizeBands.get(l.key) === sizeFilter) &&
    matchesApollo(l, apolloFilter)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [leads, q, haystacks, sourceFilter, tierFilter, sequenceFilter, sizeFilter, sizeBands, apolloFilter, state]);

  // Per-band counts, faceted the same way the Apollo counts are: each says
  // how many it would show given every OTHER filter.
  const sizeCounts = useMemo(() => {
    const out = { all: 0, ok: 0, under: 0, unknown: 0 };
    for (const l of leads) {
      if (q && !(haystacks.get(l.key) || "").includes(q)) continue;
      if (sourceFilter !== "all" && l.source !== sourceFilter) continue;
      if (tierFilter !== "all" && l.tier !== tierFilter) continue;
      if (sequenceFilter !== "all" && !(l.apollo?.sequences ?? []).some((s) => s.name === sequenceFilter)) continue;
      if (!matchesApollo(l, apolloFilter)) continue;
      out.all++;
      out[sizeBands.get(l.key) ?? "unknown"]++;
    }
    return out;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leads, q, haystacks, sourceFilter, tierFilter, sequenceFilter, apolloFilter, sizeBands, state]);

  const unknownCompanies = useMemo(
    () => companiesWithUnknownSize(filtered, sizeBands),
    [filtered, sizeBands],
  );

  /** What the current filter set is, in words — so the downloaded file is
   *  named after what is actually in it rather than a generic "leads". */
  const filterLabel = [
    tierFilter !== "all" ? tierFilter : "",
    sourceFilter !== "all" ? LEAD_SOURCE_META[sourceFilter].short : "",
    sequenceFilter !== "all" ? sequenceFilter : "",
    apolloFilter !== "all" ? APOLLO_LABEL[apolloFilter] : "",
    sizeFilter !== "all" ? SIZE_LABEL[sizeFilter] : "",
  ].filter(Boolean).join(" ") || "all";

  /** The exact people a sync should ask Apollo about. Exported so the pull
   *  runs against a real list instead of a guess at who is held here — the
   *  whole reason the sync is lead-driven rather than a blind bulk fetch. */
  async function exportLookupList() {
    const rows = leadsToSync(leads).map((l) => ({
      Email: l.email, Name: l.contact, Company: l.company,
    }));
    await downloadBlob(
      toCSV(rows, ["Email", "Name", "Company"] as const),
      `apollo-lookup-${rows.length}-${new Date().toISOString().slice(0, 10)}.csv`,
    );
  }

  async function importSyncFile(files: FileList | null) {
    if (!files?.length || !onApplySync || syncing) return;
    setSyncing(true);
    setSyncReport(null);
    try {
      const parsed = await Promise.all([...files].map((f) => parseCSVFile(f)));
      setSyncReport(await onApplySync(parsed as ParsedFile[]));
    } catch (e) {
      setSyncReport(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  }

  async function exportForApollo() {
    if (!filtered.length || exporting) return;
    setExporting(true);
    try {
      await downloadCampaignCSV(filtered, companyProfiles, filterLabel);
    } finally {
      setExporting(false);
    }
  }

  // Counts exclude the Apollo filter's own effect, so each option says how
  // many it would show given everything else — the faceted convention the
  // scanners already use.
  const apolloCounts = useMemo(() => {
    const base = leads.filter((l) =>
      (!q || (haystacks.get(l.key) || "").includes(q)) &&
      (sourceFilter === "all" || l.source === sourceFilter) &&
      (tierFilter === "all" || l.tier === tierFilter) &&
      (sequenceFilter === "all" || (l.apollo?.sequences ?? []).some((s) => s.name === sequenceFilter)));
    const out = { all: base.length, active: 0, finished: 0, "never-contacted": 0, contacted: 0, "no-apollo": 0 };
    for (const l of base) {
      const s = state.get(l.key)!;
      if (s.active) out.active++;
      if (s.finished) out.finished++;
      if (s.never) out["never-contacted"]++; else out.contacted++;
      if (!s.has) out["no-apollo"]++;
    }
    return out;
  }, [leads, q, haystacks, sourceFilter, tierFilter, sequenceFilter, state]);

  // Narrowing to 12 leads while sitting on page 40 shows an empty table.
  useEffect(() => { setPage(1); }, [search, sourceFilter, tierFilter, apolloFilter, sequenceFilter, sizeFilter]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const shown = filtered.slice((page - 1) * PAGE, page * PAGE);

  if (leads.length === 0) {
    return (
      <>
        <div className="page-head">
          <div><h2>All leads</h2><p className="page-sub">Every lead scanned, from all three scanners.</p></div>
        </div>
        <div className="panel"><div className="panel-body">
          <p style={{ margin: 0 }}>
            Nothing stored yet. Every lead you scan from here on is kept — all three scanners,
            every tier, not just the Strong Signal rows the Lead library files.
          </p>
        </div></div>
      </>
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h2>All leads</h2>
          <p className="page-sub">
            {leads.length.toLocaleString()} lead{leads.length === 1 ? "" : "s"} scanned, all three scanners.
          </p>
        </div>
      </div>

      {/* Staleness is stated, never implied. Without this, "never contacted"
          and "never synced" read identically and the view lies by omission. */}
      <div className="panel" style={{ marginBottom: 12 }}>
        <div className="panel-body" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <b style={{ fontSize: 12 }}>Apollo</b>
          {ageDays === null ? (
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              Not synced yet &mdash; sequence assignments and call counts are blank until a sync runs,
              so every lead currently reads as never contacted.
            </span>
          ) : (
            <span style={{ fontSize: 12, color: ageDays > SYNC_STALE_DAYS ? "#B5443B" : "var(--muted)" }}>
              Synced {ageDays === 0 ? "today" : `${ageDays} day${ageDays === 1 ? "" : "s"} ago`}
              {ageDays > SYNC_STALE_DAYS ? " — stale, re-sync before trusting these numbers." : "."}
              {" "}{apolloCounts.all - apolloCounts["no-apollo"]} of {apolloCounts.all} leads have an Apollo record.
            </span>
          )}
          {onApplySync && (
            <>
              <div className="toolbar-spacer" />
              <button className="btn btn-sm btn-ghost" onClick={exportLookupList} disabled={!leads.length}
                      title="Download the people to ask Apollo about: email, name, company. This is the input to the sync pull.">
                ⬇ Lookup list
              </button>
              <label className="btn btn-sm btn-ghost" style={{ cursor: syncing ? "default" : "pointer" }}
                     title="Load the sync file produced from Apollo. Sequence assignments and call counts are replaced, not merged — a re-sync has to be able to clear a sequence that ended.">
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
                {syncReport.unmatched > 0 && (
                  <> {syncReport.unmatched.toLocaleString()} matched nobody here — those people were never scanned into this library.</>
                )}
                {syncReport.skipped > 0 && (
                  <> {syncReport.skipped.toLocaleString()} row{syncReport.skipped === 1 ? "" : "s"} had no email and no name+company, so could not be keyed.</>
                )}
                {syncReport.unmapped.length > 0 && (
                  <div style={{ color: "var(--muted)", marginTop: 2 }}>
                    Unmapped columns, ignored rather than guessed at: {syncReport.unmapped.join(", ")}
                  </div>
                )}
                <button className="btn btn-sm btn-ghost" style={{ marginLeft: 6 }} onClick={() => setSyncReport(null)}>Dismiss</button>
              </>
            )}
          </div>
        )}
      </div>

      <div className="toolbar">
        <div className="toolbar-row">
          <input
            className="field"
            placeholder="Search company, contact, email, notes or sequence&hellip;"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flex: 1, minWidth: 220, maxWidth: 420 }}
          />
          <select className="field" aria-label="Scanner" value={sourceFilter}
                  onChange={(e) => setSourceFilter(e.target.value as LeadSource | "all")}>
            <option value="all">Scanner: any</option>
            {(["main", "smc", "csp"] as LeadSource[]).map((s) => (
              <option key={s} value={s}>{LEAD_SOURCE_META[s].label}</option>
            ))}
          </select>
          <select className="field" aria-label="Tier" value={tierFilter}
                  onChange={(e) => setTierFilter(e.target.value)}>
            <option value="all">Tier: any</option>
            {tiers.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select
            className="field"
            aria-label="Apollo state"
            style={{ width: 230 }}
            value={apolloFilter}
            onChange={(e) => setApolloFilter(e.target.value as ApolloFilter)}
            title={"Where this lead stands in Apollo.\n\nNever contacted is about CALLS, not enrolment — a lead can sit in a sequence and still never have been dialled."}
          >
            <option value="all">Apollo: any ({apolloCounts.all.toLocaleString()})</option>
            {(Object.keys(APOLLO_LABEL) as (keyof typeof APOLLO_LABEL)[]).map((k) => (
              <option key={k} value={k}>{APOLLO_LABEL[k]} ({apolloCounts[k].toLocaleString()})</option>
            ))}
          </select>
          {sequences.length > 0 && (
            <select className="field" aria-label="Sequence" style={{ width: 200 }}
                    value={sequenceFilter} onChange={(e) => setSequenceFilter(e.target.value)}>
              <option value="all">Sequence: any</option>
              {sequences.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
          <select
            className="field"
            aria-label="Company size"
            style={{ width: 190 }}
            value={sizeFilter}
            onChange={(e) => setSizeFilter(e.target.value as SizeFilter)}
            title={`Headcount from the company's Apollo profile.\n\nSize unknown means we hold no profile for that company — those leads are kept, never cut, so they are findable here in order to be confirmed.`}
          >
            <option value="all">Size: any ({sizeCounts.all.toLocaleString()})</option>
            {(["ok", "under", "unknown"] as SizeBand[]).map((b) => (
              <option key={b} value={b}>{SIZE_LABEL[b]} ({sizeCounts[b].toLocaleString()})</option>
            ))}
          </select>
          <div className="toolbar-spacer" />
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            {filtered.length.toLocaleString()} of {leads.length.toLocaleString()} shown
          </span>
          <button
            className="btn btn-sm btn-primary"
            disabled={!filtered.length || exporting}
            onClick={exportForApollo}
            title={"Download the leads currently shown, as a CSV in Apollo's own column shape.\n\nThis writes a file — it does not touch your live Apollo account."}
          >
            {exporting ? "Preparing…" : `⬇ Push list for Apollo (${filtered.length.toLocaleString()})`}
          </button>
        </div>
      </div>

      {/* The unknown-headcount route. Nothing in this app can read a
          company website: a local page is blocked by CORS from fetching a
          third party, and LinkedIn has a login wall and no API. The
          Company Overview Agent does it OUTSIDE the browser, and this is
          where its input list comes from. */}
      {unknownCompanies.length > 0 && companyProfiles.length > 0 && (
        <div style={{ margin: "0 0 12px", fontSize: 12, color: "var(--muted)" }}>
          {unknownCompanies.length.toLocaleString()} compan{unknownCompanies.length === 1 ? "y in" : "ies in"} this
          selection {unknownCompanies.length === 1 ? "has" : "have"} no headcount on file, so the{" "}
          {MIN_EMPLOYEES}-employee floor has not been applied to {unknownCompanies.length === 1 ? "it" : "them"}.
          Enrich from the Scanner, or run the Company Overview Agent on their websites.
        </div>
      )}

      <div className="table-card">
        <table className="data-table">
          <thead>
            <tr>
              <th>Company</th><th>Contact</th><th>Scanner</th><th>Tier</th>
              <th>Product line</th><th>Notes</th><th>Apollo</th><th>Calls</th><th>Seen</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((l) => {
              const a = l.apollo;
              const summary = outcomeSummary(a);
              return (
                <tr key={l.key} style={{ cursor: "pointer" }} onClick={() => setOpenKey(l.key)}>
                  <td><b>{l.company || "—"}</b></td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {l.contact || "—"}
                    {l.email && <div style={{ fontSize: 11, color: "var(--muted)" }}>{l.email}</div>}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>{LEAD_SOURCE_META[l.source].short}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{l.tier || "—"}</td>
                  <td>{l.productArea || "—"}</td>
                  {/* The newest note reads on the row; the whole dated
                      timeline is on hover, so combining notes across
                      uploads does not turn every row into a paragraph. */}
                  <td
                    title={l.notes}
                    style={{ maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  >
                    {newestNote(l.notes) || "—"}
                    {segCount(l.notes) > 1 && (
                      <span style={{ color: "var(--muted)", fontSize: 11 }}>
                        {" "}+{segCount(l.notes) - 1} earlier
                      </span>
                    )}
                  </td>
                  <td>
                    {!a ? <span style={{ color: "var(--muted)" }}>&mdash;</span>
                      : a.sequences.length === 0 ? <span style={{ color: "var(--muted)" }}>No sequence</span>
                      : a.sequences.map((s, i) => (
                          <div key={i} style={{ fontSize: 11, whiteSpace: "nowrap" }}>
                            {s.name}
                            <span style={{ color: s.status === "active" ? "var(--accent)" : "var(--muted)" }}>
                              {" · "}{s.status}{s.step != null ? ` · step ${s.step}` : ""}
                            </span>
                          </div>
                        ))}
                  </td>
                  <td title={summary}>
                    {!a ? <span style={{ color: "var(--muted)" }}>&mdash;</span> : (
                      <>
                        <b>{a.callCount}</b>
                        {summary && <div style={{ fontSize: 11, color: "var(--muted)" }}>{summary}</div>}
                      </>
                    )}
                  </td>
                  <td style={{ whiteSpace: "nowrap", fontSize: 11, color: "var(--muted)" }}>
                    {l.lastSeenAt.slice(0, 10)}
                    {l.timesSeen > 1 && ` · ×${l.timesSeen}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="pager">
          <button className="btn btn-sm btn-ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</button>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            Showing {(page - 1) * PAGE + 1}&ndash;{Math.min(page * PAGE, filtered.length)} of {filtered.length.toLocaleString()} &middot; Page {page} of {pages}
          </span>
          <button className="btn btn-sm btn-ghost" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</button>
        </div>
      )}

      {openKey && (() => {
        const lead = leads.find((l) => l.key === openKey);
        return lead
          ? <LeadDetail lead={lead} companyProfiles={companyProfiles} onClose={() => setOpenKey(null)} />
          : null;
      })()}
    </>
  );
}
