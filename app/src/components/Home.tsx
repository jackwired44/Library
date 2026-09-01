// The post-login landing page — orientation + the Weekly Goals board, not
// a module of its own. Per Jack: "everything on the left hand side,
// nothing under Modules" — navigation lives entirely in the sidebar
// (App.tsx), so Home no longer duplicates it as a tile grid. Reads only
// its own Profile (for the greeting) beyond the counts it's handed.
import { useEffect, useMemo, useState } from "react";
import { loadProfile, type Profile } from "../lib/profile";
import { computeAutoActual, countCompletedChannelTasks, type WeeklyGoals } from "../lib/weeklyGoals";
import { compareByTimeThenCreated, formatTaskTime, startOfWeek, todayDateKey, weekRangeLabel, type Task } from "../lib/tasks";
import type { Contact } from "../lib/contacts";

interface HomeProps {
  libraryCount: number;
  historyCount: number;
  tasksOpenCount: number;
  contactsCount: number;
  tasks: Task[];
  contacts: Contact[];
  onToggleTask: (id: string) => void;
  weeklyGoals: WeeklyGoals;
  onUpdateMetric: (id: string, patch: Partial<{ label: string; target: number; actual: number }>) => void;
  onAddMetric: (label: string) => void;
  onRemoveMetric: (id: string) => void;
}

const PRIORITY_META: Record<string, { label: string; color: string; bg: string; rank: number }> = {
  high: { label: "High", color: "#B5443B", bg: "#FBE4E1", rank: 0 },
  medium: { label: "Medium", color: "#9A6B00", bg: "#FCEFC7", rank: 1 },
  low: { label: "Low", color: "#2E6B4A", bg: "#E1F2E7", rank: 2 },
};

const CHANNEL_ICON: Record<string, string> = { call: "📞", email: "✉️" };

export default function Home({
  libraryCount,
  historyCount,
  tasksOpenCount,
  contactsCount,
  tasks,
  contacts,
  onToggleTask,
  weeklyGoals,
  onUpdateMetric,
  onAddMetric,
  onRemoveMetric,
}: HomeProps) {
  const [profile, setProfile] = useState<Profile | null>(null);
  useEffect(() => {
    loadProfile().then(setProfile);
  }, []);
  const firstName = profile?.name?.trim().split(/\s+/)[0] || "Jack";

  // Start-of-day dashboard — per Jack, this is the screen you land on to
  // start the day: today's date, what's due today, and the day's numbers.
  // Everything here is derived from state App.tsx already holds (Tasks +
  // Contacts); Home still reads no IndexedDB of its own beyond Profile.
  const today = todayDateKey();
  const todayLabel = new Date(`${today}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const contactById = useMemo(() => new Map(contacts.map((c) => [c.id, c])), [contacts]);
  const todaysTasks = useMemo(
    () => tasks.filter((t) => t.date === today && !t.done).sort(compareByTimeThenCreated),
    [tasks, today]
  );
  const callsToday = useMemo(() => countCompletedChannelTasks(tasks, "call", today, today), [tasks, today]);
  const emailsToday = useMemo(() => countCompletedChannelTasks(tasks, "email", today, today), [tasks, today]);
  const meetingsBooked = useMemo(() => contacts.filter((c) => c.disposition === "meeting-booked").length, [contacts]);

  return (
    <div>
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: "16px 20px",
          marginBottom: 18,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
            {todayLabel}
          </div>
          <h1 style={{ margin: "0 0 3px", fontSize: 19 }}>Welcome, {firstName}.</h1>
          <p style={{ margin: 0, maxWidth: 560, fontSize: 12.5, lineHeight: 1.5, color: "var(--muted)" }}>
            The <strong style={{ color: "var(--ink)" }}>Lead Library</strong> is the single source of truth for every qualified
            lead — the first step toward a lighter-weight, self-hosted CRM built solely for outbound sales.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {[
            { label: "Lead Library", value: libraryCount },
            { label: "Contacts", value: contactsCount },
            { label: "Open tasks", value: tasksOpenCount },
            { label: "Uploads", value: historyCount },
          ].map((s) => (
            <div
              key={s.label}
              style={{
                background: "var(--surface-sunken)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: "6px 12px",
                textAlign: "center",
                minWidth: 68,
              }}
            >
              <div style={{ fontSize: 16, fontWeight: 700, color: "var(--ink)", lineHeight: 1.2 }}>{s.value}</div>
              <div style={{ fontSize: 9.5, color: "var(--muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      <TodayPanel
        todayLabel={todayLabel}
        tasks={todaysTasks}
        contactById={contactById}
        onToggleTask={onToggleTask}
        callsToday={callsToday}
        emailsToday={emailsToday}
        meetingsBooked={meetingsBooked}
      />

      <WeeklyGoalsPanel goals={weeklyGoals} tasks={tasks} onUpdateMetric={onUpdateMetric} onAddMetric={onAddMetric} onRemoveMetric={onRemoveMetric} />
    </div>
  );
}

// Today — the start-of-day panel. Per Jack: "Welcome screen should say the
// day, how many calls have been made, follow ups if any were set for that
// day with the time, and be a metric dashboard when people login." The
// day's numbers come off the same completed-channel-task derivation the
// Weekly Goals board's auto "Outbound calls" metric already uses
// (countCompletedChannelTasks, lib/weeklyGoals.ts), just scoped to one day
// instead of a week, so the two can never disagree on what a made call is.
// Checking a follow-up off here goes through App.tsx's own onToggleTask —
// the exact handler the Board/Calls/Emails tabs use, so a sequence-generated
// task still advances its enrollment when completed from Home.
function TodayPanel({
  todayLabel,
  tasks,
  contactById,
  onToggleTask,
  callsToday,
  emailsToday,
  meetingsBooked,
}: {
  todayLabel: string;
  tasks: Task[];
  contactById: Map<string, Contact>;
  onToggleTask: (id: string) => void;
  callsToday: number;
  emailsToday: number;
  meetingsBooked: number;
}) {
  const metrics = [
    { label: "Calls made today", value: callsToday, hint: "Completed call tasks dated today" },
    { label: "Emails sent today", value: emailsToday, hint: "Completed email tasks dated today" },
    { label: "Follow-ups due today", value: tasks.length, hint: "Open tasks dated today" },
    { label: "Meetings booked", value: meetingsBooked, hint: "Contacts whose disposition is Meeting booked" },
  ];

  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 18px", marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 6 }}>
        <h2 style={{ margin: 0, fontSize: 14 }}>📅 Today</h2>
        <span style={{ fontSize: 11.5, color: "var(--muted)" }}>{todayLabel}</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8, marginBottom: 14 }}>
        {metrics.map((m) => (
          <div
            key={m.label}
            title={m.hint}
            style={{ background: "var(--surface-sunken)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px" }}
          >
            <div style={{ fontSize: 20, fontWeight: 700, color: "var(--ink)", lineHeight: 1.15 }}>{m.value}</div>
            <div style={{ fontSize: 10, color: "var(--muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>{m.label}</div>
          </div>
        ))}
      </div>

      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", marginBottom: 7 }}>
        Follow-ups scheduled for today
      </div>
      {tasks.length === 0 ? (
        <div style={{ fontSize: 12.5, color: "var(--muted)", border: "1px dashed var(--border)", borderRadius: 9, padding: "12px 14px" }}>
          Nothing scheduled for today — add a follow-up from Engage → Contacts, Calls, or Emails.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {tasks.map((t) => {
            const contact = t.contactId ? contactById.get(t.contactId) : undefined;
            const pMeta = t.priority ? PRIORITY_META[t.priority] : null;
            const timeLabel = formatTaskTime(t.time);
            return (
              <div
                key={t.id}
                style={{ display: "flex", alignItems: "center", gap: 10, background: "var(--surface-sunken)", border: "1px solid var(--border)", borderRadius: 9, padding: "8px 12px" }}
              >
                <input type="checkbox" checked={t.done} onChange={() => onToggleTask(t.id)} title="Mark done" />
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: timeLabel ? 700 : 400,
                    color: timeLabel ? "var(--ink)" : "var(--muted)",
                    minWidth: 66,
                    flexShrink: 0,
                    whiteSpace: "nowrap",
                  }}
                >
                  {timeLabel || "Anytime"}
                </span>
                {t.channel && <span title={t.channel} style={{ fontSize: 12, flexShrink: 0 }}>{CHANNEL_ICON[t.channel]}</span>}
                {pMeta && (
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: pMeta.color, background: pMeta.bg, borderRadius: 999, padding: "2px 9px", flexShrink: 0 }}>
                    {pMeta.label}
                  </span>
                )}
                <span style={{ fontSize: 13, flex: 1, color: "var(--ink)" }}>{t.text}</span>
                {contact && (
                  <span style={{ fontSize: 11.5, color: "var(--muted)", whiteSpace: "nowrap" }}>
                    {contact.fullName || "(no name)"}
                    {contact.company ? ` · ${contact.company}` : ""}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Weekly Goals — see CLAUDE.md and lib/weeklyGoals.ts. Every metric is a
// plain row (label/target/actual), editable inline; "Outbound calls" is
// the one built-in metric whose actual is pulled live from completed
// call-channel Tasks rather than typed in — everything else (Call backs,
// Incoming voicemails, and anything added via "+ Add metric") is a
// manually-tracked running count, since there's no other data source for
// those yet. Deliberately minimal per Jack's own "little functionalities
// yet" — no charts, no history view, just the current week's numbers.
function WeeklyGoalsPanel({
  goals,
  tasks,
  onUpdateMetric,
  onAddMetric,
  onRemoveMetric,
}: {
  goals: WeeklyGoals;
  tasks: Task[];
  onUpdateMetric: (id: string, patch: Partial<{ label: string; target: number; actual: number }>) => void;
  onAddMetric: (label: string) => void;
  onRemoveMetric: (id: string) => void;
}) {
  const [addingLabel, setAddingLabel] = useState("");
  const weekLabel = weekRangeLabel(startOfWeek(new Date()));

  function submitAdd() {
    if (!addingLabel.trim()) return;
    onAddMetric(addingLabel);
    setAddingLabel("");
  }

  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 18px", marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 6 }}>
        <h2 style={{ margin: 0, fontSize: 14 }}>🎯 Weekly Goals</h2>
        <span style={{ fontSize: 11.5, color: "var(--muted)" }}>{weekLabel}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
        {goals.metrics.map((m) => {
          const actual = m.autoSource === "outboundCalls" ? computeAutoActual(tasks, goals.weekKey) : m.actual;
          const pct = m.target > 0 ? Math.min(100, Math.round((actual / m.target) * 100)) : 0;
          return (
            <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <input
                value={m.label}
                onChange={(e) => onUpdateMetric(m.id, { label: e.target.value })}
                style={{ flex: "1 1 160px", minWidth: 120, border: "1px solid var(--border)", borderRadius: 7, padding: "6px 8px", fontSize: 12.5, fontWeight: 600 }}
              />
              <div style={{ flex: "2 1 160px", minWidth: 140, display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ flex: 1, height: 7, borderRadius: 999, background: "var(--surface-sunken)", overflow: "hidden" }}>
                  <div style={{ width: `${pct}%`, height: "100%", background: pct >= 100 ? "#2CC295" : "var(--accent)", borderRadius: 999 }} />
                </div>
                <span style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap", minWidth: 30, textAlign: "right" }}>{pct}%</span>
              </div>
              {m.autoSource === "outboundCalls" ? (
                <span title="Pulled live from completed call tasks this week" style={{ fontSize: 12.5, fontWeight: 700, minWidth: 30, textAlign: "right" }}>
                  {actual}
                </span>
              ) : (
                <input
                  type="number"
                  min={0}
                  value={m.actual}
                  onChange={(e) => onUpdateMetric(m.id, { actual: Math.max(0, Number(e.target.value) || 0) })}
                  style={{ width: 56, border: "1px solid var(--border)", borderRadius: 7, padding: "5px 6px", fontSize: 12.5, textAlign: "right" }}
                />
              )}
              <span style={{ fontSize: 11.5, color: "var(--muted)" }}>of</span>
              <input
                type="number"
                min={0}
                value={m.target}
                onChange={(e) => onUpdateMetric(m.id, { target: Math.max(0, Number(e.target.value) || 0) })}
                style={{ width: 56, border: "1px solid var(--border)", borderRadius: 7, padding: "5px 6px", fontSize: 12.5, textAlign: "right" }}
              />
              {m.autoSource === "outboundCalls" && (
                <span style={{ fontSize: 9.5, fontWeight: 700, color: "var(--muted)", background: "var(--surface-sunken)", borderRadius: 999, padding: "1px 7px" }}>
                  auto
                </span>
              )}
              <button
                onClick={() => onRemoveMetric(m.id)}
                title="Remove this metric"
                style={{ border: "none", background: "none", color: "#B5443B", fontSize: 13, cursor: "pointer" }}
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input
          value={addingLabel}
          onChange={(e) => setAddingLabel(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submitAdd()}
          placeholder="+ Add a metric (e.g. Meetings booked)"
          style={{ flex: "1 1 220px", border: "1px solid var(--border)", borderRadius: 7, padding: "6px 8px", fontSize: 12.5 }}
        />
        <button
          onClick={submitAdd}
          disabled={!addingLabel.trim()}
          style={{ border: "none", background: "#2CC295", color: "#081E22", borderRadius: 7, padding: "6px 12px", fontSize: 12, fontWeight: 700, opacity: addingLabel.trim() ? 1 : 0.5 }}
        >
          Add
        </button>
      </div>
    </div>
  );
}
