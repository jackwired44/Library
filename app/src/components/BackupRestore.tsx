import { useRef, useState } from "react";
import { downloadBlob } from "../lib/csv";
import { buildBackupPayload, parseBackupPayload, mergeLibraryEntries, mergeLibraryGroups, mergeHistoryEntries } from "../lib/backup";
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

export default function BackupRestore({ libraryEntries, libraryGroups, historyEntries, setLibraryEntries, setLibraryGroups, setHistoryEntries }: BackupRestoreProps) {
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleBackup() {
    const payload = buildBackupPayload(libraryEntries, libraryGroups, historyEntries);
    downloadBlob(JSON.stringify(payload, null, 2), `wired-cio-lead-scanner-full-backup-${new Date().toISOString().slice(0, 10)}.json`, "application/json;charset=utf-8;");
    setError(null);
    setNotice(`Backup downloaded — ${libraryEntries.length} Library file${libraryEntries.length === 1 ? "" : "s"}, ${libraryGroups.length} group${libraryGroups.length === 1 ? "" : "s"}, ${historyEntries.length} History import${historyEntries.length === 1 ? "" : "s"}.`);
  }

  function handleRestoreFile(file: File | undefined) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const incoming = parseBackupPayload(String(reader.result));
        const mergedLibrary = mergeLibraryEntries(libraryEntries, incoming.library);
        const mergedGroups = mergeLibraryGroups(libraryGroups, incoming.libraryGroups);
        const mergedHistory = mergeHistoryEntries(historyEntries, incoming.history);
        setLibraryEntries(mergedLibrary);
        setLibraryGroups(mergedGroups);
        setHistoryEntries(mergedHistory);
        setError(null);
        setNotice(`Restored ${incoming.library.length} Library file${incoming.library.length === 1 ? "" : "s"}, ${incoming.libraryGroups.length} group${incoming.libraryGroups.length === 1 ? "" : "s"}, ${incoming.history.length} History import${incoming.history.length === 1 ? "" : "s"} from the backup file.`);
        // Written through to IndexedDB too — otherwise a restore only
        // "sticks" until the next reload, defeating the point of restoring.
        incoming.library.forEach((e) => persistLibraryEntry(e));
        incoming.libraryGroups.forEach((g) => persistGroup(g));
        incoming.history.forEach((h) => persistHistoryEntry(h));
      } catch (err) {
        setNotice(null);
        setError(`Could not restore backup file: ${err instanceof Error ? err.message : String(err)}`);
      }
    };
    reader.readAsText(file);
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <button
        onClick={handleBackup}
        title="Download one JSON file covering every Lead Library file, folder, and History import"
        style={{ border: "1px solid #D5D9E0", background: "#fff", borderRadius: 8, padding: "8px 14px", fontSize: 12, fontWeight: 700, color: "#4c6167" }}
      >
        ⬇ Backup everything
      </button>
      <button
        onClick={() => fileInputRef.current?.click()}
        title="Restore Lead Library files, folders, and History from a backup JSON file — merges in, never wipes existing data"
        style={{ border: "1px solid #D5D9E0", background: "#fff", borderRadius: 8, padding: "8px 14px", fontSize: 12, fontWeight: 700, color: "#4c6167" }}
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
      {notice && <span style={{ fontSize: 12, color: "#2CC295", fontWeight: 600 }}>{notice}</span>}
      {error && <span style={{ fontSize: 12, color: "#B5443B", fontWeight: 600 }}>{error}</span>}
    </div>
  );
}
