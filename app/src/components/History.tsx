import { useMemo, useState } from "react";
import { ACTIVE_BUCKET_KEYS, BUCKET_META, EXPORT_LABELS, exportRowsForBucket, getFullName, type BucketKey } from "../lib/detection";
import { downloadCSV, toCSV, downloadBlob } from "../lib/csv";
import { getWeeks, getDays, getFilteredHistory, buildAuditTrailRows, AUDIT_TRAIL_COLUMNS, type HistoryEntry } from "../lib/history";

type GroupBy = "week" | "day";

interface HistoryProps {
  history: HistoryEntry[];
  setHistory: React.Dispatch<React.SetStateAction<HistoryEntry[]>>;
  loading: boolean;
  error: string | null;
  onLoadIntoScanner: (entryIds: string[]) => void;
  onDeleteEntry: (id: string) => void;
  onUpdateEntry: (id: string, patch: Partial<Pick<HistoryEntry, "tag" | "notes">>) => void;
}

export default function HistoryView({ history, loading, error, onLoadIntoScanner, onDeleteEntry, onUpdateEntry }: HistoryProps) {
  const [search, setSearch] = useState("");
  const [groupBy, setGroupBy] = useState<GroupBy>("day");
  const [activeGroupKey, setActiveGroupKey] = useState<string | "all">("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());

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
        Every import is kept here automatically, whether or not it was saved to the Library — an audit trail of exactly which
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
              onToggleSelect={() => toggleSelect(h.id)}
              onView={() => onLoadIntoScanner([h.id])}
              onDelete={() => { onDeleteEntry(h.id); setSelected((prev) => { const next = new Set(prev); next.delete(h.id); return next; }); }}
              onDownloadBucket={(bk) => downloadBucket(h, bk)}
              onUpdateTag={(v) => onUpdateEntry(h.id, { tag: v })}
              onUpdateNotes={(v) => onUpdateEntry(h.id, { notes: v })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function HistoryCard({
  entry,
  selected,
  onToggleSelect,
  onView,
  onDelete,
  onDownloadBucket,
  onUpdateTag,
  onUpdateNotes,
}: {
  entry: HistoryEntry;
  selected: boolean;
  onToggleSelect: () => void;
  onView: () => void;
  onDelete: () => void;
  onDownloadBucket: (bk: BucketKey) => void;
  onUpdateTag: (v: string) => void;
  onUpdateNotes: (v: string) => void;
}) {
  const signalCount = entry.results.filter((r) => r.tier === "signal").length;
  const dupCount = entry.results.filter((r) => r.isDuplicate).length;
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
            <div style={{ fontWeight: 700 }}>{entry.fileName}</div>
            <div style={{ fontSize: 11.5, color: "#9aa1ac", marginTop: 2 }}>
              {new Date(entry.importedAt).toLocaleString()} · {entry.rowsScanned} rows · {signalCount} Strong Signal{dupCount ? ` · ${dupCount} duplicate${dupCount === 1 ? "" : "s"}` : ""}
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
          <button onClick={onDelete} title="Remove this import from History" style={{ border: "1px solid #F0D6D6", background: "#fff", borderRadius: 7, padding: "6px 8px", color: "#B5443B" }}>✕</button>
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
