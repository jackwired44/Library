import { useEffect, useState } from "react";
import Scanner from "./components/Scanner";
import LibraryView from "./components/Library";
import HistoryView from "./components/History";
import LockScreen from "./components/LockScreen";
import BackupRestore from "./components/BackupRestore";
import CheatSheet from "./components/CheatSheet";
import Home from "./components/Home";
import ContactsView from "./components/Contacts";
import type { ParsedFile, ResultRow, RuleOverrides } from "./lib/detection";
import { scanParsedFiles, DEFAULT_RULE_OVERRIDES } from "./lib/detection";
import { loadLibraryFromDB, ensureMonthFoldersExist, persistGroup, type LibraryEntry, type LibraryGroup } from "./lib/library";
import { loadContactsFromDB, mergeContactsFromParsedFiles, persistContact, type Contact } from "./lib/contacts";
import {
  loadHistoryFromDB,
  persistHistoryEntry,
  deleteHistoryEntryFromDB,
  buildHistoryEntry,
  combineHistoryEntries,
  syncRowIntoHistory,
  type HistoryEntry,
} from "./lib/history";
import { loadRuleOverrides, persistRuleOverrides } from "./lib/ruleOverrides";
import TaskBoard from "./components/TaskBoard";
import { loadTasksFromDB, persistTask, deleteTaskFromDB, createTask, createContactTask, type Task, type TaskPriority } from "./lib/tasks";
import { isUnlocked, setUnlocked } from "./lib/auth";

type View = "home" | "scanner" | "history" | "library" | "board" | "contacts";
const NAV_ITEMS: { key: View; label: string; icon: string }[] = [
  { key: "home", label: "Home", icon: "🏠" },
  { key: "scanner", label: "Scanner", icon: "🔎" },
  { key: "library", label: "Library", icon: "📚" },
  { key: "contacts", label: "Contacts", icon: "🪪" },
  { key: "history", label: "History", icon: "🕘" },
  { key: "board", label: "Board", icon: "🗓" },
];

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
  const [view, setView] = useState<View>("home");
  const [showCheatSheet, setShowCheatSheet] = useState(false);
  const [results, setResults] = useState<ResultRow[] | null>(null);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);

  const [libraryEntries, setLibraryEntries] = useState<LibraryEntry[]>([]);
  const [libraryGroups, setLibraryGroups] = useState<LibraryGroup[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [libraryError, setLibraryError] = useState<string | null>(null);

  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);

  // Jack's own edits on top of the base detection rules (qualify threshold,
  // extra trigger keywords per category) — see lib/ruleOverrides.ts and the
  // Cheat Sheet editor. Defaults to the built-in rules until loaded/changed.
  const [ruleOverrides, setRuleOverrides] = useState<RuleOverrides>(DEFAULT_RULE_OVERRIDES);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [tasksError, setTasksError] = useState<string | null>(null);

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(true);
  const [contactsError, setContactsError] = useState<string | null>(null);

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
    loadRuleOverrides().then(setRuleOverrides).catch(() => {});
    loadTasksFromDB()
      .then((loaded) => {
        setTasks(loaded);
        setTasksLoading(false);
      })
      .catch(() => {
        setTasksError("Couldn't load your task board from this browser's local storage.");
        setTasksLoading(false);
      });
    loadContactsFromDB()
      .then((loaded) => {
        setContacts(loaded);
        setContactsLoading(false);
      })
      .catch(() => {
        setContactsError("Couldn't load your Contacts directory from this browser's local storage.");
        setContactsLoading(false);
      });
  }, []);

  function addTask(date: string, text: string) {
    const task = createTask(date, text);
    if (!task) return;
    setTasks((prev) => [...prev, task]);
    persistTask(task);
  }
  function toggleTask(id: string) {
    setTasks((prev) => {
      const next = prev.map((t) => (t.id === id ? { ...t, done: !t.done } : t));
      const updated = next.find((t) => t.id === id);
      if (updated) persistTask(updated);
      return next;
    });
  }
  function editTask(id: string, text: string) {
    setTasks((prev) => {
      const next = prev.map((t) => (t.id === id ? { ...t, text: text.trim() || t.text } : t));
      const updated = next.find((t) => t.id === id);
      if (updated) persistTask(updated);
      return next;
    });
  }
  function deleteTask(id: string) {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    deleteTaskFromDB(id);
  }

  // Contacts page's "+ Task" action — same task store as the Board, just
  // pre-linked to a specific Contact and carrying a priority so sales reps
  // can see which contacts matter most (see CLAUDE.md "Contact tasks").
  function addContactTask(contactId: string, date: string, priority: TaskPriority, text: string) {
    const task = createContactTask(date, text, contactId, priority);
    if (!task) return;
    setTasks((prev) => [...prev, task]);
    persistTask(task);
  }

  function updateRuleOverrides(next: RuleOverrides) {
    setRuleOverrides(next);
    persistRuleOverrides(next);
  }

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
    mergeContacts(parsedFiles);
    return entry;
  }

  // Every fresh CSV upload becomes a History entry (see recordHistory
  // above) — the same choke point folds EVERY raw row (not just the ones
  // that cleared detection into `scanned`) into the permanent Contacts
  // directory — see CLAUDE.md "Contacts."
  function mergeContacts(parsedFiles: ParsedFile[]) {
    setContacts((prev) => {
      const { contacts: next, touched } = mergeContactsFromParsedFiles(prev, parsedFiles);
      touched.forEach((c) => persistContact(c));
      return next;
    });
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
    const { results: scanned } = scanParsedFiles(parsedFiles, ruleOverrides);
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

  // "Clear History" — per Jack's explicit ask. The override-typing guard
  // for an entry a Library file still points back to lives in History.tsx
  // (it needs to check per-entry before calling this or deleteHistoryEntry
  // above); this just does the actual bulk delete once that's cleared.
  async function clearHistory() {
    const ids = historyEntries.map((h) => h.id);
    setHistoryEntries([]);
    await Promise.all(ids.map((id) => deleteHistoryEntryFromDB(id)));
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
    <div style={{ maxWidth: 1320, margin: "0 auto", padding: "0 28px 60px" }}>
      <header className="app-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div className="app-mark" aria-hidden="true">W</div>
          <div>
            <h1 style={{ fontSize: 18, margin: 0, lineHeight: 1.2 }}>Wired CIO</h1>
            <div style={{ fontSize: 11.5, color: "#8b93a0", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>Lead Scanner</div>
          </div>
        </div>
        <button
          onClick={() => { setUnlocked(false); setUnlockedState(false); }}
          title="Lock this page again"
          className="nav-btn"
          style={{ textTransform: "none", letterSpacing: "normal" }}
        >
          Lock
        </button>
      </header>

      <div style={{ display: "flex", gap: 26, alignItems: "flex-start" }}>
        <aside
          style={{
            width: 190,
            flexShrink: 0,
            position: "sticky",
            top: 88,
            maxHeight: "calc(100vh - 108px)",
            overflowY: "auto",
            paddingBottom: 12,
          }}
        >
          <nav style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {NAV_ITEMS.map((item) => (
              <button key={item.key} onClick={() => setView(item.key)} className={`side-nav-btn${view === item.key ? " active" : ""}`}>
                <span aria-hidden="true">{item.icon}</span>
                <span>
                  {item.label}
                  {item.key === "library" ? ` (${libraryEntries.length})` : item.key === "history" ? ` (${historyEntries.length})` : ""}
                </span>
              </button>
            ))}
          </nav>
        </aside>

        <main style={{ flex: 1, minWidth: 0 }}>
          <div style={{ marginBottom: 20 }}>
            <BackupRestore
              libraryEntries={libraryEntries}
              libraryGroups={libraryGroups}
              historyEntries={historyEntries}
              setLibraryEntries={setLibraryEntries}
              setLibraryGroups={setLibraryGroups}
              setHistoryEntries={setHistoryEntries}
            />
          </div>

          {view === "home" && (
            <Home
              onNavigate={(v) => setView(v)}
              onOpenCheatSheet={() => setShowCheatSheet(true)}
              libraryCount={libraryEntries.length}
              historyCount={historyEntries.length}
              tasksOpenCount={tasks.filter((t) => !t.done).length}
              contactsCount={contacts.length}
            />
          )}
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
              recentUploads={historyEntries.slice(0, 6)}
              onOpenRecentUpload={(id) => loadHistoryIntoScanner([id])}
              allHistory={historyEntries}
              ruleOverrides={ruleOverrides}
            />
          )}
          {view === "contacts" && (
            <ContactsView
              contacts={contacts}
              loading={contactsLoading}
              error={contactsError}
              tasks={tasks}
              onAddContactTask={addContactTask}
              onToggleTask={toggleTask}
              onDeleteTask={deleteTask}
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
              onClearHistory={clearHistory}
              libraryEntries={libraryEntries}
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
              onRecordHistory={recordHistory}
              ruleOverrides={ruleOverrides}
            />
          )}
          {view === "board" && (
            <TaskBoard
              tasks={tasks}
              loading={tasksLoading}
              error={tasksError}
              onAddTask={addTask}
              onToggleTask={toggleTask}
              onEditTask={editTask}
              onDeleteTask={deleteTask}
            />
          )}
        </main>
      </div>

      <button
        onClick={() => setShowCheatSheet(true)}
        title="Cheat Sheet — what each category/Detected badge means and how leads get filtered"
        style={{
          position: "fixed",
          bottom: 24,
          right: 24,
          width: 52,
          height: 52,
          borderRadius: "50%",
          border: "none",
          background: "#081E22",
          color: "#fff",
          fontSize: 22,
          boxShadow: "0 6px 18px rgba(8,30,34,0.35)",
          cursor: "pointer",
          zIndex: 40,
        }}
      >
        📋
      </button>

      {showCheatSheet && <CheatSheet onClose={() => setShowCheatSheet(false)} ruleOverrides={ruleOverrides} onChangeRuleOverrides={updateRuleOverrides} />}
    </div>
  );
}
