// Bottom-of-sidebar account block. Per Jack, confirmed before building: the
// identity block reflects a real (locally-saved) profile now, editable via
// clicking it — but this is still a single-user tool with one shared
// password gate (see CLAUDE.md Access & ownership), so Profile & Access's
// Team section is scaffolding, not a working invite flow. The settings
// gear and the "Platform notes" trigger both open the shared Platform
// Notes/Cheat Sheet panel App.tsx owns (see CLAUDE.md "Cheat Sheet
// relocation + dated Platform Notes") — this component no longer renders
// either modal itself.
import { useEffect, useState } from "react";
import { loadProfile, saveProfile, type Profile } from "../lib/profile";
import ProfileAccess from "./ProfileAccess";
import type { PlatformUser, UserRole } from "../lib/users";
import { formatTimeInZone, localTimeZone, zoneAbbrev, zoneLabel } from "../lib/timezones";
import { useNow } from "../lib/useNow";

interface AccountPanelProps {
  users: PlatformUser[];
  onAddUser: (name: string, email: string, role: UserRole) => void;
  onEditUser: (id: string, patch: Partial<Pick<PlatformUser, "name" | "email" | "role">>) => void;
  onRemoveUser: (id: string) => void;
  onOpenSettings: () => void;
  onOpenNotes: () => void;
}

// Eastern / Mountain / Pacific reference clocks. Mountain uses Denver
// (observes DST) rather than Arizona — "MST" in Jack's ask reads as the
// Mountain zone generally, not Arizona's year-round MST.
const US_ZONE_CHEAT = [
  { label: "Eastern", zone: "America/New_York" },
  { label: "Mountain", zone: "America/Denver" },
  { label: "Pacific", zone: "America/Los_Angeles" },
];

export default function AccountPanel({ onOpenSettings, onOpenNotes, users, onAddUser, onEditUser, onRemoveUser }: AccountPanelProps) {
  // The local user's own clock/zone — per Jack, shown "for the local user
  // using the platform" as the reference every contact's offset is
  // measured against (see lib/timezones.ts).
  const now = useNow();
  const localZone = localTimeZone();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);

  useEffect(() => {
    loadProfile().then(setProfile);
  }, []);

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
          <div className="account-org" title={`Your time zone, as this browser reports it: ${localZone}`}>
            🕒 {formatTimeInZone(localZone, now)} {zoneAbbrev(localZone, now)} · {zoneLabel(localZone)}
          </div>
        </div>
      </button>
      {/* US time-zone cheat window — per Jack: "a little cheat sheet window
          below the jack sales director at the bottom to show mst current
          time est and pst." Same 30s tick as the local clock above; the
          abbreviation is live (EDT/MDT/PDT in summer), so DST is never
          misread. */}
      <div className="tz-cheat" title="Current time in the three US zones most leads sit in">
        {US_ZONE_CHEAT.map((z) => (
          <div key={z.zone} className="tz-cheat-cell">
            <div className="tz-cheat-label">{z.label}</div>
            <div className="tz-cheat-time">{formatTimeInZone(z.zone, now)}</div>
            <div className="tz-cheat-abbr">{zoneAbbrev(z.zone, now)}</div>
          </div>
        ))}
      </div>
      <button onClick={onOpenSettings} title="Cheat Sheet — how leads qualify, hot signals, product-line breakdown" className="account-gear account-gear-standalone">
        ❓ Cheat Sheet
      </button>
      <button onClick={onOpenNotes} className="notes-trigger">
        📝 Platform notes
      </button>

      {profileOpen && profile && (
        <ProfileAccess
          profile={profile}
          onSave={handleSaveProfile}
          onClose={() => setProfileOpen(false)}
          users={users}
          onAddUser={onAddUser}
          onEditUser={onEditUser}
          onRemoveUser={onRemoveUser}
        />
      )}
    </div>
  );
}
