import { useRef, useState } from "react";
import { downloadBlob } from "../lib/csv";
import {
  buildBackupPayload,
  parseBackupPayload,
  mergeLibraryEntries,
  mergeLibraryGroups,
  mergeHistoryEntries,
  restoreExtraStores,
  countIncoming,
  EXTRA_STORES,
} from "../lib/backup";
import { persistLibraryEntry, persistGroup, type LibraryEntry, type LibraryGroup } from "../lib/library";
import { persistHistoryEntry, type HistoryEntry } from "../lib/history";

interface BackupRestoreProps {
  libraryEntries: LibraryEntry[];
  libraryGroups: LibraryGroup[];
  historyEntries: HistoryEntry[];
  setLibraryEntries: React.Dispatch<React.SetStateAction<LibraryEntry[]>>;
  setLibraryGroups: React.Dispatch<React.SetStateAction<LibraryGroup[]>>;
  setHistoryEntries: React.Dispatch<React.SetStateAction<HistoryEntry[]>>;
}

const btn: React.CSSProperties = {
  border: "1px solid var(--border)",
  background: "var(--surface)",
  borderRadius: 8,
  padding: "8px 14px",
  fontSize: 12,
  fontWeight: 700,
  color: "var(--muted)",
};

export default function BackupRestore({ libraryEntries, libraryGroups, historyEntries, setLibraryEntries, setLibraryGroups, setHistoryEntries }: BackupRestoreProps) {
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsReload, setNeedsReload] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleBackup() {
    setBusy(true);
    try {
      const payload = await buildBackupPayload(libraryEntries, libraryGroups, historyEntries);
      const extra = Object.values(payload.stores || {}).reduce((n, rows) => n + rows.length, 0);
      downloadBlob(
        JSON.stringify(payload, null, 2),
        `wired-cio-lead-scanner-full-backup-${new Date().toISOString().slice(0, 10)}.json`,
        "application/json;charset=utf-8;"
      );
      setError(null);
      setNotice(
        `Backup downloaded — ${libraryEntries.length} Lead Library file${libraryEntries.length === 1 ? "" : "s"}, ${libraryGroups.length} folder${libraryGroups.length === 1 ? "" : "s"}, ${historyEntries.length} History import${historyEntries.length === 1 ? "" : "s"}, and ${extra} record${extra === 1 ? "" : "s"} across contacts, tasks, sequences, lists and the rest.`
      );
    } catch (err) {
      setNotice(null);
      setError(`Could not build the backup: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  function handleRestoreFile(file: File | undefined) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const incoming = parseBackupPayload(String(reader.result));
        setBusy(true);
        // The three stores App.tsx mirrors in React state are merged into
        // state AND written through, exactly as before.
        setLibraryEntries(mergeLibraryEntries(libraryEntries, incoming.library));
        setLibraryGroups(mergeLibraryGroups(libraryGroups, incoming.libraryGroups));
        setHistoryEntries(mergeHistoryEntries(historyEntries, incoming.history));
        incoming.library.forEach((e) => persistLibraryEntry(e));
        incoming.libraryGroups.forEach((g) => persistGroup(g));
        incoming.history.forEach((h) => persistHistoryEntry(h));

        // Everything else is written straight to IndexedDB. Those stores
        // are read into state at load time by App.tsx and by individual
        // components, so a reload is what makes them visible — writing
        // them and pretending they're live would be worse than saying so.
        const { written, failed } = await restoreExtraStores(incoming.stores);
        const storeCount = Object.keys(incoming.stores).filter((s) => (incoming.stores[s] || []).length).length;
        setError(failed.length ? `Some records could not be written: ${failed.join(", ")}.` : null);
        setNotice(
          `Restored ${countIncoming(incoming)} record${countIncoming(incoming) === 1 ? "" : "s"} from a v${incoming.version} backup — ${incoming.library.length} Lead Library file${incoming.library.length === 1 ? "" : "s"}, ${incoming.history.length} History import${incoming.history.length === 1 ? "" : "s"}, and ${written} record${written === 1 ? "" : "s"} across ${storeCount} other store${storeCount === 1 ? "" : "s"}.`
        );
        if (written > 0) setNeedsReload(true);
      } catch (err) {
        setNotice(null);
        setError(`Could not restore backup file: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setBusy(false);
      }
    };
    reader.readAsText(file);
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <button
        onClick={handleBackup}
        disabled={busy}
        title={`Download one JSON file covering every store: Lead Library files and folders, History, plus ${EXTRA_STORES.map((s) => s.label.toLowerCase()).join(", ")}`}
        style={btn}
      >
        {busy ? "Working…" : "⬇ Backup everything"}
      </button>
      <button
        onClick={() => fileInputRef.current?.click()}
        disabled={busy}
        title="Restore from a backup JSON file — merges in by record, never wipes what's already here"
        style={btn}
      >
        ⬆ Restore backup
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        style={{ display: "none" }}
        onChange={(e) => { handleRestoreFile(e.target.files?.[0]); e.target.value = ""; }}
      />
      {notice && <span style={{ fontSize: 12, color: "var(--accent)", fontWeight: 600 }}>{notice}</span>}
      {needsReload && (
        <button onClick={() => window.location.reload()} style={{ ...btn, borderColor: "var(--accent)", color: "var(--accent)" }}>
          ↻ Reload to see restored contacts, tasks & sequences
        </button>
      )}
      {error && <span style={{ fontSize: 12, color: "#B5443B", fontWeight: 600 }}>{error}</span>}
    </div>
  );
}
