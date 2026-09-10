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
// Jack's real password. Only the salted hash is here — the password
// itself is not in this repo, and reading this file does not reveal it.
// To change it: `npm run hash-password -- "new password"` from app/, paste
// the printed hash in here, rebuild, republish.
const PASSWORD_HASH = "149345bd7cd3eefd1dc84b4e7ca23ce825935593779e3013c5e0f8c577f32039";
// The gate now asks for an email as well as a password. Be clear about
// what that does and does not buy: it is a SECOND THING TO KNOW, not an
// account. There is no server, so nothing verifies an identity — the page
// simply refuses to unlock unless both fields match. Real per-user
// sign-in needs a backend and is still an open decision (CLAUDE.md,
// Access & ownership). Do not describe this as user accounts.
export const AUTH_EMAIL = "jack@wiredcio.com";

// A password hash can be overridden at build time so a throwaway build
// (the test harness) never needs the real one:
//   VITE_APP_PASSWORD_HASH=<hash> npm run build
const EFFECTIVE_HASH = (import.meta.env?.VITE_APP_PASSWORD_HASH as string | undefined) || PASSWORD_HASH;

const STORAGE_KEY = "wc-scanner-unlocked";

export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function checkPassword(input: string): Promise<boolean> {
  return (await sha256Hex(`${APP_SALT}:${input}`)) === EFFECTIVE_HASH;
}

// Both must match. The email comparison is case- and whitespace-
// insensitive because nobody types their own address consistently, and
// being strict about it would only ever lock the owner out — it is not
// the part doing the security work.
export async function checkCredentials(email: string, password: string): Promise<boolean> {
  const emailOk = email.trim().toLowerCase() === AUTH_EMAIL;
  const passwordOk = await checkPassword(password);
  return emailOk && passwordOk;
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
