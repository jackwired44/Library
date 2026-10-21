// Custom Lead Lists — see CLAUDE.md "Custom Lead Lists." Jack hand-picks
// specific leads out of a Scanner batch (any tier, unlike the Lead Library)
// via the "+ Add to list" bulk action there, then manages/downloads those
// lists here. Adding happens in Scanner.tsx; this view only renames,
// removes a lead, deletes a list, and downloads.
import { useMemo, useState } from "react";
import { CATEGORY_META, EXPORT_LABELS, stripSnippetPrefix } from "../lib/detection";
import { downloadCSV } from "../lib/csv";
import { describeRule } from "../lib/smartRules";
import { campaignMembership, cycleDueOn, daysToCycle, isActiveCampaign, isCampaignList, parseTags, CYCLE_CHOICES, type LeadList } from "../lib/leadLists";

interface ListsProps {
  lists: LeadList[];
  loading: boolean;
  error: string | null;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onRemoveRow: (listId: string, rowKey: string) => void;
  /** Campaign fields: tags, campaign name, cycle window. */
  onUpdateMeta?: (id: string, patch: Partial<Pick<LeadList, "tags" | "campaign" | "cycleDays" | "status">>) => void;
  /** Move a campaign list's leads into a new dated list. */
  onCycle?: (id: string) => void;
  /** Re-run a smart list's saved rule against the current leads now. */
  onRefreshSmart?: (id: string) => void;
}

const TIER_LABEL: Record<string, { label: string; color: string; bg: string }> = {
  signal: { label: "Strong Signal", color: "#2CC295", bg: "#E7F1EA" },
  mention: { label: "Needs Review", color: "#9A5B22", bg: "#FBEBDD" },
  dq: { label: "Bad Lead", color: "#B5443B", bg: "#FBEAE8" },
};

export default function ListsView({ lists, loading, error, onRename, onDelete, onRemoveRow, onUpdateMeta, onCycle, onRefreshSmart }: ListsProps) {
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
  const shownLists = (tagF ? lists.filter((l) => (l.tags ?? []).some((t) => t.toLowerCase() === tagF.toLowerCase())) : lists)
    .filter((l) => kindF === "all" || (kindF === "smart" ? !!l.rule : !l.rule));
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
    downloadCSV(fileName, list.rows, EXPORT_LABELS);
  }
  function handleDelete(list: LeadList) {
    if (window.confirm(`Delete the list "${list.name}"? This only removes the list — the original leads stay in Scanner/History/Lead Library. This can't be undone.`)) {
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
      {(allTags.length > 0 || smartCount > 0) && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
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
                          {d !== null && list.status !== "cycled" && <> · {d > 0 ? `cycles in ${d}d (${cycleDueOn(list)})` : <b style={{ color: "#9A5B22" }}>due to cycle</b>}</>}
                          {list.status === "cycled" && <> · <span title="Its leads moved into a newer list">cycled</span></>}
                          {list.rule && list.ruleRefreshedAt && <> · refreshed {new Date(list.ruleRefreshedAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</>}
                        </div>
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
                    <button onClick={() => download(list)} disabled={!list.rows.length} style={{ background: "#2CC295", color: "#081E22", border: "none", borderRadius: 8, padding: "6px 12px", fontWeight: 700, opacity: list.rows.length ? 1 : 0.5 }}>
                      ⬇ Download CSV
                    </button>
                    {list.rule && onRefreshSmart && list.status !== "cycled" && <button onClick={() => onRefreshSmart(list.id)} aria-label={`Refresh ${list.name}`} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 12px" }}>↻ Refresh</button>}
                    <button onClick={() => startRename(list)} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 12px" }}>Rename</button>
                    {onUpdateMeta && <button onClick={() => setEditingId(editing ? null : list.id)} aria-label={`Campaign settings for ${list.name}`} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 12px" }}>🏷 Tags & cycle</button>}
                    {onCycle && isCampaignList(list) && list.status !== "cycled" && list.rows.length > 0 && <button onClick={() => onCycle(list.id)} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 12px" }}>↻ Cycle now</button>}
                    <button onClick={() => handleDelete(list)} style={{ background: "var(--surface)", color: "#B5443B", border: "1px solid #F0C6C1", borderRadius: 8, padding: "6px 12px" }}>Delete</button>
                  </div>
                </div>

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
                            <th style={{ textAlign: "left", padding: "8px 12px", fontSize: 11 }}>Note</th>
                            <th style={{ textAlign: "left", padding: "8px 12px", fontSize: 11 }} title="Other live campaign lists this lead is on">Also on</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {list.rows.map((r) => {
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
