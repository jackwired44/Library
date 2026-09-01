// Native Sequences — Phase 1 of the Outbound Engine (see CLAUDE.md
// "Native Sequences" and the Roadmap's "Sequence UX Teardown" research).
// A Sequence is a named, ordered list of steps (call/email/LinkedIn, each
// with a wait period); a SequenceEnrollment tracks one contact's progress
// through one sequence. Enrolling generates a Task for the current step
// (reusing lib/tasks.ts — no separate task engine); completing that task
// advances the enrollment to the next step and generates its task.
//
// Email/LinkedIn steps do NOT actually send/connect anything yet — there's
// no SendGrid or LinkedIn API tied in (see CLAUDE.md Roadmap). They
// generate a task you work manually, same as a call step. Flagged here so
// this isn't mistaken for real automation later.
import { dbGetAll, dbPut, dbDelete, STORE_SEQUENCES, STORE_SEQUENCE_ENROLLMENTS } from "./db";
import { createSequenceTask, type Task } from "./tasks";
import type { Contact } from "./contacts";
import { getFullName } from "./detection";

export type SequenceChannel = "call" | "email" | "linkedin";

// Per Jack: steps should be able to fire as soon as 1 hour after the
// previous step, up to a max of 7 days — sub-day precision wasn't
// possible when wait was day-only. Task.date is still calendar-day-only
// (no time-of-day anywhere in this app), so a sub-day wait still just
// lands the generated task on "today" (or "tomorrow" if it crosses
// midnight) — same date-only granularity every other task already uses.
export const MIN_WAIT_HOURS = 1;
export const MAX_WAIT_HOURS = 24 * 7; // 168 — 7 days

export interface SequenceStep {
  id: string;
  position: number;
  channel: SequenceChannel;
  // Hours after the PREVIOUS step's completion (or after enrollment, for
  // step 0) before this step's task is due. Clamped to
  // [MIN_WAIT_HOURS, MAX_WAIT_HOURS] by addStep.
  waitHours: number;
  // Legacy field from before hour-level granularity existed — a step
  // persisted before this change stored a whole-day wait here instead.
  // Only ever read as a fallback (resolveWaitHours), never written by new
  // code. Optional so old persisted Sequences still load and work.
  waitDays?: number;
  note?: string;
}

// Reads a step's wait as hours regardless of which field it was saved
// with (see waitDays above).
export function resolveWaitHours(step: SequenceStep): number {
  if (typeof step.waitHours === "number") return step.waitHours;
  return (step.waitDays ?? 0) * 24;
}

export interface Sequence {
  id: string;
  name: string;
  createdAt: string;
  steps: SequenceStep[];
}

export type EnrollmentStatus = "active" | "finished" | "removed";
export type FinishReason = "disposition" | "manual" | "completed-all-steps";

export interface SequenceEnrollment {
  id: string;
  sequenceId: string;
  contactId: string;
  currentStepIndex: number;
  status: EnrollmentStatus;
  enrolledAt: string;
  finishedAt?: string;
  finishReason?: FinishReason;
  // The Task currently open for this enrollment's current step. Cleared
  // once the enrollment finishes/is removed.
  currentTaskId?: string | null;
}

function newId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/* ------------------------------------------------------------------ */
/* Persistence                                                          */
/* ------------------------------------------------------------------ */
export async function loadSequencesFromDB(): Promise<Sequence[]> {
  const seqs = await dbGetAll<Sequence>(STORE_SEQUENCES);
  return seqs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}
export async function persistSequence(seq: Sequence) {
  await dbPut(STORE_SEQUENCES, seq);
}
export async function deleteSequenceFromDB(id: string) {
  await dbDelete(STORE_SEQUENCES, id);
}
export async function loadEnrollmentsFromDB(): Promise<SequenceEnrollment[]> {
  return dbGetAll<SequenceEnrollment>(STORE_SEQUENCE_ENROLLMENTS);
}
export async function persistEnrollment(e: SequenceEnrollment) {
  await dbPut(STORE_SEQUENCE_ENROLLMENTS, e);
}
export async function deleteEnrollmentFromDB(id: string) {
  await dbDelete(STORE_SEQUENCE_ENROLLMENTS, id);
}

/* ------------------------------------------------------------------ */
/* Sequence CRUD (definitions)                                          */
/* ------------------------------------------------------------------ */
export function createSequence(name: string): Sequence | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  return { id: newId("seq"), name: trimmed, createdAt: new Date().toISOString(), steps: [] };
}

export function addStep(seq: Sequence, channel: SequenceChannel, waitHours: number, note?: string): Sequence {
  const clamped = Math.min(MAX_WAIT_HOURS, Math.max(MIN_WAIT_HOURS, Math.round(waitHours)));
  const step: SequenceStep = { id: newId("step"), position: seq.steps.length, channel, waitHours: clamped, note };
  return { ...seq, steps: [...seq.steps, step] };
}
export function removeStep(seq: Sequence, stepId: string): Sequence {
  const steps = seq.steps.filter((s) => s.id !== stepId).map((s, i) => ({ ...s, position: i }));
  return { ...seq, steps };
}
export function moveStep(seq: Sequence, stepId: string, direction: -1 | 1): Sequence {
  const idx = seq.steps.findIndex((s) => s.id === stepId);
  const swapWith = idx + direction;
  if (idx === -1 || swapWith < 0 || swapWith >= seq.steps.length) return seq;
  const steps = [...seq.steps];
  [steps[idx], steps[swapWith]] = [steps[swapWith], steps[idx]];
  return { ...seq, steps: steps.map((s, i) => ({ ...s, position: i })) };
}
export function renameSequence(seq: Sequence, name: string): Sequence {
  return { ...seq, name: name.trim() || seq.name };
}

/* ------------------------------------------------------------------ */
/* Enrollment / workflow mechanics                                      */
/* ------------------------------------------------------------------ */
const CHANNEL_LABEL: Record<SequenceChannel, string> = { call: "Call", email: "Email", linkedin: "LinkedIn" };

function addHours(iso: string, hours: number): string {
  const d = new Date(iso);
  d.setHours(d.getHours() + hours);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function taskTextFor(contact: Contact, step: SequenceStep, seq: Sequence): string {
  const who = `${getFullName({ firstName: contact.firstName, lastName: contact.lastName, fullName: contact.fullName })}${contact.company ? ` (${contact.company})` : ""}`;
  const base = `${CHANNEL_LABEL[step.channel]} ${who} — ${seq.name}, step ${step.position + 1}`;
  return step.note?.trim() ? `${base}: ${step.note.trim()}` : base;
}

// Enrolls one contact: creates the enrollment plus a Task for step 0 (or
// finishes it immediately, with no task, if the sequence has no steps).
// Returns null if the sequence has no steps and nothing to build.
export function enrollContact(seq: Sequence, contact: Contact): { enrollment: SequenceEnrollment; task: Task | null } | null {
  const nowIso = new Date().toISOString();
  const enrollment: SequenceEnrollment = {
    id: newId("enr"),
    sequenceId: seq.id,
    contactId: contact.id,
    currentStepIndex: 0,
    status: "active",
    enrolledAt: nowIso,
    currentTaskId: null,
  };
  const step0 = seq.steps[0];
  if (!step0) return { enrollment: { ...enrollment, status: "finished", finishedAt: nowIso, finishReason: "completed-all-steps" }, task: null };
  const dueDate = addHours(nowIso, resolveWaitHours(step0));
  const task = createSequenceTask(dueDate, taskTextFor(contact, step0, seq), contact.id, step0.channel, enrollment.id);
  return { enrollment: { ...enrollment, currentTaskId: task?.id ?? null }, task };
}

// Called when a Task carrying a sequenceEnrollmentId is marked done —
// advances that enrollment to its next step (new task) or finishes it if
// that was the last step. Returns the updated enrollment plus a new task
// to persist (or null if the sequence just finished). Returns null
// entirely if the enrollment can't be found or isn't active (already
// finished/removed — a stale completion, ignored rather than reopening
// a closed enrollment).
export function advanceEnrollment(
  enrollments: SequenceEnrollment[],
  sequences: Sequence[],
  contacts: Contact[],
  enrollmentId: string
): { enrollment: SequenceEnrollment; task: Task | null } | null {
  const enrollment = enrollments.find((e) => e.id === enrollmentId);
  if (!enrollment || enrollment.status !== "active") return null;
  const seq = sequences.find((s) => s.id === enrollment.sequenceId);
  const contact = contacts.find((c) => c.id === enrollment.contactId);
  if (!seq || !contact) return null;

  const nextIndex = enrollment.currentStepIndex + 1;
  const nextStep = seq.steps[nextIndex];
  const nowIso = new Date().toISOString();
  if (!nextStep) {
    return { enrollment: { ...enrollment, status: "finished", finishedAt: nowIso, finishReason: "completed-all-steps", currentTaskId: null }, task: null };
  }
  const dueDate = addHours(nowIso, resolveWaitHours(nextStep));
  const task = createSequenceTask(dueDate, taskTextFor(contact, nextStep, seq), contact.id, nextStep.channel, enrollment.id);
  return { enrollment: { ...enrollment, currentStepIndex: nextIndex, currentTaskId: task?.id ?? null }, task };
}

// Manual restart — back to step 0, fresh task, same as a brand-new
// enrollment but keeping the same enrollment id (so its history/identity
// in the UI doesn't fork into a duplicate row).
export function restartEnrollment(enrollment: SequenceEnrollment, seq: Sequence, contact: Contact): { enrollment: SequenceEnrollment; task: Task | null } {
  const nowIso = new Date().toISOString();
  const step0 = seq.steps[0];
  if (!step0) return { enrollment: { ...enrollment, status: "finished", currentStepIndex: 0, finishedAt: nowIso, finishReason: "completed-all-steps", currentTaskId: null }, task: null };
  const dueDate = addHours(nowIso, resolveWaitHours(step0));
  const task = createSequenceTask(dueDate, taskTextFor(contact, step0, seq), contact.id, step0.channel, enrollment.id);
  return { enrollment: { ...enrollment, status: "active", currentStepIndex: 0, finishedAt: undefined, finishReason: undefined, currentTaskId: task?.id ?? null }, task };
}

export function removeEnrollment(enrollment: SequenceEnrollment): SequenceEnrollment {
  return { ...enrollment, status: "removed", finishedAt: new Date().toISOString(), finishReason: "manual", currentTaskId: null };
}

// Auto-finish every ACTIVE enrollment for a contact once their disposition
// lands on a terminal value — per Jack: "each sequence will finish off how
// their dispositions were selected." Doesn't touch already-created tasks
// (nothing destructive) — just stops generating any further steps.
export const TERMINAL_DISPOSITIONS = new Set(["meeting-booked", "not-interested"]);
export function finishActiveEnrollmentsForContact(enrollments: SequenceEnrollment[], contactId: string): SequenceEnrollment[] {
  const nowIso = new Date().toISOString();
  return enrollments.map((e) =>
    e.contactId === contactId && e.status === "active"
      ? { ...e, status: "finished" as const, finishedAt: nowIso, finishReason: "disposition" as const, currentTaskId: null }
      : e
  );
}
