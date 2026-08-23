import { useEffect, useState } from "react";
import Scanner from "./components/Scanner";
import LibraryView from "./components/Library";
import LockScreen from "./components/LockScreen";
import type { ParsedFile, ResultRow } from "./lib/detection";
import { scanParsedFiles } from "./lib/detection";
import { loadLibraryFromDB, ensureMonthFoldersExist, persistGroup, type LibraryEntry, type LibraryGroup } from "./lib/library";
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
  }, []);

  function loadParsedFilesIntoScanner(parsedFiles: ParsedFile[]) {
    const { results: scanned } = scanParsedFiles(parsedFiles);
    setResults(scanned);
    setUploadedFiles(parsedFiles.map((pf) => ({ name: pf.name, rows: pf.data.length })));
    setView("scanner");
    return scanned;
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
              {v === "library" ? `library (${libraryEntries.length})` : v}
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
        />
      )}
      {view === "history" && <p style={{ color: "#9aa1ac" }}>History view — not built yet.</p>}
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
