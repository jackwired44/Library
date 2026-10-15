// In Apollo — is this lead active in Apollo, and in which sequence.
//
// Per Jack: "the apollo queue isnt what i want … i want to be able to see if
// a lead is active in apollo from here and if so which sequence." This
// replaces the queue (which pre-assigned sequences here, something he does
// in Apollo, not in this platform).
//
// Read-only. Two sources, both already on the device:
//   - an imported Apollo sync matched to the lead (lead.apollo), which
//     carries each sequence's status, step and date;
//   - the pulled Apollo uploads (the roster), matched by email or a unique
//     full name, which carries each sequence with "(active)" on live ones.
// Nothing here writes to Apollo or assigns anything.
import { useMemo, useRef, useState } from "react";
import type { StoredLead } from "../lib/leadStore";
import { apolloHitFor, type RosterIndex } from "../lib/apolloRoster";
import { DEFAULT_PULL_MONTHS, type PullProgress, type CheckProgress } from "../lib/apolloLive";
import { VERDICT_META, VERDICT_ORDER, verdictOf, type Verdict } from "../lib/leadStatus";

type Status = "active" | "finished" | "none" | "out";
const STATUS_META: Record<Status, { label: string; hint: string; color: string; bg: string }> = {
  active: { label: "Active in a sequence", hint: "In Apollo and live in at least one sequence right now.", color: "#0A66C2", bg: "#EAF3FC" },
  finished: { label: "In Apollo, sequence ended", hint: "In Apollo; every sequence they were in has finished, paused or stopped.", color: "#5B3FC4", bg: "#EEEAFC" },
  none: { label: "In Apollo, no sequence", hint: "A contact in Apollo, never put in a sequence.", color: "#4C6167", bg: "#EEF1F2" },
  out: { label: "Not in Apollo", hint: "Not found by the Apollo check, a sync or your pulled uploads. \"Matched by\" says whether it was actually looked up.", color: "#4C6167", bg: "transparent" },
};
const STATUS_ORDER: Status[] = ["active", "finished", "none", "out"];

interface Seq { name: string; active: boolean; status: string; step: number | null; addedAt: string; steps?: number; finishedAt?: string; reason?: string }
interface Row { lead: StoredLead; status: Status; seqs: Seq[]; how: string }

const PAGE = 100;

function rowFor(l: StoredLead, index: RosterIndex | null): Row {
  if (l.apollo) {
    const seqs = l.apollo.sequences.map((s) => ({
      name: s.name, active: s.status === "active", status: s.status, step: s.step, addedAt: s.addedAt ?? "",
      steps: s.steps, finishedAt: s.finishedAt, reason: s.reason,
    }));
    const lv = l.apollo.live;
    const how = lv
      ? [`Apollo check ${l.apollo.syncedAt.slice(0, 10)}`, lv.owner && `owner ${lv.owner}`, lv.lastActivityAt && `last activity ${lv.lastActivityAt}`].filter(Boolean).join(" · ")
      : "Apollo sync";
    return { lead: l, seqs, how, status: seqs.some((s) => s.active) ? "active" : seqs.length ? "finished" : "none" };
  }
  const hit = apolloHitFor({ email: l.email, contact: l.contact }, index);
  if (!hit) return l.apolloCheckedAt
    ? { lead: l, seqs: [], how: `Apollo check ${l.apolloCheckedAt.slice(0, 10)}`, status: "out" }
    : { lead: l, seqs: [], how: "not checked yet", status: "out" };
  const seqs = hit.sequences.map((label) => {
    const active = /\(active\)$/.test(label);
    return { name: label.replace(/\s*\(active\)$/, ""), active, status: active ? "active" : "ended", step: null, addedAt: "" };
  });
  return {
    lead: l, seqs, how: hit.how === "email" ? "email" : "name",
    status: seqs.some((s) => s.active) ? "active" : seqs.length ? "finished" : "none",
  };
}

export default function ApolloStatus({
  leads, apolloIndex, rosterPulledAt = "", onPullApollo, onCheckLeads,
}: {
  leads: StoredLead[];
  apolloIndex: RosterIndex | null;
  rosterPulledAt?: string;
  onPullApollo?: (months: number, onProgress: (p: PullProgress) => void, signal: AbortSignal) => Promise<PullProgress>;
  onCheckLeads?: (leads: StoredLead[], onProgress: (p: CheckProgress) => void, signal: AbortSignal) => Promise<CheckProgress>;
}) {
  // Per Jack: "the contacts in the all leads here for strong signal only".
  const [verdictF, setVerdictF] = useState<Verdict | "all">("strong");
  const [statusF, setStatusF] = useState<Status | "all">("active");
  const [check, setCheck] = useState<CheckProgress | null>(null);
  const [checkError, setCheckError] = useState("");
  const [recheck, setRecheck] = useState(false);
  const checkAbort = useRef<AbortController | null>(null);
  const [seqF, setSeqF] = useState("all");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pull, setPull] = useState<PullProgress | null>(null);
  const [pullError, setPullError] = useState("");
  const [months, setMonths] = useState(DEFAULT_PULL_MONTHS);
  const abort = useRef<AbortController | null>(null);
  // Per Jack: "select all or select one by one or multiple". Lead keys.
  const [sel, setSel] = useState<Set<string>>(new Set());
  // Per Jack: "need to be able to select the quantity and not just all at
  // once every time". How many of the due Strong Signal leads one click runs.
  const [qty, setQty] = useState<number>(100);

  const rows = useMemo(() => leads
    .filter((l) => verdictF === "all" || verdictOf(l.tier) === verdictF)
    .map((l) => rowFor(l, apolloIndex)), [leads, apolloIndex, verdictF]);

  // The check runs over Strong Signal leads only. Leads looked up in the
  // last 7 days are skipped unless "re-check" is ticked, so a stopped run
  // picks up where it left off.
  const strong = useMemo(() => leads.filter((l) => verdictOf(l.tier) === "strong"), [leads]);
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const toCheck = useMemo(() => recheck ? strong : strong.filter((l) => !(l.apolloCheckedAt && l.apolloCheckedAt > weekAgo)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [strong, recheck]);

  // A selection is checked as picked — any tier, re-check or not.
  const selected = useMemo(() => leads.filter((l) => sel.has(l.key)), [leads, sel]);

  async function runCheck(only?: StoredLead[]) {
    const targets = only ?? (selected.length ? selected : (qty > 0 ? toCheck.slice(0, qty) : toCheck));
    if (!onCheckLeads || (check && !check.finished) || !targets.length) return;
    const ac = new AbortController();
    checkAbort.current = ac;
    setCheckError("");
    setCheck({ total: targets.length, done: 0, found: 0, notFound: 0, skipped: 0, errors: 0, finished: false });
    try {
      const p = await onCheckLeads(targets, setCheck, ac.signal);
      setCheck({ ...p, finished: true });
    } catch (e) {
      setCheckError(e instanceof Error ? e.message : String(e));
      setCheck((x) => (x ? { ...x, finished: true } : x));
    } finally { checkAbort.current = null; }
  }

  const counts = useMemo(() => {
    const m: Record<Status, number> = { active: 0, finished: 0, none: 0, out: 0 };
    for (const r of rows) m[r.status]++;
    return m;
  }, [rows]);

  // Sequences people are ACTIVE in, with how many — the "which sequence".
  const activeBySeq = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) for (const s of r.seqs) if (s.active) m.set(s.name, (m.get(s.name) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);
  const allSeqs = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) for (const s of r.seqs) m.set(s.name, (m.get(s.name) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);

  const needle = q.trim().toLowerCase();
  const filtered = useMemo(() => rows.filter((r) =>
    (statusF === "all" || r.status === statusF)
    && (seqF === "all" || r.seqs.some((s) => s.name === seqF && (statusF !== "active" || s.active)))
    && (!needle || `${r.lead.company} ${r.lead.contact} ${r.lead.email}`.toLowerCase().includes(needle)),
  ), [rows, statusF, seqF, needle]);
  const shown = filtered.slice((page - 1) * PAGE, page * PAGE);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));

  async function runPull() {
    if (!onPullApollo || (pull && !pull.done)) return;
    const ac = new AbortController();
    abort.current = ac;
    setPullError("");
    setPull({ pages: 0, scanned: 0, kept: 0, reachedDate: "", done: false, hitCeiling: false });
    try {
      const p = await onPullApollo(months, setPull, ac.signal);
      setPull({ ...p, done: true });
    } catch (e) {
      setPullError(e instanceof Error ? e.message : String(e));
      setPull((x) => (x ? { ...x, done: true } : x));
    } finally { abort.current = null; }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h2>In Apollo</h2>
          <p className="page-sub">Whether each lead here is in Apollo, and which sequence they're active in.</p>
        </div>
      </div>

      {onCheckLeads && (
        <div className="panel" style={{ marginBottom: 10 }}>
          <div className="panel-body" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 12.5 }}>
            <span style={{ color: "var(--muted)" }}>
              Look up each <b style={{ color: "var(--ink)" }}>Strong Signal</b> lead in Apollo — sequence, step, finished and why.
              Free and read-only; nothing is written to Apollo.
            </span>
            <div className="toolbar-spacer" />
            <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}>
              <input type="checkbox" checked={recheck} disabled={!!check && !check.finished} onChange={(e) => setRecheck(e.target.checked)} />
              Re-check ones done this week
            </label>
            {check && !check.finished
              ? <button className="btn btn-sm btn-secondary" onClick={() => checkAbort.current?.abort()}>Stop</button>
              : selected.length > 0
                ? <button className="btn btn-sm btn-primary" onClick={() => runCheck()}
                          title="One Apollo contact search per selected lead. Free, read-only.">
                    Check {selected.length.toLocaleString()} selected
                  </button>
                : <>
                    <select className="field" aria-label="How many to check" value={qty}
                            onChange={(e) => setQty(Number(e.target.value))}>
                      {[10, 25, 50, 100, 250, 500, 1000].map((n) => <option key={n} value={n}>{n.toLocaleString()} at a time</option>)}
                      <option value={0}>All due</option>
                    </select>
                    <button className="btn btn-sm btn-primary" disabled={!toCheck.length} onClick={() => runCheck()}
                            title="One Apollo contact search per lead, by email (or full name + company). Free, read-only. Next run picks up where this one stopped.">
                      {(() => { const n = qty > 0 ? Math.min(qty, toCheck.length) : toCheck.length;
                        return <>Check {n.toLocaleString()} Strong Signal lead{n === 1 ? "" : "s"}{n < toCheck.length ? <span style={{ opacity: 0.75 }}> of {toCheck.length.toLocaleString()}</span> : null}</>; })()}
                    </button>
                  </>}
          </div>
          {(check || checkError) && (
            <div className="panel-body" style={{ paddingTop: 0, fontSize: 12 }} aria-label="Apollo check">
              {check && <>
                {check.finished ? "Checked" : "Checking…"} <b>{check.done.toLocaleString()}</b> of {check.total.toLocaleString()}
                {" · "}<b>{check.found.toLocaleString()}</b> in Apollo · {check.notFound.toLocaleString()} not in Apollo
                {check.skipped > 0 && <> · {check.skipped.toLocaleString()} skipped (no email or full name)</>}
                {check.errors > 0 && <span style={{ color: "#B5443B" }}> · {check.errors} failed{check.lastError ? `: ${check.lastError}` : ""}</span>}
              </>}
              {checkError && <span style={{ color: "#B5443B" }}> Apollo check stopped: {checkError}</span>}
            </div>
          )}
        </div>
      )}

      <div className="panel" style={{ marginBottom: 10 }}>
        <div className="panel-body" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 12.5 }}>
          <span style={{ color: "var(--muted)" }}>
            {rosterPulledAt
              ? <>Apollo uploads last pulled <b style={{ color: "var(--ink)" }}>{rosterPulledAt.slice(0, 10)}</b>. Sequence status is only as fresh as that.</>
              : <>Apollo uploads not pulled yet — pull them to see who is active in which sequence.</>}
          </span>
          <div className="toolbar-spacer" />
          {onPullApollo && (
            <>
              <select className="field" aria-label="How far back" value={months} disabled={!!pull && !pull.done}
                      onChange={(e) => setMonths(Number(e.target.value))}>
                {[1, 2, 3, 4, 6].map((m) => <option key={m} value={m}>Last {m} month{m === 1 ? "" : "s"}</option>)}
              </select>
              {pull && !pull.done
                ? <button className="btn btn-sm btn-secondary" onClick={() => abort.current?.abort()}>Stop</button>
                : <button className="btn btn-sm btn-primary" onClick={runPull}
                          title="Read the CSV uploads you made into Apollo for you and Carly, with each contact's sequences. Read-only.">
                    ⟳ Refresh from Apollo
                  </button>}
            </>
          )}
        </div>
        {(pull || pullError) && (
          <div className="panel-body" style={{ paddingTop: 0, fontSize: 12 }} aria-label="Apollo pull">
            {pull && !pull.done && <>Reading Apollo… {pull.scanned.toLocaleString()} contacts read, back to {pull.reachedDate || "—"} · <b>{pull.kept.toLocaleString()}</b> of yours kept.</>}
            {pull && pull.done && !pullError && <>Pulled <b>{pull.kept.toLocaleString()}</b> Apollo uploads{pull.reachedDate ? ` back to ${pull.reachedDate}` : ""}.{pull.hitCeiling && " Apollo's 50,000-contact limit stopped it early — pick a shorter window."}</>}
            {pullError && <span style={{ color: "#B5443B" }}>Apollo pull stopped: {pullError}</span>}
          </div>
        )}
      </div>

      <div className="panel" style={{ marginBottom: 10 }}>
        <div className="panel-body" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {STATUS_ORDER.map((s) => {
            const on = statusF === s; const m = STATUS_META[s];
            return (
              <button key={s} className="vault-tile" aria-pressed={on} title={m.hint}
                      style={{ borderColor: on ? m.color : undefined, background: on && m.bg !== "transparent" ? m.bg : undefined }}
                      onClick={() => { setStatusF(on ? "all" : s); setPage(1); }}>
                <span className="vault-num" style={{ color: m.color }}>{counts[s].toLocaleString()}</span>
                <span>{m.label}</span>
              </button>
            );
          })}
        </div>
        {activeBySeq.length > 0 && (
          <div className="panel-body" style={{ paddingTop: 0, fontSize: 12, color: "var(--muted)" }}>
            Active by sequence:{" "}
            {activeBySeq.map(([n, c], i) => (
              <span key={n}>
                {i > 0 && " · "}
                <button className="btn btn-sm btn-ghost" style={{ padding: "0 4px" }}
                        onClick={() => { setStatusF("active"); setSeqF(n); setPage(1); }}>
                  {n} <b>{c.toLocaleString()}</b>
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="toolbar">
        <div className="toolbar-row">
          <input className="field" placeholder="Search company, contact, email…" value={q}
                 onChange={(e) => { setQ(e.target.value); setPage(1); }} style={{ flex: 1, minWidth: 220, maxWidth: 360 }} />
          <select className="field" aria-label="Stored as" value={verdictF} onChange={(e) => { setVerdictF(e.target.value as Verdict | "all"); setPage(1); }}>
            <option value="all">Stored as: any</option>
            {VERDICT_ORDER.map((v) => <option key={v} value={v}>{VERDICT_META[v].label}</option>)}
          </select>
          <select className="field" aria-label="Sequence" value={seqF} onChange={(e) => { setSeqF(e.target.value); setPage(1); }}>
            <option value="all">Sequence: any</option>
            {allSeqs.map(([n, c]) => <option key={n} value={n}>{n} ({c.toLocaleString()})</option>)}
          </select>
          <div className="toolbar-spacer" />
          <span style={{ fontSize: 12, color: "var(--muted)" }}><b>{filtered.length.toLocaleString()}</b> of {rows.length.toLocaleString()}</span>
        </div>
        <div className="toolbar-row" aria-label="Selection" style={{ fontSize: 12 }}>
          <button className="btn btn-sm btn-ghost" disabled={!shown.length}
                  onClick={() => setSel((s) => { const n = new Set(s); shown.forEach((r) => n.add(r.lead.key)); return n; })}>
            Select page ({shown.length.toLocaleString()})
          </button>
          <button className="btn btn-sm btn-ghost" disabled={!filtered.length}
                  onClick={() => setSel(new Set(filtered.map((r) => r.lead.key)))}>
            Select all {filtered.length.toLocaleString()} matched
          </button>
          {sel.size > 0 && <>
            <span><b>{sel.size.toLocaleString()}</b> selected</span>
            <button className="btn btn-sm btn-ghost" onClick={() => setSel(new Set())}>Clear</button>
          </>}
          {statusF === "active" && counts.active === 0 && (
            <span className="muted">Nobody shows as active yet — click "Active in a sequence" again to list every lead and pick from them.</span>
          )}
        </div>
      </div>

      <div className="table-card" style={{ maxHeight: "calc(100vh - 330px)", minHeight: 240, overflow: "auto" }}>
        <table className="data-table dense-table">
          <thead>
            <tr>
              <th style={{ width: 28 }}>
                <input type="checkbox" aria-label="Select this page"
                       checked={shown.length > 0 && shown.every((r) => sel.has(r.lead.key))}
                       onChange={(e) => setSel((s) => { const n = new Set(s); shown.forEach((r) => (e.target.checked ? n.add(r.lead.key) : n.delete(r.lead.key))); return n; })} />
              </th>
              <th>Company</th>
              <th>Contact</th>
              <th>Stored as</th>
              <th>In Apollo</th>
              <th>Sequence</th>
              <th title="How this lead was matched to Apollo">Matched by</th>
              {onCheckLeads && <th />}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const v = VERDICT_META[verdictOf(r.lead.tier)];
              const m = STATUS_META[r.status];
              const ordered = [...r.seqs].sort((a, b) => Number(b.active) - Number(a.active));
              return (
                <tr key={r.lead.key}>
                  <td>
                    <input type="checkbox" aria-label={`Select ${r.lead.contact || r.lead.company}`} checked={sel.has(r.lead.key)}
                           onChange={() => setSel((s) => { const n = new Set(s); if (n.has(r.lead.key)) n.delete(r.lead.key); else n.add(r.lead.key); return n; })} />
                  </td>
                  <td className="strong" title={r.lead.company}>{r.lead.company || "—"}</td>
                  <td title={[r.lead.contact, r.lead.title, r.lead.email].filter(Boolean).join(" · ")}>{r.lead.contact || "—"}</td>
                  <td><span className="pill" style={{ color: v.color, background: v.bg }}>{v.label}</span></td>
                  <td>{r.status === "out" ? <span className="muted">No</span>
                    : <span className="pill" style={{ color: m.color, background: m.bg }}>{r.status === "active" ? "Active" : r.status === "finished" ? "Ended" : "No sequence"}</span>}</td>
                  <td className="wide">
                    {ordered.length === 0 ? <span className="muted">—</span> : ordered.map((s, i) => (
                      <div key={`${s.name}-${i}`} style={{ color: s.active ? "var(--ink)" : "var(--muted)" }}>
                        {s.active && <b style={{ color: "#0A66C2" }}>● </b>}{s.name}
                        <span className="muted">
                          {" · "}{s.active ? "active" : s.status}
                          {s.step != null ? ` · step ${s.step}${s.steps ? ` of ${s.steps}` : ""}` : ""}
                          {s.addedAt ? ` · added ${s.addedAt}` : ""}
                          {s.finishedAt ? ` · ended ${s.finishedAt}` : ""}
                          {s.reason ? ` · "${s.reason}"` : ""}
                        </span>
                      </div>
                    ))}
                  </td>
                  <td className="muted">{r.how || "—"}</td>
                  {onCheckLeads && (
                    <td>
                      <button className="btn btn-sm btn-ghost" disabled={!!check && !check.finished} onClick={() => runCheck([r.lead])}
                              title="Look up just this lead in Apollo">Check</button>
                    </td>
                  )}
                </tr>
              );
            })}
            {shown.length === 0 && (
              <tr><td colSpan={onCheckLeads ? 8 : 7} style={{ textAlign: "center", padding: 24, color: "var(--muted)" }}>
                {rows.length === 0 ? "No leads stored yet." : "No leads match."}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="pager" style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
        <button className="btn btn-sm btn-ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</button>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>page {page} of {pages}</span>
        <button className="btn btn-sm btn-ghost" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</button>
      </div>
    </>
  );
}
