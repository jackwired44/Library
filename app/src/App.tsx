import { useEffect, useState } from "react";
import Scanner from "./components/Scanner";
import LibraryView from "./components/Library";
import HistoryView from "./components/History";
import LockScreen from "./components/LockScreen";
import type { ParsedFile, ResultRow } from "./lib/detection";
import { scanParsedFiles } from "./lib/detection";
import { loadLibraryFromDB, ensureMonthFoldersExist, persistGroup, type LibraryEntry, type LibraryGroup } from "./lib/library";
import {
  loadHistoryFromDB,
  persistHistoryEntry,
  deleteHistoryEntryFromDB,
  buildHistoryEntry,
  combineHistoryEntries,
  syncRowIntoHistory,
  type HistoryEntry,
} from "./lib/history";
import { isUnlocked, setUnlocked } from "./lib/auth";

type View = "scanner" | "history" | "library";

export interface UploadedFile {
  name: string;
  rows: number;
}

// Scan results AND the Library (entries/groups) live here, not inside
// their own view components — Scanner writes to the Library on an opt-in
// save, Library pushes files back into the Scanner ("Load into Scanner"),
// so both need to see the same in-memory copy, not two components each
// independently reading/writing IndexedDB (which would silently drift out
// of sync with each other). IndexedDB is the persistence layer underneath
// this, not the source of truth for the running session — same relationship
// legacy/unified-tool.js's single global `state` object had to its DB.
export default function App() {
  const [unlocked, setUnlockedState] = useState(isUnlocked());
  const [view, setView] = useState<View>("scanner");
  const [results, setResults] = useState<ResultRow[] | null>(null);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);

  const [libraryEntries, setLibraryEntries] = useState<LibraryEntry[]>([]);
  const [libraryGroups, setLibraryGroups] = useState<LibraryGroup[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [libraryError, setLibraryError] = useState<string | null>(null);

  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);

  useEffect(() => {
    loadLibraryFromDB()
      .then(({ entries, groups }) => {
        setLibraryEntries(entries);
        // Every month folder from October 2025 through now should exist and
        // be browsable even before anything's been filed into it — not
        // created lazily on first upload.
        const { groups: seededGroups, created } = ensureMonthFoldersExist(groups);
        setLibraryGroups(seededGroups);
        created.forEach((g) => persistGroup(g));
        setLibraryLoading(false);
      })
      .catch(() => {
        setLibraryError("Couldn't load previously saved files from this browser's local storage.");
        setLibraryLoading(false);
      });
    loadHistoryFromDB()
      .then((entries) => {
        setHistoryEntries(entries);
        setHistoryLoading(false);
      })
      .catch(() => {
        setHistoryError("Couldn't load previous imports from this browser's local storage.");
        setHistoryLoading(false);
      });
  }, []);

  // Every scan/import — fresh upload or a reload from the Library — is kept
  // in History automatically (unlike the Library, which is opt-in per
  // upload). See CLAUDE.md and lib/history.ts.
  //
  // The rows handed to History ARE the same row objects the Scanner is
  // about to render (not a copy) — tagged in place with __sourceEntryId/
  // __sourceRowId before this returns, so a later Scanner edit's
  // onSyncToHistory call can find its way back here, the same as an edit
  // made on a row loaded FROM History. Legacy relied on this same
  // by-reference sharing but only actually re-persisted the edit to
  // IndexedDB when the batch was reopened FROM History (viewingHistoryId)
  // — a fresh scan's later edits stayed in memory only. Tagging every
  // fresh scan the same way closes that gap rather than reproducing it.
  function recordHistory(parsedFiles: ParsedFile[], scanned: ResultRow[], tag = "") {
    const entry = buildHistoryEntry(parsedFiles, { results: scanned, rowsScanned: scanned.length }, { tag });
    scanned.forEach((r) => {
      r.__sourceEntryId = entry.id;
      r.__sourceRowId = r.id;
    });
    setHistoryEntries((prev) => [entry, ...prev]);
    persistHistoryEntry(entry);
    return entry;
  }

  // Writes a category/tier/cross-out edit made on a row loaded FROM History
  // back to the entry it came from. A no-op for an ordinary fresh-scan row
  // (syncRowIntoHistory returns the same array reference when there's
  // nothing tying this row back to a History entry).
  function syncToHistory(row: ResultRow) {
    setHistoryEntries((prev) => {
      const next = syncRowIntoHistory(prev, row);
      if (next !== prev) {
        const updated = next.find((h) => h.id === row.__sourceEntryId);
        if (updated) persistHistoryEntry(updated);
      }
      return next;
    });
  }

  function loadParsedFilesIntoScanner(parsedFiles: ParsedFile[], tag = "Loaded from Library") {
    const { results: scanned } = scanParsedFiles(parsedFiles);
    setResults(scanned);
    setUploadedFiles(parsedFiles.map((pf) => ({ name: pf.name, rows: pf.data.length })));
    setView("scanner");
    recordHistory(parsedFiles, scanned, tag);
    return scanned;
  }

  // "View/edit" a single History entry, or "Combine into Scanner" several —
  // both go through the same shallow-copy tagging (__sourceEntryId/
  // __sourceRowId) so edits sync back the same way either way.
  function loadHistoryIntoScanner(entryIds: string[]) {
    const entries = historyEntries.filter((h) => entryIds.includes(h.id));
    if (!entries.length) return;
    const { results: combined } = combineHistoryEntries(entries);
    setResults(combined);
    setUploadedFiles(entries.flatMap((h) => h.files));
    setView("scanner");
  }

  async function deleteHistoryEntry(id: string) {
    setHistoryEntries((prev) => prev.filter((h) => h.id !== id));
    await deleteHistoryEntryFromDB(id);
  }

  function updateHistoryEntry(id: string, patch: Partial<Pick<HistoryEntry, "tag" | "notes">>) {
    setHistoryEntries((prev) => {
      const next = prev.map((h) => (h.id === id ? { ...h, ...patch } : h));
      const updated = next.find((h) => h.id === id);
      if (updated) persistHistoryEntry(updated);
      return next;
    });
  }

  if (!unlocked) return <LockScreen onUnlock={() => setUnlockedState(true)} />;

  return (
    <div style={{ maxWidth: 1240, margin: "0 auto", padding: "36px 28px 60px" }}>
      <header style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>Wired CIO Lead Scanner</h1>
        <nav style={{ display: "flex", gap: 6 }}>
          {(["scanner", "history", "library"] as View[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              style={{
                border: "none",
                borderRadius: 8,
                padding: "8px 14px",
                fontWeight: 700,
                fontSize: 12,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                background: view === v ? "#081e22" : "#e9ebef",
                color: view === v ? "#fff" : "#4c6167",
              }}
            >
              {v === "library" ? `library (${libraryEntries.length})` : v === "history" ? `history (${historyEntries.length})` : v}
            </button>
          ))}
          <button
            onClick={() => { setUnlocked(false); setUnlockedState(false); }}
            title="Lock this page again"
            style={{ border: "1px solid #D5D9E0", background: "#fff", borderRadius: 8, padding: "8px 14px", fontSize: 12, fontWeight: 700, color: "#4c6167" }}
          >
            Lock
          </button>
        </nav>
      </header>

      {view === "scanner" && (
        <Scanner
          results={results}
          setResults={setResults}
          uploadedFiles={uploadedFiles}
          setUploadedFiles={setUploadedFiles}
          onReset={() => {
            setResults(null);
            setUploadedFiles([]);
          }}
          libraryEntries={libraryEntries}
          setLibraryEntries={setLibraryEntries}
          libraryGroups={libraryGroups}
          setLibraryGroups={setLibraryGroups}
          onRecordHistory={recordHistory}
          onSyncToHistory={syncToHistory}
        />
      )}
      {view === "history" && (
        <HistoryView
          history={historyEntries}
          setHistory={setHistoryEntries}
          loading={historyLoading}
          error={historyError}
          onLoadIntoScanner={loadHistoryIntoScanner}
          onDeleteEntry={deleteHistoryEntry}
          onUpdateEntry={updateHistoryEntry}
        />
      )}
      {view === "library" && (
        <LibraryView
          entries={libraryEntries}
          setEntries={setLibraryEntries}
          groups={libraryGroups}
          setGroups={setLibraryGroups}
          loading={libraryLoading}
          error={libraryError}
          onLoadIntoScanner={loadParsedFilesIntoScanner}
        />
      )}
    </div>
  );
}
