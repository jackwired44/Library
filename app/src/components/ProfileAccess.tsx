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
import { ROLE_META, ROLE_ORDER, SELF_USER_ID, type PlatformUser, type UserRole } from "../lib/users";

interface ProfileAccessProps {
  profile: Profile;
  onSave: (patch: Pick<Profile, "name" | "role" | "org">) => void;
  onClose: () => void;
  // The platform-user roster sequences are attributed to (lib/users.ts).
  // These are NOT logins — see the note rendered under the list.
  users: PlatformUser[];
  onAddUser: (name: string, email: string, role: UserRole) => void;
  onEditUser: (id: string, patch: Partial<Pick<PlatformUser, "name" | "email" | "role">>) => void;
  onRemoveUser: (id: string) => void;
}

export default function ProfileAccess({ profile, onSave, onClose, users, onAddUser, onEditUser, onRemoveUser }: ProfileAccessProps) {
  const [name, setName] = useState(profile.name);
  const [role, setRole] = useState(profile.role);
  const [org, setOrg] = useState(profile.org);
  const [saved, setSaved] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState<UserRole>("rep");

  function submitUser() {
    if (!newName.trim()) return;
    onAddUser(newName, newEmail, newRole);
    setNewName("");
    setNewEmail("");
    setNewRole("rep");
  }

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
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
            {users.map((u) => (
              <div key={u.id} className="profile-team-row" style={{ gap: 8 }}>
                <div className="account-avatar" aria-hidden="true">{(u.name[0] || "?").toUpperCase()}</div>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
                  <input
                    defaultValue={u.name}
                    onBlur={(e) => { if (e.target.value.trim() && e.target.value !== u.name) onEditUser(u.id, { name: e.target.value }); }}
                    style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "3px 6px", fontSize: 12.5, fontWeight: 700 }}
                  />
                  <input
                    defaultValue={u.email}
                    placeholder="email (label only — not a login)"
                    onBlur={(e) => { if (e.target.value !== u.email) onEditUser(u.id, { email: e.target.value }); }}
                    style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "3px 6px", fontSize: 11.5, color: "var(--muted)" }}
                  />
                </div>
                <select
                  value={u.role}
                  onChange={(e) => onEditUser(u.id, { role: e.target.value as UserRole })}
                  style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "4px 6px", fontSize: 11.5, fontWeight: 700, color: ROLE_META[u.role].color, background: ROLE_META[u.role].bg }}
                >
                  {ROLE_ORDER.map((r) => (
                    <option key={r} value={r}>{ROLE_META[r].label}</option>
                  ))}
                </select>
                {u.id === SELF_USER_ID ? (
                  <span style={{ fontSize: 10.5, color: "var(--muted)", whiteSpace: "nowrap" }}>(you)</span>
                ) : (
                  <button
                    onClick={() => { if (window.confirm(`Remove ${u.name}? Any sequence they own becomes unassigned — nothing else is deleted.`)) onRemoveUser(u.id); }}
                    title="Remove from the roster"
                    style={{ border: "none", background: "none", color: "#B5443B", fontSize: 13, cursor: "pointer" }}
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitUser()}
              placeholder="Name"
              style={{ flex: "1 1 120px", border: "1px solid var(--border)", borderRadius: 7, padding: "6px 8px", fontSize: 12.5 }}
            />
            <input
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="Email (optional)"
              style={{ flex: "1 1 140px", border: "1px solid var(--border)", borderRadius: 7, padding: "6px 8px", fontSize: 12.5 }}
            />
            <select value={newRole} onChange={(e) => setNewRole(e.target.value as UserRole)} style={{ border: "1px solid var(--border)", borderRadius: 7, padding: "6px 8px", fontSize: 12.5, fontWeight: 600 }}>
              {ROLE_ORDER.map((r) => (
                <option key={r} value={r}>{ROLE_META[r].label}</option>
              ))}
            </select>
            <button
              onClick={submitUser}
              disabled={!newName.trim()}
              style={{ border: "none", background: "#2CC295", color: "#081E22", borderRadius: 7, padding: "6px 12px", fontSize: 12, fontWeight: 700, opacity: newName.trim() ? 1 : 0.5 }}
            >
              + Add user
            </button>
          </div>
          <p style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.5, margin: "8px 0 0" }}>
            <strong>These are labels, not logins.</strong> Adding someone here lets you attribute sequences to them
            (Sequences → Owner), but it does not create an account or a password. This tool runs entirely in your
            browser's local storage behind one shared password — there's no server to check a credential against, so
            anyone who unlocks the app still sees and can edit everything regardless of who a sequence is assigned to.
            Real per-user sign-in needs a hosted backend; the roles here (Owner/Admin/Rep) are the groundwork for the
            policies that would come with it — see Access &amp; ownership and the Roadmap in CLAUDE.md.
          </p>
        </section>
      </div>
    </div>
  );
}
