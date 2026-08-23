import { Fragment, useMemo, useState } from "react";
import { BUCKET_META, CATEGORY_META, EXPORT_LABELS, type BucketKey, type ExportLabel, type ParsedFile } from "../lib/detection";
import { parseCSVText, downloadBlob } from "../lib/csv";
import {
  createGroup,
  renameGroup,
  deleteGroup,
  isMonthFolder,
  getFolderEntries,
  getCombinedFolderExport,
  persistLibraryEntry,
  persistGroup,
  deleteGroupFromDB,
  deleteLibraryEntryFromDB,
  updateLibraryRowField,
  deleteLibraryRow,
  moveLibraryRowToBucket,
  sortDynamicsStoredRows,
  type LibraryEntry,
  type LibraryGroup,
} from "../lib/library";
import { toCSV } from "../lib/csv";

// Fields editable inline per lead — Product Area is controlled via the
// "Move to" select instead (matches legacy's editableFields split).
const EDITABLE_FIELDS = EXPORT_LABELS.filter((f) => f !== "Product Area");
// DOM-size safeguard for an unusually large shared file — Download still
// exports every row regardless of this cap.
const ROW_EDITOR_CAP = 400;
const BUCKET_ORDER: BucketKey[] = ["dynamics", "dataPlatform", "m365Tenant"];

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
  const [openFolderId, setOpenFolderId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showNewGroupForm, setShowNewGroupForm] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const monthFolders = useMemo(
    () => groups.filter(isMonthFolder).sort((a, b) => new Date(`1 ${b.name}`).getTime() - new Date(`1 ${a.name}`).getTime()),
    [groups]
  );
  const customFolders = useMemo(
    () => groups.filter((g) => !isMonthFolder(g)).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [groups]
  );
  const filterFolders = (list: LibraryGroup[]) => (search.trim() ? list.filter((g) => g.name.toLowerCase().includes(search.trim().toLowerCase())) : list);

  function fileCountFor(groupId: string) {
    return getFolderEntries(entries, groupId).length;
  }

  function handleCreateGroup() {
    const { groups: next, group } = createGroup(groups, newGroupName, "");
    if (!group) return;
    setGroups(next);
    setShowNewGroupForm(false);
    setNewGroupName("");
    persistGroup(group);
  }
  function handleRenameGroup(id: string, name: string) {
    const next = renameGroup(groups, id, name, groups.find((g) => g.id === id)?.notes || "");
    setGroups(next);
    const updated = next.find((g) => g.id === id);
    if (updated) persistGroup(updated);
  }
  function handleDeleteGroup(id: string) {
    const { groups: nextGroups, entries: nextEntries } = deleteGroup(groups, entries, id);
    setGroups(nextGroups);
    setEntries(nextEntries);
    if (openFolderId === id) setOpenFolderId(null);
    deleteGroupFromDB(id);
    nextEntries.filter((e) => e.groupId === null).forEach((e) => persistLibraryEntry(e));
  }
  function handleDeleteEntry(id: string) {
    setEntries((prev) => prev.filter((e) => e.id !== id));
    deleteLibraryEntryFromDB(id);
  }
  function handleDownload(entry: LibraryEntry) {
    // Dynamics downloads seat-count sorted, same ranking as everywhere
    // else — the underlying stored order (append order) is left alone;
    // only the exported/displayed view is reordered.
    const rawText = entry.bucketKey === "dynamics" ? toCSV(sortDynamicsStoredRows(entry.rows), EXPORT_LABELS) : entry.rawText;
    downloadBlob(rawText, entry.fileName);
  }
  function handleLoad(fileName: string, rawText: string) {
    onLoadIntoScanner([parseCSVText(fileName, rawText)]);
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
  function toggleExpanded(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function handleRowField(entryId: string, rowKey: string, field: ExportLabel, value: string) {
    setEntries((prev) => {
      const next = updateLibraryRowField(prev, entryId, rowKey, field, value);
      const updated = next.find((e) => e.id === entryId);
      if (updated) persistLibraryEntry(updated);
      return next;
    });
  }
  function handleRowDelete(entryId: string, rowKey: string) {
    setEntries((prev) => {
      const next = deleteLibraryRow(prev, entryId, rowKey);
      const stillThere = next.find((e) => e.id === entryId);
      if (stillThere) persistLibraryEntry(stillThere);
      else deleteLibraryEntryFromDB(entryId);
      return next;
    });
  }
  function handleRowMove(entryId: string, rowKey: string, newBucket: BucketKey) {
    setEntries((prev) => {
      const source = prev.find((e) => e.id === entryId);
      const next = moveLibraryRowToBucket(prev, groups, entryId, rowKey, newBucket);
      next.forEach((e) => { if (e.groupId === source?.groupId && (e.id === entryId || e.bucketKey === newBucket)) persistLibraryEntry(e); });
      if (!next.some((e) => e.id === entryId)) deleteLibraryEntryFromDB(entryId);
      return next;
    });
  }

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: "#9aa1ac" }}>Loading your saved files…</div>;

  const openFolder = openFolderId ? groups.find((g) => g.id === openFolderId) : null;
  if (openFolder) {
    return (
      <FolderContents
        folder={openFolder}
        entries={entries}
        onBack={() => setOpenFolderId(null)}
        onRenameFolder={(name) => handleRenameGroup(openFolder.id, name)}
        expandedIds={expandedIds}
        onToggleExpanded={toggleExpanded}
        onDeleteEntry={handleDeleteEntry}
        onDownload={handleDownload}
        onLoad={handleLoad}
        onReceivedDate={handleReceivedDate}
        onRenameEntry={handleRename}
        onRowField={handleRowField}
        onRowDelete={handleRowDelete}
        onRowMove={handleRowMove}
      />
    );
  }

  return (
    <div>
      <p style={{ color: "#4c6167", maxWidth: 700 }}>
        Every month from October 2025 forward has its own folder, ready to file leads into whether or not anything's been
        uploaded yet. Each folder holds up to 4 files: one combined list of every Strong Signal lead that month, plus the 3
        category breakdowns. Only Strong Signal leads are ever kept here.
      </p>
      {error && <div style={{ color: "#9A5B22", marginBottom: 12 }}>{error}</div>}

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Filter folders by name"
        style={{ width: "100%", maxWidth: 360, border: "1px solid #E1E4E9", borderRadius: 9, padding: "8px 12px", marginBottom: 20 }}
      />

      <FolderSection title="Month folders">
        {filterFolders(monthFolders).map((g) => (
          <FolderCard key={g.id} group={g} fileCount={fileCountFor(g.id)} onOpen={() => setOpenFolderId(g.id)} />
        ))}
      </FolderSection>

      <FolderSection title="Custom folders">
        {filterFolders(customFolders).map((g) => (
          <FolderCard key={g.id} group={g} fileCount={fileCountFor(g.id)} onOpen={() => setOpenFolderId(g.id)} onDelete={() => handleDeleteGroup(g.id)} />
        ))}
        {showNewGroupForm ? (
          <div style={{ border: "1px solid #D5D9E0", borderRadius: 13, padding: 14, display: "flex", flexDirection: "column", gap: 8, minWidth: 160 }}>
            <input autoFocus placeholder="Folder name" value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} style={{ border: "1px solid #D8DBE1", borderRadius: 8, padding: "7px 10px" }} />
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={handleCreateGroup} style={{ background: "#2CC295", color: "#081E22", border: "none", borderRadius: 8, padding: "7px 12px", fontWeight: 700 }}>Create</button>
              <button onClick={() => setShowNewGroupForm(false)} style={{ background: "none", border: "none", textDecoration: "underline" }}>Cancel</button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowNewGroupForm(true)}
            style={{ border: "2px dashed #D8DCE2", borderRadius: 13, padding: 14, minWidth: 160, minHeight: 96, background: "#fff", color: "#4c6167", fontWeight: 600 }}
          >
            + New folder
          </button>
        )}
      </FolderSection>
    </div>
  );
}

function FolderSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ fontSize: 11.5, color: "#8b93a0", fontWeight: 700, textTransform: "uppercase", marginBottom: 10 }}>{title}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12 }}>{children}</div>
    </div>
  );
}

function FolderCard({ group, fileCount, onOpen, onDelete }: { group: LibraryGroup; fileCount: number; onOpen: () => void; onDelete?: () => void }) {
  return (
    <div style={{ position: "relative", border: "1px solid #E4E7EC", borderRadius: 13, background: "#fff" }}>
      <button onClick={onOpen} style={{ width: "100%", border: "none", background: "none", padding: 16, textAlign: "left", cursor: "pointer" }}>
        <div style={{ fontSize: 26, marginBottom: 6 }}>🗂️</div>
        <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 2 }}>{group.name}</div>
        <div style={{ fontSize: 11.5, color: "#9aa1ac" }}>{fileCount} of 4 files</div>
      </button>
      {onDelete && (
        <button onClick={onDelete} title="Delete folder (files stay, just ungrouped)" style={{ position: "absolute", top: 8, right: 8, border: "none", background: "none", color: "#B5443B", fontSize: 12 }}>✕</button>
      )}
    </div>
  );
}

interface FolderContentsProps {
  folder: LibraryGroup;
  entries: LibraryEntry[];
  onBack: () => void;
  onRenameFolder: (name: string) => void;
  expandedIds: Set<string>;
  onToggleExpanded: (id: string) => void;
  onDeleteEntry: (id: string) => void;
  onDownload: (entry: LibraryEntry) => void;
  onLoad: (fileName: string, rawText: string) => void;
  onReceivedDate: (id: string, value: string) => void;
  onRenameEntry: (id: string, name: string) => void;
  onRowField: (entryId: string, rowKey: string, field: ExportLabel, value: string) => void;
  onRowDelete: (entryId: string, rowKey: string) => void;
  onRowMove: (entryId: string, rowKey: string, newBucket: BucketKey) => void;
}

function FolderContents({
  folder,
  entries,
  onBack,
  onRenameFolder,
  expandedIds,
  onToggleExpanded,
  onDeleteEntry,
  onDownload,
  onLoad,
  onReceivedDate,
  onRenameEntry,
  onRowField,
  onRowDelete,
  onRowMove,
}: FolderContentsProps) {
  const folderEntries = getFolderEntries(entries, folder.id);
  const combined = getCombinedFolderExport(entries, folder.id);
  const combinedFileName = `All Strong Signal Leads — ${folder.name}.csv`;

  return (
    <div>
      <button onClick={onBack} style={{ border: "none", background: "none", color: "#4c6167", fontWeight: 600, marginBottom: 14, padding: 0, cursor: "pointer" }}>← Back to folders</button>
      <input
        defaultValue={folder.name}
        onBlur={(e) => onRenameFolder(e.target.value)}
        style={{ display: "block", fontSize: 21, fontWeight: 700, border: "none", marginBottom: 4, width: "100%", padding: 0 }}
      />
      <div style={{ color: "#9aa1ac", fontSize: 12.5, marginBottom: 20 }}>{folderEntries.length} of 3 category files filed · {combined.rowCount} total leads</div>

      {folderEntries.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: "#9aa1ac", background: "#fff", border: "1px solid #E4E7EC", borderRadius: 13 }}>
          Nothing filed into {folder.name} yet. Check "Save this batch's Strong Signal leads to the Library" on the Scanner's upload screen and pick this month to get started.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ background: "#fff", border: "1px solid #E4E7EC", borderRadius: 13, padding: "14px 18px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
              <div>
                <div style={{ fontWeight: 700 }}>All Strong Signal Leads</div>
                <div style={{ fontSize: 11.5, color: "#9aa1ac" }}>{combined.rowCount} leads combined from every category below — view/edit from the category file itself</div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => onLoad(combinedFileName, combined.rawText)} style={{ border: "1px solid #D5D9E0", background: "#fff", borderRadius: 7, padding: "6px 10px" }}>Load</button>
                <button onClick={() => downloadBlob(combined.rawText, combinedFileName)} style={{ border: "1px solid #D5D9E0", background: "#fff", borderRadius: 7, padding: "6px 10px" }}>⬇ Download</button>
              </div>
            </div>
          </div>

          {folderEntries.map((entry) => (
            <CategoryFileCard
              key={entry.id}
              entry={entry}
              expanded={expandedIds.has(entry.id)}
              onToggleExpanded={() => onToggleExpanded(entry.id)}
              onDelete={() => onDeleteEntry(entry.id)}
              onDownload={() => onDownload(entry)}
              onLoad={() => onLoad(entry.fileName, entry.rawText)}
              onReceivedDate={(v) => onReceivedDate(entry.id, v)}
              onRename={(v) => onRenameEntry(entry.id, v)}
              onRowField={(rowKey, field, value) => onRowField(entry.id, rowKey, field, value)}
              onRowDelete={(rowKey) => onRowDelete(entry.id, rowKey)}
              onRowMove={(rowKey, bk) => onRowMove(entry.id, rowKey, bk)}
            />
          ))}

          {BUCKET_ORDER.filter((bk) => !folderEntries.some((e) => e.bucketKey === bk)).map((bk) => (
            <div key={bk} style={{ background: "#F9FAFB", border: "1px dashed #E4E7EC", borderRadius: 13, padding: "14px 18px", color: "#9aa1ac" }}>
              <strong style={{ color: "#4c6167" }}>{BUCKET_META[bk].label}</strong> — no leads filed yet.
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface CategoryFileCardProps {
  entry: LibraryEntry;
  expanded: boolean;
  onToggleExpanded: () => void;
  onDelete: () => void;
  onDownload: () => void;
  onLoad: () => void;
  onReceivedDate: (value: string) => void;
  onRename: (value: string) => void;
  onRowField: (rowKey: string, field: ExportLabel, value: string) => void;
  onRowDelete: (rowKey: string) => void;
  onRowMove: (rowKey: string, newBucket: BucketKey) => void;
}

function CategoryFileCard({ entry, expanded, onToggleExpanded, onDelete, onDownload, onLoad, onReceivedDate, onRename, onRowField, onRowDelete, onRowMove }: CategoryFileCardProps) {
  const meta = CATEGORY_META[Object.keys(CATEGORY_META).find((k) => CATEGORY_META[k as keyof typeof CATEGORY_META].bucket === entry.bucketKey) as keyof typeof CATEGORY_META];
  const isDynamics = entry.bucketKey === "dynamics";
  // Ranked highest seat/user/license count first when this is the
  // Dynamics 365 file — a lead with no stated count sinks to its own
  // lower block rather than being treated as a count of 0.
  const displayRows = isDynamics ? sortDynamicsStoredRows(entry.rows) : entry.rows;
  return (
    <div style={{ background: "#fff", border: "1px solid #E4E7EC", borderRadius: 13, overflow: "hidden" }}>
      <div style={{ padding: "14px 18px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div style={{ flex: "1 1 200px" }}>
          <span style={{ fontSize: 10.5, background: meta.bg, color: meta.color, padding: "2px 8px", borderRadius: 20, fontWeight: 700, marginRight: 8 }}>{meta.label}</span>
          <input defaultValue={entry.fileName} onBlur={(e) => onRename(e.target.value)} style={{ border: "none", fontWeight: 600, width: "60%" }} />
          <div style={{ fontSize: 11.5, color: "#9aa1ac", marginTop: 2 }}>{entry.rowCount} leads · uploaded {new Date(entry.uploadedAt).toLocaleDateString()}</div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ fontSize: 11.5, color: "#9aa1ac" }}>Received:</label>
          <input type="date" defaultValue={entry.receivedAt || ""} onBlur={(e) => onReceivedDate(e.target.value)} style={{ border: "1px solid #D8DBE1", borderRadius: 7, padding: "5px 7px" }} />
          <button onClick={onToggleExpanded} title={expanded ? "Hide leads" : "Edit leads"} style={{ border: "1px solid #D5D9E0", background: expanded ? "#081E22" : "#fff", color: expanded ? "#fff" : "#081E22", borderRadius: 7, padding: "6px 9px" }}>{expanded ? "▴" : "▾"}</button>
          <button onClick={onLoad} style={{ border: "1px solid #D5D9E0", background: "#fff", borderRadius: 7, padding: "6px 10px" }}>Load</button>
          <button onClick={onDownload} style={{ border: "1px solid #D5D9E0", background: "#fff", borderRadius: 7, padding: "6px 10px" }}>⬇</button>
          <button onClick={onDelete} title="Remove this file" style={{ border: "1px solid #F0D6D6", background: "#fff", borderRadius: 7, padding: "6px 8px", color: "#B5443B" }}>✕</button>
        </div>
      </div>
      {expanded && (
        <div style={{ padding: "0 18px 16px", overflowX: "auto", borderTop: "1px solid #F0F1F4" }}>
          {displayRows.length === 0 ? (
            <div style={{ fontSize: 12, color: "#9aa1ac", paddingTop: 12 }}>No individual leads left in this file.</div>
          ) : (
            <table style={{ marginTop: 10 }}>
              <thead>
                <tr>
                  {isDynamics && <th style={{ textAlign: "left", padding: "6px 8px", fontSize: 10, color: "#9aa1ac", textTransform: "uppercase" }}>Seats</th>}
                  {EDITABLE_FIELDS.map((f) => (
                    <th key={f} style={{ textAlign: "left", padding: "6px 8px", fontSize: 10, color: "#9aa1ac", textTransform: "uppercase" }}>{f}</th>
                  ))}
                  <th style={{ textAlign: "left", padding: "6px 8px", fontSize: 10, color: "#9aa1ac", textTransform: "uppercase" }}>Category</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {displayRows.slice(0, ROW_EDITOR_CAP).map((row, idx) => {
                  const rowKey = row.__rowKey || String(idx);
                  return (
                    <Fragment key={rowKey}>
                      <tr style={{ borderTop: "1px solid #EEF0F3" }}>
                        {isDynamics && <td style={{ padding: "4px 6px", fontSize: 12, color: row.__dynamicsSeatCount != null ? "#081E22" : "#9aa1ac", fontWeight: row.__dynamicsSeatCount != null ? 700 : 400 }}>{row.__dynamicsSeatCount ?? "—"}</td>}
                        {EDITABLE_FIELDS.map((f) => (
                          <td key={f} style={{ padding: "4px 6px" }}>
                            <input defaultValue={row[f] || ""} onBlur={(ev) => onRowField(rowKey, f, ev.target.value)} style={{ width: "100%", minWidth: 90, border: "1px solid transparent", borderRadius: 5, padding: "5px 6px", fontSize: 12 }} />
                          </td>
                        ))}
                        <td style={{ padding: "4px 6px", whiteSpace: "nowrap" }}>
                          <select value={entry.bucketKey} onChange={(ev) => onRowMove(rowKey, ev.target.value as BucketKey)} style={{ border: "1px solid #D8DBE1", borderRadius: 6, padding: "4px 6px", fontSize: 11.5, fontWeight: 600 }}>
                            {(Object.keys(BUCKET_META) as BucketKey[]).map((bk) => (
                              <option key={bk} value={bk}>{BUCKET_META[bk].label}</option>
                            ))}
                          </select>
                        </td>
                        <td style={{ padding: "4px 6px" }}>
                          <button onClick={() => onRowDelete(rowKey)} title="Delete this lead" style={{ border: "1px solid #F0D6D6", background: "#fff", borderRadius: 6, padding: "5px 7px", color: "#B5443B" }}>✕</button>
                        </td>
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
          {entry.rows.length > ROW_EDITOR_CAP && (
            <div style={{ fontSize: 11, color: "#9aa1ac", marginTop: 8 }}>Showing the first {ROW_EDITOR_CAP} of {entry.rows.length} leads — Download still gets every row.</div>
          )}
        </div>
      )}
    </div>
  );
}
