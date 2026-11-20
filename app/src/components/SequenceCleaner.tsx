// Sequence Scanner (Leads tab) — pick Apollo sequences, run the rules across their
// active contacts, then move or remove flagged leads behind a confirm.
// Rules and Apollo plumbing live in lib/apolloSequences.ts.
import { useMemo, useState } from "react";
import { downloadBlob, toCSV } from "../lib/csv";
import {
  FLAG_META, listSequences, listMailboxes, runAudit, moveToSequence, removeFromSequence,
  type ApolloSequence, type AuditResult, type FlagKind, type Mailbox, type MemberResult,
} from "../lib/apolloSequences";

// The live platform refuses every Apollo write (Jack's standing rule). When
// that guard is on, Move/Remove are replaced by a removal-list export.
const WRITES_ALLOWED = false;

const SEVERITY_CLASS = { remove: "danger", review: "warning", info: "info" } as const;
const FLAG_ORDER: FlagKind[] = ["meeting", "reached", "deep-call", "stage", "replied", "zombie", "repeat-finished", "callback-undated", "prior-contact", "wrong-sequence", "dupe-person", "dupe-company", "callback"];

type Pending = { kind: "remove" } | { kind: "move"; toId: string; mailboxId: string };

export default function SequenceCleaner() {
  const [sequences, setSequences] = useState<ApolloSequence[] | null>(null);
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [audit, setAudit] = useState<AuditResult | null>(null);
  const [flagFilter, setFlagFilter] = useState<FlagKind | "flagged" | "all">("flagged");
  const [seqFilter, setSeqFilter] = useState("all");
  const [addedWithin, setAddedWithin] = useState(0); // days; 0 = any
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [moveTo, setMoveTo] = useState("");
  const [mailbox, setMailbox] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [notice, setNotice] = useState("");

  const seqName = useMemo(() => new Map((sequences || []).map((s) => [s.id, s.name])), [sequences]);
  const rowKey = (m: MemberResult) => `${m.sequenceId}:${m.contactId}`;

  async function connect() {
    setBusy(true); setError(""); setStatus("Loading sequences from Apollo…");
    try {
      const [seqs, boxes] = await Promise.all([listSequences(), listMailboxes().catch(() => [])]);
      setSequences(seqs.sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name)));
      setMailboxes(boxes);
      setStatus("");
    } catch (e) { setError((e as Error).message); setStatus(""); }
    setBusy(false);
  }

  async function run() {
    const seqs = (sequences || []).filter((s) => picked.has(s.id));
    if (!seqs.length) return;
    setBusy(true); setError(""); setNotice(""); setAudit(null); setSelected(new Set());
    try { setAudit(await runAudit(seqs, setStatus, sequences || seqs)); setStatus(""); }
    catch (e) { setError((e as Error).message); setStatus(""); }
    setBusy(false);
  }

  const counts = useMemo(() => {
    const c: Partial<Record<FlagKind, number>> = {};
    for (const m of audit?.members || []) for (const k of new Set(m.flags.map((f) => f.kind))) c[k] = (c[k] || 0) + 1;
    return c;
  }, [audit]);

  const rows = useMemo(() => (audit?.members || []).filter((m) => {
    if (seqFilter !== "all" && m.sequenceId !== seqFilter) return false;
    if (addedWithin && (!m.addedAt || Date.now() - Date.parse(m.addedAt) > addedWithin * 86_400_000)) return false;
    if (flagFilter === "all") return true;
    if (flagFilter === "flagged") return m.flags.length > 0;
    return m.flags.some((f) => f.kind === flagFilter);
  }), [audit, flagFilter, seqFilter, addedWithin]);

  const selRows = (audit?.members || []).filter((m) => selected.has(rowKey(m)));
  const selBySeq = useMemo(() => {
    const g = new Map<string, MemberResult[]>();
    for (const m of selRows) (g.get(m.sequenceId) || g.set(m.sequenceId, []).get(m.sequenceId)!).push(m);
    return g;
  }, [selRows]);

  function pickTarget(id: string) {
    setMoveTo(id);
    const owner = sequences?.find((s) => s.id === id)?.ownerId;
    const def = mailboxes.find((b) => b.ownerId === owner && b.isDefault) || mailboxes.find((b) => b.ownerId === owner);
    setMailbox(def?.id || "");
  }

  async function confirm() {
    if (!pending) return;
    setBusy(true); setError("");
    const done = new Set<string>(); const msgs: string[] = [];
    try {
      for (const [from, members] of selBySeq) {
        const ids = members.map((m) => m.contactId);
        if (pending.kind === "remove") {
          setStatus(`Removing ${ids.length} from ${seqName.get(from)}…`);
          const removed = await removeFromSequence(ids, from);
          removed.forEach((id) => done.add(`${from}:${id}`));
          msgs.push(`Removed ${removed.length} of ${ids.length} from ${seqName.get(from)}`);
        } else {
          if (from === pending.toId) continue;
          setStatus(`Moving ${ids.length} from ${seqName.get(from)}…`);
          const r = await moveToSequence(ids, from, pending.toId, pending.mailboxId);
          r.removed.forEach((id) => done.add(`${from}:${id}`));
          const sk = Object.keys(r.skipped).length;
          msgs.push(`Moved ${r.removed.length} of ${ids.length} from ${seqName.get(from)} to ${seqName.get(pending.toId)}${sk ? ` (${sk} skipped: ${[...new Set(Object.values(r.skipped))].join(", ")})` : ""}`);
        }
      }
      setAudit((a) => a && { ...a, members: a.members.filter((m) => !done.has(rowKey(m))) });
      setSelected(new Set());
      setNotice(msgs.join(". ") + ".");
    } catch (e) { setError((e as Error).message); }
    setStatus(""); setPending(null); setBusy(false);
  }

  async function exportSelected() {
    const rows = selRows.map((m) => ({
      Name: m.name, Company: m.company, Email: m.email, Sequence: seqName.get(m.sequenceId) || m.sequenceId,
      Step: m.stepPosition ?? "", "Contact ID": m.contactId, "Sequence ID": m.sequenceId,
      Added: m.addedAt ? m.addedAt.slice(0, 10) : "",
      "Earlier sequences": m.priorFinished.length,
      Calls: m.history.calls,
      "Last call outcome": m.history.lastOutcome || (m.history.calls ? "No outcome logged" : ""),
      "Last call": m.history.lastDate ? `${m.history.lastCaller} ${m.history.lastDate}` : "",
      "Ever Not interested": m.history.everNotInterested ? "Yes" : "",
      Flags: m.flags.map((f) => `${FLAG_META[f.kind].label}: ${f.evidence}`).join(" | "),
    }));
    await downloadBlob(toCSV(rows, ["Name", "Company", "Email", "Sequence", "Step", "Contact ID", "Sequence ID", "Added", "Earlier sequences", "Calls", "Last call outcome", "Last call", "Ever Not interested", "Flags"]), `sequence-cleaner-removals-${new Date().toISOString().slice(0, 10)}.csv`);
  }

  const allVisibleSelected = rows.length > 0 && rows.every((m) => selected.has(rowKey(m)));

  return (
    <div>
      <div className="page-head">
        <div>
          <h2 className="page-title">Sequence Scanner</h2>
          <div className="page-sub">Pick sequences, check every active lead against the rules, then move or remove the ones that shouldn't be there.</div>
        </div>
        {!sequences && <button className="btn btn-primary" disabled={busy} onClick={connect}>Load sequences</button>}
      </div>

      {error && <div className="panel" style={{ borderColor: "var(--danger)", color: "var(--danger)", padding: 12, marginBottom: 12 }}>{error}</div>}
      {status && <div className="panel-sub" style={{ marginBottom: 12 }}>{status}</div>}
      {notice && <div className="panel" style={{ padding: 12, marginBottom: 12 }}>{notice}</div>}

      {sequences && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-head">
            <div className="panel-title">Sequences</div>
            <button className="btn btn-primary btn-sm" disabled={busy || !picked.size} onClick={run}>
              Run check{picked.size ? ` (${picked.size})` : ""}
            </button>
          </div>
          <div className="panel-body" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 8 }}>
            {sequences.map((s) => (
              <label key={s.id} style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
                <input type="checkbox" checked={picked.has(s.id)} onChange={() => setPicked((p) => { const n = new Set(p); if (n.has(s.id)) n.delete(s.id); else n.add(s.id); return n; })} />
                <span>{s.name}</span>
                <span className={`status-pill ${s.active ? "success" : "neutral"}`}>{s.active ? "On" : "Off"}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {audit && (
        <>
          <div className="chip-row" style={{ marginBottom: 8, flexWrap: "wrap" }}>
            <button className={`chip-btn${flagFilter === "flagged" ? " active" : ""}`} onClick={() => setFlagFilter("flagged")}>Flagged ({audit.members.filter((m) => m.flags.length).length})</button>
            <button className={`chip-btn${flagFilter === "all" ? " active" : ""}`} onClick={() => setFlagFilter("all")}>All active ({audit.members.length})</button>
            {FLAG_ORDER.filter((k) => counts[k]).map((k) => (
              <button key={k} className={`chip-btn${flagFilter === k ? " active" : ""}`} onClick={() => setFlagFilter(k)}>{FLAG_META[k].label} ({counts[k]})</button>
            ))}
            <select className="field" aria-label="Added to sequence" value={addedWithin} onChange={(e) => setAddedWithin(Number(e.target.value))} style={{ marginLeft: "auto" }}>
              <option value={0}>Added any time</option>
              <option value={1}>Added in the last day</option>
              <option value={7}>Added in the last 7 days</option>
              <option value={30}>Added in the last 30 days</option>
            </select>
            <select className="field" value={seqFilter} onChange={(e) => setSeqFilter(e.target.value)}>
              <option value="all">All checked sequences</option>
              {[...picked].map((id) => <option key={id} value={id}>{seqName.get(id)}</option>)}
            </select>
          </div>
          <div className="panel" style={{ marginBottom: 12 }}>
            <div className="panel-head">
              <div className="panel-title">Company check</div>
              <div className="panel-sub">{audit.companyCheck.length === 0 ? "Every sequence has at most one contact per company." : `${audit.companyCheck.length} compan${audit.companyCheck.length === 1 ? "y has" : "ies have"} more than one contact in the same sequence.`}</div>
            </div>
            {audit.companyCheck.length > 0 && (
              <div className="panel-body">
                <table className="data-table">
                  <thead><tr><th>Sequence</th><th>Company</th><th>Contacts (step)</th></tr></thead>
                  <tbody>
                    {audit.companyCheck.map((r) => (
                      <tr key={r.sequenceId + r.company}>
                        <td>{seqName.get(r.sequenceId)}</td>
                        <td><strong>{r.company}</strong> <span className="status-pill warning">{r.contacts.length}</span></td>
                        <td>{r.contacts.map((c) => `${c.name || c.email} (${c.step ?? "—"})`).join(" · ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          {audit.gaps.map((g) => <div key={g} className="panel-sub" style={{ marginBottom: 4 }}>⚠ {g}</div>)}
          <div className="panel-sub" style={{ marginBottom: 8 }}>{audit.checkedCalls.toLocaleString()} calls checked across {new Set(audit.members.map((m) => m.accountId)).size} companies.</div>

          {selected.size > 0 && (
            <div className="bulkbar" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
              <strong>{selected.size} selected</strong>
              <button className="btn btn-secondary btn-sm" onClick={exportSelected}>Export removal list (CSV)</button>
              {!WRITES_ALLOWED && <span className="panel-sub">Apollo writes are off on this platform. Send the list to Claude or remove them in Apollo.</span>}
              {WRITES_ALLOWED && <>
              <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => setPending({ kind: "remove" })}>Remove from their sequence</button>
              <span>or move to</span>
              <select className="field" value={moveTo} onChange={(e) => pickTarget(e.target.value)}>
                <option value="">Pick a sequence…</option>
                {(sequences || []).map((s) => <option key={s.id} value={s.id}>{s.name}{s.active ? "" : " (off)"}</option>)}
              </select>
              {moveTo && (
                <select className="field" value={mailbox} onChange={(e) => setMailbox(e.target.value)}>
                  <option value="">Send from…</option>
                  {mailboxes.map((b) => <option key={b.id} value={b.id}>{b.email}{b.ownerName ? ` (${b.ownerName})` : ""}</option>)}
                </select>
              )}
              <button className="btn btn-primary btn-sm" disabled={busy || !moveTo || !mailbox} onClick={() => setPending({ kind: "move", toId: moveTo, mailboxId: mailbox })}>Move</button>
              </>}
            </div>
          )}

          <div className="table-card">
            <table className="data-table">
              <thead>
                <tr>
                  <th><input type="checkbox" checked={allVisibleSelected} onChange={() => setSelected((s) => { const n = new Set(s); rows.forEach((m) => allVisibleSelected ? n.delete(rowKey(m)) : n.add(rowKey(m))); return n; })} /></th>
                  <th>Lead</th><th>Sequence</th><th>Step</th><th>History</th><th>Flags</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={6} className="cell-empty">{flagFilter === "flagged" ? "Nothing flagged — every active lead passed." : "No leads match."}</td></tr>}
                {rows.map((m) => (
                  <tr key={rowKey(m)}>
                    <td><input type="checkbox" checked={selected.has(rowKey(m))} onChange={() => setSelected((s) => { const n = new Set(s); const k = rowKey(m); if (n.has(k)) n.delete(k); else n.add(k); return n; })} /></td>
                    <td><div><strong>{m.name || "—"}</strong></div><div className="panel-sub">{m.company}{m.email ? ` · ${m.email}` : ""}</div></td>
                    <td>{seqName.get(m.sequenceId)}{m.status === "paused" ? " (paused)" : ""}</td>
                    <td>{m.stepPosition ?? "—"}</td>
                    <td style={{ minWidth: 220 }}>
                      <div className="panel-sub">Added {m.addedAt ? m.addedAt.slice(0, 10) : "—"}</div>
                      <div className="panel-sub">{m.priorFinished.length ? `${m.priorFinished.length} earlier sequence${m.priorFinished.length === 1 ? "" : "s"}` : "No earlier sequences"}</div>
                      <div className="panel-sub">{m.history.calls ? `${m.history.calls} call${m.history.calls === 1 ? "" : "s"}${m.history.callsBeforeAdd ? ` (${m.history.callsBeforeAdd} before this sequence)` : ""}` : "Never called"}</div>
                      {m.history.calls > 0 && (
                        <div title={m.history.lastNote || undefined}>
                          <span className={`status-pill ${m.history.everNotInterested ? "danger" : m.history.lastOutcomeId ? "info" : "neutral"}`}>{m.history.lastOutcome || "No outcome logged"}</span>
                          <span className="panel-sub" style={{ marginLeft: 6 }}>{m.history.lastCaller} · {m.history.lastDate}</span>
                          {m.history.everNotInterested && m.history.lastOutcomeId !== "66203bd7183e310422980485" && <div className="panel-sub" style={{ color: "var(--danger)" }}>Marked Not interested earlier</div>}
                        </div>
                      )}
                    </td>
                    <td>
                      {m.flags.length === 0 && <span className="status-pill success">Clean</span>}
                      {m.flags.map((f, i) => (
                        <div key={i} style={{ marginBottom: 4 }}>
                          <span className={`status-pill ${SEVERITY_CLASS[FLAG_META[f.kind].severity]}`}>{FLAG_META[f.kind].label}</span>
                          <span className="panel-sub" style={{ marginLeft: 6 }}>{f.evidence}</span>
                        </div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {pending && (
        <div role="dialog" aria-modal="true" style={{ position: "fixed", inset: 0, background: "rgba(8,30,34,0.35)", zIndex: 1000, overflowY: "auto", padding: 20 }} onClick={() => !busy && setPending(null)}>
          <div className="panel" style={{ maxWidth: 520, margin: "10vh auto", padding: 20 }} onClick={(e) => e.stopPropagation()}>
            <div className="panel-title" style={{ marginBottom: 8 }}>{pending.kind === "remove" ? "Remove from sequence" : "Move to another sequence"}</div>
            <p>This changes live sequences in Apollo.</p>
            <ul>
              {[...selBySeq].map(([from, ms]) => (
                <li key={from}>{ms.length} lead{ms.length === 1 ? "" : "s"} out of <strong>{seqName.get(from)}</strong>
                  {pending.kind === "move" && from !== pending.toId && <> into <strong>{seqName.get(pending.toId)}</strong></>}
                  {pending.kind === "move" && from === pending.toId && <> (already there, skipped)</>}
                </li>
              ))}
            </ul>
            {pending.kind === "move" && (
              <p>Sending from <strong>{mailboxes.find((b) => b.id === pending.mailboxId)?.email}</strong>. They start at step 1. Leads are only removed from the old sequence once the new one accepts them.</p>
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn btn-secondary" disabled={busy} onClick={() => setPending(null)}>Cancel</button>
              <button className={`btn ${pending.kind === "remove" ? "btn-danger" : "btn-primary"}`} disabled={busy} onClick={confirm}>
                {busy ? "Working…" : pending.kind === "remove" ? `Remove ${selected.size}` : `Move ${selected.size}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
