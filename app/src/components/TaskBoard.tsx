import { useMemo, useState } from "react";
import { getWeekDays, startOfWeek, tasksForDay, weekRangeLabel, type Task } from "../lib/tasks";

interface TaskBoardProps {
  tasks: Task[];
  loading: boolean;
  error: string | null;
  onAddTask: (date: string, text: string) => void;
  onToggleTask: (id: string) => void;
  onEditTask: (id: string, text: string) => void;
  onDeleteTask: (id: string) => void;
}

export default function TaskBoard({ tasks, loading, error, onAddTask, onToggleTask, onEditTask, onDeleteTask }: TaskBoardProps) {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const days = useMemo(() => getWeekDays(weekStart), [weekStart]);
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }, []);

  function shiftWeek(delta: number) {
    setWeekStart((prev) => {
      const next = new Date(prev);
      next.setDate(next.getDate() + delta * 7);
      return next;
    });
  }

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: "#9aa1ac" }}>Loading your board…</div>;

  return (
    <div>
      <p style={{ color: "#4c6167", maxWidth: 700, marginBottom: 16 }}>
        A simple weekly checklist — separate from lead scanning, saved locally the same way everything else here is.
      </p>
      {error && <div style={{ color: "#9A5B22", marginBottom: 12 }}>{error}</div>}

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
        <button onClick={() => shiftWeek(-1)} style={{ border: "1px solid #D5D9E0", background: "#fff", borderRadius: 8, padding: "6px 12px", fontWeight: 700 }}>‹ Prev</button>
        <div style={{ fontWeight: 700, fontSize: 15 }}>{weekRangeLabel(weekStart)}</div>
        <button onClick={() => shiftWeek(1)} style={{ border: "1px solid #D5D9E0", background: "#fff", borderRadius: 8, padding: "6px 12px", fontWeight: 700 }}>Next ›</button>
        <button onClick={() => setWeekStart(startOfWeek(new Date()))} style={{ border: "none", background: "none", textDecoration: "underline", color: "#4c6167", fontSize: 12.5 }}>This week</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
        {days.map((day) => (
          <DayColumn
            key={day.key}
            day={day}
            isToday={day.date.getTime() === today}
            tasks={tasksForDay(tasks, day.key)}
            onAddTask={(text) => onAddTask(day.key, text)}
            onToggleTask={onToggleTask}
            onEditTask={onEditTask}
            onDeleteTask={onDeleteTask}
          />
        ))}
      </div>
    </div>
  );
}

function DayColumn({
  day,
  isToday,
  tasks,
  onAddTask,
  onToggleTask,
  onEditTask,
  onDeleteTask,
}: {
  day: { key: string; label: string };
  isToday: boolean;
  tasks: Task[];
  onAddTask: (text: string) => void;
  onToggleTask: (id: string) => void;
  onEditTask: (id: string, text: string) => void;
  onDeleteTask: (id: string) => void;
}) {
  const [draft, setDraft] = useState("");

  function submit() {
    if (!draft.trim()) return;
    onAddTask(draft);
    setDraft("");
  }

  return (
    <div data-day-key={day.key} style={{ background: "#fff", border: `1px solid ${isToday ? "#2CC295" : "#E4E7EC"}`, borderRadius: 13, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8, minHeight: 180 }}>
      <div style={{ fontWeight: 700, fontSize: 12.5, color: isToday ? "#2CC295" : "#1B2430" }}>{day.label}{isToday ? " · Today" : ""}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
        {tasks.length === 0 && <div style={{ fontSize: 11.5, color: "#c3c9cf" }}>No tasks</div>}
        {tasks.map((t) => (
          <div key={t.id} style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
            <input type="checkbox" checked={t.done} onChange={() => onToggleTask(t.id)} style={{ marginTop: 3 }} />
            <input
              defaultValue={t.text}
              onBlur={(e) => { if (e.target.value.trim() && e.target.value !== t.text) onEditTask(t.id, e.target.value); }}
              style={{
                flex: 1,
                border: "none",
                fontSize: 12.5,
                textDecoration: t.done ? "line-through" : "none",
                color: t.done ? "#9aa1ac" : "#1B2430",
                background: "transparent",
                padding: 0,
              }}
            />
            <button onClick={() => onDeleteTask(t.id)} title="Delete task" style={{ border: "none", background: "none", color: "#B5443B", fontSize: 12, padding: 0 }}>✕</button>
          </div>
        ))}
      </div>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        onBlur={submit}
        placeholder="+ Add task"
        style={{ border: "1px solid #E1E4E9", borderRadius: 7, padding: "6px 9px", fontSize: 12 }}
      />
    </div>
  );
}
