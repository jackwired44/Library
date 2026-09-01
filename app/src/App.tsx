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
import type { ParsedFile, ResultRow, RuleOverrides } from "./lib/detection";
import { scanParsedFiles, DEFAULT_RULE_OVERRIDES } from "./lib/detection";
import { loadLibraryFromDB, ensureMonthFoldersExist, persistGroup, type LibraryEntry, type LibraryGroup } from "./lib/library";
import { applyStickyState, attachScanResultsToContacts, loadContactsFromDB, mergeContactsFromParsedFiles, mergeManualContact, persistContact, type Contact, type ManualContactInput } from "./lib/contacts";
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
import {
  loadLeadListsFromDB,
  persistLeadList,
  deleteLeadListFromDB,
  createLeadList,
  renameLeadList,
  deleteLeadList,
  addRowsToList,
  removeRowFromList,
  type LeadList,
} from "./lib/leadLists";
import {
  loadSequencesFromDB,
  persistSequence,
  deleteSequenceFromDB,
  loadEnrollmentsFromDB,
  persistEnrollment,
  deleteEnrollmentFromDB,
  createSequence,
  addStep,
  removeStep,
  moveStep,
  updateStep,
  renameSequence,
  enrollContact,
  advanceEnrollment,
  restartEnrollment,
  removeEnrollment,
  finishActiveEnrollmentsForContact,
  TERMINAL_DISPOSITIONS,
  type Sequence,
  type SequenceEnrollment,
  type SequenceChannel,
  type SequenceStep,
} from "./lib/sequences";
import {
  loadWeeklyGoalsFromDB,
  persistWeeklyGoals,
  currentWeekKey,
  defaultMetrics,
  addMetric as addWeeklyMetricEntry,
  removeMetric as removeWeeklyMetricEntry,
  updateMetric as updateWeeklyMetricEntry,
  type WeeklyGoals,
} from "./lib/weeklyGoals";

type View = "home" | "scanner" | "history" | "library" | "engage";
const NAV_ITEMS: { key: View; label: string; icon: string }[] = [
  { key: "home", label: "Home", icon: "🏠" },
  { key: "scanner", label: "Scanner", icon: "🔎" },
  // (Engage's own sub-nav — Sequences/Tasks/Calls/Emails/Companies/
  // Contacts/Lists — is inserted right after the Engage row below, see
  // ENGAGE_SUB_ITEMS.)
  { key: "engage", label: "Engage", icon: "🤝" },
  { key: "library", label: "Lead Library", icon: "📚" },
  { key: "history", label: "History", icon: "🕘" },
];

// Engage's own sub-nav, shown nested under the Engage row in the sidebar
// — per Jack: "a tab on the left hand side like Apollo's Engage for
// tasks, calls, emails... add a sequence tab also," then "add companies
// under emails and reorganize it top to bottom properly... move lists
// under there also." Same order as Engage's own in-page dropdown
// (Engage.tsx's TAB_OPTIONS) — Lists moved here from its own top-level
// nav item, no longer a separate View.
const ENGAGE_SUB_ITEMS: { key: EngageTab; label: string; icon: string }[] = [
  { key: "sequences", label: "Sequences", icon: "📡" },
  { key: "tasks", label: "Tasks", icon: "✅" },
  { key: "calls", label: "Calls", icon: "📞" },
  { key: "emails", label: "Emails", icon: "✉️" },
  { key: "companies", label: "Companies", icon: "🏢" },
  { key: "contacts", label: "Contacts", icon: "👤" },
  { key: "lists", label: "Lists", icon: "🗂️" },
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
  // Seeds Engage's initial tab when navigating there from the sidebar
  // sub-nav or a Home tile — reset when Engage is opened any other way
  // so a stale seed doesn't linger.
  const [engageEntry, setEngageEntry] = useState<{ tab?: EngageTab; contactsQuery?: string }>({});
  // Collapsed by default — per Jack: "collapsable drop downs under tabs
  // with relevant sub sections like engage... just like apollo." Toggled
  // by its own arrow, separate from the Engage row's own click-to-navigate
  // — navigating into Engage (sidebar click, header search, a sub-item
  // itself) also auto-expands it so the sub-nav isn't hidden right when
  // you're using it.
  const [engageNavExpanded, setEngageNavExpanded] = useState(false);
  // Shared Platform Notes/Cheat Sheet panel (see CLAUDE.md "Cheat Sheet
  // relocation + dated Platform Notes") — one panel, two tabs, replacing
  // the old separate floating Cheat Sheet button + notes popover.
  const [notesPanelTab, setNotesPanelTab] = useState<"notes" | "cheatsheet" | null>(null);
  const [results, setResults] = useState<ResultRow[] | null>(null);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  // Set only when results are loaded in from History (see
  // loadHistoryIntoScanner below) — Scanner adopts this once, into its own
  // local lastScanStats, since a fresh upload computes its own instead.
  const [loadedScanStats, setLoadedScanStats] = useState<{ rowsScanned: number; duplicatesRemoved: number; largestDuplicateGroup: number } | null>(null);

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

  // Custom Lead Lists — Jack hand-picks specific leads out of a Scanner
  // batch into his own named lists (any tier, unlike the Lead Library
  // which only ever files Strong Signal). See CLAUDE.md "Custom Lead
  // Lists" and lib/leadLists.ts.
  const [leadLists, setLeadLists] = useState<LeadList[]>([]);
  const [leadListsLoading, setLeadListsLoading] = useState(true);
  const [leadListsError, setLeadListsError] = useState<string | null>(null);

  // Native Sequences (Phase 1 of the Outbound Engine) — see CLAUDE.md
  // "Native Sequences" and lib/sequences.ts.
  const [sequences, setSequences] = useState<Sequence[]>([]);
  const [enrollments, setEnrollments] = useState<SequenceEnrollment[]>([]);
  const [sequencesLoading, setSequencesLoading] = useState(true);
  const [sequencesError, setSequencesError] = useState<string | null>(null);

  // Weekly Goals — Home's self-serve metrics board (see CLAUDE.md and
  // lib/weeklyGoals.ts). Every past week's record is kept (small, one row
  // per week), but only the current week's is ever shown/edited from Home.
  const [weeklyGoals, setWeeklyGoals] = useState<WeeklyGoals[]>([]);

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
    loadLeadListsFromDB()
      .then((loaded) => {
        setLeadLists(loaded);
        setLeadListsLoading(false);
      })
      .catch(() => {
        setLeadListsError("Couldn't load your Lists from this browser's local storage.");
        setLeadListsLoading(false);
      });
    Promise.all([loadSequencesFromDB(), loadEnrollmentsFromDB()])
      .then(([loadedSeqs, loadedEnrollments]) => {
        setSequences(loadedSeqs);
        setEnrollments(loadedEnrollments);
        setSequencesLoading(false);
      })
      .catch(() => {
        setSequencesError("Couldn't load your Sequences from this browser's local storage.");
        setSequencesLoading(false);
      });
    loadWeeklyGoalsFromDB().then(setWeeklyGoals).catch(() => {});
  }, []);

  // The current week's goals record, created on the fly (not persisted)
  // until the first edit actually saves it — so a brand-new week always
  // shows the default metric set without needing a migration step.
  function getOrCreateCurrentWeekGoals(): WeeklyGoals {
    const key = currentWeekKey();
    return weeklyGoals.find((g) => g.weekKey === key) || { weekKey: key, metrics: defaultMetrics() };
  }
  // Reads `prev` from INSIDE the functional updater (never the outer
  // `weeklyGoals` closure) so two edits fired in quick succession — e.g.
  // typing into both a metric's target and actual fields — can't race and
  // silently drop one of them, the same stale-closure class of bug fixed
  // elsewhere this session (see finishTerminalEnrollments above).
  function mutateWeeklyGoals(mutate: (current: WeeklyGoals) => WeeklyGoals) {
    const key = currentWeekKey();
    setWeeklyGoals((prev) => {
      const current = prev.find((g) => g.weekKey === key) || { weekKey: key, metrics: defaultMetrics() };
      const next = mutate(current);
      persistWeeklyGoals(next);
      const exists = prev.some((g) => g.weekKey === key);
      return exists ? prev.map((g) => (g.weekKey === key ? next : g)) : [...prev, next];
    });
  }
  function updateWeeklyMetric(id: string, patch: Partial<{ label: string; target: number; actual: number }>) {
    mutateWeeklyGoals((current) => updateWeeklyMetricEntry(current, id, patch));
  }
  function addWeeklyMetric(label: string) {
    mutateWeeklyGoals((current) => addWeeklyMetricEntry(current, label));
  }
  function removeWeeklyMetric(id: string) {
    mutateWeeklyGoals((current) => removeWeeklyMetricEntry(current, id));
  }

  function addTask(date: string, text: string) {
    const task = createTask(date, text);
    if (!task) return;
    setTasks((prev) => [...prev, task]);
    persistTask(task);
  }
  // A single explicit click, same reasoning as the Lists create+add fix
  // above — reads `tasks`/`enrollments`/`sequences`/`contacts` straight
  // from closure rather than a functional updater, since there's no
  // rapid-fire path here that would race a stale read.
  function toggleTask(id: string) {
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    const done = !task.done;
    const updatedTask: Task = { ...task, done };
    setTasks((prev) => prev.map((t) => (t.id === id ? updatedTask : t)));
    persistTask(updatedTask);

    // Completing (not un-completing) a Sequence-generated task advances
    // its enrollment to the next step — see CLAUDE.md "Native Sequences."
    if (done && task.sequenceEnrollmentId) {
      const result = advanceEnrollment(enrollments, sequences, contacts, task.sequenceEnrollmentId);
      if (result) {
        setEnrollments((prev) => prev.map((e) => (e.id === result.enrollment.id ? result.enrollment : e)));
        persistEnrollment(result.enrollment);
        if (result.task) {
          const nextTask = result.task;
          setTasks((prev) => [...prev, nextTask]);
          persistTask(nextTask);
        }
      }
    }
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
  function addContactTask(contactId: string, date: string, priority: TaskPriority, text: string, channel?: "call" | "email", time?: string | null) {
    const task = createContactTask(date, text, contactId, priority, channel, time);
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

  // Custom Lead Lists — see CLAUDE.md "Custom Lead Lists." A single explicit
  // click each (create/add/rename/delete), not a rapid-fire path like
  // Scanner's own per-row toggles, so reading `leadLists` straight from
  // closure here (rather than a functional setState updater) is safe —
  // avoids the exact "outer read raced the updater" class of bug CLAUDE.md
  // already documents for Scanner's mutateResults.
  //
  // Create-a-new-list-and-add-to-it is ONE function, not "create" then a
  // separate "add" call — two separate handlers each reading `leadLists`
  // from their own render's closure would have the second call miss the
  // first's brand-new list entirely (setLeadLists from the create step
  // hasn't re-rendered yet when the add step's closure was captured).
  // Threading one local `working` array through both steps here avoids
  // that same class of stale-closure bug.
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
  function renameList(id: string, name: string) {
    const next = renameLeadList(leadLists, id, name);
    setLeadLists(next);
    const updated = next.find((l) => l.id === id);
    if (updated) persistLeadList(updated);
  }
  function deleteList(id: string) {
    setLeadLists(deleteLeadList(leadLists, id));
    deleteLeadListFromDB(id);
  }
  function removeLeadFromList(listId: string, rowKey: string) {
    const next = removeRowFromList(leadLists, listId, rowKey);
    setLeadLists(next);
    const updated = next.find((l) => l.id === listId);
    if (updated) persistLeadList(updated);
  }

  // Native Sequences (Phase 1) — see CLAUDE.md "Native Sequences" and
  // lib/sequences.ts. All single explicit clicks, same closure-read
  // reasoning as Lists' handlers above.
  function createNewSequence(name: string): Sequence | null {
    const seq = createSequence(name);
    if (seq) {
      setSequences((prev) => [seq, ...prev]);
      persistSequence(seq);
    }
    return seq;
  }
  function updateSequenceSteps(next: Sequence) {
    setSequences((prev) => prev.map((s) => (s.id === next.id ? next : s)));
    persistSequence(next);
  }
  function renameSequenceById(id: string, name: string) {
    const seq = sequences.find((s) => s.id === id);
    if (!seq) return;
    updateSequenceSteps(renameSequence(seq, name));
  }
  function addSequenceStep(id: string, channel: SequenceChannel, waitHours: number, note?: string) {
    const seq = sequences.find((s) => s.id === id);
    if (!seq) return;
    updateSequenceSteps(addStep(seq, channel, waitHours, note));
  }
  function removeSequenceStep(id: string, stepId: string) {
    const seq = sequences.find((s) => s.id === id);
    if (!seq) return;
    updateSequenceSteps(removeStep(seq, stepId));
  }
  function updateSequenceStep(id: string, stepId: string, patch: Partial<Pick<SequenceStep, "note" | "systemPrompt" | "userPrompt">>) {
    const seq = sequences.find((s) => s.id === id);
    if (!seq) return;
    updateSequenceSteps(updateStep(seq, stepId, patch));
  }
  function moveSequenceStep(id: string, stepId: string, direction: -1 | 1) {
    const seq = sequences.find((s) => s.id === id);
    if (!seq) return;
    updateSequenceSteps(moveStep(seq, stepId, direction));
  }
  function deleteSequence(id: string) {
    setSequences((prev) => prev.filter((s) => s.id !== id));
    deleteSequenceFromDB(id);
    // Removes (not silently orphans) every enrollment that belonged to
    // the deleted sequence — same "visible, not silently dangling" bar
    // as everything else in this app; there is no view left that could
    // show them once the sequence itself is gone.
    setEnrollments((prev) => {
      const [gone, kept] = [prev.filter((e) => e.sequenceId === id), prev.filter((e) => e.sequenceId !== id)];
      gone.forEach((e) => deleteEnrollmentFromDB(e.id));
      return kept;
    });
  }
  function enrollContactsInSequence(sequenceId: string, contactIds: string[]): number {
    const seq = sequences.find((s) => s.id === sequenceId);
    if (!seq) return 0;
    const alreadyEnrolled = new Set(enrollments.filter((e) => e.sequenceId === sequenceId && e.status === "active").map((e) => e.contactId));
    const toEnroll = contactIds.filter((id) => !alreadyEnrolled.has(id));
    const newEnrollments: SequenceEnrollment[] = [];
    const newTasks: Task[] = [];
    toEnroll.forEach((contactId) => {
      const contact = contacts.find((c) => c.id === contactId);
      if (!contact) return;
      const result = enrollContact(seq, contact);
      if (!result) return;
      newEnrollments.push(result.enrollment);
      if (result.task) newTasks.push(result.task);
    });
    if (newEnrollments.length) {
      setEnrollments((prev) => [...prev, ...newEnrollments]);
      newEnrollments.forEach((e) => persistEnrollment(e));
    }
    if (newTasks.length) {
      setTasks((prev) => [...prev, ...newTasks]);
      newTasks.forEach((t) => persistTask(t));
    }
    return newEnrollments.length;
  }
  function restartSequenceEnrollment(enrollmentId: string) {
    const enrollment = enrollments.find((e) => e.id === enrollmentId);
    if (!enrollment) return;
    const seq = sequences.find((s) => s.id === enrollment.sequenceId);
    const contact = contacts.find((c) => c.id === enrollment.contactId);
    if (!seq || !contact) return;
    const result = restartEnrollment(enrollment, seq, contact);
    setEnrollments((prev) => prev.map((e) => (e.id === enrollmentId ? result.enrollment : e)));
    persistEnrollment(result.enrollment);
    if (result.task) {
      const task = result.task;
      setTasks((prev) => [...prev, task]);
      persistTask(task);
    }
  }
  function removeSequenceEnrollment(enrollmentId: string) {
    const enrollment = enrollments.find((e) => e.id === enrollmentId);
    if (!enrollment) return;
    const updated = removeEnrollment(enrollment);
    setEnrollments((prev) => prev.map((e) => (e.id === enrollmentId ? updated : e)));
    persistEnrollment(updated);
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
  function recordHistory(parsedFiles: ParsedFile[], scanned: ResultRow[], tag = "", duplicatesRemoved = 0) {
    // The true row count read from the file(s), not just the subset that
    // cleared detection — see Scanner.tsx's lastScanStats for the same fix
    // on the live "Rows scanned" stat. A History entry's own rowsScanned
    // was silently using scanned.length (post-filter) here too.
    const rowsScanned = parsedFiles.reduce((sum, pf) => sum + pf.data.length, 0);
    // Surviving (first-seen) rows still carry their group's true size even
    // though duplicates themselves were already dropped before `scanned`
    // — see markDuplicateLeads — so this doesn't need to be passed in.
    const largestDuplicateGroup = Math.max(0, ...scanned.map((r) => r.duplicateGroupSize || 0));
    const entry = buildHistoryEntry(parsedFiles, { results: scanned, rowsScanned, duplicatesRemoved, largestDuplicateGroup }, { tag });
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
      const touchedContacts = afterScan.filter((c) => touchedIds.has(c.id));
      touchedContacts.forEach((c) => persistContact(c));
      finishTerminalEnrollments(touchedContacts);
      return afterScan;
    });
  }

  // Auto-finishes any ACTIVE Sequence enrollment for a contact whose
  // disposition just landed on a terminal value — per Jack: "each
  // sequence will finish off how their dispositions were selected." Uses
  // a functional setEnrollments updater (safe against the stale-closure
  // class of bug even when called from inside another functional
  // updater, unlike a plain closure read) — see CLAUDE.md "Native
  // Sequences."
  function finishTerminalEnrollments(touchedContacts: Contact[]) {
    const terminalIds = touchedContacts.filter((c) => c.disposition && TERMINAL_DISPOSITIONS.has(c.disposition)).map((c) => c.id);
    if (!terminalIds.length) return;
    setEnrollments((prev) => {
      let next = prev;
      terminalIds.forEach((id) => { next = finishActiveEnrollmentsForContact(next, id); });
      next.forEach((e, i) => { if (e !== prev[i]) persistEnrollment(e); });
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
      finishTerminalEnrollments(touched);
      return next;
    });
  }

  function loadParsedFilesIntoScanner(parsedFiles: ParsedFile[], tag = "Loaded from Lead Library") {
    const { results: scanned, duplicatesRemoved } = scanParsedFiles(parsedFiles, ruleOverrides);
    applyStickyState(scanned, contacts);
    setResults(scanned);
    setUploadedFiles(parsedFiles.map((pf) => ({ name: pf.name, rows: pf.data.length })));
    setView("scanner");
    recordHistory(parsedFiles, scanned, tag, duplicatesRemoved);
    return scanned;
  }

  // "View/edit" a single History entry, or "Combine into Scanner" several —
  // both go through the same shallow-copy tagging (__sourceEntryId/
  // __sourceRowId) so edits sync back the same way either way.
  //
  // Scanner's own "Rows scanned" accounting (lastScanStats) is local state
  // it only sets from its OWN handleFiles/loadFromLibraryPicker — loading
  // in from History bypasses both, so without this it silently fell back
  // to the old undercounted results.length (Jack caught this: "rows
  // scanned... might not be accurate" when reopening/combining History
  // entries — Strong Signal counts were fine since those read straight off
  // results). loadedScanStats feeds Scanner the real combined numbers
  // (summed from each entry's own already-correct rowsScanned/
  // duplicatesRemoved) for exactly this path.
  function loadHistoryIntoScanner(entryIds: string[]) {
    const entries = historyEntries.filter((h) => entryIds.includes(h.id));
    if (!entries.length) return;
    const { results: combined, rowsScanned, duplicatesRemoved, largestDuplicateGroup } = combineHistoryEntries(entries);
    setResults(combined);
    setUploadedFiles(entries.flatMap((h) => h.files));
    setLoadedScanStats({ rowsScanned, duplicatesRemoved, largestDuplicateGroup });
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
            <h1 style={{ fontSize: 26, margin: 0, lineHeight: 1.15, letterSpacing: "-0.01em" }}>Wired Sales Outbound</h1>
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
              <div key={item.key}>
                <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
                  <button
                    onClick={() => {
                      setView(item.key);
                      if (item.key === "engage") {
                        setEngageEntry({});
                        setEngageNavExpanded(true);
                      }
                    }}
                    className={`side-nav-btn${view === item.key ? " active" : ""}`}
                    style={{ flex: 1 }}
                  >
                    <span aria-hidden="true">{item.icon}</span>
                    <span>
                      {item.label}
                      {item.key === "library"
                        ? ` (${libraryEntries.length})`
                        : item.key === "history"
                          ? ` (${historyEntries.length})`
                          : ""}
                    </span>
                  </button>
                  {item.key === "engage" && (
                    <button
                      onClick={() => setEngageNavExpanded((v) => !v)}
                      title={engageNavExpanded ? "Collapse Engage" : "Expand Engage"}
                      style={{ border: "none", background: "none", cursor: "pointer", padding: "0 8px", color: "var(--muted)", fontSize: 10 }}
                    >
                      {engageNavExpanded ? "▾" : "▸"}
                    </button>
                  )}
                </div>
                {item.key === "engage" && engageNavExpanded && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 1, marginLeft: 20, borderLeft: "1px solid var(--border)", paddingLeft: 6 }}>
                    {ENGAGE_SUB_ITEMS.map((sub) => (
                      <button
                        key={sub.key}
                        onClick={() => { setEngageEntry({ tab: sub.key }); setView("engage"); }}
                        className={`side-nav-btn${view === "engage" && engageEntry.tab === sub.key ? " active" : ""}`}
                        style={{ fontSize: 12, padding: "5px 8px" }}
                      >
                        <span aria-hidden="true">{sub.icon}</span>
                        <span>
                          {sub.label}
                          {sub.key === "lists" ? ` (${leadLists.length})` : ""}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
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
              libraryCount={libraryEntries.length}
              historyCount={historyEntries.length}
              tasksOpenCount={tasks.filter((t) => !t.done).length}
              contactsCount={contacts.length}
              tasks={tasks}
              contacts={contacts}
              onToggleTask={toggleTask}
              weeklyGoals={getOrCreateCurrentWeekGoals()}
              onUpdateMetric={updateWeeklyMetric}
              onAddMetric={addWeeklyMetric}
              onRemoveMetric={removeWeeklyMetric}
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
                setLoadedScanStats(null);
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
              contacts={contacts}
              loadedScanStats={loadedScanStats}
              leadLists={leadLists}
              onAddSelectedToList={addSelectedToList}
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
              sequences={sequences}
              enrollments={enrollments}
              sequencesLoading={sequencesLoading}
              sequencesError={sequencesError}
              onCreateSequence={createNewSequence}
              onRenameSequence={renameSequenceById}
              onAddSequenceStep={addSequenceStep}
              onRemoveSequenceStep={removeSequenceStep}
              onUpdateSequenceStep={updateSequenceStep}
              onMoveSequenceStep={moveSequenceStep}
              onDeleteSequence={deleteSequence}
              onEnrollInSequence={enrollContactsInSequence}
              onRestartEnrollment={restartSequenceEnrollment}
              onRemoveEnrollment={removeSequenceEnrollment}
              leadLists={leadLists}
              leadListsLoading={leadListsLoading}
              leadListsError={leadListsError}
              onRenameList={renameList}
              onDeleteList={deleteList}
              onRemoveLeadFromList={removeLeadFromList}
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
