// The raw note stays hidden until the password is entered again.
//
// Per Jack: "raw note needs to be locked with password and not displayed."
// Covers everything that shows the CSV's own text: the Raw note column in
// All leads, and the "Raw note, CSV rows" section of the lead record.
//
// The unlock lives in memory only, never in storage: a reload, sign-out or
// "Lock" puts it back. While locked the raw notes are not even read out of
// IndexedDB for display. Same honest ceiling as the sign-in gate (a salted
// hash in the page, no server): it keeps the text off the screen, it is not
// an authorization boundary.
import { useEffect, useState } from "react";
import { checkPassword } from "./auth";

let unlocked = false;
const listeners = new Set<(v: boolean) => void>();

function set(v: boolean) {
  unlocked = v;
  for (const fn of listeners) fn(v);
}

export function isRawNoteUnlocked(): boolean { return unlocked; }

/** Resolves true when the password matched and the raw notes are shown. */
export async function unlockRawNotes(password: string): Promise<boolean> {
  const ok = await checkPassword(password);
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
