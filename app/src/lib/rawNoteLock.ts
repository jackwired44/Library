// The raw note stays hidden until the password is entered again.
//
// Per Jack: "raw note needs to be locked with password and not displayed."
// Covers everything that shows the CSV's own text: the Raw note column in
// All leads, and the "Raw note, CSV rows" section of the lead record.
//
// The raw-note password is its own (not the sign-in one). The unlock lives in memory only, never in storage: a reload, sign-out or
// "Lock" puts it back. While locked the raw notes are not even read out of
// IndexedDB for display. Same honest ceiling as the sign-in gate (a salted
// hash in the page, no server): it keeps the text off the screen, it is not
// an authorization boundary.
import { useEffect, useState } from "react";
import { sha256Hex } from "./auth";

// Per Jack: "for all raw notes should be snell" — its own password, separate
// from sign-in. Only the salted hash is here (same salt as lib/auth.ts).
const RAW_NOTE_SALT = "wired-cio-lead-scanner-v1";
const RAW_NOTE_HASH = "cf550394c1118e5315ea2f7f66642c8c46afc3c0a83604e02ef783652e13c919";
async function checkRawNotePassword(input: string): Promise<boolean> {
  return (await sha256Hex(`${RAW_NOTE_SALT}:${input}`)) === RAW_NOTE_HASH;
}

let unlocked = false;
const listeners = new Set<(v: boolean) => void>();

function set(v: boolean) {
  unlocked = v;
  for (const fn of listeners) fn(v);
}

export function isRawNoteUnlocked(): boolean { return unlocked; }

/** Resolves true when the password matched and the raw notes are shown. */
export async function unlockRawNotes(password: string): Promise<boolean> {
  const ok = await checkRawNotePassword(password);
  if (ok) set(true);
  return ok;
}

export function lockRawNotes(): void { set(false); }

export function useRawNoteUnlocked(): boolean {
  const [v, setV] = useState(unlocked);
  useEffect(() => {
    listeners.add(setV);
    setV(unlocked);
    return () => { listeners.delete(setV); };
  }, []);
  return v;
}
