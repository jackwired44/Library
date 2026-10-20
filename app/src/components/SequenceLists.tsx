// The four Apollo sequences the team works from, each as a list you can
// read at a glance and refresh.
//
// Per Jack: "for the apollo four seqeuences we are mainly working from jack
// main sequence, carly main sequnece and their backups or recycled sequence
// create lists in here so we can view them all quickly and we can update it".
//
// DERIVED, NOT STORED. Each list is everyone the platform knows to be in
// that sequence: the pulled Apollo uploads (Jack's and Carly's CSV
// imports) plus any stored lead a live Apollo check placed there. So it is
// never stale relative to what was last read, and "update it" is the
// existing read-only pull: nothing is written to Apollo.
import { useMemo, useRef, useState } from "react";
import type { ApolloRosterEntry } from "../lib/apolloRoster";
import { normPersonName } from "../lib/apolloRoster";
import { normCompany, normEmail, type StoredLead } from "../lib/leadStore";
import { DEFAULT_PULL_MONTHS, type PullProgress } from "../lib/apolloLive";
import { stripSnippetPrefix } from "../lib/detection";
import { toCSV, downloadBlob } from "../lib/csv";
import { ownersOf } from "../lib/reps";
import type { ApolloSequenceState } from "../lib/leadStore";

/** The four, in the order Jack named them. Matched on the exact sequence
 *  name, so "Carly Main Sequence" never swallows "… Recycled". */
export const WORKING_SEQUENCES = [
  "Jack Main Sequence",
  "Jack Main Backup Sequence",
  "Carly Main Sequence",
  "Carly Main Sequence Recycled",
] as const;

const SEQ_KEY = "workingSequence";
const PAGE = 50;
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

interface Person {
  key: string;
  name: string;
  company: string;
  email: string;
  active: boolean;
  /** "step 3 of 5", Apollo's own reason it ended, when Apollo stated them. */
  step: string;
  /** The day they were added to this sequence, when Apollo stated it. */
  addedAt: string;
  /** Who works the sequence: the rep named in it. */
  rep: string;
  reason: string;
  lead: StoredLead | null;
}

function leadIndex(leads: StoredLead[]) {
  const byEmail = new Map<string, StoredLead>();
  const byNameCo = new Map<string, StoredLead>();
  for (const l of leads) {
    const e = normEmail(l.email);
    if (e.includes("@")) byEmail.set(e, l);
    const n = normPersonName(l.contact);
    if (n.includes(" ")) byNameCo.set(`${n}|${normCompany(l.company)}`, l);
  }
  return { byEmail, byNameCo };
}

const stepText = (x: ApolloSequenceState | undefined) =>
  x?.step ? `step ${x.step}${x.steps ? ` of ${x.steps}` : ""}` : "";

function peopleIn(seq: string, roster: ApolloRosterEntry[], leads: StoredLead[]): Person[] {
  const want = norm(seq);
  const rep = ownersOf([seq]).join(", ");
  const idx = leadIndex(leads);
  const out = new Map<string, Person>();
  // A stored lead a live check placed in the sequence: freshest, and it
  // carries the step and Apollo's reason.
  for (const l of leads) {
    const s = l.apollo?.sequences.find((x) => norm(x.name) === want);
    if (!s) continue;
    const key = normEmail(l.email) || `${normPersonName(l.contact)}|${normCompany(l.company)}`;
    out.set(key, {
      key, name: l.contact, company: l.company, email: l.email,
      active: s.status === "active",
      step: stepText(s),
      addedAt: s.addedAt || "",
      rep,
      reason: s.reason || "",
      lead: l,
    });
  }
  for (const r of roster) {
    const label = r.sequences.find((x) => norm(x.replace(/\s*\(active\)$/, "")) === want);
    if (!label) continue;
    const e = normEmail(r.email);
    const key = e || `${normPersonName(r.name)}|${normCompany(r.company)}`;
    const st = r.seqStates?.find((x) => norm(x.name) === want);
    const prev = out.get(key);
    if (prev) {
      // A stored lead's live check wins, but fills its blanks from the pull.
      if (!prev.step) prev.step = stepText(st);
      if (!prev.addedAt) prev.addedAt = st?.addedAt || "";
      continue;
    }
    const lead = (e && idx.byEmail.get(e)) || idx.byNameCo.get(`${normPersonName(r.name)}|${normCompany(r.company)}`) || null;
    out.set(key, {
      key, name: r.name, company: r.company, email: r.email,
      active: st ? st.status === "active" : /\(active\)$/.test(label),
      step: stepText(st), addedAt: st?.addedAt || "", rep,
      reason: st?.reason || "", lead,
    });
  }
  // Active first, then most recently added.
  return [...out.values()].sort((a, b) => Number(b.active) - Number(a.active)
    || b.addedAt.localeCompare(a.addedAt) || a.company.localeCompare(b.company));
}

export default function SequenceLists({ leads, roster, rosterPulledAt = "", onPullApollo }: {
  leads: StoredLead[];
  roster: ApolloRosterEntry[];
  rosterPulledAt?: string;
  onPullApollo?: (months: number, onProgress: (p: PullProgress) => void, signal: AbortSignal) => Promise<PullProgress>;
}) {
  const [seq, setSeqState] = useState<string>(() => {
    try { const v = localStorage.getItem(SEQ_KEY); return v && (WORKING_SEQUENCES as readonly string[]).includes(v) ? v : WORKING_SEQUENCES[0]; } catch { return WORKING_SEQUENCES[0]; }
  });
  const setSeq = (s: string) => { setSeqState(s); setPage(0); try { localStorage.setItem(SEQ_KEY, s); } catch { /* preference only */ } };
  const [statusF, setStatusF] = useState<"all" | "active" | "ended">("all");
  const [oursOnly, setOursOnly] = useState(false);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [pull, setPull] = useState<(PullProgress & { finished?: boolean }) | null>(null);
  const [pullError, setPullError] = useState("");
  const abort = useRef<AbortController | null>(null);

  const lists = useMemo(() => new Map<string, Person[]>(WORKING_SEQUENCES.map((s) => [s, peopleIn(s, roster, leads)])), [roster, leads]);
  const people = useMemo(() => lists.get(seq) ?? [], [lists, seq]);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return people.filter((p) => (statusF === "all" || (statusF === "active") === p.active)
      && (!oursOnly || p.lead)
      && (!needle || `${p.name} ${p.company} ${p.email}`.toLowerCase().includes(needle)));
  }, [people, statusF, oursOnly, q]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const p = Math.min(page, pages - 1);
  const shown = filtered.slice(p * PAGE, p * PAGE + PAGE);
  const running = !!pull && !pull.finished;

  const refresh = async () => {
    if (!onPullApollo || running) return;
    setPullError("");
    const ac = new AbortController(); abort.current = ac;
    try {
      const res = await onPullApollo(DEFAULT_PULL_MONTHS, (pr) => setPull({ ...pr }), ac.signal);
      setPull({ ...res, finished: true });
    } catch (e) {
      setPullError(e instanceof Error ? e.message : String(e));
      setPull(null);
    }
  };

  const download = () => {
    const cols = ["Sequence", "Rep", "Status", "Step", "Added", "First Name", "Last Name", "Company", "Email", "Apollo reason", "Stored here as", "Calls", "Last outcome", "Notes"] as const;
    const rows = filtered.map((x) => {
      const [first, ...rest] = (x.name || "").trim().split(/\s+/);
      const a = x.lead?.apollo;
      return {
        Sequence: seq, Rep: x.rep, Status: x.active ? "Active" : "Ended", Step: x.step, Added: x.addedAt,
        "First Name": first || "", "Last Name": rest.join(" "), Company: x.company, Email: x.email,
        "Apollo reason": x.reason, "Stored here as": x.lead?.tier || "",
        Calls: a && !a.callsUnknown ? String(a.callCount) : "", "Last outcome": a?.lastOutcome || "",
        Notes: stripSnippetPrefix(x.lead?.notes || ""),
      };
    });
    void downloadBlob(toCSV(rows, cols), `${seq.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.csv`);
  };

  return (
    <div className="panel" aria-label="Working sequences" style={{ marginBottom: 16 }}>
      <div className="panel-head" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "10px 14px" }}>
        <b>Working sequences</b>
        <span className="muted" style={{ fontSize: 12 }}>
          Everyone in each sequence, from the pulled Apollo uploads and live checks.
          {rosterPulledAt ? ` Last pulled ${rosterPulledAt.slice(0, 10)}.` : " Not pulled from Apollo yet."}
        </span>
        <span style={{ flex: 1 }} />
        {onPullApollo && (running
          ? <button className="btn btn-sm btn-secondary" onClick={() => abort.current?.abort()}>Stop · {pull?.kept.toLocaleString()} read</button>
          : <button className="btn btn-sm btn-primary" onClick={() => void refresh()} title={`Re-reads Jack's and Carly's Apollo uploads from the last ${DEFAULT_PULL_MONTHS} months. Read-only; nothing is written to Apollo.`}>↻ Update from Apollo</button>)}
      </div>
      <div className="panel-body">
        {pullError && <div role="alert" style={{ color: "#B5443B", fontSize: 12.5, marginBottom: 8 }}>{pullError}</div>}
        {pull?.finished && <div role="status" className="muted" style={{ fontSize: 12.5, marginBottom: 8 }}>Updated: {pull.kept.toLocaleString()} Apollo contacts read.</div>}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }} role="tablist" aria-label="Sequence">
          {WORKING_SEQUENCES.map((s) => {
            const all = lists.get(s) ?? [];
            const act = all.filter((x) => x.active).length;
            const on = s === seq;
            return (
              <button key={s} role="tab" aria-selected={on} className="vault-tile" onClick={() => setSeq(s)}
                      style={{ borderColor: on ? "var(--accent)" : undefined, borderWidth: on ? 2 : undefined, textAlign: "left", minWidth: 180 }}>
                <span className="vault-num">{all.length.toLocaleString()}</span>
                <span className="vault-label">{s}</span>
                <span className="muted" style={{ fontSize: 11.5 }}>{act.toLocaleString()} active · {(all.length - act).toLocaleString()} ended</span>
              </button>
            );
          })}
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
          <input className="field" placeholder="Search name, company, email" aria-label="Search sequence" value={q}
                 onChange={(e) => { setQ(e.target.value); setPage(0); }} style={{ minWidth: 220 }} />
          <select className="field" aria-label="Sequence status" value={statusF} onChange={(e) => { setStatusF(e.target.value as typeof statusF); setPage(0); }}>
            <option value="all">Active and ended</option>
            <option value="active">Active only</option>
            <option value="ended">Ended only</option>
          </select>
          <label style={{ fontSize: 12.5, display: "inline-flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={oursOnly} onChange={(e) => { setOursOnly(e.target.checked); setPage(0); }} /> Stored leads only
          </label>
          <span className="muted" style={{ fontSize: 12.5 }}>{filtered.length.toLocaleString()} of {people.length.toLocaleString()}</span>
          <span style={{ flex: 1 }} />
          <button className="btn btn-sm btn-secondary" disabled={!filtered.length} onClick={download}>⬇ Download {filtered.length.toLocaleString()}</button>
        </div>

        <div className="table-card">
          <table className="data-table" aria-label={`${seq} list`}>
            <thead><tr><th>Contact</th><th>Status · step</th><th>Added</th><th>Rep</th><th>Stored here</th><th className="num">Calls</th><th>Last outcome</th><th>Note</th></tr></thead>
            <tbody>
              {shown.length === 0 && (
                <tr><td colSpan={8} className="muted" style={{ padding: 14 }}>
                  {people.length ? "Nobody matches these filters." : `Nobody known to be in ${seq} yet. Update from Apollo to read Jack's and Carly's uploads.`}
                </td></tr>
              )}
              {shown.map((x) => {
                const a = x.lead?.apollo;
                return (
                  <tr key={x.key}>
                    <td><div style={{ fontWeight: 600 }}>{x.name || "—"}</div>
                      <div className="muted" style={{ fontSize: 12 }}>{x.company}</div>
                      <div className="muted" style={{ fontSize: 11.5 }}>{x.email}</div></td>
                    <td>
                      <span className="pill" style={x.active ? { color: "#0E7A72", background: "#E3F3F1" } : { color: "#5B6B72", background: "#EEF1F2" }}>{x.active ? "Active" : "Ended"}</span>
                      {x.step && <div className="muted" style={{ fontSize: 11 }}>{x.step}</div>}
                      {x.reason && <div className="muted" style={{ fontSize: 11 }} title="Apollo's own reason">{x.reason}</div>}
                    </td>
                    <td style={{ fontSize: 12, whiteSpace: "nowrap" }}>{x.addedAt || <span className="muted">—</span>}</td>
                    <td style={{ fontSize: 12 }}>{x.rep || <span className="muted">—</span>}</td>
                    <td style={{ fontSize: 12 }}>{x.lead ? x.lead.tier : <span className="muted">Not stored here</span>}</td>
                    <td className="num">{a ? (a.callsUnknown ? "?" : a.callCount) : "—"}</td>
                    <td style={{ fontSize: 12 }}>{a?.lastOutcome || "—"}</td>
                    <td style={{ fontSize: 12, maxWidth: 320 }}>
                      <div style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }} title={x.lead?.notes}>
                        {x.lead ? stripSnippetPrefix(x.lead.notes || "") : ""}
                      </div>
                    </td>
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
    </div>
  );
}
