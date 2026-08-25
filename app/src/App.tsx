import { useEffect, useState } from "react";
import Scanner from "./components/Scanner";
import LibraryView from "./components/Library";
import HistoryView from "./components/History";
import LockScreen from "./components/LockScreen";
import BackupRestore from "./components/BackupRestore";
import CheatSheet from "./components/CheatSheet";
import PlatformNotes from "./components/PlatformNotes";
import Home from "./components/Home";
import Engage, { type EngageTab } from "./components/Engage";
import AccountPanel from "./components/AccountPanel";
import HeaderSearch from "./components/HeaderSearch";
import type { ParsedFile, ResultRow, RuleOverrides } from "./lib/detection";
import { scanParsedFiles, DEFAULT_RULE_OVERRIDES } from "./lib/detection";
import { loadLibraryFromDB, ensureMonthFoldersExist, persistGroup, type LibraryEntry, type LibraryGroup } from "./lib/library";
import { attachScanResultsToContacts, loadContactsFromDB, mergeContactsFromParsedFiles, mergeManualContact, persistContact, type Contact, type ManualContactInput } from "./lib/contacts";
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
import { loadTasksFromDB, persistTask, deleteTaskFromDB, createTask, createContactTask, type Task, type TaskPriority } from "./lib/tasks";
import { isUnlocked, setUnlocked } from "./lib/auth";

type View = "home" | "scanner" | "history" | "library" | "engage";
const NAV_ITEMS: { key: View; label: string; icon: string }[] = [
  { key: "home", label: "Home", icon: "🏠" },
  { key: "scanner", label: "Scanner", icon: "🔎" },
  { key: "engage", label: "Engage", icon: "🤝" },
  { key: "library", label: "Lead Library", icon: "📚" },
  { key: "history", label: "History", icon: "🕘" },
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
  // Seeds Engage's initial tab/search when navigating there from the
  // header search (see HeaderSearch.tsx) — reset when Engage is opened
  // any other way (sidebar click) so a stale search doesn't linger.
  const [engageEntry, setEngageEntry] = useState<{ tab?: EngageTab; contactsQuery?: string }>({});
  // Shared Platform Notes/Cheat Sheet panel (see CLAUDE.md "Cheat Sheet
  // relocation + dated Platform Notes") — one panel, two tabs, replacing
  // the old separate floating Cheat Sheet button + notes popover.
  const [notesPanelTab, setNotesPanelTab] = useState<"notes" | "cheatsheet" | null>(null);
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

  // Companies' "+ Add contact" action — same dedup rules as any CSV-
  // derived contact (see lib/contacts.ts's mergeManualContact).
  function addManualContact(input: ManualContactInput) {
    setContacts((prev) => {
      const { contacts: next, touched } = mergeManualContact(prev, input);
      touched.forEach((c) => persistContact(c));
      return next;
    });
  }

  // Contact detail view's edits (LinkedIn URL, outreach call/email counts
  // and status) and the Apollo enrichment result both land here — a plain
  // per-contact patch, no dedup/merge logic needed since these are direct
  // edits to one already-identified Contact, not a new CSV/manual input.
  function updateContact(id: string, patch: Partial<Contact>) {
    setContacts((prev) => {
      const next = prev.map((c) => (c.id === id ? { ...c, ...patch } : c));
      const updated = next.find((c) => c.id === id);
      if (updated) persistContact(updated);
      return next;
    });
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
    mergeContacts(parsedFiles, scanned);
    return entry;
  }

  // Every fresh CSV upload becomes a History entry (see recordHistory
  // above) — the same choke point folds EVERY raw row (not just the ones
  // that cleared detection into `scanned`) into the permanent Contacts
  // directory — see CLAUDE.md "Contacts." The second pass layers the
  // product line/matched snippet/disposition from `scanned` (ResultRow[])
  // onto whichever of those same contacts cleared detection — a snapshot
  // of THIS scan, not a live sync of later edits (see CLAUDE.md "Contacts:
  // scan-derived fields").
  function mergeContacts(parsedFiles: ParsedFile[], scanned: ResultRow[]) {
    setContacts((prev) => {
      const { contacts: afterCsv, touched: t1 } = mergeContactsFromParsedFiles(prev, parsedFiles);
      const { contacts: afterScan, touched: t2 } = attachScanResultsToContacts(afterCsv, scanned);
      const touchedIds = new Set([...t1, ...t2].map((c) => c.id));
      afterScan.filter((c) => touchedIds.has(c.id)).forEach((c) => persistContact(c));
      return afterScan;
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
    // Every Scanner-side edit (disposition, category reassignment, tier/
    // cross-out) already flows through here (see Scanner.tsx's
    // mutateResults) — reused as the refresh point for Contacts' own
    // scan-derived fields too. Necessary specifically for disposition:
    // it's always "none" at the moment a row is first scanned and only
    // ever set afterward, so without this hook Contacts' Disposition
    // column could never show anything but blank — a pure "snapshot at
    // initial scan" would defeat the point of surfacing it at all.
    setContacts((prev) => {
      const { contacts: next, touched } = attachScanResultsToContacts(prev, [row]);
      touched.forEach((c) => persistContact(c));
      return next;
    });
  }

  function loadParsedFilesIntoScanner(parsedFiles: ParsedFile[], tag = "Loaded from Lead Library") {
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
    <div style={{ maxWidth: 1320, margin: "0 auto", padding: "0 24px 40px" }}>
      <header className="app-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div className="app-mark" aria-hidden="true">W</div>
          <div>
            <h1 style={{ fontSize: 17, margin: 0, lineHeight: 1.2 }}>Wired CIO</h1>
            <div style={{ fontSize: 11, color: "#8b93a0", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>Lead Scanner</div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
          <button
            onClick={() => { setUnlocked(false); setUnlockedState(false); }}
            title="Lock this page again"
            className="nav-btn"
            style={{ textTransform: "none", letterSpacing: "normal" }}
          >
            Lock
          </button>
          <HeaderSearch
            contacts={contacts}
            onJumpToContacts={(query) => {
              setEngageEntry({ tab: "contacts", contactsQuery: query });
              setView("engage");
            }}
          />
        </div>
      </header>

      <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
        <aside
          style={{
            width: 178,
            flexShrink: 0,
            position: "sticky",
            top: 76,
            height: "calc(100vh - 92px)",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <nav style={{ display: "flex", flexDirection: "column", gap: 2, overflowY: "auto", minHeight: 0 }}>
            {NAV_ITEMS.map((item) => (
              <button
                key={item.key}
                onClick={() => {
                  setView(item.key);
                  if (item.key === "engage") setEngageEntry({});
                }}
                className={`side-nav-btn${view === item.key ? " active" : ""}`}
              >
                <span aria-hidden="true">{item.icon}</span>
                <span>
                  {item.label}
                  {item.key === "library" ? ` (${libraryEntries.length})` : item.key === "history" ? ` (${historyEntries.length})` : ""}
                </span>
              </button>
            ))}
          </nav>
          <div style={{ marginTop: "auto" }}>
            <AccountPanel onOpenSettings={() => setNotesPanelTab("cheatsheet")} onOpenNotes={() => setNotesPanelTab("notes")} />
          </div>
        </aside>

        <main style={{ flex: 1, minWidth: 0 }}>
          <div style={{ marginBottom: 16 }}>
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
              onOpenCheatSheet={() => setNotesPanelTab("cheatsheet")}
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
          {view === "engage" && (
            <Engage
              tasks={tasks}
              tasksLoading={tasksLoading}
              tasksError={tasksError}
              onAddTask={addTask}
              onToggleTask={toggleTask}
              onEditTask={editTask}
              onDeleteTask={deleteTask}
              contacts={contacts}
              contactsLoading={contactsLoading}
              contactsError={contactsError}
              onAddContactTask={addContactTask}
              onAddContact={addManualContact}
              onUpdateContact={updateContact}
              initialTab={engageEntry.tab}
              initialContactsSearch={engageEntry.contactsQuery}
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
        </main>
      </div>

      {notesPanelTab === "cheatsheet" && (
        <CheatSheet
          onClose={() => setNotesPanelTab(null)}
          ruleOverrides={ruleOverrides}
          onChangeRuleOverrides={updateRuleOverrides}
          onSwitchToNotes={() => setNotesPanelTab("notes")}
        />
      )}
      {notesPanelTab === "notes" && (
        <PlatformNotes onClose={() => setNotesPanelTab(null)} onSwitchToCheatSheet={() => setNotesPanelTab("cheatsheet")} />
      )}
    </div>
  );
}
