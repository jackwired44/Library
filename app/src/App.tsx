// Wired CIO Lead Scanner — standalone.
//
// Split out of the CRM platform so the detection engine can be built out
// on its own. What came across: the Scanner itself, the Lead Library it
// files into, History, Custom Lead Lists, the rules/Cheat Sheet settings
// panel, Backup/Restore, and the whole lib/ layer those depend on —
// including Contacts, which is NOT a UI here but IS required: sticky
// cross-out/disposition state and the On CRM badge both read it.
//
// What deliberately did not come across: Engage (Sequences, Tasks, Calls,
// Emails), the Contacts and Companies views, Home's dashboard, and the
// team/user scaffolding. Those are the CRM's job.
//
// The handler bodies below were lifted VERBATIM from the platform's
// App.tsx rather than rewritten, so behaviour cannot drift — the only
// edit was removing the two finishTerminalEnrollments() calls, which
// belonged to sequences that do not exist here.
import { useEffect, useState } from "react";
import Scanner from "./components/Scanner";
import LibraryView from "./components/Library";
import HistoryView from "./components/History";
import ListsView from "./components/Lists";
import LockScreen from "./components/LockScreen";
import Scanner2 from "./components/Scanner2";
import Documentation from "./components/Documentation";
import BackupRestore from "./components/BackupRestore";
import CheatSheet from "./components/CheatSheet";
import PlatformNotes from "./components/PlatformNotes";
import DispositionManager from "./components/DispositionManager";
import type { ParsedFile, ResultRow, RuleOverrides, NoSignalRow, DuplicateRow } from "./lib/detection";
import { scanParsedFiles, DEFAULT_RULE_OVERRIDES, type ExportRow } from "./lib/detection";
import {
  loadLibraryFromDB, ensureMonthFoldersExist, pruneEmptyMonthFoldersBefore,
  persistGroup, deleteGroupFromDB,
  type LibraryEntry, type LibraryGroup,
} from "./lib/library";
import { applyCompetitorDQ } from "./lib/companyProfiles";
import {
  applyStickyState, attachScanResultsToContacts, loadContactsFromDB,
  mergeContactsFromParsedFiles, persistContact, type Contact,
} from "./lib/contacts";
import {
  loadHistoryFromDB, persistHistoryEntry, deleteHistoryEntryFromDB,
  buildHistoryEntry, combineHistoryEntries, syncRowIntoHistory, type HistoryEntry,
} from "./lib/history";
import {
  loadLeadListsFromDB, persistLeadList, deleteLeadListFromDB, createLeadList,
  renameLeadList, deleteLeadList, addRowsToList, addExportRowsToList, removeRowFromList, type LeadList,
} from "./lib/leadLists";
import { loadRuleOverrides, persistRuleOverrides } from "./lib/ruleOverrides";
import { isUnlocked, setUnlocked } from "./lib/auth";
import {
  loadDispositionsFromDB, persistDisposition, deleteDispositionFromDB,
  createCustomDisposition, type CustomDisposition,
} from "./lib/dispositions";
import {
  loadCompanyProfilesFromDB, persistCompanyProfile, companiesNeedingEnrichment,
  upsertProfileFromApollo, type CompanyProfile,
} from "./lib/companyProfiles";
import { enrichCompaniesViaApollo, type CompanyEnrichOutcome } from "./lib/apolloEnrich";
import "./styles.css";

export interface UploadedFile {
  name: string;
  rows: number;
}

export type View = "scanner" | "scanner2" | "scanner3" | "library" | "history" | "lists" | "docs";

const NAV: { key: View; label: string }[] = [
  { key: "scanner", label: "Main Scanner" },
  { key: "scanner2", label: "Custom Scanner September" },
  { key: "scanner3", label: "CSP Scanner" },
  { key: "library", label: "Lead library" },
  { key: "lists", label: "Lists" },
  { key: "history", label: "History" },
];

export default function App() {
  const [unlocked, setUnlockedState] = useState(isUnlocked());
  const [view, setView] = useState<View>("scanner");

  const [results, setResults] = useState<ResultRow[] | null>(null);
  const [uploadedFiles, setUploadedFiles] = useState<{ name: string; rows: number }[]>([]);
  const [libraryEntries, setLibraryEntries] = useState<LibraryEntry[]>([]);
  const [libraryGroups, setLibraryGroups] = useState<LibraryGroup[]>([]);
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [companyProfiles, setCompanyProfiles] = useState<CompanyProfile[]>([]);
  const [leadLists, setLeadLists] = useState<LeadList[]>([]);
  const [dispositions, setDispositions] = useState<CustomDisposition[]>([]);
  const [ruleOverrides, setRuleOverrides] = useState<RuleOverrides>(DEFAULT_RULE_OVERRIDES);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notesPanelTab, setNotesPanelTab] = useState<"notes" | "cheatsheet" | "dispositions" | null>(null);

  const [loadedScanStats, setLoadedScanStats] =
    useState<{ rowsScanned: number; duplicatesRemoved: number; largestDuplicateGroup: number } | null>(null);
  const [loadedDropped, setLoadedDropped] =
    useState<{ noSignalRows: NoSignalRow[]; duplicateRows: DuplicateRow[] } | null>(null);
  const [loadedHistoryEntryId, setLoadedHistoryEntryId] = useState<string | null>(null);

  const [autoEnrichCompanies, setAutoEnrichCompanies] = useState(() => {
    try { return localStorage.getItem("autoEnrichCompanies") === "1"; } catch { return false; }
  });
  const [pendingEnrich, setPendingEnrich] = useState<{ companyName: string; domain: string }[]>([]);
  const [companyEnrichOutcomes, setCompanyEnrichOutcomes] = useState<CompanyEnrichOutcome[] | null>(null);
  const [companyEnriching, setCompanyEnriching] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [lib, hist, cts, lists, disp, profiles, rules] = await Promise.all([
          loadLibraryFromDB(), loadHistoryFromDB(), loadContactsFromDB(),
          loadLeadListsFromDB(), loadDispositionsFromDB(), loadCompanyProfilesFromDB(),
          loadRuleOverrides(),
        ]);
        // Prune before seeding, so a folder removed here cannot be
        // recreated by the seeding pass in the same breath.
        const { groups: pruned, removed, blocked } = pruneEmptyMonthFoldersBefore(lib.groups, lib.entries);
        removed.forEach((g) => deleteGroupFromDB(g.id));
        const { groups: seededGroups, created } = ensureMonthFoldersExist(pruned);
        setLibraryEntries(lib.entries);
        setLibraryGroups(seededGroups);
        created.forEach((g) => persistGroup(g));
        setHistoryEntries(hist);
        setContacts(cts);
        setLeadLists(lists);
        setDispositions(disp);
        setCompanyProfiles(profiles);
        setRuleOverrides(rules);
        if (blocked.length) {
          setError(
            `Kept ${blocked.length} older month folder(s) that still hold filed leads: ` +
            blocked.map((b) => `${b.group.name} (${b.fileCount} file(s))`).join(", ")
          );
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not open local storage.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function toggleAutoEnrichCompanies() {
    setAutoEnrichCompanies((prev) => {
      const next = !prev;
      try { localStorage.setItem("autoEnrichCompanies", next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  }

  function recordHistory(
    parsedFiles: ParsedFile[],
    scanned: ResultRow[],
    tag = "",
    duplicatesRemoved = 0,
    dropped: { noSignalRows?: NoSignalRow[]; duplicateRows?: DuplicateRow[] } = {}
  ) {
    // The true row count read from the file(s), not just the subset that
    // cleared detection — see Scanner.tsx's lastScanStats for the same fix
    // on the live "Rows scanned" stat. A History entry's own rowsScanned
    // was silently using scanned.length (post-filter) here too.
    const rowsScanned = parsedFiles.reduce((sum, pf) => sum + pf.data.length, 0);
    // Surviving (first-seen) rows still carry their group's true size even
    // though duplicates themselves were already dropped before `scanned`
    // — see markDuplicateLeads — so this doesn't need to be passed in.
    const largestDuplicateGroup = Math.max(0, ...scanned.map((r) => r.duplicateGroupSize || 0));
    const entry = buildHistoryEntry(
      parsedFiles,
      { results: scanned, rowsScanned, duplicatesRemoved, largestDuplicateGroup, noSignalRows: dropped.noSignalRows, duplicateRows: dropped.duplicateRows },
      { tag }
    );
    scanned.forEach((r) => {
      r.__sourceEntryId = entry.id;
      r.__sourceRowId = r.id;
    });
    setHistoryEntries((prev) => [entry, ...prev]);
    persistHistoryEntry(entry);
    mergeContacts(parsedFiles, scanned);
    // Which of this batch's companies still have no Apollo profile — the
    // list the "enrich now?" prompt is built from. Computed from the raw
    // rows so it covers every company in the upload, not just detection
    // hits. Always computed (cheap, local); only SHOWN when the toggle is on.
    const rows = parsedFiles.flatMap((pf) => pf.data.map((r) => ({
      company: String(r["Company Name"] ?? r["companyname"] ?? r["Company"] ?? r["company"] ?? "").trim(),
      email: String(r["Email"] ?? r["emailaddress1"] ?? r["email"] ?? "").trim(),
    })));
    setPendingEnrich(companiesNeedingEnrichment(rows, companyProfiles));
    setCompanyEnrichOutcomes(null);
    return entry;
  }

  function mergeContacts(parsedFiles: ParsedFile[], scanned: ResultRow[]) {
    setContacts((prev) => {
      const { contacts: afterCsv, touched: t1 } = mergeContactsFromParsedFiles(prev, parsedFiles);
      const { contacts: afterScan, touched: t2 } = attachScanResultsToContacts(afterCsv, scanned);
      const touchedIds = new Set([...t1, ...t2].map((c) => c.id));
      const touchedContacts = afterScan.filter((c) => touchedIds.has(c.id));
      touchedContacts.forEach((c) => persistContact(c));
      return afterScan;
    });
  }

  function syncToHistory(row: ResultRow, opts?: { syncContact?: boolean }) {
    const syncContact = opts?.syncContact !== false;
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
    if (!syncContact) return;
    setContacts((prev) => {
      const { contacts: next, touched } = attachScanResultsToContacts(prev, [row]);
      touched.forEach((c) => persistContact(c));
      return next;
    });
  }

  function loadHistoryIntoScanner(entryIds: string[]) {
    const entries = historyEntries.filter((h) => entryIds.includes(h.id));
    if (!entries.length) return;
    const { results: combined, rowsScanned, duplicatesRemoved, largestDuplicateGroup, noSignalRows, duplicateRows } = combineHistoryEntries(entries);
    setResults(combined);
    setUploadedFiles(entries.flatMap((h) => h.files));
    setLoadedScanStats({ rowsScanned, duplicatesRemoved, largestDuplicateGroup });
    // Reopening a batch restores its dropped rows too — previously these
    // were Scanner-local and simply vanished, so a past import could be
    // counted but never inspected.
    setLoadedDropped({ noSignalRows, duplicateRows });
    // Give Scanner the History entry this batch came from so its "Save to
    // Lead Library" button can stamp StoredRow.__historyEntryId correctly.
    // Combining several entries has no single id to stamp, so it stays
    // null and Scanner disables the button with a reason rather than
    // silently doing nothing (which is what it used to do for BOTH cases).
    setLoadedHistoryEntryId(entries.length === 1 ? entries[0].id : null);
    setView("scanner");
  }

  function loadParsedFilesIntoScanner(parsedFiles: ParsedFile[], tag = "Loaded from Lead Library") {
    const { results: scanned, duplicatesRemoved, noSignalRows, duplicateRows } = scanParsedFiles(parsedFiles, ruleOverrides);
    applyStickyState(scanned, contacts);
    applyCompetitorDQ(scanned, companyProfiles);
    setResults(scanned);
    setUploadedFiles(parsedFiles.map((pf) => ({ name: pf.name, rows: pf.data.length })));
    // This path bypasses Scanner's own handleFiles, so the dropped rows
    // have to be handed over explicitly or the audit tabs come up empty.
    setLoadedDropped({ noSignalRows, duplicateRows });
    setView("scanner");
    recordHistory(parsedFiles, scanned, tag, duplicatesRemoved, { noSignalRows, duplicateRows });
    return scanned;
  }

  function addSelectedToList(rows: ResultRow[], opts: { existingId?: string; newName?: string }): { listId: string; added: number } | null {
    let working = leadLists;
    let targetId = opts.existingId;
    if (opts.newName) {
      const { lists, list } = createLeadList(working, opts.newName);
      if (!list) return null;
      working = lists;
      targetId = list.id;
    }
    if (!targetId) return null;
    const { lists: afterAdd, added } = addRowsToList(working, targetId, rows);
    setLeadLists(afterAdd);
    const updated = afterAdd.find((l) => l.id === targetId);
    if (updated) persistLeadList(updated);
    return { listId: targetId, added };
  }

  /**
   * The same thing for a scanner that hands over finished export rows —
   * the Custom and CSP scanners build their own Product Area, so they have
   * no ResultRow. Identical create-then-add flow, and identical reason for
   * doing it in ONE function: two handlers would each read the same stale
   * `leadLists` closure, and the add step would not see the list the create
   * step just made.
   */
  function addExportRowsToLists(
    rows: { row: ExportRow; scanner: "main" | "smc" | "csp"; band?: string; score?: number }[],
    opts: { existingId?: string; newName?: string },
  ): { listId: string; added: number; skipped: number } | null {
    let working = leadLists;
    let targetId = opts.existingId;
    if (opts.newName) {
      const { lists, list } = createLeadList(working, opts.newName);
      if (!list) return null;
      working = lists;
      targetId = list.id;
    }
    if (!targetId) return null;
    const { lists: afterAdd, added, skipped } = addExportRowsToList(working, targetId, rows);
    setLeadLists(afterAdd);
    const updated = afterAdd.find((l) => l.id === targetId);
    if (updated) persistLeadList(updated);
    return { listId: targetId, added, skipped };
  }

  function updateRuleOverrides(next: RuleOverrides) {
    setRuleOverrides(next);
    persistRuleOverrides(next);
  }

  function addDisposition(label: string, connected = false): boolean {
    const created = createCustomDisposition(label, dispositions, connected);
    if (!created) return false;
    setDispositions((prev) => [...prev, created]);
    persistDisposition(created);
    return true;
  }

  function removeDisposition(id: string) {
    setDispositions((prev) => prev.filter((d) => d.id !== id));
    deleteDispositionFromDB(id);
  }

  async function deleteHistoryEntry(id: string) {
    setHistoryEntries((prev) => prev.filter((h) => h.id !== id));
    await deleteHistoryEntryFromDB(id);
  }

  async function clearHistory() {
    const ids = historyEntries.map((h) => h.id);
    setHistoryEntries([]);
    await Promise.all(ids.map((id) => deleteHistoryEntryFromDB(id)));
  }

  async function runPendingCompanyEnrichment() {
    if (!pendingEnrich.length || companyEnriching) return;
    setCompanyEnriching(true);
    try {
      const outcomes = await enrichCompaniesViaApollo(pendingEnrich.map((p) => p.domain));
      let working = companyProfiles;
      outcomes.forEach((o) => {
        if (o.status !== "found" || !o.fields) return;
        const target = pendingEnrich.find((p) => p.domain === o.domain);
        working = upsertProfileFromApollo(working, target?.companyName || o.fields.name || o.domain, o.domain, o.fields);
      });
      setCompanyProfiles(working);
      working.forEach((pr) => persistCompanyProfile(pr));
      setCompanyEnrichOutcomes(outcomes);
      // Newly learned industries have to disqualify the rows already on
      // screen, not wait for the next scan — per Jack, a competitor is a
      // bad signal "when uploaded AND enriched". applyCompetitorDQ mutates
      // the rows, so hand React a fresh array to re-render.
      setResults((prev) => {
        if (!prev) return prev;
        const hit = applyCompetitorDQ(prev, working);
        return hit > 0 ? [...prev] : prev;
      });
      const done = new Set(outcomes.map((o) => o.domain));
      setPendingEnrich((prev) => prev.filter((p) => !done.has(p.domain)));
    } catch (e) {
      setCompanyEnrichOutcomes(pendingEnrich.map((p) => ({ domain: p.domain, status: "error" as const, errorMessage: e instanceof Error ? e.message : String(e) })));
    } finally {
      setCompanyEnriching(false);
    }
  }

  if (!unlocked) return <LockScreen onUnlock={() => setUnlockedState(true)} />;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-brand">
          <span className="topbar-mark" aria-hidden="true">W</span>
          <span>Lead Scanner</span>
          <span className="topbar-sub">Wired CIO</span>
        </div>
        <div className="topbar-spacer" />
        <button onClick={() => { setUnlocked(false); setUnlockedState(false); }} className="icon-btn" title="Lock this page again">
          🔒 Lock
        </button>
      </header>

      <aside className="sidebar">
        <nav className="sidebar-nav">
          {NAV.map((item) => (
            <button
              key={item.key}
              className={`side-nav-btn${view === item.key ? " active" : ""}`}
              onClick={() => setView(item.key)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div style={{ marginTop: "auto", padding: 8, display: "flex", flexDirection: "column", gap: 6 }}>
          <button
            onClick={() => setView("docs")}
            className={`btn btn-sm btn-ghost${view === "docs" ? " active" : ""}`}
            aria-label="Documentation"
          >📖 Documentation</button>
          <button onClick={() => setNotesPanelTab("cheatsheet")} className="btn btn-sm btn-ghost">❓ Cheat Sheet</button>
          <button onClick={() => setNotesPanelTab("notes")} className="btn btn-sm btn-ghost">📝 Platform notes</button>
        </div>
      </aside>

      <main className="app-main" style={{ minWidth: 0 }}>
        {error && <div style={{ marginBottom: 12, color: "#9A5B22" }}>{error}</div>}

        {/* Per Jack: no per-scanner passwords. The sign-in gate still
            fronts the whole page; these two screens open like any other. */}
        {view === "docs" && <Documentation />}
        {view === "scanner2" && <Scanner2 key="smc" kind="smc" lists={leadLists} onAddToList={addExportRowsToLists} />}
        {view === "scanner3" && <Scanner2 key="csp" kind="csp" lists={leadLists} onAddToList={addExportRowsToLists} />}

        {view === "scanner" && (
          <>
            <Scanner
              results={results}
              setResults={setResults}
              uploadedFiles={uploadedFiles}
              setUploadedFiles={setUploadedFiles}
              onReset={() => { setResults(null); setUploadedFiles([]); setLoadedScanStats(null); }}
              libraryEntries={libraryEntries}
              setLibraryEntries={setLibraryEntries}
              libraryGroups={libraryGroups}
              setLibraryGroups={setLibraryGroups}
              onRecordHistory={recordHistory}
              onSyncToHistory={syncToHistory}
              allHistory={historyEntries}
              ruleOverrides={ruleOverrides}
              contacts={contacts}
              loadedScanStats={loadedScanStats}
              loadedDropped={loadedDropped}
              loadedHistoryEntryId={loadedHistoryEntryId}
              leadLists={leadLists}
              dispositions={dispositions}
              autoEnrichCompanies={autoEnrichCompanies}
              onToggleAutoEnrichCompanies={toggleAutoEnrichCompanies}
              pendingEnrich={pendingEnrich}
              companyProfiles={companyProfiles}
              companyEnrichOutcomes={companyEnrichOutcomes}
              companyEnriching={companyEnriching}
              onRunCompanyEnrichment={runPendingCompanyEnrichment}
              onAddSelectedToList={addSelectedToList}
            />
          </>
        )}

        {view === "library" && (
          <LibraryView
            backup={
              <BackupRestore
                libraryEntries={libraryEntries}
                libraryGroups={libraryGroups}
                historyEntries={historyEntries}
                setLibraryEntries={setLibraryEntries}
                setLibraryGroups={setLibraryGroups}
                setHistoryEntries={setHistoryEntries}
              />
            }
            contacts={contacts}
            companyProfiles={companyProfiles}
            entries={libraryEntries}
            setEntries={setLibraryEntries}
            groups={libraryGroups}
            setGroups={setLibraryGroups}
            loading={loading}
            error={null}
            onLoadIntoScanner={loadParsedFilesIntoScanner}
            onRecordHistory={recordHistory}
            ruleOverrides={ruleOverrides}
            dispositions={dispositions}
          />
        )}

        {view === "history" && (
          <HistoryView
            history={historyEntries}
            setHistory={setHistoryEntries}
            loading={loading}
            error={null}
            onLoadIntoScanner={loadHistoryIntoScanner}
            onDeleteEntry={deleteHistoryEntry}
            onUpdateEntry={(id, patch) => {
              setHistoryEntries((prev) => {
                const next = prev.map((h) => (h.id === id ? { ...h, ...patch } : h));
                const updated = next.find((h) => h.id === id);
                if (updated) persistHistoryEntry(updated);
                return next;
              });
            }}
            onClearHistory={clearHistory}
            libraryEntries={libraryEntries}
          />
        )}

        {view === "lists" && (
          <ListsView
            lists={leadLists}
            loading={loading}
            error={null}
            onRename={(id, name) => {
              const next = renameLeadList(leadLists, id, name);
              setLeadLists(next);
              const updated = next.find((l) => l.id === id);
              if (updated) persistLeadList(updated);
            }}
            onDelete={(id) => { setLeadLists(deleteLeadList(leadLists, id)); deleteLeadListFromDB(id); }}
            onRemoveRow={(listId, rowKey) => {
              const next = removeRowFromList(leadLists, listId, rowKey);
              setLeadLists(next);
              const updated = next.find((l) => l.id === listId);
              if (updated) persistLeadList(updated);
            }}
          />
        )}
      </main>

      {notesPanelTab && (
        notesPanelTab === "notes" ? (
          <PlatformNotes
            onClose={() => setNotesPanelTab(null)}
            onSwitchToCheatSheet={() => setNotesPanelTab("cheatsheet")}
            onSwitchToDispositions={() => setNotesPanelTab("dispositions")}
          />
        ) : notesPanelTab === "dispositions" ? (
          <DispositionManager
            dispositions={dispositions}
            onAdd={addDisposition}
            onRemove={removeDisposition}
          />
        ) : (
          <CheatSheet
            ruleOverrides={ruleOverrides}
            onChangeRuleOverrides={updateRuleOverrides}
            onClose={() => setNotesPanelTab(null)}
            onSwitchToNotes={() => setNotesPanelTab("notes")}
            onSwitchToDispositions={() => setNotesPanelTab("dispositions")}
          />
        )
      )}
    </div>
  );
}
