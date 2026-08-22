import { useMemo, useState } from "react";
import { CATEGORY_META, type CategoryKey, type ParsedFile } from "../lib/detection";
import { parseCSVText, downloadBlob } from "../lib/csv";
import {
  createGroup,
  renameGroup,
  deleteGroup,
  getGroupCounts,
  getFilteredLibrary,
  getLibraryEntryCategoryCounts,
  persistLibraryEntry,
  persistGroup,
  deleteGroupFromDB,
  deleteLibraryEntryFromDB,
  type LibraryEntry,
  type LibraryGroup,
} from "../lib/library";

interface LibraryProps {
  entries: LibraryEntry[];
  setEntries: React.Dispatch<React.SetStateAction<LibraryEntry[]>>;
  groups: LibraryGroup[];
  setGroups: React.Dispatch<React.SetStateAction<LibraryGroup[]>>;
  loading: boolean;
  error: string | null;
  onLoadIntoScanner: (parsedFiles: ParsedFile[]) => void;
}

export default function LibraryView({ entries, setEntries, groups, setGroups, loading, error, onLoadIntoScanner }: LibraryProps) {
  const [groupFilter, setGroupFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState<CategoryKey | "all">("all");
  const [search, setSearch] = useState("");
  const [showNewGroupForm, setShowNewGroupForm] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupNotes, setNewGroupNotes] = useState("");

  const filtered = useMemo(() => getFilteredLibrary(entries, groups, groupFilter, categoryFilter, search), [entries, groups, groupFilter, categoryFilter, search]);
  const groupCounts = useMemo(() => getGroupCounts(entries, groups), [entries, groups]);

  function handleCreateGroup() {
    const { groups: next, group } = createGroup(groups, newGroupName, newGroupNotes);
    if (!group) return;
    setGroups(next);
    setShowNewGroupForm(false);
    setNewGroupName("");
    setNewGroupNotes("");
    persistGroup(group);
  }
  function handleRenameGroup(id: string, name: string, notes: string) {
    const next = renameGroup(groups, id, name, notes);
    setGroups(next);
    const updated = next.find((g) => g.id === id);
    if (updated) persistGroup(updated);
  }
  function handleDeleteGroup(id: string) {
    const { groups: nextGroups, entries: nextEntries } = deleteGroup(groups, entries, id);
    setGroups(nextGroups);
    setEntries(nextEntries);
    if (groupFilter === id) setGroupFilter("all");
    deleteGroupFromDB(id);
    nextEntries.filter((e) => e.groupId === null).forEach((e) => persistLibraryEntry(e));
  }
  function handleDeleteEntry(id: string) {
    setEntries((prev) => prev.filter((e) => e.id !== id));
    deleteLibraryEntryFromDB(id);
  }
  function handleDownload(entry: LibraryEntry) {
    downloadBlob(entry.rawText, entry.fileName);
  }
  function handleLoad(entry: LibraryEntry) {
    onLoadIntoScanner([parseCSVText(entry.fileName, entry.rawText)]);
  }
  function handleAssignGroup(entryId: string, groupId: string) {
    setEntries((prev) => {
      const next = prev.map((e) => (e.id === entryId ? { ...e, groupId: groupId || null } : e));
      const updated = next.find((e) => e.id === entryId);
      if (updated) persistLibraryEntry(updated);
      return next;
    });
  }
  function handleReceivedDate(entryId: string, value: string) {
    setEntries((prev) => {
      const next = prev.map((e) => (e.id === entryId ? { ...e, receivedAt: value || null } : e));
      const updated = next.find((e) => e.id === entryId);
      if (updated) persistLibraryEntry(updated);
      return next;
    });
  }
  function handleRename(entryId: string, name: string) {
    const trimmed = name.trim();
    setEntries((prev) => {
      const entry = prev.find((e) => e.id === entryId);
      if (!entry || !trimmed || trimmed === entry.fileName) return prev;
      const next = prev.map((e) => (e.id === entryId ? { ...e, fileName: trimmed } : e));
      persistLibraryEntry({ ...entry, fileName: trimmed });
      return next;
    });
  }

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: "#9aa1ac" }}>Loading your saved files…</div>;

  return (
    <div>
      <p style={{ color: "#4c6167", maxWidth: 700 }}>
        Every batch you choose to save from the Scanner lands here, permanently. Only Strong Signal leads are kept; each month
        folder holds up to 3 files, one per downloadable category.
      </p>
      {error && <div style={{ color: "#9A5B22", marginBottom: 12 }}>{error}</div>}

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11.5, color: "#8b93a0", fontWeight: 700, textTransform: "uppercase" }}>Folders:</span>
        <button onClick={() => setGroupFilter("all")} style={folderBtnStyle(groupFilter === "all")}>All files ({groupCounts.all})</button>
        <button onClick={() => setGroupFilter("ungrouped")} style={folderBtnStyle(groupFilter === "ungrouped")}>Ungrouped ({groupCounts.ungrouped})</button>
        {groups.map((g) => (
          <button key={g.id} onClick={() => setGroupFilter(g.id)} style={folderBtnStyle(groupFilter === g.id)}>{g.name} ({groupCounts[g.id] || 0})</button>
        ))}
        <button onClick={() => setShowNewGroupForm((v) => !v)} style={{ border: "1px solid #D5D9E0", background: "#fff", borderRadius: 9, padding: "7px 13px" }}>+ New group</button>
      </div>

      {showNewGroupForm && (
        <div style={{ background: "#F9FAFB", border: "1px solid #E4E7EC", borderRadius: 13, padding: "14px 17px", marginBottom: 16 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: groups.length ? 14 : 0 }}>
            <input placeholder="Group name" value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} style={{ flex: "1 1 200px", border: "1px solid #D8DBE1", borderRadius: 8, padding: "8px 11px" }} />
            <input placeholder="Notes (optional)" value={newGroupNotes} onChange={(e) => setNewGroupNotes(e.target.value)} style={{ flex: "2 1 260px", border: "1px solid #D8DBE1", borderRadius: 8, padding: "8px 11px" }} />
            <button onClick={handleCreateGroup} style={{ background: "#2CC295", color: "#081E22", border: "none", borderRadius: 8, padding: "8px 16px", fontWeight: 700 }}>Create</button>
            <button onClick={() => setShowNewGroupForm(false)} style={{ background: "none", border: "none", textDecoration: "underline" }}>Cancel</button>
          </div>
          {groups.length > 0 && (
            <div style={{ borderTop: "1px solid #E4E7EC", paddingTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
              {groups.map((g) => (
                <div key={g.id} style={{ display: "flex", gap: 8, alignItems: "center", background: "#fff", border: "1px solid #E4E7EC", borderRadius: 9, padding: "6px 11px" }}>
                  <input defaultValue={g.name} onBlur={(e) => handleRenameGroup(g.id, e.target.value, g.notes)} style={{ flex: "1 1 160px", border: "none", fontWeight: 600 }} />
                  <input defaultValue={g.notes} placeholder="Notes" onBlur={(e) => handleRenameGroup(g.id, g.name, e.target.value)} style={{ flex: "2 1 200px", border: "none", color: "#4c6167" }} />
                  <span style={{ fontSize: 11.5, color: "#9aa1ac" }}>{groupCounts[g.id] || 0} file{(groupCounts[g.id] || 0) === 1 ? "" : "s"}</span>
                  <button onClick={() => handleDeleteGroup(g.id)} title="Delete group (files stay, just ungrouped)" style={{ border: "1px solid #F0D6D6", background: "#fff", borderRadius: 6, padding: "5px 8px", color: "#B5443B" }}>✕</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11.5, color: "#8b93a0", fontWeight: 700, textTransform: "uppercase" }}>Category:</span>
        <button onClick={() => setCategoryFilter("all")} style={folderBtnStyle(categoryFilter === "all")}>All categories</button>
        {(Object.keys(CATEGORY_META) as CategoryKey[]).map((k) => (
          <button key={k} onClick={() => setCategoryFilter(k)} style={folderBtnStyle(categoryFilter === k)}>{CATEGORY_META[k].label}</button>
        ))}
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter by file or group name" style={{ flex: "1 1 200px", border: "1px solid #E1E4E9", borderRadius: 9, padding: "8px 12px" }} />
      </div>

      {entries.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: "#9aa1ac", background: "#fff", border: "1px solid #E4E7EC", borderRadius: 13 }}>
          No files saved yet. Check "Save this batch's Strong Signal leads to the Library" on the Scanner's upload screen to start filing batches here.
        </div>
      ) : (
        <div style={{ background: "#fff", border: "1px solid #E4E7EC", borderRadius: 13, overflow: "auto" }}>
          <table>
            <thead>
              <tr style={{ background: "#F9FAFB" }}>
                <th style={{ textAlign: "left", padding: "11px 14px" }}>File name</th>
                <th style={{ textAlign: "left", padding: "11px 14px" }}>Group</th>
                <th style={{ textAlign: "left", padding: "11px 14px" }}>Rows</th>
                <th style={{ textAlign: "left", padding: "11px 14px" }}>Leads received</th>
                <th style={{ textAlign: "left", padding: "11px 14px" }}>Uploaded here</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={6} style={{ padding: 36, textAlign: "center", color: "#9aa1ac" }}>No files match this filter.</td></tr>
              ) : (
                filtered.map((e) => {
                  const counts = getLibraryEntryCategoryCounts(e);
                  return (
                    <tr key={e.id} style={{ borderBottom: "1px solid #F0F1F4" }}>
                      <td style={{ padding: "10px 14px", minWidth: 200 }}>
                        <input defaultValue={e.fileName} onBlur={(ev) => handleRename(e.id, ev.target.value)} style={{ width: "100%", border: "none", fontWeight: 600 }} />
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 2 }}>
                          {(Object.keys(CATEGORY_META) as CategoryKey[]).filter((k) => counts[k] > 0).map((k) => (
                            <span key={k} style={{ fontSize: 10, background: CATEGORY_META[k].bg, color: CATEGORY_META[k].color, padding: "1px 6px", borderRadius: 20 }}>{CATEGORY_META[k].label} {counts[k]}</span>
                          ))}
                        </div>
                      </td>
                      <td style={{ padding: "10px 14px" }}>
                        <select value={e.groupId || ""} onChange={(ev) => handleAssignGroup(e.id, ev.target.value)} style={{ border: "1px solid #D8DBE1", borderRadius: 7, padding: "6px 8px" }}>
                          <option value="">Ungrouped</option>
                          {groups.map((g) => (
                            <option key={g.id} value={g.id}>{g.name}</option>
                          ))}
                        </select>
                      </td>
                      <td style={{ padding: "10px 14px" }}>{e.rowCount}</td>
                      <td style={{ padding: "10px 14px" }}>
                        <input type="date" defaultValue={e.receivedAt || ""} onBlur={(ev) => handleReceivedDate(e.id, ev.target.value)} style={{ border: "1px solid #D8DBE1", borderRadius: 7, padding: "5px 7px" }} />
                      </td>
                      <td style={{ padding: "10px 14px", color: "#8b93a0", whiteSpace: "nowrap" }}>{new Date(e.uploadedAt).toLocaleDateString()}</td>
                      <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button onClick={() => handleLoad(e)} title="Load into Scanner" style={{ border: "1px solid #D5D9E0", background: "#fff", borderRadius: 7, padding: "6px 10px" }}>Load</button>
                          <button onClick={() => handleDownload(e)} title="Download" style={{ border: "1px solid #D5D9E0", background: "#fff", borderRadius: 7, padding: "6px 10px" }}>⬇</button>
                          <button onClick={() => handleDeleteEntry(e.id)} title="Remove from Library" style={{ border: "1px solid #F0D6D6", background: "#fff", borderRadius: 7, padding: "6px 8px", color: "#B5443B" }}>✕</button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function folderBtnStyle(active: boolean): React.CSSProperties {
  return { border: "none", borderRadius: 8, padding: "7px 12px", fontWeight: 600, background: active ? "#081e22" : "#F6FAFA", color: active ? "#fff" : "#4c6167" };
}
