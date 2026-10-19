// One page per rep: everything assigned to Carly (or Jack), where each lead
// stands, what is active, and where the leads went.
//
// Per Jack: "build a table for all of carlys leads and jacks", then "want her
// to have access to her assigned leads and see where they all stand whats
// active high level view like a dash or chart of where it went".
//
// Ownership comes from lib/reps.ts (the rep named on the sequence, else the
// Apollo contact owner). Every number is derived from what the leads already
// carry — statusOf, the Apollo calls, the recycle rules — so it agrees with
// All leads and Home.
import { useMemo, useState } from "react";
import type { StoredLead } from "../lib/leadStore";
import type { RosterIndex } from "../lib/apolloRoster";
import { STATUS_META, statusOf, wasReached, type LeadStatus } from "../lib/leadStatus";
import { REPS, UNASSIGNED, ownersOfLead } from "../lib/reps";
import { recycleOf, type RecycleRules } from "../lib/recycle";
import { stripSnippetPrefix } from "../lib/detection";
import { toCSV, downloadBlob } from "../lib/csv";
import { apolloHitFor, type ApolloRosterEntry } from "../lib/apolloRoster";
import type { ApolloFunnel } from "../lib/apolloFunnel";
import { MAIN_SEQUENCES } from "./ApolloStatus";

const REP_KEY = "repView";
const PAGE = 50;
const TOP = new Set(["High priority", "Strong Signal"]);

interface Row { l: StoredLead; owners: string[]; status: LeadStatus; seqs: string[]; active: string[] }

interface Summary {
  leads: number; strong: number; sequenced: number; active: number; called: number; reached: number;
  meetings: number; notInterested: number; finishedNoContact: number; calls: number; emails: number; recycleReady: number;
}

function summarize(rows: Row[], rules: RecycleRules): Summary {
  const s: Summary = { leads: 0, strong: 0, sequenced: 0, active: 0, called: 0, reached: 0, meetings: 0, notInterested: 0, finishedNoContact: 0, calls: 0, emails: 0, recycleReady: 0 };
  for (const r of rows) {
    const a = r.l.apollo;
    s.leads++;
    if (TOP.has(r.l.tier)) s.strong++;
    if (r.seqs.length) s.sequenced++;
    if (r.status === "in-sequence") s.active++;
    if ((a?.callCount ?? 0) > 0) s.called++;
    if (wasReached(a) || r.status === "meeting" || r.status === "not-interested") s.reached++;
    if (r.status === "meeting") s.meetings++;
    if (r.status === "not-interested") s.notInterested++;
    if (r.status === "finished" || r.status === "called") s.finishedNoContact++;
    s.calls += a?.callCount ?? 0;
    s.emails += a?.emailCount ?? 0;
    if (recycleOf(r.l, rules).stage === "ready") s.recycleReady++;
  }
  return s;
}

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "—");

function Bar({ label, n, of, color, onClick, active }: { label: string; n: number; of: number; color: string; onClick?: () => void; active?: boolean }) {
  const w = of ? Math.max(n ? 2 : 0, (n / of) * 100) : 0;
  return (
    <button onClick={onClick} disabled={!onClick} aria-pressed={active}
            style={{ display: "grid", gridTemplateColumns: "170px 1fr 90px", gap: 10, alignItems: "center", width: "100%", background: active ? "var(--surface-sunken)" : "none", border: 0, padding: "4px 6px", borderRadius: 6, cursor: onClick ? "pointer" : "default", textAlign: "left", font: "inherit", color: "inherit" }}>
      <span style={{ fontSize: 12.5 }}>{label}</span>
      <span style={{ background: "var(--surface-sunken)", borderRadius: 4, height: 14, overflow: "hidden" }}>
        <span style={{ display: "block", width: `${w}%`, height: "100%", background: color, borderRadius: 4 }} />
      </span>
      <span style={{ fontSize: 12.5, textAlign: "right" }}><b>{n.toLocaleString()}</b> <span className="muted">{pct(n, of)}</span></span>
    </button>
  );
}

export default function Reps({ leads, apolloIndex, recycleRules, roster = [], funnels = [] }: {
  /** Every pulled Apollo contact — for the sequences' "In Apollo" counts. */
  roster?: ApolloRosterEntry[];
  /** Imported sequence funnels — for step counts. */
  funnels?: ApolloFunnel[];
  leads: StoredLead[];
  apolloIndex: RosterIndex | null;
  recycleRules: RecycleRules;
}) {
  const [rep, setRepState] = useState<string>(() => { try { return localStorage.getItem(REP_KEY) || "Carly"; } catch { return "Carly"; } });
  const setRep = (r: string) => { setRepState(r); setStatusF("all"); setSeqF(""); setPage(0); try { localStorage.setItem(REP_KEY, r); } catch { /* preference only */ } };
  const [statusF, setStatusF] = useState<LeadStatus | "all">("all");
  const [q, setQ] = useState("");
  const [seqF, setSeqF] = useState("");
  const [page, setPage] = useState(0);

  const rows: Row[] = useMemo(() => leads.map((l) => {
    const live = (l.apollo?.sequences ?? []).map((s) => ({ name: s.name, active: s.status === "active" }));
    const hit = l.apollo ? null : apolloHitFor({ email: l.email, contact: l.contact, company: l.company }, apolloIndex);
    const pulled = (hit?.sequences ?? []).map((x) => ({ name: x.replace(/\s*\(active\)$/, ""), active: /\(active\)$/.test(x) }));
    const seqs = [...live, ...pulled];
    return {
      l, owners: ownersOfLead(l, apolloIndex), status: statusOf(l),
      seqs: [...new Set(seqs.map((s) => s.name))], active: [...new Set(seqs.filter((s) => s.active).map((s) => s.name))],
    };
  }), [leads, apolloIndex]);

  const byRep = useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const r of [...REPS, UNASSIGNED]) m.set(r, []);
    for (const r of rows) {
      if (!r.owners.length) { m.get(UNASSIGNED)!.push(r); continue; }
      for (const o of r.owners) { if (!m.has(o)) m.set(o, []); m.get(o)!.push(r); }
    }
    return m;
  }, [rows]);

  const summaries = useMemo(() => [...byRep].map(([name, rs]) => ({ name, s: summarize(rs, recycleRules) })), [byRep, recycleRules]);
  const mine = useMemo(() => byRep.get(rep) ?? [], [byRep, rep]);
  const s = summaries.find((x) => x.name === rep)?.s ?? summarize([], recycleRules);

  const statusCounts = useMemo(() => {
    const m = new Map<LeadStatus, number>();
    for (const r of mine) m.set(r.status, (m.get(r.status) || 0) + 1);
    return m;
  }, [mine]);

  // Per Jack: "for rep page need to have associated sequences fall there for
  // carly and jack". Every sequence carrying the rep's name is listed, from
  // anywhere the platform has seen it (the main sequences, imported funnels,
  // the pulled Apollo uploads, the leads' own sequences), even at zero
  // leads. "In Apollo" counts every pulled contact in it, not only the
  // contacts that are stored leads here.
  const bySequence = useMemo(() => {
    type Row = { inApollo: number; activeInApollo: number; total: number; active: number; reached: number; meetings: number; steps: number | null };
    const blank = (): Row => ({ inApollo: 0, activeInApollo: 0, total: 0, active: 0, reached: 0, meetings: 0, steps: null });
    const re = new RegExp(`\\b${rep}\\b`, "i");
    const anyRep = new RegExp(`\\b(${REPS.join("|")})\\b`, "i");
    const mineName = (n: string) => (rep === UNASSIGNED ? !anyRep.test(n) : re.test(n));
    const m = new Map<string, Row>();
    const row = (n: string) => { let e = m.get(n); if (!e) { e = blank(); m.set(n, e); } return e; };
    if (rep !== UNASSIGNED) {
      for (const n of MAIN_SEQUENCES) if (re.test(n)) row(n);
      for (const f of funnels) if (re.test(f.name)) row(f.name).steps = f.steps.length || null;
    }
    for (const r of roster) for (const label of r.sequences) {
      const name = label.replace(/\s*\(active\)$/, "");
      if (rep === UNASSIGNED || !mineName(name)) continue;
      const e = row(name);
      e.inApollo++;
      if (/\(active\)$/.test(label)) e.activeInApollo++;
    }
    for (const r of mine) {
      // Count only this rep's sequences, unless the lead is theirs by
      // contact owner and no sequence carries their name.
      const named = r.seqs.filter((n) => mineName(n));
      for (const name of rep === UNASSIGNED || !named.length ? r.seqs : named) {
        const e = row(name);
        e.total++;
        if (r.active.includes(name)) e.active++;
        if (wasReached(r.l.apollo) || r.status === "not-interested") e.reached++;
        if (r.status === "meeting") e.meetings++;
      }
    }
    for (const f of funnels) { const e = m.get(f.name); if (e && e.steps === null) e.steps = f.steps.length || null; }
    const rank = new Map<string, number>(MAIN_SEQUENCES.map((n, i) => [n.toLowerCase(), i]));
    return [...m].sort((a, b) =>
      (rank.get(a[0].toLowerCase()) ?? 99) - (rank.get(b[0].toLowerCase()) ?? 99)
      || (b[1].total + b[1].inApollo) - (a[1].total + a[1].inApollo) || a[0].localeCompare(b[0]));
  }, [mine, rep, roster, funnels]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return mine.filter((r) => (statusF === "all" || r.status === statusF)
      && (!seqF || r.seqs.includes(seqF))
      && (!needle || `${r.l.contact} ${r.l.company} ${r.l.email} ${r.l.title}`.toLowerCase().includes(needle)));
  }, [mine, statusF, q, seqF]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const p = Math.min(page, pages - 1);
  const shown = filtered.slice(p * PAGE, p * PAGE + PAGE);

  const download = () => {
    const cols = ["Rep", "First Name", "Last Name", "Company", "Title", "Email", "Phone", "Stored As", "Where it stands", "Active sequence", "Sequences", "Calls", "Emails", "Last outcome", "Last call", "Recycle", "Notes"] as const;
    const data = filtered.map((r) => {
      const [first, ...rest] = (r.l.contact || "").trim().split(/\s+/);
      const a = r.l.apollo;
      const rc = recycleOf(r.l, recycleRules);
      return {
        Rep: rep, "First Name": first || "", "Last Name": rest.join(" "), Company: r.l.company, Title: r.l.title, Email: r.l.email, Phone: r.l.phone,
        "Stored As": r.l.tier, "Where it stands": STATUS_META[r.status].label, "Active sequence": r.active.join(" | "), Sequences: r.seqs.join(" | "),
        Calls: a ? String(a.callCount) : "", Emails: a?.emailCount !== undefined ? String(a.emailCount) : "", "Last outcome": a?.lastOutcome || "",
        "Last call": (a?.lastCallAt || "").slice(0, 10), Recycle: rc.stage === "ready" ? "Ready" : rc.stage === "resting" ? `Resting until ${rc.recycleOn}` : "",
        Notes: stripSnippetPrefix(r.l.notes || ""),
      };
    });
    void downloadBlob(toCSV(data, cols), `${rep.toLowerCase()}-leads-${new Date().toISOString().slice(0, 10)}.csv`);
  };

  const funnel: { label: string; n: number; color: string }[] = [
    { label: "Assigned", n: s.leads, color: "#5C7379" },
    { label: "Put in a sequence", n: s.sequenced, color: "#0E7A72" },
    { label: "Called", n: s.called, color: "#8A6D3B" },
    { label: "Reached someone", n: s.reached, color: "#7A5AC8" },
    { label: "Meeting booked", n: s.meetings, color: "#0A66C2" },
  ];
  const standingOrder: LeadStatus[] = ["in-sequence", "called", "finished", "reached", "meeting", "not-interested", "sent", "queued", "qualified", "review", "disqualified"];

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Reps</h2>
          <div className="muted" style={{ fontSize: 13 }}>
            Each rep's assigned leads: the rep named on the Apollo sequence, else the Apollo contact owner. Leads with neither are Unassigned.
          </div>
        </div>
        <div className="seg" role="tablist" aria-label="Rep">
          {[...REPS, UNASSIGNED].map((r) => (
            <button key={r} role="tab" aria-selected={rep === r} className={`seg-btn${rep === r ? " active" : ""}`} onClick={() => setRep(r)}>{r}</button>
          ))}
        </div>
      </div>

      <div className="table-card" style={{ marginBottom: 12 }}>
        <table className="data-table" aria-label="Reps summary">
          <thead><tr>
            <th>Rep</th><th className="num">Leads</th><th className="num">Strong Signal</th><th className="num">Active now</th>
            <th className="num">Finished, no contact</th><th className="num">Reached</th><th className="num">Meetings</th>
            <th className="num">Not interested</th><th className="num">Calls</th><th className="num">Emails</th><th className="num">Ready to recycle</th>
          </tr></thead>
          <tbody>
            {summaries.map(({ name, s: x }) => (
              <tr key={name} onClick={() => setRep(name)} style={{ cursor: "pointer", background: name === rep ? "var(--surface-sunken)" : undefined }} aria-selected={name === rep}>
                <td style={{ fontWeight: 600 }}>{name}</td>
                <td className="num">{x.leads.toLocaleString()}</td><td className="num">{x.strong.toLocaleString()}</td>
                <td className="num">{x.active.toLocaleString()}</td><td className="num">{x.finishedNoContact.toLocaleString()}</td>
                <td className="num">{x.reached.toLocaleString()}</td><td className="num">{x.meetings.toLocaleString()}</td>
                <td className="num">{x.notInterested.toLocaleString()}</td><td className="num">{x.calls.toLocaleString()}</td>
                <td className="num">{x.emails.toLocaleString()}</td><td className="num">{x.recycleReady.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="metric-row" aria-label={`${rep} at a glance`} style={{ marginBottom: 12 }}>
        {[
          ["Assigned", s.leads], ["Active now", s.active], ["Reached", s.reached], ["Meetings", s.meetings],
          ["Calls made", s.calls], ["Ready to recycle", s.recycleReady],
        ].map(([label, n]) => (
          <div className="metric" key={label as string}>
            <div className="metric-label">{label}</div>
            <div className="metric-value">{(n as number).toLocaleString()}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))", gap: 12, marginBottom: 12 }}>
        <div className="panel" aria-label="Where the leads went">
          <div className="panel-head"><b>Where {rep === UNASSIGNED ? "they" : `${rep}'s leads`} went</b></div>
          <div className="panel-body">
            {funnel.map((f) => <Bar key={f.label} label={f.label} n={f.n} of={s.leads} color={f.color} />)}
            <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>Each step as a share of every assigned lead. From Apollo's sequences and call log.</div>
          </div>
        </div>
        <div className="panel" aria-label="Where they stand now">
          <div className="panel-head"><b>Where they stand now</b> <span className="muted" style={{ fontSize: 12 }}>click to filter the table</span></div>
          <div className="panel-body">
            {standingOrder.filter((k) => statusCounts.get(k)).map((k) => (
              <Bar key={k} label={STATUS_META[k].label} n={statusCounts.get(k) || 0} of={s.leads} color={STATUS_META[k].color}
                   active={statusF === k} onClick={() => { setStatusF(statusF === k ? "all" : k); setPage(0); }} />
            ))}
            {!s.leads && <div className="muted">No leads assigned yet.</div>}
          </div>
        </div>
      </div>

      <div className="table-card" style={{ marginBottom: 12 }}>
        <div className="panel-head" style={{ padding: "8px 12px" }}>
          <b>{rep === UNASSIGNED ? "Sequences with no rep's name" : `${rep}'s sequences`}</b>{" "}
          <span className="muted" style={{ fontSize: 12 }}>
            {rep === UNASSIGNED ? "" : `every sequence named for ${rep}; `}click one to see its leads below
          </span>
        </div>
        <table className="data-table" aria-label="By sequence">
          <thead><tr>
            <th>Sequence</th><th className="num">Steps</th>
            <th className="num" title="Contacts in this sequence among the pulled Apollo uploads, whether or not they are stored leads here">In Apollo</th>
            <th className="num" title="Of those, still active in the sequence">Active in Apollo</th>
            <th className="num" title="Stored leads here in this sequence">Our leads</th>
            <th className="num">Active now</th><th className="num">Reached</th><th className="num">Meetings</th>
          </tr></thead>
          <tbody>
            {bySequence.length === 0 && <tr><td colSpan={8} className="muted" style={{ padding: 12 }}>No sequences found for {rep} yet. Pull the Apollo uploads (All leads → Apollo) or run an Apollo check.</td></tr>}
            {bySequence.map(([name, e]) => (
              <tr key={name} onClick={() => { setSeqF(seqF === name ? "" : name); setPage(0); }} aria-selected={seqF === name}
                  style={{ cursor: "pointer", background: seqF === name ? "var(--surface-sunken)" : undefined }}>
                <td style={{ fontWeight: 600 }}>{name}</td>
                <td className="num">{e.steps ?? <span className="muted">—</span>}</td>
                <td className="num">{e.inApollo.toLocaleString()}</td><td className="num">{e.activeInApollo.toLocaleString()}</td>
                <td className="num">{e.total.toLocaleString()}</td><td className="num">{e.active.toLocaleString()}</td>
                <td className="num">{e.reached.toLocaleString()}</td><td className="num">{e.meetings.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="control-strip" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
        <input className="field" placeholder="Search name, company, email" aria-label="Search rep leads" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} style={{ minWidth: 220 }} />
        <select className="field" aria-label="Where it stands" value={statusF} onChange={(e) => { setStatusF(e.target.value as LeadStatus | "all"); setPage(0); }}>
          <option value="all">Anywhere</option>
          {standingOrder.map((k) => <option key={k} value={k}>{STATUS_META[k].label} ({(statusCounts.get(k) || 0).toLocaleString()})</option>)}
        </select>
        {seqF && <span className="chip" style={{ fontSize: 12 }}>Sequence: {seqF} <button className="btn btn-sm btn-ghost" aria-label="Clear sequence filter" onClick={() => setSeqF("")}>✕</button></span>}
        <span className="muted" style={{ fontSize: 12.5 }}>{filtered.length.toLocaleString()} of {mine.length.toLocaleString()} leads</span>
        <span style={{ flex: 1 }} />
        <button className="btn btn-sm btn-secondary" disabled={!filtered.length} onClick={download}>⬇ Download {filtered.length.toLocaleString()}</button>
      </div>

      <div className="table-card">
        <table className="data-table" aria-label={`${rep}'s leads`}>
          <thead><tr><th>Contact</th><th>Stands</th><th>Sequence</th><th className="num">Calls</th><th>Last outcome</th><th>Stored as</th><th>Note</th></tr></thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={7} className="muted" style={{ padding: 16 }}>No leads here.</td></tr>}
            {shown.map((r) => {
              const m = STATUS_META[r.status]; const a = r.l.apollo;
              const step = a?.sequences.find((x) => x.status === "active");
              return (
                <tr key={r.l.key}>
                  <td><div style={{ fontWeight: 600 }}>{r.l.contact || "—"}</div>
                    <div className="muted" style={{ fontSize: 12 }}>{[r.l.title, r.l.company].filter(Boolean).join(" · ")}</div>
                    <div className="muted" style={{ fontSize: 11.5 }}>{r.l.email}</div></td>
                  <td><span className="pill" style={{ color: m.color, background: m.bg }} title={m.hint}>{m.label}</span></td>
                  <td style={{ fontSize: 12 }}>{r.active.length ? <><b>{r.active.join(", ")}</b>{step?.step ? <span className="muted"> · step {step.step}{step.steps ? ` of ${step.steps}` : ""}</span> : null}</> : (r.seqs.join(", ") || <span className="muted">—</span>)}</td>
                  <td className="num">{a ? (a.callsUnknown ? "?" : a.callCount) : "—"}</td>
                  <td style={{ fontSize: 12, whiteSpace: "nowrap" }}>{a?.lastOutcome || "—"}{a?.lastCallAt && <div className="muted" style={{ fontSize: 11 }}>{a.lastCallAt.slice(0, 10)}</div>}</td>
                  <td style={{ fontSize: 12 }}>{r.l.tier}</td>
                  <td style={{ fontSize: 12, maxWidth: 320 }}><div style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }} title={r.l.notes}>{stripSnippetPrefix(r.l.notes || "")}</div></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="pager" style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
          <button className="btn btn-sm btn-secondary" disabled={p === 0} onClick={() => setPage(p - 1)}>Prev</button>
          <span className="muted" style={{ fontSize: 12.5 }}>Page {p + 1} of {pages}</span>
          <button className="btn btn-sm btn-secondary" disabled={p >= pages - 1} onClick={() => setPage(p + 1)}>Next</button>
        </div>
      )}
    </div>
  );
}
