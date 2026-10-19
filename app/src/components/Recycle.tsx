// The recycle queue, as a workflow you can see: Resting -> Ready ->
// Downloaded -> Back in a sequence. See lib/recycle.ts for the rules.
//
// Per Jack: "itll sit in a queue where i can then re download those ones and
// assign them to a sequence in apollo … unless i can just build a manageable
// workflow here that i can see". The platform never writes to Apollo, so the
// hand-off is a download the rep loads into Apollo (updating the existing
// contact by email); the next Apollo check closes the loop by showing the
// lead in a live sequence again.
import { useMemo, useState } from "react";
import { toCSV, downloadBlob } from "../lib/csv";
import { stripSnippetPrefix, type ExportRow } from "../lib/detection";
import type { LeadList } from "../lib/leadLists";
import type { StoredLead } from "../lib/leadStore";
import { VERDICT_META, VERDICT_ORDER, verdictOf, type Verdict } from "../lib/leadStatus";
import {
  RECYCLE_FLOW, RECYCLE_META, cleanRules, recycleDayKey, recycleLabel, recycleOf,
  type RecycleInfo, type RecycleRules, type RecycleStage,
} from "../lib/recycle";

const PAGE = 50;

/** Shaped for an Apollo contact import: matched to the existing contact by
 *  email, so the import updates rather than duplicates. */
export const RECYCLE_EXPORT_COLUMNS = ["First Name", "Last Name", "Email", "Company", "Title", "Work Direct Phone", "Mobile Phone",
  "Recycle Reason", "Unanswered Attempts", "Last Attempt", "Last Outcome", "Previous Sequences", "Recycle On", "Stored As", "Notes"] as const;

function splitName(full: string) {
  const [first, ...rest] = (full || "").trim().split(/\s+/);
  return { first: first || "", last: rest.join(" ") };
}

function exportRow(l: StoredLead, r: RecycleInfo): Record<string, string> {
  const { first, last } = splitName(l.contact);
  return {
    "First Name": first, "Last Name": last, Email: l.email, Company: l.company, Title: l.title,
    "Work Direct Phone": l.phone, "Mobile Phone": l.mobilePhone,
    "Recycle Reason": r.why === "not-interested" ? "Not interested, rested" : `${r.unanswered} unanswered attempts`,
    "Unanswered Attempts": String(r.unanswered),
    "Last Attempt": r.lastAttemptAt.slice(0, 10),
    "Last Outcome": l.apollo?.lastOutcome || "",
    "Previous Sequences": (l.apollo?.sequences || []).map((s) => s.name).join(" | "),
    "Recycle On": r.recycleOn,
    "Stored As": l.tier,
    Notes: stripSnippetPrefix(l.notes || ""),
  };
}

function listRow(l: StoredLead, r: RecycleInfo): ExportRow {
  const { first, last } = splitName(l.contact);
  const where = `Recycle: ${RECYCLE_META[r.stage].label}${r.unanswered ? `, ${r.unanswered} unanswered` : ""}`;
  const note = stripSnippetPrefix(l.notes || "");
  return {
    "First Name": first, "Last Name": last, Title: l.title, "Company Name": l.company,
    Email: l.email, "Work Direct Phone": l.phone, "Mobile Phone": l.mobilePhone,
    "Number of Employees": "", "Product Area": l.productArea, Notes: note ? `${where} · ${note}` : where,
  };
}

export function RecycleRulesEditor({ rules, onChange }: { rules: RecycleRules; onChange: (r: RecycleRules) => void }) {
  const set = (k: keyof RecycleRules, v: string) => {
    const n = Number(v);
    // A blank or zero box is a half-typed number, not a rule: ignore it.
    if (!v.trim() || !Number.isFinite(n) || n < 1) return;
    onChange(cleanRules({ ...rules, [k]: n }));
  };
  const box = (k: keyof RecycleRules, label: string, unit: string) => (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
      {label}
      <input className="field" type="number" min={1} aria-label={label} defaultValue={rules[k]} key={`${k}-${rules[k]}`}
             onBlur={(e) => set(k, e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") set(k, (e.target as HTMLInputElement).value); }}
             style={{ width: 64 }} />
      <span className="muted">{unit}</span>
    </label>
  );
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center" }} aria-label="Recycle rules">
      {box("attempts", "Unanswered attempts", "calls")}
      {box("restDays", "Rest after last attempt", "days")}
      {box("notInterestedMonths", "Not interested comes back after", "months")}
    </div>
  );
}

export default function Recycle({
  leads, rules, onRulesChange, onMarkDownloaded, lists = [], onAddToList,
}: {
  leads: StoredLead[];
  rules: RecycleRules;
  onRulesChange: (r: RecycleRules) => void;
  /** Stamp (or clear, with false) "downloaded for Apollo" on these leads. */
  onMarkDownloaded: (keys: string[], on: boolean) => void;
  lists?: LeadList[];
  onAddToList?: (rows: { row: ExportRow; scanner: "main" | "smc" | "csp" }[], opts: { existingId?: string; newName?: string }) => { listId: string; added: number; skipped: number } | null;
}) {
  const today = recycleDayKey(new Date());
  const [stage, setStage] = useState<RecycleStage>("ready");
  const [why, setWhy] = useState<"all" | "unanswered" | "not-interested">("all");
  const [verdict, setVerdict] = useState<Verdict | "all">("all");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState("");
  const [listTarget, setListTarget] = useState("");
  const [newListName, setNewListName] = useState("");
  const [showRules, setShowRules] = useState(false);

  const rows = useMemo(() => leads.map((l) => ({ l, r: recycleOf(l, rules, today) })), [leads, rules, today]);

  const counts = useMemo(() => {
    const by = Object.fromEntries(Object.keys(RECYCLE_META).map((k) => [k, 0])) as Record<RecycleStage, number>;
    const reasons = new Map<string, number>();
    let thisMonth = 0;
    for (const { r } of rows) {
      by[r.stage]++;
      if (r.stage === "resting" && r.recycleOn.slice(0, 7) === today.slice(0, 7)) thisMonth++;
      if (r.stage === "excluded") reasons.set(r.reason, (reasons.get(r.reason) || 0) + 1);
    }
    return { by, thisMonth, reasons };
  }, [rows, today]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out = rows.filter(({ l, r }) =>
      r.stage === stage
      && (why === "all" || r.why === why)
      && (verdict === "all" || verdictOf(l.tier) === verdict)
      && (!needle || `${l.contact} ${l.company} ${l.email} ${l.title}`.toLowerCase().includes(needle)));
    // Ready: longest-waiting first. Resting: soonest back first.
    out.sort((a, b) => (a.r.recycleOn || "").localeCompare(b.r.recycleOn || "") || b.r.unanswered - a.r.unanswered);
    return out;
  }, [rows, stage, why, verdict, q]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const p = Math.min(page, pages - 1);
  const shown = filtered.slice(p * PAGE, p * PAGE + PAGE);
  const picked = sel.size ? filtered.filter(({ l }) => sel.has(l.key)) : filtered;

  const go = (s: RecycleStage) => { setStage(s); setPage(0); setSel(new Set()); setNotice(""); };
  const toggle = (k: string) => setSel((prev) => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  const download = async () => {
    if (!picked.length) return;
    const ok = await downloadBlob(toCSV(picked.map(({ l, r }) => exportRow(l, r)), RECYCLE_EXPORT_COLUMNS), `recycle-${today}.csv`);
    if (!ok) return;
    if (stage === "ready") {
      onMarkDownloaded(picked.map(({ l }) => l.key), true);
      setNotice(`${picked.length.toLocaleString()} downloaded and moved to Downloaded. Load the file into Apollo (update existing contacts by email) and add them to a sequence; the next Apollo check moves them to Back in a sequence.`);
      setSel(new Set());
    }
  };

  const tile = (s: RecycleStage, n: number) => {
    const m = RECYCLE_META[s]; const on = stage === s;
    return (
      <button key={s} className="vault-tile" aria-pressed={on} title={m.hint} onClick={() => go(s)}
              style={{ borderColor: on ? m.color : undefined, borderWidth: on ? 2 : undefined }}>
        <span className="vault-num" style={{ color: m.color }}>{n.toLocaleString()}</span>
        <span className="vault-label">{m.label}</span>
      </button>
    );
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Recycle</h2>
          <div className="muted" style={{ fontSize: 13 }}>
            Leads called {rules.attempts}+ times with no answer come back {rules.restDays} days after the last attempt.
            Not interested comes back after {rules.notInterestedMonths} months. Read from Apollo's call history; nothing is written to Apollo.
          </div>
        </div>
        <button className="btn btn-secondary" onClick={() => setShowRules((v) => !v)} aria-expanded={showRules}>⚙ Rules</button>
      </div>

      {showRules && (
        <div className="panel" style={{ marginBottom: 10 }}>
          <div className="panel-body">
            <RecycleRulesEditor rules={rules} onChange={onRulesChange} />
            <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>
              Unanswered = no answer, voicemail, gatekeeper. Never recycled: account manager only, do not contact, wrong number, meeting booked, Bad Leads, anyone reached (other than not interested), or anyone in a live sequence.
            </div>
          </div>
        </div>
      )}

      <div className="panel" aria-label="Recycle workflow" style={{ marginBottom: 10 }}>
        <div className="panel-body">
          <div className="vault-tiles" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "stretch" }}>
            {RECYCLE_FLOW.map((s, i) => (
              <span key={s} style={{ display: "contents" }}>
                {i > 0 && <span className="muted" aria-hidden style={{ alignSelf: "center" }}>→</span>}
                {tile(s, counts.by[s])}
              </span>
            ))}
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 8, display: "flex", gap: 14, flexWrap: "wrap" }}>
            <span>{counts.thisMonth.toLocaleString()} coming back later this month</span>
            {(["building", "working", "excluded", "unchecked"] as RecycleStage[]).map((s) => (
              <button key={s} className="btn btn-sm btn-ghost" style={{ padding: "0 4px" }} title={RECYCLE_META[s].hint}
                      aria-pressed={stage === s} onClick={() => go(s)}>
                {RECYCLE_META[s].label}: {counts.by[s].toLocaleString()}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="control-strip" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
        <input className="field" placeholder="Search name, company, email" aria-label="Search recycle" value={q}
               onChange={(e) => { setQ(e.target.value); setPage(0); }} style={{ minWidth: 220 }} />
        <select className="field" aria-label="Recycle reason" value={why} onChange={(e) => { setWhy(e.target.value as typeof why); setPage(0); }}>
          <option value="all">Any reason</option>
          <option value="unanswered">Unanswered attempts</option>
          <option value="not-interested">Not interested</option>
        </select>
        <select className="field" aria-label="Stored as" value={verdict} onChange={(e) => { setVerdict(e.target.value as Verdict | "all"); setPage(0); }}>
          <option value="all">Any tier</option>
          {VERDICT_ORDER.map((v) => <option key={v} value={v}>{VERDICT_META[v].label}</option>)}
        </select>
        <span className="muted" style={{ fontSize: 12.5 }}>{filtered.length.toLocaleString()} {RECYCLE_META[stage].label.toLowerCase()}</span>
        <span style={{ flex: 1 }} />
        <button className="btn btn-sm btn-primary" disabled={!picked.length} onClick={() => void download()}
                title={stage === "ready" ? "Download for Apollo and move them to Downloaded" : "Download as CSV"}>
          ⬇ {stage === "ready" ? "Download for Apollo" : "Download"} {sel.size ? `${sel.size.toLocaleString()} selected` : `${filtered.length.toLocaleString()}`}
        </button>
        {stage === "downloaded" && (
          <button className="btn btn-sm btn-secondary" disabled={!picked.length}
                  onClick={() => { onMarkDownloaded(picked.map(({ l }) => l.key), false); setSel(new Set()); setNotice(`${picked.length.toLocaleString()} moved back to Ready.`); }}>
            ↺ Back to Ready
          </button>
        )}
      </div>

      {onAddToList && (
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
          <span className="muted" style={{ fontSize: 12.5 }}>Add {sel.size ? `${sel.size.toLocaleString()} selected` : `${filtered.length.toLocaleString()}`} to a list:</span>
          <select className="field" aria-label="Recycle list" value={listTarget} onChange={(e) => setListTarget(e.target.value)}>
            <option value="">New list…</option>
            {lists.map((li) => <option key={li.id} value={li.id}>{li.name}</option>)}
          </select>
          {!listTarget && <input className="field" placeholder="List name" aria-label="Recycle new list name" value={newListName} onChange={(e) => setNewListName(e.target.value)} />}
          <button className="btn btn-sm btn-secondary" disabled={!picked.length || (!listTarget && !newListName.trim())}
                  onClick={() => {
                    const res = onAddToList(picked.map(({ l, r }) => ({ row: listRow(l, r), scanner: l.source })),
                      listTarget ? { existingId: listTarget } : { newName: newListName.trim() });
                    if (!res) return;
                    const name = lists.find((li) => li.id === res.listId)?.name ?? newListName.trim();
                    setNotice(`Added ${res.added.toLocaleString()} to "${name}"${res.skipped ? ` (${res.skipped} already there)` : ""}.`);
                    setNewListName(""); setSel(new Set());
                  }}>
            + Add to list
          </button>
        </div>
      )}

      {notice && <div className="notice" role="status" style={{ marginBottom: 8, fontSize: 13 }}>{notice}</div>}
      {stage === "excluded" && counts.reasons.size > 0 && (
        <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
          {[...counts.reasons].map(([k, n]) => `${k}: ${n.toLocaleString()}`).join(" · ")}
        </div>
      )}

      <div className="table-card">
        <table className="data-table" aria-label="Recycle queue">
          <thead>
            <tr>
              <th style={{ width: 28 }}>
                <input type="checkbox" aria-label="Select page" checked={shown.length > 0 && shown.every(({ l }) => sel.has(l.key))}
                       onChange={(e) => setSel((prev) => { const n = new Set(prev); for (const { l } of shown) { if (e.target.checked) n.add(l.key); else n.delete(l.key); } return n; })} />
              </th>
              <th>Contact</th><th>Stage</th><th>Recycle</th><th>Unanswered</th><th>Last attempt</th><th>Previous sequences</th><th>Stored as</th><th>Note</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr><td colSpan={9} className="muted" style={{ padding: 16 }}>
                {stage === "unchecked" ? "Every lead has Apollo call history." : `Nothing ${RECYCLE_META[stage].label.toLowerCase()} right now.`}
                {stage === "ready" && counts.by.unchecked > 0 && ` ${counts.by.unchecked.toLocaleString()} leads have no Apollo call history yet — run an Apollo check to see if they belong here.`}
              </td></tr>
            )}
            {shown.map(({ l, r }) => {
              const m = RECYCLE_META[r.stage];
              return (
                <tr key={l.key}>
                  <td><input type="checkbox" aria-label={`Select ${l.contact || l.email}`} checked={sel.has(l.key)} onChange={() => toggle(l.key)} /></td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{l.contact || "—"}</div>
                    <div className="muted" style={{ fontSize: 12 }}>{[l.title, l.company].filter(Boolean).join(" · ")}</div>
                    <div className="muted" style={{ fontSize: 11.5 }}>{l.email}</div>
                  </td>
                  <td><span className="pill" style={{ color: m.color, background: m.bg }} title={m.hint}>{m.label}</span>
                    {r.reason && <div className="muted" style={{ fontSize: 11 }}>{r.reason}</div>}
                    {l.recycle?.downloadedAt && (r.stage === "downloaded" || r.stage === "back") && <div className="muted" style={{ fontSize: 11 }}>Downloaded {l.recycle.downloadedAt.slice(0, 10)}</div>}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>{recycleLabel(r, today) || "—"}
                    {r.why === "not-interested" && <div className="muted" style={{ fontSize: 11 }}>Not interested</div>}
                  </td>
                  <td>{r.unanswered}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{r.lastAttemptAt ? r.lastAttemptAt.slice(0, 10) : "—"}
                    {l.apollo?.lastOutcome && <div className="muted" style={{ fontSize: 11 }}>{l.apollo.lastOutcome}</div>}
                  </td>
                  <td style={{ fontSize: 12 }}>{(l.apollo?.sequences || []).map((s) => s.name).join(", ") || "—"}</td>
                  <td style={{ fontSize: 12 }}>{l.tier}</td>
                  <td style={{ fontSize: 12, maxWidth: 320 }}>
                    <div style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }} title={l.notes}>
                      {stripSnippetPrefix(l.notes || "")}
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
  );
}
