// Native Sequences (Phase 1 of the Outbound Engine) — see CLAUDE.md
// "Native Sequences." Build a named sequence of call/email/LinkedIn steps
// (each with a wait period), enroll contacts, and work each enrollment's
// current-step task from here (or from the Board/Calls/Emails tabs — same
// shared Task store). Email/LinkedIn steps generate a task to work by
// hand, not an automatic send — flagged in the empty state below too.
import { useMemo, useState } from "react";
import type { Contact } from "../lib/contacts";
import type { Task } from "../lib/tasks";
import type { Sequence, SequenceEnrollment, SequenceChannel } from "../lib/sequences";

interface SequencesProps {
  sequences: Sequence[];
  enrollments: SequenceEnrollment[];
  contacts: Contact[];
  tasks: Task[];
  loading: boolean;
  error: string | null;
  onCreate: (name: string) => Sequence | null;
  onRename: (id: string, name: string) => void;
  onAddStep: (id: string, channel: SequenceChannel, waitDays: number, note?: string) => void;
  onRemoveStep: (id: string, stepId: string) => void;
  onMoveStep: (id: string, stepId: string, direction: -1 | 1) => void;
  onDelete: (id: string) => void;
  onEnroll: (sequenceId: string, contactIds: string[]) => number;
  onRestart: (enrollmentId: string) => void;
  onRemoveEnrollment: (enrollmentId: string) => void;
}

const CHANNEL_META: Record<SequenceChannel, { label: string; icon: string }> = {
  call: { label: "Call", icon: "📞" },
  email: { label: "Email", icon: "✉️" },
  linkedin: { label: "LinkedIn", icon: "🔗" },
};

const STATUS_META: Record<SequenceEnrollment["status"], { label: string; color: string; bg: string }> = {
  active: { label: "Active", color: "#2CC295", bg: "#E7F1EA" },
  finished: { label: "Finished", color: "#0A66C2", bg: "#EAF3FC" },
  removed: { label: "Removed", color: "#9aa1ac", bg: "#F4F6F7" },
};

export default function SequencesView({
  sequences,
  enrollments,
  contacts,
  tasks,
  loading,
  error,
  onCreate,
  onRename,
  onAddStep,
  onRemoveStep,
  onMoveStep,
  onDelete,
  onEnroll,
  onRestart,
  onRemoveEnrollment,
}: SequencesProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");

  const contactById = useMemo(() => new Map(contacts.map((c) => [c.id, c])), [contacts]);
  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  function handleCreate() {
    const seq = onCreate(newName);
    if (seq) {
      setNewName("");
      setOpenId(seq.id);
    }
  }
  function handleDelete(seq: Sequence) {
    if (window.confirm(`Delete the sequence "${seq.name}"? Every enrollment in it is removed too. Contacts and their tasks already generated stay untouched. This can't be undone.`)) {
      onDelete(seq.id);
      if (openId === seq.id) setOpenId(null);
    }
  }

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>Loading your Sequences…</div>;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>📡 Sequences</h2>
      </div>
      <p style={{ margin: "4px 0 16px", fontSize: 12.5, color: "var(--muted)", maxWidth: 640 }}>
        Build multi-step outbound sequences — call, email, and (eventually) LinkedIn steps, each with a wait period.
        <strong> Email and LinkedIn steps generate a task to work by hand</strong> — there's no send/connect
        integration wired up yet, so nothing fires automatically. A contact's enrollment finishes on its own once
        their disposition lands on Meeting booked or Not interested; restart or remove it any time.
      </p>
      {error && <div style={{ color: "#B5443B", marginBottom: 12, fontSize: 12.5 }}>{error}</div>}

      <div style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap" }}>
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          placeholder="New sequence name"
          style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px", fontSize: 13, flex: "1 1 220px" }}
        />
        <button onClick={handleCreate} disabled={!newName.trim()} style={{ background: "#2CC295", color: "#081E22", border: "none", borderRadius: 8, padding: "8px 16px", fontWeight: 700, opacity: newName.trim() ? 1 : 0.5 }}>
          + New sequence
        </button>
      </div>

      {sequences.length === 0 ? (
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 28, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
          No sequences yet — name one above to start building it.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {sequences.map((seq) => {
            const seqEnrollments = enrollments.filter((e) => e.sequenceId === seq.id);
            const activeCount = seqEnrollments.filter((e) => e.status === "active").length;
            const isOpen = openId === seq.id;
            return (
              <div key={seq.id} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 13, padding: "14px 18px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                  <button onClick={() => setOpenId(isOpen ? null : seq.id)} style={{ display: "flex", alignItems: "center", gap: 10, border: "none", background: "none", cursor: "pointer", textAlign: "left" }}>
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>{isOpen ? "▾" : "▸"}</span>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13.5 }}>{seq.name}</div>
                      <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
                        {seq.steps.length === 0 ? "No steps yet" : seq.steps.map((s) => CHANNEL_META[s.channel].icon).join(" → ")}
                        {" · "}
                        {activeCount} active enrollment{activeCount === 1 ? "" : "s"}
                      </div>
                    </div>
                  </button>
                  <button onClick={() => handleDelete(seq)} style={{ background: "var(--surface)", color: "#B5443B", border: "1px solid #F0C6C1", borderRadius: 8, padding: "6px 12px", fontSize: 12 }}>
                    Delete
                  </button>
                </div>
                {isOpen && (
                  <SequenceDetail
                    seq={seq}
                    enrollments={seqEnrollments}
                    contacts={contacts}
                    contactById={contactById}
                    taskById={taskById}
                    onRename={(name) => onRename(seq.id, name)}
                    onAddStep={(channel, waitDays, note) => onAddStep(seq.id, channel, waitDays, note)}
                    onRemoveStep={(stepId) => onRemoveStep(seq.id, stepId)}
                    onMoveStep={(stepId, dir) => onMoveStep(seq.id, stepId, dir)}
                    onEnroll={(contactIds) => onEnroll(seq.id, contactIds)}
                    onRestart={onRestart}
                    onRemoveEnrollment={onRemoveEnrollment}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SequenceDetail({
  seq,
  enrollments,
  contacts,
  contactById,
  taskById,
  onRename,
  onAddStep,
  onRemoveStep,
  onMoveStep,
  onEnroll,
  onRestart,
  onRemoveEnrollment,
}: {
  seq: Sequence;
  enrollments: SequenceEnrollment[];
  contacts: Contact[];
  contactById: Map<string, Contact>;
  taskById: Map<string, Task>;
  onRename: (name: string) => void;
  onAddStep: (channel: SequenceChannel, waitDays: number, note?: string) => void;
  onRemoveStep: (stepId: string) => void;
  onMoveStep: (stepId: string, dir: -1 | 1) => void;
  onEnroll: (contactIds: string[]) => number;
  onRestart: (enrollmentId: string) => void;
  onRemoveEnrollment: (enrollmentId: string) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(seq.name);
  const [stepChannel, setStepChannel] = useState<SequenceChannel>("call");
  const [stepWait, setStepWait] = useState(1);
  const [stepNote, setStepNote] = useState("");
  const [enrollPicker, setEnrollPicker] = useState<Set<string>>(new Set());
  const [enrollNotice, setEnrollNotice] = useState<string | null>(null);

  function commitRename() {
    onRename(nameDraft);
    setRenaming(false);
  }
  function submitEnroll() {
    const ids = [...enrollPicker];
    if (!ids.length) return;
    const added = onEnroll(ids);
    const skipped = ids.length - added;
    setEnrollNotice(`Enrolled ${added} contact${added === 1 ? "" : "s"}${skipped > 0 ? ` (${skipped} already active in this sequence)` : ""}.`);
    setEnrollPicker(new Set());
  }

  const activeEnrollments = enrollments.filter((e) => e.status !== "removed");

  return (
    <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        {renaming ? (
          <>
            <input
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && commitRename()}
              onBlur={commitRename}
              style={{ border: "1px solid var(--border)", borderRadius: 7, padding: "4px 8px", fontWeight: 700 }}
            />
          </>
        ) : (
          <button onClick={() => setRenaming(true)} style={{ border: "none", background: "none", fontSize: 12, color: "var(--muted)", textDecoration: "underline" }}>
            Rename
          </button>
        )}
      </div>

      <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>Steps</div>
      {seq.steps.length === 0 ? (
        <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 10 }}>No steps yet — add one below.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 10 }}>
          {seq.steps.map((step, i) => (
            <div key={step.id} style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--surface-sunken)", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 10px", fontSize: 12.5 }}>
              <span style={{ fontWeight: 700 }}>{i + 1}.</span>
              <span>{CHANNEL_META[step.channel].icon} {CHANNEL_META[step.channel].label}</span>
              <span style={{ color: "var(--muted)" }}>{step.waitDays === 0 ? "immediately" : `${step.waitDays}d after previous`}</span>
              {step.note && <span style={{ color: "var(--muted)", fontStyle: "italic" }}>— {step.note}</span>}
              <span style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                <button onClick={() => onMoveStep(step.id, -1)} disabled={i === 0} title="Move earlier" style={{ border: "none", background: "none", cursor: i === 0 ? "default" : "pointer", opacity: i === 0 ? 0.3 : 1 }}>▲</button>
                <button onClick={() => onMoveStep(step.id, 1)} disabled={i === seq.steps.length - 1} title="Move later" style={{ border: "none", background: "none", cursor: i === seq.steps.length - 1 ? "default" : "pointer", opacity: i === seq.steps.length - 1 ? 0.3 : 1 }}>▼</button>
                <button onClick={() => onRemoveStep(step.id)} title="Remove step" style={{ border: "none", background: "none", color: "#B5443B" }}>✕</button>
              </span>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 18 }}>
        <select value={stepChannel} onChange={(e) => setStepChannel(e.target.value as SequenceChannel)} style={{ border: "1px solid var(--border)", borderRadius: 7, padding: "5px 8px", fontSize: 12.5 }}>
          {(Object.keys(CHANNEL_META) as SequenceChannel[]).map((c) => (
            <option key={c} value={c}>{CHANNEL_META[c].icon} {CHANNEL_META[c].label}</option>
          ))}
        </select>
        <input type="number" min={0} value={stepWait} onChange={(e) => setStepWait(Number(e.target.value))} style={{ width: 60, border: "1px solid var(--border)", borderRadius: 7, padding: "5px 8px", fontSize: 12.5 }} />
        <span style={{ fontSize: 11.5, color: "var(--muted)" }}>days after previous step</span>
        <input value={stepNote} onChange={(e) => setStepNote(e.target.value)} placeholder="Optional note/script" style={{ border: "1px solid var(--border)", borderRadius: 7, padding: "5px 8px", fontSize: 12.5, flex: "1 1 160px" }} />
        <button
          onClick={() => { onAddStep(stepChannel, stepWait, stepNote.trim() || undefined); setStepNote(""); setStepWait(1); }}
          style={{ background: "#2CC295", color: "#081E22", border: "none", borderRadius: 7, padding: "6px 12px", fontSize: 12, fontWeight: 700 }}
        >
          + Add step
        </button>
      </div>

      <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>Enrolled contacts</div>
      {activeEnrollments.length === 0 ? (
        <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 10 }}>No one enrolled yet.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 10 }}>
          {activeEnrollments.map((e) => {
            const contact = contactById.get(e.contactId);
            const step = seq.steps[e.currentStepIndex];
            const task = e.currentTaskId ? taskById.get(e.currentTaskId) : null;
            const statusMeta = STATUS_META[e.status];
            return (
              <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 10, background: "var(--surface-sunken)", border: "1px solid var(--border)", borderRadius: 8, padding: "7px 12px", fontSize: 12.5 }}>
                <span style={{ fontWeight: 700, minWidth: 130 }}>{contact ? `${contact.fullName || "(no name)"}${contact.company ? ` — ${contact.company}` : ""}` : "(contact removed)"}</span>
                <span style={{ fontSize: 10.5, fontWeight: 700, color: statusMeta.color, background: statusMeta.bg, borderRadius: 999, padding: "2px 9px" }}>{statusMeta.label}</span>
                {e.status === "active" && step && (
                  <span style={{ color: "var(--muted)" }}>
                    Step {e.currentStepIndex + 1}/{seq.steps.length} · {CHANNEL_META[step.channel].icon}{task ? ` due ${task.date}` : ""}
                  </span>
                )}
                {e.status === "finished" && <span style={{ color: "var(--muted)" }}>{e.finishReason === "disposition" ? "Ended by disposition" : e.finishReason === "completed-all-steps" ? "Completed all steps" : "Ended"}</span>}
                <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                  {e.status === "finished" && (
                    <button onClick={() => onRestart(e.id)} style={{ border: "1px solid var(--border)", background: "var(--surface)", borderRadius: 7, padding: "4px 10px", fontSize: 11.5 }}>↺ Restart</button>
                  )}
                  {e.status === "active" && (
                    <button onClick={() => onRemoveEnrollment(e.id)} style={{ border: "1px solid #F0C6C1", background: "var(--surface)", color: "#B5443B", borderRadius: 7, padding: "4px 10px", fontSize: 11.5 }}>Remove</button>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>+ Enroll contacts</div>
      <div style={{ maxHeight: 160, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 8, marginBottom: 8 }}>
        {contacts.map((c) => (
          <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 10px", fontSize: 12.5, borderBottom: "1px solid var(--border)", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={enrollPicker.has(c.id)}
              onChange={(e) => {
                setEnrollPicker((prev) => {
                  const next = new Set(prev);
                  if (e.target.checked) next.add(c.id); else next.delete(c.id);
                  return next;
                });
              }}
            />
            {c.fullName || "(no name)"}{c.company ? ` — ${c.company}` : ""}
          </label>
        ))}
      </div>
      <button
        onClick={submitEnroll}
        disabled={!enrollPicker.size || seq.steps.length === 0}
        title={seq.steps.length === 0 ? "Add at least one step first" : undefined}
        style={{ background: "#2CC295", color: "#081E22", border: "none", borderRadius: 8, padding: "7px 14px", fontWeight: 700, opacity: !enrollPicker.size || seq.steps.length === 0 ? 0.5 : 1 }}
      >
        Enroll {enrollPicker.size || ""} contact{enrollPicker.size === 1 ? "" : "s"}
      </button>
      {enrollNotice && <span style={{ marginLeft: 10, fontSize: 12, color: "#3A4B8C" }}>{enrollNotice}</span>}
    </div>
  );
}
