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
import {
  loadAttemptsFromDB,
  persistAttempt,
  deleteAttemptFromDB,
  createAttempt,
  contactPatchForAttempt,
  type OutreachAttempt,
  type AttemptChannel,
} from "./lib/outreachAttempts";
import { sequenceFromTemplate, type SequenceTemplate } from "./lib/sequenceTemplates";
import DispositionManager from "./components/DispositionManager";
import type { ParsedFile, ResultRow, RuleOverrides } from "./lib/detection";
import { scanParsedFiles, DEFAULT_RULE_OVERRIDES } from "./lib/detection";
import { loadLibraryFromDB, ensureMonthFoldersExist, pruneEmptyMonthFoldersBefore, persistGroup, deleteGroupFromDB, type LibraryEntry, type LibraryGroup } from "./lib/library";
import { applyCompetitorDQ } from "./lib/companyProfiles";
import { deleteContactsFromDB } from "./lib/contacts";
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
  setSequenceStatus,
  setSequenceOwner,
  setSequenceGroup,
  setSequenceEmailAccount,
  duplicateSequence,
  resumeEnrollments,
  isTerminalDisposition,
  enrollmentBlockReason,
  type Sequence,
  type SequenceEnrollment,
  type SequenceChannel,
  type SequenceStep,
  type SequenceStatus,
} from "./lib/sequences";
import {
  loadUsersFromDB,
  persistUser,
  deleteUserFromDB,
  createUser,
  updateUser,
  selfUserFrom,
  SELF_USER_ID,
  type PlatformUser,
  type UserRole,
} from "./lib/users";
import {
  loadSequenceGroupsFromDB,
  persistSequenceGroup,
  deleteSequenceGroupFromDB,
  createSequenceGroup,
  renameSequenceGroup,
  type SequenceGroup,
} from "./lib/sequenceGroups";
import {
  loadEmailAccountsFromDB,
  persistEmailAccount,
  deleteEmailAccountFromDB,
  createEmailAccount,
  updateEmailAccount,
  type EmailAccount,
} from "./lib/emailAccounts";
import {
  loadDispositionsFromDB,
  persistDisposition,
  deleteDispositionFromDB,
  createCustomDisposition,
  type CustomDisposition,
} from "./lib/dispositions";
import { loadCompanyProfilesFromDB, persistCompanyProfile, importCompanyRows, companiesNeedingEnrichment, upsertProfileFromApollo, type CompanyProfile, type ImportResult } from "./lib/companyProfiles";
import { enrichCompaniesViaApollo, type CompanyEnrichOutcome } from "./lib/apolloEnrich";
import { parseCSVFile } from "./lib/csv";
import { loadProfile } from "./lib/profile";
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
// Sidebar destinations, flat and grouped — Apollo's model: no nesting,
// no collapsible group, every destination one click away. The Engage
// sub-tabs are surfaced here as top-level entries; they still render the
// same <Engage tab=…> they always did, so this is navigation presentation
// only, not an IA change to the components underneath.
//
// The Pipeline group is the addition to the reference design: it has six
// destinations, this product has eleven, and Scanner/Lead Library/Lists/
// History had nowhere to live in it.
type NavDest = { key: View; tab?: EngageTab; label: string; icon: string; count?: "library" | "history" | "lists" | "tasks" | "calls" };
const NAV_GROUPS: { group: string | null; items: NavDest[] }[] = [
  { group: null, items: [{ key: "home", label: "Home", icon: "\u{1F3E0}" }] },
  {
    group: "Pipeline",
    items: [
      { key: "scanner", label: "Scanner", icon: "\u{1F50E}" },
      { key: "library", label: "Lead library", icon: "\u{1F4DA}", count: "library" },
      { key: "engage", tab: "lists", label: "Lists", icon: "\u{1F5C2}\uFE0F", count: "lists" },
      { key: "history", label: "History", icon: "\u{1F558}", count: "history" },
    ],
  },
  {
    group: "Work",
    items: [
      { key: "engage", tab: "tasks", label: "Tasks", icon: "\u2705", count: "tasks" },
      { key: "engage", tab: "calls", label: "Calls", icon: "\u{1F4DE}", count: "calls" },
    ],
  },
  {
    group: "Outreach",
    items: [
      { key: "engage", tab: "sequences", label: "Sequences", icon: "\u{1F4E1}" },
      { key: "engage", tab: "emails", label: "Emails", icon: "\u2709\uFE0F" },
    ],
  },
  {
    group: "Records",
    items: [
      { key: "engage", tab: "contacts", label: "Contacts", icon: "\u{1F464}" },
      { key: "engage", tab: "companies", label: "Companies", icon: "\u{1F3E2}" },
    ],
  },
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
  const [engageEntry, setEngageEntry] = useState<{
    tab?: EngageTab;
    contactsQuery?: string;
    // Seeded by Home's pipeline tiles so the count you clicked and the
    // list you land on can never disagree. Both are seed-only, cleared
    // whenever Engage is entered any other way.
    contactsTier?: "signal" | "mention" | "dq";
    contactsWorked?: "unworked" | "worked";
  }>({});
  // Theme: "system" leaves the root unstamped so prefers-color-scheme
  // decides; an explicit choice stamps data-theme and wins in both
  // directions. Persisted per browser like the unlock flag — a display
  // preference, not data.
  const [theme, setTheme] = useState<"light" | "dark" | "system">(() => {
    try {
      const v = localStorage.getItem("theme");
      return v === "dark" || v === "light" ? v : "system";
    } catch { return "system"; }
  });
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
    try {
      if (theme === "system") localStorage.removeItem("theme");
      else localStorage.setItem("theme", theme);
    } catch { /* preference only */ }
  }, [theme]);
  function toggleTheme() {
    const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    setTheme(dark ? "light" : "dark");
  }
  // The History entry a Scanner batch was reopened from — see
  // loadHistoryIntoScanner. Null for a fresh upload (Scanner tracks its
  // own id then) and for a multi-entry combine.
  const [loadedHistoryEntryId, setLoadedHistoryEntryId] = useState<string | null>(null);
  // Collapsed by default — per Jack: "collapsable drop downs under tabs
  // with relevant sub sections like engage... just like apollo." Toggled
  // by its own arrow, separate from the Engage row's own click-to-navigate
  // — navigating into Engage (sidebar click, header search, a sub-item
  // itself) also auto-expands it so the sub-nav isn't hidden right when
  // you're using it.
  // Shared Platform Notes/Cheat Sheet panel (see CLAUDE.md "Cheat Sheet
  // relocation + dated Platform Notes") — one panel, two tabs, replacing
  // the old separate floating Cheat Sheet button + notes popover.
  const [notesPanelTab, setNotesPanelTab] = useState<"notes" | "cheatsheet" | "dispositions" | null>(null);
  const [results, setResults] = useState<ResultRow[] | null>(null);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  // Set only when results are loaded in from History (see
  // loadHistoryIntoScanner below) — Scanner adopts this once, into its own
  // local lastScanStats, since a fresh upload computes its own instead.
  const [loadedScanStats, setLoadedScanStats] = useState<{ rowsScanned: number; duplicatesRemoved: number; largestDuplicateGroup: number } | null>(null);

  const [attempts, setAttempts] = useState<OutreachAttempt[]>([]);
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

  // Platform users (sequence owners) and sequence groups — see
  // lib/users.ts for why these are attribution, not credentials.
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [sequenceGroups, setSequenceGroups] = useState<SequenceGroup[]>([]);
  // Email sending accounts — see lib/emailAccounts.ts for why "connected"
  // stays false everywhere: no SendGrid key/backend exists yet, this only
  // captures which sender identity a sequence should use once one does.
  const [emailAccounts, setEmailAccounts] = useState<EmailAccount[]>([]);
  // Jack's own call dispositions, on top of the six built-ins — see
  // lib/dispositions.ts for why a custom one is a label+color only.
  const [dispositions, setDispositions] = useState<CustomDisposition[]>([]);
  // Company "known info" from bulk Apollo exports — see lib/companyProfiles.ts.
  const [companyProfiles, setCompanyProfiles] = useState<CompanyProfile[]>([]);
  // Upload-time company enrichment — per Jack: "keep data enriching as new
  // contacts are uploaded here if apollo has data on the company." A
  // per-browser preference (not data), so localStorage rather than a
  // store. When on, every upload computes which of its companies have no
  // Apollo profile yet and Scanner offers ONE button to enrich them — with
  // the exact count/credit cost stated first, because Apollo's own tool
  // contract requires explicit confirmation before spending credits.
  const [autoEnrichCompanies, setAutoEnrichCompanies] = useState<boolean>(() => {
    try { return localStorage.getItem("autoEnrichCompanies") === "1"; } catch { return false; }
  });
  const [pendingEnrich, setPendingEnrich] = useState<{ companyName: string; domain: string }[]>([]);
  const [companyEnrichOutcomes, setCompanyEnrichOutcomes] = useState<CompanyEnrichOutcome[] | null>(null);
  const [companyEnriching, setCompanyEnriching] = useState(false);

  useEffect(() => {
    loadLibraryFromDB()
      .then(({ entries, groups }) => {
        setLibraryEntries(entries);
        // Every month folder from October 2025 through now should exist and
        // be browsable even before anything's been filed into it — not
        // created lazily on first upload.
        // Prune BEFORE seeding: a folder older than the cutoff is dropped
        // here, and ensureMonthFoldersExist then only ever re-creates months
        // at or after it — so the old ones can't come straight back.
        const { groups: pruned, removed, blocked } = pruneEmptyMonthFoldersBefore(groups, entries);
        removed.forEach((g) => deleteGroupFromDB(g.id));
        const { groups: seededGroups, created } = ensureMonthFoldersExist(pruned);
        setLibraryGroups(seededGroups);
        created.forEach((g) => persistGroup(g));
        // A folder older than the cutoff that still holds filed leads is
        // never removed — say so rather than leaving it looking like the
        // prune failed.
        if (blocked.length) {
          setLibraryError(
            `Kept ${blocked.length} older folder${blocked.length === 1 ? "" : "s"} that still hold filed leads: ` +
              blocked.map((b) => `${b.group.name} (${b.fileCount} file${b.fileCount === 1 ? "" : "s"})`).join(", ") +
              ". Delete them by hand from the Lead Library if you want them gone."
          );
        }
        setLibraryLoading(false);
      })
      .catch(() => {
        setLibraryError("Couldn't load previously saved files from this browser's local storage.");
        setLibraryLoading(false);
      });
    loadAttemptsFromDB().then(setAttempts).catch(() => {});
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
    loadSequenceGroupsFromDB().then(setSequenceGroups).catch(() => {});
    loadEmailAccountsFromDB().then(setEmailAccounts).catch(() => {});
    loadDispositionsFromDB().then(setDispositions).catch(() => {});
    loadCompanyProfilesFromDB().then(setCompanyProfiles).catch(() => {});
    // The roster always has at least "you" — seeded from the local
    // Profile the first time, so sequences have someone to belong to
    // before any teammate is ever added.
    Promise.all([loadUsersFromDB(), loadProfile()])
      .then(([loaded, profile]) => {
        if (loaded.length === 0) {
          const self = selfUserFrom(profile.name);
          setUsers([self]);
          persistUser(self);
        } else {
          setUsers(loaded);
        }
      })
      .catch(() => {});
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
    // Stamp when it was actually completed — a task's `date` is when it was
    // scheduled, which can be in the future (a sequence step due tomorrow,
    // worked today). Contacts' "last activity" reads this. Cleared when a
    // task is un-completed so the stamp never outlives the completion.
    const updatedTask: Task = { ...task, done, completedAt: done ? new Date().toISOString() : null };
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
    // Clear the enrollment's back-pointer first. Without this the
    // enrollment kept a currentTaskId aiming at a task that no longer
    // exists: it could never advance (nothing left to complete) and
    // resumeEnrollments explicitly skips any enrollment that still has
    // one, so reactivating the sequence would not regenerate it either.
    // The contact was stuck mid-cadence with no way out but Restart.
    setEnrollments((prev) => {
      let changed = false;
      const next = prev.map((e) => {
        if (e.currentTaskId !== id) return e;
        changed = true;
        return { ...e, currentTaskId: null };
      });
      if (changed) next.forEach((e) => { if (e.currentTaskId === null) persistEnrollment(e); });
      return changed ? next : prev;
    });
    setTasks((prev) => prev.filter((t) => t.id !== id));
    deleteTaskFromDB(id);
  }
  // Generic patch for the two Home-notifications fields (see lib/tasks.ts)
  // — which platform user a task is assigned to, and its manual "marked
  // as replied" timestamp. Same safe functional-updater pattern as
  // editTask, since either could fire in quick succession from the
  // Calls/Emails tabs.
  function updateTaskFields(id: string, patch: Partial<Pick<Task, "userId" | "repliedAt">>) {
    setTasks((prev) => {
      const next = prev.map((t) => (t.id === id ? { ...t, ...patch } : t));
      const updated = next.find((t) => t.id === id);
      if (updated) persistTask(updated);
      return next;
    });
  }

  // Contacts page's "+ Task" action — same task store as the Board, just
  // pre-linked to a specific Contact and carrying a priority so sales reps
  // can see which contacts matter most (see CLAUDE.md "Contact tasks").
  function addContactTask(contactId: string, date: string, priority: TaskPriority, text: string, channel?: "call" | "email", time?: string | null, userId?: string | null) {
    const task = createContactTask(date, text, contactId, priority, channel, time, userId);
    if (!task) return;
    setTasks((prev) => [...prev, task]);
    persistTask(task);
  }

  // Companies' "+ Add contact" action — same dedup rules as any CSV-
  // derived contact (see lib/contacts.ts's mergeManualContact).
  // Removes contacts outright — used by Companies' "Remove" to drop a
  // competitor or an irrelevant company from the working directory. Also
  // clears any company profile that no longer has contacts behind it, so
  // an enriched profile can't resurrect a company you just removed.
  function deleteContacts(ids: string[]) {
    if (!ids.length) return;
    const idSet = new Set(ids);
    setContacts((prev) => prev.filter((c) => !idSet.has(c.id)));
    void deleteContactsFromDB(ids);
  }

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
  // Instantiating a template is a create, not a link: it produces an
  // ordinary Sequence this app owns, which can then be edited/paused/
  // copied like any other. Goes through the same setState+persist path as
  // createNewSequence so there's one way a sequence comes into existence.
  function createSequenceFromTemplate(tpl: SequenceTemplate): Sequence | null {
    const seq = sequenceFromTemplate(tpl);
    if (seq) {
      setSequences((prev) => [seq, ...prev]);
      persistSequence(seq);
    }
    return seq;
  }
  // Logging an attempt does two things on purpose: append the history row,
  // and patch the Contact's existing counters/disposition so every
  // consumer that already reads those fields (sticky state, sequence
  // advancement, Home, filters) keeps behaving exactly as before. See
  // lib/outreachAttempts.ts for why it's additive rather than a
  // replacement source of truth.
  function logAttempt(input: {
    contactId: string;
    channel: AttemptChannel;
    outcome?: string;
    note?: string;
    taskId?: string | null;
    userId?: string | null;
  }) {
    const attempt = createAttempt(input);
    setAttempts((prev) => [attempt, ...prev]);
    persistAttempt(attempt);
    setContacts((prev) =>
      prev.map((c) => {
        if (c.id !== attempt.contactId) return c;
        const patch = contactPatchForAttempt(attempt, c);
        const next = { ...c, ...patch };
        // meetingBookedAt is stamped on the transition INTO meeting-booked
        // and cleared when it moves away — same rule updateContact follows,
        // so Home's "Booked this week" stays correct however it was set.
        if (patch.disposition === "meeting-booked" && c.disposition !== "meeting-booked") {
          next.meetingBookedAt = attempt.at;
        } else if (patch.disposition && patch.disposition !== "meeting-booked" && c.disposition === "meeting-booked") {
          next.meetingBookedAt = null;
        }
        persistContact(next);
        return next;
      })
    );
    // A connected outcome finishes that contact's active enrollments,
    // exactly as setting the same disposition anywhere else does.
    // finishTerminalEnrollments re-checks the disposition itself, so it is
    // handed a contact carrying the NEW outcome rather than the stale one
    // still sitting in the `contacts` array this closure captured.
    if (attempt.outcome && attempt.outcome !== "none") {
      const target = contacts.find((c) => c.id === attempt.contactId);
      if (target) finishTerminalEnrollments([{ ...target, disposition: attempt.outcome }]);
    }
    return attempt;
  }
  function removeAttempt(id: string) {
    setAttempts((prev) => prev.filter((a) => a.id !== id));
    deleteAttemptFromDB(id);
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
  function updateSequenceStep(id: string, stepId: string, patch: Partial<Pick<SequenceStep, "note" | "systemPrompt" | "userPrompt" | "subject" | "body">>) {
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
  // --- Sequence lifecycle / ownership / grouping (see lib/sequences.ts) ---
  // Pausing or archiving stops new enrollments and new step tasks;
  // reactivating regenerates the open task for any active enrollment that
  // got parked without one, so a paused sequence resumes rather than
  // stranding people mid-sequence.
  function setSequenceLifecycle(id: string, status: SequenceStatus) {
    const seq = sequences.find((s) => s.id === id);
    if (!seq) return;
    const next = setSequenceStatus(seq, status);
    updateSequenceSteps(next);
    if (status !== "active") return;
    const { enrollments: resumed, tasks: newTasks } = resumeEnrollments(next, enrollments, contacts);
    if (!newTasks.length) return;
    setEnrollments(resumed);
    resumed.forEach((e) => { if (enrollments.find((p) => p.id === e.id)?.currentTaskId !== e.currentTaskId) persistEnrollment(e); });
    setTasks((prev) => [...prev, ...newTasks]);
    newTasks.forEach(persistTask);
  }
  function assignSequenceOwner(id: string, ownerId: string | null) {
    const seq = sequences.find((s) => s.id === id);
    if (!seq) return;
    updateSequenceSteps(setSequenceOwner(seq, ownerId));
  }
  function assignSequenceGroup(id: string, groupId: string | null) {
    const seq = sequences.find((s) => s.id === id);
    if (!seq) return;
    updateSequenceSteps(setSequenceGroup(seq, groupId));
  }
  // "Copy which duplicates it exactly" — steps deep-copied with fresh ids,
  // no enrollments carried over (see duplicateSequence).
  function copySequence(id: string): Sequence | null {
    const seq = sequences.find((s) => s.id === id);
    if (!seq) return null;
    const copy = duplicateSequence(seq);
    setSequences((prev) => [copy, ...prev]);
    persistSequence(copy);
    return copy;
  }

  // --- Sequence groups ---
  function addSequenceGroup(name: string) {
    const group = createSequenceGroup(name);
    if (!group) return;
    setSequenceGroups((prev) => [...prev, group].sort((a, b) => a.name.localeCompare(b.name)));
    persistSequenceGroup(group);
  }
  function renameSequenceGroupById(id: string, name: string) {
    const group = sequenceGroups.find((g) => g.id === id);
    if (!group) return;
    const next = renameSequenceGroup(group, name);
    setSequenceGroups((prev) => prev.map((g) => (g.id === id ? next : g)).sort((a, b) => a.name.localeCompare(b.name)));
    persistSequenceGroup(next);
  }
  // Deleting a group never deletes its sequences — they just become
  // ungrouped, same rule the Lead Library's folders follow.
  function deleteSequenceGroupById(id: string) {
    setSequenceGroups((prev) => prev.filter((g) => g.id !== id));
    deleteSequenceGroupFromDB(id);
    sequences.filter((s) => s.groupId === id).forEach((s) => {
      const next = setSequenceGroup(s, null);
      setSequences((prev) => prev.map((p) => (p.id === s.id ? next : p)));
      persistSequence(next);
    });
  }
  function assignSequenceEmailAccount(id: string, emailAccountId: string | null) {
    const seq = sequences.find((s) => s.id === id);
    if (!seq) return;
    updateSequenceSteps(setSequenceEmailAccount(seq, emailAccountId));
  }

  // --- Email sending accounts (lib/emailAccounts.ts) — sender identity
  // only, no key, no live SendGrid connection. See that file's header. ---
  function addEmailAccount(label: string, fromName: string, fromEmail: string) {
    const account = createEmailAccount(label, fromName, fromEmail);
    if (!account) return;
    setEmailAccounts((prev) => [...prev, account].sort((a, b) => a.label.localeCompare(b.label)));
    persistEmailAccount(account);
  }
  function editEmailAccount(id: string, patch: Partial<Pick<EmailAccount, "label" | "fromName" | "fromEmail">>) {
    const account = emailAccounts.find((a) => a.id === id);
    if (!account) return;
    const next = updateEmailAccount(account, patch);
    setEmailAccounts((prev) => prev.map((a) => (a.id === id ? next : a)).sort((a, b) => a.label.localeCompare(b.label)));
    persistEmailAccount(next);
  }
  // Removing an account never breaks a sequence that pointed at it — it
  // just clears back to "None selected", same as removing a sequence
  // owner (see removeUser below) or deleting a sequence group.
  function deleteEmailAccount(id: string) {
    setEmailAccounts((prev) => prev.filter((a) => a.id !== id));
    deleteEmailAccountFromDB(id);
    sequences.filter((s) => s.emailAccountId === id).forEach((s) => {
      const next = setSequenceEmailAccount(s, null);
      setSequences((prev) => prev.map((p) => (p.id === s.id ? next : p)));
      persistSequence(next);
    });
  }

  function toggleAutoEnrichCompanies(on: boolean) {
    setAutoEnrichCompanies(on);
    try { localStorage.setItem("autoEnrichCompanies", on ? "1" : "0"); } catch { /* preference only */ }
  }
  // One explicit click per upload — never automatic — see the state comment
  // above. Sequential, capped, every domain's outcome kept for Scanner.
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

  // --- Company profiles: bulk Apollo export import (lib/companyProfiles.ts) ---
  // Explicit, file-driven, nothing in the background — same rule as every
  // other Apollo touchpoint. Parses through the same CSV path the Scanner
  // uses, folds rows into the existing profile set, persists only the
  // touched profiles, and hands the caller a summary to show.
  async function importCompanyProfilesFromFiles(files: FileList | File[]): Promise<ImportResult[]> {
    const results: ImportResult[] = [];
    let working = companyProfiles;
    for (const file of Array.from(files)) {
      const parsed = await parseCSVFile(file);
      const result = importCompanyRows(parsed.name, parsed.fields, parsed.data, working);
      working = result.profiles;
      results.push(result);
    }
    setCompanyProfiles(working);
    working.forEach((p) => persistCompanyProfile(p));
    return results;
  }

  // --- Custom call dispositions (lib/dispositions.ts) ---
  // Returns false when the label is blank or collides with an existing
  // disposition (built-in or custom), so the manager UI can say why.
  function addDisposition(label: string, connected = false): boolean {
    const created = createCustomDisposition(label, dispositions, connected);
    if (!created) return false;
    setDispositions((prev) => [...prev, created]);
    persistDisposition(created);
    return true;
  }
  // Leads already stamped with this disposition keep their value — it
  // renders as "<label> (removed)" via dispositionMetaFor rather than
  // being silently rewritten or crashing (see lib/dispositions.ts).
  function removeDisposition(id: string) {
    setDispositions((prev) => prev.filter((d) => d.id !== id));
    deleteDispositionFromDB(id);
  }

  // --- Platform users (attribution only — see lib/users.ts) ---
  function addUser(name: string, email: string, role: UserRole) {
    const user = createUser(name, email, role);
    if (!user) return;
    setUsers((prev) => [...prev, user]);
    persistUser(user);
  }
  function editUser(id: string, patch: Partial<Pick<PlatformUser, "name" | "email" | "role">>) {
    const user = users.find((u) => u.id === id);
    if (!user) return;
    const next = updateUser(user, patch);
    setUsers((prev) => prev.map((u) => (u.id === id ? next : u)));
    persistUser(next);
  }
  // Removing a user clears them off any sequence they owned rather than
  // leaving a dangling owner id pointing at nobody.
  function removeUser(id: string) {
    if (id === SELF_USER_ID) return;
    setUsers((prev) => prev.filter((u) => u.id !== id));
    deleteUserFromDB(id);
    sequences.filter((s) => s.ownerId === id).forEach((s) => {
      const next = setSequenceOwner(s, null);
      setSequences((prev) => prev.map((p) => (p.id === s.id ? next : p)));
      persistSequence(next);
    });
  }

  // Returns both counts so the UI can say "N enrolled, N blocked as do not
  // contact" rather than lumping an opt-out in with "already active."
  function enrollContactsInSequence(sequenceId: string, contactIds: string[]): { enrolled: number; blocked: number } {
    const seq = sequences.find((s) => s.id === sequenceId);
    if (!seq) return { enrolled: 0, blocked: 0 };
    const alreadyEnrolled = new Set(enrollments.filter((e) => e.sequenceId === sequenceId && e.status === "active").map((e) => e.contactId));
    const toEnroll = contactIds.filter((id) => !alreadyEnrolled.has(id));
    const newEnrollments: SequenceEnrollment[] = [];
    const newTasks: Task[] = [];
    let blocked = 0;
    toEnroll.forEach((contactId) => {
      const contact = contacts.find((c) => c.id === contactId);
      if (!contact) return;
      if (enrollmentBlockReason(contact)) { blocked++; return; }
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
    return { enrolled: newEnrollments.length, blocked };
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
    const terminalIds = touchedContacts.filter((c) => isTerminalDisposition(c.disposition, dispositions)).map((c) => c.id);
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
  // `syncContact` defaults to TRUE — every Scanner per-row edit (tier,
  // category, disposition, cross-out, priority) is an edit to a row from
  // the CURRENT batch, so pushing its scan-derived fields onto that
  // person's Contact is correct and unchanged.
  //
  // It is passed false only by Scanner's High Priority panel, which lists
  // rows from ALL of History. Such a row can be months old: replaying it
  // onto the Contact would overwrite a disposition set later, null out
  // meetingBookedAt, and could even auto-finish a live sequence
  // enrollment. That panel only ever edits priority/priorityMonth, which
  // are History-only fields with no Contact equivalent, so it has nothing
  // to sync in the first place.
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
      finishTerminalEnrollments(touched);
      return next;
    });
  }

  function loadParsedFilesIntoScanner(parsedFiles: ParsedFile[], tag = "Loaded from Lead Library") {
    const { results: scanned, duplicatesRemoved } = scanParsedFiles(parsedFiles, ruleOverrides);
    applyStickyState(scanned, contacts);
    applyCompetitorDQ(scanned, companyProfiles);
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
    // Give Scanner the History entry this batch came from so its "Save to
    // Lead Library" button can stamp StoredRow.__historyEntryId correctly.
    // Combining several entries has no single id to stamp, so it stays
    // null and Scanner disables the button with a reason rather than
    // silently doing nothing (which is what it used to do for BOTH cases).
    setLoadedHistoryEntryId(entries.length === 1 ? entries[0].id : null);
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

  const openTaskCount = tasks.filter((t) => !t.done).length;
  const openCallCount = tasks.filter((t) => !t.done && t.channel === "call").length;
  const countFor = (c: NavDest["count"]) =>
    c === "library" ? libraryEntries.length
    : c === "history" ? historyEntries.length
    : c === "lists" ? leadLists.length
    : c === "tasks" ? openTaskCount
    : c === "calls" ? openCallCount
    : null;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-brand">
          <span className="topbar-mark" aria-hidden="true">W</span>
          <span>The Library</span>
          <span className="topbar-sub">Wired Sales Outbound</span>
        </div>
        <div className="topbar-spacer" />
        <button
          className="icon-btn"
          onClick={toggleTheme}
          title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
        >
          {theme === "dark" ? "☀️" : "🌙"}
        </button>
        <button
          onClick={() => { setUnlocked(false); setUnlockedState(false); }}
          title="Lock this page again"
          className="icon-btn"
        >
          🔒 Lock
        </button>
      </header>

      <aside className="sidebar">
        <nav className="sidebar-nav">
          {NAV_GROUPS.map((grp, gi) => (
            <div key={grp.group || `g${gi}`}>
              {grp.group && <div className="sidebar-group">{grp.group}</div>}
              {grp.items.map((item) => {
                const active = view === item.key && (!item.tab || engageEntry.tab === item.tab);
                const n = countFor(item.count);
                return (
                  <button
                    key={`${item.key}:${item.tab || ""}`}
                    onClick={() => {
                      setView(item.key);
                      if (item.tab) setEngageEntry({ tab: item.tab });
                    }}
                    className={`side-nav-btn${active ? " active" : ""}`}
                  >
                    <span aria-hidden="true">{item.icon}</span>
                    <span className="side-nav-label">{item.label}</span>
                    {n !== null && <span className="side-nav-count">{n}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
        <AccountPanel
          onOpenSettings={() => setNotesPanelTab("cheatsheet")}
          onOpenNotes={() => setNotesPanelTab("notes")}
          users={users}
          onAddUser={addUser}
          onEditUser={editUser}
          onRemoveUser={removeUser}
        />
      </aside>

      <main className="app-main">

          {view === "home" && (
            <Home
              tasks={tasks}
              contacts={contacts}
              sequences={sequences}
              onToggleTask={toggleTask}
              onNavigate={(tab) => { setEngageEntry({ tab }); setView("engage"); }}
              onOpen={(dest) => {
                if (dest.kind === "view") { setView(dest.view); return; }
                setEngageEntry({
                  tab: dest.tab,
                  contactsQuery: dest.contactsQuery,
                  contactsTier: dest.contactsTier,
                  contactsWorked: dest.contactsWorked,
                });
                setView("engage");
              }}
              weeklyGoals={getOrCreateCurrentWeekGoals()}
              onUpdateMetric={updateWeeklyMetric}
              onAddMetric={addWeeklyMetric}
              onRemoveMetric={removeWeeklyMetric}
              users={users}
              onUpdateTaskFields={updateTaskFields}
              attempts={attempts}
              dispositions={dispositions}
              libraryFileCount={libraryEntries.length}
              listCount={leadLists.length}
              uploadCount={historyEntries.length}
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
              loadedHistoryEntryId={loadedHistoryEntryId}
              leadLists={leadLists}
              onAddSelectedToList={addSelectedToList}
              dispositions={dispositions}
              autoEnrichCompanies={autoEnrichCompanies}
              onToggleAutoEnrichCompanies={toggleAutoEnrichCompanies}
              pendingEnrich={pendingEnrich}
              companyProfiles={companyProfiles}
              companyEnrichOutcomes={companyEnrichOutcomes}
              companyEnriching={companyEnriching}
              onRunCompanyEnrichment={runPendingCompanyEnrichment}
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
              attempts={attempts}
              onLogAttempt={logAttempt}
              onRemoveAttempt={removeAttempt}
              onCreateSequence={createNewSequence}
              onCreateSequenceFromTemplate={createSequenceFromTemplate}
              onRenameSequence={renameSequenceById}
              onAddSequenceStep={addSequenceStep}
              onRemoveSequenceStep={removeSequenceStep}
              onUpdateSequenceStep={updateSequenceStep}
              onMoveSequenceStep={moveSequenceStep}
              onDeleteSequence={deleteSequence}
              onEnrollInSequence={enrollContactsInSequence}
              onRestartEnrollment={restartSequenceEnrollment}
              onRemoveEnrollment={removeSequenceEnrollment}
              users={users}
              sequenceGroups={sequenceGroups}
              onSetSequenceStatus={setSequenceLifecycle}
              onSetSequenceOwner={assignSequenceOwner}
              onSetSequenceGroup={assignSequenceGroup}
              onCopySequence={copySequence}
              onAddSequenceGroup={addSequenceGroup}
              onRenameSequenceGroup={renameSequenceGroupById}
              onDeleteSequenceGroup={deleteSequenceGroupById}
              emailAccounts={emailAccounts}
              onSetSequenceEmailAccount={assignSequenceEmailAccount}
              onAddEmailAccount={addEmailAccount}
              onEditEmailAccount={editEmailAccount}
              onDeleteEmailAccount={deleteEmailAccount}
              onUpdateTaskFields={updateTaskFields}
              leadLists={leadLists}
              leadListsLoading={leadListsLoading}
              leadListsError={leadListsError}
              onRenameList={renameList}
              onDeleteList={deleteList}
              onRemoveLeadFromList={removeLeadFromList}
              dispositions={dispositions}
              onManageDispositions={() => setNotesPanelTab("dispositions")}
              companyProfiles={companyProfiles}
              onImportCompanyProfiles={importCompanyProfilesFromFiles}
              onDeleteContacts={deleteContacts}
              initialTab={engageEntry.tab}
              initialContactsSearch={engageEntry.contactsQuery}
              initialContactsTier={engageEntry.contactsTier}
              initialContactsWorked={engageEntry.contactsWorked}
              onTabChange={(tab) => setEngageEntry((prev) => ({ ...prev, tab }))}
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
              loading={libraryLoading}
              error={libraryError}
              onLoadIntoScanner={loadParsedFilesIntoScanner}
              onRecordHistory={recordHistory}
              ruleOverrides={ruleOverrides}
              dispositions={dispositions}
            />
          )}
      </main>

      {notesPanelTab === "cheatsheet" && (
        <CheatSheet
          onClose={() => setNotesPanelTab(null)}
          ruleOverrides={ruleOverrides}
          onChangeRuleOverrides={updateRuleOverrides}
          onSwitchToNotes={() => setNotesPanelTab("notes")}
          onSwitchToDispositions={() => setNotesPanelTab("dispositions")}
        />
      )}
      {notesPanelTab === "notes" && (
        <PlatformNotes onClose={() => setNotesPanelTab(null)} onSwitchToCheatSheet={() => setNotesPanelTab("cheatsheet")} onSwitchToDispositions={() => setNotesPanelTab("dispositions")} />
      )}
      {notesPanelTab === "dispositions" && (
        <div
          onClick={() => setNotesPanelTab(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(8,30,34,0.45)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "40px 20px", zIndex: 50, overflowY: "auto" }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: "var(--surface)", borderRadius: 14, maxWidth: 560, width: "100%", padding: "22px 24px", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}
          >
            <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
              <button onClick={() => setNotesPanelTab("notes")} className="btn btn-sm btn-secondary">Platform Notes</button>
              <button onClick={() => setNotesPanelTab("cheatsheet")} className="btn btn-sm btn-secondary">Cheat Sheet</button>
              <button disabled className="btn btn-sm" style={{ background: "linear-gradient(90deg, var(--accent), var(--accent-blue))", color: "#fff", fontWeight: 700 }}>
                Dispositions
              </button>
              <span style={{ flex: 1 }} />
              <button onClick={() => setNotesPanelTab(null)} className="btn btn-sm btn-ghost">✕</button>
            </div>
            <h2 style={{ margin: "0 0 10px", fontSize: 17 }}>Call dispositions</h2>
            <DispositionManager dispositions={dispositions} onAdd={addDisposition} onRemove={removeDisposition} />
          </div>
        </div>
      )}
    </div>
  );
}
