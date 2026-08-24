// Weekly task board — a simple day-by-day checklist (Mon-Sun, real dates),
// persisted the same way as everything else (IndexedDB, no server). Not
// tied to leads/scanning at all — see CLAUDE.md.
import { dbGetAll, dbPut, dbDelete, STORE_TASKS } from "./db";

export interface Task {
  id: string;
  date: string; // YYYY-MM-DD, the specific calendar day this task belongs to
  text: string;
  done: boolean;
  createdAt: string;
}

function newId() {
  return `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function loadTasksFromDB(): Promise<Task[]> {
  return dbGetAll<Task>(STORE_TASKS);
}
export async function persistTask(task: Task) {
  await dbPut(STORE_TASKS, task);
}
export async function deleteTaskFromDB(id: string) {
  await dbDelete(STORE_TASKS, id);
}

export function createTask(date: string, text: string): Task | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  return { id: newId(), date, text: trimmed, done: false, createdAt: new Date().toISOString() };
}

function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Monday-start week, matching lib/history.ts's week convention.
export function startOfWeek(d: Date): Date {
  const date = new Date(d);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + diff);
  return date;
}

export interface DayColumn {
  key: string; // YYYY-MM-DD
  date: Date;
  label: string; // e.g. "Mon, Aug 24"
}

export function getWeekDays(weekStart: Date): DayColumn[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return {
      key: dateKey(d),
      date: d,
      label: d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }),
    };
  });
}

export function weekRangeLabel(weekStart: Date): string {
  const end = new Date(weekStart);
  end.setDate(end.getDate() + 6);
  const fmt = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const sameYear = weekStart.getFullYear() === end.getFullYear();
  return `${fmt(weekStart)} – ${fmt(end)}${sameYear ? `, ${end.getFullYear()}` : ""}`;
}

export function tasksForDay(tasks: Task[], dayKey: string): Task[] {
  return tasks.filter((t) => t.date === dayKey).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}
