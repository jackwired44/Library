// Per-folder Library passwords — same salted-SHA-256 approach as the app's
// main gate (lib/auth.ts), but each folder gets its OWN random salt (stored
// alongside the hash on the LibraryGroup) instead of reusing one fixed app
// salt, so two folders that happen to share a password don't hash to the
// same value. See CLAUDE.md "Library architecture."
import { sha256Hex } from "./auth";

function randomSalt(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hashFolderPassword(password: string): Promise<{ hash: string; salt: string }> {
  const salt = randomSalt();
  const hash = await sha256Hex(`${salt}:${password}`);
  return { hash, salt };
}

export async function checkFolderPassword(password: string, hash: string, salt: string): Promise<boolean> {
  return (await sha256Hex(`${salt}:${password}`)) === hash;
}
