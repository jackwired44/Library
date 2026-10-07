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
  outcomeSummary, sequenceNamesIn, type LeadSource, type StoredLead,
} from "../lib/leadStore";
import { SYNC_STALE_DAYS, syncAgeDays } from "../lib/apolloSync";

const PAGE = 25;

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

export default function AllLeads({ leads }: { leads: StoredLead[] }) {
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<LeadSource | "all">("all");
  const [tierFilter, setTierFilter] = useState<string>("all");
  const [apolloFilter, setApolloFilter] = useState<ApolloFilter>("all");
  const [sequenceFilter, setSequenceFilter] = useState<string>("all");
  const [page, setPage] = useState(1);

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
    matchesApollo(l, apolloFilter)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [leads, q, haystacks, sourceFilter, tierFilter, sequenceFilter, apolloFilter, state]);

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
  useEffect(() => { setPage(1); }, [search, sourceFilter, tierFilter, apolloFilter, sequenceFilter]);

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
        </div>
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
          <div className="toolbar-spacer" />
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            {filtered.length.toLocaleString()} of {leads.length.toLocaleString()} shown
          </span>
        </div>
      </div>

      <div className="table-card">
        <table className="data-table">
          <thead>
            <tr>
              <th>Company</th><th>Contact</th><th>Scanner</th><th>Tier</th>
              <th>Product line</th><th>Apollo</th><th>Calls</th><th>Seen</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((l) => {
              const a = l.apollo;
              const summary = outcomeSummary(a);
              return (
                <tr key={l.key}>
                  <td><b>{l.company || "—"}</b></td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {l.contact || "—"}
                    {l.email && <div style={{ fontSize: 11, color: "var(--muted)" }}>{l.email}</div>}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>{LEAD_SOURCE_META[l.source].short}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{l.tier || "—"}</td>
                  <td>{l.productArea || "—"}</td>
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
    </>
  );
}
