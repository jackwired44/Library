// Home: the whole pipeline as a dashboard.
//
// Per Jack: "make a detailed home page overseeing it all", then "redo the
// metrics part make it more like power bi", "want this clearer for
// visibility." Built to the dataviz method (see components/charts.tsx):
// one slicer row on top that scopes EVERY visual, a KPI row, then a grid
// of chart cards, each with values at the bar ends, a hover tooltip and a
// table view.
//
// Read-only. Every number is computed from state App already holds (plus
// the Custom/CSP run records), so this page adds no data path and cannot
// disagree with the screens it summarises. Apollo-derived numbers are only
// as fresh as the last sync, so the sync's age is stated beside them.
import { useEffect, useMemo, useState } from "react";
import { LEAD_SOURCE_META, hasActiveSequence, type LeadSource, type StoredLead } from "../lib/leadStore";
import { TOP_TIERS, groupByPlan, holdReason, type RoutingRules } from "../lib/sequenceRouting";
import { buildSizeBands } from "../lib/campaignExport";
import { MIN_EMPLOYEES } from "../lib/leadQualify";
import { syncAgeDays, SYNC_STALE_DAYS } from "../lib/apolloSync";
import { realSteps, type ApolloFunnel } from "../lib/apolloFunnel";
import { loadRuns, type Run2 } from "../lib/scanner2";
import type { HistoryEntry } from "../lib/history";
import {
  normalizeCompanyKey, profileForCompany, type CompanyProfile,
} from "../lib/companyProfiles";
import type { View } from "../App";
import {
  STAGE_META, STATUS_META, STATUS_ORDER, statusOf, wasReached, type LeadStatus,
} from "../lib/leadStatus";
import { isIntentDate } from "../lib/noteDates";
import { LEVEL_META, LEVEL_ORDER, titleLevel } from "../lib/titleLevel";
import {
  BarList, ChartCard, ColumnChart, KpiTile, StackedBars, compact, type BarRow,
} from "./charts";
import type { LeadsPreset } from "./AllLeads";

const DAY = 86_400_000;

type Range = "all" | "7" | "30" | "90" | "month" | "ytd";
const RANGE_LABEL: Record<Range, string> = {
  all: "All time", "7": "Last 7 days", "30": "Last 30 days", "90": "Last 90 days", month: "This month", ytd: "This year",
};
type Line = "all" | "Dynamics 365" | "M365 / Azure" | "none";
const LINE_LABEL: Record<Line, string> = {
  all: "All", "Dynamics 365": "Dynamics 365", "M365 / Azure": "M365 / Azure", none: "No product line",
};

/** When a lead arrived: the file's own date, else when it was uploaded. */
const arrived = (l: StoredLead) => l.receivedOn || l.firstSeenAt.slice(0, 10);

function rangeStart(r: Range, now = new Date()): string | null {
  if (r === "all") return null;
  const d = new Date(now);
  if (r === "month") return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  if (r === "ytd") return `${d.getFullYear()}-01-01`;
  d.setDate(d.getDate() - Number(r));
  return d.toISOString().slice(0, 10);
}

/** Monday of the week a date falls in, as YYYY-MM-DD, in local time. */
function weekOf(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  const dow = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dow);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const shortDate = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });

function greeting(d = new Date()) {
  const h = d.getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

function Seg<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: Record<T, string>; onChange: (v: T) => void;
}) {
  // Label and buttons wrap as one unit, so a label never strands at the
  // end of a line apart from its options.
  return (
    <span className="viz-slicer">
      <span className="viz-slicer-label">{label}</span>
      <span className="viz-seg-group" role="group" aria-label={label}>
        {(Object.keys(options) as T[]).map((k) => (
          <button key={k} aria-pressed={value === k} onClick={() => onChange(k)}>{options[k]}</button>
        ))}
      </span>
    </span>
  );
}

interface UploadRow { at: string; source: LeadSource; files: string; rows: number; top: number }

export default function Overview({
  leads, funnels, historyEntries, companyProfiles, rules, onNavigate, onOpenStatus, onOpenPreset,
}: {
  leads: StoredLead[];
  funnels: ApolloFunnel[];
  historyEntries: HistoryEntry[];
  companyProfiles: CompanyProfile[];
  rules: RoutingRules;
  onNavigate: (view: View) => void;
  /** Open All leads filtered to one status. */
  onOpenStatus: (status: LeadStatus) => void;
  /** Open All leads on one of its named views. */
  onOpenPreset: (preset: LeadsPreset) => void;
}) {
  const [runs, setRuns] = useState<Run2[]>([]);
  useEffect(() => {
    Promise.all([loadRuns("smc"), loadRuns("csp")])
      .then(([a, b]) => setRuns([...a, ...b]))
      .catch(() => setRuns([]));
  }, []);

  // Slicers. Each one scopes every visual on the page.
  const [range, setRange] = useState<Range>("all");
  const [source, setSource] = useState<LeadSource | "all">("all");
  const [line, setLine] = useState<Line>("all");

  const start = rangeStart(range);
  const matchesDims = (l: StoredLead) =>
    (source === "all" || l.source === source) &&
    (line === "all" || (line === "none" ? !l.productArea : l.productArea === line));

  // Before the date slicer — the weekly trend needs the context weeks too.
  const dimScoped = useMemo(() => leads.filter(matchesDims),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [leads, source, line]);
  const scoped = useMemo(
    () => (start ? dimScoped.filter((l) => arrived(l) >= start) : dimScoped),
    [dimScoped, start],
  );
  const filtered = range !== "all" || source !== "all" || line !== "all";

  const sizeBands = useMemo(() => buildSizeBands(scoped, companyProfiles, MIN_EMPLOYEES), [scoped, companyProfiles]);
  const ageDays = useMemo(() => syncAgeDays(leads), [leads]);
  const synced = ageDays !== null;

  const m = useMemo(() => {
    const status = Object.fromEntries(STATUS_ORDER.map((s) => [s, 0])) as Record<LeadStatus, number>;
    const contact = { none: 0, uncalled: 0, unreached: 0, reached: 0, meeting: 0, no: 0 };
    const bySource: Record<LeadSource, number[]> = { main: [0, 0, 0], smc: [0, 0, 0], csp: [0, 0, 0] };
    const industries = new Map<string, number>();
    const levels = Object.fromEntries(LEVEL_ORDER.map((x) => [x, 0])) as Record<string, number>;
    let top = 0, active = 0, reached = 0, meetings = 0, waitingRule = 0, notEnriched = 0;
    let topUncontacted = 0, topUnreached = 0;
    const today = new Date().toISOString().slice(0, 10);
    const months = new Map<string, number>();
    const byCompany = new Map<string, string>();

    for (const l of scoped) {
      const s = statusOf(l);
      status[s]++;
      levels[titleLevel(l.title)]++;
      const a = l.apollo;
      if (!a) contact.none++;
      else if (s === "meeting") contact.meeting++;
      else if (s === "not-interested") contact.no++;
      else if (wasReached(a)) contact.reached++;
      else if (a.callCount > 0) contact.unreached++;
      else contact.uncalled++;
      if (hasActiveSequence(l)) active++;
      if (a && wasReached(a)) reached++;
      if (s === "meeting") meetings++;

      // Each lead counts once, in the month of its SOONEST upcoming date.
      const next = (l.noteDates ?? []).filter((d) => isIntentDate(d) && d.iso && d.iso >= today)
        .sort((x, y) => x.iso!.localeCompare(y.iso!))[0];
      if (next) months.set(next.iso!.slice(0, 7), (months.get(next.iso!.slice(0, 7)) || 0) + 1);

      if (!TOP_TIERS.has(l.tier)) continue;
      top++;
      if ((a?.callCount ?? 0) === 0) topUncontacted++;
      else if (!wasReached(a)) topUnreached++;
      const li = l.productArea === "Dynamics 365" ? 0 : l.productArea === "M365 / Azure" ? 1 : 2;
      bySource[l.source][li]++;
      const ck = normalizeCompanyKey(l.company);
      let ind = byCompany.get(ck);
      if (ind === undefined) {
        const p = companyProfiles.length ? profileForCompany(companyProfiles, ck, [l.email]) : null;
        ind = (p?.industry || "").trim();
        byCompany.set(ck, ind);
      }
      if (ind) industries.set(ind, (industries.get(ind) || 0) + 1); else notEnriched++;
      const r = holdReason(l, rules, sizeBands.get(l.key));
      if (!l.plan && r === "no-rule") waitingRule++;
    }
    return { status, contact, bySource, industries, levels, top, active, reached, meetings, waitingRule, notEnriched, months, topUncontacted, topUnreached };
  }, [scoped, companyProfiles, rules, sizeBands]);

  const groups = useMemo(() => groupByPlan(scoped), [scoped]);
  const queued = groups.reduce((a, g) => a + g.queued.length, 0);
  const exported = groups.reduce((a, g) => a + g.exported.length, 0);

  // 12 weeks of arrivals, ending this week.
  const weeks = useMemo(() => {
    const thisWeek = weekOf(new Date().toISOString().slice(0, 10));
    const keys: string[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(`${thisWeek}T12:00:00`);
      d.setDate(d.getDate() - i * 7);
      keys.push(weekOf(d.toISOString().slice(0, 10)));
    }
    const counts = new Map(keys.map((k) => [k, 0]));
    for (const l of dimScoped) {
      const w = weekOf(arrived(l));
      if (counts.has(w)) counts.set(w, counts.get(w)! + 1);
    }
    return keys.map((k) => ({ key: k, label: shortDate(k), long: `Week of ${shortDate(k)}`, value: counts.get(k)! }));
  }, [dimScoped]);

  const nextMonths = useMemo(() => {
    const out: { key: string; label: string; long: string; value: number }[] = [];
    const d = new Date(); d.setDate(1);
    for (let i = 0; i < 6; i++) {
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const dt = new Date(`${k}-15T12:00:00`);
      out.push({ key: k, label: dt.toLocaleDateString(undefined, { month: "short" }), long: dt.toLocaleDateString(undefined, { month: "long", year: "numeric" }), value: m.months.get(k) || 0 });
      d.setMonth(d.getMonth() + 1);
    }
    return out;
  }, [m.months]);
  const laterDates = [...m.months.entries()].filter(([k]) => k > nextMonths[nextMonths.length - 1].key).reduce((a, [, v]) => a + v, 0);

  const statusRows: BarRow[] = STATUS_ORDER.map((s) => ({
    key: s, label: STATUS_META[s].label, value: m.status[s], group: STAGE_META[STATUS_META[s].stage].label,
    hint: `${STATUS_META[s].label} — click to open these leads`, onClick: () => onOpenStatus(s),
  }));

  const contactRows: BarRow[] = [
    { key: "meeting", label: "Meeting booked", value: m.contact.meeting },
    { key: "reached", label: "Reached", value: m.contact.reached },
    { key: "no", label: "Reached — not interested", value: m.contact.no },
    { key: "unreached", label: "Called, never reached", value: m.contact.unreached },
    { key: "uncalled", label: "In Apollo, never called", value: m.contact.uncalled },
    { key: "none", label: "No Apollo record", value: m.contact.none },
  ];

  const industryRows: BarRow[] = [...m.industries.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([k, v]) => ({ key: k, label: k, value: v }));

  const levelRows: BarRow[] = LEVEL_ORDER.map((x) => ({ key: x, label: LEVEL_META[x].label, value: m.levels[x] }));

  const sourceRows = (["main", "smc", "csp"] as LeadSource[]).map((s) => ({
    key: s, label: LEAD_SOURCE_META[s].label, parts: m.bySource[s],
  }));
  const LINE_SERIES = ["Dynamics 365", "M365 / Azure", "No product line"];

  const queueRows = groups.slice(0, 8).map((g) => ({ key: g.sequence, label: g.sequence, parts: [g.queued.length, g.exported.length] }));

  const liveSeq: BarRow[] = funnels
    .filter((f) => f.live !== false)
    .map((f) => ({
      key: f.name, label: f.name, value: f.totals?.delivered ?? 0,
      hint: (() => {
        const steps = realSteps(f);
        const fin = steps.reduce((a, s) => a + s.finished, 0);
        const worst = steps.reduce<null | (typeof steps)[number]>((w, x) => (!w || x.finished > w.finished ? x : w), null);
        return `${f.name}${f.totals?.replied != null ? ` · ${f.totals.replied} replied` : ""}${worst && fin ? ` · most drop at step ${worst.position}` : ""}`;
      })(),
    }))
    .sort((a, b) => b.value - a.value).slice(0, 8);

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

  const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : "0%");
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const syncNote = !synced ? "Apollo not synced" : `Apollo synced ${ageDays === 0 ? "today" : `${ageDays}d ago`}${ageDays! > SYNC_STALE_DAYS ? " — stale" : ""}`;
  const scopeNote = filtered
    ? `${scoped.length.toLocaleString()} of ${leads.length.toLocaleString()} leads in view`
    : `${leads.length.toLocaleString()} leads`;
  const enrichedPct = m.top ? Math.round(((m.top - m.notEnriched) / m.top) * 100) : 0;
  const weekNew = leads.filter((l) => Date.now() - Date.parse(l.firstSeenAt) <= 7 * DAY).length;

  return (
    <div className="home viz-root">
      <div className="page-head">
        <div>
          <h2>{greeting()}, Jack.</h2>
          <p className="page-sub">{today} · {scopeNote} · {syncNote}</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-sm btn-secondary" onClick={() => onNavigate("scanner")}>⬆ Upload leads</button>
          <button className="btn btn-sm btn-primary" onClick={() => onNavigate(queued ? "queue" : "allleads")}>
            {queued ? `Apollo queue (${queued.toLocaleString()}) →` : "All leads →"}
          </button>
        </div>
      </div>

      {/* Slicers: one row, scoping everything below. */}
      <div className="viz-slicers">
        <Seg label="Received" value={range} options={RANGE_LABEL} onChange={setRange} />
        <Seg label="Scanner" value={source}
             options={{ all: "All", main: "Main", smc: "Custom", csp: "CSP" } as Record<LeadSource | "all", string>}
             onChange={setSource} />
        <Seg label="Product line" value={line} options={LINE_LABEL} onChange={setLine} />
        {filtered && (
          <button className="btn btn-sm btn-ghost" style={{ marginLeft: "auto" }}
                  onClick={() => { setRange("all"); setSource("all"); setLine("all"); }}>Reset</button>
        )}
      </div>

      {leads.length === 0 ? (
        <div className="calm-state">
          <div className="calm-title">Upload your first leads</div>
          <div className="calm-body">Every lead scanned from here on is stored, qualified and routed to a sequence — this page fills in as you go.</div>
        </div>
      ) : (
        <>
          <div className="viz-kpis">
            <KpiTile label="Leads" value={compact(scoped.length)}
                     sub={filtered ? `of ${leads.length.toLocaleString()} stored` : `${weekNew.toLocaleString()} new in the last 7 days`}
                     trend={weeks.map((w) => w.value)} onClick={() => onNavigate("allleads")} />
            <KpiTile label="Top tier" value={compact(m.top)} sub={`${pct(m.top, scoped.length)} of leads in view`}
                     onClick={() => onOpenStatus("qualified")} />
            <KpiTile label="Strong signal · never contacted" value={compact(m.topUncontacted)}
                     sub={synced ? "top tier, no call logged" : "top tier · no Apollo sync yet, so none are known called"}
                     onClick={() => onOpenPreset("top-uncontacted")} />
            <KpiTile label="Strong signal · tried, not reached" value={synced ? compact(m.topUnreached) : "—"} tone={synced ? undefined : "muted"}
                     sub={synced ? "called, only no answer / voicemail" : "needs an Apollo sync"}
                     onClick={() => onOpenPreset("top-unreached")} />
            <KpiTile label="Queued for Apollo" value={compact(queued)}
                     sub={m.waitingRule ? `${m.waitingRule.toLocaleString()} more waiting on a rule` : `across ${groups.filter((g) => g.queued.length).length} sequences`}
                     onClick={() => onNavigate("queue")} />
            <KpiTile label="Sent to Apollo" value={compact(exported)} sub="exported in a file" onClick={() => onNavigate("queue")} />
            <KpiTile label="In a sequence now" value={synced ? compact(m.active) : "—"} tone={synced ? undefined : "muted"}
                     sub={synced ? "active in Apollo" : "needs an Apollo sync"} onClick={() => onOpenStatus("in-sequence")} />
            <KpiTile label="Reached" value={synced ? compact(m.reached) : "—"} tone={synced ? undefined : "muted"}
                     sub={synced ? `${m.meetings.toLocaleString()} meeting${m.meetings === 1 ? "" : "s"} booked` : "needs an Apollo sync"}
                     onClick={() => onOpenStatus("reached")} />
          </div>

          <div className="viz-grid">
            <ChartCard
              title="Leads received per week"
              sub={`Last 12 weeks, by the file's own date (else upload date)${range !== "all" ? ` · ${RANGE_LABEL[range].toLowerCase()} highlighted` : ""}`}
              table={{ head: ["Week of", "Leads"], rows: weeks.map((w) => [w.label, w.value]) }}
            >
              <ColumnChart points={weeks} highlightFrom={start ? weekOf(start) : undefined} />
            </ChartCard>

            <ChartCard
              title="Where every lead stands"
              sub="Status, grouped by stage · click a bar to open those leads"
              table={{ head: ["Stage", "Status", "Leads"], rows: statusRows.map((r) => [r.group!, r.label, r.value]) }}
            >
              <BarList rows={statusRows} />
            </ChartCard>

            <ChartCard
              title="Contact coverage"
              sub={synced ? `Has anyone got through? · ${syncNote}` : "Has anyone got through? · fills in once an Apollo sync is imported"}
              table={{ head: ["Outcome", "Leads"], rows: contactRows.map((r) => [r.label, r.value]) }}
            >
              <BarList rows={contactRows} max={scoped.length} />
            </ChartCard>

            <ChartCard
              title="Top-tier leads by scanner"
              sub="High priority / Strong Signal, split by product line"
              table={{ head: ["Scanner", ...LINE_SERIES, "Total"], rows: sourceRows.map((r) => [r.label, ...r.parts, r.parts.reduce((a, b) => a + b, 0)]) }}
            >
              <StackedBars rows={sourceRows} series={LINE_SERIES} />
            </ChartCard>

            <ChartCard
              title="Apollo queue by sequence"
              sub={groups.length ? "Queued to export vs already sent" : "Nothing routed yet — set a rule in the Apollo queue"}
              table={{ head: ["Sequence", "Queued", "Sent"], rows: groups.map((g) => [g.sequence, g.queued.length, g.exported.length]) }}
              action={<button className="viz-toggle" onClick={() => onNavigate("queue")}>Open</button>}
            >
              {queueRows.length ? <StackedBars rows={queueRows} series={["Queued", "Sent to Apollo"]} />
                : <div className="viz-empty">No leads queued yet.</div>}
            </ChartCard>

            <ChartCard
              title="Dates coming up in the notes"
              sub={`Leads by the month of their next renewal, close, timeline or meeting${laterDates ? ` · ${laterDates.toLocaleString()} more after ${nextMonths[nextMonths.length - 1].long}` : ""}`}
              table={{ head: ["Month", "Leads"], rows: nextMonths.map((p) => [p.long, p.value]) }}
            >
              <ColumnChart points={nextMonths} height={160}
                           empty="None of the leads in view mention an upcoming date in their notes." />
            </ChartCard>

            <ChartCard
              title="Top industries"
              sub={`Top-tier leads with an enriched company · ${enrichedPct}% enriched, ${m.notEnriched.toLocaleString()} not yet`}
              table={{ head: ["Industry", "Leads"], rows: industryRows.map((r) => [r.label, r.value]) }}
            >
              <BarList rows={industryRows} empty="No enriched companies yet — enrich from the Scanner to fill this in." />
            </ChartCard>

            <ChartCard
              title="Who the leads are"
              sub="Position read from each contact's job title"
              table={{ head: ["Position", "Leads"], rows: levelRows.map((r) => [r.label, r.value]) }}
            >
              <BarList rows={levelRows} />
            </ChartCard>

            <ChartCard
              title="Live Apollo sequences"
              sub={funnels.length ? "Emails delivered per sequence, from the last funnel import · hover for replies and drop-off" : "Import the step funnel on Sequences to fill this in"}
              table={{ head: ["Sequence", "Delivered"], rows: liveSeq.map((r) => [r.label, r.value]) }}
              action={<button className="viz-toggle" onClick={() => onNavigate("campaigns")}>Open</button>}
            >
              <BarList rows={liveSeq} empty="No funnel imported yet." />
            </ChartCard>

            <ChartCard title="Recent uploads" sub="All three scanners"
                       action={<button className="viz-toggle" onClick={() => onNavigate("history")}>History</button>}>
              {uploads.length === 0 ? <div className="viz-empty">No uploads yet.</div> : (
                <table className="viz-table">
                  <thead><tr><th>When</th><th>Scanner</th><th>File</th><th style={{ textAlign: "right" }}>Rows</th><th style={{ textAlign: "right" }}>Top tier</th></tr></thead>
                  <tbody>
                    {uploads.map((u, i) => (
                      <tr key={i}>
                        <td style={{ whiteSpace: "nowrap" }}>{u.at.slice(0, 10)}</td>
                        <td>{LEAD_SOURCE_META[u.source].short}</td>
                        <td style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={u.files}>{u.files}</td>
                        <td style={{ textAlign: "right" }}>{u.rows.toLocaleString()}</td>
                        <td style={{ textAlign: "right", fontWeight: 650 }}>{u.top.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </ChartCard>
          </div>
        </>
      )}
    </div>
  );
}
