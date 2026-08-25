// Platform Notes — a single free-text scratchpad for internal notes about
// the platform/build itself (ideas, reminders, things to fix), separate
// from per-lead notes which already exist on every row. One blob of text,
// one IndexedDB record, autosaved as Jack types. See CLAUDE.md "Shell —
// account panel + platform notes."
import { dbGetAll, dbPut, STORE_PLATFORM_NOTES } from "./db";

const RECORD_ID = "platform-notes";

interface PlatformNotesRecord {
  id: typeof RECORD_ID;
  text: string;
  updatedAt: string;
}

export async function loadPlatformNotes(): Promise<string> {
  const all = await dbGetAll<PlatformNotesRecord>(STORE_PLATFORM_NOTES);
  return all[0]?.text || "";
}

export async function savePlatformNotes(text: string): Promise<void> {
  await dbPut<PlatformNotesRecord>(STORE_PLATFORM_NOTES, { id: RECORD_ID, text, updatedAt: new Date().toISOString() });
}
