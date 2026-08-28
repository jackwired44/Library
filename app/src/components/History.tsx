import { useMemo, useState } from "react";
import { ACTIVE_BUCKET_KEYS, ACTIVE_CATEGORY_KEYS, BUCKET_META, CATEGORY_META, EXPORT_LABELS, exportRowsForBucket, getFullName, type BucketKey } from "../lib/detection";
import { downloadCSV, toCSV, downloadBlob } from "../lib/csv";
import { getWeeks, getDays, getFilteredHistory, buildAuditTrailRows, AUDIT_TRAIL_COLUMNS, type HistoryEntry } from "../lib/history";
import type { LibraryEntry } from "../lib/library";

type GroupBy = "week" | "day";

interface HistoryProps {
  history: HistoryEntry[];
  setHistory: React.Dispatch<React.SetStateAction<HistoryEntry[]>>;
  loading: boolean;
  error: string | null;
  onLoadIntoScanner: (entryIds: string[]) => void;
  onDeleteEntry: (id: string) => void;
  onUpdateEntry: (id: string, patch: Partial<Pick<HistoryEntry, "tag" | "notes">>) => void;
  onClearHistory: () => void;
  libraryEntries: LibraryEntry[];
}

// A History entry a Library file still points back to (via
// StoredRow.__historyEntryId, set at filing time) can't be deleted quietly
// — per Jack, deleting it (singly or via Clear History) requires typing
// "override" first, since it would sever the Library's sync-back link to
// that entry's original scan even though the filed Library copy itself is
// untouched.
type PendingDelete = { kind: "single"; id: string; fileName: string } | { kind: "clear" };

export default function HistoryView({ history, loading, error, onLoadIntoScanner, onDeleteEntry, onUpdateEntry, onClearHistory, libraryEntries }: HistoryProps) {
  const [search, setSearch] = useState("");
  const [groupBy, setGroupBy] = useState<GroupBy>("day");
  const [activeGroupKey, setActiveGroupKey] = useState<string | "all">("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);

  const linkedHistoryIds = useMemo(() => {
    const ids = new Set<string>();
    libraryEntries.forEach((e) => e.rows.forEach((r) => ids.add(r.__historyEntryId)));
    return ids;
  }, [libraryEntries]);

  function requestDeleteEntry(entry: HistoryEntry) {
    if (linkedHistoryIds.has(entry.id)) {
      setPendingDelete({ kind: "single", id: entry.id, fileName: entry.fileName });
      return;
    }
    if (window.confirm(`Delete "${entry.fileName}" from History? This can't be undone.`)) {
      onDeleteEntry(entry.id);
      setSelected((prev) => { const next = new Set(prev); next.delete(entry.id); return next; });
    }
  }

  function requestClearHistory() {
    if (history.length === 0) return;
    if (history.some((h) => linkedHistoryIds.has(h.id))) {
      setPendingDelete({ kind: "clear" });
      return;
    }
    if (window.confirm(`Clear all ${history.length} import${history.length === 1 ? "" : "s"} from History? This can't be undone.`)) {
      onClearHistory();
      setSelected(new Set());
    }
  }

  function confirmPendingDelete() {
    if (!pendingDelete) return;
    if (pendingDelete.kind === "single") {
      onDeleteEntry(pendingDelete.id);
      setSelected((prev) => { const next = new Set(prev); next.delete(pendingDelete.id); return next; });
    } else {
      onClearHistory();
      setSelected(new Set());
    }
    setPendingDelete(null);
  }

  const filtered = useMemo(() => getFilteredHistory(history, search), [history, search]);
  const weeks = useMemo(() => getWeeks(filtered), [filtered]);
  const days = useMemo(() => getDays(filtered), [filtered]);
  const groups = groupBy === "day" ? days : weeks;
  const visibleEntries = activeGroupKey === "all" ? filtered : groups.find((g) => g.key === activeGroupKey)?.entries || [];

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function downloadBucket(entry: HistoryEntry, bucketKey: BucketKey) {
    downloadCSV(`wired-cio-${BUCKET_META[bucketKey].slug}-leads — ${entry.fileName}.csv`, exportRowsForBucket(entry.results, bucketKey), EXPORT_LABELS);
  }

  function downloadAuditTrail() {
    const rows = buildAuditTrailRows(filtered);
    downloadBlob(toCSV(rows, AUDIT_TRAIL_COLUMNS), `wired-cio-lead-scanner-audit-trail-${new Date().toISOString().slice(0, 10)}.csv`);
  }

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: "#9aa1ac" }}>Loading previous imports…</div>;

  if (history.length === 0) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "#9aa1ac", background: "#fff", border: "1px solid #E4E7EC", borderRadius: 13 }}>
        Every scan and reload gets kept here automatically — nothing's been imported yet. Upload a file on the Scanner to get started.
      </div>
    );
  }

  return (
    <div>
      <p style={{ color: "#4c6167", maxWidth: 700, marginBottom: 16 }}>
        Every import is kept here automatically, whether or not it was saved to the Lead Library — an audit trail of exactly which
        day each file came in. Search across all of it, revisit a past batch, or combine several into one working Scanner
        view — edits made there sync back here.
      </p>
      {error && <div style={{ color: "#9A5B22", marginBottom: 12 }}>{error}</div>}

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by company, contact, tag, or file name"
          style={{ flex: "1 1 320px", maxWidth: 420, border: "1px solid #E1E4E9", borderRadius: 9, padding: "8px 12px" }}
        />
        <button
          onClick={downloadAuditTrail}
          title="Download a CSV audit log — one row per import, with the exact date/time it was scanned"
          style={{ border: "1px solid #D5D9E0", background: "#fff", borderRadius: 8, padding: "8px 14px", fontSize: 12, fontWeight: 700, color: "#4c6167", whiteSpace: "nowrap" }}
        >
          ⬇ Export audit trail
        </button>
        <button
          onClick={requestClearHistory}
          title="Delete every import from History"
          style={{ border: "1px solid #F0D6D6", background: "#fff", borderRadius: 8, padding: "8px 14px", fontSize: 12, fontWeight: 700, color: "#B5443B", whiteSpace: "nowrap" }}
        >
          Clear History
        </button>
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        <span style={{ fontSize: 11.5, color: "#8b93a0", fontWeight: 700, textTransform: "uppercase" }}>Group by</span>
        {(["day", "week"] as GroupBy[]).map((g) => (
          <button
            key={g}
            onClick={() => { setGroupBy(g); setActiveGroupKey("all"); }}
            style={{ border: "none", borderRadius: 8, padding: "5px 11px", fontWeight: 600, fontSize: 12, background: groupBy === g ? "#081E22" : "#F6FAFA", color: groupBy === g ? "#fff" : "#4C6167" }}
          >
            {g === "day" ? "Day" : "Week"}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
        <button
          onClick={() => setActiveGroupKey("all")}
          style={{ border: "none", borderRadius: 8, padding: "7px 12px", fontWeight: 600, background: activeGroupKey === "all" ? "#081E22" : "#F6FAFA", color: activeGroupKey === "all" ? "#fff" : "#4C6167" }}
        >
          All ({filtered.length})
        </button>
        {groups.map((g) => (
          <button
            key={g.key}
            onClick={() => setActiveGroupKey(g.key)}
            style={{ border: "none", borderRadius: 8, padding: "7px 12px", fontWeight: 600, background: activeGroupKey === g.key ? "#081E22" : "#F6FAFA", color: activeGroupKey === g.key ? "#fff" : "#4C6167" }}
          >
            {g.label} ({g.entries.length})
          </button>
        ))}
      </div>

      {selected.size > 0 && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", background: "#EEF2FF", border: "1px solid #D6DEFA", borderRadius: 11, padding: "10px 17px", marginBottom: 14, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 700, color: "#3A4B8C" }}>{selected.size} import{selected.size === 1 ? "" : "s"} selected</span>
          <button
            onClick={() => { onLoadIntoScanner([...selected]); setSelected(new Set()); }}
            style={{ background: "#2CC295", color: "#081E22", border: "none", borderRadius: 8, padding: "7px 14px", fontWeight: 700 }}
          >
            Combine into Scanner
          </button>
          <button onClick={() => setSelected(new Set(visibleEntries.map((h) => h.id)))} style={{ background: "none", border: "none", textDecoration: "underline" }}>Select all shown</button>
          <button onClick={() => setSelected(new Set())} style={{ background: "none", border: "none", textDecoration: "underline" }}>Clear selection</button>
        </div>
      )}

      {visibleEntries.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: "#9aa1ac", background: "#fff", border: "1px solid #E4E7EC", borderRadius: 13 }}>No imports match this filter.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {visibleEntries.map((h) => (
            <HistoryCard
              key={h.id}
              entry={h}
              selected={selected.has(h.id)}
              linkedToLibrary={linkedHistoryIds.has(h.id)}
              onToggleSelect={() => toggleSelect(h.id)}
              onView={() => onLoadIntoScanner([h.id])}
              onDelete={() => requestDeleteEntry(h)}
              onDownloadBucket={(bk) => downloadBucket(h, bk)}
              onUpdateTag={(v) => onUpdateEntry(h.id, { tag: v })}
              onUpdateNotes={(v) => onUpdateEntry(h.id, { notes: v })}
            />
          ))}
        </div>
      )}

      {pendingDelete && (
        <OverrideModal
          message={
            pendingDelete.kind === "single"
              ? `"${pendingDelete.fileName}" has a lead filed in the Lead Library that syncs back to this History entry. Deleting it will break that link — the Lead Library file itself is untouched, but its edits will stop syncing back here.`
              : `Clearing History will delete ${history.length} import${history.length === 1 ? "" : "s"}, including at least one with a lead filed in the Lead Library that syncs back to it. The Lead Library files themselves are untouched, but their edits will stop syncing back here.`
          }
          onConfirm={confirmPendingDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}

function OverrideModal({ message, onConfirm, onCancel }: { message: string; onConfirm: () => void; onCancel: () => void }) {
  const [text, setText] = useState("");
  const ready = text.trim().toLowerCase() === "override";
  return (
    <div onClick={onCancel} style={{ position: "fixed", inset: 0, background: "rgba(8,30,34,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 60 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 14, maxWidth: 460, width: "100%", padding: "22px 24px", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}>
        <h3 style={{ margin: "0 0 10px", fontSize: 16 }}>This needs an override</h3>
        <p style={{ margin: "0 0 14px", fontSize: 13, color: "#4c6167", lineHeight: 1.5 }}>{message}</p>
        <p style={{ margin: "0 0 8px", fontSize: 12.5, fontWeight: 700 }}>Type "override" to confirm:</p>
        <input
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && ready && onConfirm()}
          placeholder="override"
          style={{ width: "100%", border: "1px solid #D5D9E0", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginBottom: 16 }}
        />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onCancel} style={{ border: "1px solid #D5D9E0", background: "#fff", borderRadius: 8, padding: "8px 14px", fontWeight: 600 }}>Cancel</button>
          <button
            onClick={onConfirm}
            disabled={!ready}
            style={{ border: "none", borderRadius: 8, padding: "8px 14px", fontWeight: 700, background: ready ? "#B5443B" : "#E9C6C2", color: "#fff", cursor: ready ? "pointer" : "not-allowed" }}
          >
            Delete anyway
          </button>
        </div>
      </div>
    </div>
  );
}

function HistoryCard({
  entry,
  selected,
  linkedToLibrary,
  onToggleSelect,
  onView,
  onDelete,
  onDownloadBucket,
  onUpdateTag,
  onUpdateNotes,
}: {
  entry: HistoryEntry;
  selected: boolean;
  linkedToLibrary: boolean;
  onToggleSelect: () => void;
  onView: () => void;
  onDelete: () => void;
  onDownloadBucket: (bk: BucketKey) => void;
  onUpdateTag: (v: string) => void;
  onUpdateNotes: (v: string) => void;
}) {
  const signalCount = entry.results.filter((r) => r.tier === "signal").length;
  const mentionCount = entry.results.filter((r) => r.tier === "mention").length;
  const dqCount = entry.results.filter((r) => r.tier === "dq").length;
  // entry.results has already had every duplicate hard-removed (see
  // CLAUDE.md "Duplicates are removed outright") — r.isDuplicate is always
  // false here, so the real count/largest-group live on the entry itself,
  // recorded at scan time (buildHistoryEntry).
  const dupCount = entry.duplicatesRemoved || 0;
  const largestDupGroup = entry.largestDuplicateGroup || 0;
  // Per Jack: "break it down by needs review, strong signal and further
  // with the product lines etc" — a full tier + category accounting per
  // import, not just the total Strong Signal count History already had.
  const signalByCategory = ACTIVE_CATEGORY_KEYS.map((ck) => ({
    label: CATEGORY_META[ck].label,
    count: entry.results.filter((r) => r.tier === "signal" && r.category === ck).length,
  })).filter((c) => c.count > 0);
  const topCompanies = entry.results
    .slice(0, 3)
    .map((r) => r.row.__f.company || getFullName(r.row.__f))
    .filter(Boolean);

  return (
    <div data-history-entry-id={entry.id} style={{ background: "#fff", border: "1px solid #E4E7EC", borderRadius: 13, padding: "14px 18px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", gap: 10 }}>
          <input type="checkbox" checked={selected} onChange={onToggleSelect} style={{ marginTop: 4 }} />
          <div>
            <div style={{ fontWeight: 700, display: "flex", alignItems: "center", gap: 7 }}>
              {entry.fileName}
              {linkedToLibrary && (
                <span
                  title="A lead from this import is filed in the Lead Library — deleting this entry needs an override"
                  style={{ fontSize: 10, fontWeight: 700, color: "#7A5B00", background: "#FCEFC7", border: "1px solid #F0DE9E", borderRadius: 999, padding: "1px 8px" }}
                >
                  📚 Lead Library-linked
                </span>
              )}
            </div>
            <div style={{ fontSize: 11.5, color: "#9aa1ac", marginTop: 2 }}>
              {new Date(entry.importedAt).toLocaleString()} · {entry.rowsScanned.toLocaleString()} rows read
              {dupCount > 0 &&
                ` · ${dupCount.toLocaleString()} duplicate${dupCount === 1 ? "" : "s"} recognized and merged into ${
                  dupCount === 1 ? "its" : "their"
                } matching contact${largestDupGroup > 2 ? ` (one lead appeared ${largestDupGroup} times)` : ""}`}
            </div>
            <div style={{ fontSize: 11.5, color: "#9aa1ac", marginTop: 2 }}>
              <strong style={{ color: "#2CC295" }}>{signalCount.toLocaleString()} Strong Signal</strong>
              {signalByCategory.length > 0 && ` (${signalByCategory.map((c) => `${c.count} ${c.label}`).join(" · ")})`}
              {" · "}
              <strong style={{ color: "#9A5B22" }}>{mentionCount.toLocaleString()} Needs Review</strong>
              {" · "}
              <strong style={{ color: "#B5443B" }}>{dqCount.toLocaleString()} Bad Leads</strong>
            </div>
            {topCompanies.length > 0 && <div style={{ fontSize: 11.5, color: "#9aa1ac", marginTop: 2 }}>{topCompanies.join(", ")}{entry.results.length > 3 ? "…" : ""}</div>}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button onClick={onView} style={{ border: "1px solid #D5D9E0", background: "#fff", borderRadius: 7, padding: "6px 10px" }}>View / edit</button>
          {ACTIVE_BUCKET_KEYS.map((bk) => (
            <button key={bk} onClick={() => onDownloadBucket(bk)} title={`Download ${BUCKET_META[bk].label} leads from this import`} style={{ border: "1px solid #D5D9E0", background: "#fff", borderRadius: 7, padding: "6px 10px", fontSize: 12 }}>
              ⬇ {BUCKET_META[bk].label}
            </button>
          ))}
          <button
            onClick={onDelete}
            title={linkedToLibrary ? "Filed in the Lead Library — deleting needs an override" : "Remove this import from History"}
            style={{ border: "1px solid #F0D6D6", background: "#fff", borderRadius: 7, padding: "6px 8px", color: "#B5443B" }}
          >
            ✕
          </button>
        </div>
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
        <input
          defaultValue={entry.tag}
          onBlur={(e) => onUpdateTag(e.target.value)}
          placeholder="Tag (e.g. Apollo export, cold list…)"
          style={{ border: "1px solid #E1E4E9", borderRadius: 8, padding: "6px 10px", fontSize: 12.5, flex: "1 1 180px" }}
        />
        <input
          defaultValue={entry.notes}
          onBlur={(e) => onUpdateNotes(e.target.value)}
          placeholder="Notes"
          style={{ border: "1px solid #E1E4E9", borderRadius: 8, padding: "6px 10px", fontSize: 12.5, flex: "2 1 260px" }}
        />
      </div>
    </div>
  );
}
