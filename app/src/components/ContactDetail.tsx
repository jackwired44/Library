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
import { useState } from "react";
import { CATEGORY_META, DISPOSITION_META } from "../lib/detection";
import { OUTREACH_STATUS_META, OUTREACH_STATUS_ORDER, type Contact, type OutreachStatus } from "../lib/contacts";

interface ContactDetailProps {
  contact: Contact;
  onClose: () => void;
  onUpdate: (patch: Partial<Contact>) => void;
}

export default function ContactDetail({ contact, onClose, onUpdate }: ContactDetailProps) {
  const [linkedinDraft, setLinkedinDraft] = useState(contact.linkedinUrl || "");
  const linkedinSearchUrl = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent([contact.fullName, contact.company].filter(Boolean).join(" "))}`;

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

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 13, marginBottom: 16 }}>
          <DetailField label="Email" value={contact.email} />
          <DetailField label="Phone" value={contact.workPhone || contact.mobilePhone} />
          <DetailField label="Employees" value={contact.employees} />
          <DetailField label="Times seen" value={`${contact.timesSeen}× · ${new Date(contact.lastSeenAt).toLocaleDateString()}`} />
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
