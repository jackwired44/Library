// Diagnostics — does every number add up, and where is work leaking.
// Per Jack: "make sure a diagnostic is ran so i can see where
// inefficiencies are to improve metrics … numericals to match and be
// mapped properly". Runs on open and on demand; read-only.
import { useMemo, useState } from "react";
import type { StoredLead } from "../lib/leadStore";
import type { LeadList } from "../lib/leadLists";
import type { RosterIndex } from "../lib/apolloRoster";
import { runDiagnostics } from "../lib/diagnostics";
import { STATUS_META as STANDING_META, STATUS_ORDER as STANDING_ORDER } from "./ApolloStatus";

const SEV = {
  high: { color: "#B5443B", bg: "#FBEAE8", label: "High" },
  medium: { color: "#9A5B22", bg: "#FBF0E2", label: "Medium" },
  low: { color: "#4C6167", bg: "#EEF1F2", label: "Low" },
} as const;
const VIEW_LABEL = { allleads: "All leads", queue: "In Apollo", lists: "Lists", scanner: "Scanner" } as const;

export default function Diagnostics({ leads, apolloIndex, lists, onNavigate }: {
  leads: StoredLead[];
  apolloIndex: RosterIndex | null;
  lists: LeadList[];
  onNavigate: (view: "allleads" | "queue" | "lists" | "scanner") => void;
}) {
  const [runs, setRuns] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const d = useMemo(() => runDiagnostics(leads, apolloIndex, lists), [leads, apolloIndex, lists, runs]);
  const failed = d.checks.filter((c) => !c.ok);
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");
  const fmt = (x: number) => x.toLocaleString();

  return (
    <div>
      <div className="page-head">
        <div>
          <h2 style={{ margin: 0 }}>Diagnostics</h2>
          <div className="muted" style={{ fontSize: 12.5 }}>
            Every count on the platform checked against every other, and where leads are leaking. Ran {d.ranAt.slice(11, 16)} UTC in {d.ms} ms over {fmt(d.totals.leads)} leads.
          </div>
        </div>
        <button className="btn btn-secondary" onClick={() => setRuns((x) => x + 1)}>↻ Run again</button>
      </div>

      <div className="panel" aria-label="Diagnostic checks" style={{ marginBottom: 12 }}>
        <div className="panel-head">
          <strong>{failed.length ? `${failed.length} of ${d.checks.length} checks failed` : `All ${d.checks.length} checks pass — the numbers match`}</strong>
        </div>
        <table className="data-table">
          <thead><tr><th style={{ width: 40 }}></th><th>Check</th><th>Numbers</th></tr></thead>
          <tbody>
            {d.checks.map((c) => (
              <tr key={c.id} data-check={c.id}>
                <td style={{ color: c.ok ? "#1F7A4D" : "#B5443B", fontWeight: 700 }}>{c.ok ? "✓" : "✕"}</td>
                <td>{c.label}</td>
                <td className="muted" style={{ fontSize: 12.5 }}>{c.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel" aria-label="Where leads are leaking" style={{ marginBottom: 12 }}>
        <div className="panel-head"><strong>Where leads are leaking</strong><span className="muted" style={{ fontSize: 12 }}> — biggest first within each priority</span></div>
        <table className="data-table">
          <thead><tr><th>Priority</th><th>Gap</th><th style={{ textAlign: "right" }}>Leads</th><th style={{ textAlign: "right" }}>Share</th><th>Fix</th></tr></thead>
          <tbody>
            {[...d.gaps]
              .sort((a, b) => ["high", "medium", "low"].indexOf(a.severity) - ["high", "medium", "low"].indexOf(b.severity) || b.count - a.count)
              .map((g) => (
                <tr key={g.id} data-gap={g.id} style={{ opacity: g.count ? 1 : 0.55 }}>
                  <td><span className="status-pill" style={{ color: SEV[g.severity].color, background: SEV[g.severity].bg }}>{SEV[g.severity].label}</span></td>
                  <td><div style={{ fontWeight: 600 }}>{g.label}</div><div className="muted" style={{ fontSize: 12 }}>{g.hint}</div></td>
                  <td style={{ textAlign: "right", fontWeight: 700 }}>{fmt(g.count)}</td>
                  <td style={{ textAlign: "right" }} className="muted">{pct(g.count, g.of)} of {fmt(g.of)}</td>
                  <td>{g.count > 0 && <button className="btn btn-sm btn-ghost" onClick={() => onNavigate(g.view)}>{VIEW_LABEL[g.view]} →</button>}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <div className="panel" aria-label="Apollo standing totals" style={{ marginBottom: 12 }}>
        <div className="panel-head"><strong>Apollo standing</strong><span className="muted" style={{ fontSize: 12 }}> — the same numbers Home, All leads and In Apollo show</span></div>
        <div className="panel-body" style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 13 }}>
          {STANDING_ORDER.map((k) => (
            <span key={k}><b style={{ color: STANDING_META[k].color }}>{fmt(d.standing[k])}</b> {STANDING_META[k].label}</span>
          ))}
        </div>
      </div>

      <div className="panel" aria-label="File health">
        <div className="panel-head"><strong>By uploaded file</strong><span className="muted" style={{ fontSize: 12 }}> — {fmt(d.totals.files)} files; most Strong Signal left to check first</span></div>
        <div style={{ maxHeight: 420, overflow: "auto" }}>
          <table className="data-table">
            <thead><tr><th>File</th><th style={{ textAlign: "right" }}>Leads</th><th style={{ textAlign: "right" }}>Strong</th><th style={{ textAlign: "right" }}>Apollo known</th><th style={{ textAlign: "right" }}>Needs a sequence</th><th style={{ textAlign: "right" }}>No email or phone</th></tr></thead>
            <tbody>
              {d.files.slice(0, 200).map((f) => (
                <tr key={f.file}>
                  <td style={{ maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={f.file}>{f.file}</td>
                  <td style={{ textAlign: "right" }}>{fmt(f.leads)}</td>
                  <td style={{ textAlign: "right" }}>{fmt(f.strong)}</td>
                  <td style={{ textAlign: "right" }}>{fmt(f.known)} <span className="muted">({pct(f.known, f.leads)})</span></td>
                  <td style={{ textAlign: "right" }}>{fmt(f.needs)}</td>
                  <td style={{ textAlign: "right" }}>{fmt(f.noContact)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
