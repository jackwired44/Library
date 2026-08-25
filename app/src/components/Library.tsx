import { useMemo, useRef, useState, Fragment } from "react";
import {
  ACTIVE_BUCKET_KEYS,
  BUCKET_META,
  CATEGORY_META,
  DISPOSITION_META,
  DISPOSITION_ORDER,
  EXPORT_LABELS,
  scanParsedFiles,
  type BucketKey,
  type Disposition,
  type ExportLabel,
  type ParsedFile,
  type ResultRow,
  type RuleOverrides,
} from "../lib/detection";
import { parseCSVFile, parseCSVText, downloadBlob } from "../lib/csv";
import type { HistoryEntry } from "../lib/history";
import {
  createGroup,
  renameGroup,
  deleteGroup,
  isMonthFolder,
  getFolderEntries,
  getCombinedFolderExport,
  fileSignalRowsIntoGroup,
  persistLibraryEntry,
  persistLibraryEntries,
  persistGroup,
  deleteGroupFromDB,
  deleteLibraryEntryFromDB,
  updateLibraryRowField,
  updateLibraryRowStatus,
  deleteLibraryRow,
  moveLibraryRowToBucket,
  sortDynamicsStoredRows,
  setGroupPrivate,
  setGroupPublic,
  type LibraryEntry,
  type LibraryGroup,
  type StoredRow,
} from "../lib/library";
import { hashFolderPassword, checkFolderPassword } from "../lib/folderAuth";
import { toCSV } from "../lib/csv";

// Fields editable inline per lead — Product Area is controlled via the
// "Move to" select instead (matches legacy's editableFields split).
const EDITABLE_FIELDS = EXPORT_LABELS.filter((f) => f !== "Product Area");
// DOM-size safeguard for an unusually large shared file — Download still
// exports every row regardless of this cap.
const ROW_EDITOR_CAP = 400;

interface LibraryProps {
  entries: LibraryEntry[];
  setEntries: React.Dispatch<React.SetStateAction<LibraryEntry[]>>;
  groups: LibraryGroup[];
  setGroups: React.Dispatch<React.SetStateAction<LibraryGroup[]>>;
  loading: boolean;
  error: string | null;
  onLoadIntoScanner: (parsedFiles: ParsedFile[]) => void;
  // Uploading a CSV straight into an open folder scans it (same engine the
  // Scanner uses) and files its Strong Signal rows into THIS folder's
  // category files — every scan gets recorded to History too, same as a
  // Scanner upload, via the same callback Scanner itself uses.
  onRecordHistory: (parsedFiles: ParsedFile[], scanned: ResultRow[], tag?: string) => HistoryEntry;
  ruleOverrides: RuleOverrides;
}

export default function LibraryView({ entries, setEntries, groups, setGroups, loading, error, onLoadIntoScanner, onRecordHistory, ruleOverrides }: LibraryProps) {
  const [openFolderId, setOpenFolderId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showNewGroupForm, setShowNewGroupForm] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  // Which private folders have had their password entered THIS visit — kept
  // only in memory, never persisted, and dropped for a folder the moment you
  // leave it (see handleBack) so a private folder always re-prompts on the
  // next visit, per CLAUDE.md.
  const [unlockedFolderIds, setUnlockedFolderIds] = useState<Set<string>>(new Set());

  const monthFolders = useMemo(
    () => groups.filter(isMonthFolder).sort((a, b) => new Date(`1 ${b.name}`).getTime() - new Date(`1 ${a.name}`).getTime()),
    [groups]
  );
  const customFolders = useMemo(
    () => groups.filter((g) => !isMonthFolder(g)).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [groups]
  );
  const filterFolders = (list: LibraryGroup[]) => (search.trim() ? list.filter((g) => g.name.toLowerCase().includes(search.trim().toLowerCase())) : list);
  // Deleting a folder ungroups its files (groupId: null) rather than
  // deleting them — this is what keeps them reachable afterward instead of
  // silently stranded outside any folder the UI ever shows.
  const ungroupedEntries = useMemo(() => entries.filter((e) => !e.groupId), [entries]);

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
  function handleBack() {
    if (openFolderId) {
      setUnlockedFolderIds((prev) => {
        const next = new Set(prev);
        next.delete(openFolderId);
        return next;
      });
    }
    setOpenFolderId(null);
    setUploadNotice(null);
    setUploadError(null);
  }
  async function handleUnlockFolder(id: string, password: string): Promise<boolean> {
    const group = groups.find((g) => g.id === id);
    if (!group || !group.passwordHash || !group.passwordSalt) return false;
    const ok = await checkFolderPassword(password, group.passwordHash, group.passwordSalt);
    if (ok) setUnlockedFolderIds((prev) => new Set(prev).add(id));
    return ok;
  }
  async function handleSetPrivate(id: string, password: string) {
    const { hash, salt } = await hashFolderPassword(password);
    const next = setGroupPrivate(groups, id, hash, salt);
    setGroups(next);
    const updated = next.find((g) => g.id === id);
    if (updated) persistGroup(updated);
    // Already inside the folder, having just chosen the password — no need
    // to immediately re-prompt for it.
    setUnlockedFolderIds((prev) => new Set(prev).add(id));
  }
  function handleSetPublic(id: string) {
    const next = setGroupPublic(groups, id);
    setGroups(next);
    const updated = next.find((g) => g.id === id);
    if (updated) persistGroup(updated);
  }
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  async function handleUploadIntoFolder(groupId: string, files: FileList | null) {
    const csvFiles = Array.from(files || []).filter((f) => /\.csv$/i.test(f.name));
    if (!csvFiles.length) return;
    setUploadError(null);
    setUploadNotice(null);
    try {
      const parsedFiles = await Promise.all(csvFiles.map(parseCSVFile));
      const { results: scanned, duplicatesRemoved } = scanParsedFiles(parsedFiles, ruleOverrides);
      const signalRows = scanned.filter((r) => r.tier === "signal" && !r.isDuplicate);
      const folderName = groups.find((g) => g.id === groupId)?.name || "this folder";
      // Record History FIRST so the Library filing below can stamp its rows
      // with the real History entry id, not a throwaway one.
      const historyEntry = onRecordHistory(parsedFiles, scanned, `Uploaded into ${folderName}`);
      const { entries: nextEntries, touchedIds } = fileSignalRowsIntoGroup(entries, groups, groupId, signalRows, historyEntry.id);
      setEntries(nextEntries);
      const touchedEntries = nextEntries.filter((e) => touchedIds.includes(e.id));
      await persistLibraryEntries(touchedEntries);
      const filedMessage =
        signalRows.length > 0
          ? `Filed ${signalRows.length} Strong Signal lead${signalRows.length === 1 ? "" : "s"} into ${folderName}.`
          : "No Strong Signal leads in that file — nothing to file.";
      // Per Jack: no duplicate (exact name+company match within this same
      // upload) should ever make it in at all — already dropped inside
      // scanParsedFiles; surfaced here so it isn't silent.
      setUploadNotice(duplicatesRemoved > 0 ? `${filedMessage} Removed ${duplicatesRemoved} duplicate lead${duplicatesRemoved === 1 ? "" : "s"}.` : filedMessage);
    } catch (err) {
      setUploadNotice(null);
      setUploadError(err instanceof Error ? err.message : "Could not parse that file.");
    }
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
  function handleRowStatus(entryId: string, rowKey: string, patch: Partial<Pick<StoredRow, "__disposition" | "__dispositionNote" | "__priority" | "__priorityMonth">>) {
    setEntries((prev) => {
      const next = updateLibraryRowStatus(prev, entryId, rowKey, patch);
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
    if (openFolder.isPrivate && !unlockedFolderIds.has(openFolder.id)) {
      return <FolderPasswordGate folder={openFolder} onBack={handleBack} onUnlock={(password) => handleUnlockFolder(openFolder.id, password)} />;
    }
    return (
      <FolderContents
        folder={openFolder}
        entries={entries}
        onBack={handleBack}
        onRenameFolder={(name) => handleRenameGroup(openFolder.id, name)}
        expandedIds={expandedIds}
        onToggleExpanded={toggleExpanded}
        onDeleteEntry={handleDeleteEntry}
        onDownload={handleDownload}
        onLoad={handleLoad}
        onReceivedDate={handleReceivedDate}
        onRenameEntry={handleRename}
        onRowField={handleRowField}
        onRowStatus={handleRowStatus}
        onRowDelete={handleRowDelete}
        onRowMove={handleRowMove}
        onSetPrivate={(password) => handleSetPrivate(openFolder.id, password)}
        onSetPublic={() => handleSetPublic(openFolder.id)}
        onUpload={(files) => handleUploadIntoFolder(openFolder.id, files)}
        uploadNotice={uploadNotice}
        uploadError={uploadError}
      />
    );
  }

  return (
    <div>
      <p style={{ color: "#4c6167", maxWidth: 700 }}>
        Every month from October 2025 forward has its own folder, ready to file leads into whether or not anything's been
        uploaded yet. Each folder holds up to 3 files: one combined list of every Strong Signal lead that month, plus the 2
        category breakdowns (Dynamics 365, M365 / Azure). Only Strong Signal leads are ever kept here.
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

      {ungroupedEntries.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 11.5, color: "#8b93a0", fontWeight: 700, textTransform: "uppercase", marginBottom: 10 }}>
            Ungrouped files — from a deleted folder
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {ungroupedEntries.map((entry) => (
              <div key={entry.id} style={{ background: "#fff", border: "1px solid #E4E7EC", borderRadius: 13, padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{entry.fileName}</div>
                  <div style={{ fontSize: 11.5, color: "#9aa1ac" }}>{entry.rowCount} leads · {BUCKET_META[entry.bucketKey].label}</div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => handleLoad(entry.fileName, entry.rawText)} style={{ border: "1px solid #D5D9E0", background: "#fff", borderRadius: 7, padding: "6px 10px" }}>Load</button>
                  <button onClick={() => handleDownload(entry)} style={{ border: "1px solid #D5D9E0", background: "#fff", borderRadius: 7, padding: "6px 10px" }}>⬇ Download</button>
                  <button onClick={() => handleDeleteEntry(entry.id)} title="Delete this file" style={{ border: "1px solid #F0D6D6", background: "#fff", borderRadius: 7, padding: "6px 8px", color: "#B5443B" }}>✕</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
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
    <div data-folder-id={group.id} style={{ position: "relative", border: "1px solid #E4E7EC", borderRadius: 13, background: "#fff" }}>
      <button onClick={onOpen} style={{ width: "100%", border: "none", background: "none", padding: 16, textAlign: "left", cursor: "pointer" }}>
        <div style={{ fontSize: 26, marginBottom: 6 }}>{group.isPrivate ? "🔒" : "🗂️"}</div>
        <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 2 }}>{group.name}</div>
        <div style={{ fontSize: 11.5, color: "#9aa1ac" }}>{fileCount} of 3 files{group.isPrivate ? " · Private" : ""}</div>
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
  onRowStatus: (entryId: string, rowKey: string, patch: Partial<Pick<StoredRow, "__disposition" | "__dispositionNote" | "__priority" | "__priorityMonth">>) => void;
  onRowDelete: (entryId: string, rowKey: string) => void;
  onRowMove: (entryId: string, rowKey: string, newBucket: BucketKey) => void;
  onSetPrivate: (password: string) => void;
  onSetPublic: () => void;
  onUpload: (files: FileList | null) => void;
  uploadNotice: string | null;
  uploadError: string | null;
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
  onRowStatus,
  onRowDelete,
  onRowMove,
  onSetPrivate,
  onSetPublic,
  onUpload,
  uploadNotice,
  uploadError,
}: FolderContentsProps) {
  const folderEntries = getFolderEntries(entries, folder.id);
  const combined = getCombinedFolderExport(entries, folder.id);
  const combinedFileName = `All Strong Signal Leads — ${folder.name}.csv`;
  const uploadInputRef = useRef<HTMLInputElement>(null);

  return (
    <div>
      <button onClick={onBack} style={{ border: "none", background: "none", color: "#4c6167", fontWeight: 600, marginBottom: 14, padding: 0, cursor: "pointer" }}>← Back to folders</button>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <input
          defaultValue={folder.name}
          onBlur={(e) => onRenameFolder(e.target.value)}
          style={{ flex: "1 1 260px", fontSize: 21, fontWeight: 700, border: "none", marginBottom: 4, padding: 0 }}
        />
        <button
          onClick={() => uploadInputRef.current?.click()}
          title="Scan a CSV and file its Strong Signal leads directly into this folder"
          style={{ border: "1px solid #D5D9E0", background: "#fff", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 700, color: "#4c6167", whiteSpace: "nowrap" }}
        >
          ⬆ Upload CSV
        </button>
        <input ref={uploadInputRef} type="file" accept=".csv" multiple style={{ display: "none" }} onChange={(e) => { onUpload(e.target.files); e.target.value = ""; }} />
        <PrivacyControls folder={folder} onSetPrivate={onSetPrivate} onSetPublic={onSetPublic} />
      </div>
      <div style={{ color: "#9aa1ac", fontSize: 12.5, marginBottom: 8 }}>{folderEntries.length} category file{folderEntries.length === 1 ? "" : "s"} filed · {combined.rowCount} total leads</div>
      {uploadNotice && <div style={{ color: "#2CC295", fontWeight: 600, fontSize: 13, marginBottom: 12 }}>{uploadNotice}</div>}
      {uploadError && <div style={{ color: "#9A5B22", fontSize: 13, marginBottom: 12 }}>{uploadError}</div>}

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
              onRowStatus={(rowKey, patch) => onRowStatus(entry.id, rowKey, patch)}
              onRowDelete={(rowKey) => onRowDelete(entry.id, rowKey)}
              onRowMove={(rowKey, bk) => onRowMove(entry.id, rowKey, bk)}
            />
          ))}

          {ACTIVE_BUCKET_KEYS.filter((bk) => !folderEntries.some((e) => e.bucketKey === bk)).map((bk) => (
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
  onRowStatus: (rowKey: string, patch: Partial<Pick<StoredRow, "__disposition" | "__dispositionNote" | "__priority" | "__priorityMonth">>) => void;
  onRowDelete: (rowKey: string) => void;
  onRowMove: (rowKey: string, newBucket: BucketKey) => void;
}

function CategoryFileCard({ entry, expanded, onToggleExpanded, onDelete, onDownload, onLoad, onReceivedDate, onRename, onRowField, onRowStatus, onRowDelete, onRowMove }: CategoryFileCardProps) {
  const meta = CATEGORY_META[Object.keys(CATEGORY_META).find((k) => CATEGORY_META[k as keyof typeof CATEGORY_META].bucket === entry.bucketKey) as keyof typeof CATEGORY_META];
  const isDynamics = entry.bucketKey === "dynamics";
  const isM365 = entry.bucketKey === "m365Tenant";
  // Same View-tab sub-filter as the Scanner (see CLAUDE.md "Google ->
  // Microsoft view" / "Business Central view" / "Sales / CRM view") — now
  // available once a lead is filed/stored here too, not just pre-filing in
  // the Scanner. Dynamics has two keyword-triggered sub-views (Business
  // Central/ERP and Sales/CRM — a lead can match both); M365/Azure has one
  // (Google -> Microsoft). "special2" is unused/hidden for M365 files.
  const [subView, setSubView] = useState<"all" | "special" | "special2" | "other">("all");
  const specialCount = isDynamics
    ? entry.rows.filter((r) => r.__isBusinessCentral).length
    : isM365
      ? entry.rows.filter((r) => r.__isGoogleToMicrosoft).length
      : 0;
  const special2Count = isDynamics ? entry.rows.filter((r) => r.__isSalesCrm).length : 0;
  const otherCount = isDynamics
    ? entry.rows.filter((r) => !r.__isBusinessCentral && !r.__isSalesCrm).length
    : entry.rows.length - specialCount;
  const subViewTabs: Array<["all" | "special" | "special2" | "other", string]> = [
    ["all", `All (${entry.rows.length})`],
    ["special", `${isDynamics ? "Business Central / ERP" : "Google → Microsoft"} (${specialCount})`],
    ...(isDynamics ? ([["special2", `Sales / CRM (${special2Count})`]] as Array<["special2", string]>) : []),
    ["other", `Everything else (${otherCount})`],
  ];
  const subFiltered =
    subView === "all"
      ? entry.rows
      : entry.rows.filter((r) => {
          if (subView === "special") return isDynamics ? r.__isBusinessCentral : r.__isGoogleToMicrosoft;
          if (subView === "special2") return r.__isSalesCrm;
          return isDynamics ? !r.__isBusinessCentral && !r.__isSalesCrm : !r.__isGoogleToMicrosoft;
        });
  // Ranked highest seat/user/license count first when this is the
  // Dynamics 365 file — a lead with no stated count sinks to its own
  // lower block rather than being treated as a count of 0.
  const displayRows = isDynamics ? sortDynamicsStoredRows(subFiltered) : subFiltered;
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
          {(isDynamics || isM365) && (
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", margin: "12px 0 4px" }}>
              <span style={{ fontSize: 10.5, color: "#8b93a0", fontWeight: 700, textTransform: "uppercase" }}>View:</span>
              {subViewTabs.map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setSubView(key)}
                  style={{
                    border: "none",
                    borderRadius: 7,
                    padding: "5px 10px",
                    fontSize: 11.5,
                    fontWeight: 600,
                    background: subView === key ? "#081E22" : "#F6FAFA",
                    color: subView === key ? "#fff" : "#4C6167",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          {displayRows.length === 0 ? (
            <div style={{ fontSize: 12, color: "#9aa1ac", paddingTop: 12 }}>
              {entry.rows.length === 0 ? "No individual leads left in this file." : "No leads in this view."}
            </div>
          ) : (
            <table style={{ marginTop: 10 }}>
              <thead>
                <tr>
                  {isDynamics && <th style={{ textAlign: "left", padding: "6px 8px", fontSize: 10, color: "#9aa1ac", textTransform: "uppercase" }}>Seats</th>}
                  {EDITABLE_FIELDS.map((f) => (
                    <th key={f} style={{ textAlign: "left", padding: "6px 8px", fontSize: 10, color: "#9aa1ac", textTransform: "uppercase" }}>{f}</th>
                  ))}
                  <th style={{ textAlign: "left", padding: "6px 8px", fontSize: 10, color: "#9aa1ac", textTransform: "uppercase" }}>Category</th>
                  <th style={{ textAlign: "left", padding: "6px 8px", fontSize: 10, color: "#9aa1ac", textTransform: "uppercase" }}>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {displayRows.slice(0, ROW_EDITOR_CAP).map((row, idx) => {
                  const rowKey = row.__rowKey || String(idx);
                  // Rows saved before per-lead status tracking existed won't
                  // have these fields at all.
                  const disposition = row.__disposition || "none";
                  const priority = row.__priority || false;
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
                            {ACTIVE_BUCKET_KEYS.map((bk) => (
                              <option key={bk} value={bk}>{BUCKET_META[bk].label}</option>
                            ))}
                          </select>
                        </td>
                        <td style={{ padding: "4px 6px", minWidth: 150 }}>
                          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                            <select
                              value={disposition}
                              onChange={(ev) => onRowStatus(rowKey, { __disposition: ev.target.value as Disposition })}
                              style={{ background: DISPOSITION_META[disposition].bg, color: DISPOSITION_META[disposition].color, fontWeight: 600, border: "1px solid #D8DBE1", borderRadius: 6, padding: "4px 6px", fontSize: 11.5 }}
                            >
                              {DISPOSITION_ORDER.map((d) => (
                                <option key={d} value={d}>{DISPOSITION_META[d].label}</option>
                              ))}
                            </select>
                            {disposition !== "none" && (
                              <input
                                defaultValue={row.__dispositionNote || ""}
                                onBlur={(ev) => onRowStatus(rowKey, { __dispositionNote: ev.target.value })}
                                placeholder="Note"
                                style={{ border: "1px solid #E1E4E9", borderRadius: 5, padding: "3px 5px", fontSize: 11 }}
                              />
                            )}
                            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                              <button
                                onClick={() => onRowStatus(rowKey, { __priority: !priority })}
                                title={priority ? "Unmark High Priority" : "Mark High Priority"}
                                style={{ border: "1px solid #F5DFA0", background: priority ? "#F7B955" : "#FFF7E5", color: "#8A5A00", borderRadius: 5, padding: "2px 6px", fontSize: 11 }}
                              >
                                ⭐
                              </button>
                              {priority && (
                                <input
                                  type="month"
                                  value={row.__priorityMonth || ""}
                                  onChange={(ev) => onRowStatus(rowKey, { __priorityMonth: ev.target.value || null })}
                                  style={{ border: "1px solid #D8DBE1", borderRadius: 5, padding: "2px 4px", fontSize: 10.5 }}
                                />
                              )}
                            </div>
                          </div>
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
          {displayRows.length > ROW_EDITOR_CAP && (
            <div style={{ fontSize: 11, color: "#9aa1ac", marginTop: 8 }}>Showing the first {ROW_EDITOR_CAP} of {displayRows.length} leads{subView !== "all" ? " in this view" : ""} — Download still gets every row.</div>
          )}
        </div>
      )}
    </div>
  );
}

// Sits in the folder's own title row. Public → private always means setting
// a brand-new password right there (no "keep the old one" option — see
// lib/library.ts setGroupPrivate). Private → public needs no password check
// here: you're only shown this control once you've already unlocked the
// folder for this visit, so the barrier's already been cleared.
function PrivacyControls({ folder, onSetPrivate, onSetPublic }: { folder: LibraryGroup; onSetPrivate: (password: string) => void; onSetPublic: () => void }) {
  const [showForm, setShowForm] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit() {
    if (!password) { setError("Enter a password."); return; }
    if (password !== confirm) { setError("Passwords don't match."); return; }
    onSetPrivate(password);
    setShowForm(false);
    setPassword("");
    setConfirm("");
    setError(null);
  }

  if (folder.isPrivate) {
    return (
      <button
        onClick={onSetPublic}
        title="Make this folder public — no password needed to open it"
        style={{ border: "1px solid #E7C79A", background: "#FBF3E7", color: "#8A5A00", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}
      >
        🔒 Private — make public
      </button>
    );
  }

  if (!showForm) {
    return (
      <button
        onClick={() => setShowForm(true)}
        title="Make this folder private — requires a password to open going forward"
        style={{ border: "1px solid #D5D9E0", background: "#fff", color: "#4c6167", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}
      >
        🔓 Public — make private
      </button>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      <input type="password" placeholder="New folder password" value={password} onChange={(e) => setPassword(e.target.value)} style={{ border: "1px solid #D8DBE1", borderRadius: 7, padding: "6px 9px", fontSize: 12.5 }} />
      <input type="password" placeholder="Confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} style={{ border: "1px solid #D8DBE1", borderRadius: 7, padding: "6px 9px", fontSize: 12.5 }} />
      <button onClick={submit} style={{ background: "#2CC295", color: "#081E22", border: "none", borderRadius: 7, padding: "6px 12px", fontWeight: 700, fontSize: 12.5 }}>Set</button>
      <button onClick={() => { setShowForm(false); setPassword(""); setConfirm(""); setError(null); }} style={{ background: "none", border: "none", textDecoration: "underline", fontSize: 12 }}>Cancel</button>
      {error && <span style={{ color: "#B5443B", fontSize: 11.5 }}>{error}</span>}
    </div>
  );
}

// Blocks viewing a private folder's files until the password is entered —
// every visit, not just the first time (see CLAUDE.md and the
// unlockedFolderIds comment above). Wrong password just clears the field
// and shows an error; there's no lockout/rate-limit here, matching the same
// honest ceiling as the app's main password gate (lib/auth.ts).
function FolderPasswordGate({ folder, onBack, onUnlock }: { folder: LibraryGroup; onBack: () => void; onUnlock: (password: string) => Promise<boolean> }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  async function submit() {
    if (!password || checking) return;
    setChecking(true);
    const ok = await onUnlock(password);
    setChecking(false);
    if (!ok) {
      setError("Wrong password.");
      setPassword("");
    }
  }

  return (
    <div>
      <button onClick={onBack} style={{ border: "none", background: "none", color: "#4c6167", fontWeight: 600, marginBottom: 14, padding: 0, cursor: "pointer" }}>← Back to folders</button>
      <div style={{ maxWidth: 360, margin: "60px auto", textAlign: "center" }}>
        <div style={{ fontSize: 30, marginBottom: 10 }}>🔒</div>
        <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 4 }}>{folder.name} is private</div>
        <div style={{ color: "#9aa1ac", fontSize: 13, marginBottom: 18 }}>Enter this folder's password to view its files.</div>
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Folder password"
          style={{ width: "100%", padding: "11px 13px", fontSize: 15, border: "1px solid #D5D9E0", borderRadius: 9, boxSizing: "border-box", marginBottom: 10 }}
        />
        <button
          onClick={submit}
          disabled={checking}
          style={{ width: "100%", padding: 11, fontSize: 14, fontWeight: 700, background: "#2CC295", color: "#081E22", border: "none", borderRadius: 9 }}
        >
          {checking ? "Checking…" : "Unlock folder"}
        </button>
        <div style={{ color: "#B5443B", fontSize: 12.5, marginTop: 10, minHeight: 16 }}>{error}</div>
      </div>
    </div>
  );
}
