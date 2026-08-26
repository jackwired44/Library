import { useMemo, useRef, useState } from "react";
import {
  ACTIVE_CATEGORY_KEYS,
  ACTIVE_BUCKET_KEYS,
  CATEGORY_META,
  BUCKET_META,
  DISPOSITION_META,
  DISPOSITION_ORDER,
  EXPORT_LABELS,
  exportRowsForBucket,
  getFullName,
  PERSONAL_PROSPECT_LABEL,
  scanParsedFiles,
  sortByDynamicsSeatCount,
  type CategoryKey,
  type Disposition,
  type ParsedFile,
  type ResultRow,
  type RuleOverrides,
  type Tier,
  type BucketKey,
} from "../lib/detection";
import { downloadCSV, parseCSVFile, parseCSVText } from "../lib/csv";
import BookedStamp from "./BookedStamp";
import OnCrmBadge from "./OnCrmBadge";
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
import type { UploadedFile } from "../App";

const MAX_FILES = 5;
const PAGE_SIZE = 25;
const TIER_CYCLE: Tier[] = ["signal", "mention", "dq"];

interface ScannerProps {
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
  onRecordHistory: (parsedFiles: ParsedFile[], scanned: ResultRow[]) => HistoryEntry;
  // Edits made to a row loaded FROM History (tagged with __sourceEntryId —
  // see lib/history.ts) get written back to the History entry it came from.
  // A no-op for an ordinary fresh-scan row.
  onSyncToHistory: (row: ResultRow) => void;
  // Shown on the empty/upload screen so a recent batch is one click away
  // without switching to the History tab first.
  recentUploads: HistoryEntry[];
  onOpenRecentUpload: (id: string) => void;
  // Full History (not just the 6-most-recent recentUploads slice) — the
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
}

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
  onSyncToHistory,
  recentUploads,
  onOpenRecentUpload,
  allHistory,
  ruleOverrides,
  contacts,
}: ScannerProps) {
  // Per-bucket download file name — editable, defaults to the standard
  // wired-cio-<bucket>-leads.csv name until Jack renames it. Reset on
  // "Start over" via `reset()` below, same as every other per-batch choice.
  const [bucketFileNames, setBucketFileNames] = useState<Record<BucketKey, string>>({ m365Tenant: "", dynamics: "", dataPlatform: "" });
  const [saveToLibrary, setSaveToLibrary] = useState(false);
  const [uploadMonthKey, setUploadMonthKey] = useState(() => monthKeyFromDate(new Date()));
  const [filedNotice, setFiledNotice] = useState<string | null>(null);
  const [dedupeNotice, setDedupeNotice] = useState<string | null>(null);
  const [tierFilter, setTierFilter] = useState<Tier | "all">("signal");
  const [categoryFilter, setCategoryFilter] = useState<CategoryKey | "all">("all");
  const [duplicatesOnly, setDuplicatesOnly] = useState(false);
  const [priorityOnly, setPriorityOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkTarget, setBulkTarget] = useState<CategoryKey>("dynamics365");
  const [bulkDisposition, setBulkDisposition] = useState<Disposition>("none");
  const [bulkPriorityMonth, setBulkPriorityMonth] = useState("");
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // High Priority panel (landing screen) — filter by which source CSV a
  // priority lead came from; "all" shows every priority lead across all
  // of History, not just the recent-uploads slice.
  const [priorityFileFilter, setPriorityFileFilter] = useState("all");
  // Dynamics numeric sort direction — module-tier grouping (ERP block,
  // then Sales/CRM, then the rest) always stays intact; this only flips
  // which end of the seat-count secondary key comes first within each
  // block. Defaults to Jack's standing rule (greatest to least).
  const [dynamicsSortDesc, setDynamicsSortDesc] = useState(true);
  // A separate tab within the M365/Azure category view for Google->
  // Microsoft migration leads specifically — see CLAUDE.md "Google ->
  // Microsoft view." Purely a view-level split; doesn't touch category,
  // bucket, or export — both tabs still file/download as M365/Azure.
  const [m365SubView, setM365SubView] = useState<"all" | "google" | "other">("all");
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

  async function handleFiles(fileListLike: FileList | null) {
    const all = Array.from(fileListLike || []).filter((f) => /\.csv$/i.test(f.name));
    if (!all.length) return;
    let files = all;
    let notice: string | null = null;
    if (all.length > MAX_FILES) {
      files = all.slice(0, MAX_FILES);
      notice = `You dropped ${all.length} files — only the first ${MAX_FILES} were scanned. Upload the rest in a second batch.`;
    }
    setError(notice);
    setFiledNotice(null);
    setDedupeNotice(null);
    try {
      const parsedFiles = await Promise.all(files.map(parseCSVFile));
      const { results: scanned, duplicatesRemoved } = scanParsedFiles(parsedFiles, ruleOverrides);
      applyStickyState(scanned, contacts);
      setResults(scanned);
      setUploadedFiles(parsedFiles.map((pf) => ({ name: pf.name, rows: pf.data.length })));
      setPage(1);
      setSelected(new Set());
      const historyEntry = onRecordHistory(parsedFiles, scanned);
      // Per Jack: no duplicate (exact name+company match within this same
      // upload) should ever make it into the uploaded leads at all — the
      // first-seen row is kept, every repeat was already dropped inside
      // scanParsedFiles. Surfaced here so the removal isn't silent.
      if (duplicatesRemoved > 0) {
        setDedupeNotice(`Removed ${duplicatesRemoved} duplicate lead${duplicatesRemoved === 1 ? "" : "s"} (exact name + company match already seen in this upload).`);
      }

      // Opt-in, off by default (see CLAUDE.md "Library architecture") — a
      // one-off scan never touches the Library unless this box is checked.
      if (saveToLibrary) {
        const monthLabel = monthLabelFromKey(uploadMonthKey);
        const { groups: groupsWithMonth, group } = getOrCreateGroupByName(libraryGroups, monthLabel);
        // A duplicate never gets filed either — same reasoning as the CSV
        // downloads (see exportRowsForBucket): the first-seen row of a
        // duplicate group still files normally, only the repeat(s) don't.
        const signalRows = scanned.filter((r) => r.tier === "signal" && !r.isDuplicate);
        const isNewGroup = groupsWithMonth !== libraryGroups;
        const { entries: nextEntries, touchedIds } = fileSignalRowsIntoGroup(libraryEntries, groupsWithMonth, group.id, signalRows, historyEntry.id);
        setLibraryGroups(groupsWithMonth);
        setLibraryEntries(nextEntries);
        const touchedEntries = nextEntries.filter((e) => touchedIds.includes(e.id));
        await Promise.all([isNewGroup ? persistGroup(group) : Promise.resolve(), persistLibraryEntries(touchedEntries)]);
        setFiledNotice(signalRows.length > 0 ? `Filed ${signalRows.length} Strong Signal lead${signalRows.length === 1 ? "" : "s"} into the ${monthLabel} folder.` : "No Strong Signal leads in this batch — nothing to file.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not parse one or more of these files.");
    }
  }

  function reset() {
    onReset();
    setBucketFileNames({ m365Tenant: "", dynamics: "", dataPlatform: "" });
    setError(null);
    setSearch("");
    setCategoryFilter("all");
    setTierFilter("signal");
    setDuplicatesOnly(false);
    setPriorityOnly(false);
    setM365SubView("all");
    setDynamicsSubView("all");
    setPage(1);
    setSelected(new Set());
    // Saving is an explicit, per-batch choice — never carries over to the
    // next upload (see CLAUDE.md "Library architecture").
    setSaveToLibrary(false);
    setUploadMonthKey(monthKeyFromDate(new Date()));
    setFiledNotice(null);
    setDedupeNotice(null);
    setPickerFolderId("");
    setPickerFileKey("");
  }

  const folderOptions = useMemo(() => [...libraryGroups].sort((a, b) => a.name.localeCompare(b.name)), [libraryGroups]);
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
    const { results: scanned } = scanParsedFiles([parsed], ruleOverrides);
    applyStickyState(scanned, contacts);
    setResults(scanned);
    setUploadedFiles([{ name: parsed.name, rows: parsed.data.length }]);
    setPage(1);
    setSelected(new Set());
    onRecordHistory([parsed], scanned);
    setPickerFolderId("");
    setPickerFileKey("");
  }

  const filtered = useMemo(() => {
    if (!results) return [];
    let list = results;
    if (tierFilter !== "all") list = list.filter((r) => r.tier === tierFilter);
    if (categoryFilter !== "all") list = list.filter((r) => r.category === categoryFilter);
    if (categoryFilter === "m365Tenant" && m365SubView !== "all") {
      list = list.filter((r) => (m365SubView === "google" ? r.isGoogleToMicrosoft : !r.isGoogleToMicrosoft));
    }
    if (categoryFilter === "dynamics365" && dynamicsSubView !== "all") {
      list = list.filter((r) => {
        if (dynamicsSubView === "businessCentral") return r.isBusinessCentral;
        if (dynamicsSubView === "salesCrm") return r.isSalesCrm;
        return !r.isBusinessCentral && !r.isSalesCrm;
      });
    }
    if (duplicatesOnly) list = list.filter((r) => r.isDuplicate);
    if (priorityOnly) list = list.filter((r) => r.priority);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((r) => {
        const f = r.row.__f;
        return (
          String(f.company || "").toLowerCase().includes(q) ||
          getFullName(f).toLowerCase().includes(q) ||
          r.categories.join(" ").toLowerCase().includes(q) ||
          (r.notesSummary || "").toLowerCase().includes(q)
        );
      });
    }
    // Always-on: viewing Dynamics 365 leads ranks them by stated seat/user/
    // license count (direction togglable below), regardless of which tier
    // tab is active. Module-tier grouping (ERP block, then Sales/CRM, then
    // the rest) never flips.
    if (categoryFilter === "dynamics365") list = sortByDynamicsSeatCount(list, dynamicsSortDesc);
    return list;
  }, [results, tierFilter, categoryFilter, duplicatesOnly, priorityOnly, search, dynamicsSortDesc, m365SubView, dynamicsSubView]);

  const tierCounts = useMemo(() => {
    let signal = 0, mention = 0, dq = 0;
    (results || []).forEach((r) => { if (r.tier === "signal") signal++; else if (r.tier === "dq") dq++; else mention++; });
    return { signal, mention, dq, total: (results || []).length };
  }, [results]);

  const categoryCounts = useMemo(() => {
    const base = tierFilter === "all" ? results || [] : (results || []).filter((r) => r.tier === tierFilter);
    const counts: Record<string, number> = { all: base.length };
    (Object.keys(CATEGORY_META) as CategoryKey[]).forEach((k) => { counts[k] = 0; });
    base.forEach((r) => { counts[r.category] = (counts[r.category] || 0) + 1; });
    return counts;
  }, [results, tierFilter]);

  const duplicateCount = useMemo(() => (results || []).filter((r) => r.isDuplicate).length, [results]);
  const priorityCount = useMemo(() => (results || []).filter((r) => r.priority).length, [results]);

  // Counts for the M365/Azure sub-view tabs — same tier-filtered base as
  // categoryCounts above, further narrowed to the M365/Azure category.
  const m365SubViewCounts = useMemo(() => {
    const base = tierFilter === "all" ? results || [] : (results || []).filter((r) => r.tier === tierFilter);
    const m365 = base.filter((r) => r.category === "m365Tenant");
    const google = m365.filter((r) => r.isGoogleToMicrosoft).length;
    return { all: m365.length, google, other: m365.length - google };
  }, [results, tierFilter]);

  // Same, for the Dynamics 365 sub-view tabs.
  const dynamicsSubViewCounts = useMemo(() => {
    const base = tierFilter === "all" ? results || [] : (results || []).filter((r) => r.tier === tierFilter);
    const dynamics = base.filter((r) => r.category === "dynamics365");
    const businessCentral = dynamics.filter((r) => r.isBusinessCentral).length;
    const salesCrm = dynamics.filter((r) => r.isSalesCrm).length;
    const other = dynamics.filter((r) => !r.isBusinessCentral && !r.isSalesCrm).length;
    return { all: dynamics.length, businessCentral, salesCrm, other };
  }, [results, tierFilter]);

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
  function setPriorityForSelected(value: boolean) {
    if (!selected.size) return;
    mutateResults((list) => list.filter((r) => selected.has(r.id)).map((r) => { r.priority = value; return r; }));
  }
  function setPriorityMonthForSelected(month: string) {
    if (!selected.size || !month) return;
    mutateResults((list) => list.filter((r) => selected.has(r.id)).map((r) => { r.priorityMonth = month; return r; }));
  }

  function bucketRowsFor(bucketKey: BucketKey) {
    return exportRowsForBucket(results || [], bucketKey);
  }
  function defaultBucketFileName(bucketKey: BucketKey) {
    return `wired-cio-${BUCKET_META[bucketKey].slug}-leads.csv`;
  }
  function exportBucket(bucketKey: BucketKey) {
    const raw = (bucketFileNames[bucketKey] || defaultBucketFileName(bucketKey)).trim() || defaultBucketFileName(bucketKey);
    const fileName = /\.csv$/i.test(raw) ? raw : `${raw}.csv`;
    downloadCSV(fileName, bucketRowsFor(bucketKey), EXPORT_LABELS);
  }

  if (!results) {
    return (
      <div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12, marginBottom: 16 }}>
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "14px 16px" }}>
            <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 700, textTransform: "uppercase", marginBottom: 10 }}>New upload</div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", marginBottom: 8 }}>
              <input type="checkbox" checked={saveToLibrary} onChange={(e) => setSaveToLibrary(e.target.checked)} />
              Save this batch's Strong Signal leads to the Lead Library
            </label>
            <select
              value={uploadMonthKey}
              disabled={!saveToLibrary}
              onChange={(e) => setUploadMonthKey(e.target.value)}
              style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 8, padding: "7px 10px", fontWeight: 700, background: saveToLibrary ? "var(--surface)" : "var(--surface-sunken)", color: saveToLibrary ? "var(--ink)" : "#B7BEC4" }}
            >
              {getMonthOptionsForFiling().map((o) => (
                <option key={o.key} value={o.key}>{o.label}</option>
              ))}
            </select>
          </div>

          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "14px 16px" }}>
            <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 700, textTransform: "uppercase", marginBottom: 10 }}>Or load from the Lead Library</div>
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
              <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 6 }}>No Lead Library folders yet.</div>
            )}
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
          <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 7 }}>Drop up to {MAX_FILES} lead CSVs here</div>
          <div style={{ color: "var(--muted)", fontSize: 13.5 }}>or click to browse — scanned for licensing AND platform signals in one pass.</div>
        </div>
        {error && <div style={{ marginTop: 16, color: "#9A5B22" }}>{error}</div>}

        {recentUploads.length > 0 && (
          <div style={{ marginTop: 24, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "14px 16px" }}>
            <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 700, textTransform: "uppercase", marginBottom: 10 }}>Recent uploads</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {recentUploads.map((h) => {
                const signalCount = h.results.filter((r) => r.tier === "signal").length;
                return (
                  <button
                    key={h.id}
                    onClick={() => onOpenRecentUpload(h.id)}
                    style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, textAlign: "left", background: "var(--surface-sunken)", border: "1px solid var(--border)", borderRadius: 10, padding: "9px 12px", cursor: "pointer" }}
                  >
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{h.fileName}</span>
                    <span style={{ fontSize: 11.5, color: "var(--muted)", whiteSpace: "nowrap" }}>
                      {new Date(h.importedAt).toLocaleString()} · {h.rowsScanned} rows · {signalCount} Strong Signal
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {priorityLeads.length > 0 && (
          <div style={{ marginTop: 20, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "14px 16px" }}>
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
                        onChange={(e) => onSyncToHistory({ ...row, priorityMonth: e.target.value || null })}
                        style={{ border: "1px solid #D8DBE1", borderRadius: 6, padding: "4px 6px", fontSize: 11.5 }}
                      />
                      <button
                        onClick={() => onSyncToHistory({ ...row, priority: false })}
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

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const pageItems = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ fontSize: 11.5, color: "#8B93A0" }}>
          {uploadedFiles.map((f) => `${f.name} (${f.rows})`).join("  ·  ")}
        </div>
        <button onClick={reset} style={{ border: "1px solid #D5D9E0", background: "#fff", borderRadius: 9, padding: "8px 14px" }}>
          Start over
        </button>
      </div>

      {error && <div style={{ marginBottom: 16, color: "#9A5B22" }}>{error}</div>}
      {filedNotice && <div style={{ marginBottom: 16, color: "#2CC295", fontWeight: 600 }}>{filedNotice}</div>}
      {dedupeNotice && <div style={{ marginBottom: 16, color: "#8A5A00", fontWeight: 600 }}>{dedupeNotice}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 18 }}>
        {[
          { label: "Rows scanned", value: results.length, color: "#1B2430" },
          { label: "Strong Signal", value: tierCounts.signal, color: "#2CC295" },
          { label: "Needs review", value: tierCounts.mention, color: "#9A5B22" },
          { label: "Bad leads", value: tierCounts.dq, color: "#B5443B" },
        ].map((s) => (
          <div key={s.label} style={{ background: "#fff", border: "1px solid #E4E7EC", borderLeft: `3px solid ${s.color}`, borderRadius: 13, padding: "15px 16px" }}>
            <div style={{ fontSize: 11.5, color: "#7C8590", fontWeight: 700, textTransform: "uppercase" }}>{s.label}</div>
            <div style={{ fontSize: 26, fontWeight: 700, color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div style={{ background: "#fff", border: "1px solid #E4E7EC", borderRadius: 13, padding: "18px 19px", marginBottom: 20 }}>
        <div style={{ fontWeight: 700, marginBottom: 12 }}>Final downloads — exactly three, every lead in exactly one</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {ACTIVE_BUCKET_KEYS.map((bk) => {
            const count = bucketRowsFor(bk).length;
            return (
              <div key={bk} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontWeight: 700, minWidth: 190, color: count ? "#081E22" : "#9AA6A5" }}>{BUCKET_META[bk].label} ({count})</span>
                <input
                  value={bucketFileNames[bk]}
                  onChange={(e) => setBucketFileNames((prev) => ({ ...prev, [bk]: e.target.value }))}
                  placeholder={defaultBucketFileName(bk)}
                  style={{ flex: "1 1 220px", border: "1px solid #E1E4E9", borderRadius: 8, padding: "8px 11px", fontSize: 12.5 }}
                />
                <button
                  disabled={count === 0}
                  onClick={() => exportBucket(bk)}
                  style={{
                    background: count ? "#2CC295" : "#E1E5E4",
                    color: count ? "#081E22" : "#9AA6A5",
                    border: `2px solid ${count ? "#2CC295" : "#E1E5E4"}`,
                    borderRadius: 999,
                    padding: "8px 18px",
                    fontWeight: 700,
                    cursor: count ? "pointer" : "not-allowed",
                    whiteSpace: "nowrap",
                  }}
                >
                  ⬇ Download CSV
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 13, padding: "14px 16px 16px", marginBottom: 18 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
        {(["signal", "mention", "dq", "all"] as const).map((t) => (
          <button
            key={t}
            onClick={() => { setTierFilter(t); setPage(1); }}
            style={{
              border: "none",
              borderRadius: 8,
              padding: "7px 13px",
              fontWeight: 600,
              background: tierFilter === t ? "#081E22" : "#E9EBEF",
              color: tierFilter === t ? "#fff" : "#4C6167",
            }}
          >
            {t === "signal" ? `Strong Signal (${tierCounts.signal})` : t === "mention" ? `Needs review (${tierCounts.mention})` : t === "dq" ? `Bad Leads (${tierCounts.dq})` : `All (${tierCounts.total})`}
          </button>
        ))}
        {duplicateCount > 0 && (
          <button
            onClick={() => setDuplicatesOnly((v) => !v)}
            style={{ background: duplicatesOnly ? "#F7B955" : "#FBF3E7", color: "#8A5A00", border: "1px solid #F0D9B5", borderRadius: 9, padding: "7px 13px", fontWeight: 700 }}
          >
            {duplicatesOnly ? "Showing duplicates only" : `Duplicates (${duplicateCount})`}
          </button>
        )}
        {priorityCount > 0 && (
          <button
            onClick={() => setPriorityOnly((v) => !v)}
            style={{ background: priorityOnly ? "#F7B955" : "#FFF7E5", color: "#8A5A00", border: "1px solid #F5DFA0", borderRadius: 9, padding: "7px 13px", fontWeight: 700 }}
          >
            {priorityOnly ? "Showing priority only" : `⭐ Priority (${priorityCount})`}
          </button>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <button
          onClick={() => setCategoryFilter("all")}
          style={{ border: "none", borderRadius: 8, padding: "7px 12px", background: categoryFilter === "all" ? "#081E22" : "#F6FAFA", color: categoryFilter === "all" ? "#fff" : "#4C6167" }}
        >
          All product lines ({categoryCounts.all})
        </button>
        {ACTIVE_CATEGORY_KEYS.map((k) => (
          <button
            key={k}
            onClick={() => setCategoryFilter(k)}
            style={{ border: "none", borderRadius: 8, padding: "7px 12px", background: categoryFilter === k ? "#081E22" : "#F6FAFA", color: categoryFilter === k ? "#fff" : "#4C6167" }}
          >
            {CATEGORY_META[k].label} ({categoryCounts[k] || 0})
          </button>
        ))}
        {categoryFilter === "dynamics365" && (
          <select
            value={dynamicsSortDesc ? "desc" : "asc"}
            onChange={(e) => setDynamicsSortDesc(e.target.value === "desc")}
            title="Seat count order within each module block (ERP block always ranks above Sales/CRM, regardless of this setting)"
            style={{ border: "1px solid #D5D9E0", borderRadius: 9, padding: "7px 10px", fontSize: 12.5, fontWeight: 600, color: "#4C6167" }}
          >
            <option value="desc">Seat count: greatest to least</option>
            <option value="asc">Seat count: least to greatest</option>
          </select>
        )}
        <input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="Filter by company, contact, or product line"
          style={{ flex: "1 1 200px", border: "1px solid #E1E4E9", borderRadius: 9, padding: "8px 12px" }}
        />
      </div>

      {categoryFilter === "m365Tenant" && (
        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 11.5, color: "#8b93a0", fontWeight: 700, textTransform: "uppercase" }}>View:</span>
          {(
            [
              ["all", `All M365/Azure (${m365SubViewCounts.all})`],
              ["google", `Google → Microsoft (${m365SubViewCounts.google})`],
              ["other", `Everything else (${m365SubViewCounts.other})`],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setM365SubView(key)}
              title="Still files/downloads as M365/Azure either way — this only changes what's shown here."
              style={{
                border: "none",
                borderRadius: 8,
                padding: "7px 12px",
                fontSize: 12.5,
                fontWeight: 600,
                background: m365SubView === key ? "#081E22" : "#F6FAFA",
                color: m365SubView === key ? "#fff" : "#4C6167",
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {categoryFilter === "dynamics365" && (
        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 11.5, color: "#8b93a0", fontWeight: 700, textTransform: "uppercase" }}>View:</span>
          {(
            [
              ["all", `All Dynamics 365 (${dynamicsSubViewCounts.all})`],
              ["businessCentral", `Business Central / ERP (${dynamicsSubViewCounts.businessCentral})`],
              ["salesCrm", `Sales / CRM (${dynamicsSubViewCounts.salesCrm})`],
              ["other", `Everything else (${dynamicsSubViewCounts.other})`],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setDynamicsSubView(key)}
              title="Still files/downloads as Dynamics 365 either way — this only changes what's shown here."
              style={{
                border: "none",
                borderRadius: 8,
                padding: "7px 12px",
                fontSize: 12.5,
                fontWeight: 600,
                background: dynamicsSubView === key ? "#081E22" : "#F6FAFA",
                color: dynamicsSubView === key ? "#fff" : "#4C6167",
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      </div>

      {selected.size > 0 && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", background: "#EEF2FF", border: "1px solid #D6DEFA", borderRadius: 11, padding: "10px 17px", marginBottom: 14, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 700, color: "#3A4B8C" }}>{selected.size} lead{selected.size === 1 ? "" : "s"} selected</span>
          <span>Move to:</span>
          <select value={bulkTarget} onChange={(e) => setBulkTarget(e.target.value as CategoryKey)}>
            {ACTIVE_CATEGORY_KEYS.map((k) => (
              <option key={k} value={k}>{CATEGORY_META[k].label}</option>
            ))}
          </select>
          <button onClick={() => moveSelectedTo(bulkTarget)} style={{ background: "#2CC295", color: "#081E22", border: "none", borderRadius: 8, padding: "7px 14px", fontWeight: 700 }}>Apply</button>
          <button onClick={() => setTierForSelected("signal")} style={{ background: "#2CC295", color: "#081E22", border: "none", borderRadius: 8, padding: "7px 12px", fontWeight: 700 }}>Strong Signal</button>
          <button onClick={() => setTierForSelected("mention")} style={{ background: "#fff", color: "#9A5B22", border: "1px solid #E7C79A", borderRadius: 8, padding: "7px 12px" }}>Needs review</button>
          <button onClick={() => setTierForSelected("dq")} style={{ background: "#fff", color: "#B5443B", border: "1px solid #F0C6C1", borderRadius: 8, padding: "7px 12px" }}>Bad lead</button>
          <button onClick={() => setCrossedOutForSelected(true)} style={{ background: "#fff", border: "1px solid #D5D9E0", borderRadius: 8, padding: "7px 12px" }}>Cross out</button>
          <button onClick={() => setCrossedOutForSelected(false)} style={{ background: "none", border: "none", textDecoration: "underline" }}>Restore</button>
          <span style={{ width: 1, height: 20, background: "#D6DEFA" }} />
          <span>Disposition:</span>
          <select value={bulkDisposition} onChange={(e) => setBulkDisposition(e.target.value as Disposition)}>
            {DISPOSITION_ORDER.map((d) => (
              <option key={d} value={d}>{DISPOSITION_META[d].label}</option>
            ))}
          </select>
          <button onClick={() => setDispositionForSelected(bulkDisposition)} style={{ background: "#2CC295", color: "#081E22", border: "none", borderRadius: 8, padding: "7px 14px", fontWeight: 700 }}>Apply</button>
          <button onClick={() => setPriorityForSelected(true)} style={{ background: "#FFF7E5", color: "#8A5A00", border: "1px solid #F5DFA0", borderRadius: 8, padding: "7px 12px", fontWeight: 700 }}>⭐ Mark Priority</button>
          <button onClick={() => setPriorityForSelected(false)} style={{ background: "#fff", border: "1px solid #D5D9E0", borderRadius: 8, padding: "7px 12px" }}>Unmark Priority</button>
          <input type="month" value={bulkPriorityMonth} onChange={(e) => setBulkPriorityMonth(e.target.value)} style={{ border: "1px solid #D5D9E0", borderRadius: 8, padding: "6px 8px" }} />
          <button onClick={() => setPriorityMonthForSelected(bulkPriorityMonth)} style={{ background: "#fff", border: "1px solid #D5D9E0", borderRadius: 8, padding: "7px 12px" }}>Apply month</button>
          <button onClick={() => setSelected(new Set())} style={{ background: "none", border: "none", textDecoration: "underline" }}>Clear selection</button>
        </div>
      )}

      <div style={{ background: "#fff", border: "1px solid #E4E7EC", borderRadius: 13, overflow: "auto", maxHeight: "65vh" }}>
        <table>
          <thead>
            <tr style={{ background: "#F9FAFB" }}>
              <th style={{ width: 32 }}></th>
              <th style={{ textAlign: "left", padding: "11px 14px" }}>Company</th>
              <th style={{ textAlign: "left", padding: "11px 14px" }}>Contact</th>
              <th style={{ textAlign: "left", padding: "11px 14px" }}>Detected</th>
              <th style={{ textAlign: "left", padding: "11px 14px" }}>Matched snippet</th>
              <th style={{ textAlign: "left", padding: "11px 14px" }}>Tier</th>
              <th style={{ textAlign: "left", padding: "11px 14px" }}>Product line</th>
              <th style={{ textAlign: "left", padding: "11px 14px" }}>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {pageItems.length === 0 ? (
              <tr><td colSpan={9} style={{ padding: 36, textAlign: "center", color: "#9AA1AC" }}>No rows match this filter.</td></tr>
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
                      borderBottom: "1px solid #F0F1F4",
                      background: r.isDuplicate
                        ? "#FFFBF2"
                        : r.disposition === "meeting-booked"
                          ? DISPOSITION_META["meeting-booked"].bg
                          : r.disposition === "not-interested"
                            ? DISPOSITION_META["not-interested"].bg
                            : undefined,
                    }}
                  >
                    <td style={{ textAlign: "center" }}>
                      <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleSelectRow(r.id)} />
                    </td>
                    <td style={{ padding: "10px 14px", fontWeight: 600 }}>
                      {r.disposition === "meeting-booked" && <BookedStamp />}
                      <div style={strike}>{f.company || "—"}</div>
                    </td>
                    <td style={{ padding: "10px 14px", ...strike }}>
                      {getFullName(f) || f.email || "—"} {matchedContact?.onCrm && <OnCrmBadge />}
                    </td>
                    <td style={{ padding: "10px 14px" }}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {r.isDuplicate && <span style={{ fontSize: 10.5, background: "#F7B955", color: "#5C3A00", padding: "2px 7px", borderRadius: 20, fontWeight: 700 }}>DUPLICATE</span>}
                        {r.licensing && <span style={{ fontSize: 10.5, background: "#FBF0DC", color: "#8A5A00", padding: "2px 7px", borderRadius: 20 }}>{r.licensing.skus[0]}{r.licensing.count ? ` · ${r.licensing.count}` : ""}</span>}
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
                    <td style={{ padding: "10px 14px", color: "#4C6167", fontSize: 12.5, maxWidth: 300 }}>{r.notesSummary}</td>
                    <td style={{ padding: "10px 14px" }}>
                      <button onClick={() => toggleTier(r.id)} style={{ border: "none", borderRadius: 20, padding: "4px 10px", fontWeight: 700, color: tierColor, background: tierBg }}>{tierLabel}</button>
                    </td>
                    <td style={{ padding: "10px 14px" }}>
                      <select value={r.category} onChange={(e) => reassignRow(r.id, e.target.value as CategoryKey)} style={{ background: meta.bg, color: meta.color, fontWeight: 600, border: "1px solid #D8DBE1", borderRadius: 7, padding: "6px 8px" }}>
                        {ACTIVE_CATEGORY_KEYS.map((k) => (
                          <option key={k} value={k}>{CATEGORY_META[k].label}</option>
                        ))}
                      </select>
                    </td>
                    <td style={{ padding: "10px 14px" }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 150 }}>
                        <select
                          value={r.disposition}
                          onChange={(e) => setDisposition(r.id, e.target.value as Disposition)}
                          style={{ background: DISPOSITION_META[r.disposition].bg, color: DISPOSITION_META[r.disposition].color, fontWeight: 600, border: "1px solid #D8DBE1", borderRadius: 7, padding: "5px 7px", fontSize: 12 }}
                        >
                          {DISPOSITION_ORDER.map((d) => (
                            <option key={d} value={d}>{DISPOSITION_META[d].label}</option>
                          ))}
                        </select>
                        {r.disposition !== "none" && (
                          <input
                            defaultValue={r.dispositionNote}
                            onBlur={(e) => setDispositionNote(r.id, e.target.value)}
                            placeholder="Note"
                            style={{ border: "1px solid #E1E4E9", borderRadius: 6, padding: "4px 6px", fontSize: 11.5 }}
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
                              style={{ border: "1px solid #D8DBE1", borderRadius: 6, padding: "3px 5px", fontSize: 11 }}
                            />
                          )}
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: "10px 14px", textAlign: "center" }}>
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
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 15, alignItems: "center" }}>
          <span style={{ fontSize: 12.5 }}>Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length}</span>
          <button disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Prev</button>
          <span>Page {currentPage} of {totalPages}</span>
          <button disabled={currentPage >= totalPages} onClick={() => setPage(currentPage + 1)}>Next</button>
        </div>
      )}
    </div>
  );
}
