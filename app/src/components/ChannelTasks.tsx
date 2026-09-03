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
import { SELF_USER_ID, userLabel, type PlatformUser } from "../lib/users";
import { dispositionOptions, dispositionMetaFor, type CustomDisposition } from "../lib/dispositions";

interface ChannelTasksProps {
  channel: "call" | "email";
  contacts: Contact[];
  tasks: Task[];
  users: PlatformUser[];
  // For the disposition checkbox filter below — a call task is filtered by
  // its linked CONTACT's disposition (a task has no disposition of its own).
  dispositions: CustomDisposition[];
  onAddContactTask: (contactId: string, date: string, priority: TaskPriority, text: string, channel: "call" | "email", time?: string | null, userId?: string | null) => void;
  onToggleTask: (id: string) => void;
  onDeleteTask: (id: string) => void;
  // Manual "mark as replied" (email only — see lib/tasks.ts, this app has
  // no real inbox to detect a reply from) and the "Assign to" picker both
  // write through this one generic task-patch handler.
  onUpdateTaskFields: (id: string, patch: Partial<Pick<Task, "userId" | "repliedAt">>) => void;
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

export default function ChannelTasks({ channel, contacts, tasks, users, dispositions, onAddContactTask, onToggleTask, onDeleteTask, onUpdateTaskFields }: ChannelTasksProps) {
  const meta = CHANNEL_META[channel];
  const [showAdd, setShowAdd] = useState(false);
  const [hideDone, setHideDone] = useState(true);
  // Multi-select, per Jack: "make sure it can be filtered through in a
  // check box way." Empty set = no filter (show everything).
  const [dispositionFilter, setDispositionFilter] = useState<Set<string>>(new Set());

  const contactById = useMemo(() => new Map(contacts.map((c) => [c.id, c])), [contacts]);
  const channelTasks = useMemo(
    () =>
      tasks
        .filter((t): t is Task & { contactId: string; priority: TaskPriority } => t.channel === channel && Boolean(t.contactId && t.priority && contactById.has(t.contactId)))
        .filter((t) => !hideDone || !t.done)
        .filter((t) => {
          if (dispositionFilter.size === 0) return true;
          const c = contactById.get(t.contactId);
          return dispositionFilter.has(c?.disposition || "none");
        })
        .sort((a, b) => PRIORITY_META[a.priority].rank - PRIORITY_META[b.priority].rank || a.date.localeCompare(b.date)),
    [tasks, contactById, channel, hideDone, dispositionFilter]
  );

  // Counts per disposition across this channel's tasks (before the
  // disposition filter itself, so every bucket stays visible).
  const dispositionCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    tasks.forEach((t) => {
      if (t.channel !== channel || !t.contactId) return;
      if (hideDone && t.done) return;
      const c = contactById.get(t.contactId);
      const key = c?.disposition || "none";
      counts[key] = (counts[key] || 0) + 1;
    });
    return counts;
  }, [tasks, channel, hideDone, contactById]);

  function submit(contact: Contact, date: string, priority: TaskPriority, note: string, time: string, userId: string) {
    const base = `${meta.verb} ${contact.fullName || contact.company}${contact.company && contact.fullName ? ` (${contact.company})` : ""}`;
    const text = note.trim() ? `${base} — ${note.trim()}` : base;
    onAddContactTask(contact.id, date, priority, text, channel, time || null, userId || null);
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

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", border: "1px solid var(--border)", borderRadius: 10, padding: "9px 12px", marginBottom: 14 }}>
        <span className="rd-label" style={{ marginBottom: 0 }}>Disposition</span>
        {dispositionOptions(dispositions).map((o) => {
          const checked = dispositionFilter.has(o.key);
          return (
            <label
              key={o.key}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                border: `1px solid ${checked ? o.color : "var(--border)"}`,
                background: checked ? o.bg : "var(--surface)",
                color: checked ? o.color : "var(--muted)",
                borderRadius: 999,
                padding: "4px 11px",
              }}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => {
                  setDispositionFilter((prev) => {
                    const next = new Set(prev);
                    if (e.target.checked) next.add(o.key); else next.delete(o.key);
                    return next;
                  });
                }}
              />
              {o.label} ({dispositionCounts[o.key] || 0})
            </label>
          );
        })}
        {dispositionFilter.size > 0 && (
          <button onClick={() => setDispositionFilter(new Set())} className="btn btn-sm btn-ghost" style={{ textDecoration: "underline" }}>
            Clear ({dispositionFilter.size})
          </button>
        )}
      </div>

      {showAdd && <AddChannelTaskForm channel={channel} contacts={contacts} users={users} onSubmit={submit} onCancel={() => setShowAdd(false)} />}

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
                {contact && (contact.disposition || "none") !== "none" && (
                  <span
                    title="The linked contact's current disposition"
                    style={{ fontSize: 10.5, fontWeight: 700, whiteSpace: "nowrap", borderRadius: 999, padding: "2px 8px", color: dispositionMetaFor(contact.disposition, dispositions).color, background: dispositionMetaFor(contact.disposition, dispositions).bg }}
                  >
                    {dispositionMetaFor(contact.disposition, dispositions).label}
                  </span>
                )}
                {t.userId && (
                  <span title="Assigned to" style={{ fontSize: 10.5, fontWeight: 700, color: "#0A66C2", background: "#EAF3FC", borderRadius: 999, padding: "2px 8px", whiteSpace: "nowrap" }}>
                    {userLabel(users, t.userId)}
                  </span>
                )}
                {channel === "email" && (
                  <button
                    onClick={() => onUpdateTaskFields(t.id, { repliedAt: t.repliedAt ? null : new Date().toISOString() })}
                    title={t.repliedAt ? `Marked replied ${new Date(t.repliedAt).toLocaleString()} — click to unmark` : "Mark as replied (manual — this app has no inbox to detect a real reply)"}
                    style={{
                      border: `1px solid ${t.repliedAt ? "#B7E4CE" : "var(--border)"}`,
                      background: t.repliedAt ? "#E7F1EA" : "var(--surface)",
                      color: t.repliedAt ? "#2CC295" : "var(--muted)",
                      borderRadius: 999,
                      padding: "2px 9px",
                      fontSize: 10.5,
                      fontWeight: 700,
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {t.repliedAt ? "✓ Replied" : "Mark replied"}
                  </button>
                )}
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
  users,
  onSubmit,
  onCancel,
}: {
  channel: "call" | "email";
  contacts: Contact[];
  users: PlatformUser[];
  onSubmit: (contact: Contact, date: string, priority: TaskPriority, note: string, time: string, userId: string) => void;
  onCancel: () => void;
}) {
  const [contactId, setContactId] = useState("");
  const [date, setDate] = useState(todayKey());
  // Optional time of day (Task.time) — blank = an untimed task, exactly how
  // every task behaved before the field existed.
  const [time, setTime] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [note, setNote] = useState("");
  // Defaults to "you" (SELF_USER_ID) rather than unassigned — most tasks
  // created here are the current person's own work.
  const [userId, setUserId] = useState(SELF_USER_ID);
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
      <select value={userId} onChange={(e) => setUserId(e.target.value)} title="Assign to" style={{ border: "1px solid var(--border)", borderRadius: 7, padding: "5px 8px", fontSize: 12.5 }}>
        <option value="">Unassigned</option>
        {users.map((u) => (
          <option key={u.id} value={u.id}>{u.isSelf ? `${u.name} (you)` : u.name}</option>
        ))}
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
          if (contact) onSubmit(contact, date, priority, note, time, userId);
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
