// Bottom-of-sidebar account block + Platform Notes scratchpad. Per Jack:
// a static identity block (this tool has no real user accounts — one
// shared password gate, see CLAUDE.md Access & ownership) whose settings
// icon opens the existing Cheat Sheet, where rule tuning already lives;
// plus a persistent notes scratchpad for internal platform notes, separate
// from per-lead notes.
import { useEffect, useRef, useState } from "react";
import { loadPlatformNotes, savePlatformNotes } from "../lib/platformNotes";

interface AccountPanelProps {
  onOpenSettings: () => void;
}

export default function AccountPanel({ onOpenSettings }: AccountPanelProps) {
  const [notesOpen, setNotesOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [notesLoaded, setNotesLoaded] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    loadPlatformNotes().then((text) => {
      setNotes(text);
      setNotesLoaded(true);
    });
  }, []);

  function handleNotesChange(value: string) {
    setNotes(value);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => savePlatformNotes(value), 500);
  }

  return (
    <div className="account-panel">
      <div className="account-row">
        <div className="account-avatar" aria-hidden="true">J</div>
        <div className="account-info">
          <div className="account-name">Jack</div>
          <div className="account-org">Wired CIO Sales</div>
        </div>
        <button onClick={onOpenSettings} title="Settings — rule tuning, thresholds, Cheat Sheet" className="account-gear">
          ⚙
        </button>
      </div>
      <button onClick={() => setNotesOpen(true)} className="notes-trigger">
        📝 Platform notes
      </button>

      {notesOpen && (
        <div className="notes-popover-backdrop" onClick={() => setNotesOpen(false)}>
          <div className="notes-popover" onClick={(e) => e.stopPropagation()}>
            <div className="notes-popover-header">
              <strong>Platform Notes</strong>
              <button onClick={() => setNotesOpen(false)} className="notes-popover-close">✕</button>
            </div>
            <textarea
              value={notes}
              onChange={(e) => handleNotesChange(e.target.value)}
              placeholder={notesLoaded ? "Internal notes about the platform/build itself — not tied to any lead." : "Loading…"}
              className="notes-textarea"
            />
            <div className="notes-popover-footer">Saved locally on this device, autosaves as you type.</div>
          </div>
        </div>
      )}
    </div>
  );
}
