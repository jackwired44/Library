// Home: the whole pipeline on one screen.
//
// Per Jack: "make a detailed home page overseeing it all", for a platform
// where "i can upload all new leads here and start pre storing them with
// the relevant seuqence to transition to into apollo".
//
// Read-only. Every number is computed from state App already holds (plus
// the Custom/CSP run records, which live in their own store), so this page
// adds no data path and cannot disagree with the screens it summarises.
// The one place it could mislead is Apollo state, which is only as fresh as
// the last sync — so sync age is stated wherever Apollo numbers appear.
import { useEffect, useMemo, useState } from "react";
import { LEAD_SOURCE_META, hasActiveSequence, type LeadSource, type StoredLead } from "../lib/leadStore";
import { TOP_TIERS, groupByPlan, holdReason, type RoutingRules } from "../lib/sequenceRouting";
import { buildSizeBands } from "../lib/campaignExport";
import { MIN_EMPLOYEES } from "../lib/leadQualify";
import { syncAgeDays, SYNC_STALE_DAYS } from "../lib/apolloSync";
import { realSteps, type ApolloFunnel } from "../lib/apolloFunnel";
import { loadRuns, type Run2 } from "../lib/scanner2";
import type { HistoryEntry } from "../lib/history";
import type { CompanyProfile } from "../lib/companyProfiles";
import type { View } from "../App";

const SOURCE_COLOR: Record<LeadSource, string> = { main: "#0E7A72", smc: "#5B3FC4", csp: "#B34A1F" };
const DAY = 86_400_000;

function greeting(d = new Date()) {
  const h = d.getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

function Panel({ title, sub, children, action }: {
  title: string; sub?: string; children: React.ReactNode; action?: React.ReactNode;
}) {
  return (
    <div className="panel" style={{ marginBottom: 12 }}>
      <div className="panel-head" style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <b>{title}</b>
          {sub && <div style={{ fontSize: 12, color: "var(--muted)" }}>{sub}</div>}
        </div>
        {action}
      </div>
      <div className="panel-body">{children}</div>
    </div>
  );
}

/** One horizontal bar with a label and a count, for the funnel. */
function Bar({ label, n, of, color = "var(--brand)", hint }: {
  label: string; n: number; of: number; color?: string; hint?: string;
}) {
  const pct = of > 0 ? Math.max(n > 0 ? 2 : 0, Math.round((n / of) * 100)) : 0;
  return (
    <div style={{ marginBottom: 8 }} title={hint}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
        <span>{label}</span><b style={{ fontVariantNumeric: "tabular-nums" }}>{n.toLocaleString()}</b>
      </div>
      <div style={{ height: 6, background: "var(--surface-sunken)", borderRadius: 3, overflow: "hidden", marginTop: 3 }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color }} />
      </div>
    </div>
  );
}

interface UploadRow { at: string; source: LeadSource; files: string; rows: number; top: number }

export default function Overview({
  leads, funnels, historyEntries, companyProfiles, rules, onNavigate,
}: {
  leads: StoredLead[];
  funnels: ApolloFunnel[];
  historyEntries: HistoryEntry[];
  companyProfiles: CompanyProfile[];
  rules: RoutingRules;
  onNavigate: (view: View) => void;
}) {
  const [runs, setRuns] = useState<Run2[]>([]);
  useEffect(() => {
    Promise.all([loadRuns("smc"), loadRuns("csp")])
      .then(([a, b]) => setRuns([...a, ...b]))
      .catch(() => setRuns([]));
  }, []);

  const now = Date.now();
  const sizeBands = useMemo(() => buildSizeBands(leads, companyProfiles, MIN_EMPLOYEES), [leads, companyProfiles]);
  const groups = useMemo(() => groupByPlan(leads), [leads]);
  const ageDays = useMemo(() => syncAgeDays(leads), [leads]);

  const s = useMemo(() => {
    const bySource: Record<LeadSource, number> = { main: 0, smc: 0, csp: 0 };
    const byTier = new Map<string, number>();
    const byLine = new Map<string, number>();
    let newWeek = 0, top = 0, qualified = 0, inApollo = 0, active = 0, noEmail = 0, unknownSize = 0;
    let waitingRule = 0;
    for (const l of leads) {
      bySource[l.source]++;
      byTier.set(l.tier || "—", (byTier.get(l.tier || "—") || 0) + 1);
      if (now - Date.parse(l.firstSeenAt) <= 7 * DAY) newWeek++;
      if (!l.email) noEmail++;
      if (l.apollo && (l.apollo.sequences.length || l.apollo.callCount)) inApollo++;
      if (hasActiveSequence(l)) active++;
      if (!TOP_TIERS.has(l.tier)) continue;
      top++;
      byLine.set(l.productArea || (l.source === "csp" ? "CSP renewal" : "No product line"),
        (byLine.get(l.productArea || (l.source === "csp" ? "CSP renewal" : "No product line")) || 0) + 1);
      const band = sizeBands.get(l.key);
      if (band === "unknown") unknownSize++;
      const r = holdReason(l, rules, band);
      if (r === null || r === "no-rule") qualified++;
      if (!l.plan && r === "no-rule") waitingRule++;
    }
    return { bySource, byTier, byLine, newWeek, top, qualified, inApollo, active, noEmail, unknownSize, waitingRule };
  }, [leads, sizeBands, rules, now]);

  const queued = groups.reduce((a, g) => a + g.queued.length, 0);
  const exported = groups.reduce((a, g) => a + g.exported.length, 0);

  const uploads: UploadRow[] = useMemo(() => {
    const main: UploadRow[] = historyEntries.map((h) => ({
      at: h.importedAt, source: "main", files: h.fileName, rows: h.rowsScanned,
      top: h.results.filter((r) => r.tier === "signal").length,
    }));
    const other: UploadRow[] = runs.map((r) => ({
      at: r.at, source: r.scanner === "csp" ? "csp" : "smc", files: r.fileNames.join(", "),
      rows: r.rowsRead, top: r.counts.priority ?? 0,
    }));
    return [...main, ...other].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8);
  }, [historyEntries, runs]);

  const liveFunnels = useMemo(
    () => funnels
      .filter((f) => f.live !== false)
      .map((f) => {
        const steps = realSteps(f);
        const worst = steps.reduce<null | (typeof steps)[number]>((w, x) => (!w || x.finished > w.finished ? x : w), null);
        const finished = steps.reduce((a, x) => a + x.finished, 0);
        return { f, worst, finished };
      })
      .sort((a, b) => (b.f.totals?.delivered ?? 0) - (a.f.totals?.delivered ?? 0))
      .slice(0, 6),
    [funnels],
  );

  const today = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const totalTiers = [...s.byTier.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <div className="home">
      <div className="page-head">
        <div>
          <h2>{greeting()}, Jack.</h2>
          <p className="page-sub">{today}</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-sm btn-secondary" onClick={() => onNavigate("scanner")}>⬆ Upload leads</button>
        </div>
      </div>

      {/* The one thing to do next, worded from real state. */}
      <div className="action-band">
        <div>
          {queued > 0 ? (
            <>
              <div className="action-title">{queued.toLocaleString()} lead{queued === 1 ? "" : "s"} ready to go into Apollo</div>
              <div className="action-sub">
                Across {groups.filter((g) => g.queued.length).length} sequence
                {groups.filter((g) => g.queued.length).length === 1 ? "" : "s"}:{" "}
                {groups.filter((g) => g.queued.length).slice(0, 3).map((g) => `${g.sequence} (${g.queued.length})`).join(", ")}
                {groups.filter((g) => g.queued.length).length > 3 ? ", …" : ""}
              </div>
            </>
          ) : s.waitingRule > 0 ? (
            <>
              <div className="action-title">{s.waitingRule.toLocaleString()} qualified leads have no sequence yet</div>
              <div className="action-sub">Set a routing rule for their lead type and they queue automatically.</div>
            </>
          ) : leads.length === 0 ? (
            <>
              <div className="action-title">Upload your first leads</div>
              <div className="action-sub">Every lead scanned from here on is stored, qualified and routed to a sequence.</div>
            </>
          ) : (
            <>
              <div className="action-title">Nothing waiting</div>
              <div className="action-sub">Every qualified lead is queued or exported. Upload more to keep the queue full.</div>
            </>
          )}
        </div>
        <button className="btn btn-primary" onClick={() => onNavigate(leads.length ? "queue" : "scanner")}>
          {leads.length ? "Open Apollo queue →" : "Go to Main Scanner →"}
        </button>
      </div>

      <div className="metric-row">
        <div className="metric">
          <div className="metric-label">Leads stored</div>
          <div className="metric-value">{leads.length.toLocaleString()}</div>
          <div className="metric-hint">{s.newWeek.toLocaleString()} new this week</div>
        </div>
        <div className="metric">
          <div className="metric-label">Top tier</div>
          <div className="metric-value">{s.top.toLocaleString()}</div>
          <div className="metric-hint">High priority / Strong Signal</div>
        </div>
        <div className="metric">
          <div className="metric-label">Queued</div>
          <div className="metric-value">{queued.toLocaleString()}</div>
          <div className="metric-hint">waiting to export</div>
        </div>
        <div className="metric">
          <div className="metric-label">Exported</div>
          <div className="metric-value">{exported.toLocaleString()}</div>
          <div className="metric-hint">sent to Apollo in a file</div>
        </div>
        <div className="metric">
          <div className="metric-label">Active in Apollo</div>
          <div className="metric-value">{ageDays === null ? "—" : s.active.toLocaleString()}</div>
          <div className="metric-hint">
            {ageDays === null ? "not synced yet" : `synced ${ageDays === 0 ? "today" : `${ageDays}d ago`}`}
          </div>
        </div>
      </div>

      <div className="home-cols" style={{ marginTop: 0 }}>
        <div>
          <Panel title="Pipeline" sub="From every lead stored to what has gone to Apollo">
            <Bar label="Stored" n={leads.length} of={leads.length} color="var(--line-strong, #c4d2d6)" />
            <Bar label="Top tier" n={s.top} of={leads.length} hint="High priority on Main and CSP, Strong Signal on Custom." />
            <Bar label="Qualified for a sequence" n={s.qualified} of={leads.length}
                 hint={`Top tier, not already worked in Apollo, and not a confirmed under-${MIN_EMPLOYEES} company.`} />
            <Bar label="Queued" n={queued} of={leads.length} />
            <Bar label="Exported to Apollo" n={exported} of={leads.length} color="var(--success, #2a8a5b)" />
            {s.waitingRule > 0 && (
              <div style={{ fontSize: 12, color: "#9A5B22", marginTop: 6 }}>
                {s.waitingRule.toLocaleString()} qualified leads are not queued because their lead type has no routing rule.{" "}
                <button className="btn btn-sm btn-ghost" onClick={() => onNavigate("queue")}>Set rules</button>
              </div>
            )}
          </Panel>

          <Panel title="Recent uploads" sub="All three scanners" action={
            <button className="btn btn-sm btn-ghost" onClick={() => onNavigate("history")}>History →</button>
          }>
            {uploads.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--muted)" }}>No uploads yet.</div>
            ) : (
              <table className="data-table">
                <thead><tr><th>When</th><th>Scanner</th><th>File</th><th>Rows</th><th>Top tier</th></tr></thead>
                <tbody>
                  {uploads.map((u, i) => (
                    <tr key={i}>
                      <td style={{ whiteSpace: "nowrap", fontSize: 12 }}>{u.at.slice(0, 10)}</td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <span style={{ color: SOURCE_COLOR[u.source], fontWeight: 600 }}>{LEAD_SOURCE_META[u.source].short}</span>
                      </td>
                      <td style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12 }} title={u.files}>
                        {u.files}
                      </td>
                      <td>{u.rows.toLocaleString()}</td>
                      <td><b>{u.top.toLocaleString()}</b></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </div>

        <div>
          <Panel title="Lead mix" sub="Everything stored, by scanner">
            <div className="mix-bar">
              {(["main", "smc", "csp"] as LeadSource[]).map((k) => (
                <span key={k} style={{ width: `${leads.length ? (s.bySource[k] / leads.length) * 100 : 0}%`, background: SOURCE_COLOR[k] }} />
              ))}
            </div>
            <div className="mix-legend" style={{ marginBottom: 12 }}>
              {(["main", "smc", "csp"] as LeadSource[]).map((k) => (
                <span key={k} className="mix-key">
                  <i style={{ background: SOURCE_COLOR[k] }} />{LEAD_SOURCE_META[k].short}<b>{s.bySource[k].toLocaleString()}</b>
                </span>
              ))}
            </div>
            <div className="section-label">Top tier by product line</div>
            {[...s.byLine.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => (
              <Bar key={k} label={k} n={n} of={s.top} />
            ))}
            {s.byLine.size === 0 && <div style={{ fontSize: 12.5, color: "var(--muted)" }}>No top-tier leads yet.</div>}
            <div className="section-label" style={{ marginTop: 12 }}>By tier</div>
            <div style={{ fontSize: 12.5 }}>
              {totalTiers.map(([t, n]) => (
                <div key={t} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}>
                  <span>{t}</span><b style={{ fontVariantNumeric: "tabular-nums" }}>{n.toLocaleString()}</b>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Data health" sub="What still needs filling in">
            <div style={{ fontSize: 12.5, lineHeight: 1.7 }}>
              <div>
                <b>{s.unknownSize.toLocaleString()}</b> top-tier leads with no company headcount
                <span style={{ color: "var(--muted)" }}> — the {MIN_EMPLOYEES}-employee floor isn't applied to them</span>
              </div>
              <div><b>{s.noEmail.toLocaleString()}</b> leads with no email <span style={{ color: "var(--muted)" }}>— Apollo matches on email first</span></div>
              <div>
                <b>{companyProfiles.length.toLocaleString()}</b> companies enriched
              </div>
              <div style={{ color: ageDays !== null && ageDays > SYNC_STALE_DAYS ? "#B5443B" : undefined }}>
                Apollo sync: {ageDays === null ? <b>never run</b> : <b>{ageDays === 0 ? "today" : `${ageDays} days ago`}</b>}
                {ageDays !== null && ageDays > SYNC_STALE_DAYS && " — stale"}
                <span style={{ color: "var(--muted)" }}> — {s.inApollo.toLocaleString()} leads show Apollo history</span>
              </div>
            </div>
          </Panel>
        </div>

        <div>
          <Panel title="Apollo queue" sub="By target sequence" action={
            <button className="btn btn-sm btn-ghost" onClick={() => onNavigate("queue")}>Open →</button>
          }>
            {groups.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--muted)" }}>Nothing routed yet.</div>
            ) : groups.slice(0, 8).map((g) => (
              <div key={g.sequence} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "3px 0", gap: 8 }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.sequence}</span>
                <span style={{ whiteSpace: "nowrap" }}>
                  <b>{g.queued.length}</b><span style={{ color: "var(--muted)" }}> queued · {g.exported.length} sent</span>
                </span>
              </div>
            ))}
          </Panel>

          <Panel title="Campaigns" sub="Live Apollo sequences, from the last funnel import" action={
            <button className="btn btn-sm btn-ghost" onClick={() => onNavigate("campaigns")}>Open →</button>
          }>
            {liveFunnels.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--muted)" }}>No funnel imported yet.</div>
            ) : liveFunnels.map(({ f, worst, finished }) => (
              <div key={f.name} style={{ padding: "5px 0", borderBottom: "1px solid var(--border)", fontSize: 12.5 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <b style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</b>
                  {f.live && <span className="status-pill success">Live</span>}
                </div>
                <div style={{ color: "var(--muted)", fontSize: 12 }}>
                  {f.totals?.delivered != null ? `${f.totals.delivered.toLocaleString()} delivered` : "delivered —"}
                  {f.totals?.replied != null ? ` · ${f.totals.replied} replied` : ""}
                  {worst && finished > 0
                    ? ` · most drop at step ${worst.position} (${Math.round((worst.finished / finished) * 100)}%)`
                    : ""}
                </div>
              </div>
            ))}
          </Panel>
        </div>
      </div>
    </div>
  );
}
