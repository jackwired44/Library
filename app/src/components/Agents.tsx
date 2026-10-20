// The ten platform agents: what each one does, its latest report, and Jack's
// approvals and pauses.
//
// Per Jack: "i want to see a overview of the agents and their work so make a
// tab at the bottom left so i can view them and there work approve stuff and
// pause". The agents run in Claude Code (/platform-review), not inside this
// page, so the page cannot start or stop them. What it does:
//   - shows each agent's job and rules, and its latest report, bundled in at
//     build time (scripts/agents-sync.cjs -> agents.generated.json);
//   - records Jack's Approve / Decline per question and Pause / Resume per
//     agent in this browser;
//   - hands those decisions back to Claude as a short block to paste, which
//     /platform-review reads (skips paused agents, acts only on approved
//     items).
import { useMemo, useState } from "react";
import data from "../agents.generated.json";

interface Finding { severity?: string; text: string; where?: string }
interface Question { id: string; text: string; options?: string[]; recommendation?: string }
interface Report { agent?: string; at?: string; status?: string; summary?: string; findings?: Finding[]; questions?: Question[]; checked?: string[] }
interface AgentDef { name: string; description: string; tools: string[]; scope: string; report: Report | null }
interface Bundle { generatedAt: string; standingRules: string; state: { paused?: string[]; acted?: string[] }; agents: AgentDef[] }

const bundle = data as unknown as Bundle;
const KEY = "agentDecisions";

interface Decisions {
  /** Pause/resume as Jack set it here; absent = whatever the repo state says. */
  paused: Record<string, boolean>;
  /** question id -> "approve" | "decline" | a chosen option. */
  answers: Record<string, { choice: string; at: string }>;
}
function load(): Decisions {
  try { const v = JSON.parse(localStorage.getItem(KEY) || ""); return { paused: v.paused || {}, answers: v.answers || {} }; }
  catch { return { paused: {}, answers: {} }; }
}
function save(d: Decisions) { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* storage unavailable */ } }

const STATUS: Record<string, { label: string; color: string; bg: string }> = {
  green: { label: "Green", color: "#0E7A72", bg: "#E3F3F1" },
  findings: { label: "Findings", color: "#9A5B22", bg: "#FBF0E2" },
  blocked: { label: "Blocked", color: "#B5443B", bg: "#FBEAE8" },
  none: { label: "No report yet", color: "#5B6B72", bg: "#EEF1F2" },
  paused: { label: "Paused", color: "#5B6B72", bg: "#EEF1F2" },
};
const SEV: Record<string, string> = { high: "#B5443B", medium: "#9A5B22", low: "#5B6B72" };

const qKey = (agent: string, q: Question) => `${agent}/${q.id}`;
const repoPaused = new Set(bundle.state.paused ?? []);
const acted = new Set(bundle.state.acted ?? []);

export default function Agents() {
  const [d, setD] = useState<Decisions>(load);
  const [open, setOpen] = useState<string | null>(null);
  const [copied, setCopied] = useState("");
  const update = (next: Decisions) => { setD(next); save(next); };
  const isPaused = (name: string) => (name in d.paused ? d.paused[name] : repoPaused.has(name));

  const open_q = useMemo(() => bundle.agents.flatMap((a) => (a.report?.questions ?? [])
    .filter((q) => !acted.has(qKey(a.name, q))).map((q) => ({ a, q }))), []);
  const pending = open_q.filter(({ a, q }) => !d.answers[qKey(a.name, q)]).length;

  const block = useMemo(() => {
    const lines: string[] = [];
    const pauses = bundle.agents.filter((a) => a.name in d.paused && d.paused[a.name] !== repoPaused.has(a.name));
    for (const a of pauses) lines.push(`${d.paused[a.name] ? "Pause" : "Resume"}: ${a.name}`);
    for (const { a, q } of open_q) {
      const ans = d.answers[qKey(a.name, q)];
      if (!ans) continue;
      lines.push(`${ans.choice === "approve" ? "Approve" : ans.choice === "decline" ? "Decline" : `Choose "${ans.choice}"`}: ${qKey(a.name, q)} — ${q.text}`);
    }
    return lines.length ? `Agent decisions from the Vault (${new Date().toISOString().slice(0, 10)}):\n${lines.join("\n")}` : "";
  }, [d, open_q]);

  async function copy() {
    if (!block) return;
    try { await navigator.clipboard.writeText(block); setCopied("Copied. Paste it to Claude with /platform-review."); }
    catch { setCopied("Couldn't copy here. Select the text below and copy it."); }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Agents</h2>
          <div className="muted" style={{ fontSize: 13, maxWidth: 760 }}>
            Ten report-only agents keep watch over the scanners, notes, Apollo connection, sequences, lists, data and tests.
            They run in Claude Code with <b>/platform-review</b>. They never change anything, never write to Apollo, and every
            decision comes to you. Reports here are from the last time the Vault was built ({bundle.generatedAt.slice(0, 10)}).
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {pending > 0 && <span className="pill" style={{ color: "#9A5B22", background: "#FBF0E2" }}>{pending} waiting on you</span>}
          <button className="btn btn-sm btn-primary" disabled={!block} onClick={() => void copy()} title="Your approvals and pauses, as a short block to paste into Claude">
            Copy decisions for Claude
          </button>
        </div>
      </div>
      {copied && <div role="status" className="muted" style={{ fontSize: 12.5, marginBottom: 8 }}>{copied}</div>}
      {block && <textarea readOnly aria-label="Decisions for Claude" value={block} className="field" style={{ width: "100%", minHeight: 70, fontFamily: "var(--font-mono, monospace)", fontSize: 12, marginBottom: 12 }} />}

      <div className="table-card" style={{ marginBottom: 14 }}>
        <table className="data-table" aria-label="Agents overview">
          <thead><tr><th>Agent</th><th>Job</th><th>Status</th><th>Last report</th><th className="num">Findings</th><th className="num">Questions</th><th></th></tr></thead>
          <tbody>
            {bundle.agents.map((a) => {
              const paused = isPaused(a.name);
              const st = paused ? STATUS.paused : STATUS[(a.report?.status || "none").toLowerCase()] ?? STATUS.none;
              const qs = (a.report?.questions ?? []).filter((q) => !acted.has(qKey(a.name, q)));
              return (
                <tr key={a.name} aria-label={`Agent ${a.name}`}>
                  <td style={{ fontWeight: 600, whiteSpace: "nowrap" }}>
                    <button className="btn btn-sm btn-ghost" onClick={() => setOpen(open === a.name ? null : a.name)} aria-expanded={open === a.name}>{open === a.name ? "▾" : "▸"}</button> {a.name}
                  </td>
                  <td style={{ fontSize: 12.5, maxWidth: 420 }}>{a.description}</td>
                  <td><span className="pill" style={{ color: st.color, background: st.bg }}>{st.label}</span></td>
                  <td style={{ fontSize: 12, whiteSpace: "nowrap" }}>{a.report?.at ? a.report.at.slice(0, 10) : "—"}</td>
                  <td className="num">{a.report?.findings?.length ?? 0}</td>
                  <td className="num">{qs.length}</td>
                  <td>
                    <button className="btn btn-sm btn-secondary" aria-label={`${paused ? "Resume" : "Pause"} ${a.name}`}
                            onClick={() => update({ ...d, paused: { ...d.paused, [a.name]: !paused } })}>
                      {paused ? "▶ Resume" : "⏸ Pause"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {open && (() => {
        const a = bundle.agents.find((x) => x.name === open)!;
        const r = a.report;
        return (
          <div className="panel" aria-label={`${a.name} detail`} style={{ padding: "12px 16px", marginBottom: 14 }}>
            <h3 style={{ margin: "0 0 6px", fontSize: 15 }}>{a.name}</h3>
            {r?.summary && <p style={{ margin: "0 0 8px", fontSize: 13 }}>{r.summary}</p>}
            {(r?.findings ?? []).length > 0 && (
              <>
                <div className="section-label">Findings</div>
                <ul style={{ margin: "4px 0 10px", paddingLeft: 18, fontSize: 13 }}>
                  {r!.findings!.map((f, i) => (
                    <li key={i}><b style={{ color: SEV[(f.severity || "").toLowerCase()] || "inherit" }}>{f.severity || "note"}</b> {f.text}{f.where && <span className="muted"> — {f.where}</span>}</li>
                  ))}
                </ul>
              </>
            )}
            {(r?.questions ?? []).length > 0 && (
              <>
                <div className="section-label">Needs your decision</div>
                {r!.questions!.map((q) => {
                  const k = qKey(a.name, q); const ans = d.answers[k];
                  const done = acted.has(k);
                  const set = (choice: string) => update({ ...d, answers: { ...d.answers, [k]: { choice, at: new Date().toISOString() } } });
                  return (
                    <div key={k} aria-label={`Question ${k}`} style={{ borderTop: "1px solid var(--border)", padding: "8px 0", fontSize: 13 }}>
                      <div>{q.text}</div>
                      {q.recommendation && <div className="muted" style={{ fontSize: 12 }}>Recommended: {q.recommendation}</div>}
                      {done ? <div className="pill" style={{ marginTop: 4 }}>Done</div> : (
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                          {(q.options?.length ? q.options : ["approve", "decline"]).map((o) => (
                            <button key={o} className={`btn btn-sm ${ans?.choice === o ? "btn-primary" : "btn-secondary"}`} onClick={() => set(o)}>
                              {o === "approve" ? "✓ Approve" : o === "decline" ? "✕ Decline" : o}
                            </button>
                          ))}
                          {ans && <button className="btn btn-sm btn-ghost" onClick={() => { const next = { ...d.answers }; delete next[k]; update({ ...d, answers: next }); }}>Undo</button>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            )}
            {(r?.checked ?? []).length > 0 && <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>Checked and fine: {r!.checked!.join(" · ")}</div>}
            {!r && <p className="muted" style={{ fontSize: 13 }}>No report yet. Run <b>/platform-review</b> in Claude Code, then rebuild the Vault.</p>}
            <details style={{ marginTop: 10 }}>
              <summary style={{ cursor: "pointer", fontSize: 12.5 }}>What this agent checks, and its rules</summary>
              <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, margin: "8px 0 0" }}>{a.scope}</pre>
              <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, margin: "8px 0 0" }}>{bundle.standingRules}</pre>
              <div className="muted" style={{ fontSize: 12 }}>Tools: {a.tools.join(", ")}</div>
            </details>
          </div>
        );
      })()}
    </div>
  );
}
