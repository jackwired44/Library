// Custom Lead Lists — see CLAUDE.md "Custom Lead Lists." Jack hand-picks
// specific leads out of a Scanner batch (any tier, unlike the Lead Library)
// via the "+ Add to list" bulk action there, then manages/downloads those
// lists here. Adding happens in Scanner.tsx; this view only renames,
// removes a lead, deletes a list, and downloads.
import { useMemo, useState } from "react";
import { CATEGORY_META, EXPORT_LABELS, stripSnippetPrefix } from "../lib/detection";
import { downloadCSV } from "../lib/csv";
import { describeRule } from "../lib/smartRules";
import { campaignMembership, cycleDueOn, daysToCycle, isActiveCampaign, isCampaignList, parseTags, CYCLE_CHOICES, type LeadList, type ListedLeadRow } from "../lib/leadLists";
import { normEmail, type StoredLead } from "../lib/leadStore";
import { seenNameKey } from "../lib/seenBefore";
import type { RosterIndex } from "../lib/apolloRoster";
import { apolloDetailOf, NEEDS, STATUS_META, STATUS_ORDER, type Status } from "./ApolloStatus";
import { leadsDueForApollo } from "./ApolloSyncPanel";
import { confirmAction } from "../lib/confirmBox";
import type { ApolloRosterEntry } from "../lib/apolloRoster";
import type { FoundSequence } from "../lib/apolloLive";
import { ComparePanel, SequencePicker, compareRow, knownSequenceNames, sequenceOnly } from "./ListSequenceCompare";

interface ListsProps {
  lists: LeadList[];
  loading: boolean;
  error: string | null;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onRemoveRow: (listId: string, rowKey: string) => void;
  /** Campaign fields: tags, campaign name, cycle window. */
  onUpdateMeta?: (id: string, patch: Partial<Pick<LeadList, "tags" | "campaign" | "cycleDays" | "status" | "includeActive" | "includeRowKeys" | "targetSequence" | "targetSequenceId" | "targetSequenceOwner" | "rowNotes">>) => void;
  /** Move a campaign list's leads into a new dated list. */
  onCycle?: (id: string) => void;
  /** Re-run a smart list's saved rule against the current leads now. */
  onRefreshSmart?: (id: string) => void;
  /** Stored leads and the Apollo roster, so each list row can show where it
   *  stands in Apollo (same answer All leads gives). */
  leads?: StoredLead[];
  apolloIndex?: RosterIndex | null;
  /** Run the read-only Apollo check over these stored leads. */
  onCheckLeads?: (keys: string[], label: string, force?: boolean) => void;
  checkBusy?: boolean;
  /** The pulled Apollo uploads, for who else is in a sequence. */
  roster?: ApolloRosterEntry[];
  /** Read-only Apollo sequence search by name. */
  onSearchSequences?: (q: string) => Promise<FoundSequence[]>;
}

/** One list row matched to its stored lead and where that lead stands. */
interface RowStanding { lead: StoredLead | null; status: Status | "notStored"; seq: ReturnType<typeof apolloDetailOf>["seq"] }
const NOT_STORED = { label: "Not in All leads", short: "Not stored", hint: "This row isn't saved in All leads, so it can't be checked. Save the upload it came from (Save & check), then check again.", color: "#4C6167", bg: "#EEF1F2" };

const TIER_LABEL: Record<string, { label: string; color: string; bg: string }> = {
  signal: { label: "Strong Signal", color: "#2CC295", bg: "#E7F1EA" },
  mention: { label: "Needs Review", color: "#9A5B22", bg: "#FBEBDD" },
  dq: { label: "Bad Lead", color: "#B5443B", bg: "#FBEAE8" },
};

export default function ListsView({ lists, loading, error, onRename, onDelete, onRemoveRow, onUpdateMeta, onCycle, onRefreshSmart, leads = [], apolloIndex = null, onCheckLeads, checkBusy = false, roster = [], onSearchSequences }: ListsProps) {
  // Per Jack: "in the lists tab i need to be able to run these against"
  // Apollo. A list row is a snapshot, so it is matched to its stored lead the
  // usual way: same email, or the same full name at the same company.
  const leadIndex = useMemo(() => {
    const byEmail = new Map<string, StoredLead>();
    const byName = new Map<string, StoredLead>();
    for (const l of leads) {
      const e = normEmail(l.email);
      if (e.includes("@") && !byEmail.has(e)) byEmail.set(e, l);
      const n = seenNameKey(l.contact, l.company);
      if (n && !byName.has(n)) byName.set(n, l);
    }
    return { byEmail, byName };
  }, [leads]);
  const standingOf = (r: ListedLeadRow): RowStanding => {
    const e = normEmail(r.Email);
    const lead = (e.includes("@") ? leadIndex.byEmail.get(e) : undefined)
      ?? leadIndex.byName.get(seenNameKey(`${r["First Name"] || ""} ${r["Last Name"] || ""}`, r["Company Name"])) ?? null;
    if (!lead) return { lead: null, status: "notStored", seq: null };
    const d = apolloDetailOf(lead, apolloIndex);
    return { lead, status: d.status, seq: d.seq };
  };
  const standings = useMemo(() => {
    const m = new Map<string, Map<string, RowStanding>>();
    for (const l of lists) {
      const rows = new Map<string, RowStanding>();
      for (const r of l.rows) rows.set(r.__rowKey, standingOf(r));
      m.set(l.id, rows);
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lists, leadIndex, apolloIndex]);
  /** Lists showing only the leads ready for a sequence. */
  const [readyOnly, setReadyOnly] = useState<Set<string>>(new Set());
  const toggleReady = (id: string) => setReadyOnly((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const shownRows = (list: LeadList) => {
    if (!readyOnly.has(list.id)) return list.rows;
    const st = standings.get(list.id);
    return list.rows.filter((r) => { const s = st?.get(r.__rowKey)?.status; return !!s && s !== "notStored" && NEEDS.has(s); });
  };
  // Active in an Apollo sequence: stays on the list, left out of its
  // download unless overridden for the list or for that lead.
  const isActiveRow = (list: LeadList, r: ListedLeadRow) => standings.get(list.id)?.get(r.__rowKey)?.status === "active";
  const rowOverridden = (list: LeadList, r: ListedLeadRow) => !!list.includeActive || (list.includeRowKeys ?? []).includes(r.__rowKey);
  const heldBack = (list: LeadList, r: ListedLeadRow) => isActiveRow(list, r) && !rowOverridden(list, r);
  const downloadRows = (list: LeadList) => shownRows(list).filter((r) => !heldBack(list, r));
  function toggleRowOverride(list: LeadList, rowKey: string) {
    if (!onUpdateMeta) return;
    const cur = new Set(list.includeRowKeys ?? []);
    if (cur.has(rowKey)) cur.delete(rowKey); else cur.add(rowKey);
    onUpdateMeta(list.id, { includeRowKeys: [...cur] });
  }
  function checkList(list: LeadList) {
    if (!onCheckLeads) return;
    const st = standings.get(list.id);
    const stored = [...new Map(list.rows.map((r) => st?.get(r.__rowKey)?.lead).filter((l): l is StoredLead => !!l).map((l) => [l.key, l])).values()];
    if (stored.length) onCheckLeads(stored.map((l) => l.key), `list "${list.name}"`);
  }

  // Per Jack: lists "with the created date and taggs so then i can move them
  // but maintain who i am contacting", cycled "every 45 or 60 days".
  const [tagF, setTagF] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const membership = useMemo(() => campaignMembership(lists), [lists]);
  const allTags = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of lists) for (const t of l.tags ?? []) m.set(t, (m.get(t) || 0) + 1);
    return [...m].sort((a, b) => a[0].localeCompare(b[0]));
  }, [lists]);
  const due = useMemo(() => lists.filter((l) => isActiveCampaign(l) && (daysToCycle(l) ?? 1) <= 0), [lists]);
  const [kindF, setKindF] = useState<"all" | "smart" | "plain">("all");
  const smartCount = lists.filter((l) => l.rule).length;
  // Per Jack: "pull up a seuqnece here … side by side". One list compared
  // at a time; the picker sets the list's sequence and campaign name.
  const [pickingId, setPickingId] = useState<string | null>(null);
  const [comparingId, setComparingId] = useState<string | null>(null);
  const [listQ, setListQ] = useState("");
  const known = useMemo(() => knownSequenceNames(leads, roster), [leads, roster]);
  const comparing = lists.find((l) => l.id === comparingId && l.targetSequence) ?? null;
  const compared = useMemo(() => {
    if (!comparing) return null;
    const st = standings.get(comparing.id);
    return {
      rows: comparing.rows.map((r) => compareRow(r, st?.get(r.__rowKey)?.lead ?? null, comparing.targetSequence || "", apolloIndex)),
      extras: sequenceOnly(comparing.targetSequence || "", comparing, leads, roster, apolloIndex),
    };
  }, [comparing, standings, leads, roster, apolloIndex]);
  const listNeedle = listQ.trim().toLowerCase();
  const shownLists = (tagF ? lists.filter((l) => (l.tags ?? []).some((t) => t.toLowerCase() === tagF.toLowerCase())) : lists)
    .filter((l) => kindF === "all" || (kindF === "smart" ? !!l.rule : !l.rule))
    .filter((l) => !listNeedle || [l.name, l.campaign, l.targetSequence, ...(l.tags ?? [])].some((x) => (x || "").toLowerCase().includes(listNeedle)));
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  function startRename(list: LeadList) {
    setRenamingId(list.id);
    setRenameValue(list.name);
  }
  function commitRename(id: string) {
    onRename(id, renameValue);
    setRenamingId(null);
  }
  function download(list: LeadList) {
    const fileName = /\.csv$/i.test(list.name) ? list.name : `${list.name}.csv`;
    downloadCSV(fileName, downloadRows(list), EXPORT_LABELS);
  }
  async function handleDelete(list: LeadList) {
    if (await confirmAction(`Delete the list "${list.name}"? This only removes the list — the original leads stay in Scanner/History/Lead Library. This can't be undone.`, "Delete list")) {
      onDelete(list.id);
      if (expandedId === list.id) setExpandedId(null);
    }
  }

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>Loading your Lists…</div>;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Lists</h2>
      </div>
      <p style={{ margin: "4px 0 16px", fontSize: 12.5, color: "var(--muted)", maxWidth: 620 }}>
        Hand-picked groups of leads, any tier — built from Scanner's results table with "+ Add to list." Not the same as the
        Lead Library, which only ever files Strong Signal leads by month/category.
      </p>
      {error && <div style={{ color: "#B5443B", marginBottom: 12, fontSize: 12.5 }}>{error}</div>}

      {due.length > 0 && onCycle && (
        <div className="panel" aria-label="Due to cycle" style={{ padding: "10px 14px", marginBottom: 12, borderLeft: "3px solid #9A5B22" }}>
          <b>Due to cycle ({due.length})</b>
          <span className="muted" style={{ fontSize: 12.5 }}> · campaign lists past their window. Cycling moves their leads into a new dated list (grouped by company, summarized notes kept) and keeps the old one as history.</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
            {due.map((l) => (
              <button key={l.id} className="btn btn-sm btn-secondary" onClick={() => onCycle(l.id)} title={`Due ${cycleDueOn(l)}`}>
                ↻ Cycle "{l.name}" ({l.rows.length})
              </button>
            ))}
          </div>
        </div>
      )}
      {lists.length > 0 && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
          <input className="field" aria-label="Search lists" placeholder="Search lists, campaigns or sequences…" value={listQ}
            onChange={(e) => setListQ(e.target.value)} style={{ minWidth: 260 }} />
          {smartCount > 0 && (
            <select className="field" aria-label="Filter by kind" value={kindF} onChange={(e) => setKindF(e.target.value as "all" | "smart" | "plain")}>
              <option value="all">All lists ({lists.length})</option>
              <option value="smart">Smart lists ({smartCount})</option>
              <option value="plain">Hand-built lists ({lists.length - smartCount})</option>
            </select>
          )}
          {allTags.length > 0 && (
            <select className="field" aria-label="Filter by tag" value={tagF} onChange={(e) => setTagF(e.target.value)}>
              <option value="">All tags ({lists.length})</option>
              {allTags.map(([t, n]) => <option key={t} value={t}>{t} ({n})</option>)}
            </select>
          )}
        </div>
      )}

      {lists.length === 0 ? (
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: 28, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
          No lists yet. Select leads in Scanner's results table and use "+ Add to list" to start one.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {shownLists.map((list) => {
            const expanded = expandedId === list.id;
            const d = daysToCycle(list);
            const editing = editingId === list.id;
            return (
              <div key={list.id} aria-label={`List ${list.name}`} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 18px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                    <button
                      onClick={() => setExpandedId(expanded ? null : list.id)}
                      title={expanded ? "Collapse" : "Expand"}
                      style={{ border: "1px solid var(--border)", background: "var(--surface-sunken)", borderRadius: 7, width: 26, height: 26, cursor: "pointer" }}
                    >
                      {expanded ? "▾" : "▸"}
                    </button>
                    {renamingId === list.id ? (
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") commitRename(list.id); if (e.key === "Escape") setRenamingId(null); }}
                        onBlur={() => commitRename(list.id)}
                        style={{ border: "1px solid var(--border)", borderRadius: 7, padding: "4px 8px", fontWeight: 700, fontSize: 13.5 }}
                      />
                    ) : (
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 13.5 }}>
                          {list.name}
                          {list.rule && <span className="pill" title="A smart list: its saved rule re-runs whenever Lists is open, so it keeps itself current." style={{ marginLeft: 8, fontSize: 10.5, color: "#0E7A72", background: "#E3F3F1" }}>⚡ Smart list</span>}
                        </div>
                        <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
                          {list.rows.length} lead{list.rows.length === 1 ? "" : "s"} · created {new Date(list.createdAt).toLocaleDateString()}
                          {list.campaign && <> · campaign <b>{list.campaign}</b></>}
                          {list.targetSequence && list.targetSequence !== list.campaign && <> · sequence <b>{list.targetSequence}</b></>}
                          {list.targetSequence && list.targetSequenceOwner && <> · owner {list.targetSequenceOwner}</>}
                          {d !== null && list.status !== "cycled" && <> · {d > 0 ? `cycles in ${d}d (${cycleDueOn(list)})` : <b style={{ color: "#9A5B22" }}>due to cycle</b>}</>}
                          {list.status === "cycled" && <> · <span title="Its leads moved into a newer list">cycled</span></>}
                          {list.rule && list.ruleRefreshedAt && <> · refreshed {new Date(list.ruleRefreshedAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</>}
                        </div>
                        {list.rows.length > 0 && <ApolloSummary rows={list.rows} st={standings.get(list.id)} />}
                        {list.rule && (
                          <div aria-label={`Rule for ${list.name}`} style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 3 }}>
                            {describeRule(list.rule).map((c) => <span key={c} className="chip" style={{ fontSize: 11 }}>{c}</span>)}
                            {list.ruleText && <span className="muted" style={{ fontSize: 11 }} title="What you asked for">“{list.ruleText}”</span>}
                          </div>
                        )}
                        {(list.tags ?? []).length > 0 && (
                          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 3 }}>
                            {(list.tags ?? []).map((t) => <span key={t} className="chip" style={{ fontSize: 11 }}>{t}</span>)}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {onCheckLeads && list.rows.length > 0 && (() => {
                      const st = standings.get(list.id);
                      const stored = [...new Map(list.rows.map((r) => st?.get(r.__rowKey)?.lead).filter((l): l is StoredLead => !!l).map((l) => [l.key, l])).values()];
                      const due = leadsDueForApollo(stored).length;
                      return (
                        <button onClick={() => checkList(list)} disabled={checkBusy || !due} aria-label={`Check ${list.name} in Apollo`}
                          title={checkBusy ? "An Apollo check is already running" : due ? `Looks up ${due} lead${due === 1 ? "" : "s"} in Apollo (read-only). Anyone checked in the last 7 days is skipped.` : stored.length ? "Every stored lead on this list was checked in Apollo this week" : "None of these rows are saved in All leads"}
                          style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 12px", opacity: checkBusy || !due ? 0.55 : 1 }}>
                          ⟳ Check in Apollo{due ? ` (${due})` : ""}
                        </button>
                      );
                    })()}
                    {onUpdateMeta && (
                      <button onClick={() => setPickingId(pickingId === list.id ? null : list.id)} aria-label={`Pick sequence for ${list.name}`}
                        title="Pick the Apollo sequence this list is for (search by name). Also sets the campaign name."
                        style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 12px" }}>
                        🔗 {list.targetSequence ? "Change sequence" : "Pick sequence"}
                      </button>
                    )}
                    {list.targetSequence && (
                      <button onClick={() => setComparingId(comparingId === list.id ? null : list.id)} aria-label={`Compare ${list.name} with its sequence`}
                        aria-pressed={comparingId === list.id}
                        title={`Side by side with ${list.targetSequence}: who got added, who didn't, and why`}
                        style={{ background: comparingId === list.id ? "var(--brand-subtle, #E3F3F1)" : "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 12px" }}>
                        ⇄ Compare with sequence
                      </button>
                    )}
                    {(() => {
                      const n = downloadRows(list).length;
                      const held = shownRows(list).length - n;
                      // Per Jack: "Download CSV (830, 42 active left out) this
                      // is nonsense". The button says how many leads you get;
                      // the skipped ones are a separate plain note.
                      return (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                          <button onClick={() => download(list)} disabled={!n} aria-label={`Download ${list.name}`}
                            style={{ background: "#2CC295", color: "#081E22", border: "none", borderRadius: 8, padding: "6px 12px", fontWeight: 700, opacity: n ? 1 : 0.5 }}>
                            ⬇ Download {n.toLocaleString()} lead{n === 1 ? "" : "s"}
                          </button>
                          {held > 0 && (
                            <span className="muted" data-download-skipped style={{ fontSize: 12 }}
                              title="Already active in an Apollo sequence, so they aren't in the file. They stay on the list. Change this in the list's 'Active in a sequence' setting.">
                              skips {held.toLocaleString()} already in a sequence
                            </span>
                          )}
                        </span>
                      );
                    })()}
                    {list.rule && onRefreshSmart && list.status !== "cycled" && <button onClick={() => onRefreshSmart(list.id)} aria-label={`Refresh ${list.name}`} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 12px" }}>↻ Refresh</button>}
                    <button onClick={() => startRename(list)} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 12px" }}>Rename</button>
                    {onUpdateMeta && <button onClick={() => setEditingId(editing ? null : list.id)} aria-label={`Campaign settings for ${list.name}`} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 12px" }}>🏷 Tags & cycle</button>}
                    {onCycle && isCampaignList(list) && list.status !== "cycled" && list.rows.length > 0 && <button onClick={() => onCycle(list.id)} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 12px" }}>↻ Cycle now</button>}
                    <button onClick={() => handleDelete(list)} style={{ background: "var(--surface)", color: "#B5443B", border: "1px solid #F0C6C1", borderRadius: 8, padding: "6px 12px" }}>Delete</button>
                  </div>
                </div>

                {pickingId === list.id && onUpdateMeta && (
                  <SequencePicker list={list} known={known} onSearch={onSearchSequences} onClose={() => setPickingId(null)}
                    onPick={(sq) => {
                      onUpdateMeta(list.id, { targetSequence: sq.name, targetSequenceId: sq.id, targetSequenceOwner: sq.owner || undefined, campaign: sq.name });
                      setPickingId(null); setComparingId(list.id);
                    }} />
                )}
                {comparingId === list.id && comparing && compared && (
                  <ComparePanel list={comparing} compared={compared.rows} extras={compared.extras}
                    onRecheck={onCheckLeads ? (keys) => onCheckLeads(keys, `list "${list.name}" vs ${list.targetSequence}`, true) : undefined}
                    recheckBusy={checkBusy}
                    onNote={onUpdateMeta ? (rowKey, note) => {
                      const next = { ...(list.rowNotes ?? {}) };
                      if (note.trim()) next[rowKey] = note.trim(); else delete next[rowKey];
                      onUpdateMeta(list.id, { rowNotes: next });
                    } : undefined} />
                )}
                {editing && onUpdateMeta && (
                  <div aria-label="Campaign settings" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginTop: 10, fontSize: 12.5 }}>
                    <label>Campaign <input className="field" aria-label="Campaign" defaultValue={list.campaign || ""} onBlur={(e) => onUpdateMeta(list.id, { campaign: e.target.value.trim() || undefined })} style={{ width: 200 }} /></label>
                    <label>Tags <input className="field" aria-label="Tags" placeholder="comma, separated" defaultValue={(list.tags ?? []).join(", ")} onBlur={(e) => onUpdateMeta(list.id, { tags: parseTags(e.target.value) })} style={{ width: 220 }} /></label>
                    <label>Cycle after{" "}
                      <select className="field" aria-label="Cycle after" value={list.cycleDays ?? ""} onChange={(e) => onUpdateMeta(list.id, { cycleDays: e.target.value ? Number(e.target.value) : null })}>
                        <option value="">No cycle</option>
                        {CYCLE_CHOICES.map((n) => <option key={n} value={n}>{n} days</option>)}
                      </select>
                    </label>
                  </div>
                )}
                {expanded && list.rows.some((r) => isActiveRow(list, r)) && (() => {
                  const active = list.rows.filter((r) => isActiveRow(list, r)).length;
                  return (
                    <label style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 10, fontSize: 12.5 }}>
                      {active} active in an Apollo sequence:
                      <select className="field" aria-label={`Active in a sequence in ${list.name}`} value={list.includeActive ? "include" : "leave"}
                        disabled={!onUpdateMeta}
                        onChange={(e) => onUpdateMeta?.(list.id, { includeActive: e.target.value === "include" })}>
                        <option value="leave">Keep on the list, leave out of the download</option>
                        <option value="include">Include them in the download</option>
                      </select>
                      {!list.includeActive && <span className="muted">(tick "Include" on a row to let one through)</span>}
                    </label>
                  );
                })()}
                {expanded && list.rows.length > 0 && (
                  <label style={{ display: "inline-flex", gap: 6, alignItems: "center", marginTop: 10, fontSize: 12.5 }}>
                    <input type="checkbox" aria-label={`Ready for a sequence only in ${list.name}`} checked={readyOnly.has(list.id)} onChange={() => toggleReady(list.id)} />
                    Ready for a sequence only <span className="muted">(ended without a conversation, no sequence, or not in Apollo; the download follows this)</span>
                  </label>
                )}
                {expanded && (
                  <div style={{ marginTop: 12, border: "1px solid var(--border)", borderRadius: 10, overflow: "auto", maxHeight: 340 }}>
                    {list.rows.length === 0 ? (
                      <div style={{ padding: 20, textAlign: "center", color: "var(--muted)", fontSize: 12.5 }}>
                        No leads in this list yet — select leads in Scanner and use "+ Add to list."
                      </div>
                    ) : (
                      <table style={{ width: "100%" }}>
                        <thead>
                          <tr style={{ background: "var(--surface-sunken)" }}>
                            <th style={{ textAlign: "left", padding: "8px 12px", fontSize: 11 }}>Company</th>
                            <th style={{ textAlign: "left", padding: "8px 12px", fontSize: 11 }}>Contact</th>
                            <th style={{ textAlign: "left", padding: "8px 12px", fontSize: 11 }}>Product line</th>
                            <th style={{ textAlign: "left", padding: "8px 12px", fontSize: 11 }}>Tier</th>
                            <th style={{ textAlign: "left", padding: "8px 12px", fontSize: 11 }}>Apollo</th>
                            <th style={{ textAlign: "left", padding: "8px 12px", fontSize: 11 }}>Sequence</th>
                            <th style={{ textAlign: "left", padding: "8px 12px", fontSize: 11 }}>Note</th>
                            <th style={{ textAlign: "left", padding: "8px 12px", fontSize: 11 }} title="Other live campaign lists this lead is on">Also on</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {shownRows(list).map((r) => {
                            const s = standings.get(list.id)?.get(r.__rowKey);
                            const sm = !s ? null : s.status === "notStored" ? NOT_STORED : STATUS_META[s.status];
                            // A CSP row has no product line or tier — it carries a
                            // priority band and a score instead. Render whichever it has.
                            const catMeta = r.__category ? CATEGORY_META[r.__category] : null;
                            const tierMeta = r.__tier ? (TIER_LABEL[r.__tier] || TIER_LABEL.mention) : null;
                            return (
                              <tr key={r.__rowKey} style={{ borderTop: "1px solid var(--border)" }}>
                                <td style={{ padding: "7px 12px", fontSize: 12.5 }}>{r["Company Name"] || "—"}</td>
                                <td style={{ padding: "7px 12px", fontSize: 12.5 }}>{`${r["First Name"]} ${r["Last Name"]}`.trim() || "—"}</td>
                                <td style={{ padding: "7px 12px" }}>
                                  {catMeta ? (
                                    <span style={{ fontSize: 10.5, fontWeight: 700, color: catMeta.color, background: catMeta.bg, borderRadius: 999, padding: "2px 9px", whiteSpace: "nowrap" }}>
                                      {catMeta.label}
                                    </span>
                                  ) : r.__band ? (
                                    <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--muted)", background: "var(--surface-sunken)", borderRadius: 999, padding: "2px 9px", whiteSpace: "nowrap" }}>
                                      {r.__band}
                                    </span>
                                  ) : <span style={{ color: "var(--muted)" }}>—</span>}
                                </td>
                                <td style={{ padding: "7px 12px" }}>
                                  {tierMeta ? (
                                    <span style={{ fontSize: 10.5, fontWeight: 700, color: tierMeta.color, background: tierMeta.bg, borderRadius: 999, padding: "2px 9px", whiteSpace: "nowrap" }}>
                                      {tierMeta.label}
                                    </span>
                                  ) : r.__score != null ? (
                                    <span style={{ fontSize: 11, fontWeight: 700, fontVariantNumeric: "tabular-nums" }} title="CSP score">{r.__score}</span>
                                  ) : <span style={{ color: "var(--muted)" }}>—</span>}
                                </td>
                                <td style={{ padding: "7px 12px" }} data-apollo={s?.status}>
                                  {sm && <span title={sm.hint} style={{ fontSize: 10.5, fontWeight: 700, color: sm.color, background: sm.bg, borderRadius: 999, padding: "2px 9px", whiteSpace: "nowrap" }}>{sm.short}</span>}
                                  {s?.status === "active" && !list.includeActive && (
                                    <label style={{ display: "flex", gap: 4, alignItems: "center", marginTop: 4, fontSize: 11, whiteSpace: "nowrap" }}
                                      title="Active in an Apollo sequence: left out of the download unless ticked">
                                      <input type="checkbox" aria-label={`Include ${r["Company Name"]} in the download`} disabled={!onUpdateMeta}
                                        checked={(list.includeRowKeys ?? []).includes(r.__rowKey)} onChange={() => toggleRowOverride(list, r.__rowKey)} />
                                      {(list.includeRowKeys ?? []).includes(r.__rowKey) ? "In download" : "Include"}
                                    </label>
                                  )}
                                </td>
                                <td style={{ padding: "7px 12px", fontSize: 11.5 }}>
                                  {s?.seq ? (
                                    <>
                                      <div>{s.seq.name}</div>
                                      <div className="muted">{s.seq.active ? "active" : "ended"}{s.seq.step != null ? ` · step ${s.seq.step}${s.seq.steps ? ` of ${s.seq.steps}` : ""}` : ""}{s.seq.reason ? ` · ${s.seq.reason}` : ""}</div>
                                    </>
                                  ) : <span style={{ color: "var(--muted)" }}>—</span>}
                                </td>
                                <td style={{ padding: "7px 12px", fontSize: 12, maxWidth: 320 }}>
                                  <div style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }} title={String(r.Notes || "")}>{stripSnippetPrefix(String(r.Notes || "")) || "—"}</div>
                                </td>
                                <td style={{ padding: "7px 12px", fontSize: 11.5 }}>
                                  {(membership.get(r.__rowKey) ?? []).filter((x) => x.id !== list.id).map((x) => <div key={x.id} style={{ color: "#9A5B22" }}>⚠ {x.name}</div>)}
                                </td>
                                <td style={{ padding: "7px 12px", textAlign: "right" }}>
                                  <button onClick={() => onRemoveRow(list.id, r.__rowKey)} title="Remove from this list" style={{ border: "none", background: "none", color: "#B5443B", cursor: "pointer" }}>✕</button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** "12 ready for a sequence · 3 active · 2 had a conversation · 4 not checked" */
function ApolloSummary({ rows, st }: { rows: ListedLeadRow[]; st?: Map<string, RowStanding> }) {
  const n = new Map<Status | "notStored", number>();
  for (const r of rows) { const s = st?.get(r.__rowKey)?.status; if (s) n.set(s, (n.get(s) || 0) + 1); }
  const ready = [...NEEDS].reduce((a, k) => a + (n.get(k) || 0), 0);
  const parts: string[] = [];
  if (ready) parts.push(`${ready} ready for a sequence`);
  for (const k of STATUS_ORDER) if (!NEEDS.has(k) && n.get(k)) parts.push(`${n.get(k)} ${STATUS_META[k].short.toLowerCase()}`);
  if (n.get("notStored")) parts.push(`${n.get("notStored")} not in All leads`);
  if (!parts.length) return null;
  return <div aria-label="Apollo summary" style={{ fontSize: 11.5, marginTop: 2 }}><b style={{ color: "#0E7A72" }}>Apollo:</b> {parts.join(" · ")}</div>;
}
