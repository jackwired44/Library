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

// A SECOND gate, on the Scanner view only, per Jack: "lock the actual
// scanner in the platform for now." The point is to be able to open the
// platform in front of someone without also handing them the machine that
// processes raw lead files. Its own password, its own unlock state — so
// signing in does not unlock the Scanner, and locking the Scanner does not
// sign you out.
//
// Same honest ceiling as the sign-in gate: a salted hash in the page, no
// server, no rate limiting. It keeps someone out of a screen; it is not
// an authorization boundary, and the data behind it still lives in this
// browser either way.
const SCANNER_PASSWORD_HASH = "961789a62433a03a8a48e955c88ea3a35b91b12b9536f0197deea9e561b882fe";
const EFFECTIVE_SCANNER_HASH =
  (import.meta.env?.VITE_APP_SCANNER_HASH as string | undefined) || SCANNER_PASSWORD_HASH;
// Per Jack: the Scanner is ALWAYS locked. Unlike the sign-in gate there
// is deliberately no persistence at all — not localStorage, not
// sessionStorage — so the password is required every single time the
// screen is opened, and a reload or a trip to any other tab re-locks it.
// The unlock lives only in React state in App.tsx, which is why there is
// nothing here to read or write it.
export async function checkScannerPassword(input: string): Promise<boolean> {
  return (await sha256Hex(`${APP_SALT}:${input}`)) === EFFECTIVE_SCANNER_HASH;
}

export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function checkPassword(input: string): Promise<boolean> {
  return (await sha256Hex(`${APP_SALT}:${input}`)) === EFFECTIVE_HASH;
}

// Per Jack: "her user will be carly@wiredcio.com to log in and carly1 for
// password here". A second sign-in, so Carly lands on her own view. Same
// honest ceiling as Jack's: a salted hash in the page, no server. It picks
// WHICH VIEW opens, it does not wall off data — everything stored in this
// browser is visible to whoever signs in here, and on another computer
// there is nothing stored yet. Real per-user access is still a backend
// decision (CLAUDE.md, Access & ownership).
export interface Account { email: string; name: string; rep: string }
const CARLY_PASSWORD_HASH = "e02a30bbbec177ab7cd55c2d71ecb04dcf56580a7e9fa4c0faebd13e831462af";
export const ACCOUNTS: Account[] = [
  { email: AUTH_EMAIL, name: "Jack", rep: "Jack" },
  { email: "carly@wiredcio.com", name: "Carly", rep: "Carly" },
];
const ACCOUNT_KEY = "wc-signed-in-as";

// Both must match. The email comparison is case- and whitespace-
// insensitive because nobody types their own address consistently, and
// being strict about it would only ever lock the owner out — it is not
// the part doing the security work. Returns the account, or null.
export async function signIn(email: string, password: string): Promise<Account | null> {
  const e = email.trim().toLowerCase();
  const h = await sha256Hex(`${APP_SALT}:${password}`);
  const acct = ACCOUNTS.find((a) => a.email === e);
  if (!acct) return null;
  const ok = acct.email === AUTH_EMAIL ? h === EFFECTIVE_HASH : h === CARLY_PASSWORD_HASH;
  return ok ? acct : null;
}
export async function checkCredentials(email: string, password: string): Promise<boolean> {
  return !!(await signIn(email, password));
}
/** Who signed in on this browser. Jack when nothing is recorded (a session
 *  from before Carly's login existed). */
export function currentAccount(): Account {
  let e = "";
  try { e = localStorage.getItem(ACCOUNT_KEY) || ""; } catch { /* storage unavailable */ }
  return ACCOUNTS.find((a) => a.email === e) ?? ACCOUNTS[0];
}
export function setCurrentAccount(a: Account | null) {
  try {
    if (a) localStorage.setItem(ACCOUNT_KEY, a.email);
    else localStorage.removeItem(ACCOUNT_KEY);
  } catch { /* storage unavailable */ }
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
