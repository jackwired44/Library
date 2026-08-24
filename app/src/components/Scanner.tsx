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
import { downloadCSV, parseCSVFile } from "../lib/csv";
import {
  getMonthOptionsForFiling,
  getOrCreateGroupByName,
  fileSignalRowsIntoGroup,
  persistLibraryEntries,
  persistGroup,
  monthKeyFromDate,
  monthLabelFromKey,
  type LibraryEntry,
  type LibraryGroup,
} from "../lib/library";
import type { HistoryEntry } from "../lib/history";
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
  // the Library, which is opt-in) — see CLAUDE.md "History".
  onRecordHistory: (parsedFiles: ParsedFile[], scanned: ResultRow[]) => void;
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
      setResults(scanned);
      setUploadedFiles(parsedFiles.map((pf) => ({ name: pf.name, rows: pf.data.length })));
      setPage(1);
      setSelected(new Set());
      onRecordHistory(parsedFiles, scanned);
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
        const { entries: nextEntries, touchedIds } = fileSignalRowsIntoGroup(libraryEntries, groupsWithMonth, group.id, signalRows, `${Date.now()}`);
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
    setPage(1);
    setSelected(new Set());
    // Saving is an explicit, per-batch choice — never carries over to the
    // next upload (see CLAUDE.md "Library architecture").
    setSaveToLibrary(false);
    setUploadMonthKey(monthKeyFromDate(new Date()));
    setFiledNotice(null);
    setDedupeNotice(null);
  }

  const filtered = useMemo(() => {
    if (!results) return [];
    let list = results;
    if (tierFilter !== "all") list = list.filter((r) => r.tier === tierFilter);
    if (categoryFilter !== "all") list = list.filter((r) => r.category === categoryFilter);
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
  }, [results, tierFilter, categoryFilter, duplicatesOnly, priorityOnly, search, dynamicsSortDesc]);

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
    mutateResults((list) => list.filter((r) => selected.has(r.id)).map((r) => { r.disposition = disposition; return r; }));
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
        <div style={{ display: "flex", justifyContent: "center", gap: 10, marginBottom: 12, alignItems: "center" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, background: "#fff", border: "1px solid #D5D9E0", borderRadius: 9, padding: "8px 13px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
            <input type="checkbox" checked={saveToLibrary} onChange={(e) => setSaveToLibrary(e.target.checked)} />
            Save this batch's Strong Signal leads to the Library
          </label>
          <select
            value={uploadMonthKey}
            disabled={!saveToLibrary}
            onChange={(e) => setUploadMonthKey(e.target.value)}
            style={{ border: "1px solid #D5D9E0", borderRadius: 9, padding: "8px 12px", fontWeight: 700, background: saveToLibrary ? "#fff" : "#F4F6F7", color: saveToLibrary ? "#081E22" : "#B7BEC4" }}
          >
            {getMonthOptionsForFiling().map((o) => (
              <option key={o.key} value={o.key}>{o.label}</option>
            ))}
          </select>
        </div>
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
          onClick={() => fileInputRef.current?.click()}
          style={{
            border: `2px dashed ${dragOver ? "#2CC295" : "#D8DCE2"}`,
            background: dragOver ? "#EDF4EF" : "#fff",
            borderRadius: 16,
            padding: "58px 24px",
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
          <div style={{ color: "#8B93A0", fontSize: 13.5 }}>or click to browse — scanned for licensing AND platform signals in one pass.</div>
        </div>
        {error && <div style={{ marginTop: 16, color: "#9A5B22" }}>{error}</div>}

        {recentUploads.length > 0 && (
          <div style={{ marginTop: 28 }}>
            <div style={{ fontSize: 11.5, color: "#8b93a0", fontWeight: 700, textTransform: "uppercase", marginBottom: 10 }}>Recent uploads</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {recentUploads.map((h) => {
                const signalCount = h.results.filter((r) => r.tier === "signal").length;
                return (
                  <button
                    key={h.id}
                    onClick={() => onOpenRecentUpload(h.id)}
                    style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, textAlign: "left", background: "#fff", border: "1px solid #E4E7EC", borderRadius: 11, padding: "10px 14px", cursor: "pointer" }}
                  >
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{h.fileName}</span>
                    <span style={{ fontSize: 11.5, color: "#9aa1ac", whiteSpace: "nowrap" }}>
                      {new Date(h.importedAt).toLocaleString()} · {h.rowsScanned} rows · {signalCount} Strong Signal
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {priorityLeads.length > 0 && (
          <div style={{ marginTop: 28 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
              <div style={{ fontSize: 11.5, color: "#8b93a0", fontWeight: 700, textTransform: "uppercase" }}>⭐ High Priority Leads ({filteredPriorityLeads.length})</div>
              {priorityFileOptions.length > 1 && (
                <select
                  value={priorityFileFilter}
                  onChange={(e) => setPriorityFileFilter(e.target.value)}
                  style={{ border: "1px solid #D5D9E0", borderRadius: 9, padding: "6px 10px", fontSize: 12 }}
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
                    style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", background: "#FFF7E5", border: "1px solid #F5DFA0", borderRadius: 11, padding: "10px 14px" }}
                  >
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>
                        {f.company || "—"} <span style={{ fontWeight: 500, color: "#4c6167" }}>· {getFullName(f) || f.email || "—"}</span>
                      </div>
                      <div style={{ fontSize: 11.5, color: "#9aa1ac" }}>{row.sourceFile} · {CATEGORY_META[row.category].label}</div>
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
                        style={{ border: "1px solid #F0D6D6", background: "#fff", color: "#B5443B", borderRadius: 6, padding: "4px 8px", fontSize: 11.5, whiteSpace: "nowrap" }}
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

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
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
                return (
                  <tr key={r.id} style={{ borderBottom: "1px solid #F0F1F4", background: r.isDuplicate ? "#FFFBF2" : undefined }}>
                    <td style={{ textAlign: "center" }}>
                      <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleSelectRow(r.id)} />
                    </td>
                    <td style={{ padding: "10px 14px", fontWeight: 600, ...strike }}>{f.company || "—"}</td>
                    <td style={{ padding: "10px 14px", ...strike }}>{getFullName(f) || f.email || "—"}</td>
                    <td style={{ padding: "10px 14px" }}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {r.isDuplicate && <span style={{ fontSize: 10.5, background: "#F7B955", color: "#5C3A00", padding: "2px 7px", borderRadius: 20, fontWeight: 700 }}>DUPLICATE</span>}
                        {r.licensing && <span style={{ fontSize: 10.5, background: "#FBF0DC", color: "#8A5A00", padding: "2px 7px", borderRadius: 20 }}>{r.licensing.skus[0]}{r.licensing.count ? ` · ${r.licensing.count}` : ""}</span>}
                        {r.categories.filter((ck) => !(ck === "m365Tenant" && r.licensing)).map((ck) => (
                          <span key={ck} style={{ fontSize: 10.5, background: CATEGORY_META[ck].bg, color: CATEGORY_META[ck].color, padding: "2px 7px", borderRadius: 20 }}>
                            {CATEGORY_META[ck].label}{ck === "dynamics365" && r.dynamicsSeatCount != null ? ` · ${r.dynamicsSeatCount}` : ""}
                          </span>
                        ))}
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
