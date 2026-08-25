// Contacts — a searchable, permanent directory of every person ever seen
// in a CSV upload, deduplicated across uploads (see lib/contacts.ts for the
// dedup rules). Read-only for the contact's own fields — no per-contact
// editing here, that still lives on the lead itself in Scanner/Library —
// but a contact CAN be turned into a dated, prioritized follow-up task
// (see CLAUDE.md "Contact tasks"), so sales reps know which contacts
// matter most. First pass per Jack: "start somewhere then fine tune."
import { Fragment, useMemo, useState } from "react";
import { type Contact, searchContacts } from "../lib/contacts";
import type { Task, TaskPriority } from "../lib/tasks";

interface ContactsProps {
  contacts: Contact[];
  loading: boolean;
  error: string | null;
  tasks: Task[];
  onAddContactTask: (contactId: string, date: string, priority: TaskPriority, text: string) => void;
  onToggleTask: (id: string) => void;
  onDeleteTask: (id: string) => void;
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

export default function Contacts({ contacts, loading, error, tasks, onAddContactTask, onToggleTask, onDeleteTask, initialSearch }: ContactsProps) {
  const [search, setSearch] = useState(initialSearch || "");
  const [sort, setSort] = useState<SortKey>("recent");
  const [addingForId, setAddingForId] = useState<string | null>(null);

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
        <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 12 }}>
          <table>
            <thead>
              <tr style={{ background: "var(--bg)", textAlign: "left" }}>
                <th style={{ padding: "9px 12px" }}>Contact</th>
                <th style={{ padding: "9px 12px" }}>Company</th>
                <th style={{ padding: "9px 12px" }}>Title</th>
                <th style={{ padding: "9px 12px" }}>Email</th>
                <th style={{ padding: "9px 12px" }}>Phone</th>
                <th style={{ padding: "9px 12px" }}>Seen</th>
                <th style={{ padding: "9px 12px" }}>Sources</th>
                <th style={{ padding: "9px 12px" }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <Fragment key={c.id}>
                  <tr style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: "9px 12px", fontWeight: 600 }}>{c.fullName || "—"}</td>
                    <td style={{ padding: "9px 12px" }}>{c.company || "—"}</td>
                    <td style={{ padding: "9px 12px", color: "var(--muted)" }}>{c.title || "—"}</td>
                    <td style={{ padding: "9px 12px" }}>{c.email || "—"}</td>
                    <td style={{ padding: "9px 12px" }}>{c.workPhone || c.mobilePhone || "—"}</td>
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
                      <td colSpan={8} style={{ padding: "10px 12px" }}>
                        <AddContactTaskForm contact={c} onSubmit={(date, priority, note) => submitContactTask(c, date, priority, note)} onCancel={() => setAddingForId(null)} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
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
