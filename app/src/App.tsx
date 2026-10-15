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
import { useEffect, useMemo, useRef, useState } from "react";
import Scanner from "./components/Scanner";
import LibraryView from "./components/Library";
import HistoryView from "./components/History";
import ListsView from "./components/Lists";
import LockScreen from "./components/LockScreen";
import Scanner2 from "./components/Scanner2";
import Documentation from "./components/Documentation";
import Diagnostics from "./components/Diagnostics";
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
  loadLeads, saveLeads, mergeLeads, leadKeyOfInput, type StoredLead, type LeadInput,
} from "./lib/leadStore";
import {
  qualifyLeadInputs, requalifyStoredLeads, summarizeDiscards, type DiscardedLead,
} from "./lib/leadQualify";
import { parseApolloSync, applyApolloSync } from "./lib/apolloSync";
import { loadApolloRoster, saveApolloRoster, rosterFromSync, mergeRoster, buildRosterIndex, type ApolloRosterEntry } from "./lib/apolloRoster";
import {
  loadFunnels, saveFunnels, parseFunnelCSV, realSteps, type ApolloFunnel,
} from "./lib/apolloFunnel";
import Campaigns from "./components/Campaigns";
import Overview from "./components/Overview";
import { appendRawNotes } from "./lib/rawNotes";
import { setStatusRoster, verdictOf, withStatusOverride, type LeadStatus } from "./lib/leadStatus";
import ApolloStatus from "./components/ApolloStatus";
import {
  DEFAULT_ROUTING, loadRouting, withPlan, type RoutingRules,
} from "./lib/sequenceRouting";
import { leadInputsFromResults, leadInputsFromRows2, leadInputsFromNoSignal, leadInputsFromDuplicates } from "./lib/leadFiling";
import AllLeads, { type LeadsPreset } from "./components/AllLeads";
import ApolloSyncPanel from "./components/ApolloSyncPanel";
import RateLimitNote from "./components/RateLimitNote";
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
import { pullTeamUploads, checkLeadsInApollo, applyCheckResults, type PullProgress, type CheckProgress } from "./lib/apolloLive";
import type { SaveReport } from "./lib/saveReport";
import "./styles.css";

export interface UploadedFile {
  name: string;
  rows: number;
}

export type View =
  | "home" | "scanner" | "scanner2" | "scanner3" | "library" | "allleads"
  | "queue" | "campaigns" | "history" | "lists" | "docs" | "diagnostics";

/** The three scanners, kept in their own collapsible sidebar section.
 *  Per Jack: "build the scanners into a drop down section on the left hand
 *  side." They are the on-ramp; the groups below are where leads live. */
const SCANNER_NAV: { key: View; label: string }[] = [
  { key: "scanner", label: "Main Scanner" },
  { key: "scanner2", label: "Custom Scanner September" },
  { key: "scanner3", label: "CSP Scanner" },
];

const NAV_GROUPS: { title: string; items: { key: View; label: string }[] }[] = [
  { title: "Leads", items: [
    { key: "allleads", label: "All leads" },
    { key: "queue", label: "In Apollo" },
  ] },
  { title: "Archive", items: [
    { key: "lists", label: "Lists" },
    { key: "history", label: "History" },
  ] },
];

export default function App() {
  const [unlocked, setUnlockedState] = useState(isUnlocked());
  const [view, setView] = useState<View>("home");
  const [showDiscardNames, setShowDiscardNames] = useState(false);
  // Everyone the Apollo syncs have named — what a new upload is checked
  // against. Per Jack: "see if any of those have been added in apollo
  // already so i can remove them from the csv".
  const [apolloRoster, setApolloRoster] = useState<ApolloRosterEntry[]>([]);
  useEffect(() => { loadApolloRoster().then(setApolloRoster).catch(() => { /* empty roster is fine */ }); }, []);
  // The Main Scanner batch on screen, waiting for Save, and what Save did.
  const [pendingMain, setPendingMain] = useState<LeadInput[] | null>(null);
  const [mainSaved, setMainSaved] = useState<SaveReport | null>(null);
  // Sidebar scanner section. A per-viewer display preference, so browser
  // storage is the right home for it — wrapped, since storage can throw.
  const [scannersOpen, setScannersOpen] = useState(() => {
    try { return localStorage.getItem("navScannersOpen") !== "0"; } catch { return true; }
  });
  function toggleScanners() {
    setScannersOpen((v) => {
      try { localStorage.setItem("navScannersOpen", v ? "0" : "1"); } catch { /* preference only */ }
      return !v;
    });
  }
  // Bumped by either scanner's "Start over" so its key changes and the
  // component remounts. A scan retains ~146 MB that clearing the state does
  // not release, because React keeps the last render's memoised rows on the
  // fiber; unmounting does release it. Shared by both scanners because only
  // one is ever mounted.
  const [scanEpoch, setScanEpoch] = useState(0);

  const [results, setResults] = useState<ResultRow[] | null>(null);
  const [uploadedFiles, setUploadedFiles] = useState<{ name: string; rows: number }[]>([]);
  const [libraryEntries, setLibraryEntries] = useState<LibraryEntry[]>([]);
  const [libraryGroups, setLibraryGroups] = useState<LibraryGroup[]>([]);
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [companyProfiles, setCompanyProfiles] = useState<CompanyProfile[]>([]);
  const [leadLists, setLeadLists] = useState<LeadList[]>([]);
  /** Every lead ever scanned, all three scanners. See lib/leadStore.ts. */
  const [leads, setLeads] = useState<StoredLead[]>([]);
  const apolloIndex = useMemo(() => buildRosterIndex(apolloRoster, leads), [apolloRoster, leads]);
  setStatusRoster(apolloIndex);
  const leadsRef = useRef(leads);
  leadsRef.current = leads;
  const rosterPulledAt = useMemo(
    () => apolloRoster.reduce((m, r) => (r.uploadedAt && r.syncedAt > m ? r.syncedAt : m), ""), [apolloRoster]);

  /** Pull Jack and Carly's recent Apollo CSV uploads into the roster. Each
   *  page is stored as it lands, so Stop keeps what was read. */
  async function pullApollo(months: number, onProgress: (p: PullProgress) => void, signal: AbortSignal) {
    return pullTeamUploads({
      months, onProgress, signal,
      onEntries: async (entries) => {
        setApolloRoster((prev) => mergeRoster(prev, entries));
        await saveApolloRoster(entries);
      },
    });
  }
  /** Look every given lead up in Apollo, one free read-only search each,
   *  and write where they stand onto the lead. Saved in batches as they
   *  land, so Stop keeps what was read. */
  async function checkLeadsLive(targets: StoredLead[], onProgress: (p: CheckProgress) => void, signal: AbortSignal) {
    return checkLeadsInApollo({
      leads: targets, onProgress, signal,
      onResults: async (results) => {
        // Saved from the ref, never from inside the updater: an updater's
        // side effects are not guaranteed to have run by the next line
        // (see CLAUDE.md, mutateResults).
        const { changed } = applyCheckResults(leadsRef.current, results);
        setLeads((prev) => applyCheckResults(prev, results).leads);
        if (changed.length) await saveLeads(changed).catch((e) =>
          setError(`Apollo results could not be stored: ${e instanceof Error ? e.message : String(e)}`));
      },
    });
  }
  /** The Home panel's Apollo run. Held here, not in the panel, so it keeps
   *  going while you move to another view. */
  const [homeCheck, setHomeCheck] = useState<CheckProgress | null>(null);
  const [homeCheckError, setHomeCheckError] = useState("");
  const homeCheckAbort = useRef<AbortController | null>(null);
  async function runHomeCheck(targets: StoredLead[]) {
    if (!targets.length || (homeCheck && !homeCheck.finished)) return;
    const ac = new AbortController();
    homeCheckAbort.current = ac;
    setHomeCheckError("");
    setHomeCheck({ total: targets.length, done: 0, found: 0, notFound: 0, skipped: 0, errors: 0, finished: false });
    try {
      const p = await checkLeadsLive(targets, setHomeCheck, ac.signal);
      setHomeCheck({ ...p, finished: true });
    } catch (e) {
      setHomeCheckError(e instanceof Error ? e.message : String(e));
      setHomeCheck((x) => (x ? { ...x, finished: true } : x));
    } finally { homeCheckAbort.current = null; }
  }
  // Per Jack: "when i upload a lead list i need it to be saved to all leads
  // than ran against in apollo … a simple workflow with a button or two".
  // Save & check stores the batch, then looks every lead in it up in Apollo
  // (Strong Signal first), on the same run the Home panel uses — so it
  // keeps going while you move around, and stops cleanly at Apollo's
  // 400-an-hour cap with what it read kept.
  const [uploadCheckKeys, setUploadCheckKeys] = useState<string[] | null>(null);
  const [uploadCheckLabel, setUploadCheckLabel] = useState("");
  useEffect(() => {
    if (!uploadCheckKeys || (homeCheck && !homeCheck.finished)) return;
    const want = new Set(uploadCheckKeys);
    const targets = leads.filter((l) => want.has(l.key));
    if (!targets.length) return; // the save has not landed in state yet
    const rank = (l: StoredLead) => ({ strong: 0, review: 1, bad: 2 })[verdictOf(l.tier)];
    targets.sort((a, b) => rank(a) - rank(b));
    setUploadCheckKeys(null);
    void runHomeCheck(targets);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leads, uploadCheckKeys, homeCheck]);
  function fileLeadsAndCheck(inputs: LeadInput[], label: string): SaveReport {
    const report = fileLeads(inputs);
    const keys = [...new Set(inputs.map((i) => leadKeyOfInput(i)).filter(Boolean))];
    if (keys.length) { setUploadCheckLabel(label); setUploadCheckKeys(keys); }
    return report;
  }

  /** What the qualification gate just threw away. Transient by necessity —
   *  a discarded lead is never stored, so this is the only record of it. */
  const [lastDiscards, setLastDiscards] =
    useState<{ discarded: DiscardedLead[]; sizeUnknown: string[] } | null>(null);
  const [funnels, setFunnels] = useState<ApolloFunnel[]>([]);
  const [routing, setRouting] = useState<RoutingRules>(DEFAULT_ROUTING);
  /** Seeds All leads' sequence filter when arriving from a campaign card,
   *  so "open these leads" lands on that sequence rather than everything. */
  const [leadsSequenceEntry, setLeadsSequenceEntry] = useState<string>("");
  /** Same idea, for Home's status links. */
  const [leadsStatusEntry, setLeadsStatusEntry] = useState<LeadStatus | "">("");
  /** And for Home's named views ("Strong signal · never contacted" …). */
  const [leadsPresetEntry, setLeadsPresetEntry] = useState<LeadsPreset | "">("");
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
        const [lib, hist, cts, lists, disp, profiles, rules, storedLeads, storedFunnels, storedRouting] = await Promise.all([
          loadLibraryFromDB(), loadHistoryFromDB(), loadContactsFromDB(),
          loadLeadListsFromDB(), loadDispositionsFromDB(), loadCompanyProfilesFromDB(),
          loadRuleOverrides(), loadLeads(), loadFunnels(), loadRouting(),
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
        // Clear the target sequences the old upload-time auto-router set.
        // Only machine-made, never-exported plans: a plan set by hand, or
        // one already exported, is real history and stays.
        const autoQueued = storedLeads.filter((l) => l.plan?.by === "rule" && l.plan.status === "queued");
        const cleaned = autoQueued.length
          ? storedLeads.map((l) => (l.plan?.by === "rule" && l.plan.status === "queued" ? withPlan(l, null) : l))
          : storedLeads;
        if (autoQueued.length) {
          const cleared = new Set(autoQueued.map((l) => l.key));
          saveLeads(cleaned.filter((l) => cleared.has(l.key))).catch(() => {});
        }
        setLeads(cleaned);
        setFunnels(storedFunnels);
        setRouting(storedRouting);
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

  /** Every row of a Main Scanner batch as lead inputs: scored rows, the
   *  rows detection skipped, and the repeats it merged (for their file). */
  function mainInputsFor(
    parsedFiles: ParsedFile[],
    scanned: ResultRow[],
    dropped: { noSignalRows?: NoSignalRow[]; duplicateRows?: DuplicateRow[] } = {},
  ): LeadInput[] {
    const scoredInputs = leadInputsFromResults(scanned);
    // Every Main row id ends "<file>-<row>", so the raw CSV row behind a
    // skipped or merged row can be found again for the raw store.
    const rawOf = (id: string) => {
      const m = id.match(/(\d+)-(\d+)$/);
      return m ? parsedFiles[Number(m[1])]?.data[Number(m[2])] as Record<string, unknown> | undefined : undefined;
    };
    const noSignalInputs = leadInputsFromNoSignal(dropped.noSignalRows ?? [], rawOf);
    const batchKeys = new Set([...scoredInputs, ...noSignalInputs].map((i) => leadKeyOfInput(i)));
    return [
      ...scoredInputs,
      ...noSignalInputs,
      // Repeats the scanner merged away still say which files a lead is on.
      ...leadInputsFromDuplicates(dropped.duplicateRows ?? [], batchKeys, rawOf),
    ];
  }

  function recordHistory(
    parsedFiles: ParsedFile[],
    scanned: ResultRow[],
    tag = "",
    duplicatesRemoved = 0,
    dropped: { noSignalRows?: NoSignalRow[]; duplicateRows?: DuplicateRow[] } = {},
    // Adding or removing a file post-scan re-scans the SAME batch, so the
    // entry it already recorded is superseded rather than joined by a
    // second one — otherwise History shows one upload twice with
    // different file lists and no way to tell which is current.
    replaceId: string | null = null
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
    setHistoryEntries((prev) => [entry, ...(replaceId ? prev.filter((e) => e.id !== replaceId) : prev)]);
    persistHistoryEntry(entry);
    if (replaceId) deleteHistoryEntryFromDB(replaceId);
    mergeContacts(parsedFiles, scanned);
    // Every scanned lead is stored, not just the Strong Signal ones the
    // Lead Library files. Per Jack: "we need to make this the source of
    // truth for leads ... from raw lead to finished lead in this library".
    // Including the rows detection skipped outright: on the real 500-row
    // file that is 342 leads which exist nowhere else in the app. Per
    // Jack, the Library shows "every lead filtered out".
    // NOT stored yet. Per Jack: "needs a save option when a csv uploads —
    // if save is clicked all contacts and info there is saved". The batch
    // waits here until the Save button on the scanner files it.
    setPendingMain(mainInputsFor(parsedFiles, scanned, dropped));
    setMainSaved(null);
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

  /**
   * Store this batch's leads.
   *
   * Reads `prev` from inside the functional updater, never an outer
   * closure — two uploads in quick succession would otherwise race and
   * silently drop one, the stale-closure class of bug this file has hit
   * before (see finishTerminalEnrollments).
   *
   * Only the rows that actually changed are written, in ONE transaction:
   * a cycle of the real files is ~37,000 rows and a per-row dbPut would
   * open 37,000 connections.
   */
  function fileLeads(inputs: LeadInput[]): SaveReport {
    const empty = { rows: inputs.length, stored: 0, repeats: 0, unkeyable: 0, added: 0, updated: 0, discarded: 0 };
    if (inputs.length === 0) return empty;
    // The qualification gate, BEFORE anything is written. Per Jack an IT /
    // MSP / Microsoft-partner company and a confirmed sub-10-employee
    // company are "automatically excluded from being stored" — discarded
    // outright, his explicit choice over keeping a hidden copy. Nothing
    // records them afterwards, so the report below is the only trace and
    // the banner that shows it is not optional polish.
    // Per Jack: "i need to be able to save every lead from the uploads i
    // dont want to miss any". The gate no longer drops anything: a
    // competitor / IT company or a sub-floor company is saved as a Bad Lead
    // with the reason on the record, still visible, still reversible.
    const gated = qualifyLeadInputs(inputs, companyProfiles);
    const { discarded, sizeUnknown } = gated;
    if (discarded.length) setLastDiscards({ discarded, sizeUnknown });
    const kept = [
      ...gated.kept,
      ...discarded.filter((d) => d.input).map((d) => ({
        ...d.input!, tier: "Bad Lead", notFit: `${d.reason}${d.detail ? ` — ${d.detail}` : ""}`,
      })),
    ];
    if (kept.length === 0) return { ...empty, discarded: discarded.length };
    // The raw note, exactly as the file had it — the "before" beside the
    // scanner's "after". Its own store, written once per upload; never on
    // the lead record itself (see lib/rawNotes.ts).
    const uploadedAt = new Date().toISOString();
    appendRawNotes(kept
      .filter((i) => (i.rawNotes || "").trim() || i.rawFields)
      .map((i) => ({
        key: leadKeyOfInput(i),
        seg: { at: uploadedAt, file: i.sourceFile, text: i.rawNotes || "" },
        ...(i.rawFields ? { fields: i.rawFields } : {}),
      })),
    ).catch((e) => setError(`Raw notes could not be stored: ${e instanceof Error ? e.message : String(e)}`));
    setLeads((prev) => {
      // No auto-routing on upload. Per Jack: "im not assigning which
      // sequence here … its which sequence is it in in apollo already".
      // The sequence a lead shows comes from the Apollo sync only.
      const { leads, changed } = mergeLeads(prev, kept);
      if (changed.length) {
        saveLeads(changed).catch((e) =>
          setError(`Leads were scanned, but could not be stored: ${e instanceof Error ? e.message : String(e)}`));
      }
      return leads;
    });
    // Account for every row — see lib/saveReport.ts.
    const keys = kept.map((k) => leadKeyOfInput(k));
    const unique = new Set(keys.filter(Boolean));
    const had = new Set(leads.map((l) => l.key));
    let updated = 0;
    for (const k of unique) if (had.has(k)) updated++;
    return {
      rows: inputs.length,
      stored: unique.size,
      unkeyable: keys.filter((k) => !k).length,
      repeats: keys.filter(Boolean).length - unique.size,
      added: unique.size - updated,
      updated,
      discarded: discarded.length,
    };
  }

  /** The Main Scanner's Save button. */
  function saveMainBatch(check = false) {
    if (!pendingMain) return;
    setMainSaved(check ? fileLeadsAndCheck(pendingMain, "this Main Scanner upload") : fileLeads(pendingMain));
    setPendingMain(null);
  }

  /** Apply a change to some leads by key, in state and in the store. Reads
   *  `prev` inside the updater, never a closure — the queue fires these in
   *  quick succession (export, then move, then export again). */
  function updateLeads(keys: string[], fn: (l: StoredLead) => StoredLead) {
    const want = new Set(keys);
    setLeads((prev) => {
      const changed: StoredLead[] = [];
      const next = prev.map((l) => {
        if (!want.has(l.key)) return l;
        const u = fn(l);
        if (u !== l) changed.push(u);
        return u;
      });
      if (changed.length) {
        saveLeads(changed).catch((e) =>
          setError(`Could not save the queue change: ${e instanceof Error ? e.message : String(e)}`));
      }
      return changed.length ? next : prev;
    });
  }

  /** Hand-set a status, or null to give it back to the evidence. */
  const setLeadStatus = (keys: string[], status: LeadStatus | null) =>
    updateLeads(keys, (l) => withStatusOverride(l, status));

  /** Every sequence name worth offering in a picker: imported funnels,
   *  routing rules, and any plan already on a lead. */
  const knownSequences = useMemo(() => {
    const set = new Set<string>();
    for (const f of funnels) set.add(f.name);
    for (const v of Object.values(routing.rules)) if (v) set.add(v);
    for (const l of leads) if (l.plan) set.add(l.plan.sequence);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [funnels, routing, leads]);

  /**
   * Re-run the gate over leads ALREADY stored, after enrichment taught us
   * new industries and headcounts.
   *
   * Without this the gate only ever catches companies that happened to be
   * enriched before their leads were scanned, which on a fresh upload is
   * almost none of them — measured on Jack's seven real files, 4,571 of
   * 4,587 companies had no headcount on file at scan time.
   */
  /**
   * Load an Apollo sync file onto the leads already stored.
   *
   * The app cannot call Apollo itself — it is a static bundle with no MCP
   * runtime (see lib/apolloSync.ts). So the round trip is: export the
   * lookup list from here, run the pull in a Claude session, import the
   * result back. This is the import half.
   */
  async function applySyncFiles(files: ParsedFile[]) {
    const { rows, unmapped, skipped } = parseApolloSync(files);
    const { leads: next, changed, matched, unmatched, matchedByName, ambiguous } = applyApolloSync(leads, rows);
    setLeads(next);
    // Every person in the file joins the roster, matched or not.
    const fresh = rosterFromSync(rows);
    setApolloRoster((prev) => mergeRoster(prev, fresh));
    await saveApolloRoster(fresh).catch((e) =>
      setError(`Sync read, but the Apollo roster could not be stored: ${e instanceof Error ? e.message : String(e)}`));
    if (changed.length) {
      await saveLeads(changed).catch((e) =>
        setError(`Sync read, but could not be stored: ${e instanceof Error ? e.message : String(e)}`));
    }
    return { rows: rows.length, matched, unmatched: unmatched.length, unmapped, skipped, matchedByName, ambiguous };
  }

  /** Import Apollo's per-step funnel. Replaced per sequence, not merged —
   *  a funnel is a snapshot, so a re-import has to be able to shrink a
   *  count, not only grow it. */
  async function importFunnelFiles(files: ParsedFile[]) {
    const { funnels: incoming, unmapped, skipped } = parseFunnelCSV(files);
    const byName = new Map(funnels.map((f) => [f.name, f]));
    for (const f of incoming) byName.set(f.name, f);
    const next = [...byName.values()];
    setFunnels(next);
    await saveFunnels(incoming).catch((e) =>
      setError(`Funnel read, but could not be stored: ${e instanceof Error ? e.message : String(e)}`));
    return {
      funnels: incoming.length,
      steps: incoming.reduce((a, f) => a + realSteps(f).length, 0),
      unmapped,
      skipped,
    };
  }

  async function requalifyAll(profiles: CompanyProfile[]) {
    const { discarded } = requalifyStoredLeads(leads, profiles);
    if (!discarded.length) return 0;
    // Marked, never deleted — see fileLeads.
    const why = new Map(discarded.map((d) => [d.key, `${d.reason}${d.detail ? ` — ${d.detail}` : ""}`]));
    updateLeads([...why.keys()], (l) => ({ ...l, tier: "Bad Lead", notFit: why.get(l.key) }));
    setLastDiscards({ discarded, sizeUnknown: [] });
    return discarded.length;
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
    // ...and so do the scan stats. Without this, Scanner's lastScanStats
    // stayed null on this path and its "Rows scanned" tile fell back to
    // results.length — the POST-filter count. Jack caught it: the tile read
    // 2,216 against Strong Signal 959 / Needs review 711 / Bad leads 546,
    // which sum to exactly 2,216. That identity is the tell: it can only
    // hold if nothing was dropped, and on a real five-file Main batch
    // 4,165 rows read collapse to 1,728 processed, so the tile was
    // understating the upload by more than half.
    //
    // Same defect the History path already had fixed (see CLAUDE.md "Rows
    // scanned undercounted when a batch was reopened/combined from
    // History"); that fix covered loadHistoryIntoScanner and missed this
    // sibling.
    setLoadedScanStats({
      rowsScanned: parsedFiles.reduce((n, pf) => n + pf.data.length, 0),
      duplicatesRemoved,
      largestDuplicateGroup: scanned.reduce((m, r) => Math.max(m, r.duplicateGroupSize ?? 0), 0),
    });
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
      // And the same newly-learned industries have to reach the STORE, not
      // only the rows on screen. A lead stored before its company was
      // enriched passed the gate on no evidence; this is where that is
      // settled.
      await requalifyAll(working);
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
        {/* Which build is this? An old copy of the HTML looks identical to
            a new one, which once cost an entire session to work out. The
            commit and build time are baked in at compile time by
            vite.config.ts, so the page can answer it itself. */}
        <span
          className="topbar-sub"
          title="Build this page was compiled from — commit and time (UTC)"
          style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 11, opacity: 0.75, marginRight: 10, whiteSpace: "nowrap" }}
        >
          build {__BUILD_ID__}
        </span>
        <button onClick={() => { setUnlocked(false); setUnlockedState(false); }} className="icon-btn" title="Lock this page again">
          🔒 Lock
        </button>
      </header>

      <aside className="sidebar">
        <nav className="sidebar-nav">
          <button
            className={`side-nav-btn${view === "home" ? " active" : ""}`}
            onClick={() => setView("home")}
          >
            Home
          </button>

          {/* Scanners: collapsible. Kept open while one of them is on
              screen, so collapsing can never hide where you are. */}
          <button
            className="sidebar-group"
            onClick={toggleScanners}
            aria-expanded={scannersOpen || SCANNER_NAV.some((i) => i.key === view)}
            style={{ display: "flex", width: "100%", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", textAlign: "left" }}
          >
            <span>{scannersOpen || SCANNER_NAV.some((i) => i.key === view) ? "▾" : "▸"}</span>
            <span>Scanners</span>
          </button>
          {(scannersOpen || SCANNER_NAV.some((i) => i.key === view)) && SCANNER_NAV.map((item) => (
            <button
              key={item.key}
              className={`side-nav-btn${view === item.key ? " active" : ""}`}
              style={{ paddingLeft: 22 }}
              onClick={() => setView(item.key)}
            >
              {item.label}
            </button>
          ))}

          {NAV_GROUPS.map((g) => (
            <div key={g.title}>
              <div className="sidebar-group">{g.title}</div>
              {g.items.map((item) => (
                <button
                  key={item.key}
                  className={`side-nav-btn${view === item.key || (item.key === "allleads" && view === "library") || (item.key === "queue" && view === "campaigns") ? " active" : ""}`}
                  onClick={() => setView(item.key)}
                >
                  <span className="side-nav-label" style={{ flex: 1 }}>{item.label}</span>
                  {item.key === "allleads" && leads.length > 0 && (
                    <span className="side-nav-count">{leads.length.toLocaleString()}</span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div style={{ marginTop: "auto", padding: 8, display: "flex", flexDirection: "column", gap: 6 }}>
          <button
            onClick={() => setView("docs")}
            className={`btn btn-sm btn-ghost${view === "docs" ? " active" : ""}`}
            aria-label="Documentation"
          >📖 Documentation</button>
          <button
            onClick={() => setView("diagnostics")}
            className={`btn btn-sm btn-ghost${view === "diagnostics" ? " active" : ""}`}
            aria-label="Diagnostics"
          >🩺 Diagnostics</button>
          <button onClick={() => setNotesPanelTab("cheatsheet")} className="btn btn-sm btn-ghost">❓ Cheat Sheet</button>
          <button onClick={() => setNotesPanelTab("notes")} className="btn btn-sm btn-ghost">📝 Platform notes</button>
        </div>
      </aside>

      <main className="app-main" style={{ minWidth: 0 }}>
        {uploadCheckLabel && (uploadCheckKeys || homeCheck) && (
          <div className="scan-note" role="status" aria-label="Upload Apollo check" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
            {!homeCheck || uploadCheckKeys
              ? <span>Saved. Waiting to check {uploadCheckLabel} in Apollo…</span>
              : <span>
                  {homeCheck.finished ? "Apollo check done for" : "Checking"} {uploadCheckLabel}{homeCheck.finished ? ":" : " in Apollo:"}{" "}
                  <b>{homeCheck.done.toLocaleString()}</b> of {homeCheck.total.toLocaleString()}
                  {" · "}{homeCheck.found.toLocaleString()} in Apollo · {homeCheck.notFound.toLocaleString()} not in Apollo
                  {homeCheck.errors > 0 && ` · ${homeCheck.errors.toLocaleString()} failed`}
                </span>}
            {homeCheckError && <span style={{ color: "#B5443B" }}>Stopped: {homeCheckError}</span>}
            <RateLimitNote progress={homeCheck} />
            {homeCheck && !homeCheck.finished && <button className="btn btn-sm btn-secondary" onClick={() => homeCheckAbort.current?.abort()}>Stop</button>}
            <button className="btn btn-sm btn-primary" onClick={() => setView("queue")}>See where they stand</button>
            {homeCheck?.finished && <button className="btn btn-sm btn-ghost" aria-label="Dismiss" onClick={() => setUploadCheckLabel("")}>✕</button>}
          </div>
        )}
        {error && <div style={{ marginBottom: 12, color: "#9A5B22" }}>{error}</div>}

        {/* The discard report. A gated-out lead is never written anywhere,
            so this banner is the ONLY place it is ever named — which is why
            it lists the companies rather than just counting them. */}
        {lastDiscards && lastDiscards.discarded.length > 0 && (
          <div style={{
            marginBottom: 12, padding: "8px 12px", border: "1px solid var(--border)",
            borderLeft: "3px solid #B5443B", borderRadius: 8, background: "var(--surface)", fontSize: 12.5,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <span>
                <b>{lastDiscards.discarded.length} saved as Bad Lead</b>
                <span style={{ color: "var(--muted)" }}>
                  {" — "}{summarizeDiscards(lastDiscards.discarded).map((g) => `${g.count} ${g.reason.toLowerCase()}`).join(" · ")}
                  {lastDiscards.sizeUnknown.length > 0 && ` · ${lastDiscards.sizeUnknown.length} kept with no headcount on file`}
                </span>
              </span>
              <span style={{ display: "flex", gap: 4 }}>
                <button className="btn btn-sm btn-ghost" onClick={() => setShowDiscardNames((v) => !v)}>{showDiscardNames ? "Hide names" : "Show names"}</button>
                <button className="btn btn-sm btn-ghost" onClick={() => { setLastDiscards(null); setShowDiscardNames(false); }}>Dismiss</button>
              </span>
            </div>
            {showDiscardNames && summarizeDiscards(lastDiscards.discarded).map((g) => (
              <div key={g.reason} style={{ marginTop: 6 }}>
                <div style={{ color: "var(--muted)" }}>{g.reason}</div>
                <div style={{ maxHeight: 120, overflowY: "auto" }}>{g.companies.join(" · ")}</div>
              </div>
            ))}
          </div>
        )}

        {/* Per Jack: no per-scanner passwords. The sign-in gate still
            fronts the whole page; these two screens open like any other. */}
        {view === "docs" && <Documentation />}
        {view === "diagnostics" && (
          <Diagnostics leads={leads} apolloIndex={apolloIndex} lists={leadLists}
                       onNavigate={(v) => { if (v === "allleads") { setLeadsStatusEntry(""); setLeadsSequenceEntry(""); setLeadsPresetEntry(""); } setView(v); }} />
        )}
        {view === "home" && (
          <Overview
            leads={leads}
            funnels={funnels}
            historyEntries={historyEntries}
            companyProfiles={companyProfiles}
            rules={routing}
            apolloIndex={apolloIndex}
            onNavigate={setView}
            onOpenStatus={(st) => { setLeadsStatusEntry(st); setLeadsSequenceEntry(""); setLeadsPresetEntry(""); setView("allleads"); }}
            onOpenPreset={(pr) => { setLeadsPresetEntry(pr); setLeadsStatusEntry(""); setLeadsSequenceEntry(""); setView("allleads"); }}
            topPanel={
              <ApolloSyncPanel
                leads={leads}
                apolloIndex={apolloIndex}
                progress={homeCheck}
                error={homeCheckError}
                onRun={runHomeCheck}
                onStop={() => homeCheckAbort.current?.abort()}
                onOpenLeads={() => { setLeadsStatusEntry(""); setLeadsSequenceEntry(""); setLeadsPresetEntry(""); setView("allleads"); }}
              />
            }
          />
        )}
        {(view === "queue" || view === "campaigns") && (
          // Per Jack: "campaigns or sequences can be in apollo queue". The
          // queue (where leads are headed) and the live sequences (how
          // they are doing) are one place now.
          <div className="seg" role="tablist" aria-label="Apollo view" style={{ marginBottom: 12 }}>
            <button role="tab" aria-selected={view === "queue"} className={`seg-btn${view === "queue" ? " active" : ""}`} onClick={() => setView("queue")}>
              Leads in Apollo
            </button>
            <button role="tab" aria-selected={view === "campaigns"} className={`seg-btn${view === "campaigns" ? " active" : ""}`} onClick={() => setView("campaigns")}>
              Sequences{funnels.length > 0 ? ` (${funnels.length})` : ""}
            </button>
          </div>
        )}
        {view === "queue" && (
          // Per Jack: "the apollo queue isnt what i want … i want to be able
          // to see if a lead is active in apollo from here and if so which
          // sequence", and "i dont want to push the leads over". Read-only.
          <ApolloStatus leads={leads} apolloIndex={apolloIndex} rosterPulledAt={rosterPulledAt} onPullApollo={pullApollo} onCheckLeads={checkLeadsLive} lists={leadLists} onAddToList={addExportRowsToLists} />
        )}
        {(view === "allleads" || view === "library") && (
          // The Lead library lives inside All leads now. Per Jack: "re do
          // lead libary and build it into all leads". Every lead the
          // Library ever filed is already in the lead store, so the table
          // IS the library; the month files stay one tab over, unchanged,
          // so nothing already filed or downloaded from them is stranded.
          <div className="seg" role="tablist" aria-label="All leads view" style={{ marginBottom: 12 }}>
            <button role="tab" aria-selected={view === "allleads"} className={`seg-btn${view === "allleads" ? " active" : ""}`} onClick={() => setView("allleads")}>
              Leads{leads.length > 0 ? ` (${leads.length.toLocaleString()})` : ""}
            </button>
            <button role="tab" aria-selected={view === "library"} className={`seg-btn${view === "library" ? " active" : ""}`} onClick={() => setView("library")}>
              Monthly files{libraryEntries.length > 0 ? ` (${libraryEntries.length})` : ""}
            </button>
          </div>
        )}
        {view === "allleads" && (
          <AllLeads
            key={`leads-${leadsSequenceEntry}-${leadsStatusEntry}-${leadsPresetEntry}`}
            leads={leads}
            companyProfiles={companyProfiles}
            onApplySync={applySyncFiles}
            apolloIndex={apolloIndex}
            rosterPulledAt={rosterPulledAt}
            onPullApollo={pullApollo}
            onCheckLeads={checkLeadsLive}
            initialSequence={leadsSequenceEntry}
            initialStatus={leadsStatusEntry || undefined}
            initialPreset={leadsPresetEntry || undefined}
            sequenceNames={knownSequences}
            onSetStatus={setLeadStatus}
            funnels={funnels}
            lists={leadLists}
            onAddToList={addExportRowsToLists}
          />
        )}
        {view === "campaigns" && (
          <Campaigns
            leads={leads}
            funnels={funnels}
            onImportFunnels={importFunnelFiles}
            onOpenLeads={(name) => { setLeadsSequenceEntry(name); setLeadsStatusEntry(""); setLeadsPresetEntry(""); setView("allleads"); }}
          />
        )}

        {view === "scanner2" && <Scanner2 key={`smc-${scanEpoch}`} kind="smc" apolloIndex={apolloIndex} lists={leadLists} onAddToList={addExportRowsToLists} onStoreLeads={(rows, k, check) => check ? fileLeadsAndCheck(leadInputsFromRows2(rows, k), "this Custom Scanner upload") : fileLeads(leadInputsFromRows2(rows, k))} onStartOver={() => setScanEpoch((n) => n + 1)} />}
        {view === "scanner3" && <Scanner2 key={`csp-${scanEpoch}`} kind="csp" apolloIndex={apolloIndex} lists={leadLists} onAddToList={addExportRowsToLists} onStoreLeads={(rows, k, check) => check ? fileLeadsAndCheck(leadInputsFromRows2(rows, k), "this CSP Scanner upload") : fileLeads(leadInputsFromRows2(rows, k))} onStartOver={() => setScanEpoch((n) => n + 1)} />}

        {view === "scanner" && (
          <>
            <Scanner
              results={results}
              setResults={setResults}
              uploadedFiles={uploadedFiles}
              setUploadedFiles={setUploadedFiles}
              onReset={() => { setResults(null); setUploadedFiles([]); setLoadedScanStats(null); setPendingMain(null); setMainSaved(null); }}
              libraryEntries={libraryEntries}
              setLibraryEntries={setLibraryEntries}
              libraryGroups={libraryGroups}
              setLibraryGroups={setLibraryGroups}
              onRecordHistory={recordHistory}
              apolloIndex={apolloIndex}
              saveCount={pendingMain ? pendingMain.length : 0}
              savedReport={mainSaved}
              onSaveLeads={saveMainBatch}
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
            onRecordHistory={(...args: Parameters<typeof recordHistory>) => {
              // Uploading into a monthly file is already a deliberate save.
              const entry = recordHistory(...args);
              fileLeads(mainInputsFor(args[0], args[1], args[4]));
              setPendingMain(null);
              return entry;
            }}
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
