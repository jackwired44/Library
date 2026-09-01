// Native Sequences (Phase 1 of the Outbound Engine) — see CLAUDE.md
// "Native Sequences." Build a named sequence of call/email/LinkedIn steps
// (each with a wait period), enroll contacts, and work each enrollment's
// current-step task from here (or from the Board/Calls/Emails tabs — same
// shared Task store). Email/LinkedIn steps generate a task to work by
// hand, not an automatic send — flagged in the empty state below too.
import { useMemo, useState } from "react";
import type { Contact } from "../lib/contacts";
import type { Task } from "../lib/tasks";
import { resolveWaitHours, resolveStatus, isSequenceRunnable, MIN_WAIT_HOURS, MAX_WAIT_HOURS, type Sequence, type SequenceEnrollment, type SequenceChannel, type SequenceStep, type SequenceStatus } from "../lib/sequences";
import { userLabel, type PlatformUser } from "../lib/users";
import { type SequenceGroup } from "../lib/sequenceGroups";
import { resolveListContacts, type LeadList } from "../lib/leadLists";

interface SequencesProps {
  sequences: Sequence[];
  enrollments: SequenceEnrollment[];
  contacts: Contact[];
  tasks: Task[];
  leadLists: LeadList[];
  loading: boolean;
  error: string | null;
  onCreate: (name: string) => Sequence | null;
  onRename: (id: string, name: string) => void;
  onAddStep: (id: string, channel: SequenceChannel, waitHours: number, note?: string) => void;
  onRemoveStep: (id: string, stepId: string) => void;
  onUpdateStep: (id: string, stepId: string, patch: Partial<Pick<SequenceStep, "note" | "systemPrompt" | "userPrompt">>) => void;
  onMoveStep: (id: string, stepId: string, direction: -1 | 1) => void;
  onDelete: (id: string) => void;
  onEnroll: (sequenceId: string, contactIds: string[]) => number;
  onRestart: (enrollmentId: string) => void;
  onRemoveEnrollment: (enrollmentId: string) => void;
  users: PlatformUser[];
  groups: SequenceGroup[];
  onSetStatus: (id: string, status: SequenceStatus) => void;
  onSetOwner: (id: string, ownerId: string | null) => void;
  onSetGroup: (id: string, groupId: string | null) => void;
  onCopy: (id: string) => Sequence | null;
  onAddGroup: (name: string) => void;
  onRenameGroup: (id: string, name: string) => void;
  onDeleteGroup: (id: string) => void;
}

// Sequence lifecycle badge colors — distinct from STATUS_META further
// down, which is for an ENROLLMENT's status (active/finished/removed).
const SEQ_STATUS_META: Record<SequenceStatus, { label: string; color: string; bg: string }> = {
  active: { label: "Active", color: "#2CC295", bg: "#E7F1EA" },
  paused: { label: "Paused", color: "#9A5B22", bg: "#FBEBDD" },
  archived: { label: "Archived", color: "#5B6B72", bg: "#EDEFF1" },
};

// Every channel is manual today — there's no SendGrid/LinkedIn API tied
// in, so an email/LinkedIn step generates a task worked by hand, exactly
// like a call step (see CLAUDE.md "Native Sequences"). Per Jack: state
// that plainly on each step rather than leaving it implied, so it's
// "properly built in" — and so the moment a channel DOES get real
// send/connect automation, flipping its sendMode here is the one place
// that updates every badge in this view at once.
const CHANNEL_META: Record<SequenceChannel, { label: string; icon: string; sendMode: "manual" | "automated" }> = {
  call: { label: "Call", icon: "📞", sendMode: "manual" },
  email: { label: "Email", icon: "✉️", sendMode: "manual" },
  linkedin: { label: "LinkedIn", icon: "🔗", sendMode: "manual" },
};
const SEND_MODE_META: Record<"manual" | "automated", { label: string; color: string; bg: string }> = {
  manual: { label: "Manual", color: "#9A5B22", bg: "#FBEBDD" },
  automated: { label: "Automated", color: "#2CC295", bg: "#E7F1EA" },
};
function SendModeBadge({ channel }: { channel: SequenceChannel }) {
  const mode = CHANNEL_META[channel].sendMode;
  const meta = SEND_MODE_META[mode];
  return (
    <span
      title={mode === "manual" ? "Generates a task you work by hand — nothing sends itself yet" : "Sends automatically once the step's wait period elapses"}
      style={{ fontSize: 9.5, fontWeight: 700, color: meta.color, background: meta.bg, borderRadius: 999, padding: "1px 7px", whiteSpace: "nowrap" }}
    >
      {meta.label}
    </span>
  );
}

// Formats a step's wait as whole days when it divides evenly, hours
// otherwise — e.g. 168 -> "7d", 36 -> "36h". Min is 1 hour, max is 7
// days (168h), enforced in lib/sequences.ts's addStep.
function formatWait(hours: number): string {
  if (hours <= 0) return "immediately";
  if (hours % 24 === 0) return `${hours / 24}d`;
  return `${hours}h`;
}

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
  leadLists,
  loading,
  error,
  onCreate,
  onRename,
  onAddStep,
  onRemoveStep,
  onUpdateStep,
  onMoveStep,
  onDelete,
  onEnroll,
  onRestart,
  onRemoveEnrollment,
  users,
  groups,
  onSetStatus,
  onSetOwner,
  onSetGroup,
  onCopy,
  onAddGroup,
  onRenameGroup,
  onDeleteGroup,
}: SequencesProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  // "Live" (active + paused) is the default, NOT "active only" — pausing
  // a sequence must never make it vanish out from under you the moment
  // you click Pause, which is exactly what an active-only default did.
  // Archiving is the action that removes something from the default
  // list; pausing just stops it running. Confirmed live: with an
  // active-only default, pausing hid the card and left no reachable
  // Activate button.
  const [statusFilter, setStatusFilter] = useState<"live" | SequenceStatus | "all">("live");
  const [ownerFilter, setOwnerFilter] = useState<string>("all");
  const [newGroupName, setNewGroupName] = useState("");
  const [managingGroups, setManagingGroups] = useState(false);

  const contactById = useMemo(() => new Map(contacts.map((c) => [c.id, c])), [contacts]);
  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  const visible = useMemo(() => {
    let list = sequences;
    if (statusFilter === "all") {
      // "All" still sorts archived to the bottom rather than mixing them in.
      list = [...list].sort((a, b) => Number(resolveStatus(a) === "archived") - Number(resolveStatus(b) === "archived"));
    } else if (statusFilter === "live") {
      list = list.filter((s) => resolveStatus(s) !== "archived");
    } else {
      list = list.filter((s) => resolveStatus(s) === statusFilter);
    }
    if (ownerFilter !== "all") {
      list = list.filter((s) => (ownerFilter === "unassigned" ? !s.ownerId : s.ownerId === ownerFilter));
    }
    return list;
  }, [sequences, statusFilter, ownerFilter]);

  // Grouped for display: one bucket per group that actually has visible
  // sequences, plus an "Ungrouped" bucket last.
  const grouped = useMemo(() => {
    const buckets: { id: string | null; name: string; items: Sequence[] }[] = [];
    groups.forEach((g) => {
      const items = visible.filter((s) => s.groupId === g.id);
      if (items.length) buckets.push({ id: g.id, name: g.name, items });
    });
    const ungrouped = visible.filter((s) => !s.groupId || !groups.some((g) => g.id === s.groupId));
    if (ungrouped.length) buckets.push({ id: null, name: "Ungrouped", items: ungrouped });
    return buckets;
  }, [visible, groups]);

  const statusCounts = useMemo(() => {
    const counts: Record<SequenceStatus, number> = { active: 0, paused: 0, archived: 0 };
    sequences.forEach((s) => { counts[resolveStatus(s)]++; });
    return counts;
  }, [sequences]);

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
        <button
          onClick={() => setManagingGroups((v) => !v)}
          style={{ border: "1px solid var(--border)", background: "var(--surface)", borderRadius: 8, padding: "8px 14px", fontSize: 12.5, fontWeight: 700 }}
        >
          🗂 Groups ({groups.length})
        </button>
      </div>

      {managingGroups && (
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "12px 16px", marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 700, textTransform: "uppercase", marginBottom: 8 }}>Sequence groups</div>
          {groups.length === 0 && <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 8 }}>No groups yet — name one below, then assign sequences to it.</div>}
          <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 10 }}>
            {groups.map((g) => (
              <div key={g.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  defaultValue={g.name}
                  onBlur={(e) => { if (e.target.value.trim() && e.target.value !== g.name) onRenameGroup(g.id, e.target.value); }}
                  style={{ flex: "1 1 200px", border: "1px solid var(--border)", borderRadius: 7, padding: "5px 8px", fontSize: 12.5, fontWeight: 600 }}
                />
                <span style={{ fontSize: 11.5, color: "var(--muted)", whiteSpace: "nowrap" }}>
                  {sequences.filter((s) => s.groupId === g.id).length} sequence(s)
                </span>
                <button
                  onClick={() => {
                    if (window.confirm(`Delete the group "${g.name}"? The sequences in it are NOT deleted — they just become ungrouped.`)) onDeleteGroup(g.id);
                  }}
                  title="Delete group (sequences inside are kept, just ungrouped)"
                  style={{ border: "none", background: "none", color: "#B5443B", fontSize: 13, cursor: "pointer" }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && newGroupName.trim()) { onAddGroup(newGroupName); setNewGroupName(""); } }}
              placeholder="New group name"
              style={{ flex: "1 1 200px", border: "1px solid var(--border)", borderRadius: 7, padding: "6px 8px", fontSize: 12.5 }}
            />
            <button
              onClick={() => { if (newGroupName.trim()) { onAddGroup(newGroupName); setNewGroupName(""); } }}
              disabled={!newGroupName.trim()}
              style={{ border: "none", background: "#2CC295", color: "#081E22", borderRadius: 7, padding: "6px 12px", fontSize: 12, fontWeight: 700, opacity: newGroupName.trim() ? 1 : 0.5 }}
            >
              Add group
            </button>
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 16 }}>
        {(["live", "archived", "all"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setStatusFilter(f)}
            style={{
              border: "1px solid var(--border)",
              borderRadius: 999,
              padding: "5px 13px",
              fontSize: 12.5,
              fontWeight: 700,
              cursor: "pointer",
              background: statusFilter === f ? "var(--ink)" : "var(--surface)",
              color: statusFilter === f ? "#fff" : "var(--muted)",
            }}
          >
            {f === "all"
              ? `All (${sequences.length})`
              : f === "live"
                ? `Live (${statusCounts.active + statusCounts.paused})`
                : `Archived (${statusCounts.archived})`}
          </button>
        ))}
        <span style={{ width: 1, height: 18, background: "var(--border)" }} />
        <span style={{ fontSize: 11.5, color: "var(--muted)", fontWeight: 700 }}>Owner</span>
        <select
          title="Filter by owner"
          aria-label="Filter by owner"
          value={ownerFilter}
          onChange={(e) => setOwnerFilter(e.target.value)}
          style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "5px 8px", fontSize: 12.5 }}
        >
          <option value="all">Anyone</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>{u.name}</option>
          ))}
          <option value="unassigned">Unassigned</option>
        </select>
      </div>

      {sequences.length === 0 ? (
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 28, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
          No sequences yet — name one above to start building it.
        </div>
      ) : visible.length === 0 ? (
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 28, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
          No sequences match this filter.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {grouped.map((bucket) => (
            <div key={bucket.id || "ungrouped"}>
              {groups.length > 0 && (
                <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 7 }}>
                  🗂 {bucket.name} <span style={{ fontWeight: 400 }}>· {bucket.items.length}</span>
                </div>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {bucket.items.map((seq) => {
                  const seqEnrollments = enrollments.filter((e) => e.sequenceId === seq.id);
                  const activeCount = seqEnrollments.filter((e) => e.status === "active").length;
                  const isOpen = openId === seq.id;
                  const status = resolveStatus(seq);
                  const statusMeta = SEQ_STATUS_META[status];
                  const runnable = isSequenceRunnable(seq);
                  return (
                    <div
                      key={seq.id}
                      style={{
                        background: "var(--surface)",
                        border: "1px solid var(--border)",
                        borderRadius: 13,
                        padding: "14px 18px",
                        // An archived sequence reads as set-aside without
                        // being hidden when you deliberately filter to it.
                        opacity: status === "archived" ? 0.72 : 1,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                        <button onClick={() => setOpenId(isOpen ? null : seq.id)} style={{ display: "flex", alignItems: "center", gap: 10, border: "none", background: "none", cursor: "pointer", textAlign: "left" }}>
                          <span style={{ fontSize: 12, color: "var(--muted)" }}>{isOpen ? "▾" : "▸"}</span>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: 13.5, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                              {seq.name}
                              <span style={{ fontSize: 9.5, fontWeight: 700, color: statusMeta.color, background: statusMeta.bg, borderRadius: 999, padding: "1px 8px" }}>
                                {statusMeta.label}
                              </span>
                            </div>
                            <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
                              {seq.steps.length === 0 ? "No steps yet" : seq.steps.map((s) => CHANNEL_META[s.channel].icon).join(" → ")}
                              {" · "}
                              {activeCount} active enrollment{activeCount === 1 ? "" : "s"}
                              {" · owner: "}
                              {userLabel(users, seq.ownerId)}
                            </div>
                          </div>
                        </button>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                          {runnable ? (
                            <button
                              onClick={() => onSetStatus(seq.id, "paused")}
                              title="Stop new enrollments and stop generating new step tasks. Open tasks are left alone."
                              style={{ border: "1px solid var(--border)", background: "var(--surface)", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 600 }}
                            >
                              ⏸ Pause
                            </button>
                          ) : (
                            <button
                              onClick={() => onSetStatus(seq.id, "active")}
                              title="Resume: regenerates the open task for any enrollment parked without one."
                              style={{ border: "none", background: "#2CC295", color: "#081E22", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 700 }}
                            >
                              ▶ Activate
                            </button>
                          )}
                          {status !== "archived" ? (
                            <button
                              onClick={() => onSetStatus(seq.id, "archived")}
                              title="Archive: hidden from the default list, no enrollments, no new tasks. Reversible."
                              style={{ border: "1px solid var(--border)", background: "var(--surface)", borderRadius: 8, padding: "6px 12px", fontSize: 12 }}
                            >
                              🗄 Archive
                            </button>
                          ) : null}
                          <button
                            onClick={() => { const copy = onCopy(seq.id); if (copy) setOpenId(copy.id); }}
                            title="Duplicate this sequence exactly — same steps, owner and group. Enrollments are not copied."
                            style={{ border: "1px solid var(--border)", background: "var(--surface)", borderRadius: 8, padding: "6px 12px", fontSize: 12 }}
                          >
                            ⧉ Copy
                          </button>
                          <button onClick={() => handleDelete(seq)} style={{ background: "var(--surface)", color: "#B5443B", border: "1px solid #F0C6C1", borderRadius: 8, padding: "6px 12px", fontSize: 12 }}>
                            Delete
                          </button>
                        </div>
                      </div>
                      {isOpen && (
                        <>
                          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
                            <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 700, textTransform: "uppercase" }}>Owner</span>
                            <select
                              title="Sequence owner"
                              aria-label="Sequence owner"
                              value={seq.ownerId || ""}
                              onChange={(e) => onSetOwner(seq.id, e.target.value || null)}
                              style={{ border: "1px solid var(--border)", borderRadius: 7, padding: "5px 8px", fontSize: 12.5 }}
                            >
                              <option value="">Unassigned</option>
                              {users.map((u) => (
                                <option key={u.id} value={u.id}>{u.name}</option>
                              ))}
                            </select>
                            <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 700, textTransform: "uppercase" }}>Group</span>
                            <select
                              title="Sequence group"
                              aria-label="Sequence group"
                              value={seq.groupId || ""}
                              onChange={(e) => onSetGroup(seq.id, e.target.value || null)}
                              style={{ border: "1px solid var(--border)", borderRadius: 7, padding: "5px 8px", fontSize: 12.5 }}
                            >
                              <option value="">Ungrouped</option>
                              {groups.map((g) => (
                                <option key={g.id} value={g.id}>{g.name}</option>
                              ))}
                            </select>
                            {!runnable && (
                              <span style={{ fontSize: 11.5, color: "#9A5B22" }}>
                                {status === "paused" ? "Paused" : "Archived"} — no new enrollments or step tasks until reactivated.
                              </span>
                            )}
                          </div>
                          <SequenceDetail
                            seq={seq}
                            enrollments={seqEnrollments}
                            contacts={contacts}
                            leadLists={leadLists}
                            contactById={contactById}
                            taskById={taskById}
                            runnable={runnable}
                            onRename={(name) => onRename(seq.id, name)}
                            onAddStep={(channel, waitHours, note) => onAddStep(seq.id, channel, waitHours, note)}
                            onRemoveStep={(stepId) => onRemoveStep(seq.id, stepId)}
                            onUpdateStep={(stepId, patch) => onUpdateStep(seq.id, stepId, patch)}
                            onMoveStep={(stepId, dir) => onMoveStep(seq.id, stepId, dir)}
                            onEnroll={(contactIds) => onEnroll(seq.id, contactIds)}
                            onRestart={onRestart}
                            onRemoveEnrollment={onRemoveEnrollment}
                          />
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SequenceDetail({
  seq,
  enrollments,
  contacts,
  leadLists,
  contactById,
  taskById,
  runnable,
  onRename,
  onAddStep,
  onRemoveStep,
  onUpdateStep,
  onMoveStep,
  onEnroll,
  onRestart,
  onRemoveEnrollment,
}: {
  seq: Sequence;
  enrollments: SequenceEnrollment[];
  contacts: Contact[];
  leadLists: LeadList[];
  contactById: Map<string, Contact>;
  taskById: Map<string, Task>;
  // False when the sequence is paused/archived — enrolling is blocked in
  // lib/sequences.ts regardless, this just disables the controls so the
  // UI doesn't offer an action that would silently no-op.
  runnable: boolean;
  onRename: (name: string) => void;
  onAddStep: (channel: SequenceChannel, waitHours: number, note?: string) => void;
  onRemoveStep: (stepId: string) => void;
  onUpdateStep: (stepId: string, patch: Partial<Pick<SequenceStep, "note" | "systemPrompt" | "userPrompt">>) => void;
  onMoveStep: (stepId: string, dir: -1 | 1) => void;
  onEnroll: (contactIds: string[]) => number;
  onRestart: (enrollmentId: string) => void;
  onRemoveEnrollment: (enrollmentId: string) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(seq.name);
  const [stepChannel, setStepChannel] = useState<SequenceChannel>("call");
  const [stepWaitValue, setStepWaitValue] = useState(1);
  const [stepWaitUnit, setStepWaitUnit] = useState<"hours" | "days">("days");
  const [stepNote, setStepNote] = useState("");
  // Which step's AI-prompt editor (system/user prompt) is expanded — one
  // at a time, collapsed by default so the step list stays scannable.
  const [promptEditorStepId, setPromptEditorStepId] = useState<string | null>(null);
  const [listPickerId, setListPickerId] = useState("");
  const [enrollPicker, setEnrollPicker] = useState<Set<string>>(new Set());
  const [enrollNotice, setEnrollNotice] = useState<string | null>(null);

  function commitRename() {
    onRename(nameDraft);
    setRenaming(false);
  }
  function submitAddStep() {
    const hours = stepWaitUnit === "hours" ? stepWaitValue : stepWaitValue * 24;
    onAddStep(stepChannel, hours, stepNote.trim() || undefined);
    setStepNote("");
    setStepWaitValue(1);
  }
  function submitEnroll() {
    const ids = [...enrollPicker];
    if (!ids.length) return;
    const added = onEnroll(ids);
    const skipped = ids.length - added;
    setEnrollNotice(`Enrolled ${added} contact${added === 1 ? "" : "s"}${skipped > 0 ? ` (${skipped} already active in this sequence)` : ""}.`);
    setEnrollPicker(new Set());
  }
  function submitEnrollFromList() {
    const list = leadLists.find((l) => l.id === listPickerId);
    if (!list) return;
    const { resolved, unresolvedCount } = resolveListContacts(list, contacts);
    if (!resolved.length) {
      setEnrollNotice(`None of "${list.name}"'s ${list.rows.length} lead(s) matched a known Contact yet.`);
      return;
    }
    const added = onEnroll(resolved.map((c) => c.id));
    const skipped = resolved.length - added;
    const parts = [`Enrolled ${added} contact${added === 1 ? "" : "s"} from "${list.name}"`];
    if (skipped > 0) parts.push(`${skipped} already active in this sequence`);
    if (unresolvedCount > 0) parts.push(`${unresolvedCount} of the list's leads had no matching Contact`);
    setEnrollNotice(`${parts.join(" — ")}.`);
    setListPickerId("");
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
          {seq.steps.map((step, i) => {
            const hasPrompt = Boolean(step.systemPrompt?.trim() || step.userPrompt?.trim());
            const promptOpen = promptEditorStepId === step.id;
            return (
              <div key={step.id}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--surface-sunken)", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 10px", fontSize: 12.5 }}>
                  <span style={{ fontWeight: 700 }}>{i + 1}.</span>
                  <span>{CHANNEL_META[step.channel].icon} {CHANNEL_META[step.channel].label}</span>
                  <SendModeBadge channel={step.channel} />
                  <span style={{ color: "var(--muted)" }}>{formatWait(resolveWaitHours(step))}{resolveWaitHours(step) > 0 ? " after previous" : ""}</span>
                  {step.note && <span style={{ color: "var(--muted)", fontStyle: "italic" }}>— {step.note}</span>}
                  <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4 }}>
                    <button
                      onClick={() => setPromptEditorStepId(promptOpen ? null : step.id)}
                      title="AI prompt for this step — system + user prompt, captured for future AI-generated content (not sent to any AI yet)"
                      style={{
                        border: `1px solid ${hasPrompt ? "#CFE3F7" : "var(--border)"}`,
                        borderRadius: 999,
                        padding: "2px 8px",
                        fontSize: 10.5,
                        fontWeight: 700,
                        cursor: "pointer",
                        background: hasPrompt ? "#EAF3FC" : "var(--surface)",
                        color: hasPrompt ? "#0A66C2" : "var(--muted)",
                      }}
                    >
                      🤖 AI prompt{hasPrompt ? " ✓" : ""}
                    </button>
                    <button onClick={() => onMoveStep(step.id, -1)} disabled={i === 0} title="Move earlier" style={{ border: "none", background: "none", cursor: i === 0 ? "default" : "pointer", opacity: i === 0 ? 0.3 : 1 }}>▲</button>
                    <button onClick={() => onMoveStep(step.id, 1)} disabled={i === seq.steps.length - 1} title="Move later" style={{ border: "none", background: "none", cursor: i === seq.steps.length - 1 ? "default" : "pointer", opacity: i === seq.steps.length - 1 ? 0.3 : 1 }}>▼</button>
                    <button onClick={() => onRemoveStep(step.id)} title="Remove step" style={{ border: "none", background: "none", color: "#B5443B" }}>✕</button>
                  </span>
                </div>
                {promptOpen && (
                  <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderTop: "none", borderRadius: "0 0 8px 8px", padding: "10px 12px", marginTop: -1 }}>
                    <div style={{ fontSize: 10.5, color: "var(--muted)", marginBottom: 8, lineHeight: 1.4 }}>
                      Captured for a future AI-generated version of this step, same idea as Apollo's system/user prompt
                      fields — <strong>nothing calls any AI with these yet</strong>, this app has no AI integration wired
                      in. Safe to fill in now so the content is ready once one is.
                    </div>
                    <label style={{ display: "block", fontSize: 10.5, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", marginBottom: 3 }}>System prompt</label>
                    <textarea
                      defaultValue={step.systemPrompt || ""}
                      onBlur={(e) => onUpdateStep(step.id, { systemPrompt: e.target.value })}
                      placeholder="e.g. You are a friendly, concise SDR at Wired CIO writing a short first-touch email…"
                      rows={2}
                      style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 7, padding: "6px 8px", fontSize: 12, marginBottom: 8, resize: "vertical", boxSizing: "border-box" }}
                    />
                    <label style={{ display: "block", fontSize: 10.5, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", marginBottom: 3 }}>User prompt</label>
                    <textarea
                      defaultValue={step.userPrompt || ""}
                      onBlur={(e) => onUpdateStep(step.id, { userPrompt: e.target.value })}
                      placeholder="e.g. Write a 3-sentence intro referencing {{company}}'s Dynamics 365 interest and asking for 15 minutes."
                      rows={2}
                      style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 7, padding: "6px 8px", fontSize: 12, resize: "vertical", boxSizing: "border-box" }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
        <select value={stepChannel} onChange={(e) => setStepChannel(e.target.value as SequenceChannel)} style={{ border: "1px solid var(--border)", borderRadius: 7, padding: "5px 8px", fontSize: 12.5 }}>
          {(Object.keys(CHANNEL_META) as SequenceChannel[]).map((c) => (
            <option key={c} value={c}>{CHANNEL_META[c].icon} {CHANNEL_META[c].label}</option>
          ))}
        </select>
        <SendModeBadge channel={stepChannel} />
        <input
          type="number"
          min={1}
          max={stepWaitUnit === "hours" ? MAX_WAIT_HOURS : 7}
          value={stepWaitValue}
          onChange={(e) => setStepWaitValue(Number(e.target.value))}
          style={{ width: 60, border: "1px solid var(--border)", borderRadius: 7, padding: "5px 8px", fontSize: 12.5 }}
        />
        <select value={stepWaitUnit} onChange={(e) => setStepWaitUnit(e.target.value as "hours" | "days")} style={{ border: "1px solid var(--border)", borderRadius: 7, padding: "5px 8px", fontSize: 12.5 }}>
          <option value="hours">hours</option>
          <option value="days">days</option>
        </select>
        <span style={{ fontSize: 11.5, color: "var(--muted)" }}>after previous step</span>
        <input value={stepNote} onChange={(e) => setStepNote(e.target.value)} placeholder="Optional note/script" style={{ border: "1px solid var(--border)", borderRadius: 7, padding: "5px 8px", fontSize: 12.5, flex: "1 1 160px" }} />
        <button
          onClick={submitAddStep}
          style={{ background: "#2CC295", color: "#081E22", border: "none", borderRadius: 7, padding: "6px 12px", fontSize: 12, fontWeight: 700 }}
        >
          + Add step
        </button>
      </div>
      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 18 }}>
        Fires as soon as {MIN_WAIT_HOURS} hour after the previous step, or as late as 7 days ({MAX_WAIT_HOURS} hours).
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

      <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>Enroll from a Lead List</div>
      {leadLists.length === 0 ? (
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 16 }}>
          No Lead Lists yet — build one from Scanner's results table (select leads → "Add to list"), then come back here to enroll the whole list at once.
        </div>
      ) : (
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 16 }}>
          <select
            value={listPickerId}
            onChange={(e) => setListPickerId(e.target.value)}
            style={{ border: "1px solid var(--border)", borderRadius: 7, padding: "6px 10px", fontSize: 12.5, minWidth: 200 }}
          >
            <option value="">Choose a list…</option>
            {leadLists.map((l) => (
              <option key={l.id} value={l.id}>{l.name} ({l.rows.length})</option>
            ))}
          </select>
          <button
            onClick={submitEnrollFromList}
            disabled={!listPickerId || seq.steps.length === 0 || !runnable}
            title={!runnable ? "This sequence is paused/archived — activate it to enroll" : seq.steps.length === 0 ? "Add at least one step first" : undefined}
            style={{ background: "#2CC295", color: "#081E22", border: "none", borderRadius: 7, padding: "7px 14px", fontWeight: 700, opacity: !listPickerId || seq.steps.length === 0 || !runnable ? 0.5 : 1 }}
          >
            Enroll list
          </button>
        </div>
      )}

      <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>Or enroll specific contacts (manual)</div>
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
        disabled={!enrollPicker.size || seq.steps.length === 0 || !runnable}
        title={!runnable ? "This sequence is paused/archived — activate it to enroll" : seq.steps.length === 0 ? "Add at least one step first" : undefined}
        style={{ background: "#2CC295", color: "#081E22", border: "none", borderRadius: 8, padding: "7px 14px", fontWeight: 700, opacity: !enrollPicker.size || seq.steps.length === 0 || !runnable ? 0.5 : 1 }}
      >
        Enroll {enrollPicker.size || ""} contact{enrollPicker.size === 1 ? "" : "s"}
      </button>
      {enrollNotice && <span style={{ marginLeft: 10, fontSize: 12, color: "#3A4B8C" }}>{enrollNotice}</span>}
    </div>
  );
}
