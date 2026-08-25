// Contacts — a searchable, permanent directory of every person ever seen
// in a CSV upload, deduplicated across uploads (see lib/contacts.ts for the
// dedup rules). The CSV-sourced fields (name/title/company/email/phone)
// stay read-only here — that data still lives on the lead itself in
// Scanner/Library — but a contact CAN be turned into a dated, prioritized
// follow-up task (see CLAUDE.md "Contact tasks"), and clicking a contact's
// name opens ContactDetail.tsx, where LinkedIn and outreach tracking
// (calls/emails/status) ARE directly editable (see CLAUDE.md "Contacts:
// detail view, LinkedIn, and outreach tracking"). Selecting contacts here
// and clicking "Enrich via Apollo" runs a live, viewer-driven Apollo
// people-match pass (see lib/apolloEnrich.ts) — never automatic.
import { Fragment, useMemo, useState } from "react";
import { OUTREACH_STATUS_META, type Contact, searchContacts } from "../lib/contacts";
import { CATEGORY_META, DISPOSITION_META } from "../lib/detection";
import { checkApolloAvailability, enrichContactsViaApollo, type EnrichOutcome } from "../lib/apolloEnrich";
import ContactDetail from "./ContactDetail";
import type { Task, TaskPriority } from "../lib/tasks";

const MAX_ENRICH_BATCH = 10;

interface ContactsProps {
  contacts: Contact[];
  loading: boolean;
  error: string | null;
  tasks: Task[];
  onAddContactTask: (contactId: string, date: string, priority: TaskPriority, text: string) => void;
  onToggleTask: (id: string) => void;
  onDeleteTask: (id: string) => void;
  onUpdateContact: (id: string, patch: Partial<Contact>) => void;
  // Seeds the search box on mount — set when arriving here from the header
  // search (see App.tsx/HeaderSearch.tsx). This component remounts fresh
  // each time Engage's Contacts tab is selected, so an initial-only state
  // seed is enough; no need to react to later prop changes.
  initialSearch?: string;
}

type SortKey = "recent" | "name" | "company" | "timesSeen";

const PRIORITY_META: Record<TaskPriority, { label: string; color: string; bg: string; rank: number }> = {
  high: { label: "High", color: "#B5443B", bg: "#FBE4E1", rank: 0 },
  medium: { label: "Medium", color: "#9A6B00", bg: "#FCEFC7", rank: 1 },
  low: { label: "Low", color: "#2E6B4A", bg: "#E1F2E7", rank: 2 },
};

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function Contacts({ contacts, loading, error, tasks, onAddContactTask, onToggleTask, onDeleteTask, onUpdateContact, initialSearch }: ContactsProps) {
  const [search, setSearch] = useState(initialSearch || "");
  const [sort, setSort] = useState<SortKey>("recent");
  const [addingForId, setAddingForId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  // Apollo enrichment — per Jack, explicit and selection-driven only ("as
  // i select i dont want to have too much going on in the background yet
  // i cant see"): nothing runs until contacts are checked here and the
  // button is clicked, and every contact's outcome is shown individually
  // below, not collapsed into one spinner.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [enriching, setEnriching] = useState(false);
  const [enrichOutcomes, setEnrichOutcomes] = useState<EnrichOutcome[] | null>(null);
  const [enrichError, setEnrichError] = useState<string | null>(null);

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function runEnrichment() {
    const targets = contacts.filter((c) => selected.has(c.id));
    if (targets.length === 0 || targets.length > MAX_ENRICH_BATCH) return;
    setEnriching(true);
    setEnrichError(null);
    setEnrichOutcomes(null);
    try {
      const availability = await checkApolloAvailability();
      if (availability !== "available") {
        setEnrichError(
          availability === "not-connected"
            ? "Apollo isn't connected — add it in claude.ai Settings → Connectors, then try again."
            : "Apollo enrichment isn't available in this view."
        );
        return;
      }
      const outcomes = await enrichContactsViaApollo(targets);
      outcomes.forEach((o) => {
        if (o.status === "matched") onUpdateContact(o.contactId, { linkedinUrl: o.linkedinUrl });
      });
      setEnrichOutcomes(outcomes);
    } catch (err) {
      setEnrichError(err instanceof Error ? err.message : "Apollo enrichment failed.");
    } finally {
      setEnriching(false);
    }
  }

  const contactById = useMemo(() => new Map(contacts.map((c) => [c.id, c])), [contacts]);
  const contactTasks = useMemo(
    () =>
      tasks
        .filter((t): t is Task & { contactId: string; priority: TaskPriority } => Boolean(t.contactId && t.priority && contactById.has(t.contactId)))
        .sort((a, b) => PRIORITY_META[a.priority].rank - PRIORITY_META[b.priority].rank || a.date.localeCompare(b.date)),
    [tasks, contactById]
  );

  function submitContactTask(contact: Contact, date: string, priority: TaskPriority, note: string) {
    const base = `Follow up with ${contact.fullName || contact.company}${contact.company && contact.fullName ? ` (${contact.company})` : ""}`;
    const text = note.trim() ? `${base} — ${note.trim()}` : base;
    onAddContactTask(contact.id, date, priority, text);
    setAddingForId(null);
  }

  const filtered = useMemo(() => {
    const list = searchContacts(contacts, search);
    const sorted = [...list];
    if (sort === "recent") sorted.sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime());
    else if (sort === "name") sorted.sort((a, b) => a.fullName.localeCompare(b.fullName));
    else if (sort === "company") sorted.sort((a, b) => a.company.localeCompare(b.company));
    else if (sort === "timesSeen") sorted.sort((a, b) => b.timesSeen - a.timesSeen);
    return sorted;
  }, [contacts, search, sort]);

  if (loading) return <div style={{ color: "var(--muted)", fontSize: 13 }}>Loading contacts…</div>;
  if (error) return <div style={{ color: "#B5443B", fontSize: 13 }}>{error}</div>;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4, flexWrap: "wrap", gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Contacts</h2>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          {contacts.length} contact{contacts.length === 1 ? "" : "s"} across every upload — deduplicated by email, then name + company.
        </span>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "16px 0", flexWrap: "wrap" }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, company, title, email, or phone…"
          style={{ flex: "1 1 280px", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px", fontSize: 13 }}
        />
        <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", fontSize: 12.5, fontWeight: 600 }}>
          <option value="recent">Most recently seen</option>
          <option value="name">Name (A–Z)</option>
          <option value="company">Company (A–Z)</option>
          <option value="timesSeen">Times seen (most first)</option>
        </select>
      </div>

      <div style={{ marginBottom: 22 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
          <h3 style={{ margin: 0, fontSize: 14 }}>Tasks</h3>
          <span style={{ fontSize: 11.5, color: "var(--muted)" }}>Sorted by priority, then date — highest priority first</span>
        </div>
        {contactTasks.length === 0 ? (
          <div style={{ fontSize: 12.5, color: "var(--muted)", border: "1px dashed var(--border)", borderRadius: 10, padding: "14px 16px" }}>
            No contact tasks yet — use "+ Task" on any contact below to schedule a dated, prioritized follow-up.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {contactTasks.map((t) => {
              const contact = contactById.get(t.contactId);
              const meta = PRIORITY_META[t.priority];
              return (
                <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "8px 12px" }}>
                  <input type="checkbox" checked={t.done} onChange={() => onToggleTask(t.id)} />
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: meta.color, background: meta.bg, borderRadius: 999, padding: "2px 9px", flexShrink: 0 }}>{meta.label}</span>
                  <span style={{ fontSize: 12, color: "var(--muted)", flexShrink: 0, whiteSpace: "nowrap" }}>{t.date}</span>
                  <span style={{ fontSize: 13, flex: 1, textDecoration: t.done ? "line-through" : "none", color: t.done ? "var(--muted)" : "var(--ink)" }}>
                    {t.text}
                  </span>
                  {contact && <span style={{ fontSize: 11.5, color: "var(--muted)" }}>{contact.company}</span>}
                  <button onClick={() => onDeleteTask(t.id)} title="Delete task" style={{ border: "none", background: "none", color: "#B5443B", fontSize: 13, cursor: "pointer" }}>✕</button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {contacts.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--muted)", padding: "24px 0" }}>
          No contacts yet — every CSV you upload through the Scanner or file directly into a Lead Library folder adds its rows here automatically.
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--muted)", padding: "24px 0" }}>No contacts match "{search}".</div>
      ) : (
        <>
        {selected.size > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#EAF3FC", border: "1px solid #CFE3F7", borderRadius: 11, padding: "10px 14px", marginBottom: 12, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700, color: "#0A4A85" }}>{selected.size} selected</span>
            <button
              onClick={runEnrichment}
              disabled={enriching || selected.size > MAX_ENRICH_BATCH}
              title={selected.size > MAX_ENRICH_BATCH ? `Select ${MAX_ENRICH_BATCH} or fewer to enrich at once` : undefined}
              style={{ border: "none", borderRadius: 8, padding: "7px 14px", fontWeight: 700, fontSize: 12.5, background: enriching || selected.size > MAX_ENRICH_BATCH ? "#CFE3F7" : "#0A66C2", color: "#fff", cursor: enriching || selected.size > MAX_ENRICH_BATCH ? "not-allowed" : "pointer" }}
            >
              {enriching ? "Enriching…" : "Enrich via Apollo"}
            </button>
            {selected.size > MAX_ENRICH_BATCH && <span style={{ fontSize: 11.5, color: "#8A5A00" }}>Select {MAX_ENRICH_BATCH} or fewer at once.</span>}
            <button onClick={() => setSelected(new Set())} style={{ background: "none", border: "none", textDecoration: "underline", fontSize: 12 }}>Clear selection</button>
          </div>
        )}
        {enrichError && <div style={{ marginBottom: 12, color: "#B5443B", fontSize: 12.5 }}>{enrichError}</div>}
        {enrichOutcomes && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 12 }}>
            {enrichOutcomes.map((o) => {
              const c = contactById.get(o.contactId);
              return (
                <div key={o.contactId} style={{ fontSize: 12, display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontWeight: 600, minWidth: 160 }}>{c?.fullName || c?.company || o.contactId}</span>
                  {o.status === "matched" && <span style={{ color: "#2CC295", fontWeight: 700 }}>✓ Matched — LinkedIn saved</span>}
                  {o.status === "no-match" && <span style={{ color: "var(--muted)" }}>No confident match</span>}
                  {o.status === "error" && <span style={{ color: "#B5443B" }}>Error — {o.errorMessage}</span>}
                </div>
              );
            })}
          </div>
        )}
        <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 12 }}>
          <table>
            <thead>
              <tr style={{ background: "var(--bg)", textAlign: "left" }}>
                <th style={{ width: 30 }}></th>
                <th style={{ padding: "9px 12px" }}>Contact</th>
                <th style={{ padding: "9px 12px" }}>Company</th>
                <th style={{ padding: "9px 12px" }}>Title</th>
                <th style={{ padding: "9px 12px" }}>Email</th>
                <th style={{ padding: "9px 12px" }}>Phone</th>
                <th style={{ padding: "9px 12px" }}>Product line</th>
                <th style={{ padding: "9px 12px" }}>Disposition</th>
                <th style={{ padding: "9px 12px" }}>Matched snippet</th>
                <th style={{ padding: "9px 12px" }}>Outreach</th>
                <th style={{ padding: "9px 12px" }}>Seen</th>
                <th style={{ padding: "9px 12px" }}>Sources</th>
                <th style={{ padding: "9px 12px" }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <Fragment key={c.id}>
                  <tr
                    style={{
                      borderTop: "1px solid var(--border)",
                      background:
                        c.disposition === "meeting-booked"
                          ? DISPOSITION_META["meeting-booked"].bg
                          : c.disposition === "not-interested"
                            ? DISPOSITION_META["not-interested"].bg
                            : undefined,
                    }}
                  >
                    <td style={{ textAlign: "center" }}>
                      <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleSelected(c.id)} />
                    </td>
                    <td style={{ padding: "9px 12px", fontWeight: 600 }}>
                      <button
                        onClick={() => setDetailId(c.id)}
                        style={{ border: "none", background: "none", padding: 0, font: "inherit", fontWeight: 600, color: "var(--ink)", textDecoration: c.crossedOut ? "line-through" : "underline", cursor: "pointer" }}
                      >
                        {c.fullName || "—"}
                      </button>
                    </td>
                    <td style={{ padding: "9px 12px" }}>{c.company || "—"}</td>
                    <td style={{ padding: "9px 12px", color: "var(--muted)" }}>{c.title || "—"}</td>
                    <td style={{ padding: "9px 12px" }}>{c.email || "—"}</td>
                    <td style={{ padding: "9px 12px" }}>{c.workPhone || c.mobilePhone || "—"}</td>
                    <td style={{ padding: "9px 12px" }}>
                      {c.category ? (
                        <span style={{ fontSize: 10.5, fontWeight: 700, color: CATEGORY_META[c.category].color, background: CATEGORY_META[c.category].bg, borderRadius: 999, padding: "2px 9px", whiteSpace: "nowrap" }}>
                          {CATEGORY_META[c.category].label}
                        </span>
                      ) : (
                        <span style={{ color: "var(--muted)" }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: "9px 12px" }}>
                      {c.disposition && c.disposition !== "none" ? (
                        <span
                          title={c.dispositionNote || undefined}
                          style={{ fontSize: 10.5, fontWeight: 700, color: DISPOSITION_META[c.disposition].color, background: DISPOSITION_META[c.disposition].bg, borderRadius: 999, padding: "2px 9px", whiteSpace: "nowrap" }}
                        >
                          {DISPOSITION_META[c.disposition].label}
                        </span>
                      ) : (
                        <span style={{ color: "var(--muted)" }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: "9px 12px", maxWidth: 220, color: "var(--muted)", fontSize: 12 }} title={c.matchedSnippet || undefined}>
                      {c.matchedSnippet ? (
                        <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.matchedSnippet}</span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td style={{ padding: "9px 12px" }}>
                      <span style={{ fontSize: 10.5, fontWeight: 700, color: OUTREACH_STATUS_META[c.outreachStatus || "not-contacted"].color, background: OUTREACH_STATUS_META[c.outreachStatus || "not-contacted"].bg, borderRadius: 999, padding: "2px 9px", whiteSpace: "nowrap" }}>
                        {OUTREACH_STATUS_META[c.outreachStatus || "not-contacted"].label}
                      </span>
                      {((c.callCount || 0) > 0 || (c.emailCount || 0) > 0) && (
                        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>{c.callCount || 0} calls · {c.emailCount || 0} emails</div>
                      )}
                    </td>
                    <td style={{ padding: "9px 12px", whiteSpace: "nowrap" }} title={new Date(c.lastSeenAt).toLocaleString()}>
                      {c.timesSeen}× · {new Date(c.lastSeenAt).toLocaleDateString()}
                    </td>
                    <td style={{ padding: "9px 12px", color: "var(--muted)", fontSize: 12 }} title={c.sourceFiles.join(", ")}>
                      {c.sourceFiles.length === 1 ? c.sourceFiles[0] : `${c.sourceFiles.length} files`}
                    </td>
                    <td style={{ padding: "9px 12px", whiteSpace: "nowrap" }}>
                      <button
                        onClick={() => setAddingForId(addingForId === c.id ? null : c.id)}
                        style={{ border: "1px solid var(--border)", background: addingForId === c.id ? "var(--ink)" : "var(--surface)", color: addingForId === c.id ? "#fff" : "var(--ink)", borderRadius: 7, padding: "5px 10px", fontSize: 11.5, fontWeight: 700 }}
                      >
                        + Task
                      </button>
                    </td>
                  </tr>
                  {addingForId === c.id && (
                    <tr style={{ background: "var(--bg)" }}>
                      <td colSpan={13} style={{ padding: "10px 12px" }}>
                        <AddContactTaskForm contact={c} onSubmit={(date, priority, note) => submitContactTask(c, date, priority, note)} onCancel={() => setAddingForId(null)} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        </>
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

function AddContactTaskForm({ contact, onSubmit, onCancel }: { contact: Contact; onSubmit: (date: string, priority: TaskPriority, note: string) => void; onCancel: () => void }) {
  const [date, setDate] = useState(todayKey());
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [note, setNote] = useState("");

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <span style={{ fontSize: 12, fontWeight: 700 }}>Task for {contact.fullName || contact.company}:</span>
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ border: "1px solid var(--border)", borderRadius: 7, padding: "5px 8px", fontSize: 12.5 }} />
      <select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)} style={{ border: "1px solid var(--border)", borderRadius: 7, padding: "5px 8px", fontSize: 12.5, fontWeight: 600 }}>
        <option value="high">High priority</option>
        <option value="medium">Medium priority</option>
        <option value="low">Low priority</option>
      </select>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note (optional)"
        style={{ flex: "1 1 200px", border: "1px solid var(--border)", borderRadius: 7, padding: "5px 8px", fontSize: 12.5 }}
      />
      <button onClick={() => onSubmit(date, priority, note)} style={{ border: "none", background: "#2CC295", color: "#081E22", borderRadius: 7, padding: "6px 12px", fontSize: 12, fontWeight: 700 }}>
        Add
      </button>
      <button onClick={onCancel} style={{ border: "1px solid var(--border)", background: "var(--surface)", borderRadius: 7, padding: "6px 12px", fontSize: 12, fontWeight: 600 }}>
        Cancel
      </button>
    </div>
  );
}
