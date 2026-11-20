// Sequence Scanner (Leads tab) — pick Apollo sequences, run the rules across
// their active contacts, then remove leads that shouldn't be there and settle
// duplicates (keep one, merge, or remove). Every write is behind a confirm.
// Rules and Apollo plumbing live in lib/apolloSequences.ts; the only writes
// allowed are the three in SEQUENCE_SCANNER_WRITE_TOOLS (lib/apolloEnrich.ts).
import { useMemo, useState } from "react";
import { downloadBlob, toCSV } from "../lib/csv";
import {
  FLAG_META, DUP_REASON_META, listSequences, runAudit, removeFromSequence, mergeContacts,
  findDuplicates, findMultiSequence, findCompanyGroups, listMailboxes, findRecycleCandidates, pushToRecycled,
  RECYCLE_REST_BUSINESS_DAYS,
  type ApolloSequence, type Mailbox, type RecycleResult, type AuditResult, type DupGroup, type FlagKind, type MemberResult,
} from "../lib/apolloSequences";

const SEVERITY_CLASS = { remove: "danger", review: "warning", info: "info" } as const;
const SEVERITY_RANK = { remove: 0, review: 1, info: 2 } as const;
const FLAG_ORDER: FlagKind[] = ["meeting", "reached", "deep-call", "stage", "replied", "zombie", "repeat-finished", "callback-undated", "prior-contact", "wrong-sequence", "dupe-person", "dupe-company", "callback"];

type Tab = "flagged" | "duplicates" | "companies" | "all";
type Pending =
  | { kind: "remove"; rows: MemberResult[]; title: string }
  | { kind: "merge"; group: DupGroup; keepId: string; dropIds: string[]; note: string | null };

const rowKey = (m: MemberResult) => `${m.sequenceId}:${m.contactId}`;
const sortedFlags = (m: MemberResult) => [...m.flags].sort((a, b) => SEVERITY_RANK[FLAG_META[a.kind].severity] - SEVERITY_RANK[FLAG_META[b.kind].severity]);
const fmtPhone = (d: string) => d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : d;

export default function SequenceCleaner() {
  const [sequences, setSequences] = useState<ApolloSequence[] | null>(null);
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [mode, setMode] = useState<"check" | "recycle">("check");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pickerOpen, setPickerOpen] = useState(true);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [audit, setAudit] = useState<AuditResult | null>(null);
  const [tab, setTab] = useState<Tab>("flagged");
  const [flagFilter, setFlagFilter] = useState<FlagKind | "">("");
  const [seqFilter, setSeqFilter] = useState("all");
  const [addedWithin, setAddedWithin] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<Pending | null>(null);
  const [notice, setNotice] = useState("");
  // Per duplicate group: which contact to keep, and which note to keep.
  const [keepChoice, setKeepChoice] = useState<Record<string, string>>({});
  const [noteChoice, setNoteChoice] = useState<Record<string, string>>({});
  const [resolved, setResolved] = useState<Set<string>>(new Set());

  const seqName = useMemo(() => new Map((sequences || []).map((s) => [s.id, s.name])), [sequences]);
  const members = useMemo(() => audit?.members || [], [audit]);
  const dupGroups = useMemo(() => findDuplicates(members).filter((g) => !resolved.has(g.key)), [members, resolved]);
  const multi = useMemo(() => findMultiSequence(members), [members]);
  const companies = useMemo(() => findCompanyGroups(members), [members]);

  async function connect() {
    setBusy(true); setError(""); setStatus("Loading sequences from Apollo…");
    try {
      const [seqs, boxes] = await Promise.all([listSequences(), listMailboxes().catch(() => [] as Mailbox[])]);
      setMailboxes(boxes);
      setSequences(seqs.sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name)));
      setStatus("");
    } catch (e) { setError((e as Error).message); setStatus(""); }
    setBusy(false);
  }

  async function run() {
    const seqs = (sequences || []).filter((s) => picked.has(s.id));
    if (!seqs.length) return;
    setBusy(true); setError(""); setNotice(""); setAudit(null); setSelected(new Set()); setResolved(new Set());
    try { setAudit(await runAudit(seqs, setStatus, sequences || seqs)); setStatus(""); setPickerOpen(false); }
    catch (e) { setError((e as Error).message); setStatus(""); }
    setBusy(false);
  }

  const counts = useMemo(() => {
    const c: Partial<Record<FlagKind, number>> = {};
    for (const m of members) for (const k of new Set(m.flags.map((f) => f.kind))) c[k] = (c[k] || 0) + 1;
    return c;
  }, [members]);
  const flaggedCount = members.filter((m) => m.flags.length).length;

  const rows = useMemo(() => members.filter((m) => {
    if (seqFilter !== "all" && m.sequenceId !== seqFilter) return false;
    if (addedWithin && (!m.addedAt || Date.now() - Date.parse(m.addedAt) > addedWithin * 86_400_000)) return false;
    if (flagFilter) return m.flags.some((f) => f.kind === flagFilter);
    return tab === "all" || m.flags.length > 0;
  }), [members, tab, flagFilter, seqFilter, addedWithin]);

  const selRows = members.filter((m) => selected.has(rowKey(m)));

  function dropRows(done: Set<string>) {
    setAudit((a) => a && { ...a, members: a.members.filter((m) => !done.has(rowKey(m))) });
    setSelected((s) => new Set([...s].filter((k) => !done.has(k))));
  }

  async function confirm() {
    if (!pending) return;
    setBusy(true); setError("");
    try {
      if (pending.kind === "remove") {
        const bySeq = new Map<string, MemberResult[]>();
        for (const m of pending.rows) (bySeq.get(m.sequenceId) || bySeq.set(m.sequenceId, []).get(m.sequenceId)!).push(m);
        const done = new Set<string>(); const msgs: string[] = [];
        for (const [seq, ms] of bySeq) {
          setStatus(`Removing ${ms.length} from ${seqName.get(seq)}…`);
          const removed = await removeFromSequence(ms.map((m) => m.contactId), seq);
          removed.forEach((id) => done.add(`${seq}:${id}`));
          msgs.push(`Removed ${removed.length} of ${ms.length} from ${seqName.get(seq)}`);
        }
        dropRows(done);
        setNotice(msgs.join(". ") + ".");
      } else {
        const { group, keepId, dropIds, note } = pending;
        setStatus("Merging in Apollo…");
        await mergeContacts(keepId, dropIds, note);
        const done = new Set(members.filter((m) => dropIds.includes(m.contactId)).map(rowKey));
        dropRows(done);
        setResolved((r) => new Set(r).add(group.key));
        const kept = group.contacts.find((c) => c[0].contactId === keepId)![0];
        setNotice(`Merged ${dropIds.length} duplicate${dropIds.length === 1 ? "" : "s"} into ${kept.name}${note !== null ? " and kept the note you picked" : ""}. Run the check again to see the merged contact's sequences.`);
      }
    } catch (e) { setError((e as Error).message); }
    setStatus(""); setPending(null); setBusy(false);
  }

  async function exportSelected() {
    const out = (selRows.length ? selRows : rows).map((m) => ({
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
    await downloadBlob(toCSV(out, ["Name", "Company", "Email", "Sequence", "Step", "Contact ID", "Sequence ID", "Added", "Earlier sequences", "Calls", "Last call outcome", "Last call", "Ever Not interested", "Flags"]), `sequence-scanner-${new Date().toISOString().slice(0, 10)}.csv`);
  }

  const allVisibleSelected = rows.length > 0 && rows.every((m) => selected.has(rowKey(m)));
  const pickedNames = [...picked].map((id) => seqName.get(id)).filter(Boolean);

  return (
    <div>
      <div className="page-head">
        <div>
          <h2 className="page-title">Sequence Scanner</h2>
          <div className="page-sub">Check every active lead in the sequences you pick. Remove the ones that shouldn't be there and settle duplicates.</div>
        </div>
        {!sequences && <button className="btn btn-primary" disabled={busy} onClick={connect}>Load sequences</button>}
      </div>

      {error && <div className="panel" style={{ borderColor: "var(--danger)", color: "var(--danger)", padding: 12, marginBottom: 12 }}>{error}</div>}
      {status && <div className="panel-sub" style={{ marginBottom: 12 }}>⏳ {status}</div>}
      {notice && <div className="panel" style={{ padding: 12, marginBottom: 12, borderColor: "var(--success)" }}>✓ {notice}</div>}

      {sequences && (
        <div className="seg" role="tablist" aria-label="Mode" style={{ marginBottom: 12 }}>
          <button role="tab" aria-selected={mode === "check"} className={`seg-btn${mode === "check" ? " active" : ""}`} onClick={() => setMode("check")}>Check sequences</button>
          <button role="tab" aria-selected={mode === "recycle"} className={`seg-btn${mode === "recycle" ? " active" : ""}`} onClick={() => setMode("recycle")}>Recycle</button>
        </div>
      )}

      {sequences && mode === "recycle" && <RecyclePanel sequences={sequences} mailboxes={mailboxes} />}

      {mode === "check" && sequences && (pickerOpen || !audit) && (
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

      {mode === "check" && audit && (
        <>
          {!pickerOpen && (
            <div className="panel" style={{ padding: "10px 14px", marginBottom: 12, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <span className="panel-sub">Checked:</span> <strong>{pickedNames.join(" · ")}</strong>
              <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setPickerOpen(true)}>Change sequences</button>
                <button className="btn btn-secondary btn-sm" disabled={busy} onClick={run}>↻ Run again</button>
              </span>
            </div>
          )}

          <div className="metric-row" style={{ marginBottom: 12 }}>
            <div className="metric"><div className="metric-label">Active leads</div><div className="metric-value">{members.length}</div></div>
            <div className="metric"><div className="metric-label">Flagged</div><div className="metric-value">{flaggedCount}</div></div>
            <div className="metric"><div className="metric-label">Duplicates</div><div className="metric-value">{dupGroups.length + multi.length}</div></div>
            <div className="metric"><div className="metric-label">Companies with 2+</div><div className="metric-value">{companies.length}</div></div>
            <div className="metric"><div className="metric-label">Calls checked</div><div className="metric-value">{audit.checkedCalls.toLocaleString()}</div></div>
          </div>

          <div className="seg" role="tablist" style={{ marginBottom: 12 }}>
            {([["flagged", `Flagged (${flaggedCount})`], ["duplicates", `Duplicates (${dupGroups.length + multi.length})`], ["companies", `Same company (${companies.length})`], ["all", `All leads (${members.length})`]] as [Tab, string][]).map(([k, label]) => (
              <button key={k} role="tab" aria-selected={tab === k} className={`seg-btn${tab === k ? " active" : ""}`} onClick={() => { setTab(k); setFlagFilter(""); }}>{label}</button>
            ))}
          </div>

          {(tab === "flagged" || tab === "all") && (
            <>
              <div className="control-strip" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
                <select className="field" aria-label="Flag" value={flagFilter} onChange={(e) => setFlagFilter(e.target.value as FlagKind | "")}>
                  <option value="">{tab === "flagged" ? "Every flag" : "Every lead"}</option>
                  {FLAG_ORDER.filter((k) => counts[k]).map((k) => <option key={k} value={k}>{FLAG_META[k].label} ({counts[k]})</option>)}
                </select>
                <select className="field" aria-label="Sequence" value={seqFilter} onChange={(e) => setSeqFilter(e.target.value)}>
                  <option value="all">All checked sequences</option>
                  {[...picked].map((id) => <option key={id} value={id}>{seqName.get(id)}</option>)}
                </select>
                <select className="field" aria-label="Added to sequence" value={addedWithin} onChange={(e) => setAddedWithin(Number(e.target.value))}>
                  <option value={0}>Added any time</option>
                  <option value={1}>Added in the last day</option>
                  <option value={7}>Added in the last 7 days</option>
                  <option value={30}>Added in the last 30 days</option>
                </select>
                <span className="panel-sub" style={{ marginLeft: "auto" }}>{rows.length} shown</span>
              </div>

              <div className="bulkbar" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
                <strong>{selected.size ? `${selected.size} selected` : "Tick leads to act on several"}</strong>
                <button className="btn btn-danger btn-sm" disabled={busy || !selected.size} onClick={() => setPending({ kind: "remove", rows: selRows, title: `Remove ${selRows.length} lead${selRows.length === 1 ? "" : "s"} from their sequence` })}>Remove from sequence</button>
                <button className="btn btn-secondary btn-sm" onClick={exportSelected}>⬇ Export {selected.size ? "selected" : "shown"} (CSV)</button>
              </div>

              <div className="table-card">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th><input type="checkbox" aria-label="Select all shown" checked={allVisibleSelected} onChange={() => setSelected((s) => { const n = new Set(s); rows.forEach((m) => allVisibleSelected ? n.delete(rowKey(m)) : n.add(rowKey(m))); return n; })} /></th>
                      <th>Lead</th><th>Sequence</th><th>History</th><th>Why it's flagged</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 && <tr><td colSpan={6} className="cell-empty">{tab === "flagged" && !flagFilter ? "Nothing flagged. Every active lead passed." : "No leads match."}</td></tr>}
                    {rows.map((m) => {
                      const fl = sortedFlags(m);
                      return (
                        <tr key={rowKey(m)}>
                          <td><input type="checkbox" checked={selected.has(rowKey(m))} onChange={() => setSelected((s) => { const n = new Set(s); const k = rowKey(m); if (n.has(k)) n.delete(k); else n.add(k); return n; })} /></td>
                          <td><div><strong>{m.name || "—"}</strong></div><div className="panel-sub">{m.company}{m.email ? ` · ${m.email}` : ""}</div></td>
                          <td>
                            <div>{seqName.get(m.sequenceId)}{m.status === "paused" ? " (paused)" : ""}</div>
                            <div className="panel-sub">Step {m.stepPosition ?? "—"} · added {m.addedAt ? m.addedAt.slice(0, 10) : "—"}</div>
                          </td>
                          <td style={{ minWidth: 190 }}>
                            {m.history.calls === 0
                              ? <span className="panel-sub">Never called</span>
                              : <div title={m.history.lastNote || undefined}>
                                  <span className={`status-pill ${m.history.everNotInterested ? "danger" : m.history.lastOutcomeId ? "info" : "neutral"}`}>{m.history.lastOutcome || "No outcome logged"}</span>
                                  <div className="panel-sub">{m.history.calls} call{m.history.calls === 1 ? "" : "s"} · {m.history.lastCaller} · {m.history.lastDate}</div>
                                </div>}
                            {m.priorFinished.length > 0 && <div className="panel-sub">{m.priorFinished.length} earlier sequence{m.priorFinished.length === 1 ? "" : "s"}</div>}
                          </td>
                          <td style={{ maxWidth: 420 }}>
                            {fl.length === 0 && <span className="status-pill success">Clean</span>}
                            {fl.length > 0 && (
                              <div>
                                <span className={`status-pill ${SEVERITY_CLASS[FLAG_META[fl[0].kind].severity]}`}>{FLAG_META[fl[0].kind].label}</span>
                                <span className="panel-sub" style={{ marginLeft: 6 }}>{fl[0].evidence}</span>
                              </div>
                            )}
                            {fl.length > 1 && (
                              <details>
                                <summary className="panel-sub" style={{ cursor: "pointer" }}>+{fl.length - 1} more: {fl.slice(1).map((f) => FLAG_META[f.kind].label).join(", ")}</summary>
                                {fl.slice(1).map((f, i) => (
                                  <div key={i} style={{ marginTop: 4 }}>
                                    <span className={`status-pill ${SEVERITY_CLASS[FLAG_META[f.kind].severity]}`}>{FLAG_META[f.kind].label}</span>
                                    <span className="panel-sub" style={{ marginLeft: 6 }}>{f.evidence}</span>
                                  </div>
                                ))}
                              </details>
                            )}
                          </td>
                          <td><button className="btn btn-ghost btn-sm" aria-label={`Remove ${m.name}`} disabled={busy} onClick={() => setPending({ kind: "remove", rows: [m], title: `Remove ${m.name} from ${seqName.get(m.sequenceId)}` })}>Remove</button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {audit.gaps.map((g) => <div key={g} className="panel-sub" style={{ marginTop: 6 }}>⚠ {g}</div>)}
            </>
          )}

          {tab === "duplicates" && (
            <>
              <div className="panel-sub" style={{ marginBottom: 10 }}>
                Same person twice: matched on email first (confirmed), then phone, then name at the same company, including a first-name-only entry next to a full name. Only contacts active in the checked sequences are compared.
              </div>
              {dupGroups.length === 0 && multi.length === 0 && <div className="panel" style={{ padding: 16 }}>No duplicates in these sequences.</div>}

              {dupGroups.map((g) => {
                const keepId = keepChoice[g.key] || bestKeep(g);
                const notes = [...new Set(g.contacts.map((c) => c[0].note.trim()).filter(Boolean))];
                const keptNote = g.contacts.find((c) => c[0].contactId === keepId)![0].note.trim();
                const noteSel = noteChoice[g.key] ?? keptNote;
                const dropIds = g.contacts.map((c) => c[0].contactId).filter((id) => id !== keepId);
                const noteToWrite = noteSel === keptNote ? null : noteSel;
                return (
                  <div key={g.key} className="panel" style={{ marginBottom: 14 }} data-dup-group>
                    <div className="panel-head">
                      <div className="panel-title">{g.company || "Unknown company"}</div>
                      <span className={`status-pill ${g.reason === "email" ? "success" : g.reason === "phone" ? "info" : "warning"}`}>{DUP_REASON_META[g.reason].label}</span>
                    </div>
                    <div className="panel-body">
                      <div className="panel-sub" style={{ marginBottom: 8 }}>{g.reasons.join(" · ")}</div>
                      <div style={{ display: "grid", gridTemplateColumns: `repeat(${g.contacts.length}, minmax(220px, 1fr))`, gap: 10 }}>
                        {g.contacts.map((ms) => {
                          const c = ms[0];
                          const keep = c.contactId === keepId;
                          return (
                            <div key={c.contactId} data-dup-contact style={{ border: `1.5px solid ${keep ? "var(--brand)" : "var(--border)"}`, borderRadius: 10, padding: 10 }}>
                              <label style={{ display: "flex", gap: 6, alignItems: "center", fontWeight: 600, cursor: "pointer" }}>
                                <input type="radio" name={`keep-${g.key}`} checked={keep} onChange={() => setKeepChoice((k) => ({ ...k, [g.key]: c.contactId }))} />
                                {keep ? "Keep this one" : "Keep this one instead"}
                              </label>
                              <div style={{ marginTop: 6 }}><strong>{c.name || "—"}</strong>{!c.lastName && <span className="status-pill warning" style={{ marginLeft: 6 }}>No last name</span>}</div>
                              {c.title && <div className="panel-sub">{c.title}</div>}
                              <div className="panel-sub">{c.email || "No email"}</div>
                              <div className="panel-sub">{c.phones.length ? c.phones.map(fmtPhone).join(", ") : "No phone"}</div>
                              {ms.map((m) => (
                                <div key={m.sequenceId} className="panel-sub">{seqName.get(m.sequenceId)} · step {m.stepPosition ?? "—"}</div>
                              ))}
                              <div className="panel-sub">{c.history.calls ? `${c.history.calls} call${c.history.calls === 1 ? "" : "s"} · ${c.history.lastOutcome || "no outcome"}` : "Never called"}</div>
                              <div style={{ marginTop: 6, fontSize: 13, maxHeight: 110, overflowY: "auto", background: "var(--surface-sunken)", borderRadius: 6, padding: 6 }}>{c.note || <span className="panel-sub">No note</span>}</div>
                              {c.crmSynced && <div className="panel-sub" style={{ marginTop: 4 }}>Synced to HubSpot / Salesforce</div>}
                            </div>
                          );
                        })}
                      </div>

                      {notes.length > 1 && (
                        <div style={{ marginTop: 10 }}>
                          <div style={{ fontWeight: 600, marginBottom: 4 }}>Note to keep on the merged contact</div>
                          {notes.map((n, i) => (
                            <label key={i} style={{ display: "flex", gap: 6, alignItems: "flex-start", marginBottom: 4, cursor: "pointer" }}>
                              <input type="radio" name={`note-${g.key}`} checked={noteSel === n} onChange={() => setNoteChoice((x) => ({ ...x, [g.key]: n }))} />
                              <span style={{ fontSize: 13 }}>{n.length > 160 ? n.slice(0, 160) + "…" : n}</span>
                            </label>
                          ))}
                          <label style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
                            <input type="radio" name={`note-${g.key}`} checked={noteSel === notes.join("\n\n")} onChange={() => setNoteChoice((x) => ({ ...x, [g.key]: notes.join("\n\n") }))} />
                            <span style={{ fontSize: 13 }}>Keep both notes, joined</span>
                          </label>
                        </div>
                      )}

                      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                        <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => setPending({ kind: "merge", group: g, keepId, dropIds, note: noteToWrite })}>Merge into kept contact</button>
                        <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => {
                          const rowsOut = members.filter((m) => dropIds.includes(m.contactId));
                          setPending({ kind: "remove", rows: rowsOut, title: `Remove the other ${dropIds.length === 1 ? "entry" : "entries"} from their sequence (keeps both contacts in Apollo)` });
                        }}>Keep one, remove the other from its sequence</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => setResolved((r) => new Set(r).add(g.key))}>Not the same person</button>
                      </div>
                    </div>
                  </div>
                );
              })}

              {multi.map((x) => (
                <div key={x.contactId} className="panel" style={{ marginBottom: 14 }} data-multi-seq>
                  <div className="panel-head">
                    <div className="panel-title">{x.memberships[0].name} · {x.memberships[0].company}</div>
                    <span className="status-pill warning">Same contact in {x.memberships.length} sequences</span>
                  </div>
                  <div className="panel-body">
                    {x.memberships.map((m) => (
                      <div key={m.sequenceId} style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 6 }}>
                        <span style={{ minWidth: 260 }}><strong>{seqName.get(m.sequenceId)}</strong> <span className="panel-sub">step {m.stepPosition ?? "—"} · added {m.addedAt ? m.addedAt.slice(0, 10) : "—"}</span></span>
                        <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => setPending({ kind: "remove", rows: x.memberships.filter((o) => o.sequenceId !== m.sequenceId), title: `Keep ${m.name} in ${seqName.get(m.sequenceId)} only` })}>Keep here, remove from the rest</button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </>
          )}

          {tab === "companies" && (
            <>
              <div className="panel-sub" style={{ marginBottom: 10 }}>Companies with more than one person active across the checked sequences. Keep the contact you want to work and remove the others.</div>
              {companies.length === 0 && <div className="panel" style={{ padding: 16 }}>Every company has one contact in these sequences.</div>}
              {companies.map((g) => {
                const sameSeq = new Set(g.members.map((m) => m.sequenceId)).size < g.members.length;
                return (
                  <div key={g.key} className="panel" style={{ marginBottom: 12 }} data-company-group>
                    <div className="panel-head">
                      <div className="panel-title">{g.company}</div>
                      <span className={`status-pill ${sameSeq ? "danger" : "warning"}`}>{g.members.length} contacts{sameSeq ? " · 2+ in one sequence" : ""}</span>
                    </div>
                    <div className="panel-body">
                      <table className="data-table">
                        <thead><tr><th>Contact</th><th>Sequence</th><th>History</th><th></th></tr></thead>
                        <tbody>
                          {g.members.map((m) => (
                            <tr key={rowKey(m)}>
                              <td><strong>{m.name}</strong><div className="panel-sub">{m.title || m.email}</div></td>
                              <td>{seqName.get(m.sequenceId)}<div className="panel-sub">step {m.stepPosition ?? "—"}</div></td>
                              <td className="panel-sub">{m.history.calls ? `${m.history.calls} call${m.history.calls === 1 ? "" : "s"} · ${m.history.lastOutcome || "no outcome"}` : "Never called"}</td>
                              <td style={{ display: "flex", gap: 6 }}>
                                <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => setPending({ kind: "remove", rows: g.members.filter((o) => rowKey(o) !== rowKey(m)), title: `Keep ${m.name} only at ${g.company}` })}>Keep only this one</button>
                                <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setPending({ kind: "remove", rows: [m], title: `Remove ${m.name} from ${seqName.get(m.sequenceId)}` })}>Remove</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </>
      )}

      {pending && (
        <div role="dialog" aria-modal="true" style={{ position: "fixed", inset: 0, background: "rgba(8,30,34,0.35)", zIndex: 1000, overflowY: "auto", padding: 20 }} onClick={() => !busy && setPending(null)}>
          <div className="panel" style={{ maxWidth: 560, margin: "10vh auto", padding: 20 }} onClick={(e) => e.stopPropagation()}>
            {pending.kind === "remove" ? (
              <>
                <div className="panel-title" style={{ marginBottom: 8 }}>{pending.title}</div>
                <p>This removes them from the sequence in Apollo. It can't be undone; you'd have to add them back. The contacts themselves stay in Apollo.</p>
                <ul style={{ maxHeight: 240, overflowY: "auto" }}>
                  {pending.rows.map((m) => <li key={rowKey(m)}><strong>{m.name}</strong> ({m.company}) out of {seqName.get(m.sequenceId)}</li>)}
                </ul>
              </>
            ) : (
              <>
                <div className="panel-title" style={{ marginBottom: 8 }}>Merge duplicate contacts</div>
                {(() => {
                  const all = pending.group.contacts.map((c) => c[0]);
                  const keep = all.find((c) => c.contactId === pending.keepId)!;
                  const drop = all.filter((c) => c.contactId !== pending.keepId);
                  return (
                    <>
                      <p><strong>Keep:</strong> {keep.name} · {keep.email || "no email"} · <code>{keep.contactId}</code></p>
                      <p><strong>Merged in, then permanently deleted:</strong></p>
                      <ul>{drop.map((c) => <li key={c.contactId}>{c.name} · {c.email || "no email"} · <code>{c.contactId}</code></li>)}</ul>
                      <p>The kept contact keeps its own values and gains the others' emails, phones, sequences, calls and history. <strong>This can't be undone.</strong></p>
                      {pending.note !== null && <p>The note on the kept contact will be set to the one you picked.</p>}
                      {all.some((c) => c.crmSynced) && <p style={{ color: "var(--danger)" }}>One of these syncs to HubSpot or Salesforce. If deletion sync is on there, the duplicate's CRM record gets deleted too. Turn deletion sync off first if you're not sure.</p>}
                    </>
                  );
                })()}
              </>
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn btn-secondary" disabled={busy} onClick={() => setPending(null)}>Cancel</button>
              <button className={`btn ${pending.kind === "remove" ? "btn-danger" : "btn-primary"}`} disabled={busy} onClick={confirm}>
                {busy ? "Working…" : pending.kind === "remove" ? `Remove ${pending.rows.length}` : "Merge"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Default pick: the entry with the most to lose — a full name over first
// name only, then more calls, then a note, then further along in a sequence.
function bestKeep(g: DupGroup): string {
  const score = (ms: MemberResult[]) => {
    const c = ms[0];
    return (c.lastName ? 1000 : 0) + c.history.calls * 10 + (c.note ? 5 : 0) + (c.email ? 3 : 0) + Math.max(...ms.map((m) => m.stepPosition || 0));
  };
  return [...g.contacts].sort((a, b) => score(b) - score(a))[0][0].contactId;
}


// ---------------------------------------------------------------- recycle

const RECYCLE_DAYS_KEY = "recycleDays";
interface Pair { id: string; targetId: string; sourceId: string; on: boolean }

function RecyclePanel({ sequences, mailboxes }: { sequences: ApolloSequence[]; mailboxes: Mailbox[] }) {
  const targets = useMemo(() => sequences.filter((s) => /recycl/i.test(s.name)), [sequences]);
  const recycledIds = useMemo(() => targets.map((t) => t.id), [targets]);
  const sourcesFor = (t: ApolloSequence) => sequences.filter((s) => s.ownerId === t.ownerId && !/recycl/i.test(s.name));
  // Per Jack: "i want to be able to select the recycled sequence it pushes to
  // after they are finished" — both ends of every row are a choice; the
  // defaults just pair each recycled sequence with its owner's main one.
  const [pairs, setPairs] = useState<Pair[]>(() => targets.map((t, i) => {
    const src = sourcesFor(t);
    const pick = src.find((s) => /m365|main/i.test(s.name) && !/dynamics/i.test(s.name)) || src[0];
    return { id: `p${i}`, targetId: t.id, sourceId: pick?.id || "", on: !!pick };
  }));
  const others = useMemo(() => sequences.filter((s) => !/recycl/i.test(s.name)), [sequences]);
  const setPair = (id: string, patch: Partial<Pair>) => setPairs((ps) => ps.map((x) => x.id === id ? { ...x, ...patch } : x));
  const [days, setDays] = useState<number>(() => { try { return Number(localStorage.getItem(RECYCLE_DAYS_KEY)) || 30; } catch { return 30; } });
  const [readyOnly, setReadyOnly] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [results, setResults] = useState<RecycleResult[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<{ result: RecycleResult; ids: string[]; mailboxId: string } | null>(null);
  const name = (id: string) => sequences.find((s) => s.id === id)?.name || id;

  function setDaysSaved(n: number) {
    setDays(n);
    try { if (n > 0) localStorage.setItem(RECYCLE_DAYS_KEY, String(n)); } catch { /* preference only */ }
  }

  async function refresh() {
    setBusy(true); setError(""); setNotice(""); setResults([]);
    const out: RecycleResult[] = [];
    try {
      for (const p of pairs.filter((x) => x.on && x.sourceId && x.targetId && x.sourceId !== x.targetId)) {
        const src = sequences.find((s) => s.id === p.sourceId)!;
        const tgt = sequences.find((s) => s.id === p.targetId)!;
        out.push(await findRecycleCandidates(src, tgt, days, recycledIds, (m) => setStatus(`${tgt.name}: ${m}`)));
      }
      setResults(out);
      setPicked(new Set(out.flatMap((r) => r.keep.filter((k) => k.ready).map((k) => `${r.sourceId}>${r.targetId}:${k.contactId}`))));
    } catch (e) { setError((e as Error).message); }
    setStatus(""); setBusy(false);
  }

  function askPush(r: RecycleResult) {
    const ids = r.keep.filter((k) => picked.has(`${r.sourceId}>${r.targetId}:${k.contactId}`)).map((k) => k.contactId);
    if (!ids.length) return;
    const owner = sequences.find((s) => s.id === r.targetId)?.ownerId;
    const box = mailboxes.find((b) => b.ownerId === owner && b.isDefault) || mailboxes.find((b) => b.ownerId === owner);
    setConfirm({ result: r, ids, mailboxId: box?.id || "" });
  }

  async function push() {
    if (!confirm) return;
    setBusy(true); setError("");
    try {
      const r = await pushToRecycled(confirm.result.targetId, confirm.ids, confirm.mailboxId);
      const skippedN = Object.keys(r.skipped).length;
      const why = [...new Set(Object.values(r.skipped))].map((x) => x.replace(/_/g, " ")).join(", ");
      setNotice(`Added ${r.enrolled.length} of ${confirm.ids.length} to ${name(confirm.result.targetId)}${skippedN ? `. ${skippedN} skipped by Apollo (${why})` : ""}.`);
      const done = new Set(r.enrolled);
      setResults((rs) => rs.map((x) => x.targetId === confirm.result.targetId && x.sourceId === confirm.result.sourceId ? { ...x, keep: x.keep.filter((k) => !done.has(k.contactId)) } : x));
    } catch (e) { setError((e as Error).message); }
    setConfirm(null); setBusy(false);
  }

  if (!targets.length) return <div className="panel" style={{ padding: 16 }}>No sequence with "Recycled" in its name. Create one in Apollo first.</div>;

  return (
    <div data-recycle>
      <div className="panel" style={{ marginBottom: 12 }}>
        <div className="panel-head">
          <div className="panel-title">Recycle finished leads</div>
          <div className="panel-sub">Finished the main sequence with only no answer, gatekeeper or voicemail; pushed {RECYCLE_REST_BUSINESS_DAYS} business days after they finished.</div>
        </div>
        <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {pairs.map((p) => (
            <div key={p.id} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }} data-recycle-row>
              <input type="checkbox" aria-label="Use this row" checked={p.on} onChange={(e) => setPair(p.id, { on: e.target.checked })} />
              <span className="panel-sub">Finished in</span>
              <select className="field" aria-label="Finished in" value={p.sourceId} onChange={(e) => setPair(p.id, { sourceId: e.target.value })}>
                <option value="">Pick a sequence…</option>
                {others.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <span className="panel-sub">push to</span>
              <select className="field" aria-label="Push to" value={p.targetId} onChange={(e) => setPair(p.id, { targetId: e.target.value })}>
                <option value="">Pick a sequence…</option>
                <optgroup label="Recycled sequences">{targets.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>
                <optgroup label="Other sequences">{others.filter((s) => s.id !== p.sourceId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>
              </select>
              {pairs.length > 1 && <button className="btn btn-ghost btn-sm" aria-label="Remove row" onClick={() => setPairs((ps) => ps.filter((x) => x.id !== p.id))}>✕</button>}
            </div>
          ))}
          <div><button className="btn btn-ghost btn-sm" onClick={() => setPairs((ps) => [...ps, { id: `p${Date.now()}`, sourceId: "", targetId: targets[0]?.id || "", on: true }])}>+ Add a row</button></div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 4 }}>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>Finished in the last
              <input className="field" type="number" min={1} max={365} aria-label="Timeframe in days" value={days} onChange={(e) => setDaysSaved(Number(e.target.value))} style={{ width: 70 }} /> days
            </label>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="checkbox" checked={readyOnly} onChange={(e) => setReadyOnly(e.target.checked)} /> Only show leads ready now
            </label>
            <button className="btn btn-primary btn-sm" disabled={busy || !(days > 0) || !pairs.some((x) => x.on && x.sourceId && x.targetId && x.sourceId !== x.targetId)} onClick={refresh}>↻ Refresh</button>
          </div>
        </div>
      </div>

      {error && <div className="panel" style={{ borderColor: "var(--danger)", color: "var(--danger)", padding: 12, marginBottom: 12 }}>{error}</div>}
      {status && <div className="panel-sub" style={{ marginBottom: 12 }}>⏳ {status}</div>}
      {notice && <div className="panel" style={{ padding: 12, marginBottom: 12, borderColor: "var(--success)" }}>✓ {notice}</div>}

      {results.map((r) => {
        const rows = r.keep.filter((k) => !readyOnly || k.ready);
        const ready = r.keep.filter((k) => k.ready).length;
        const sel = r.keep.filter((k) => picked.has(`${r.sourceId}>${r.targetId}:${k.contactId}`)).length;
        const reasons = new Map<string, number>();
        for (const x of r.excluded) reasons.set(x.reason, (reasons.get(x.reason) || 0) + 1);
        const allOn = rows.length > 0 && rows.every((k) => picked.has(`${r.sourceId}>${r.targetId}:${k.contactId}`));
        return (
          <div key={`${r.sourceId}>${r.targetId}`} className="panel" style={{ marginBottom: 14 }} data-recycle-pair>
            <div className="panel-head">
              <div className="panel-title">{name(r.sourceId)} → {name(r.targetId)}</div>
              <button className="btn btn-primary btn-sm" disabled={busy || !sel} onClick={() => askPush(r)}>Push {sel} to {name(r.targetId)}</button>
            </div>
            <div className="panel-body">
              <div className="panel-sub" style={{ marginBottom: 8 }}>
                {r.finished} finished in the last {days} days · <strong>{ready} ready now</strong> · {r.keep.length - ready} waiting out the rest · {r.excluded.length} left out
              </div>
              {r.excluded.length > 0 && (
                <details style={{ marginBottom: 8 }}>
                  <summary className="panel-sub" style={{ cursor: "pointer" }}>Why {r.excluded.length} were left out: {[...reasons].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} (${n})`).join(", ")}</summary>
                  <ul style={{ maxHeight: 200, overflowY: "auto", fontSize: 13 }}>{r.excluded.map((x) => <li key={x.contactId}>{x.name} · {x.company}: {x.reason}</li>)}</ul>
                </details>
              )}
              <table className="data-table">
                <thead><tr>
                  <th><input type="checkbox" aria-label="Select all" checked={allOn} onChange={() => setPicked((p) => { const n = new Set(p); rows.forEach((k) => { const key = `${r.sourceId}>${r.targetId}:${k.contactId}`; if (allOn) n.delete(key); else n.add(key); }); return n; })} /></th>
                  <th>Lead</th><th>Finished</th><th>Calls</th><th>Ready</th>
                </tr></thead>
                <tbody>
                  {rows.length === 0 && <tr><td colSpan={5} className="cell-empty">{readyOnly && r.keep.length ? "Nobody is ready yet. Untick “Only show leads ready now” to see who's waiting." : "Nobody to recycle in this timeframe."}</td></tr>}
                  {rows.map((k) => {
                    const key = `${r.sourceId}>${r.targetId}:${k.contactId}`;
                    return (
                      <tr key={key}>
                        <td><input type="checkbox" checked={picked.has(key)} onChange={() => setPicked((p) => { const n = new Set(p); if (n.has(key)) n.delete(key); else n.add(key); return n; })} /></td>
                        <td><strong>{k.name}</strong><div className="panel-sub">{k.company}{k.email ? ` · ${k.email}` : ""}</div></td>
                        <td>{k.finishedAt}</td>
                        <td className="panel-sub">{k.calls ? `${k.calls} · ${k.lastOutcome}` : "None logged"}</td>
                        <td>{k.ready ? <span className="status-pill success">Ready</span> : <span className="status-pill neutral">From {k.readyOn}</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      {confirm && (
        <div role="dialog" aria-modal="true" style={{ position: "fixed", inset: 0, background: "rgba(8,30,34,0.35)", zIndex: 1000, overflowY: "auto", padding: 20 }} onClick={() => !busy && setConfirm(null)}>
          <div className="panel" style={{ maxWidth: 540, margin: "10vh auto", padding: 20 }} onClick={(e) => e.stopPropagation()}>
            <div className="panel-title" style={{ marginBottom: 8 }}>Push to {name(confirm.result.targetId)}</div>
            <p><strong>{confirm.ids.length}</strong> lead{confirm.ids.length === 1 ? "" : "s"} who finished {name(confirm.result.sourceId)} in the last {days} days. They start at step 1, active, and real emails go out from the mailbox below.</p>
            <p>Checked first: none are active in another sequence, none replied, unsubscribed, bounced or have a deal, and their calls were only no answer, gatekeeper or voicemail.</p>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>Send from
              <select className="field" aria-label="Send from" value={confirm.mailboxId} onChange={(e) => setConfirm({ ...confirm, mailboxId: e.target.value })}>
                <option value="">Pick a mailbox…</option>
                {mailboxes.map((b) => <option key={b.id} value={b.id}>{b.email}{b.ownerName ? ` (${b.ownerName})` : ""}</option>)}
              </select>
            </label>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
              <button className="btn btn-secondary" disabled={busy} onClick={() => setConfirm(null)}>Cancel</button>
              <button className="btn btn-primary" disabled={busy || !confirm.mailboxId} onClick={push}>{busy ? "Adding…" : `Push ${confirm.ids.length}`}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
