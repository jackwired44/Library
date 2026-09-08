import { localDayKeyFromIso } from "./tasks";
// Weekly Goals — a lightweight, self-serve metrics board for Home. Per
// Jack: "weekly goals metrics that can be pulled and set how many
// outbound calls call backs incoming voicemails etc... build this out
// with little functionalities yet but we will slowly build this into a
// full blown metric board." Deliberately a generic list of named metric
// rows rather than fixed fields — adding a 4th/5th metric later is a
// click on "+ Add metric," not a code change, matching the "full blown
// metric board" direction from day one instead of hardcoding more later.
import { dbGetAll, dbPut, STORE_WEEKLY_GOALS } from "./db";
import type { Task } from "./tasks";

export interface WeeklyMetricEntry {
  id: string;
  label: string;
  target: number;
  // Manually-tracked running count — every metric except the one
  // built-in auto-computed metric below. There's no other data source
  // yet for things like call backs/incoming voicemails, so those start
  // as a plain number Jack updates by hand.
  actual: number;
  // Set only on the built-in "Outbound calls" metric — its actual is
  // computed live from completed call-channel Tasks this week
  // (computeAutoActual below) instead of read from this field. Absent
  // on every custom metric, including Call backs/Incoming voicemails.
  autoSource?: "outboundCalls";
}

export interface WeeklyGoals {
  weekKey: string; // Monday of the week, YYYY-MM-DD — also the IndexedDB key
  metrics: WeeklyMetricEntry[];
}

function newId() {
  return `metric-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// Fixed, deterministic ids (not newId()'s random ones) — a virgin week's
// default record is computed fresh in more than one place (App.tsx's
// render-time getOrCreateCurrentWeekGoals AND mutateWeeklyGoals's own
// fallback when persisting the first-ever edit) before anything is
// actually saved. Random ids would make those two calls disagree on
// what a metric's id is, so an edit targeting the render's id could
// silently fail to match inside the save — confirmed live: a random-id
// version of this let the very first edit to a fresh week vanish, the
// row snapping back to 0 the moment React re-rendered with the (newly
// persisted, differently-random-id) default set. Deterministic ids make
// every defaultMetrics() call agree, so this can't happen. A metric
// added later via addMetric still gets a real newId() — safe, since by
// then the record already exists in state with stable ids.
const OUTBOUND_CALLS_ID = "default-outbound-calls";
const CALL_BACKS_ID = "default-call-backs";
const INCOMING_VOICEMAILS_ID = "default-incoming-voicemails";

export function defaultMetrics(): WeeklyMetricEntry[] {
  return [
    { id: OUTBOUND_CALLS_ID, label: "Outbound calls", target: 0, actual: 0, autoSource: "outboundCalls" },
    { id: CALL_BACKS_ID, label: "Call backs", target: 0, actual: 0 },
    { id: INCOMING_VOICEMAILS_ID, label: "Incoming voicemails", target: 0, actual: 0 },
  ];
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Monday-start week, same convention as lib/tasks.ts's startOfWeek /
// lib/history.ts's weekKeyOf.
export function currentWeekKey(): string {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + diff);
  return dateKey(d);
}

// The live-computed "actual" for the one auto-sourced metric — count of
// completed call-channel Tasks whose date falls within the given week
// (Monday through Sunday). Every other metric's actual is just the
// manually-entered number on WeeklyMetricEntry itself.
export function computeAutoActual(tasks: Task[], weekKey: string): number {
  // Parsed at local NOON, not as a bare date string. `new Date("2026-09-07")`
  // is UTC midnight, so adding six days with local getters landed on
  // Saturday for anyone west of UTC — every Sunday call was dropped from
  // the metric. Same convention lib/history.ts and lib/tasks.ts already use.
  const end = new Date(`${weekKey}T12:00:00`);
  end.setDate(end.getDate() + 6);
  return countCompletedChannelTasks(tasks, "call", weekKey, dateKey(end));
}

// The one derivation behind both "outbound calls this week" (above) and
// Home's start-of-day "calls made / emails sent today" metrics — a
// completed task on that channel, inside an inclusive YYYY-MM-DD range.
// Shared rather than duplicated so the day and week numbers can never
// drift apart on what counts as a made call.
export function countCompletedChannelTasks(
  tasks: Task[],
  channel: "call" | "email",
  fromKey: string,
  toKey: string
): number {
  // Counted on the day the task was actually COMPLETED (Task.completedAt),
  // not the day it was scheduled — a sequence step due tomorrow that gets
  // worked today is a call made today. Falls back to `date` for tasks
  // completed before completedAt existed. Found by the full-platform
  // audit: Home's "Calls made today" read 0 right after completing a call.
  return tasks.filter((t) => {
    if (t.channel !== channel || !t.done) return false;
    const day = t.completedAt ? localDayKeyFromIso(t.completedAt) : t.date;
    return day >= fromKey && day <= toKey;
  }).length;
}

export async function loadWeeklyGoalsFromDB(): Promise<WeeklyGoals[]> {
  return dbGetAll<WeeklyGoals>(STORE_WEEKLY_GOALS);
}
export async function persistWeeklyGoals(goals: WeeklyGoals) {
  await dbPut(STORE_WEEKLY_GOALS, goals);
}

export function addMetric(goals: WeeklyGoals, label: string): WeeklyGoals {
  const trimmed = label.trim();
  if (!trimmed) return goals;
  return { ...goals, metrics: [...goals.metrics, { id: newId(), label: trimmed, target: 0, actual: 0 }] };
}
export function removeMetric(goals: WeeklyGoals, id: string): WeeklyGoals {
  return { ...goals, metrics: goals.metrics.filter((m) => m.id !== id) };
}
export function updateMetric(
  goals: WeeklyGoals,
  id: string,
  patch: Partial<Pick<WeeklyMetricEntry, "label" | "target" | "actual">>
): WeeklyGoals {
  return { ...goals, metrics: goals.metrics.map((m) => (m.id === id ? { ...m, ...patch } : m)) };
}

// The average number of completed tasks on THIS weekday across previous
// weeks — the comparison the Home dashboard uses for its deltas. Comparing
// today to yesterday is noise when Monday and Friday behave differently;
// comparing Tuesday to your own Tuesdays is a real signal.
//
// Needs no backend: every task already carries completedAt, so this is
// computed from history the app already has. Returns null when there
// aren't at least two prior same-weekday samples, so the UI can omit the
// delta rather than print a meaningless one.
export function sameWeekdayAverage(
  tasks: Task[],
  channel: "call" | "email",
  todayKey: string,
  weeksBack = 6
): number | null {
  const today = new Date(`${todayKey}T12:00:00`);
  if (Number.isNaN(today.getTime())) return null;
  const samples: number[] = [];
  for (let i = 1; i <= weeksBack; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i * 7);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    samples.push(countCompletedChannelTasks(tasks, channel, key, key));
  }
  const seen = samples.filter((n) => n > 0);
  if (seen.length < 2) return null;
  return samples.reduce((a, b) => a + b, 0) / samples.length;
}

// How far through the working week we are, 0..1, used to show whether a
// weekly goal is on pace rather than just how full its bar is. Monday
// morning at 20% of target is fine; Friday at 20% is not.
export function weekProgressFraction(now: Date = new Date()): number {
  const day = now.getDay(); // 0 Sun .. 6 Sat
  const elapsedDays = day === 0 ? 6 : day - 1; // Monday-start
  const withinDay = (now.getHours() * 60 + now.getMinutes()) / 1440;
  return Math.min(1, Math.max(0, (elapsedDays + withinDay) / 5));
}
