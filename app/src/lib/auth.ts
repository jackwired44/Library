// Password gate — deliberately simple (matches legacy/web/build-web.js's
// intent: keep casual/accidental access out, remembered per device via
// localStorage), but improved on one real point: the page never stores or
// compares a plaintext password. Only a salted SHA-256 hash lives in this
// file, so reading the source doesn't hand someone the real password —
// it hands them something that takes real cracking effort, not a free read.
// This is still NOT real account security (no server, no rate limiting, no
// lockout) — see CLAUDE.md Access & ownership for what would actually be.
//
// To change the password: run `npm run hash-password -- "new password"`
// from app/, then paste the printed hash in as PASSWORD_HASH below.
const APP_SALT = "wired-cio-lead-scanner-v1";
const PASSWORD_HASH = "0b39f2293df026a351657d70aacb9154ff19102dd93b4f75888b68e7eeb7ad6c"; // placeholder for "changeme" — CHANGE BEFORE REAL USE

const STORAGE_KEY = "wc-scanner-unlocked";

export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function checkPassword(input: string): Promise<boolean> {
  return (await sha256Hex(`${APP_SALT}:${input}`)) === PASSWORD_HASH;
}

export function isUnlocked(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}
export function setUnlocked(value: boolean) {
  try {
    if (value) localStorage.setItem(STORAGE_KEY, "1");
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable (private mode, etc.) — the lock screen will just
    // reappear next load, which is the safe failure direction.
  }
}
