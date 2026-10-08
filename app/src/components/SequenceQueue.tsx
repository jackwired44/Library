// The Apollo queue: qualified leads, each pre-assigned the sequence it is
// headed for, exported one file per sequence.
//
// Per Jack: "upload all new leads here and start pre storing them with the
// relevant seuqence to transition to into apollo to create as task to call
// and email." Apollo turns an enrolled contact into call and email tasks
// from the sequence's own steps, so the job here ends at a clean import
// file per sequence — and at never sending the same lead twice.
import { useMemo, useState } from "react";
import {
  HOLD_META, ROUTE_META, ROUTE_ORDER, TOP_TIERS, groupByPlan, holdReason, routeKeyOf,
  type HoldReason, type RouteKey, type RoutingRules,
} from "../lib/sequenceRouting";
import { newestNote, type StoredLead } from "../lib/leadStore";
import { buildSizeBands, downloadSequenceExport } from "../lib/campaignExport";
import { MIN_EMPLOYEES } from "../lib/leadQualify";
import { syncAgeDays } from "../lib/apolloSync";
import type { CompanyProfile } from "../lib/companyProfiles";
import LeadDetail from "./LeadDetail";

const PAGE = 25;

function MoveSelect({
  current, names, onPick,
}: { current: string; names: string[]; onPick: (s: string | null) => void }) {
  return (
    <select
      className="field"
      style={{ width: 170, fontSize: 12 }}
      value=""
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => {
        const v = e.target.value;
        if (v === "__remove") onPick(null);
        else if (v) onPick(v);
      }}
      aria-label="Move to another sequence"
    >
      <option value="">Move…</option>
      {names.filter((n) => n !== current).map((n) => <option key={n} value={n}>{n}</option>)}
      <option value="__remove">Remove from queue</option>
    </select>
  );
}

function SequenceGroupCard({
  sequence, queued, exported, names, companyProfiles, onSetPlan, onMarkExported, onOpen,
}: {
  sequence: string;
  queued: StoredLead[];
  exported: StoredLead[];
  names: string[];
  companyProfiles: CompanyProfile[];
  onSetPlan: (keys: string[], sequence: string | null) => void;
  onMarkExported: (keys: string[]) => void;
  onOpen: (key: string) => void;
}) {
  const [open, setOpen] = useState(queued.length > 0 && queued.length <= 50);
  const [showExported, setShowExported] = useState(false);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const list = showExported ? exported : queued;
  const pages = Math.max(1, Math.ceil(list.length / PAGE));
  const shown = list.slice((page - 1) * PAGE, page * PAGE);
  const noEmail = queued.filter((l) => !l.email).length;

  async function exportNow() {
    if (!queued.length || busy) return;
    setBusy(true);
    try {
      await downloadSequenceExport(sequence, queued, companyProfiles);
      // Marked only after the file is written, so a failed download does
      // not leave leads looking sent when they are not.
      onMarkExported(queued.map((l) => l.key));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel" style={{ marginBottom: 10 }}>
      <div className="panel-head" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <button className="btn btn-sm btn-ghost" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? "▾" : "▸"}
        </button>
        <div style={{ minWidth: 0, flex: 1 }}>
          <b>{sequence}</b>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            {queued.length.toLocaleString()} queued · {exported.length.toLocaleString()} already exported
            {noEmail > 0 && <> · <span style={{ color: "#9A5B22" }}>{noEmail} with no email</span></>}
          </div>
        </div>
        <button
          className="btn btn-sm btn-primary"
          disabled={!queued.length || busy}
          onClick={exportNow}
          title={`Download the ${queued.length} queued leads as an Apollo import file for "${sequence}", and mark them exported so they are not sent twice.\n\nThis writes a file. Nothing is pushed into your live Apollo account.`}
        >
          {busy ? "Preparing…" : `⬇ Export ${queued.length.toLocaleString()} for Apollo`}
        </button>
      </div>

      {open && (
        <div className="panel-body">
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <button className={`btn btn-sm ${!showExported ? "btn-secondary" : "btn-ghost"}`}
                    onClick={() => { setShowExported(false); setPage(1); }}>
              Queued ({queued.length})
            </button>
            <button className={`btn btn-sm ${showExported ? "btn-secondary" : "btn-ghost"}`}
                    onClick={() => { setShowExported(true); setPage(1); }}>
              Exported ({exported.length})
            </button>
          </div>
          {list.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--muted)" }}>
              {showExported ? "Nothing exported to this sequence yet." : "Nothing queued for this sequence."}
            </div>
          ) : (
            <>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Company</th><th>Contact</th><th>Type</th><th>Tier</th><th>Why</th>
                    <th>{showExported ? "Exported" : "Routed"}</th><th />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((l) => (
                    <tr key={l.key} style={{ cursor: "pointer" }} onClick={() => onOpen(l.key)}>
                      <td><b>{l.company || "—"}</b></td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {l.contact || "—"}
                        <div style={{ fontSize: 11, color: l.email ? "var(--muted)" : "#9A5B22" }}>
                          {l.email || "no email"}{l.title ? ` · ${l.title}` : ""}
                        </div>
                      </td>
                      <td style={{ whiteSpace: "nowrap", fontSize: 12 }}>{ROUTE_META[routeKeyOf(l)].label}</td>
                      <td style={{ whiteSpace: "nowrap", fontSize: 12 }}>{l.tier}</td>
                      <td title={l.notes} style={{ maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12 }}>
                        {newestNote(l.notes) || "—"}
                      </td>
                      <td style={{ whiteSpace: "nowrap", fontSize: 11, color: "var(--muted)" }}>
                        {showExported
                          ? (l.plan?.exportedAt || "").slice(0, 10)
                          : `${l.plan?.by === "manual" ? "by hand" : "by rule"} · ${(l.plan?.assignedAt || "").slice(0, 10)}`}
                      </td>
                      <td>
                        <MoveSelect current={sequence} names={names}
                                    onPick={(s) => onSetPlan([l.key], s)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {pages > 1 && (
                <div className="pager">
                  <button className="btn btn-sm btn-ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</button>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>Page {page} of {pages}</span>
                  <button className="btn btn-sm btn-ghost" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function SequenceQueue({
  leads, companyProfiles, rules, knownSequences, onSaveRules, onSetPlan, onMarkExported,
}: {
  leads: StoredLead[];
  companyProfiles: CompanyProfile[];
  rules: RoutingRules;
  /** Sequence names to offer: imported funnels, existing plans, rules. */
  knownSequences: string[];
  onSaveRules: (rules: RoutingRules) => Promise<number>;
  onSetPlan: (keys: string[], sequence: string | null) => void;
  onMarkExported: (keys: string[]) => void;
}) {
  const [draft, setDraft] = useState<Partial<Record<RouteKey, string>>>(rules.rules);
  const [rulesOpen, setRulesOpen] = useState(Object.keys(rules.rules).length <= 1);
  const [notice, setNotice] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [bulkTarget, setBulkTarget] = useState("");

  const sizeBands = useMemo(() => buildSizeBands(leads, companyProfiles, MIN_EMPLOYEES), [leads, companyProfiles]);
  const groups = useMemo(() => groupByPlan(leads), [leads]);
  const ageDays = useMemo(() => syncAgeDays(leads), [leads]);

  // Every top-tier lead with no plan, and why it is waiting.
  const held = useMemo(() => {
    const out: Record<HoldReason, StoredLead[]> = {
      "not-top-tier": [], "already-in-apollo": [], "under-size": [], "no-rule": [],
    };
    for (const l of leads) {
      if (l.plan || !TOP_TIERS.has(l.tier)) continue;
      const r = holdReason(l, rules, sizeBands.get(l.key));
      if (r) out[r].push(l);
    }
    return out;
  }, [leads, rules, sizeBands]);

  // How many top-tier leads exist per type — shown beside each rule so the
  // cost of leaving a type unrouted is visible.
  const perType = useMemo(() => {
    const m = new Map<RouteKey, number>();
    for (const l of leads) if (TOP_TIERS.has(l.tier)) m.set(routeKeyOf(l), (m.get(routeKeyOf(l)) || 0) + 1);
    return m;
  }, [leads]);

  const names = useMemo(() => {
    const s = new Set(knownSequences.filter(Boolean));
    for (const v of Object.values(draft)) if (v) s.add(v);
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [knownSequences, draft]);

  const totalQueued = groups.reduce((a, g) => a + g.queued.length, 0);
  const totalExported = groups.reduce((a, g) => a + g.exported.length, 0);
  const dirty = ROUTE_ORDER.some((k) => (draft[k] || "") !== (rules.rules[k] || ""));

  async function saveRules() {
    const clean: Partial<Record<RouteKey, string>> = {};
    for (const k of ROUTE_ORDER) { const v = (draft[k] || "").trim(); if (v) clean[k] = v; }
    const routed = await onSaveRules({ id: "routing", rules: clean, updatedAt: new Date().toISOString() });
    setNotice(routed
      ? `Rules saved. ${routed.toLocaleString()} qualified lead${routed === 1 ? "" : "s"} routed into the queue.`
      : "Rules saved. No new leads to route — anything already queued or exported keeps its sequence.");
  }

  const openLead = openKey ? leads.find((l) => l.key === openKey) : null;

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Apollo queue</h2>
          <p className="page-sub">
            Qualified leads, each assigned the sequence it is going into. Export one file per sequence,
            import it into Apollo, and the sequence creates the call and email tasks.
          </p>
        </div>
      </div>

      {ageDays === null && (
        <div style={{ marginBottom: 10, padding: "8px 12px", border: "1px solid var(--border)", borderLeft: "3px solid #9A5B22", borderRadius: 10, fontSize: 12.5 }}>
          <b>Not checked against Apollo yet.</b> Until a sync is imported on All leads, a lead you have already worked in
          Apollo can still land in this queue. Sync first to keep the queue to truly uncontacted leads.
        </div>
      )}

      <div className="metric-row">
        <div className="metric">
          <div className="metric-label">Queued</div>
          <div className="metric-value">{totalQueued.toLocaleString()}</div>
          <div className="metric-hint">across {groups.filter((g) => g.queued.length).length} sequences</div>
        </div>
        <div className="metric">
          <div className="metric-label">Exported</div>
          <div className="metric-value">{totalExported.toLocaleString()}</div>
          <div className="metric-hint">sent to Apollo in a file</div>
        </div>
        <div className="metric">
          <div className="metric-label">Waiting on a rule</div>
          <div className="metric-value">{held["no-rule"].length.toLocaleString()}</div>
          <div className="metric-hint">qualified, no sequence set</div>
        </div>
        <div className="metric">
          <div className="metric-label">Already in Apollo</div>
          <div className="metric-value">{held["already-in-apollo"].length.toLocaleString()}</div>
          <div className="metric-hint">kept out of the queue</div>
        </div>
        <div className="metric">
          <div className="metric-label">Under {MIN_EMPLOYEES} employees</div>
          <div className="metric-value">{held["under-size"].length.toLocaleString()}</div>
          <div className="metric-hint">kept out of the queue</div>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 12 }}>
        <div className="panel-head" style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}
             onClick={() => setRulesOpen((v) => !v)}>
          <b>{rulesOpen ? "▾" : "▸"} Routing rules</b>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            which sequence each type of qualified lead goes into
          </span>
        </div>
        {rulesOpen && (
          <div className="panel-body">
            <table className="data-table" style={{ marginBottom: 10 }}>
              <thead><tr><th>Lead type</th><th>Top-tier leads</th><th>Goes into sequence</th></tr></thead>
              <tbody>
                {ROUTE_ORDER.map((k) => (
                  <tr key={k}>
                    <td title={ROUTE_META[k].hint}>{ROUTE_META[k].label}</td>
                    <td>{(perType.get(k) || 0).toLocaleString()}</td>
                    <td>
                      <input
                        className="field"
                        list="known-sequences"
                        style={{ width: 280 }}
                        placeholder="— not routed —"
                        value={draft[k] || ""}
                        onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
                        aria-label={`Sequence for ${ROUTE_META[k].label}`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <datalist id="known-sequences">
              {names.map((n) => <option key={n} value={n} />)}
            </datalist>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <button className="btn btn-sm btn-primary" disabled={!dirty} onClick={saveRules}>Save rules &amp; route</button>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>
                Only top-tier leads with no sequence yet are routed. A lead already queued, moved by hand, or exported
                keeps its sequence — editing a rule never re-routes it.
              </span>
            </div>
          </div>
        )}
      </div>

      {notice && (
        <div style={{ marginBottom: 10, fontSize: 12.5 }}>
          {notice}
          <button className="btn btn-sm btn-ghost" style={{ marginLeft: 6 }} onClick={() => setNotice(null)}>Dismiss</button>
        </div>
      )}

      {groups.length === 0 ? (
        <div className="calm-state" style={{ marginBottom: 12 }}>
          <div className="calm-title">Nothing queued yet</div>
          <div className="calm-body">
            Set a sequence for a lead type above, then scan a file — qualified leads land here automatically.
          </div>
        </div>
      ) : groups.map((g) => (
        <SequenceGroupCard
          key={g.sequence}
          sequence={g.sequence}
          queued={g.queued}
          exported={g.exported}
          names={names}
          companyProfiles={companyProfiles}
          onSetPlan={onSetPlan}
          onMarkExported={onMarkExported}
          onOpen={setOpenKey}
        />
      ))}

      {held["no-rule"].length > 0 && (
        <div className="panel" style={{ marginTop: 12 }}>
          <div className="panel-head" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div style={{ flex: 1 }}>
              <b>Qualified, waiting on a rule ({held["no-rule"].length.toLocaleString()})</b>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>
                {ROUTE_ORDER
                  .map((k) => [k, held["no-rule"].filter((l) => routeKeyOf(l) === k).length] as const)
                  .filter(([, n]) => n > 0)
                  .map(([k, n]) => `${n.toLocaleString()} ${ROUTE_META[k].label}`)
                  .join(" · ")}
              </div>
            </div>
            <input className="field" list="known-sequences" style={{ width: 220 }} placeholder="Sequence…"
                   value={bulkTarget} onChange={(e) => setBulkTarget(e.target.value)} aria-label="Queue all of these into" />
            <button className="btn btn-sm btn-secondary" disabled={!bulkTarget.trim()}
                    onClick={() => { onSetPlan(held["no-rule"].map((l) => l.key), bulkTarget.trim()); setBulkTarget(""); }}>
              Queue all {held["no-rule"].length.toLocaleString()}
            </button>
          </div>
        </div>
      )}

      <div style={{ marginTop: 10, fontSize: 12, color: "var(--muted)" }}>
        {(Object.keys(HOLD_META) as HoldReason[])
          .filter((r) => r !== "not-top-tier" && held[r].length)
          .map((r) => `${held[r].length.toLocaleString()} top-tier ${HOLD_META[r].toLowerCase()}`)
          .join(" · ")}
      </div>

      {openLead && (
        <LeadDetail
          lead={openLead}
          companyProfiles={companyProfiles}
          onClose={() => setOpenKey(null)}
          sequenceNames={names}
          onSetPlan={(s) => onSetPlan([openLead.key], s)}
        />
      )}
    </>
  );
}
