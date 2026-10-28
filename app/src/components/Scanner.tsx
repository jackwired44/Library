import { saveReportText, type SaveReport } from "../lib/saveReport";
import { formatCentral } from "../lib/centralTime";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ACTIVE_CATEGORY_KEYS,
  ACTIVE_BUCKET_KEYS,
  CATEGORY_META,
  BUCKET_META,
  EXPORT_LABELS,
  exportRowsForBucket,
  getFullName,
  PERSONAL_PROSPECT_LABEL,
  PRIORITY_META,
  scanParsedFiles,
  sortByDynamicsSeatCount,
  m365SubViewOf,
  M365_SUB_VIEWS,
  M365_SUB_VIEW_META,
  type M365SubView,
  sortTopPriorityFirst,
  topPriorityReason,
  splitLicensingHits,
  type CategoryKey,
  type Disposition,
  type ParsedFile,
  type ResultRow,
  type RuleOverrides,
  type Tier,
  type BucketKey,
  type NoSignalRow,
  type DuplicateRow,
  carryRowEdits,
  countUncarryableEdits,
} from "../lib/detection";
import { dispositionMetaFor, type CustomDisposition } from "../lib/dispositions";
import DispositionOptions from "./DispositionOptions";
import type { CompanyEnrichOutcome } from "../lib/apolloEnrich";
import { downloadCSV, parseCSVFile, parseCSVText } from "../lib/csv";
import { listMatchIndex, listsHolding, type LeadList, type ListPick } from "../lib/leadLists";
import BookedStamp from "./BookedStamp";
import OnCrmBadge from "./OnCrmBadge";
import { apolloHitFor, type ApolloHit, type RosterIndex } from "../lib/apolloRoster";
import TopPriorityBadge from "./TopPriorityBadge";
import {
  getMonthOptionsForFiling,
  getOrCreateGroupByName,
  fileSignalRowsIntoGroup,
  getFolderEntries,
  getCombinedFolderExport,
  persistLibraryEntries,
  persistGroup,
  monthKeyFromDate,
  monthLabelFromKey,
  type LibraryEntry,
  type LibraryGroup,
} from "../lib/library";
import type { HistoryEntry } from "../lib/history";
import { applyStickyState, buildContactIndex, lookupContact, type Contact } from "../lib/contacts";
import { applyCompetitorDQ, type CompanyProfile } from "../lib/companyProfiles";
import { MAX_COMPANY_BATCH } from "../lib/apolloEnrich";
import type { UploadedFile } from "../App";
import type { StoredLead } from "../lib/leadStore";
import { buildSeenIndex, seenFilesFor, seenLabel, type SeenFile } from "../lib/seenBefore";

// Raised from 5. The old cap is what forced Jack to upload 14 CSVs as
// three separate batches — and splitting an upload is exactly what makes
// duplicate detection (which is scoped to one batch) miss repeats that
// span the files, so the batches sum to more leads than the same files
// scanned together. One pass over everything is both faster and more
// correct, so the cap should only be low enough to protect the browser.
const MAX_FILES = 25;
// A ceiling on total rows in one upload, so a mis-picked export can't
// lock the tab up with no way back. Scanning is synchronous, so this is
// the real protection — the file count barely matters next to it.
const MAX_TOTAL_ROWS = 60000;
const MERGED_FILE_NAME = "wired-cio-all-strong-signal-leads.csv";
// Sentinel value for the folder dropdown, distinct from any month key or
// group id.
const NEW_FOLDER_OPTION = "__new_folder__";
const PAGE_SIZE = 25;
const PAGE_SIZE_CHOICES = [25, 50, 100, 250, 500] as const;

// One definition of "which rows are showing", used by both the table and
// every count badge above it. Keeping these in one place is the whole
// point: they drifted apart precisely because the table filtered in one
// function and the badges each counted in their own.
interface Facets {
  tier: Tier | "all";
  category: CategoryKey | "all";
  m365Sub: "all" | M365SubView;
  dynSub: "all" | "businessCentral" | "salesCrm" | "other";
  dupOnly: boolean;
  prioOnly: boolean;
  /** Only leads whose notes state they want a partner (ScanResult.wantsPartner). */
  partnerOnly?: boolean;
  q: string;
  /** Rows to leave out — the ones already in Apollo, when hidden. */
  excludeIds?: Set<string>;
  /** Rows hidden everywhere — table, counts and downloads — because they
   *  are already on a list Jack built. */
  hideIds?: Set<string>;
  /** "Seen before" filter: rows that came in on an earlier file. View only;
   *  downloads always pass "all". */
  seenIds?: Set<string>;
  seenMode?: "all" | "only" | "hide";
}

function applyFacets(rows: ResultRow[], f: Facets): ResultRow[] {
  let list = rows;
  if (f.tier !== "all") list = list.filter((r) => r.tier === f.tier);
  if (f.category !== "all") list = list.filter((r) => r.category === f.category);
  // Sub-views are children of their category — they only narrow anything
  // while that category is the active filter, same as in the UI.
  if (f.category === "m365Tenant" && f.m365Sub !== "all") {
    list = list.filter((r) => m365SubViewOf(r) === f.m365Sub);
  }
  if (f.category === "dynamics365" && f.dynSub !== "all") {
    list = list.filter((r) => {
      if (f.dynSub === "businessCentral") return r.isBusinessCentral;
      if (f.dynSub === "salesCrm") return r.isSalesCrm;
      return !r.isBusinessCentral && !r.isSalesCrm;
    });
  }
  if (f.dupOnly) list = list.filter((r) => r.isDuplicate);
  if (f.prioOnly) list = list.filter((r) => r.priority);
  // A row restored from History before this field existed reads as its
  // ⚑ badge (isPartnerSeeking), never as a guess.
  if (f.partnerOnly) list = list.filter((r) => r.wantsPartner ?? r.isPartnerSeeking);
  if (f.excludeIds?.size) list = list.filter((r) => !f.excludeIds!.has(r.id));
  if (f.hideIds?.size) list = list.filter((r) => !f.hideIds!.has(r.id));
  if (f.seenMode === "only") list = list.filter((r) => !!f.seenIds?.has(r.id));
  if (f.seenMode === "hide" && f.seenIds?.size) list = list.filter((r) => !f.seenIds!.has(r.id));
  const q = f.q.trim().toLowerCase();
  if (q) {
    list = list.filter((r) => {
      const rf = r.row.__f;
      return (
        String(rf.company || "").toLowerCase().includes(q) ||
        getFullName(rf).toLowerCase().includes(q) ||
        r.categories.join(" ").toLowerCase().includes(q) ||
        (r.notesSummary || "").toLowerCase().includes(q)
      );
    });
  }
  return list;
}

const TIER_CYCLE: Tier[] = ["signal", "mention", "dq"];

interface ScannerProps {
  /** Rows waiting for Save, 0 when nothing is pending. */
  saveCount?: number;
  /** What the last Save stored, or null before one. */
  savedReport?: SaveReport | null;
  onSaveLeads?: (checkInApollo?: boolean) => void;
  /** Who is already in Apollo, from imported syncs. See lib/apolloRoster. */
  apolloIndex?: RosterIndex | null;
  results: ResultRow[] | null;
  setResults: React.Dispatch<React.SetStateAction<ResultRow[] | null>>;
  uploadedFiles: UploadedFile[];
  setUploadedFiles: (files: UploadedFile[]) => void;
  onReset: () => void;
  libraryEntries: LibraryEntry[];
  setLibraryEntries: React.Dispatch<React.SetStateAction<LibraryEntry[]>>;
  libraryGroups: LibraryGroup[];
  setLibraryGroups: React.Dispatch<React.SetStateAction<LibraryGroup[]>>;
  // Every fresh scan/import is recorded to History automatically (unlike
  // the Library, which is opt-in) — see CLAUDE.md "History". Returns the
  // created entry so a Library-save right after can stamp its rows with
  // the REAL History entry id (see handleFiles below) instead of a
  // throwaway one.
  onRecordHistory: (
    parsedFiles: ParsedFile[],
    scanned: ResultRow[],
    tag?: string,
    duplicatesRemoved?: number,
    dropped?: { noSignalRows?: NoSignalRow[]; duplicateRows?: DuplicateRow[] },
    // Set when a post-scan add/remove re-scans this same batch, so its
    // existing entry is superseded rather than joined by a second one.
    replaceId?: string | null
  ) => HistoryEntry;
  // Dropped rows for a batch loaded in from History or the Lead Library —
  // Scanner sets its own on a fresh upload, but those paths bypass it.
  loadedDropped?: { noSignalRows: NoSignalRow[]; duplicateRows: DuplicateRow[] } | null;
  // Edits made to a row loaded FROM History (tagged with __sourceEntryId —
  // see lib/history.ts) get written back to the History entry it came from.
  // A no-op for an ordinary fresh-scan row.
  onSyncToHistory: (row: ResultRow, opts?: { syncContact?: boolean }) => void;
  // Full History — the
  // High Priority panel on the landing screen searches every past upload,
  // since a priority lead can be tagged long after its own batch scrolled
  // out of "recent."
  allHistory: HistoryEntry[];
  ruleOverrides: RuleOverrides;
  // Read-only here — used only to carry a person's sticky crossedOut/
  // disposition forward onto their freshly scanned row (see
  // lib/contacts.ts's applyStickyState and CLAUDE.md "Sticky crossed-out/
  // disposition state"). Never written to directly from Scanner; the
  // actual Contact write-back still goes through onRecordHistory/
  // onSyncToHistory, same as before.
  contacts: Contact[];
  // Set only when results were just loaded in from History (a single
  // reopened entry, or "Combine into Scanner" across several) — Scanner's
  // own lastScanStats below only ever gets set from its OWN upload paths
  // (handleFiles/loadFromLibraryPicker), so without this the stat card and
  // accounting banner silently fell back to the post-filter results.length
  // whenever a batch was reopened from History instead of freshly uploaded.
  loadedScanStats: { rowsScanned: number; duplicatesRemoved: number; largestDuplicateGroup: number } | null;
  // Set when a batch was reopened from a single History entry, so filing
  // it to the Lead Library can stamp the right entry id. Null for a
  // multi-entry combine — the save button then explains why it is off
  // instead of failing silently on a guard.
  loadedHistoryEntryId: string | null;
  // Custom Lead Lists (see CLAUDE.md "Custom Lead Lists") — the bulk-action
  // bar's "+ Add to list" reads existing lists from here and creates/adds
  // through these two, same pattern as every other bulk action.
  leadLists: LeadList[];
  /** Every lead already stored, read-only — for the "Seen before" tag. */
  storedLeads?: StoredLead[];
  // User-defined call dispositions on top of the built-ins (lib/dispositions.ts).
  dispositions: CustomDisposition[];
  // Upload-time Apollo company enrichment (see App.tsx) — toggle, the
  // companies in this batch with no profile yet, and the last run's
  // per-domain outcomes.
  autoEnrichCompanies: boolean;
  onToggleAutoEnrichCompanies: (on: boolean) => void;
  pendingEnrich: { companyName: string; domain: string }[];
  // Enriched company profiles, so a competitor industry disqualifies a
  // freshly-scanned row immediately (see applyCompetitorDQ).
  companyProfiles: CompanyProfile[];
  companyEnrichOutcomes: CompanyEnrichOutcome[] | null;
  companyEnriching: boolean;
  onRunCompanyEnrichment: () => void;
  onAddSelectedToList: (rows: ResultRow[], opts: { existingId?: string; newName?: string }) => { listId: string; added: number } | null;
}

/** The post-scan "File Strong Signal leads into … Save to Lead Library" row. */
const SHOW_LIBRARY_FILING = false as boolean;
/** The landing screen's "re-scan a monthly file" picker and History pointer. */
const SHOW_RESCAN_PICKER = false as boolean;

export default function Scanner({
  results,
  setResults,
  uploadedFiles,
  setUploadedFiles,
  onReset,
  libraryEntries,
  setLibraryEntries,
  libraryGroups,
  setLibraryGroups,
  onRecordHistory,
  saveCount = 0,
  savedReport = null,
  onSaveLeads,
  apolloIndex = null,
  loadedDropped,
  onSyncToHistory,
  allHistory,
  ruleOverrides,
  contacts,
  loadedScanStats,
  loadedHistoryEntryId,
  leadLists,
  storedLeads,
  onAddSelectedToList,
  dispositions,
  autoEnrichCompanies,
  onToggleAutoEnrichCompanies,
  pendingEnrich,
  companyProfiles,
  companyEnrichOutcomes,
  companyEnriching,
  onRunCompanyEnrichment,
}: ScannerProps) {
  // Per-bucket download file name — editable, defaults to the standard
  // wired-cio-<bucket>-leads.csv name until Jack renames it. Reset on
  // "Start over" via `reset()` below, same as every other per-batch choice.
  const [bucketFileNames, setBucketFileNames] = useState<Record<BucketKey, string>>({ m365Tenant: "", dynamics: "", dataPlatform: "" });
  // Save-to-Lead-Library moved from a pre-upload checkbox to a post-scan
  // action — per Jack: "i want to be able to store strong signals in
  // files after theyre scan... put it after so i can store after
  // uploading." Decide once results are actually visible, not before.
  const [uploadMonthKey, setUploadMonthKey] = useState(() => monthKeyFromDate(new Date()));
  const [newFolderName, setNewFolderName] = useState("");
  const [filedNotice, setFiledNotice] = useState<string | null>(null);
  // The History entry this exact batch was recorded under — needed so a
  // later "Save to Lead Library" click can correctly link
  // StoredRow.__historyEntryId back to it (see CLAUDE.md's History-linked
  // bug fix). Set once per scan (handleFiles/loadFromLibraryPicker), used
  // by saveStrongSignalToLibrary below.
  const [currentHistoryEntryId, setCurrentHistoryEntryId] = useState<string | null>(null);
  // Filing appends rows with no dedupe against what's already there (see
  // lib/library.ts's fileSignalRowsIntoGroup) — a second click for the
  // same batch would create real duplicate rows in the Library file, so
  // this batch's filing is one-shot: disabled once filed, reset on a
  // fresh upload/reset.
  const [libraryFiledForBatch, setLibraryFiledForBatch] = useState(false);
  // Which product line's filename is being edited, if any — keeps the
  // rename field out of the downloads strip until it is wanted.
  const [renamingBucket, setRenamingBucket] = useState<BucketKey | null>(null);
  // Per Jack: the panels above the table "should be dropdown so the leads
  // below that are scanned can take up more page". Counts and downloads stay
  // in one bar; the rest folds. Open/closed is a per-browser preference.
  const [detailsOpen, setDetailsOpen] = useState<boolean>(() => { try { return localStorage.getItem("scanDetailsOpen") === "1"; } catch { return false; } });
  // Per Jack: "I want it to recognize [duplicates] for input reasons so I
  // know it's being mapped properly scanned and processed" — the raw row
  // count read from the uploaded file(s), straight from scanParsedFiles,
  // so the stat row can show a full accounting instead of only the subset
  // that cleared detection. Kept as its own state (not derived from
  // uploadedFiles) since scanParsedFiles is the one source of truth for
  // both numbers together.
  // When this batch was scanned, shown in Central (the platform clock).
  const [scannedAt, setScannedAt] = useState<Date | null>(null);
  const [lastScanStats, setLastScanStats] = useState<{ rowsScanned: number; duplicatesRemoved: number; largestDuplicateGroup: number } | null>(null);
  // Adopts App.tsx's loadedScanStats whenever it changes (a fresh reopen/
  // combine from History) — a plain upload sets lastScanStats directly via
  // handleFiles/loadFromLibraryPicker instead, so this only ever fires for
  // the History-load path. See CLAUDE.md "Rows scanned accounting" for the
  // bug this closes (Jack: "rows scanned... might not be accurate").
  useEffect(() => {
    if (loadedScanStats) setLastScanStats(loadedScanStats);
  }, [loadedScanStats]);
  // Same adopt pattern for a reopened batch's dropped rows, so the two
  // audit tabs work on a batch loaded from History or the Lead Library,
  // not only on a fresh upload.
  // The folder picker lists EXISTING folders by group id and only offers a
  // month key for a month that has no folder yet. Month folders are
  // auto-seeded on load, so the current month almost always already has
  // one — which meant the default state value (a month key) matched no
  // option at all. A controlled <select> with an unmatched value falls
  // back to displaying its first option, so the picker read "May 2026"
  // while the state still said September: clicking Save without touching
  // the dropdown filed into a different folder than the one on screen.
  // Normalizing the key to the real group id keeps what is shown and what
  // is saved the same thing. Safe against looping: once it holds a group
  // id it is already a valid option and this does nothing.
  useEffect(() => {
    if (uploadMonthKey === NEW_FOLDER_OPTION) return;
    if (libraryGroups.some((g) => g.id === uploadMonthKey)) return;
    const label = monthLabelFromKey(uploadMonthKey);
    const existing = libraryGroups.find((g) => g.name === label);
    if (existing) setUploadMonthKey(existing.id);
  }, [libraryGroups, uploadMonthKey]);

  useEffect(() => {
    if (!loadedDropped) return;
    setNoSignalRows(loadedDropped.noSignalRows);
    setDuplicateRows(loadedDropped.duplicateRows);
    setDroppedView("none");
  }, [loadedDropped]);
  // Same adopt pattern for the reopened batch's History entry id.
  useEffect(() => {
    if (loadedHistoryEntryId) setCurrentHistoryEntryId(loadedHistoryEntryId);
    // A batch reopened from History is a different batch, so the
    // one-shot "already filed" flag has to clear with it. Without this it
    // stayed set from whatever was filed earlier in the session and the
    // Save button sat permanently disabled on "✓ Filed" for every batch
    // opened afterwards.
    setLibraryFiledForBatch(false);
  }, [loadedHistoryEntryId]);
  const [tierFilter, setTierFilter] = useState<Tier | "all">("signal");
  // "Non Relevant" — per Jack: "i want to be able to review every lead if
  // i want to... looking at those [rows] it didn't have a dynamics/m365/
  // azure/licensing signal from, for manual review purposes." These rows
  // never ran through detection at all (scanRowUnified returned null for
  // them), so they're not ResultRows and don't fit the normal tier tabs —
  // tracked separately, read-only, current-batch-only (never persisted
  // into History — see CLAUDE.md, History already keeps every row
  // forever with no cap, and these would only add to that).
  // The batch's raw parsed files, kept so a file can be added or removed
  // after the scan without re-reading anything from disk. Held only while
  // a batch is on screen — reset() drops it, and Scanner unmounts on
  // "Start over", so it does not outlive the results it belongs to.
  const [parsedFiles, setParsedFiles] = useState<ParsedFile[]>([]);
  const [noSignalRows, setNoSignalRows] = useState<NoSignalRow[]>([]);
  const [duplicateRows, setDuplicateRows] = useState<DuplicateRow[]>([]);
  // Which audit tab, if any, replaces the results table. Both are
  // read-only views of rows this batch dropped, so every row read from the
  // file is reachable: processed + no signal + merged duplicates.
  const [droppedView, setDroppedView] = useState<"none" | "noSignal" | "duplicates">("none");
  const [categoryFilter, setCategoryFilter] = useState<CategoryKey | "all">("all");
  const [duplicatesOnly, setDuplicatesOnly] = useState(false);
  const [priorityOnly, setPriorityOnly] = useState(false);
  // Per Jack: "filter by … if someone states they want a partner".
  const [partnerOnly, setPartnerOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZE);
  const [bulkTarget, setBulkTarget] = useState<CategoryKey>("dynamics365");
  const [bulkDisposition, setBulkDisposition] = useState<Disposition>("none");
  const [bulkPriorityMonth, setBulkPriorityMonth] = useState("");
  const [listPickerValue, setListPickerValue] = useState("");
  const [newListName, setNewListName] = useState("");
  const [listNotice, setListNotice] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Separate from fileInputRef: that one is the landing screen's upload,
  // this one adds to a batch already on screen.
  const addFileInputRef = useRef<HTMLInputElement>(null);
  // High Priority panel (landing screen) — filter by which source CSV a
  // priority lead came from; "all" shows every priority lead across all
  // of History, not just the recent-uploads slice.
  const [priorityFileFilter, setPriorityFileFilter] = useState("all");
  // Dynamics numeric sort direction — module-tier grouping (ERP block,
  // then Sales/CRM, then the rest) always stays intact; this only flips
  // which end of the seat-count secondary key comes first within each
  // block. Defaults to Jack's standing rule (greatest to least).
  const [dynamicsSortDesc, setDynamicsSortDesc] = useState(true);
  // Per Jack: "i want to start ranking these." The Main Scanner now ranks by
  // score the way CSP and Custom already do. "scan" keeps the pre-existing
  // order, which is what preserves the documented Dynamics rule (module tier
  // first, then seat count) — that ordering is a locked invariant, so it
  // stays reachable rather than being silently replaced.
  const [sortBy, setSortBy] = useState<"score-desc" | "score-asc" | "scan">("score-desc");
  // A separate tab within the M365/Azure category view for Google->
  // Microsoft migration leads specifically — see CLAUDE.md "Google ->
  // Microsoft view." Purely a view-level split; doesn't touch category,
  // bucket, or export — both tabs still file/download as M365/Azure.
  const [m365SubView, setM365SubView] = useState<"all" | M365SubView>("all");
  // Same pattern, for Business Central/ERP and Sales/CRM within the
  // Dynamics 365 category view — see CLAUDE.md "Business Central view" /
  // "Sales / CRM view." Purely a view-level split; doesn't touch
  // category, bucket, or export — every tab still files/downloads as
  // Dynamics 365. A lead can match both (e.g. "ERP and CRM" together) and
  // show up under both specific tabs; "Everything else" means neither.
  const [dynamicsSubView, setDynamicsSubView] = useState<"all" | "businessCentral" | "salesCrm" | "other">("all");
  // Pull a file already sitting in the Lead Library back into Scanner for a
  // rescan/closer look, without leaving this screen first — per Jack's
  // explicit ask. Reuses the exact same load path Library.tsx's own "Load
  // into Scanner" button already goes through (parse the stored rawText
  // fresh, re-run detection, record as a new History entry); this is just a
  // second entry point onto that same behavior, not a new one.
  const [pickerFolderId, setPickerFolderId] = useState("");
  const [pickerFileKey, setPickerFileKey] = useState("");

  /**
   * The one scan path. A fresh upload and a post-scan add/remove differ
   * only in whether there is previous work to carry and an existing
   * History entry to supersede — everything else about scanning a set of
   * files is identical, so it lives here once.
   */
  function applyScan(
    files: ParsedFile[],
    opts: { carryFrom?: ResultRow[] | null; replaceHistoryId?: string | null } = {}
  ): boolean {
    // Scanning is synchronous, so an oversized set freezes the tab rather
    // than failing — refuse it with a real number instead.
    const totalRows = files.reduce((n, pf) => n + pf.data.length, 0);
    if (totalRows > MAX_TOTAL_ROWS) {
      setError(
        `That's ${totalRows.toLocaleString()} rows across ${files.length} file${files.length === 1 ? "" : "s"} — over the ${MAX_TOTAL_ROWS.toLocaleString()}-row limit for one scan. ` +
        `Split it and combine the batches from History afterwards, which still catches duplicates across them.`
      );
      return false;
    }
    const { results: scanned, rowsScanned, duplicatesRemoved, noSignalRows: skipped, duplicateRows: merged } = scanParsedFiles(files, ruleOverrides);
    applyStickyState(scanned, contacts);
    applyCompetitorDQ(scanned, companyProfiles);
    // LAST, so a manual call outranks anything re-derived above.
    const carried = opts.carryFrom ? carryRowEdits(scanned, opts.carryFrom) : 0;
    setParsedFiles(files);
    setResults(scanned);
    setUploadedFiles(files.map((pf) => ({ name: pf.name, rows: pf.data.length })));
    const largestDuplicateGroup = Math.max(0, ...scanned.map((r) => r.duplicateGroupSize || 0));
    setLastScanStats({ rowsScanned, duplicatesRemoved, largestDuplicateGroup });
    setScannedAt(new Date());
    setNoSignalRows(skipped);
    setDuplicateRows(merged);
    setDroppedView("none");
    setPage(1);
    setSelected(new Set());
    const historyEntry = onRecordHistory(
      files, scanned, "", duplicatesRemoved,
      { noSignalRows: skipped, duplicateRows: merged },
      opts.replaceHistoryId ?? null
    );
    setCurrentHistoryEntryId(historyEntry.id);
    setLibraryFiledForBatch(false);
    if (opts.carryFrom) {
      setFiledNotice(
        `Re-scanned ${files.length} file${files.length === 1 ? "" : "s"} — ${scanned.length.toLocaleString()} rows` +
        (carried ? `, and your edits on ${carried.toLocaleString()} lead${carried === 1 ? "" : "s"} carried across.` : ".")
      );
    }
    // Per Jack: no duplicate (exact name+company match within this same
    // upload) should ever make it into the uploaded leads at all — the
    // first-seen row is kept, every repeat was already merged into it
    // inside scanParsedFiles. Surfaced here so it isn't silent — worded
    // as "recognized and merged" rather than "removed," since nothing is
    // actually lost (a lead that appeared, say, 6 times in the file
    // still ends up as one contact, not zero).
    return true;
  }

  async function handleFiles(fileListLike: FileList | null) {
    const all = Array.from(fileListLike || []).filter((f) => /\.csv$/i.test(f.name));
    if (!all.length) return;
    let files = all;
    let notice: string | null = null;
    if (all.length > MAX_FILES) {
      files = all.slice(0, MAX_FILES);
      notice = `You dropped ${all.length} files — only the first ${MAX_FILES} were scanned. Upload the rest in a second batch, then combine them from History so duplicates across the two are still caught.`;
    }
    setError(notice);
    setFiledNotice(null);
    try {
      applyScan(await Promise.all(files.map(parseCSVFile)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not parse one or more of these files.");
    }
  }

  /**
   * Drop one file from the current batch and re-scan what's left.
   *
   * A re-scan rather than a filter over `sourceFile`, deliberately:
   * duplicate detection is batch-scoped, so a lead that was merged away
   * against a copy in the file being dropped has to come back, and
   * filtering would make it vanish instead.
   */
  function removeUploadedFile(name: string) {
    if (!results || libraryFiledForBatch) return;
    const next = parsedFiles.filter((pf) => pf.name !== name);
    if (!next.length) { reset(); return; }
    const lost = countUncarryableEdits(results);
    if (lost && !window.confirm(
      `Remove "${name}" and re-scan the other ${next.length} file${next.length === 1 ? "" : "s"}?\n\n` +
      `Your edits carry across wherever a lead can be matched by name + company. ` +
      `${lost} edited row${lost === 1 ? " has" : "s have"} no name or company to match on, so ${lost === 1 ? "it" : "they"} will reset.`
    )) return;
    setError(null);
    applyScan(next, { carryFrom: results, replaceHistoryId: currentHistoryEntryId });
  }

  /** Add more files to the batch already on screen, and re-scan the union
   *  — so duplicates ACROSS the old and new files are caught, which is
   *  the whole reason this beats scanning them separately. */
  async function addMoreFiles(fileListLike: FileList | null) {
    if (!results || libraryFiledForBatch) return;
    const picked = Array.from(fileListLike || []).filter((f) => /\.csv$/i.test(f.name));
    if (!picked.length) return;
    const have = new Set(parsedFiles.map((pf) => pf.name));
    const fresh = picked.filter((f) => !have.has(f.name));
    if (!fresh.length) {
      setError(`${picked.length === 1 ? "That file is" : "Those files are"} already in this batch.`);
      return;
    }
    if (parsedFiles.length + fresh.length > MAX_FILES) {
      setError(`That would be ${parsedFiles.length + fresh.length} files — the limit for one scan is ${MAX_FILES}.`);
      return;
    }
    setError(null);
    setFiledNotice(null);
    try {
      const added = await Promise.all(fresh.map(parseCSVFile));
      applyScan([...parsedFiles, ...added], { carryFrom: results, replaceHistoryId: currentHistoryEntryId });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not parse one or more of these files.");
    }
  }

  function reset() {
    onReset();
    setBucketFileNames({ m365Tenant: "", dynamics: "", dataPlatform: "" });
    setLastScanStats(null);
    setScannedAt(null);
    setError(null);
    setSearch("");
    setCategoryFilter("all");
    setTierFilter("signal");
    setDuplicatesOnly(false);
    setPriorityOnly(false);
    setPartnerOnly(false);
    setM365SubView("all");
    setDynamicsSubView("all");
    setParsedFiles([]);
    setNoSignalRows([]);
    setDuplicateRows([]);
    setDroppedView("none");
    setPage(1);
    setSelected(new Set());
    // Saving is an explicit, per-batch choice — never carries over to the
    // next upload (see CLAUDE.md "Library architecture").
    setUploadMonthKey(monthKeyFromDate(new Date()));
    setFiledNotice(null);
    setCurrentHistoryEntryId(null);
    setLibraryFiledForBatch(false);
    setPickerFolderId("");
    setPickerFileKey("");
    // A previously-selected list (or "New list…" name) must never carry
    // over into the next, unrelated upload — otherwise selecting rows in
    // a fresh batch and clicking "Add" without first touching the dropdown
    // would silently file them into whatever list was chosen last time.
    setListPickerValue("");
    setNewListName("");
    setListNotice(null);
  }

  // Private folders are deliberately EXCLUDED from this picker rather than
  // listed-and-blocked. The Lead Library gates a private folder's contents
  // behind its own password (Library.tsx), but this picker loaded any
  // entry's rawText with no such check — so a folder marked private was
  // fully readable from here without ever being asked for the password.
  // A second password prompt in Scanner would be a second gate to keep in
  // step with the first; hiding them keeps ONE way into a private folder,
  // which is the Lead Library, where the prompt already lives.
  const folderOptions = useMemo(
    () => libraryGroups.filter((g) => !g.isPrivate).sort((a, b) => a.name.localeCompare(b.name)),
    [libraryGroups]
  );
  const hiddenPrivateFolders = useMemo(() => libraryGroups.filter((g) => g.isPrivate).length, [libraryGroups]);
  const folderFileOptions = useMemo(() => {
    if (!pickerFolderId) return [];
    return getFolderEntries(libraryEntries, pickerFolderId).filter((e) => e.rowCount > 0);
  }, [libraryEntries, pickerFolderId]);

  // Same pipeline handleFiles above uses once it has a ParsedFile — scan,
  // show results, and record a fresh History entry — just starting from a
  // Library file's already-stored rawText instead of a browser File. Never
  // re-files into the Library on load (same as Library.tsx's own "Load
  // into Scanner" — that would just re-save what's already saved).
  function loadFromLibraryPicker() {
    if (!pickerFolderId || !pickerFileKey) return;
    let fileName: string;
    let rawText: string;
    if (pickerFileKey === "__combined__") {
      const folder = libraryGroups.find((g) => g.id === pickerFolderId);
      const combined = getCombinedFolderExport(libraryEntries, pickerFolderId);
      fileName = `${folder?.name || "Lead Library"} — All files.csv`;
      rawText = combined.rawText;
    } else {
      const entry = libraryEntries.find((e) => e.id === pickerFileKey);
      if (!entry) return;
      fileName = entry.fileName;
      rawText = entry.rawText;
    }
    const parsed = parseCSVText(fileName, rawText);
    const { results: scanned, rowsScanned, duplicatesRemoved, noSignalRows: skipped, duplicateRows: merged } = scanParsedFiles([parsed], ruleOverrides);
    applyStickyState(scanned, contacts);
    setResults(scanned);
    setUploadedFiles([{ name: parsed.name, rows: parsed.data.length }]);
    const largestDuplicateGroup = Math.max(0, ...scanned.map((r) => r.duplicateGroupSize || 0));
    setLastScanStats({ rowsScanned, duplicatesRemoved, largestDuplicateGroup });
    setScannedAt(new Date());
    setNoSignalRows(skipped);
    setDuplicateRows(merged);
    setDroppedView("none");
    setPage(1);
    setSelected(new Set());
    const historyEntry = onRecordHistory([parsed], scanned, "", duplicatesRemoved, { noSignalRows: skipped, duplicateRows: merged });
    setCurrentHistoryEntryId(historyEntry.id);
    setLibraryFiledForBatch(false);
    setPickerFolderId("");
    setPickerFileKey("");
  }

  // Files the CURRENT batch's Strong Signal rows into the Lead Library —
  // an explicit, post-scan action (see CLAUDE.md "Save to Lead Library
  // moved after scan") rather than a pre-upload checkbox, so Jack decides
  // after actually seeing the results. One-shot per batch: fileSignalRowsIntoGroup
  // appends with no dedupe, so a second click for the same batch would
  // create real duplicate rows — the button disables itself once filed.
  function saveStrongSignalToLibrary() {
    if (!results || !currentHistoryEntryId || libraryFiledForBatch) return;
    // Per Jack: file into any EXISTING Lead Library folder, or create a new
    // one right here, instead of only ever the month dropdown. A folder he
    // names himself is created as a custom folder so the month-seeding and
    // pruning passes leave it alone.
    const creatingNew = uploadMonthKey === NEW_FOLDER_OPTION;
    const customName = newFolderName.trim();
    if (creatingNew && !customName) {
      setError("Name the new folder before saving to it.");
      return;
    }
    const existingGroup = libraryGroups.find((g) => g.id === uploadMonthKey);
    const monthLabel = creatingNew ? customName : existingGroup ? existingGroup.name : monthLabelFromKey(uploadMonthKey);
    const { groups: groupsWithMonth, group } = getOrCreateGroupByName(libraryGroups, monthLabel, !creatingNew);
    const signalRows = results.filter((r) => r.tier === "signal" && !r.isDuplicate);
    const isNewGroup = groupsWithMonth !== libraryGroups;
    const { entries: nextEntries, touchedIds } = fileSignalRowsIntoGroup(libraryEntries, groupsWithMonth, group.id, signalRows, currentHistoryEntryId);
    setLibraryGroups(groupsWithMonth);
    setLibraryEntries(nextEntries);
    const touchedEntries = nextEntries.filter((e) => touchedIds.includes(e.id));
    Promise.all([isNewGroup ? persistGroup(group) : Promise.resolve(), persistLibraryEntries(touchedEntries)]);
    setFiledNotice(signalRows.length > 0 ? `Filed ${signalRows.length} Strong Signal lead${signalRows.length === 1 ? "" : "s"} into the ${monthLabel} folder.` : "No Strong Signal leads in this batch — nothing to file.");
    setLibraryFiledForBatch(true);
    setError(null);
    setNewFolderName("");
  }

  // Months that do not have a folder yet — the ones worth offering as a
  // month key rather than an existing group id.
  const monthOptionsWithoutFolder = getMonthOptionsForFiling().filter(
    (o) => !libraryGroups.some((g) => g.name === monthLabelFromKey(o.key))
  );

  // Per Jack: "see if any of those have been added in apollo already so i
  // can remove them from the csv". Checked once per batch, against the
  // Apollo roster; hidden from the table and every download by default.
  const [hideInApollo, setHideInApollo] = useState(true);
  const apolloHits = useMemo(() => {
    const m = new Map<string, ApolloHit>();
    if (!results || !apolloIndex) return m;
    for (const r of results) {
      const f = r.row.__f;
      const hit = apolloHitFor({ email: f.email, contact: getFullName(f), company: f.company }, apolloIndex);
      if (hit) m.set(r.id, hit);
    }
    return m;
  }, [results, apolloIndex]);
  const apolloIds = useMemo(() => new Set(apolloHits.keys()), [apolloHits]);
  const apolloByEmail = useMemo(() => [...apolloHits.values()].filter((h) => h.how === "email").length, [apolloHits]);

  // Per Jack: "if i upload a csv to scan i can remove ones i added to a
  // list". Leads on a list he built (smart lists don't count) are hidden
  // from the table, every count and every download, so the numbers on
  // screen always match the file. "off" shows everyone.
  const listIndex = useMemo(() => listMatchIndex(leadLists), [leadLists]);
  const [listHide, setListHideState] = useState<"off" | ListPick>(() => {
    try { return localStorage.getItem("scannerListHide") || "off"; } catch { return "off"; }
  });
  const setListHide = (v: "off" | ListPick) => { setListHideState(v); try { localStorage.setItem("scannerListHide", v); } catch { /* preference only */ } };
  const listHideEff: "off" | ListPick = listHide === "off" || listHide === "any" || listIndex.lists.some((l) => l.id === listHide) ? listHide : "off";
  const listedRows = useMemo(() => {
    const m = new Map<string, string[]>();
    if (!results || (!listIndex.byName.size && !listIndex.byEmail.size)) return m;
    for (const r of results) {
      const f = r.row.__f;
      const on = listsHolding(listIndex, { email: f.email, contact: getFullName(f), company: f.company });
      if (on.length) m.set(r.id, on.map((l) => l.id));
    }
    return m;
  }, [results, listIndex]);
  const hideIds = useMemo(() => {
    if (listHideEff === "off" || !listedRows.size) return undefined;
    const out = new Set<string>();
    for (const [id, ids] of listedRows) if (listHideEff === "any" || ids.includes(listHideEff)) out.add(id);
    return out;
  }, [listedRows, listHideEff]);
  const listedPerList = useMemo(() => {
    const m = new Map<string, number>();
    for (const ids of listedRows.values()) for (const id of ids) m.set(id, (m.get(id) ?? 0) + 1);
    return m;
  }, [listedRows]);

  // Per Jack: "has it been logged by that same contact name in the past so
  // i dont keep importing contacts ... marcus bush was in 10/19 and 10/25".
  // Same email, or same full name at the same company, on an EARLIER file
  // already stored (this upload's own files don't count). Read-only.
  const seenIndex = useMemo(() => buildSeenIndex(storedLeads ?? []), [storedLeads]);
  const seenRows = useMemo(() => {
    const m = new Map<string, SeenFile[]>();
    if (!results || !seenIndex.dates.size) return m;
    const current = new Set(uploadedFiles.map((u) => u.name));
    for (const r of results) {
      const f = r.row.__f;
      const seen = seenFilesFor(seenIndex, { email: f.email, contact: getFullName(f), company: f.company }, current);
      if (seen.length) m.set(r.id, seen);
    }
    return m;
  }, [results, seenIndex, uploadedFiles]);
  const seenIds = useMemo(() => new Set(seenRows.keys()), [seenRows]);
  const [seenMode, setSeenMode] = useState<"all" | "only" | "hide">("all");

  const facets: Facets = {
    tier: tierFilter,
    category: categoryFilter,
    m365Sub: m365SubView,
    dynSub: dynamicsSubView,
    dupOnly: duplicatesOnly,
    prioOnly: priorityOnly,
    partnerOnly,
    q: search,
    hideIds,
    seenIds,
    seenMode,
    // Per Jack: "says 171 strong signal show me 17". Hiding Apollo matches
    // from the TABLE made 154 Strong Signal leads vanish under a tab still
    // counting 171. The table now always shows every lead (each Apollo
    // match carries its "In Apollo" badge); the toggle below only keeps
    // them out of the downloads, which is what it was asked for.
  };

  const filtered = useMemo(() => {
    if (!results) return [];
    const list = applyFacets(results, facets);
    // Always-on: viewing Dynamics 365 leads ranks them by stated seat/user/
    // license count (direction togglable below), regardless of which tier
    // tab is active. Module-tier grouping (ERP block, then Sales/CRM, then
    // the rest) never flips.
    let ranked = categoryFilter === "dynamics365" ? sortByDynamicsSeatCount(list, dynamicsSortDesc) : list;
    // Rank by score, same as the CSP and Custom tabs. A row with NO score —
    // restored from a History entry recorded before scoring existed — sinks
    // in BOTH directions rather than being read as a 0, the same "a missing
    // value doesn't become zero" rule the Dynamics seat sort already
    // follows. Array#sort is stable, so whatever ordering came out of the
    // block above survives inside each score.
    if (sortBy !== "scan") {
      ranked = [...ranked].sort((a, b) => {
        const sa = a.mainScore?.score, sb = b.mainScore?.score;
        if (sa == null || sb == null) return sa == null ? (sb == null ? 0 : 1) : -1;
        return sortBy === "score-desc" ? sb - sa : sa - sb;
      });
    }
    // Top priority above everything, per Jack: a Google Workspace ->
    // Microsoft 365 lead is the first row you see whatever else is on.
    // Stable, so the ranking below it is untouched (and in practice they
    // never overlap - a Google lead is always M365/Azure).
    return sortTopPriorityFirst(ranked);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, tierFilter, categoryFilter, duplicatesOnly, priorityOnly, partnerOnly, search, dynamicsSortDesc, sortBy, m365SubView, dynamicsSubView, hideIds, seenIds, seenMode]);

  // Every count badge is computed with EVERY OTHER active filter applied,
  // but not its own — so the number on a button is exactly how many rows
  // you get when you click it.
  //
  // Before this, each badge used its own arbitrary base: tier counts came
  // off the whole batch (ignoring category, sub-view, search and the two
  // toggles), category and sub-view counts came off tier only, and the
  // Duplicates/Priority counts ignored everything. So searching a name
  // while on Dynamics 365 → Business Central left "Needs review (33)" and
  // "Dynamics 365 (30)" sitting above a four-row table. The numbers were
  // each individually true of some base, just never of what was on screen.
  const counts = useMemo(() => {
    const rows = results || [];
    const n = (o: Partial<Facets>) => applyFacets(rows, { ...facets, ...o }).length;
    const category: Record<string, number> = { all: n({ category: "all" }) };
    (Object.keys(CATEGORY_META) as CategoryKey[]).forEach((k) => { category[k] = n({ category: k }); });
    return {
      tier: {
        signal: n({ tier: "signal" }),
        mention: n({ tier: "mention" }),
        dq: n({ tier: "dq" }),
        total: n({ tier: "all" }),
      },
      category,
      m365Sub: {
        all: n({ category: "m365Tenant", m365Sub: "all" }),
        google: n({ category: "m365Tenant", m365Sub: "google" }),
        migration: n({ category: "m365Tenant", m365Sub: "migration" }),
        other: n({ category: "m365Tenant", m365Sub: "other" }),
      },
      dynSub: {
        all: n({ category: "dynamics365", dynSub: "all" }),
        businessCentral: n({ category: "dynamics365", dynSub: "businessCentral" }),
        salesCrm: n({ category: "dynamics365", dynSub: "salesCrm" }),
        other: n({ category: "dynamics365", dynSub: "other" }),
      },
      duplicates: n({ dupOnly: true }),
      priority: n({ prioOnly: true }),
      partner: n({ partnerOnly: true }),
      seen: n({ seenMode: "only" }),
      notSeen: n({ seenMode: "hide" }),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, tierFilter, categoryFilter, duplicatesOnly, priorityOnly, partnerOnly, search, m365SubView, dynamicsSubView, hideIds, seenIds, seenMode]);

  // The KPI rail describes the BATCH, not the current view — it sits next
  // to "Rows scanned", which is always the whole upload. Wiring it to the
  // facet-aware counts below made it silently drop whenever a category
  // filter or search was active, which reads as leads disappearing.
  const batchTotals = useMemo(() => {
    let signal = 0, mention = 0, dq = 0;
    (results || []).forEach((r) => { if (r.tier === "signal") signal++; else if (r.tier === "dq") dq++; else mention++; });
    return { signal, mention, dq, total: (results || []).length };
  }, [results]);

  const tierCounts = counts.tier;
  const categoryCounts = counts.category;
  const duplicateCount = counts.duplicates;
  const priorityCount = counts.priority;
  const m365SubViewCounts = counts.m365Sub;
  const dynamicsSubViewCounts = counts.dynSub;

  // High Priority panel (landing screen) — every priority lead across all
  // of History, not scoped to the active scan. sourceFile (the actual CSV
  // it came from) drives the file filter, not the History entry's combined
  // fileName, so a multi-file upload still filters per-file correctly.
  const priorityLeads = useMemo(() => {
    const items: { entry: HistoryEntry; row: ResultRow }[] = [];
    allHistory.forEach((h) => h.results.forEach((r) => { if (r.priority) items.push({ entry: h, row: r }); }));
    return items;
  }, [allHistory]);
  const priorityFileOptions = useMemo(() => [...new Set(priorityLeads.map(({ row }) => row.sourceFile))].sort(), [priorityLeads]);
  const filteredPriorityLeads = useMemo(
    () => (priorityFileFilter === "all" ? priorityLeads : priorityLeads.filter(({ row }) => row.sourceFile === priorityFileFilter)),
    [priorityLeads, priorityFileFilter]
  );
  // Read-only lookup for the "On CRM" badge — editing still only happens
  // in ContactDetail.tsx (Contacts/Companies), Scanner just reflects it.
  const contactIndex = useMemo(() => buildContactIndex(contacts), [contacts]);

  // fn mutates `next` in place and returns whichever rows it touched. The
  // touched rows are synced to History AFTER setResults returns, never
  // inside the updater — React 18 StrictMode double-invokes updaters in
  // dev, and a side effect (onSyncToHistory writes to IndexedDB) inside one
  // would silently double-write.
  // Reads `results` directly (a plain prop, always current at the time an
  // event handler runs) rather than a setState functional updater — a
  // functional updater's callback isn't guaranteed to run synchronously
  // for every call in React 18 (confirmed: a second state update fired
  // shortly after a first one to the same state could still be pending
  // when the code right after setResults() ran, silently dropping the
  // onSyncToHistory call that depended on reading its result there).
  // setResults(next) with a plain array avoids that dependency entirely.
  function mutateResults(fn: (list: ResultRow[]) => ResultRow[]) {
    if (!results) return;
    const next = results.map((r) => ({ ...r }));
    const touched = fn(next);
    setResults(next);
    touched.forEach((row) => onSyncToHistory(row));
  }

  function toggleTier(id: string) {
    mutateResults((list) => {
      const row = list.find((r) => r.id === id);
      if (!row) return [];
      row.tier = TIER_CYCLE[(TIER_CYCLE.indexOf(row.tier) + 1) % TIER_CYCLE.length];
      return [row];
    });
  }
  function reassignRow(id: string, category: CategoryKey) {
    mutateResults((list) => {
      const row = list.find((r) => r.id === id);
      if (!row) return [];
      row.category = category;
      return [row];
    });
  }
  function toggleCrossedOut(id: string) {
    mutateResults((list) => {
      const row = list.find((r) => r.id === id);
      if (!row) return [];
      row.crossedOut = !row.crossedOut;
      return [row];
    });
  }
  function setDisposition(id: string, disposition: Disposition) {
    mutateResults((list) => {
      const row = list.find((r) => r.id === id);
      if (!row) return [];
      row.disposition = disposition;
      // Per Jack: "if not interested is selected, cross their name out
      // also automatically, for now." One-way trigger — going back to a
      // different disposition later does NOT auto-uncross; crossedOut
      // stays manual-undo-only otherwise (see the sticky-state feature).
      if (disposition === "not-interested") row.crossedOut = true;
      return [row];
    });
  }
  // Per Jack: "when I select the disposition made I can undo it in case I
  // mistakenly put one down." Reverts disposition + its note back to
  // "none," and — since a "Not interested" pick auto-crosses the row out
  // (see setDisposition above) — also un-crosses it when THAT'S the
  // disposition being undone, so a mistaken click is fully reversed in one
  // action rather than needing a separate trip to the cross-out toggle.
  function undoDisposition(id: string) {
    mutateResults((list) => {
      const row = list.find((r) => r.id === id);
      if (!row) return [];
      const wasNotInterested = row.disposition === "not-interested";
      row.disposition = "none";
      row.dispositionNote = "";
      if (wasNotInterested && row.crossedOut) row.crossedOut = false;
      return [row];
    });
  }
  function setDispositionNote(id: string, note: string) {
    mutateResults((list) => {
      const row = list.find((r) => r.id === id);
      if (!row) return [];
      row.dispositionNote = note;
      return [row];
    });
  }
  function togglePriority(id: string) {
    mutateResults((list) => {
      const row = list.find((r) => r.id === id);
      if (!row) return [];
      row.priority = !row.priority;
      return [row];
    });
  }
  function setPriorityMonth(id: string, month: string) {
    mutateResults((list) => {
      const row = list.find((r) => r.id === id);
      if (!row) return [];
      row.priorityMonth = month || null;
      return [row];
    });
  }
  function toggleSelectRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function moveSelectedTo(category: CategoryKey) {
    if (!selected.size) return;
    mutateResults((list) => list.filter((r) => selected.has(r.id)).map((r) => { r.category = category; return r; }));
    setSelected(new Set());
  }
  function setTierForSelected(tier: Tier) {
    if (!selected.size) return;
    mutateResults((list) => list.filter((r) => selected.has(r.id)).map((r) => { r.tier = tier; return r; }));
    setSelected(new Set());
  }
  function setCrossedOutForSelected(value: boolean) {
    if (!selected.size) return;
    mutateResults((list) => list.filter((r) => selected.has(r.id)).map((r) => { r.crossedOut = value; return r; }));
    setSelected(new Set());
  }
  function setDispositionForSelected(disposition: Disposition) {
    if (!selected.size) return;
    mutateResults((list) =>
      list
        .filter((r) => selected.has(r.id))
        .map((r) => {
          r.disposition = disposition;
          if (disposition === "not-interested") r.crossedOut = true;
          return r;
        })
    );
  }
  function undoDispositionForSelected() {
    if (!selected.size) return;
    mutateResults((list) =>
      list
        .filter((r) => selected.has(r.id))
        .map((r) => {
          const wasNotInterested = r.disposition === "not-interested";
          r.disposition = "none";
          r.dispositionNote = "";
          if (wasNotInterested && r.crossedOut) r.crossedOut = false;
          return r;
        })
    );
  }
  function setPriorityForSelected(value: boolean) {
    if (!selected.size) return;
    mutateResults((list) => list.filter((r) => selected.has(r.id)).map((r) => { r.priority = value; return r; }));
  }
  function setPriorityMonthForSelected(month: string) {
    if (!selected.size || !month) return;
    mutateResults((list) => list.filter((r) => selected.has(r.id)).map((r) => { r.priorityMonth = month; return r; }));
  }
  // Per Jack: "need to be able to add to list from the scanner". The
  // ticked rows when there are any, otherwise everything the table is
  // showing right now (its filters, tab and search applied).
  function addSelectedToList() {
    if (!results) return;
    const isNew = listPickerValue === "__new__";
    if (isNew && !newListName.trim()) return;
    if (!isNew && !listPickerValue) return;
    const rows = selected.size ? results.filter((r) => selected.has(r.id)) : filtered;
    if (!rows.length) return;
    const result = onAddSelectedToList(rows, isNew ? { newName: newListName } : { existingId: listPickerValue });
    if (!result) return;
    const skipped = rows.length - result.added;
    setListNotice(`Added ${result.added} lead${result.added === 1 ? "" : "s"} to the list${skipped > 0 ? ` (${skipped} already there)` : ""}.`);
    setListPickerValue("");
    setNewListName("");
  }

  /**
   * Per Jack: "i want to be able to download the high and medium together
   * when its whats filtered that goes for everything." The downloads now
   * honour whatever the table is filtered to — search, the sub-view tabs,
   * the Duplicates and Priority toggles — instead of always exporting the
   * whole batch.
   *
   * Tier and category are deliberately excluded: the BUTTON picks the
   * category, and the downloads are Strong Signal by definition
   * (exportRowsForBucket filters on it), so leaving the tier tab in would
   * mean sitting on "Needs review" silently emptied every download.
   */
  function bucketRowsFor(bucketKey: BucketKey) {
    const scoped = results ? applyFacets(results, { ...facets, tier: "all", category: "all", seenMode: "all", excludeIds: hideInApollo ? apolloIds : undefined }) : [];
    return exportRowsForBucket(scoped, bucketKey);
  }
  function defaultBucketFileName(bucketKey: BucketKey) {
    return `wired-cio-${BUCKET_META[bucketKey].slug}-leads.csv`;
  }
  function exportBucket(bucketKey: BucketKey) {
    const raw = (bucketFileNames[bucketKey] || defaultBucketFileName(bucketKey)).trim() || defaultBucketFileName(bucketKey);
    const fileName = /\.csv$/i.test(raw) ? raw : `${raw}.csv`;
    downloadCSV(fileName, bucketRowsFor(bucketKey), EXPORT_LABELS);
  }
  // Per Jack: keep the two product-line files exactly as they are, and add
  // one combined file alongside them. Built by concatenating the same
  // per-bucket exports rather than re-deriving from results, so a lead
  // appears in the merged file if and only if it appears in one of the
  // two — the files can never disagree about who qualified.
  function mergedRows() {
    return ACTIVE_BUCKET_KEYS.flatMap((bk) => bucketRowsFor(bk));
  }
  /** Strong Signal rows the downloads would hold with nothing left out. */
  function exportRowsForBucketsCount(scoped: ResultRow[]) {
    return ACTIVE_BUCKET_KEYS.reduce((n, bk) => n + exportRowsForBucket(scoped, bk).length, 0);
  }
  function exportMerged() {
    downloadCSV(MERGED_FILE_NAME, mergedRows(), EXPORT_LABELS);
  }

  if (!results) {
    return (
      <div>
        <div className="page-bar">
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <h2 style={{ margin: 0, fontSize: 16 }}>Main Scanner</h2>
            <span style={{ fontSize: 12.5, color: "var(--muted)" }}>Regular lead exports with a notes column</span>
          </div>
        </div>
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
          onClick={() => fileInputRef.current?.click()}
          style={{
            border: `2px dashed ${dragOver ? "var(--accent)" : "var(--border)"}`,
            background: dragOver ? "#EDF4EF" : "var(--surface)",
            borderRadius: 16,
            padding: "48px 24px",
            textAlign: "center",
            cursor: "pointer",
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            multiple
            style={{ display: "none" }}
            onChange={(e) => handleFiles(e.target.files)}
          />
          <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>Drop CSVs here</div>
          <div style={{ color: "var(--muted)", fontSize: 13 }}>or click to browse · up to {MAX_FILES} files at once</div>
        </div>
        {error && <div style={{ marginTop: 16, color: "#9A5B22" }}>{error}</div>}
        {/* The "Recent uploads" panel that used to sit here was a
            six-item slice of History with a View button. History has the
            same thing for EVERY upload, grouped by month/week/day and
            searchable, so keeping a shorter copy of it on this screen was
            duplication — this points at the real one instead. */}
        {/* Per Jack: "remove this from front of scanners". */}
        {SHOW_RESCAN_PICKER && <>
        <div style={{ marginTop: 14 }}>
          <div>
            <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 6 }}>Or re-scan a monthly file already filed in All leads</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <select
                value={pickerFolderId}
                onChange={(e) => { setPickerFolderId(e.target.value); setPickerFileKey(""); }}
                style={{ flex: "1 1 130px", border: "1px solid var(--border)", borderRadius: 8, padding: "7px 8px", fontSize: 12.5 }}
              >
                <option value="">Folder…</option>
                {folderOptions.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
              <select
                value={pickerFileKey}
                onChange={(e) => setPickerFileKey(e.target.value)}
                disabled={!pickerFolderId}
                style={{ flex: "1 1 130px", border: "1px solid var(--border)", borderRadius: 8, padding: "7px 8px", fontSize: 12.5, background: pickerFolderId ? "var(--surface)" : "var(--surface-sunken)" }}
              >
                <option value="">File…</option>
                {folderFileOptions.length > 1 && <option value="__combined__">All files (combined)</option>}
                {folderFileOptions.map((e) => (
                  <option key={e.id} value={e.id}>{BUCKET_META[e.bucketKey].label} ({e.rowCount})</option>
                ))}
              </select>
              <button
                onClick={loadFromLibraryPicker}
                disabled={!pickerFolderId || !pickerFileKey}
                style={{
                  border: "none",
                  borderRadius: 8,
                  padding: "7px 14px",
                  fontWeight: 700,
                  fontSize: 12.5,
                  whiteSpace: "nowrap",
                  background: pickerFolderId && pickerFileKey ? "var(--accent)" : "var(--surface-sunken)",
                  color: pickerFolderId && pickerFileKey ? "#081E22" : "#B7BEC4",
                  cursor: pickerFolderId && pickerFileKey ? "pointer" : "not-allowed",
                }}
              >
                Load
              </button>
            </div>
            {folderOptions.length === 0 && (
              <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 6 }}>
                {hiddenPrivateFolders > 0
                  ? `No folders available here. ${hiddenPrivateFolders} private folder${hiddenPrivateFolders === 1 ? " is" : "s are"} only openable from the Lead Library, where the password is asked for.`
                  : "No Lead Library folders yet."}
              </div>
            )}
            {folderOptions.length > 0 && hiddenPrivateFolders > 0 && (
              <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 6 }}>
                {hiddenPrivateFolders} private folder{hiddenPrivateFolders === 1 ? "" : "s"} not listed — open those from the Lead Library.
              </div>
            )}
          </div>
        </div>

        <div style={{ marginTop: 12, fontSize: 12.5, color: "var(--muted)" }}>
          Past uploads are in <b>History</b>.
        </div>
        </>}

        {priorityLeads.length > 0 && (
          <div style={{ marginTop: 20, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
              <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 700, textTransform: "uppercase" }}>⭐ High Priority Leads ({filteredPriorityLeads.length})</div>
              {priorityFileOptions.length > 1 && (
                <select
                  value={priorityFileFilter}
                  onChange={(e) => setPriorityFileFilter(e.target.value)}
                  style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "6px 10px", fontSize: 12 }}
                >
                  <option value="all">All upload files</option>
                  {priorityFileOptions.map((f) => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {filteredPriorityLeads.map(({ entry, row }) => {
                const f = row.row.__f;
                return (
                  <div
                    key={`${entry.id}::${row.id}`}
                    style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", background: "#FFF7E5", border: "1px solid #F5DFA0", borderRadius: 10, padding: "9px 12px" }}
                  >
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>
                        {f.company || "—"} <span style={{ fontWeight: 500, color: "#4c6167" }}>· {getFullName(f) || f.email || "—"}</span>
                      </div>
                      <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{row.sourceFile} · {CATEGORY_META[row.category].label}</div>
                    </div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input
                        type="month"
                        value={row.priorityMonth || ""}
                        onChange={(e) => onSyncToHistory({ ...row, priorityMonth: e.target.value || null }, { syncContact: false })}
                        style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "4px 6px", fontSize: 11.5 }}
                      />
                      <button
                        onClick={() => onSyncToHistory({ ...row, priority: false }, { syncContact: false })}
                        title="Unmark High Priority"
                        style={{ border: "1px solid #F0D6D6", background: "var(--surface)", color: "#B5443B", borderRadius: 6, padding: "4px 8px", fontSize: 11.5, whiteSpace: "nowrap" }}
                      >
                        Unmark
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const pageItems = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  // Mass selection. The header checkbox acts on THIS PAGE only — which is
  // why the page size is settable: "select 250 at a time" is expressed by
  // showing 250. Reaching past the page needs the explicit "Select all N
  // matching" link, so a click can never quietly act on rows you haven't
  // seen.
  const pageAllSelected = pageItems.length > 0 && pageItems.every((r) => selected.has(r.id));
  const pageSomeSelected = pageItems.some((r) => selected.has(r.id));
  function toggleSelectPage() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (pageAllSelected) pageItems.forEach((r) => next.delete(r.id));
      else pageItems.forEach((r) => next.add(r.id));
      return next;
    });
  }
  function selectAllMatching() {
    setSelected(new Set(filtered.map((r) => r.id)));
  }

  return (
    <div>
      <div className="page-bar">
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>Main Scanner</h2>
          {scannedAt && <span className="scan-stamp" title="When this batch was scanned. Dates in notes are judged against today in Central.">Scanned {formatCentral(scannedAt)}</span>}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            {uploadedFiles.map((f) => (
              <span key={f.name} className="file-chip">
                <b>{f.name}</b> · {f.rows.toLocaleString()} rows
                {/* Removing the only file is just Start over, so the ✕ is
                    hidden then rather than rendered as a second way to do
                    it. Filed batches can't change: those rows are a copy
                    in the Lead Library and would silently disagree. */}
                {parsedFiles.length > 1 && !libraryFiledForBatch && (
                  <button
                    type="button"
                    className="file-chip-x"
                    aria-label={`Remove ${f.name} and re-scan`}
                    title={`Remove ${f.name} and re-scan the rest`}
                    onClick={() => removeUploadedFile(f.name)}
                  >
                    ✕
                  </button>
                )}
              </span>
            ))}
            {!libraryFiledForBatch && (
              <>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => addFileInputRef.current?.click()}
                  title="Add more CSVs to this batch and re-scan, so duplicates across all of them are caught"
                >
                  + Add files
                </button>
                <input
                  ref={addFileInputRef}
                  type="file"
                  accept=".csv"
                  multiple
                  hidden
                  onChange={(e) => { addMoreFiles(e.target.files); e.target.value = ""; }}
                />
              </>
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {/* Nothing in this upload is in the platform until Save. */}
          {savedReport ? (
            <span style={{ fontSize: 12.5, color: "var(--muted)" }} aria-live="polite">
              {saveReportText(savedReport)}
            </span>
          ) : saveCount > 0 && onSaveLeads ? (
            <>
              <button className="btn btn-primary" aria-label="Save and check in Apollo" onClick={() => onSaveLeads(true)}
                      title="Store every row in All leads, then look each lead up in Apollo (Strong Signal first) to see if it is in a sequence. Read-only; nothing is written to Apollo.">
                Save {saveCount.toLocaleString()} rows & check in Apollo
              </button>
              <button className="btn btn-secondary" aria-label="Save to platform" onClick={() => onSaveLeads(false)}
                      title="Store every row of this upload — contacts, companies, raw and scanned notes, the CSV row and its file — in All leads, without the Apollo check.">
                Save only
              </button>
            </>
          ) : null}
          <button onClick={reset} className="btn btn-secondary">
            Start over
          </button>
        </div>
      </div>

      {/* One actions row. Every row of this batch is already stored in All
          leads; filing here only adds the Strong Signal leads to a monthly
          file. The Apollo look-up toggle sits on the same row. */}
      {SHOW_LIBRARY_FILING && (
      <div className="panel">
        <div className="panel-head" style={{ flexWrap: "wrap", gap: 10 }}>
          {/* Per Jack: "remove this on the scanner page". Every row is already
              stored in All leads, so monthly filing is hidden here; the code
              stays so it can come back without a rebuild of the flow. */}
          {SHOW_LIBRARY_FILING && <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12.5, fontWeight: 600 }}>File Strong Signal leads into</span>
            <select
              value={uploadMonthKey}
              disabled={libraryFiledForBatch}
              onChange={(e) => setUploadMonthKey(e.target.value)}
              className="field"
              style={{ fontWeight: 600 }}
              aria-label="Lead Library folder"
            >
              {libraryGroups.length > 0 && (
                <optgroup label="Existing folders">
                  {libraryGroups.map((g) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </optgroup>
              )}
              {monthOptionsWithoutFolder.length > 0 && (
                <optgroup label="Month folders">
                  {monthOptionsWithoutFolder.map((o) => (
                    <option key={o.key} value={o.key}>{o.label}</option>
                  ))}
                </optgroup>
              )}
              <optgroup label="New">
                <option value={NEW_FOLDER_OPTION}>＋ Create a new folder…</option>
              </optgroup>
            </select>
            {uploadMonthKey === NEW_FOLDER_OPTION && (
              <input
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="New folder name"
                aria-label="New folder name"
                disabled={libraryFiledForBatch}
                className="field"
                style={{ width: 180 }}
              />
            )}
            <button
              onClick={saveStrongSignalToLibrary}
              disabled={libraryFiledForBatch || !currentHistoryEntryId}
              title={!currentHistoryEntryId ? "Combined batches can't be filed as one file — reopen a single upload from History instead." : undefined}
              className="btn btn-primary"
            >
              {libraryFiledForBatch ? "✓ Filed" : "Save to Lead Library"}
            </button>
          </div>}
        </div>
      </div>
      )}

      {error && <div style={{ marginBottom: 16, color: "#9A5B22" }}>{error}</div>}
      {filedNotice && <div style={{ marginBottom: 16, color: "#2CC295", fontWeight: 600 }}>{filedNotice}</div>}

      {(() => {
        // Per Jack: "says all strong signal is 91 but has 887 as the number".
        // The downloads leave out leads already in Apollo; the dropdown in the
        // download bar says how many, so the two numbers never look like a bug.
        const allSignal = results ? exportRowsForBucketsCount(applyFacets(results, { ...facets, tier: "all", category: "all", seenMode: "all" })) : 0;
        const inDownloads = mergedRows().length;
        const leftOut = Math.max(0, allSignal - inDownloads);
        const noSignal = lastScanStats ? Math.max(0, lastScanStats.rowsScanned - lastScanStats.duplicatesRemoved - results.length) : null;
        const n = apolloHits.size;
        const byName = n - apolloByEmail;
        const facts: { key: string; node: React.ReactNode }[] = [];
        if (lastScanStats) {
          facts.push({ key: "processed", node: <>{results.length.toLocaleString()} processed</> });
          facts.push({ key: "nosignal", node: <span title="No Dynamics 365, M365, Azure or licensing language anywhere in the row. Stored in All leads as No signal; listed under Non Relevant.">{(noSignal ?? 0).toLocaleString()} no signal</span> });
          if (lastScanStats.duplicatesRemoved > 0) facts.push({ key: "dupes", node: <span title={`Exact name + company already seen in this upload, merged into the first-seen row${lastScanStats.largestDuplicateGroup > 2 ? `. One lead appeared ${lastScanStats.largestDuplicateGroup} times.` : "."}`}>{lastScanStats.duplicatesRemoved.toLocaleString()} duplicates merged</span> });
        }
        if (n > 0) facts.push({ key: "apollo", node: <>{n.toLocaleString()} already in Apollo ({apolloByEmail.toLocaleString()} by email{byName > 0 ? `, ${byName.toLocaleString()} by name only` : ""})</> });
        if (listedRows.size > 0) facts.push({ key: "listed", node: <span title="Same email, or the same full name at the same company, as a lead on a list you built. Smart lists don't count.">{listedRows.size.toLocaleString()} already on a list{hideIds?.size ? ` (${hideIds.size.toLocaleString()} hidden)` : ""}</span> });
        if (apolloIndex && apolloIndex.size === 0) facts.push({ key: "nocheck", node: <span title="Import an Apollo sync in All leads and every upload is checked against it.">Not checked against Apollo yet</span> });
        if (autoEnrichCompanies && pendingEnrich.length > 0) facts.push({ key: "enrich", node: <>{pendingEnrich.length.toLocaleString()} {pendingEnrich.length === 1 ? "company" : "companies"} to look up</> });
        const stats = [
          { label: "Rows scanned", value: lastScanStats?.rowsScanned ?? results.length, tone: "ink" },
          { label: "Strong Signal", value: batchTotals.signal, tone: "good" },
          { label: "Needs review", value: batchTotals.mention, tone: "warn" },
          { label: "Bad leads", value: batchTotals.dq, tone: "bad" },
        ];
        return (
          <div className="scan-summary" aria-label="Scan summary">
            <div className="scan-summary-top">
              <div className="kpi-row compact" role="list">
                {stats.map((s) => (
                  <div key={s.label} role="listitem" className={`kpi tone-${s.tone}`}>
                    <span className="kpi-value">{s.value.toLocaleString()}</span>
                    <span className="kpi-label">{s.label}</span>
                  </div>
                ))}
              </div>
              {/* Final downloads: one button per product line plus the
                  combined file. The filename editor sits behind ✎. */}
              <div className="dl-strip">
                <span className="dl-title">Download</span>
                {ACTIVE_BUCKET_KEYS.map((bk) => {
                  const count = bucketRowsFor(bk).length;
                  return (
                    <span key={bk} className="dl-item">
                      <button
                        disabled={count === 0}
                        onClick={() => exportBucket(bk)}
                        className="btn btn-sm btn-primary"
                        title={`${count} Strong Signal ${BUCKET_META[bk].label} lead${count === 1 ? "" : "s"} within the filters you have set below \u2014 the tier tabs and the product-line chips excepted, since this button picks those. Search, the View tabs and the Duplicates / Priority toggles all narrow it.`}
                      >
                        ⬇ {BUCKET_META[bk].label}
                        <span className="dl-count">{count}</span>
                      </button>
                      <button
                        className="btn btn-sm btn-ghost dl-edit"
                        aria-label={`Rename the ${BUCKET_META[bk].label} file`}
                        title={`Filename: ${bucketFileNames[bk] || defaultBucketFileName(bk)}`}
                        onClick={() => setRenamingBucket(renamingBucket === bk ? null : bk)}
                      >
                        ✎
                      </button>
                    </span>
                  );
                })}
                <span className="dl-item">
                  <button disabled={inDownloads === 0} onClick={exportMerged} className="btn btn-sm btn-secondary"
                          title="Both product lines in one file: the same leads as the two buttons beside it.">
                    ⬇ All Strong Signal
                    <span className="dl-count">{inDownloads}</span>
                  </button>
                </span>
                {n > 0 && (
                  <select className="field dl-apollo" aria-label="Leads already in Apollo" value={hideInApollo ? "out" : "in"}
                          onChange={(e) => setHideInApollo(e.target.value === "out")}
                          title="Every lead stays in the table and in All leads. This only decides whether the Apollo matches go into the CSV downloads.">
                    <option value="out">Leave out {n.toLocaleString()} already in Apollo{hideInApollo && leftOut > 0 ? ` (${leftOut.toLocaleString()} Strong Signal)` : ""}</option>
                    <option value="in">Include {n.toLocaleString()} already in Apollo</option>
                  </select>
                )}
                {listedRows.size > 0 && (
                  <select className="field dl-apollo" aria-label="Leads already on a list" value={listHideEff}
                          onChange={(e) => setListHide(e.target.value)}
                          title="Leads you already put on a list you built (smart lists don't count). Hiding them takes them out of the table, the counts and the downloads.">
                    <option value="off">Show {listedRows.size.toLocaleString()} already on a list</option>
                    <option value="any">Hide {listedRows.size.toLocaleString()} on any list</option>
                    {listIndex.lists.filter((l) => listedPerList.has(l.id)).map((l) => (
                      <option key={l.id} value={l.id}>Hide {listedPerList.get(l.id)!.toLocaleString()} on {l.name}{l.status === "cycled" ? " (cycled)" : ""}</option>
                    ))}
                  </select>
                )}
              </div>
            </div>
            <details className="scan-fold" open={detailsOpen}
                       onToggle={(e) => { const o = (e.target as HTMLDetailsElement).open; setDetailsOpen(o); try { localStorage.setItem("scanDetailsOpen", o ? "1" : "0"); } catch { /* preference only */ } }}>
                <summary>
                  <span className="scan-fold-label">Scan details</span>
                  {facts.length > 0 && (
                    <span className="scan-fold-facts">
                      {facts.map((f, i) => <span key={f.key}>{i > 0 && <span className="sep"> · </span>}{f.node}</span>)}
                    </span>
                  )}
                </summary>
                <div className="scan-fold-body">
                  <label className="scan-line" style={{ display: "flex", alignItems: "center", gap: 7 }}
                         title="Companies already covered by an imported Apollo export attach automatically. This also offers a live Apollo look-up for the ones that aren't, after each upload. Nothing runs without your click.">
                    <input type="checkbox" checked={autoEnrichCompanies} onChange={(e) => onToggleAutoEnrichCompanies(e.target.checked)} />
                    Offer Apollo company look-up after each upload
                  </label>
                  {leftOut > 0 && (
                    <p className="scan-line" aria-label="Left out of downloads">
                      Downloads hold <strong>{inDownloads.toLocaleString()}</strong> of {allSignal.toLocaleString()} Strong Signal leads.{" "}
                      <strong>{leftOut.toLocaleString()}</strong> {leftOut === 1 ? "is" : "are"} left out because {leftOut === 1 ? "it is" : "they are"} already in Apollo. Change it with the dropdown beside Download.
                    </p>
                  )}
                  {apolloIndex && apolloIndex.size === 0 && (
                    <p className="scan-line">Import an Apollo sync in All leads and every upload is checked against it.</p>
                  )}
                  {autoEnrichCompanies && (
                    <div className="scan-enrich">
                      <div className="scan-enrich-head">Apollo company look-up</div>
                      {pendingEnrich.length > 0 ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                          <span>
                            <strong>{pendingEnrich.length}</strong> compan{pendingEnrich.length === 1 ? "y" : "ies"} in this upload {pendingEnrich.length === 1 ? "has" : "have"} no
                            Apollo data yet. Enriching {pendingEnrich.length === 1 ? "it" : "them"} uses up to{" "}
                            <strong>{Math.min(pendingEnrich.length, MAX_COMPANY_BATCH)} credit{Math.min(pendingEnrich.length, MAX_COMPANY_BATCH) === 1 ? "" : "s"}</strong> (none for any not found
                            {pendingEnrich.length > MAX_COMPANY_BATCH ? `; first ${MAX_COMPANY_BATCH} per click` : ""}).
                          </span>
                          <button onClick={onRunCompanyEnrichment} disabled={companyEnriching} className="btn btn-sm btn-primary">
                            {companyEnriching ? "Enriching…" : `Enrich ${Math.min(pendingEnrich.length, MAX_COMPANY_BATCH)} now`}
                          </button>
                          <span className="muted" style={{ fontSize: 11.5 }}>
                            {pendingEnrich.slice(0, 6).map((p) => p.companyName).join(" · ")}{pendingEnrich.length > 6 ? ` · +${pendingEnrich.length - 6} more` : ""}
                          </span>
                        </div>
                      ) : (
                        <div className="muted">
                          {companyEnrichOutcomes ? "Every company in this upload has been checked." : "Every company in this upload already has Apollo data on file (or no work-email domain to look it up by)."}
                        </div>
                      )}
                      {companyEnrichOutcomes && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 12, marginTop: 6 }}>
                          {companyEnrichOutcomes.map((o) => (
                            <div key={o.domain} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                              <span style={{ fontWeight: 600, minWidth: 180 }}>{o.domain}</span>
                              {o.status === "found" && <span style={{ color: "var(--success)", fontWeight: 700 }}>✓ Found — {[o.fields?.industry, o.fields?.employees && `${o.fields.employees} employees`, [o.fields?.city, o.fields?.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ") || "profile saved"}</span>}
                              {o.status === "not-found" && <span className="muted">No Apollo record (0 credits)</span>}
                              {o.status === "error" && <span style={{ color: "#B5443B" }}>Error — {o.errorMessage}</span>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </details>
          </div>
        );
      })()}
      {renamingBucket && (
        <div className="dl-rename">
          <span className="rd-label" style={{ marginBottom: 0 }}>{BUCKET_META[renamingBucket].label} filename</span>
          <input
            value={bucketFileNames[renamingBucket]}
            onChange={(e) => setBucketFileNames((prev) => ({ ...prev, [renamingBucket]: e.target.value }))}
            placeholder={defaultBucketFileName(renamingBucket)}
            className="field"
            style={{ flex: "1 1 240px", height: 30 }}
          />
          <button className="btn btn-sm btn-secondary" onClick={() => setRenamingBucket(null)}>Done</button>
        </div>
      )}

      {/* One filter toolbar, hairline-divided rows (see styles.css's
          "Scanner UI kit") — previously four loosely-spaced rows across two
          bordered containers. Every control below keeps its exact prior
          handler and state; only the markup/classes changed. */}
      <div className="toolbar">
        <div className="toolbar-row">
          <div className="seg">
            {(["signal", "mention", "dq"] as const).map((t) => (
              <button
                key={t}
                onClick={() => { setTierFilter(t); setDroppedView("none"); setPage(1); }}
                className={`seg-btn${droppedView === "none" && tierFilter === t ? " active" : ""}`}
              >
                {t === "signal" ? `Strong Signal (${tierCounts.signal})` : t === "mention" ? `Needs review (${tierCounts.mention})` : `Bad Leads (${tierCounts.dq})`}
              </button>
            ))}
            <button
              onClick={() => { setTierFilter("all"); setDroppedView("none"); setPage(1); }}
              className={`seg-btn${droppedView === "none" && tierFilter === "all" ? " active" : ""}`}
            >
              All ({tierCounts.total})
            </button>
          </div>
          {noSignalRows.length > 0 && (
            <button
              onClick={() => setDroppedView("noSignal")}
              title="Rows with no Dynamics 365/M365/Azure/licensing signal at all — never scored, kept here for manual review only"
              className={`chip-btn${droppedView === "noSignal" ? " active" : ""}`}
            >
              Non Relevant ({noSignalRows.length})
            </button>
          )}
          {duplicateRows.length > 0 && (
            <button
              onClick={() => setDroppedView("duplicates")}
              title="Repeats of a lead already in this batch (same name + company). The strongest copy was kept; these were merged into it."
              className={`chip-btn${droppedView === "duplicates" ? " active" : ""}`}
            >
              Merged duplicates ({duplicateRows.length})
            </button>
          )}
          <div className="toolbar-spacer" />
          {duplicateCount > 0 && (
            <button
              onClick={() => setDuplicatesOnly((v) => !v)}
              className="btn btn-sm"
              style={{
                background: duplicatesOnly ? "#F7B955" : "#FBF3E7",
                color: "#8A5A00",
                borderColor: "#F0D9B5",
                fontWeight: 700,
              }}
            >
              {duplicatesOnly ? "Showing duplicates only" : `Duplicates (${duplicateCount})`}
            </button>
          )}
          {priorityCount > 0 && (
            <button
              onClick={() => setPriorityOnly((v) => !v)}
              className="btn btn-sm"
              style={{
                background: priorityOnly ? "#F7B955" : "#FFF7E5",
                color: "#8A5A00",
                borderColor: "#F5DFA0",
                fontWeight: 700,
              }}
            >
              {priorityOnly ? "Showing priority only" : `⭐ Priority (${priorityCount})`}
            </button>
          )}
          <button
            onClick={() => setPartnerOnly((v) => !v)}
            className="btn btn-sm"
            aria-pressed={partnerOnly}
            title="Leads whose notes say they want to work with a partner, MSP or CSP. Same rule as the ⚑ partner tag; never a lead that wants to buy direct."
            style={{
              background: partnerOnly ? "var(--accent)" : "var(--surface)",
              color: partnerOnly ? "#fff" : "var(--accent)",
              borderColor: "var(--accent)",
              fontWeight: 700,
            }}
          >
            {partnerOnly ? `Showing wants a partner (${counts.partner})` : `⚑ Wants a partner (${counts.partner})`}
          </button>
          {seenIds.size > 0 && (
            <select className="field" aria-label="Seen before" value={seenMode} onChange={(e) => setSeenMode(e.target.value as "all" | "only" | "hide")}
              title="Leads that already came in on an earlier file: same email, or same full name at the same company. Filters the table only; downloads are unchanged."
              style={{ fontWeight: 600 }}>
              <option value="all">Seen before: show all</option>
              <option value="only">↺ Only seen before ({counts.seen})</option>
              <option value="hide">Hide seen before ({counts.notSeen} new)</option>
            </select>
          )}
        </div>

        {droppedView === "none" && (
          <>
            <div className="toolbar-row">
              <span className="toolbar-label">Product line</span>
              <button
                onClick={() => setCategoryFilter("all")}
                className={`chip-btn${categoryFilter === "all" ? " active" : ""}`}
              >
                All ({categoryCounts.all})
              </button>
              {ACTIVE_CATEGORY_KEYS.map((k) => (
                <button
                  key={k}
                  onClick={() => setCategoryFilter(k)}
                  className={`chip-btn${categoryFilter === k ? " active" : ""}`}
                >
                  {CATEGORY_META[k].label} ({categoryCounts[k] || 0})
                </button>
              ))}
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                title={"How the table is ranked. Score is the 0-100 lead score shown in the Priority column.\n\nTop priority leads (Google → Microsoft, a confirmed partner ask) always sit above everything regardless of this setting.\n\nScan order keeps the Dynamics module/seat-count ranking."}
                className="field"
                style={{ fontWeight: 600, color: "var(--muted)" }}
              >
                <option value="score-desc">Score: high to low</option>
                <option value="score-asc">Score: low to high</option>
                <option value="scan">Scan order</option>
              </select>
              {categoryFilter === "dynamics365" && sortBy === "scan" && (
                <select
                  value={dynamicsSortDesc ? "desc" : "asc"}
                  onChange={(e) => setDynamicsSortDesc(e.target.value === "desc")}
                  title="Seat count order within each module block (ERP block always ranks above Sales/CRM, regardless of this setting)"
                  className="field"
                  style={{ fontWeight: 600, color: "var(--muted)" }}
                >
                  <option value="desc">Seat count: greatest to least</option>
                  <option value="asc">Seat count: least to greatest</option>
                </select>
              )}
              <input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder="Search company, contact, or product line…"
                className="field"
                style={{ flex: "1 1 200px", minWidth: 180, marginLeft: "auto" }}
              />
            </div>

            {categoryFilter === "m365Tenant" && (
              <div className="toolbar-row">
                <span className="toolbar-label">View</span>
                {(
                  [
                    ["all", `All M365/Azure (${m365SubViewCounts.all})`, "Every M365 / Azure lead, however it qualified."],
                    ...M365_SUB_VIEWS.map((k) => [
                      k,
                      `${M365_SUB_VIEW_META[k].label} (${m365SubViewCounts[k]})`,
                      M365_SUB_VIEW_META[k].hint,
                    ] as const),
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setM365SubView(key)}
                    title="Still files/downloads as M365/Azure either way — this only changes what's shown here."
                    className={`chip-btn${m365SubView === key ? " active" : ""}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}

            {categoryFilter === "dynamics365" && (
              <div className="toolbar-row">
                <span className="toolbar-label">View</span>
                {(
                  [
                    ["all", `All Dynamics 365 (${dynamicsSubViewCounts.all})`],
                    ["businessCentral", `Business Central / ERP (${dynamicsSubViewCounts.businessCentral})`],
                    ["salesCrm", `Sales / CRM / Customer Service (${dynamicsSubViewCounts.salesCrm})`],
                    ["other", `Everything else (${dynamicsSubViewCounts.other})`],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setDynamicsSubView(key)}
                    title="Still files/downloads as Dynamics 365 either way — this only changes what's shown here."
                    className={`chip-btn${dynamicsSubView === key ? " active" : ""}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {droppedView === "noSignal" ? (
        <NonRelevantTable rows={noSignalRows} />
      ) : droppedView === "duplicates" ? (
        <MergedDuplicatesTable rows={duplicateRows} />
      ) : (
      <>

      <div className="list-strip" role="group" aria-label="Add to list">
        <span className="bulkbar-label">Add to list</span>
        <select value={listPickerValue} onChange={(e) => setListPickerValue(e.target.value)} className="field" aria-label="Choose a list" style={{ maxWidth: 220 }}>
          <option value="">Choose a list…</option>
          {leadLists.map((l) => (
            <option key={l.id} value={l.id}>{l.name} ({l.rows.length})</option>
          ))}
          <option value="__new__">+ New list…</option>
        </select>
        {listPickerValue === "__new__" && (
          <input
            type="text"
            placeholder="List name"
            aria-label="New list name"
            value={newListName}
            onChange={(e) => setNewListName(e.target.value)}
            className="field"
            style={{ width: 170 }}
          />
        )}
        <button
          onClick={addSelectedToList}
          disabled={!listPickerValue || (listPickerValue === "__new__" && !newListName.trim()) || (!selected.size && !filtered.length)}
          className="btn btn-sm btn-primary"
          title={selected.size ? "Adds the ticked leads" : "Nothing ticked, so this adds every lead the table is showing"}
        >
          {selected.size ? `Add ${selected.size.toLocaleString()} selected` : `Add all ${filtered.length.toLocaleString()} shown`}
        </button>
        {listNotice && <span style={{ fontSize: 12, color: "var(--ink-2)" }}>{listNotice}</span>}
      </div>

      {selected.size > 0 && (
        <div className="bulkbar">
          <span className="bulkbar-count">{selected.size} lead{selected.size === 1 ? "" : "s"} selected</span>
          {pageAllSelected && selected.size < filtered.length && (
            <button className="bulkbar-selectall" onClick={selectAllMatching}>
              Select all {filtered.length.toLocaleString()} matching
            </button>
          )}
          {selected.size > 0 && (
            <button className="bulkbar-selectall" onClick={() => setSelected(new Set())}>Clear</button>
          )}
          <div className="bulkbar-divider" />
          <span className="bulkbar-label">Move to</span>
          <select value={bulkTarget} onChange={(e) => setBulkTarget(e.target.value as CategoryKey)} className="field">
            {ACTIVE_CATEGORY_KEYS.map((k) => (
              <option key={k} value={k}>{CATEGORY_META[k].label}</option>
            ))}
          </select>
          <button onClick={() => moveSelectedTo(bulkTarget)} className="btn btn-sm btn-primary">Apply</button>
          <div className="bulkbar-divider" />
          <span className="bulkbar-label">Tier</span>
          <button onClick={() => setTierForSelected("signal")} className="btn btn-sm btn-primary">Strong Signal</button>
          <button onClick={() => setTierForSelected("mention")} className="btn btn-sm" style={{ color: "#9A5B22", borderColor: "#E7C79A" }}>Needs review</button>
          <button onClick={() => setTierForSelected("dq")} className="btn btn-sm btn-danger">Bad lead</button>
          <button onClick={() => setCrossedOutForSelected(true)} className="btn btn-sm btn-secondary">Cross out</button>
          <button onClick={() => setCrossedOutForSelected(false)} className="btn btn-sm btn-ghost" style={{ textDecoration: "underline" }}>Restore</button>
          <div className="bulkbar-divider" />
          <span className="bulkbar-label">Disposition</span>
          <select value={bulkDisposition} onChange={(e) => setBulkDisposition(e.target.value as Disposition)} className="field">
            <DispositionOptions dispositions={dispositions} />
          </select>
          <button onClick={() => setDispositionForSelected(bulkDisposition)} className="btn btn-sm btn-primary">Apply</button>
          <button onClick={undoDispositionForSelected} title="Undo disposition on selected rows" className="btn btn-sm btn-secondary">↺ Undo</button>
          <div className="bulkbar-divider" />
          <span className="bulkbar-label">Priority</span>
          <button onClick={() => setPriorityForSelected(true)} className="btn btn-sm btn-warn">⭐ Mark</button>
          <button onClick={() => setPriorityForSelected(false)} className="btn btn-sm btn-secondary">Unmark</button>
          <input type="month" value={bulkPriorityMonth} onChange={(e) => setBulkPriorityMonth(e.target.value)} className="field" />
          <button onClick={() => setPriorityMonthForSelected(bulkPriorityMonth)} className="btn btn-sm btn-secondary">Apply month</button>
          <div className="toolbar-spacer" />
          <button onClick={() => { setSelected(new Set()); setListNotice(null); }} className="btn btn-sm btn-ghost" style={{ textDecoration: "underline" }}>Clear selection</button>
        </div>
      )}

      <div className="table-card">
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: 32 }}>
                <input
                  type="checkbox"
                  aria-label={pageAllSelected ? "Clear selection on this page" : "Select every lead on this page"}
                  title={pageAllSelected ? "Clear this page's selection" : `Select all ${pageItems.length} on this page`}
                  checked={pageAllSelected}
                  ref={(el) => { if (el) el.indeterminate = !pageAllSelected && pageSomeSelected; }}
                  onChange={toggleSelectPage}
                  disabled={pageItems.length === 0}
                />
              </th>
              <th>Company</th>
              <th>Contact</th>
              <th>Detected</th>
              <th>Notes</th>
              <th>Tier</th>
              <th>Priority</th>
              <th>Product line</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {pageItems.length === 0 ? (
              <tr><td colSpan={10} className="cell-empty">No rows match this filter.</td></tr>
            ) : (
              pageItems.map((r) => {
                const f = r.row.__f;
                const meta = CATEGORY_META[r.category];
                const tierColor = r.tier === "signal" ? "#2CC295" : r.tier === "dq" ? "#B5443B" : "#9A5B22";
                const tierBg = r.tier === "signal" ? "#E7F1EA" : r.tier === "dq" ? "#FBEAE8" : "#FBEBDD";
                const tierLabel = r.tier === "signal" ? "Strong Signal" : r.tier === "dq" ? "Bad lead" : "Needs review";
                const strike = r.crossedOut ? { textDecoration: "line-through", color: "#9AA6A5" } : {};
                const matchedContact = lookupContact(contactIndex, getFullName(f), String(f.company || "").trim(), String(f.email || "").trim());
                return (
                  <tr
                    key={r.id}
                    style={{
                      borderBottom: "1px solid var(--border)",
                      background: r.isDuplicate
                        ? "#FFFBF2"
                        : r.disposition === "meeting-booked"
                          ? dispositionMetaFor("meeting-booked", dispositions).bg
                          : r.disposition === "not-interested"
                            ? dispositionMetaFor("not-interested", dispositions).bg
                            : undefined,
                    }}
                  >
                    <td style={{ textAlign: "center" }}>
                      <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleSelectRow(r.id)} />
                    </td>
                    <td style={{ padding: "10px 11px", fontWeight: 600, minWidth: 128 }}>
                      {r.disposition === "meeting-booked" && <BookedStamp />}
                      <div style={strike}>{f.company || "—"}</div>
                    </td>
                    <td style={{ padding: "10px 11px", minWidth: 104, whiteSpace: "nowrap", ...strike }}>
                      {getFullName(f) || f.email || "—"} {matchedContact?.onCrm && <OnCrmBadge />}
                      {apolloHits.get(r.id) && (
                        <span className="pill" style={{ marginLeft: 6, fontSize: 11, color: "#9A5B22", background: "#FBF0E2" }}
                              title={`Already in Apollo (matched by ${apolloHits.get(r.id)!.how === "email" ? "email" : "name only — check"})${apolloHits.get(r.id)!.sequences.length ? `\n${apolloHits.get(r.id)!.sequences.join("\n")}` : ""}`}>
                          In Apollo{apolloHits.get(r.id)!.how === "name" ? "?" : ""}
                        </span>
                      )}
                      {listedRows.get(r.id) && (
                        <span className="pill" data-on-list style={{ marginLeft: 6, fontSize: 11, color: "var(--ink-2)", background: "var(--surface-sunken)" }}
                              title={`Already on: ${listedRows.get(r.id)!.map((id) => listIndex.lists.find((l) => l.id === id)?.name || "a list").join(", ")}`}>
                          On a list
                        </span>
                      )}
                      {seenRows.get(r.id) && (
                        <span className="pill" data-seen-before style={{ marginLeft: 6, fontSize: 11, color: "#5B4A9A", background: "#EFEBFA" }}
                              title={`Already came in on:\n${seenRows.get(r.id)!.map((s) => `${s.file}${s.date ? ` (${s.date})` : ""}`).join("\n")}`}>
                          ↺ Seen {seenLabel(seenRows.get(r.id)!)}
                        </span>
                      )}
                    </td>
                    <td style={{ padding: "10px 11px" }}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {topPriorityReason(r) && <TopPriorityBadge reason={topPriorityReason(r)!} />}
                        {r.isDuplicate && <span style={{ fontSize: 10.5, background: "#F7B955", color: "#5C3A00", padding: "2px 7px", borderRadius: 20, fontWeight: 700 }}>DUPLICATE</span>}
                        {/* What the ROW wrote, not the catalogue's name for it, and
                            each count beside the product it was actually found next
                            to - per Jack, "use the info given".
                            Capped at SKU_CHIPS_SHOWN with the rest folded into a
                            "+N" pill that lists them on hover: a licence inventory
                            seven deep buried the reason to call. Nothing is
                            dropped, and none of this touches qualification. */}
                        {(() => {
                          if (!r.licensing) return null;
                          const { shown, hidden } = splitLicensingHits(r.licensing.hits);
                          return (
                            <>
                              {shown.map((h, i) => (
                                <span
                                  key={`${h.matched}-${i}`}
                                  title={h.count != null
                                    ? `The row says "${h.matched}" with ${h.count} beside it.`
                                    : `The row says "${h.matched}". No count stated next to it.`}
                                  style={{ fontSize: 10.5, background: "#FBF0DC", color: "#8A5A00", padding: "2px 7px", borderRadius: 20 }}
                                >
                                  {h.matched}{h.count != null ? ` · ${h.count}` : ""}
                                </span>
                              ))}
                              {hidden.length > 0 && (
                                <span
                                  title={`Also named in this row:\n${hidden.map((h) => `• ${h.matched}${h.count != null ? ` · ${h.count}` : ""}`).join("\n")}`}
                                  style={{ fontSize: 10.5, background: "var(--surface-sunken)", color: "var(--muted)", padding: "2px 7px", borderRadius: 20, cursor: "help" }}
                                >
                                  +{hidden.length}
                                </span>
                              )}
                            </>
                          );
                        })()}
                        {r.categories.filter((ck) => !(ck === "m365Tenant" && r.licensing)).map((ck) => (
                          <span key={ck} style={{ fontSize: 10.5, background: CATEGORY_META[ck].bg, color: CATEGORY_META[ck].color, padding: "2px 7px", borderRadius: 20 }}>
                            {CATEGORY_META[ck].label}{ck === "dynamics365" && r.dynamicsSeatCount != null ? ` · ${r.dynamicsSeatCount}` : ""}
                          </span>
                        ))}
                        {r.isPersonalProspect && (
                          <span title="Personal/free email domain, but the row's own content already cleared Strong Signal — carved out of Auto-DQ instead of being a flat Bad Lead." style={{ fontSize: 10.5, background: "#DFF3F1", color: "#0F7A72", padding: "2px 7px", borderRadius: 20, fontWeight: 700 }}>
                            {PERSONAL_PROSPECT_LABEL}
                          </span>
                        )}
                        {r.tier === "dq" && r.dqReasons.map((reason) => (
                          <span key={reason} style={{ fontSize: 10.5, background: "#FBEAE8", color: "#B5443B", padding: "2px 7px", borderRadius: 20 }}>{reason}</span>
                        ))}
                      </div>
                    </td>
                    <td style={{ padding: "10px 11px", color: "var(--muted)", fontSize: 12.5, minWidth: 190, maxWidth: 280 }}>
                      <span className="clamp-3" title={r.notesSummary}>{r.notesSummary}</span>
                    </td>
                    <td style={{ padding: "10px 11px" }}>
                      <button onClick={() => toggleTier(r.id)} style={{ border: "none", borderRadius: 20, padding: "4px 10px", fontWeight: 700, fontSize: 11.5, whiteSpace: "nowrap", color: tierColor, background: tierBg }}>{tierLabel}</button>
                    </td>
                    {/* The band and the 0-100 score, built from the Strong
                        Signal indicators the scan already computed. Display
                        and ranking only - priorityOf keeps High == cleared
                        the promotion gate, so nothing here changes which
                        leads reach the downloads. A row restored from an
                        older History entry has no score yet and reads "-"
                        rather than a fabricated 0. */}
                    <td style={{ padding: "10px 11px", whiteSpace: "nowrap" }}>
                      {/* Per Jack: "put the score now how it is big like for
                          csp." Same shape the CSP and Custom tabs use — the
                          number large and coloured, the band as a small chip
                          under it — so a score reads the same way whichever
                          scanner you are on, and the number is what the eye
                          lands on. The breakdown stays on the number's own
                          tooltip, exactly as CSP has it. */}
                      {r.priorityBand ? (
                        <>
                          <div
                            aria-label="Score"
                            title={r.mainScore
                              ? r.mainScore.breakdown.join("\n")
                              : "Not scored — this row was restored from an older upload, before scoring existed"}
                            style={{ fontWeight: 700, fontSize: 15, lineHeight: 1.1, fontVariantNumeric: "tabular-nums", color: PRIORITY_META[r.priorityBand].color }}
                          >
                            {r.mainScore ? r.mainScore.score : "—"}
                          </div>
                          <div
                            title={PRIORITY_META[r.priorityBand].hint}
                            style={{ display: "inline-block", marginTop: 4, padding: "1px 6px", borderRadius: 999, fontSize: 10, fontWeight: 700, letterSpacing: 0.3, textTransform: "uppercase", color: PRIORITY_META[r.priorityBand].color, background: PRIORITY_META[r.priorityBand].bg }}
                          >
                            {PRIORITY_META[r.priorityBand].short}
                          </div>
                        </>
                      ) : <span style={{ color: "var(--muted)" }}>—</span>}
                    </td>
                    <td style={{ padding: "10px 11px" }}>
                      <select value={r.category} onChange={(e) => reassignRow(r.id, e.target.value as CategoryKey)} style={{ background: meta.bg, color: meta.color, fontWeight: 600, border: "1px solid var(--border)", borderRadius: 7, padding: "6px 8px" }}>
                        {ACTIVE_CATEGORY_KEYS.map((k) => (
                          <option key={k} value={k}>{CATEGORY_META[k].label}</option>
                        ))}
                      </select>
                    </td>
                    <td style={{ padding: "10px 11px" }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 132 }}>
                        <div style={{ display: "flex", gap: 4 }}>
                          <select
                            value={r.disposition}
                            onChange={(e) => setDisposition(r.id, e.target.value as Disposition)}
                            style={{ flex: 1, background: dispositionMetaFor(r.disposition, dispositions).bg, color: dispositionMetaFor(r.disposition, dispositions).color, fontWeight: 600, border: "1px solid var(--border)", borderRadius: 7, padding: "5px 7px", fontSize: 12 }}
                          >
                            <DispositionOptions dispositions={dispositions} />
                          </select>
                          {r.disposition !== "none" && (
                            <button
                              onClick={() => undoDisposition(r.id)}
                              title="Undo disposition (mistakenly selected)"
                              style={{ border: "1px solid var(--border)", background: "#fff", borderRadius: 7, padding: "0 7px", fontSize: 13, cursor: "pointer" }}
                            >
                              ↺
                            </button>
                          )}
                        </div>
                        {r.disposition !== "none" && (
                          <input
                            defaultValue={r.dispositionNote}
                            onBlur={(e) => setDispositionNote(r.id, e.target.value)}
                            placeholder="Note"
                            style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "4px 6px", fontSize: 11.5 }}
                          />
                        )}
                        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                          <button
                            onClick={() => togglePriority(r.id)}
                            title={r.priority ? "Unmark High Priority" : "Mark High Priority"}
                            style={{ border: "1px solid #F5DFA0", background: r.priority ? "#F7B955" : "#FFF7E5", color: "#8A5A00", borderRadius: 6, padding: "3px 7px", fontSize: 11.5, fontWeight: 700 }}
                          >
                            ⭐
                          </button>
                          {r.priority && (
                            <input
                              type="month"
                              value={r.priorityMonth || ""}
                              onChange={(e) => setPriorityMonth(r.id, e.target.value)}
                              style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "3px 5px", fontSize: 11 }}
                            />
                          )}
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: "10px 11px", textAlign: "center" }}>
                      <button
                        onClick={() => toggleCrossedOut(r.id)}
                        title={r.crossedOut ? "Restore" : "Cross out"}
                        style={{ width: 26, height: 26, borderRadius: 7, border: `1px solid ${r.crossedOut ? "#2CC295" : "#D8DBE1"}`, background: r.crossedOut ? "#E7F5EF" : "#fff" }}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {filtered.length > 0 && (
        <div className="pager">
          <span>Showing {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, filtered.length)} of {filtered.length}</span>
          <label className="pager-size">
            Rows
            <select
              aria-label="Rows per page"
              value={pageSize}
              onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
            >
              {PAGE_SIZE_CHOICES.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <button className="btn btn-sm btn-secondary" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Prev</button>
          <span>Page {currentPage} of {totalPages}</span>
          <button className="btn btn-sm btn-secondary" disabled={currentPage >= totalPages} onClick={() => setPage(currentPage + 1)}>Next</button>
        </div>
      )}
      </>
      )}
    </div>
  );
}

// "Non Relevant" — rows with zero Dynamics 365/M365/Azure/licensing signal
// at all, kept purely so Jack can manually eyeball what got skipped (see
// CLAUDE.md). Deliberately simple and read-only: no tier/category/matched
// snippet (these never ran through detection), no bulk actions, no
// download, no filing — just enough per row to review it and decide by
// hand. Current-batch-only, not retained in History.
// Read-only audit view of the repeats duplicate detection merged away.
// Deliberately no actions on it: these rows were consolidated into a
// surviving lead, so "restoring" one would recreate the duplicate the
// merge exists to prevent. The point is to make the number checkable.
function MergedDuplicatesTable({ rows }: { rows: DuplicateRow[] }) {
  const crossFile = rows.filter((r) => r.sourceFile !== r.mergedIntoSourceFile).length;
  return (
    <div>
      <p className="scan-note" style={{ marginBottom: 10 }}>
        <strong>{rows.length.toLocaleString()}</strong> row{rows.length === 1 ? " was" : "s were"} recognized as a repeat of a
        lead already in this upload (exact name + company match) and merged into it — not discarded.
        {crossFile > 0 && <> <strong>{crossFile.toLocaleString()}</strong> of them came from a different file than the copy that was kept, which is what makes a combined upload smaller than the sum of its parts.</>}
        {" "}The copy kept is the strongest one in the batch, not whichever happened to be uploaded first.
      </p>
      <div className="table-card">
        <table className="data-table">
          <thead>
            <tr>
              <th>Company</th>
              <th>Contact</th>
              <th>Title</th>
              <th>Email</th>
              <th>Phone</th>
              <th>From file</th>
              <th>Merged into copy from</th>
              <th>Times seen</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.company || "—"}</td>
                <td>{r.contact || "—"}</td>
                <td>{r.title || "—"}</td>
                <td>{r.email || "—"}</td>
                <td>{r.phone || "—"}</td>
                <td>{r.sourceFile}</td>
                <td>{r.mergedIntoSourceFile}</td>
                <td>{r.groupSize}×</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function NonRelevantTable({ rows }: { rows: NoSignalRow[] }) {
  return (
    <div>
      <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 12 }}>
        {rows.length} row{rows.length === 1 ? "" : "s"} matched no Dynamics 365/M365/Azure/licensing signal at all — never scored, so there's no tier or product line to show. For manual review only; not downloaded, filed, or kept in History.
      </div>
      <div className="table-card" style={{ maxHeight: 560 }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Company</th>
              <th>Contact</th>
              <th>Title</th>
              <th>Email</th>
              <th>Phone</th>
              <th>Notes</th>
              <th>Source file</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={{ padding: "9px 12px", fontWeight: 600 }}>{r.company || "—"}</td>
                <td style={{ padding: "9px 12px" }}>{r.contact || "—"}</td>
                <td style={{ padding: "9px 12px", color: "var(--muted)" }}>{r.title || "—"}</td>
                <td style={{ padding: "9px 12px" }}>{r.email || "—"}</td>
                <td style={{ padding: "9px 12px" }}>{r.phone || "—"}</td>
                <td style={{ padding: "9px 12px", maxWidth: 340, color: "var(--muted)", fontSize: 12 }} title={r.notes || undefined}>
                  {r.notesSummary || r.notes ? (
                    <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {r.notesSummary || r.notes}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td style={{ padding: "9px 12px", color: "var(--muted)", fontSize: 12 }}>{r.sourceFile}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
