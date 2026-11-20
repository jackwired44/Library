// Archive → Prompts. Saved email prompts with their subject, system prompt,
// user prompt, product area and sequence, and how each one did.
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  PROMPT_PRODUCT_AREAS, PROMPT_VERDICT_META, PROMPT_VERDICT_ORDER,
  deleteEmailPrompt, loadEmailPrompts, newEmailPrompt, saveEmailPrompt,
  type EmailPrompt, type PromptVerdict,
} from "../lib/emailPrompts";
import { MAIN_SEQUENCES } from "./ApolloStatus";
import { confirmAction } from "../lib/confirmBox";

const num = (v: string): number | null => (v.trim() === "" || isNaN(Number(v)) ? null : Number(v));
const show = (v: number | null | undefined, suffix = "") => (v == null ? "—" : `${v}${suffix}`);

async function copy(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
  try {
    const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy"); ta.remove(); return ok;
  } catch { return false; }
}

/** A fresh prompt with the same wording, for testing a variation. */
function copyOf(p: EmailPrompt): EmailPrompt {
  return newEmailPrompt({
    title: `${p.title} (copy)`, productArea: p.productArea, sequence: p.sequence, step: p.step,
    subject: p.subject, systemPrompt: p.systemPrompt, userPrompt: p.userPrompt,
  });
}

export default function EmailPrompts() {
  const [prompts, setPrompts] = useState<EmailPrompt[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [q, setQ] = useState("");
  const [area, setArea] = useState("");
  const [seq, setSeq] = useState("");
  const [verdict, setVerdict] = useState<PromptVerdict | "">("");
  const [editing, setEditing] = useState<EmailPrompt | null>(null);
  const [openId, setOpenId] = useState("");
  const [copied, setCopied] = useState("");

  useEffect(() => { loadEmailPrompts().then((p) => { setPrompts(p); setLoaded(true); }).catch(() => setLoaded(true)); }, []);

  const sequences = useMemo(() => [...new Set([...MAIN_SEQUENCES, ...prompts.map((p) => p.sequence).filter(Boolean)])], [prompts]);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return prompts
      .filter((p) => (!area || p.productArea === area) && (!seq || p.sequence === seq) && (!verdict || p.verdict === verdict))
      .filter((p) => !t || [p.title, p.subject, p.systemPrompt, p.userPrompt, p.notes, p.sequence, p.productArea].join(" ").toLowerCase().includes(t))
      .sort((a, b) => PROMPT_VERDICT_ORDER.indexOf(a.verdict) - PROMPT_VERDICT_ORDER.indexOf(b.verdict) || (b.replyRate ?? -1) - (a.replyRate ?? -1) || b.updatedAt.localeCompare(a.updatedAt));
  }, [prompts, q, area, seq, verdict]);

  async function save(p: EmailPrompt) {
    const next = { ...p, title: p.title.trim() || p.subject.trim() || "Untitled prompt", updatedAt: new Date().toISOString() };
    await saveEmailPrompt(next);
    setPrompts((ps) => [next, ...ps.filter((x) => x.id !== next.id)]);
    setEditing(null); setOpenId(next.id);
  }
  async function remove(p: EmailPrompt) {
    if (!(await confirmAction(`Delete the prompt "${p.title}"? This can't be undone.`))) return;
    await deleteEmailPrompt(p.id);
    setPrompts((ps) => ps.filter((x) => x.id !== p.id));
  }
  async function doCopy(key: string, text: string) { if (await copy(text)) { setCopied(key); setTimeout(() => setCopied(""), 1200); } }

  return (
    <div>
      <div className="page-head">
        <div>
          <h2 className="page-title">Prompts</h2>
          <div className="page-sub">Every email prompt you use: subject, system prompt, user prompt, which product area and sequence it ran in, and how it did.</div>
        </div>
        <button className="btn btn-primary" onClick={() => setEditing(newEmailPrompt())}>+ New prompt</button>
      </div>

      <div className="panel leads-filters">
        <div className="row">
          <input className="field" placeholder="Search prompts, subjects, notes…" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 220, maxWidth: 380 }} />
          <select className="field" aria-label="Product area" value={area} onChange={(e) => setArea(e.target.value)}>
            <option value="">Product area: any</option>
            {PROMPT_PRODUCT_AREAS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <select className="field" aria-label="Sequence" value={seq} onChange={(e) => setSeq(e.target.value)}>
            <option value="">Sequence: any</option>
            {sequences.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <div className="seg" role="group" aria-label="Verdict">
            <button className={`seg-btn${!verdict ? " active" : ""}`} onClick={() => setVerdict("")}>All ({prompts.length})</button>
            {PROMPT_VERDICT_ORDER.map((v) => (
              <button key={v} className={`seg-btn${verdict === v ? " active" : ""}`} onClick={() => setVerdict(v)}>
                {PROMPT_VERDICT_META[v].label} ({prompts.filter((p) => p.verdict === v).length})
              </button>
            ))}
          </div>
        </div>
      </div>

      {loaded && prompts.length === 0 && (
        <div className="calm-state"><div className="calm-title">No prompts saved yet</div><div className="calm-body">Press + New prompt and paste in the subject, system prompt and user prompt from an Apollo email step.</div></div>
      )}

      {shown.length > 0 && (
        <div className="table-card">
          <table className="data-table dense-table leads-grid" aria-label="Prompts">
            <thead><tr><th>Prompt</th><th>Product area</th><th>Sequence</th><th>Verdict</th><th className="num">Sent</th><th className="num">Open</th><th className="num">Reply</th><th className="num">Meetings</th><th></th></tr></thead>
            <tbody>
              {shown.map((p) => (
                <Fragment key={p.id}>
                  <tr onClick={() => setOpenId(openId === p.id ? "" : p.id)}>
                    <td className="pin-1" style={{ maxWidth: 340 }}>
                      <div className="strong" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{p.title}</div>
                      <div className="muted" style={{ fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis" }}>{p.subject ? `Subject: ${p.subject}` : "No subject"}</div>
                    </td>
                    <td>{p.productArea || <span className="muted">—</span>}</td>
                    <td>{p.sequence || <span className="muted">—</span>}{p.step && <div className="muted" style={{ fontSize: 11.5 }}>{p.step}</div>}</td>
                    <td><span className={`status-pill ${PROMPT_VERDICT_META[p.verdict].cls}`}>{PROMPT_VERDICT_META[p.verdict].label}</span></td>
                    <td className="num">{show(p.sent)}</td>
                    <td className="num">{show(p.openRate, "%")}</td>
                    <td className="num">{show(p.replyRate, "%")}</td>
                    <td className="num">{show(p.meetings)}</td>
                    <td onClick={(e) => e.stopPropagation()} style={{ whiteSpace: "nowrap" }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => setEditing(p)}>Edit</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => setEditing(copyOf(p))}>Copy</button>
                      <button className="btn btn-ghost btn-sm" aria-label={`Delete ${p.title}`} onClick={() => remove(p)}>Delete</button>
                    </td>
                  </tr>
                  {openId === p.id && (
                    <tr className="is-selected">
                      <td colSpan={9} style={{ whiteSpace: "normal", maxWidth: "none" }}>
                        {([["Subject", p.subject], ["System prompt", p.systemPrompt], ["User prompt", p.userPrompt], ["Notes", p.notes]] as [string, string][]).filter(([, v]) => v).map(([label, v]) => (
                          <div key={label} style={{ marginBottom: 10 }}>
                            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                              <strong>{label}</strong>
                              {label !== "Notes" && <button className="btn btn-ghost btn-sm" onClick={() => doCopy(p.id + label, v)}>{copied === p.id + label ? "✓ Copied" : "Copy"}</button>}
                            </div>
                            <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 13, margin: "4px 0 0", background: "var(--surface-sunken)", padding: 8, borderRadius: 6, maxHeight: 260, overflowY: "auto" }}>{v}</pre>
                          </div>
                        ))}
                        <div className="muted" style={{ fontSize: 11.5 }}>Saved {p.createdAt.slice(0, 10)} · updated {p.updatedAt.slice(0, 10)}</div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {loaded && prompts.length > 0 && shown.length === 0 && <div className="panel" style={{ padding: 16 }}>No prompts match these filters.</div>}

      {editing && <PromptEditor prompt={editing} isNew={!prompts.some((x) => x.id === editing.id)} sequences={sequences} onCancel={() => setEditing(null)} onSave={save} />}
    </div>
  );
}

function PromptEditor({ prompt, sequences, onSave, onCancel, isNew }: { prompt: EmailPrompt; sequences: string[]; onSave: (p: EmailPrompt) => void; onCancel: () => void; isNew: boolean }) {
  const [p, setP] = useState<EmailPrompt>(prompt);
  const set = (patch: Partial<EmailPrompt>) => setP((x) => ({ ...x, ...patch }));
  const field = (label: string, el: ReactNode) => (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5, fontWeight: 600 }}>{label}{el}</label>
  );
  return (
    <div role="dialog" aria-modal="true" aria-label="Edit prompt" style={{ position: "fixed", inset: 0, background: "rgba(8,30,34,0.35)", zIndex: 1000, overflowY: "auto", padding: 20 }} onClick={onCancel}>
      <div className="panel" style={{ maxWidth: 820, margin: "4vh auto", padding: 20, display: "flex", flexDirection: "column", gap: 12 }} onClick={(e) => e.stopPropagation()}>
        <div className="panel-title">{isNew ? "New prompt" : "Edit prompt"}</div>
        {field("Name", <input className="field" aria-label="Name" value={p.title} placeholder="e.g. Dynamics BC first touch, v2" onChange={(e) => set({ title: e.target.value })} />)}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          {field("Product area", (
            <select className="field" aria-label="Product area" value={p.productArea} onChange={(e) => set({ productArea: e.target.value })}>
              <option value="">Pick one…</option>
              {PROMPT_PRODUCT_AREAS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          ))}
          {field("Sequence", (
            <>
              <input className="field" aria-label="Sequence" list="prompt-seqs" value={p.sequence} placeholder="Pick or type" onChange={(e) => set({ sequence: e.target.value })} />
              <datalist id="prompt-seqs">{sequences.map((s) => <option key={s} value={s} />)}</datalist>
            </>
          ))}
          {field("Step", <input className="field" aria-label="Step" value={p.step} placeholder="e.g. Step 2 auto email" onChange={(e) => set({ step: e.target.value })} />)}
        </div>
        {field("Subject", <input className="field" aria-label="Subject" value={p.subject} onChange={(e) => set({ subject: e.target.value })} />)}
        {field("System prompt", <textarea className="field" aria-label="System prompt" rows={7} value={p.systemPrompt} onChange={(e) => set({ systemPrompt: e.target.value })} />)}
        {field("User prompt", <textarea className="field" aria-label="User prompt" rows={7} value={p.userPrompt} onChange={(e) => set({ userPrompt: e.target.value })} />)}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10 }}>
          {field("Verdict", (
            <select className="field" aria-label="Verdict" value={p.verdict} onChange={(e) => set({ verdict: e.target.value as PromptVerdict })}>
              {PROMPT_VERDICT_ORDER.map((v) => <option key={v} value={v}>{PROMPT_VERDICT_META[v].label}</option>)}
            </select>
          ))}
          {field("Sent", <input className="field" aria-label="Sent" inputMode="numeric" value={p.sent ?? ""} onChange={(e) => set({ sent: num(e.target.value) })} />)}
          {field("Open %", <input className="field" aria-label="Open rate" inputMode="decimal" value={p.openRate ?? ""} onChange={(e) => set({ openRate: num(e.target.value) })} />)}
          {field("Reply %", <input className="field" aria-label="Reply rate" inputMode="decimal" value={p.replyRate ?? ""} onChange={(e) => set({ replyRate: num(e.target.value) })} />)}
          {field("Meetings", <input className="field" aria-label="Meetings" inputMode="numeric" value={p.meetings ?? ""} onChange={(e) => set({ meetings: num(e.target.value) })} />)}
        </div>
        {field("Notes: what worked, what didn't", <textarea className="field" aria-label="Notes" rows={3} value={p.notes} onChange={(e) => set({ notes: e.target.value })} />)}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" disabled={!p.subject.trim() && !p.userPrompt.trim() && !p.systemPrompt.trim()} onClick={() => onSave(p)}>Save prompt</button>
        </div>
      </div>
    </div>
  );
}
