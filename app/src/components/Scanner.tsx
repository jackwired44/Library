import { useMemo, useRef, useState } from "react";
import {
  CATEGORY_META,
  BUCKET_META,
  EXPORT_LABELS,
  exportRowsForBucket,
  getFullName,
  scanParsedFiles,
  sortByDynamicsSeatCount,
  type CategoryKey,
  type ParsedFile,
  type ResultRow,
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
}: ScannerProps) {
  const [saveToLibrary, setSaveToLibrary] = useState(false);
  const [uploadMonthKey, setUploadMonthKey] = useState(() => monthKeyFromDate(new Date()));
  const [filedNotice, setFiledNotice] = useState<string | null>(null);
  const [tierFilter, setTierFilter] = useState<Tier | "all">("signal");
  const [categoryFilter, setCategoryFilter] = useState<CategoryKey | "all">("all");
  const [duplicatesOnly, setDuplicatesOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkTarget, setBulkTarget] = useState<CategoryKey>("dynamics365");
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    try {
      const parsedFiles = await Promise.all(files.map(parseCSVFile));
      const { results: scanned } = scanParsedFiles(parsedFiles);
      setResults(scanned);
      setUploadedFiles(parsedFiles.map((pf) => ({ name: pf.name, rows: pf.data.length })));
      setPage(1);
      setSelected(new Set());
      onRecordHistory(parsedFiles, scanned);

      // Opt-in, off by default (see CLAUDE.md "Library architecture") — a
      // one-off scan never touches the Library unless this box is checked.
      if (saveToLibrary) {
        const monthLabel = monthLabelFromKey(uploadMonthKey);
        const { groups: groupsWithMonth, group } = getOrCreateGroupByName(libraryGroups, monthLabel);
        const signalRows = scanned.filter((r) => r.tier === "signal");
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
    setError(null);
    setSearch("");
    setCategoryFilter("all");
    setTierFilter("signal");
    setDuplicatesOnly(false);
    setPage(1);
    setSelected(new Set());
    // Saving is an explicit, per-batch choice — never carries over to the
    // next upload (see CLAUDE.md "Library architecture").
    setSaveToLibrary(false);
    setUploadMonthKey(monthKeyFromDate(new Date()));
    setFiledNotice(null);
  }

  const filtered = useMemo(() => {
    if (!results) return [];
    let list = results;
    if (tierFilter !== "all") list = list.filter((r) => r.tier === tierFilter);
    if (categoryFilter !== "all") list = list.filter((r) => r.category === categoryFilter);
    if (duplicatesOnly) list = list.filter((r) => r.isDuplicate);
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
    // license count, highest first, regardless of which tier tab is active.
    if (categoryFilter === "dynamics365") list = sortByDynamicsSeatCount(list);
    return list;
  }, [results, tierFilter, categoryFilter, duplicatesOnly, search]);

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

  function mutateResults(fn: (list: ResultRow[]) => void) {
    setResults((prev) => {
      if (!prev) return prev;
      const next = prev.map((r) => ({ ...r }));
      fn(next);
      return next;
    });
  }

  function toggleTier(id: string) {
    mutateResults((list) => {
      const row = list.find((r) => r.id === id);
      if (!row) return;
      row.tier = TIER_CYCLE[(TIER_CYCLE.indexOf(row.tier) + 1) % TIER_CYCLE.length];
      onSyncToHistory(row);
    });
  }
  function reassignRow(id: string, category: CategoryKey) {
    mutateResults((list) => {
      const row = list.find((r) => r.id === id);
      if (!row) return;
      row.category = category;
      onSyncToHistory(row);
    });
  }
  function toggleCrossedOut(id: string) {
    mutateResults((list) => {
      const row = list.find((r) => r.id === id);
      if (!row) return;
      row.crossedOut = !row.crossedOut;
      onSyncToHistory(row);
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
    mutateResults((list) => list.forEach((r) => { if (selected.has(r.id)) { r.category = category; onSyncToHistory(r); } }));
    setSelected(new Set());
  }
  function setTierForSelected(tier: Tier) {
    if (!selected.size) return;
    mutateResults((list) => list.forEach((r) => { if (selected.has(r.id)) { r.tier = tier; onSyncToHistory(r); } }));
    setSelected(new Set());
  }
  function setCrossedOutForSelected(value: boolean) {
    if (!selected.size) return;
    mutateResults((list) => list.forEach((r) => { if (selected.has(r.id)) { r.crossedOut = value; onSyncToHistory(r); } }));
    setSelected(new Set());
  }

  function bucketRowsFor(bucketKey: BucketKey) {
    return exportRowsForBucket(results || [], bucketKey);
  }
  function exportBucket(bucketKey: BucketKey) {
    downloadCSV(`wired-cio-${BUCKET_META[bucketKey].slug}-leads.csv`, bucketRowsFor(bucketKey), EXPORT_LABELS);
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
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {(Object.keys(BUCKET_META) as BucketKey[]).map((bk) => {
            const count = bucketRowsFor(bk).length;
            return (
              <button
                key={bk}
                disabled={count === 0}
                onClick={() => exportBucket(bk)}
                style={{
                  background: count ? "#2CC295" : "#E1E5E4",
                  color: count ? "#081E22" : "#9AA6A5",
                  border: `2px solid ${count ? "#2CC295" : "#E1E5E4"}`,
                  borderRadius: 999,
                  padding: "9px 19px",
                  fontWeight: 700,
                  cursor: count ? "pointer" : "not-allowed",
                }}
              >
                {BUCKET_META[bk].label} ({count})
              </button>
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
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <button
          onClick={() => setCategoryFilter("all")}
          style={{ border: "none", borderRadius: 8, padding: "7px 12px", background: categoryFilter === "all" ? "#081E22" : "#F6FAFA", color: categoryFilter === "all" ? "#fff" : "#4C6167" }}
        >
          All product lines ({categoryCounts.all})
        </button>
        {(Object.keys(CATEGORY_META) as CategoryKey[]).map((k) => (
          <button
            key={k}
            onClick={() => setCategoryFilter(k)}
            style={{ border: "none", borderRadius: 8, padding: "7px 12px", background: categoryFilter === k ? "#081E22" : "#F6FAFA", color: categoryFilter === k ? "#fff" : "#4C6167" }}
          >
            {CATEGORY_META[k].label} ({categoryCounts[k] || 0})
          </button>
        ))}
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
            {(Object.keys(CATEGORY_META) as CategoryKey[]).map((k) => (
              <option key={k} value={k}>{CATEGORY_META[k].label}</option>
            ))}
          </select>
          <button onClick={() => moveSelectedTo(bulkTarget)} style={{ background: "#2CC295", color: "#081E22", border: "none", borderRadius: 8, padding: "7px 14px", fontWeight: 700 }}>Apply</button>
          <button onClick={() => setTierForSelected("signal")} style={{ background: "#2CC295", color: "#081E22", border: "none", borderRadius: 8, padding: "7px 12px", fontWeight: 700 }}>Strong Signal</button>
          <button onClick={() => setTierForSelected("mention")} style={{ background: "#fff", color: "#9A5B22", border: "1px solid #E7C79A", borderRadius: 8, padding: "7px 12px" }}>Needs review</button>
          <button onClick={() => setTierForSelected("dq")} style={{ background: "#fff", color: "#B5443B", border: "1px solid #F0C6C1", borderRadius: 8, padding: "7px 12px" }}>Bad lead</button>
          <button onClick={() => setCrossedOutForSelected(true)} style={{ background: "#fff", border: "1px solid #D5D9E0", borderRadius: 8, padding: "7px 12px" }}>Cross out</button>
          <button onClick={() => setCrossedOutForSelected(false)} style={{ background: "none", border: "none", textDecoration: "underline" }}>Restore</button>
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
              <th></th>
            </tr>
          </thead>
          <tbody>
            {pageItems.length === 0 ? (
              <tr><td colSpan={8} style={{ padding: 36, textAlign: "center", color: "#9AA1AC" }}>No rows match this filter.</td></tr>
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
                    <td style={{ padding: "10px 14px", color: "#4C6167", fontSize: 12.5, maxWidth: 300 }}>{r.notesSummary || r.licensing?.snippet || ""}</td>
                    <td style={{ padding: "10px 14px" }}>
                      <button onClick={() => toggleTier(r.id)} style={{ border: "none", borderRadius: 20, padding: "4px 10px", fontWeight: 700, color: tierColor, background: tierBg }}>{tierLabel}</button>
                    </td>
                    <td style={{ padding: "10px 14px" }}>
                      <select value={r.category} onChange={(e) => reassignRow(r.id, e.target.value as CategoryKey)} style={{ background: meta.bg, color: meta.color, fontWeight: 600, border: "1px solid #D8DBE1", borderRadius: 7, padding: "6px 8px" }}>
                        {(Object.keys(CATEGORY_META) as CategoryKey[]).map((k) => (
                          <option key={k} value={k}>{CATEGORY_META[k].label}</option>
                        ))}
                      </select>
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
