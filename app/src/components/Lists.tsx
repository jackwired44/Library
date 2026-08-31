// Custom Lead Lists — see CLAUDE.md "Custom Lead Lists." Jack hand-picks
// specific leads out of a Scanner batch (any tier, unlike the Lead Library)
// via the "+ Add to list" bulk action there, then manages/downloads those
// lists here. Adding happens in Scanner.tsx; this view only renames,
// removes a lead, deletes a list, and downloads.
import { useState } from "react";
import { CATEGORY_META, EXPORT_LABELS } from "../lib/detection";
import { downloadCSV } from "../lib/csv";
import type { LeadList } from "../lib/leadLists";

interface ListsProps {
  lists: LeadList[];
  loading: boolean;
  error: string | null;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onRemoveRow: (listId: string, rowKey: string) => void;
}

const TIER_LABEL: Record<string, { label: string; color: string; bg: string }> = {
  signal: { label: "Strong Signal", color: "#2CC295", bg: "#E7F1EA" },
  mention: { label: "Needs Review", color: "#9A5B22", bg: "#FBEBDD" },
  dq: { label: "Bad Lead", color: "#B5443B", bg: "#FBEAE8" },
};

export default function ListsView({ lists, loading, error, onRename, onDelete, onRemoveRow }: ListsProps) {
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

      {lists.length === 0 ? (
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 28, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
          No lists yet. Select leads in Scanner's results table and use "+ Add to list" to start one.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {lists.map((list) => {
            const expanded = expandedId === list.id;
            return (
              <div key={list.id} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 13, padding: "14px 18px" }}>
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
                        <div style={{ fontWeight: 700, fontSize: 13.5 }}>{list.name}</div>
                        <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
                          {list.rows.length} lead{list.rows.length === 1 ? "" : "s"} · created {new Date(list.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button onClick={() => download(list)} disabled={!list.rows.length} style={{ background: "#2CC295", color: "#081E22", border: "none", borderRadius: 8, padding: "6px 12px", fontWeight: 700, opacity: list.rows.length ? 1 : 0.5 }}>
                      ⬇ Download CSV
                    </button>
                    <button onClick={() => startRename(list)} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 12px" }}>Rename</button>
                    <button onClick={() => handleDelete(list)} style={{ background: "var(--surface)", color: "#B5443B", border: "1px solid #F0C6C1", borderRadius: 8, padding: "6px 12px" }}>Delete</button>
                  </div>
                </div>

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
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {list.rows.map((r) => {
                            const catMeta = CATEGORY_META[r.__category];
                            const tierMeta = TIER_LABEL[r.__tier] || TIER_LABEL.mention;
                            return (
                              <tr key={r.__rowKey} style={{ borderTop: "1px solid var(--border)" }}>
                                <td style={{ padding: "7px 12px", fontSize: 12.5 }}>{r["Company Name"] || "—"}</td>
                                <td style={{ padding: "7px 12px", fontSize: 12.5 }}>{`${r["First Name"]} ${r["Last Name"]}`.trim() || "—"}</td>
                                <td style={{ padding: "7px 12px" }}>
                                  <span style={{ fontSize: 10.5, fontWeight: 700, color: catMeta.color, background: catMeta.bg, borderRadius: 999, padding: "2px 9px", whiteSpace: "nowrap" }}>
                                    {catMeta.label}
                                  </span>
                                </td>
                                <td style={{ padding: "7px 12px" }}>
                                  <span style={{ fontSize: 10.5, fontWeight: 700, color: tierMeta.color, background: tierMeta.bg, borderRadius: 999, padding: "2px 9px", whiteSpace: "nowrap" }}>
                                    {tierMeta.label}
                                  </span>
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
