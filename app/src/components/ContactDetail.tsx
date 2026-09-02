// Contact detail — a "click a contact to see more info" modal, per Jack.
// Shows everything Contacts.tsx's table already has (scan-derived category/
// disposition/matched snippet included) plus two things only editable here:
// LinkedIn (a search link that's always available, since there's no
// deterministic way to derive someone's real profile URL from name+company+
// title alone — see CLAUDE.md "Contacts: LinkedIn" — plus a manual field to
// save the real URL once found) and outreach tracking (calls made, emails
// sent, contacted/contacted-successfully/not-interested/meeting-booked
// status — a separate, directly-editable concept from the scan-derived
// `disposition` field, see lib/contacts.ts).
import { useMemo, useState } from "react";
import { CATEGORY_META, DISPOSITION_META, type Tier } from "../lib/detection";
import { OUTREACH_STATUS_META, OUTREACH_STATUS_ORDER, type Contact, type OutreachStatus } from "../lib/contacts";
import { lastActivityForContact, type Task } from "../lib/tasks";
import { listsForContact, type LeadList } from "../lib/leadLists";
import { resolveStatus, type Sequence, type SequenceEnrollment } from "../lib/sequences";
import { userLabel, type PlatformUser } from "../lib/users";

// Same tier labels/colors Contacts.tsx's own filter row uses.
const TIER_META: Record<Tier, { label: string; color: string; bg: string }> = {
  signal: { label: "Strong Signal", color: "#2CC295", bg: "#E7F1EA" },
  mention: { label: "Needs Review", color: "#9A5B22", bg: "#FBEBDD" },
  dq: { label: "Bad Lead", color: "#B5443B", bg: "#FBEAE8" },
};

interface ContactDetailProps {
  contact: Contact;
  onClose: () => void;
  onUpdate: (patch: Partial<Contact>) => void;
  // Record-details context, per Jack: "lists they're attached to and
  // sequences plus the user owner and last activity date... the product
  // lines and categories associated." All read-only cross-references
  // computed from state App.tsx already holds — no new store, and the
  // only writable field among them is the owner.
  users: PlatformUser[];
  tasks: Task[];
  leadLists: LeadList[];
  sequences: Sequence[];
  enrollments: SequenceEnrollment[];
}

export default function ContactDetail({ contact, onClose, onUpdate, users, tasks, leadLists, sequences, enrollments }: ContactDetailProps) {
  const [linkedinDraft, setLinkedinDraft] = useState(contact.linkedinUrl || "");
  const [websiteDraft, setWebsiteDraft] = useState(contact.companyWebsite || "");
  const linkedinSearchUrl = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent([contact.fullName, contact.company].filter(Boolean).join(" "))}`;

  const lastActivity = useMemo(() => lastActivityForContact(tasks, contact.id), [tasks, contact.id]);
  const listMemberships = useMemo(() => listsForContact(leadLists, [contact], contact.id), [leadLists, contact]);
  const contactEnrollments = useMemo(
    () =>
      enrollments
        .filter((e) => e.contactId === contact.id)
        .map((e) => ({ enrollment: e, sequence: sequences.find((s) => s.id === e.sequenceId) || null }))
        .sort((a, b) => b.enrollment.enrolledAt.localeCompare(a.enrollment.enrolledAt)),
    [enrollments, sequences, contact.id]
  );
  // Every product line this record touches, not just the last scan's:
  // the scan-derived category plus whatever categories their rows carry
  // on any Custom Lead List they're on.
  const associatedCategories = useMemo(() => {
    const set = new Set<string>();
    if (contact.category) set.add(contact.category);
    listMemberships.forEach((m) => m.categories.forEach((c) => set.add(c)));
    return [...set] as (keyof typeof CATEGORY_META)[];
  }, [contact.category, listMemberships]);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(8,30,34,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "var(--surface)", borderRadius: 14, padding: "22px 24px", width: "min(520px, 92vw)", maxHeight: "88vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(8,30,34,0.25)" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{contact.fullName || "—"}</div>
            <div style={{ fontSize: 13, color: "var(--muted)" }}>{contact.title || "—"} {contact.title && contact.company ? "·" : ""} {contact.company || ""}</div>
          </div>
          <button onClick={onClose} style={{ border: "none", background: "none", fontSize: 18, cursor: "pointer", color: "var(--muted)" }}>✕</button>
        </div>

        <button
          onClick={() => onUpdate({ onCrm: !contact.onCrm })}
          title="Mark whether this contact is already logged in the real CRM (Dynamics 365/HubSpot)"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            border: `1px solid ${contact.onCrm ? "#A9E4CC" : "var(--border)"}`,
            background: contact.onCrm ? "#E1F5EC" : "var(--surface-sunken)",
            color: contact.onCrm ? "#0B7A56" : "var(--muted)",
            borderRadius: 8,
            padding: "7px 12px",
            fontSize: 12.5,
            fontWeight: 700,
            cursor: "pointer",
            marginBottom: 16,
          }}
        >
          {contact.onCrm ? "✓ On CRM" : "Mark as On CRM"}
        </button>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 13, marginBottom: 16 }}>
          <DetailField label="Email" value={contact.email} />
          <DetailField label="Phone" value={contact.workPhone || contact.mobilePhone} />
          <DetailField label="Employees" value={contact.employees} />
          <DetailField label="Times seen" value={`${contact.timesSeen}× · ${new Date(contact.lastSeenAt).toLocaleDateString()}`} />
        </div>

        {/* Record details — per Jack: owner, last activity (with how long
            ago and which channel), and every product line/category this
            record is associated with. Owner is the only writable field
            here; the rest are cross-references computed from tasks, lists
            and enrollments the app already holds. */}
        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-head">
            <div className="panel-title">Record details</div>
          </div>
          <div className="panel-body" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <div className="rd-label">Owner</div>
              <select
                value={contact.ownerId || ""}
                onChange={(e) => onUpdate({ ownerId: e.target.value || null })}
                className="field"
                style={{ width: "100%", fontWeight: 600 }}
              >
                <option value="">Unassigned</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.isSelf ? `${u.name} (you)` : u.name}</option>
                ))}
              </select>
              {contact.ownerId && (
                <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 3 }}>{userLabel(users, contact.ownerId)}</div>
              )}
            </div>
            <div>
              <div className="rd-label">Last activity</div>
              {lastActivity ? (
                <div style={{ fontSize: 12.5 }}>
                  <div style={{ fontWeight: 600 }}>
                    {new Date(`${lastActivity.date}T12:00:00`).toLocaleDateString()}{" "}
                    <span style={{ color: "var(--muted)", fontWeight: 500 }}>
                      · {lastActivity.daysAgo === 0 ? "today" : lastActivity.daysAgo === 1 ? "1 day ago" : `${lastActivity.daysAgo} days ago`}
                    </span>
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
                    {lastActivity.channel === "call" ? "📞 Call" : lastActivity.channel === "email" ? "✉️ Email" : "Task"} · {lastActivity.text}
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: 12.5, color: "var(--muted)" }}>
                  No completed call, email or task logged yet.
                </div>
              )}
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <div className="rd-label">Product lines &amp; categories</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {associatedCategories.length === 0 && <span style={{ fontSize: 12, color: "var(--muted)" }}>None yet — this contact hasn't cleared detection in any scan.</span>}
                {associatedCategories.map((c) => (
                  <span key={c} style={{ fontSize: 10.5, fontWeight: 700, color: CATEGORY_META[c].color, background: CATEGORY_META[c].bg, borderRadius: 999, padding: "2px 9px" }}>
                    {CATEGORY_META[c].label}
                  </span>
                ))}
                {contact.tier && (
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: TIER_META[contact.tier].color, background: TIER_META[contact.tier].bg, borderRadius: 999, padding: "2px 9px" }}>
                    {TIER_META[contact.tier].label}
                  </span>
                )}
                {contact.disposition && contact.disposition !== "none" && (
                  <span
                    title={contact.dispositionNote || undefined}
                    style={{ fontSize: 10.5, fontWeight: 700, color: DISPOSITION_META[contact.disposition].color, background: DISPOSITION_META[contact.disposition].bg, borderRadius: 999, padding: "2px 9px" }}
                  >
                    {DISPOSITION_META[contact.disposition].label}
                  </span>
                )}
              </div>
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <div className="rd-label">Lists</div>
              {listMemberships.length === 0 ? (
                <div style={{ fontSize: 12, color: "var(--muted)" }}>Not on any Custom Lead List yet.</div>
              ) : (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {listMemberships.map(({ list }) => (
                    <span key={list.id} className="file-chip">🗂 <b>{list.name}</b> · {list.rows.length}</span>
                  ))}
                </div>
              )}
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <div className="rd-label">Sequences</div>
              {contactEnrollments.length === 0 ? (
                <div style={{ fontSize: 12, color: "var(--muted)" }}>Not enrolled in any sequence.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  {contactEnrollments.map(({ enrollment, sequence }) => (
                    <div
                      key={enrollment.id}
                      style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", background: "var(--surface-sunken)", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 10px", fontSize: 12 }}
                    >
                      <span style={{ fontWeight: 700 }}>{sequence ? sequence.name : "(sequence deleted)"}</span>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          borderRadius: 999,
                          padding: "1px 8px",
                          color: enrollment.status === "active" ? "#2CC295" : enrollment.status === "finished" ? "#0A66C2" : "var(--muted)",
                          background: enrollment.status === "active" ? "#E7F1EA" : enrollment.status === "finished" ? "#EAF3FC" : "var(--surface)",
                        }}
                      >
                        {enrollment.status === "active" ? "Active" : enrollment.status === "finished" ? "Finished" : "Removed"}
                      </span>
                      {sequence && (
                        <span style={{ color: "var(--muted)" }}>
                          Step {Math.min(enrollment.currentStepIndex + 1, Math.max(sequence.steps.length, 1))} of {sequence.steps.length}
                          {resolveStatus(sequence) !== "active" && ` · sequence ${resolveStatus(sequence)}`}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {(contact.category || contact.disposition && contact.disposition !== "none" || contact.matchedSnippet) && (
          <div style={{ background: "var(--surface-sunken)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px", marginBottom: 16 }}>
            <div style={{ fontSize: 10.5, color: "var(--muted)", fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>From the last scan</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: contact.matchedSnippet ? 6 : 0 }}>
              {contact.category && (
                <span style={{ fontSize: 10.5, fontWeight: 700, color: CATEGORY_META[contact.category].color, background: CATEGORY_META[contact.category].bg, borderRadius: 999, padding: "2px 9px" }}>
                  {CATEGORY_META[contact.category].label}
                </span>
              )}
              {contact.disposition && contact.disposition !== "none" && (
                <span
                  title={contact.dispositionNote || undefined}
                  style={{ fontSize: 10.5, fontWeight: 700, color: DISPOSITION_META[contact.disposition].color, background: DISPOSITION_META[contact.disposition].bg, borderRadius: 999, padding: "2px 9px" }}
                >
                  {DISPOSITION_META[contact.disposition].label}
                </span>
              )}
            </div>
            {contact.matchedSnippet && <div style={{ fontSize: 12, color: "var(--muted)" }}>{contact.matchedSnippet}</div>}
          </div>
        )}

        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 10.5, color: "var(--muted)", fontWeight: 700, textTransform: "uppercase", marginBottom: 8 }}>Company website</div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>
            {contact.companyWebsite
              ? "Auto-filled from the contact's email domain — edit if it's wrong, or if this contact actually belongs to a parent/separate entity."
              : "No email domain to derive a website from yet (a free provider like gmail/outlook doesn't count) — enter it manually if you know it."}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              value={websiteDraft}
              onChange={(e) => setWebsiteDraft(e.target.value)}
              placeholder="https://example.com"
              style={{ flex: 1, border: "1px solid var(--border)", borderRadius: 8, padding: "7px 10px", fontSize: 12.5 }}
            />
            <button
              onClick={() => onUpdate({ companyWebsite: websiteDraft.trim() })}
              disabled={websiteDraft.trim() === (contact.companyWebsite || "")}
              style={{ border: "none", borderRadius: 8, padding: "7px 14px", fontWeight: 700, fontSize: 12.5, background: websiteDraft.trim() === (contact.companyWebsite || "") ? "var(--surface-sunken)" : "var(--accent)", color: websiteDraft.trim() === (contact.companyWebsite || "") ? "#B7BEC4" : "#081E22" }}
            >
              Save
            </button>
          </div>
          {contact.companyWebsite && (
            <a href={contact.companyWebsite} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: "#0A66C2", display: "inline-block", marginTop: 6 }}>
              {contact.companyWebsite}
            </a>
          )}
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 10.5, color: "var(--muted)", fontWeight: 700, textTransform: "uppercase", marginBottom: 8 }}>LinkedIn</div>
          <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
            <a href={linkedinSearchUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12.5, fontWeight: 700, color: "#0A66C2", background: "#EAF3FC", border: "1px solid #CFE3F7", borderRadius: 8, padding: "7px 12px", textDecoration: "none" }}>
              Search LinkedIn ↗
            </a>
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>
            No automatic profile match — LinkedIn URLs aren't derivable from name/company/title alone. Search above, then paste the real profile link here once you find it (or use "Enrich via Apollo" from the Contacts list to try a verified match).
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              value={linkedinDraft}
              onChange={(e) => setLinkedinDraft(e.target.value)}
              placeholder="https://www.linkedin.com/in/…"
              style={{ flex: 1, border: "1px solid var(--border)", borderRadius: 8, padding: "7px 10px", fontSize: 12.5 }}
            />
            <button
              onClick={() => onUpdate({ linkedinUrl: linkedinDraft.trim() })}
              disabled={linkedinDraft.trim() === (contact.linkedinUrl || "")}
              style={{ border: "none", borderRadius: 8, padding: "7px 14px", fontWeight: 700, fontSize: 12.5, background: linkedinDraft.trim() === (contact.linkedinUrl || "") ? "var(--surface-sunken)" : "var(--accent)", color: linkedinDraft.trim() === (contact.linkedinUrl || "") ? "#B7BEC4" : "#081E22" }}
            >
              Save
            </button>
          </div>
          {contact.linkedinUrl && (
            <a href={contact.linkedinUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: "#0A66C2", display: "inline-block", marginTop: 6 }}>
              {contact.linkedinUrl}
            </a>
          )}
        </div>

        <div>
          <div style={{ fontSize: 10.5, color: "var(--muted)", fontWeight: 700, textTransform: "uppercase", marginBottom: 8 }}>Outreach</div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
            <Counter label="Calls made" value={contact.callCount || 0} onChange={(v) => onUpdate({ callCount: v })} />
            <Counter label="Emails sent" value={contact.emailCount || 0} onChange={(v) => onUpdate({ emailCount: v })} />
          </div>
          <select
            value={contact.outreachStatus || "not-contacted"}
            onChange={(e) => onUpdate({ outreachStatus: e.target.value as OutreachStatus })}
            style={{
              width: "100%",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "8px 10px",
              fontSize: 13,
              fontWeight: 700,
              color: OUTREACH_STATUS_META[contact.outreachStatus || "not-contacted"].color,
              background: OUTREACH_STATUS_META[contact.outreachStatus || "not-contacted"].bg,
            }}
          >
            {OUTREACH_STATUS_ORDER.map((s) => (
              <option key={s} value={s}>{OUTREACH_STATUS_META[s].label}</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: string | undefined }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, color: "var(--muted)", fontWeight: 700, textTransform: "uppercase" }}>{label}</div>
      <div>{value || "—"}</div>
    </div>
  );
}

function Counter({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, border: "1px solid var(--border)", borderRadius: 8, padding: "6px 10px" }}>
      <span style={{ fontSize: 12, fontWeight: 600 }}>{label}</span>
      <button onClick={() => onChange(Math.max(0, value - 1))} style={{ border: "none", background: "var(--surface-sunken)", borderRadius: 6, width: 22, height: 22, cursor: "pointer", fontWeight: 700 }}>−</button>
      <span style={{ minWidth: 18, textAlign: "center", fontWeight: 700 }}>{value}</span>
      <button onClick={() => onChange(value + 1)} style={{ border: "none", background: "var(--surface-sunken)", borderRadius: 6, width: 22, height: 22, cursor: "pointer", fontWeight: 700 }}>+</button>
    </div>
  );
}
