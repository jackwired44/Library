// Profile & Access — per Jack: "add in a section for account and profile
// so i can build out others being allowed access and then start building
// around user policies etc." Confirmed scope before building: UI
// scaffolding only, no real multi-user backend yet — this tool runs
// entirely in one browser's local storage (see CLAUDE.md Access &
// ownership), so a second person can't actually see this data no matter
// what's built here. The Team/Access section says so plainly rather than
// offering a working "Invite" that would silently do nothing.
import { useState } from "react";
import type { Profile } from "../lib/profile";

interface ProfileAccessProps {
  profile: Profile;
  onSave: (patch: Pick<Profile, "name" | "role" | "org">) => void;
  onClose: () => void;
}

export default function ProfileAccess({ profile, onSave, onClose }: ProfileAccessProps) {
  const [name, setName] = useState(profile.name);
  const [role, setRole] = useState(profile.role);
  const [org, setOrg] = useState(profile.org);
  const [saved, setSaved] = useState(false);

  function handleSave() {
    onSave({ name: name.trim() || profile.name, role: role.trim(), org: org.trim() || profile.org });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <div className="notes-popover-backdrop" style={{ alignItems: "center" }} onClick={onClose}>
      <div className="profile-modal" onClick={(e) => e.stopPropagation()}>
        <div className="notes-popover-header" style={{ marginBottom: 4 }}>
          <strong style={{ fontSize: 15 }}>Profile &amp; Access</strong>
          <button onClick={onClose} className="notes-popover-close">✕</button>
        </div>

        <section style={{ marginTop: 10 }}>
          <h3 style={{ fontSize: 12.5, margin: "0 0 8px", textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--muted)" }}>Your profile</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <label className="profile-field">
              <span>Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="profile-field">
              <span>Role</span>
              <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Sales Director" />
            </label>
            <label className="profile-field">
              <span>Organization</span>
              <input value={org} onChange={(e) => setOrg(e.target.value)} />
            </label>
          </div>
          <button onClick={handleSave} className="profile-save-btn">
            {saved ? "Saved ✓" : "Save profile"}
          </button>
        </section>

        <section style={{ marginTop: 18 }}>
          <h3 style={{ fontSize: 12.5, margin: "0 0 8px", textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--muted)" }}>Team &amp; access</h3>
          <div className="profile-team-row">
            <div className="account-avatar" aria-hidden="true">{(name[0] || "J").toUpperCase()}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 12.5 }}>{name} <span style={{ color: "var(--muted)", fontWeight: 500 }}>(you)</span></div>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>{role || "—"}</div>
            </div>
            <span className="profile-role-badge">Owner</span>
          </div>
          <button className="profile-invite-btn" disabled title="Not available yet — see note below">
            + Invite teammate
          </button>
          <p style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.5, margin: "8px 0 0" }}>
            This tool runs entirely in your browser's local storage today — there's no shared backend yet, so a teammate
            can't actually see this data even once invited. This section is groundwork for real multi-user access and
            role-based policies (Owner/Admin/Rep) once that's built — see the Roadmap in CLAUDE.md.
          </p>
        </section>
      </div>
    </div>
  );
}
