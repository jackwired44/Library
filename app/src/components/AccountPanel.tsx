// Bottom-of-sidebar account block + Platform Notes scratchpad + Profile &
// Access. Per Jack, confirmed before building: the identity block reflects
// a real (locally-saved) profile now, editable via clicking it — but this
// is still a single-user tool with one shared password gate (see CLAUDE.md
// Access & ownership), so the settings gear still opens the existing Cheat
// Sheet, and Profile & Access's Team section is scaffolding, not a working
// invite flow.
import { useEffect, useRef, useState } from "react";
import { loadPlatformNotes, savePlatformNotes } from "../lib/platformNotes";
import { loadProfile, saveProfile, type Profile } from "../lib/profile";
import ProfileAccess from "./ProfileAccess";

interface AccountPanelProps {
  onOpenSettings: () => void;
}

export default function AccountPanel({ onOpenSettings }: AccountPanelProps) {
  const [notesOpen, setNotesOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [notesLoaded, setNotesLoaded] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);

  useEffect(() => {
    loadPlatformNotes().then((text) => {
      setNotes(text);
      setNotesLoaded(true);
    });
    loadProfile().then(setProfile);
  }, []);

  function handleNotesChange(value: string) {
    setNotes(value);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => savePlatformNotes(value), 500);
  }

  function handleSaveProfile(patch: Pick<Profile, "name" | "role" | "org">) {
    if (!profile) return;
    const next: Profile = { ...profile, ...patch, updatedAt: new Date().toISOString() };
    setProfile(next);
    saveProfile(next);
  }

  return (
    <div className="account-panel">
      <button className="account-row account-row-btn" onClick={() => setProfileOpen(true)} title="Profile & access">
        <div className="account-avatar" aria-hidden="true">{(profile?.name?.[0] || "J").toUpperCase()}</div>
        <div className="account-info">
          <div className="account-name">{profile?.name || "Jack"}</div>
          <div className="account-org">{[profile?.role, profile?.org].filter(Boolean).join(" · ") || "Wired CIO"}</div>
        </div>
      </button>
      <button onClick={onOpenSettings} title="Settings — rule tuning, thresholds, Cheat Sheet" className="account-gear account-gear-standalone">
        ⚙ Settings
      </button>
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

      {profileOpen && profile && <ProfileAccess profile={profile} onSave={handleSaveProfile} onClose={() => setProfileOpen(false)} />}
    </div>
  );
}
