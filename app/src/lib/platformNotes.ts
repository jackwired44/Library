// Platform Notes — internal notes about the platform/build itself (ideas,
// reminders, things to fix), separate from per-lead notes which already
// exist on every row. A dated, titled log now (per Jack's explicit ask),
// not a single scratchpad blob — each entry stamps when it was written and
// can be browsed back by calendar day. See CLAUDE.md "Shell — account
// panel + platform notes" / "Cheat Sheet relocation + dated Platform
// Notes."
import { dbDelete, dbGetAll, dbPut, STORE_PLATFORM_NOTES } from "./db";

export interface PlatformNoteEntry {
  id: string;
  title: string;
  body: string;
  createdAt: string;
}

// The old single-blob record (pre-dated-entries) used this fixed id and
// had a `text` field instead of `title`/`body` — recognized by shape so a
// browser that still has one gets migrated into the first dated entry
// (titled "Untitled") rather than silently losing it.
const LEGACY_RECORD_ID = "platform-notes";
interface LegacyRecord {
  id: typeof LEGACY_RECORD_ID;
  text: string;
  updatedAt: string;
}
function isLegacyRecord(r: unknown): r is LegacyRecord {
  return !!r && typeof r === "object" && (r as { id?: unknown }).id === LEGACY_RECORD_ID && "text" in r;
}

function newId(): string {
  return `note-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function loadPlatformNotes(): Promise<PlatformNoteEntry[]> {
  const all = await dbGetAll<PlatformNoteEntry | LegacyRecord>(STORE_PLATFORM_NOTES);
  const legacy = all.find(isLegacyRecord);
  const entries = all.filter((r): r is PlatformNoteEntry => !isLegacyRecord(r));

  if (legacy) {
    await dbDelete(STORE_PLATFORM_NOTES, LEGACY_RECORD_ID);
    if (legacy.text.trim()) {
      const migrated: PlatformNoteEntry = { id: newId(), title: "Untitled", body: legacy.text, createdAt: legacy.updatedAt || new Date().toISOString() };
      await dbPut(STORE_PLATFORM_NOTES, migrated);
      entries.push(migrated);
    }
  }

  return entries.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function addPlatformNote(title: string, body: string): Promise<PlatformNoteEntry> {
  const entry: PlatformNoteEntry = { id: newId(), title: title.trim() || "Untitled", body, createdAt: new Date().toISOString() };
  await dbPut(STORE_PLATFORM_NOTES, entry);
  return entry;
}

export async function deletePlatformNote(id: string): Promise<void> {
  await dbDelete(STORE_PLATFORM_NOTES, id);
}

// Local calendar-day key (not UTC) so "today" matches what the entry's own
// timestamp reads as to Jack, not to the server/browser's UTC offset.
export function dayKeyOf(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
