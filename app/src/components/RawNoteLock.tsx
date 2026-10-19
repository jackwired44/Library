// The password box that stands in for a hidden raw note — see
// lib/rawNoteLock.ts.
import { useState } from "react";
import { lockRawNotes, unlockRawNotes, useRawNoteUnlocked } from "../lib/rawNoteLock";

export default function RawNoteLock({ compact = false }: { compact?: boolean }) {
  const unlocked = useRawNoteUnlocked();
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  if (unlocked) {
    return (
      <button className="btn btn-sm btn-ghost" onClick={lockRawNotes} title="Hide raw notes again" aria-label="Lock raw notes">
        🔓 Lock raw notes
      </button>
    );
  }
  const submit = async () => {
    if (!pw || busy) return;
    setBusy(true);
    const ok = await unlockRawNotes(pw);
    setBusy(false);
    if (ok) { setPw(""); setErr(""); setOpen(false); }
    else setErr("Wrong password.");
  };
  if (compact && !open) {
    return (
      <button className="btn btn-sm btn-ghost" onClick={() => setOpen(true)} aria-label="Unlock raw notes" title="Raw notes are locked. Enter the password to show them.">
        🔒 Locked
      </button>
    );
  }
  return (
    <form onSubmit={(e) => { e.preventDefault(); void submit(); }} style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <span style={{ fontSize: 12.5 }}>🔒 Raw notes are locked.</span>
      <input className="field" type="password" autoFocus={compact} placeholder="Password" aria-label="Raw note password"
             value={pw} onChange={(e) => { setPw(e.target.value); setErr(""); }} style={{ width: 140 }} />
      <button className="btn btn-sm btn-secondary" type="submit" disabled={!pw || busy}>Unlock</button>
      {compact && <button className="btn btn-sm btn-ghost" type="button" onClick={() => { setOpen(false); setPw(""); setErr(""); }}>Cancel</button>}
      {err && <span role="alert" style={{ color: "var(--danger, #B5443B)", fontSize: 12 }}>{err}</span>}
    </form>
  );
}
