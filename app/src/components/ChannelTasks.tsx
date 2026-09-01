// Calls & Emails tabs — a worklist of Task-store tasks scoped to one
// outbound channel, across every contact. First native slice of "start
// building out sequence and actual tasks slowly" (see CLAUDE.md "Calls &
// Emails tabs"). Deliberately reuses the same Task store the Board/
// Contacts already have (via the new optional Task.channel field) rather
// than a new data model — one shared component, parameterized by channel,
// since the two tabs are otherwise identical.
import { useMemo, useState } from "react";
import type { Contact } from "../lib/contacts";
import { formatTaskTime, type Task, type TaskPriority } from "../lib/tasks";

interface ChannelTasksProps {
  channel: "call" | "email";
  contacts: Contact[];
  tasks: Task[];
  onAddContactTask: (contactId: string, date: string, priority: TaskPriority, text: string, channel: "call" | "email", time?: string | null) => void;
  onToggleTask: (id: string) => void;
  onDeleteTask: (id: string) => void;
}

const PRIORITY_META: Record<TaskPriority, { label: string; color: string; bg: string; rank: number }> = {
  high: { label: "High", color: "#B5443B", bg: "#FBE4E1", rank: 0 },
  medium: { label: "Medium", color: "#9A6B00", bg: "#FCEFC7", rank: 1 },
  low: { label: "Low", color: "#2E6B4A", bg: "#E1F2E7", rank: 2 },
};

const CHANNEL_META = {
  call: { label: "Call", verb: "Call", icon: "📞", empty: "No call tasks yet — use \"+ Call\" below to queue one up." },
  email: { label: "Email", verb: "Email", icon: "✉️", empty: "No email tasks yet — use \"+ Email\" below to queue one up." },
};

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function ChannelTasks({ channel, contacts, tasks, onAddContactTask, onToggleTask, onDeleteTask }: ChannelTasksProps) {
  const meta = CHANNEL_META[channel];
  const [showAdd, setShowAdd] = useState(false);
  const [hideDone, setHideDone] = useState(true);

  const contactById = useMemo(() => new Map(contacts.map((c) => [c.id, c])), [contacts]);
  const channelTasks = useMemo(
    () =>
      tasks
        .filter((t): t is Task & { contactId: string; priority: TaskPriority } => t.channel === channel && Boolean(t.contactId && t.priority && contactById.has(t.contactId)))
        .filter((t) => !hideDone || !t.done)
        .sort((a, b) => PRIORITY_META[a.priority].rank - PRIORITY_META[b.priority].rank || a.date.localeCompare(b.date)),
    [tasks, contactById, channel, hideDone]
  );

  function submit(contact: Contact, date: string, priority: TaskPriority, note: string, time: string) {
    const base = `${meta.verb} ${contact.fullName || contact.company}${contact.company && contact.fullName ? ` (${contact.company})` : ""}`;
    const text = note.trim() ? `${base} — ${note.trim()}` : base;
    onAddContactTask(contact.id, date, priority, text, channel, time || null);
    setShowAdd(false);
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4, flexWrap: "wrap", gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>
          {meta.icon} {meta.label}s
        </h2>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          {channelTasks.length} {hideDone ? "open " : ""}
          {meta.label.toLowerCase()} task{channelTasks.length === 1 ? "" : "s"} — sorted by priority, then date
        </span>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "16px 0", flexWrap: "wrap" }}>
        <button
          onClick={() => setShowAdd((v) => !v)}
          style={{ border: "none", background: "#2CC295", color: "#081E22", borderRadius: 8, padding: "8px 14px", fontSize: 12.5, fontWeight: 700 }}
        >
          + {meta.verb}
        </button>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--muted)" }}>
          <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} />
          Hide completed
        </label>
      </div>

      {showAdd && <AddChannelTaskForm channel={channel} contacts={contacts} onSubmit={submit} onCancel={() => setShowAdd(false)} />}

      {channelTasks.length === 0 ? (
        <div style={{ fontSize: 12.5, color: "var(--muted)", border: "1px dashed var(--border)", borderRadius: 10, padding: "14px 16px" }}>
          {meta.empty}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {channelTasks.map((t) => {
            const contact = contactById.get(t.contactId);
            const pMeta = PRIORITY_META[t.priority];
            return (
              <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "8px 12px" }}>
                <input type="checkbox" checked={t.done} onChange={() => onToggleTask(t.id)} />
                <span style={{ fontSize: 10.5, fontWeight: 700, color: pMeta.color, background: pMeta.bg, borderRadius: 999, padding: "2px 9px", flexShrink: 0 }}>{pMeta.label}</span>
                <span style={{ fontSize: 12, color: "var(--muted)", flexShrink: 0, whiteSpace: "nowrap" }}>
                  {t.date}
                  {t.time ? ` · ${formatTaskTime(t.time)}` : ""}
                </span>
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
  );
}

function AddChannelTaskForm({
  channel,
  contacts,
  onSubmit,
  onCancel,
}: {
  channel: "call" | "email";
  contacts: Contact[];
  onSubmit: (contact: Contact, date: string, priority: TaskPriority, note: string, time: string) => void;
  onCancel: () => void;
}) {
  const [contactId, setContactId] = useState("");
  const [date, setDate] = useState(todayKey());
  // Optional time of day (Task.time) — blank = an untimed task, exactly how
  // every task behaved before the field existed.
  const [time, setTime] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [note, setNote] = useState("");
  const meta = CHANNEL_META[channel];
  const sorted = useMemo(() => [...contacts].sort((a, b) => a.fullName.localeCompare(b.fullName)), [contacts]);

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", background: "var(--surface-sunken)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 14px", marginBottom: 14 }}>
      <span style={{ fontSize: 12, fontWeight: 700 }}>New {meta.label.toLowerCase()} task:</span>
      <select value={contactId} onChange={(e) => setContactId(e.target.value)} style={{ border: "1px solid var(--border)", borderRadius: 7, padding: "5px 8px", fontSize: 12.5, minWidth: 180 }}>
        <option value="">Choose a contact…</option>
        {sorted.map((c) => (
          <option key={c.id} value={c.id}>
            {c.fullName || "(no name)"}{c.company ? ` — ${c.company}` : ""}
          </option>
        ))}
      </select>
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ border: "1px solid var(--border)", borderRadius: 7, padding: "5px 8px", fontSize: 12.5 }} />
      <input
        type="time"
        value={time}
        onChange={(e) => setTime(e.target.value)}
        title="Optional time of day"
        style={{ border: "1px solid var(--border)", borderRadius: 7, padding: "5px 8px", fontSize: 12.5 }}
      />
      <select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)} style={{ border: "1px solid var(--border)", borderRadius: 7, padding: "5px 8px", fontSize: 12.5, fontWeight: 600 }}>
        <option value="high">High priority</option>
        <option value="medium">Medium priority</option>
        <option value="low">Low priority</option>
      </select>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Optional note"
        style={{ border: "1px solid var(--border)", borderRadius: 7, padding: "5px 8px", fontSize: 12.5, flex: "1 1 160px" }}
      />
      <button
        onClick={() => {
          const contact = contacts.find((c) => c.id === contactId);
          if (contact) onSubmit(contact, date, priority, note, time);
        }}
        disabled={!contactId}
        style={{ border: "none", background: "#2CC295", color: "#081E22", borderRadius: 7, padding: "6px 12px", fontSize: 12, fontWeight: 700, opacity: contactId ? 1 : 0.5 }}
      >
        Add
      </button>
      <button onClick={onCancel} style={{ border: "none", background: "none", fontSize: 12, color: "var(--muted)", textDecoration: "underline" }}>Cancel</button>
    </div>
  );
}
