// Companies — a company-level roll-up of Contacts (see lib/companies.ts).
// No company-level fields of its own yet — but a company can have a
// contact manually added to it (see CLAUDE.md "Companies: manual add
// contact"), and its expanded row is a "card" (per Jack) showing a rolled-
// up calls/emails/contacted/meetings-booked strip plus each contact —
// clicking a contact opens ContactDetail.tsx, the same detail/edit modal
// Contacts.tsx uses, for LinkedIn and outreach-tracking edits. First pass
// per Jack: "we will slowly build this out with more data fields
// (estimated employees, industry, website) and closer to an actual Apollo
// down the road" — a future LinkedIn integration and richer company
// profiles beyond this roll-up are direction, not built yet.
import { Fragment, useMemo, useState } from "react";
import { groupContactsByCompany, searchCompanies } from "../lib/companies";
import { OUTREACH_STATUS_META, type Contact, type ManualContactInput } from "../lib/contacts";
import { CATEGORY_META, DISPOSITION_META } from "../lib/detection";
import ContactDetail from "./ContactDetail";

interface CompaniesProps {
  contacts: Contact[];
  onAddContact: (input: ManualContactInput) => void;
  onUpdateContact: (id: string, patch: Partial<Contact>) => void;
}

type SortKey = "recent" | "name" | "contactCount";

export default function Companies({ contacts, onAddContact, onUpdateContact }: CompaniesProps) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("recent");
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [addingForKey, setAddingForKey] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const contactById = useMemo(() => new Map(contacts.map((c) => [c.id, c])), [contacts]);

  const companies = useMemo(() => groupContactsByCompany(contacts), [contacts]);
  const filtered = useMemo(() => {
    const list = searchCompanies(companies, search);
    const sorted = [...list];
    if (sort === "recent") sorted.sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime());
    else if (sort === "name") sorted.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "contactCount") sorted.sort((a, b) => b.contactCount - a.contactCount);
    return sorted;
  }, [companies, search, sort]);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4, flexWrap: "wrap", gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Companies</h2>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          {companies.length} compan{companies.length === 1 ? "y" : "ies"} — grouped from Contacts by exact company name match.
        </span>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "16px 0", flexWrap: "wrap" }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search company or contact name…"
          style={{ flex: "1 1 280px", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px", fontSize: 13 }}
        />
        <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", fontSize: 12.5, fontWeight: 600 }}>
          <option value="recent">Most recently seen</option>
          <option value="name">Name (A–Z)</option>
          <option value="contactCount">Most contacts</option>
        </select>
      </div>

      {companies.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--muted)", padding: "24px 0" }}>
          No companies yet — every contact with a company name (from any CSV upload) is grouped here automatically.
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--muted)", padding: "24px 0" }}>No companies match "{search}".</div>
      ) : (
        <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 12 }}>
          <table>
            <thead>
              <tr style={{ background: "var(--bg)", textAlign: "left" }}>
                <th style={{ padding: "9px 12px" }}></th>
                <th style={{ padding: "9px 12px" }}>Company</th>
                <th style={{ padding: "9px 12px" }}>Contacts</th>
                <th style={{ padding: "9px 12px" }}>Times seen</th>
                <th style={{ padding: "9px 12px" }}>Last seen</th>
                <th style={{ padding: "9px 12px" }}>Sources</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((co) => {
                const expanded = expandedKey === co.key;
                return (
                  <Fragment key={co.key}>
                    <tr style={{ borderTop: "1px solid var(--border)", cursor: "pointer" }} onClick={() => setExpandedKey(expanded ? null : co.key)}>
                      <td style={{ padding: "9px 12px", color: "var(--muted)" }}>{expanded ? "▾" : "▸"}</td>
                      <td style={{ padding: "9px 12px", fontWeight: 600 }}>{co.name}</td>
                      <td style={{ padding: "9px 12px" }}>{co.contactCount}</td>
                      <td style={{ padding: "9px 12px" }}>{co.totalTimesSeen}×</td>
                      <td style={{ padding: "9px 12px", whiteSpace: "nowrap" }} title={new Date(co.lastSeenAt).toLocaleString()}>
                        {new Date(co.lastSeenAt).toLocaleDateString()}
                      </td>
                      <td style={{ padding: "9px 12px", color: "var(--muted)", fontSize: 12 }} title={co.sourceFiles.join(", ")}>
                        {co.sourceFiles.length === 1 ? co.sourceFiles[0] : `${co.sourceFiles.length} files`}
                      </td>
                    </tr>
                    {expanded && (
                      <tr style={{ background: "var(--bg)" }}>
                        <td></td>
                        <td colSpan={5} style={{ padding: "6px 12px 12px" }}>
                          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 14px", marginBottom: 10 }}>
                            <CompanyStat label="Calls made" value={co.totalCalls} />
                            <CompanyStat label="Emails sent" value={co.totalEmails} />
                            <CompanyStat label="Contacted" value={`${co.contactedCount} / ${co.contactCount}`} />
                            <CompanyStat label="Meetings booked" value={co.meetingBookedCount} />
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
                            {co.contacts.map((p) => (
                              <div
                                key={p.id}
                                style={{
                                  display: "flex",
                                  gap: 10,
                                  fontSize: 12.5,
                                  alignItems: "center",
                                  flexWrap: "wrap",
                                  padding: "3px 6px",
                                  borderRadius: 6,
                                  background:
                                    p.disposition === "meeting-booked"
                                      ? DISPOSITION_META["meeting-booked"].bg
                                      : p.disposition === "not-interested"
                                        ? DISPOSITION_META["not-interested"].bg
                                        : undefined,
                                }}
                              >
                                <button
                                  onClick={() => setDetailId(p.id)}
                                  style={{ border: "none", background: "none", padding: 0, font: "inherit", fontWeight: 600, minWidth: 160, textAlign: "left", color: "var(--ink)", textDecoration: p.crossedOut ? "line-through" : "underline", cursor: "pointer" }}
                                >
                                  {p.fullName || "—"}
                                </button>
                                <span style={{ color: "var(--muted)", minWidth: 140 }}>{p.title || "—"}</span>
                                <span style={{ color: "var(--muted)", minWidth: 160 }}>{p.email || p.workPhone || p.mobilePhone || "—"}</span>
                                {(p.outreachStatus && p.outreachStatus !== "not-contacted") && (
                                  <span style={{ fontSize: 10, fontWeight: 700, color: OUTREACH_STATUS_META[p.outreachStatus].color, background: OUTREACH_STATUS_META[p.outreachStatus].bg, borderRadius: 999, padding: "2px 8px", whiteSpace: "nowrap" }}>
                                    {OUTREACH_STATUS_META[p.outreachStatus].label}
                                  </span>
                                )}
                                {p.category && (
                                  <span style={{ fontSize: 10, fontWeight: 700, color: CATEGORY_META[p.category].color, background: CATEGORY_META[p.category].bg, borderRadius: 999, padding: "2px 8px", whiteSpace: "nowrap" }}>
                                    {CATEGORY_META[p.category].label}
                                  </span>
                                )}
                                {p.disposition && p.disposition !== "none" && (
                                  <span
                                    title={p.dispositionNote || undefined}
                                    style={{ fontSize: 10, fontWeight: 700, color: DISPOSITION_META[p.disposition].color, background: DISPOSITION_META[p.disposition].bg, borderRadius: 999, padding: "2px 8px", whiteSpace: "nowrap" }}
                                  >
                                    {DISPOSITION_META[p.disposition].label}
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                          {addingForKey === co.key ? (
                            <AddContactForm
                              defaultCompany={co.name}
                              onSubmit={(input) => {
                                onAddContact(input);
                                setAddingForKey(null);
                              }}
                              onCancel={() => setAddingForKey(null)}
                            />
                          ) : (
                            <button
                              onClick={() => setAddingForKey(co.key)}
                              style={{ border: "1px solid var(--border)", background: "var(--surface)", borderRadius: 7, padding: "5px 10px", fontSize: 11.5, fontWeight: 700 }}
                            >
                              + Add contact
                            </button>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {detailId && contactById.get(detailId) && (
        <ContactDetail
          contact={contactById.get(detailId)!}
          onClose={() => setDetailId(null)}
          onUpdate={(patch) => onUpdateContact(detailId, patch)}
        />
      )}
    </div>
  );
}

function CompanyStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: "var(--muted)", fontWeight: 700, textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function AddContactForm({
  defaultCompany,
  onSubmit,
  onCancel,
}: {
  defaultCompany: string;
  onSubmit: (input: ManualContactInput) => void;
  onCancel: () => void;
}) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [title, setTitle] = useState("");
  // Pre-filled with the company you added from, but left freely editable —
  // per Jack, the new contact could belong to a parent or separate entity
  // rather than this exact company.
  const [company, setCompany] = useState(defaultCompany);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  const canSubmit = firstName.trim() || lastName.trim() || email.trim();

  function submit() {
    if (!canSubmit) return;
    onSubmit({ firstName: firstName.trim(), lastName: lastName.trim(), title: title.trim(), company: company.trim(), email: email.trim(), workPhone: phone.trim() });
  }

  const fieldStyle = { border: "1px solid var(--border)", borderRadius: 7, padding: "5px 8px", fontSize: 12.5 };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 9, padding: 10, maxWidth: 480 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="First name" style={{ ...fieldStyle, flex: "1 1 120px" }} />
        <input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Last name" style={{ ...fieldStyle, flex: "1 1 120px" }} />
      </div>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" style={fieldStyle} />
      <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Company" style={fieldStyle} title="Editable — this contact could belong to a parent or separate entity" />
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" style={{ ...fieldStyle, flex: "1 1 160px" }} />
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" style={{ ...fieldStyle, flex: "1 1 120px" }} />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={submit} disabled={!canSubmit} style={{ border: "none", background: canSubmit ? "#2CC295" : "#CDEFE3", color: "#081E22", borderRadius: 7, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: canSubmit ? "pointer" : "not-allowed" }}>
          Add contact
        </button>
        <button onClick={onCancel} style={{ border: "1px solid var(--border)", background: "var(--surface)", borderRadius: 7, padding: "6px 12px", fontSize: 12, fontWeight: 600 }}>
          Cancel
        </button>
      </div>
    </div>
  );
}
