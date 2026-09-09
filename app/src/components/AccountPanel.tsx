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
import {
  browserTimeZone,
  formatTimeInZone,
  lockedTimeZone,
  setLockedTimeZone,
  TIME_ZONE_CHOICES,
  zoneAbbrev,
  zoneLabel,
} from "../lib/timezones";
import { useNow } from "../lib/useNow";

interface AccountPanelProps {
  users: PlatformUser[];
  onAddUser: (name: string, email: string, role: UserRole) => void;
  onEditUser: (id: string, patch: Partial<Pick<PlatformUser, "name" | "email" | "role">>) => void;
  onRemoveUser: (id: string) => void;
  onOpenSettings: () => void;
  onOpenNotes: () => void;
}

// The four continental US zones, north to south of the map as you read
// left to right. Mountain uses Denver (observes DST) rather than Arizona —
// "MST" in Jack's ask reads as the Mountain zone generally, not Arizona's
// year-round MST.
const US_ZONE_CHEAT = [
  { label: "Eastern", zone: "America/New_York" },
  { label: "Central", zone: "America/Chicago" },
  { label: "Mountain", zone: "America/Denver" },
  { label: "Pacific", zone: "America/Los_Angeles" },
];

// Which of the four the person using the platform is actually sitting in.
// Compared by UTC OFFSET at this moment, not by zone id, so a browser
// reporting America/Detroit or America/Winnipeg still lights up the right
// row instead of matching nothing. A rep outside all four (or on a
// half-hour offset) simply gets no highlight rather than a wrong one.
function matchesLocalZone(zone: string, localZone: string, now: Date): boolean {
  try {
    return formatTimeInZone(zone, now) === formatTimeInZone(localZone, now);
  } catch {
    return false;
  }
}

export default function AccountPanel({ onOpenSettings, onOpenNotes, users, onAddUser, onEditUser, onRemoveUser }: AccountPanelProps) {
  // The local user's own clock/zone — per Jack, shown "for the local user
  // using the platform" as the reference every contact's offset is
  // measured against (see lib/timezones.ts).
  const now = useNow();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  // Held in state purely so the panel repaints the moment the lock
  // changes; localTimeZone() is still the source of truth everywhere else.
  const [locked, setLocked] = useState<string | null>(() => lockedTimeZone());
  const [tzOpen, setTzOpen] = useState(false);
  const localZone = locked || browserTimeZone();
  const deviceZone = browserTimeZone();

  function chooseZone(zone: string | null) {
    setLockedTimeZone(zone);
    setLocked(zone);
    setTzOpen(false);
  }

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
        </div>
      </button>
      {/* US time-zone cheat window — per Jack: "a little cheat sheet window
          below the jack sales director at the bottom to show mst current
          time est and pst." Same 30s tick as the local clock above; the
          abbreviation is live (EDT/MDT/PDT in summer), so DST is never
          misread. */}
      <div className="tz-cheat" title="Current time in the four continental US zones. Your own zone is highlighted.">
        {US_ZONE_CHEAT.map((z) => {
          const isYou = matchesLocalZone(z.zone, localZone, now);
          return (
            <div
              key={z.zone}
              className={`tz-cheat-cell${isYou ? " tz-cheat-you" : ""}`}
              title={isYou ? (locked ? `You are here — locked to ${zoneLabel(localZone)}` : `You are here — this device reports ${zoneLabel(localZone)}`) : undefined}
            >
              <div className="tz-cheat-label">{z.label}</div>
              <div className="tz-cheat-time">{formatTimeInZone(z.zone, now)}</div>
              <div className="tz-cheat-abbr">{zoneAbbrev(z.zone, now)}</div>
            </div>
          );
        })}
      </div>
      {/* Per Jack: pick a zone and lock it, for travelling or for working
          another region's hours. Locked pins what "you" means everywhere —
          this clock, the highlighted row above, and every contact's
          "+2h from you" offset. */}
      <div className="tz-lock">
        <button
          className="tz-lock-btn"
          onClick={() => setTzOpen((v) => !v)}
          aria-expanded={tzOpen}
          title={
            locked
              ? `Locked to ${zoneLabel(locked)}. This device reports ${zoneLabel(deviceZone)}.`
              : `Following this device (${zoneLabel(deviceZone)}). Click to lock a zone.`
          }
        >
          <span className="tz-lock-icon" aria-hidden="true">{locked ? "🔒" : "📍"}</span>
          <span className="tz-lock-text">
            {formatTimeInZone(localZone, now)} {zoneAbbrev(localZone, now)}
            <span className="tz-lock-sub">{locked ? "Locked" : "Follows this device"}</span>
          </span>
        </button>
        {tzOpen && (
          <div className="tz-lock-pop">
            <label className="tz-lock-label" htmlFor="tz-lock-select">Your time zone</label>
            <select
              id="tz-lock-select"
              aria-label="Your time zone"
              className="tz-lock-select"
              value={locked || ""}
              onChange={(e) => chooseZone(e.target.value || null)}
            >
              <option value="">Follow this device ({zoneLabel(deviceZone)})</option>
              {TIME_ZONE_CHOICES.map((c) => (
                <option key={c.zone} value={c.zone}>{c.label}</option>
              ))}
            </select>
            <p className="tz-lock-note">
              {locked
                ? "Locked — stays put even if you open this from another machine or another country."
                : "Following whatever zone this device reports, so it moves when you travel."}
            </p>
            {locked && (
              <button className="tz-lock-clear" onClick={() => chooseZone(null)}>Unlock, follow this device</button>
            )}
          </div>
        )}
      </div>
      <button onClick={onOpenSettings} title="Settings — qualification rules, hot signals, thresholds, dispositions" className="account-gear account-gear-standalone">
        ⚙ Settings
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
