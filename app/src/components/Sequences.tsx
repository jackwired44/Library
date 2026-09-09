// Native Sequences (Phase 1 of the Outbound Engine) — see CLAUDE.md
// "Native Sequences." Build a named sequence of call/email/LinkedIn steps
// (each with a wait period), enroll contacts, and work each enrollment's
// current-step task from here (or from the Board/Calls/Emails tabs — same
// shared Task store). Email/LinkedIn steps generate a task to work by
// hand, not an automatic send — flagged in the empty state below too.
import { useMemo, useState, type CSSProperties } from "react";
import type { Contact } from "../lib/contacts";
import { SEQUENCE_TEMPLATES, type SequenceTemplate } from "../lib/sequenceTemplates";
import { renderMerge, tokensIn } from "../lib/mergeFields";
import type { Task } from "../lib/tasks";
import { resolveBodyMode, resolveSendMode, resolveWaitHours, resolveStatus, isSequenceRunnable, MAX_WAIT_HOURS, MAX_STEPS, DAY_NAMES, totalSpanDays, type Sequence, type SequenceEnrollment, type SequenceChannel, type SequenceStep, type SequenceStatus } from "../lib/sequences";
import { userLabel, type PlatformUser } from "../lib/users";
import { type SequenceGroup } from "../lib/sequenceGroups";
import { emailAccountLabel, type EmailAccount } from "../lib/emailAccounts";
import { composeStepEmail, isSendable } from "../lib/emailSend";
import { fetchSentSamples, type SentSample } from "../lib/apolloSamples";
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
  onCreateFromTemplate: (tpl: SequenceTemplate) => Sequence | null;
  onRename: (id: string, name: string) => void;
  onAddStep: (id: string, channel: SequenceChannel, waitHours: number, note?: string, extra?: StepExtra) => void;
  onRemoveStep: (id: string, stepId: string) => void;
  onUpdateStep: (id: string, stepId: string, patch: Partial<Pick<SequenceStep, "note" | "systemPrompt" | "userPrompt" | "subject" | "body" | "sampleBody">>) => void;
  onMoveStep: (id: string, stepId: string, direction: -1 | 1) => void;
  onDelete: (id: string) => void;
  onEnroll: (sequenceId: string, contactIds: string[]) => { enrolled: number; blocked: number };
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
  emailAccounts: EmailAccount[];
  onSetEmailAccount: (id: string, emailAccountId: string | null) => void;
  onAddEmailAccount: (label: string, fromName: string, fromEmail: string) => void;
  onEditEmailAccount: (id: string, patch: Partial<Pick<EmailAccount, "label" | "fromName" | "fromEmail">>) => void;
  onDeleteEmailAccount: (id: string) => void;
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
// The step types a sequence can contain, per Jack: phone call, automatic
// email, manual email, and a LinkedIn request with or without a message.
// These are PRESENTATION over the three real channels — an automatic and
// a manual email are the same channel with a different send mode, and a
// LinkedIn request is one channel with a boolean. Keeping the channel
// enum at three means no step already saved has to be migrated.
export type StepExtra = Partial<Pick<SequenceStep, "sendMode" | "bodyMode" | "linkedinWithMessage">>;

type StepType = "call" | "auto-email" | "manual-email" | "linkedin";
const STEP_TYPES: {
  key: StepType;
  label: string;
  icon: string;
  channel: SequenceChannel;
  sendMode: "auto" | "manual";
  bodyMode?: "ai" | "fixed";
}[] = [
  { key: "call", label: "Phone call", icon: "📞", channel: "call", sendMode: "manual" },
  { key: "auto-email", label: "Automatic email", icon: "⚡", channel: "email", sendMode: "auto", bodyMode: "ai" },
  { key: "manual-email", label: "Manual email", icon: "✉️", channel: "email", sendMode: "manual", bodyMode: "fixed" },
  { key: "linkedin", label: "LinkedIn request", icon: "🔗", channel: "linkedin", sendMode: "manual", bodyMode: "fixed" },
];

// What a step is called, derived from what it actually is. Replaces a
// row that carried an icon, a channel word, a Manual/Automated badge and
// an "AI body" badge — four things saying one thing, and saying it
// inconsistently once a step's note disagreed with its send mode.
// Per-step counts, the way Apollo's sequence page reports them: how many
// contacts are ON this step right now, and how many have already gone
// past it. Computed from enrollments — no new data.
function stepStats(steps: SequenceStep[], enrollments: SequenceEnrollment[]) {
  return steps.map((_, i) => {
    let active = 0;
    let completed = 0;
    enrollments.forEach((e) => {
      if (e.status === "removed") return;
      if (e.status === "active") {
        if (e.currentStepIndex === i) active += 1;
        else if (e.currentStepIndex > i) completed += 1;
      } else if (e.status === "finished") {
        // A finished enrollment worked every step up to where it stopped.
        if (e.currentStepIndex >= i) completed += 1;
      }
    });
    return { active, completed };
  });
}

function stepTypeLabel(step: SequenceStep): { icon: string; label: string } {
  if (step.channel === "call") return { icon: "📞", label: "Phone call" };
  if (step.channel === "linkedin") {
    // A step saved before linkedinWithMessage existed only carries a note
    // if it actually has body text — don't claim one it hasn't got.
    const withNote = step.linkedinWithMessage ?? Boolean(step.body?.trim());
    return { icon: "🔗", label: withNote ? "LinkedIn request with a note" : "LinkedIn request" };
  }
  if (resolveSendMode(step) === "auto") {
    return { icon: "⚡", label: resolveBodyMode(step) === "ai" ? "Automatic email · AI-written" : "Automatic email" };
  }
  return { icon: "✉️", label: "Manual email" };
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
  onCreateFromTemplate,
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
  emailAccounts,
  onSetEmailAccount,
  onAddEmailAccount,
  onEditEmailAccount,
  onDeleteEmailAccount,
}: SequencesProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [showTemplates, setShowTemplates] = useState(false);
  // The page used to open with a seven-line paragraph. The load-bearing
  // sentence stays in the subtitle; the rest is one click away rather
  // than gone — these are honesty statements, not filler.
  const [howOpen, setHowOpen] = useState(false);
  // Who a preview email is "from". The self user is the person using the
  // platform (lib/users.ts) — Apollo greets with a first name, so the
  // preview does too.
  const selfUser = users.find((u) => u.isSelf) || users[0] || null;
  const selfName = (selfUser?.name || "Jack").split(" ")[0];
  const selfCompany = "Wired CIO";
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
  const [managingEmailAccounts, setManagingEmailAccounts] = useState(false);
  const [newAccountLabel, setNewAccountLabel] = useState("");
  const [newAccountFromName, setNewAccountFromName] = useState("");
  const [newAccountFromEmail, setNewAccountFromEmail] = useState("");

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
  function handleUseTemplate(tpl: SequenceTemplate) {
    const seq = onCreateFromTemplate(tpl);
    if (seq) {
      setShowTemplates(false);
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
        <strong>Email and LinkedIn steps generate a task you work by hand</strong> — nothing sends automatically.
      </p>
      <button
        onClick={() => setHowOpen((v) => !v)}
        style={{ border: "none", background: "none", padding: 0, marginBottom: 10, fontSize: 11.5, color: "var(--muted)", textDecoration: "underline", cursor: "pointer" }}
      >
        {howOpen ? "Hide" : "How sequences run here"}
      </button>
      {howOpen && (
        <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px", marginBottom: 12, fontSize: 12, color: "var(--muted)", lineHeight: 1.55, maxWidth: "72ch" }}>
          Each step waits, then generates a task. There is no send or connect integration wired up, so an email step
          produces a task rather than an email — <strong>nothing fires on its own</strong>. &ldquo;Email accounts&rdquo;
          records which sender identity a sequence should use once a real SendGrid connection lands; it is not a live
          connection. A contact&rsquo;s enrollment finishes on its own the moment you actually reach them — any
          &ldquo;reached them&rdquo; disposition, not only Meeting booked. Restart or remove one any time.
        </div>
      )}
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
          onClick={() => setShowTemplates((v) => !v)}
          style={{ border: "1px solid var(--border)", background: "var(--surface)", borderRadius: 8, padding: "8px 14px", fontSize: 12.5, fontWeight: 700 }}
        >
          📋 Templates ({SEQUENCE_TEMPLATES.length})
        </button>
        <button
          onClick={() => setManagingGroups((v) => !v)}
          style={{ border: "1px solid var(--border)", background: "var(--surface)", borderRadius: 8, padding: "8px 14px", fontSize: 12.5, fontWeight: 700 }}
        >
          🗂 Groups ({groups.length})
        </button>
        <button
          onClick={() => setManagingEmailAccounts((v) => !v)}
          style={{ border: "1px solid var(--border)", background: "var(--surface)", borderRadius: 8, padding: "8px 14px", fontSize: 12.5, fontWeight: 700 }}
        >
          ✉️ Email accounts ({emailAccounts.length})
        </button>
      </div>

      {managingEmailAccounts && (
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 16px", marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 700, textTransform: "uppercase", marginBottom: 8 }}>Email sending accounts</div>
          <div style={{ fontSize: 11.5, color: "#9A5B22", background: "#FBEBDD", border: "1px solid #F0DCC0", borderRadius: 8, padding: "8px 12px", marginBottom: 10, lineHeight: 1.5 }}>
            <strong>Not a live connection yet.</strong> This just records which sender identity (name + address) a
            sequence's email steps should use — there's no SendGrid API key or backend here to actually send through
            (a key like that has to live on a server, never in this browser). Email steps still only ever generate a
            task you work by hand until that's built.
          </div>
          {emailAccounts.length === 0 && <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 8 }}>No accounts yet — add one below, then pick it as a sequence's "Send from."</div>}
          <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 10 }}>
            {emailAccounts.map((a) => (
              <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <input
                  defaultValue={a.label}
                  onBlur={(e) => { if (e.target.value.trim() && e.target.value !== a.label) onEditEmailAccount(a.id, { label: e.target.value }); }}
                  placeholder="Label"
                  style={{ flex: "1 1 140px", border: "1px solid var(--border)", borderRadius: 7, padding: "5px 8px", fontSize: 12.5, fontWeight: 600 }}
                />
                <input
                  defaultValue={a.fromName}
                  onBlur={(e) => { if (e.target.value !== a.fromName) onEditEmailAccount(a.id, { fromName: e.target.value }); }}
                  placeholder="From name"
                  style={{ flex: "1 1 140px", border: "1px solid var(--border)", borderRadius: 7, padding: "5px 8px", fontSize: 12.5 }}
                />
                <input
                  defaultValue={a.fromEmail}
                  onBlur={(e) => { if (e.target.value.trim() && e.target.value !== a.fromEmail) onEditEmailAccount(a.id, { fromEmail: e.target.value }); }}
                  placeholder="From email"
                  style={{ flex: "1 1 180px", border: "1px solid var(--border)", borderRadius: 7, padding: "5px 8px", fontSize: 12.5 }}
                />
                <span title="No live connection — see the note above" style={{ fontSize: 9.5, fontWeight: 700, color: "#9A5B22", background: "#FBEBDD", borderRadius: 999, padding: "2px 8px", whiteSpace: "nowrap" }}>
                  Not connected
                </span>
                <button
                  onClick={() => {
                    if (window.confirm(`Delete "${a.label}"? Any sequence using it as its Send-from account reverts to "None selected."`)) onDeleteEmailAccount(a.id);
                  }}
                  title="Delete account"
                  style={{ border: "none", background: "none", color: "#B5443B", fontSize: 13, cursor: "pointer" }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <input
              value={newAccountLabel}
              onChange={(e) => setNewAccountLabel(e.target.value)}
              placeholder="Label (e.g. Wired CIO Outbound)"
              style={{ flex: "1 1 160px", border: "1px solid var(--border)", borderRadius: 7, padding: "6px 8px", fontSize: 12.5 }}
            />
            <input
              value={newAccountFromName}
              onChange={(e) => setNewAccountFromName(e.target.value)}
              placeholder="From name (e.g. Jack at Wired CIO)"
              style={{ flex: "1 1 160px", border: "1px solid var(--border)", borderRadius: 7, padding: "6px 8px", fontSize: 12.5 }}
            />
            <input
              value={newAccountFromEmail}
              onChange={(e) => setNewAccountFromEmail(e.target.value)}
              placeholder="From email"
              style={{ flex: "1 1 180px", border: "1px solid var(--border)", borderRadius: 7, padding: "6px 8px", fontSize: 12.5 }}
            />
            <button
              onClick={() => {
                if (newAccountLabel.trim() && newAccountFromEmail.trim()) {
                  onAddEmailAccount(newAccountLabel, newAccountFromName, newAccountFromEmail);
                  setNewAccountLabel("");
                  setNewAccountFromName("");
                  setNewAccountFromEmail("");
                }
              }}
              disabled={!newAccountLabel.trim() || !newAccountFromEmail.trim()}
              style={{ border: "none", background: "#2CC295", color: "#081E22", borderRadius: 7, padding: "6px 12px", fontSize: 12, fontWeight: 700, opacity: newAccountLabel.trim() && newAccountFromEmail.trim() ? 1 : 0.5 }}
            >
              Add account
            </button>
          </div>
        </div>
      )}

      {showTemplates && (
        <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 14, marginBottom: 18, background: "var(--surface)" }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>Start from a template</div>
          <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 12, lineHeight: 1.5, maxWidth: 620 }}>
            A template creates a brand new sequence here, with every step, wait time and piece of content already
            filled in. It is a starting point, not a link — editing it afterwards changes only your copy.
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {SEQUENCE_TEMPLATES.map((tpl) => (
              <div key={tpl.id} style={{ border: "1px solid var(--border)", borderRadius: 9, padding: 12, background: "var(--surface-sunken)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 700, fontSize: 13 }}>{tpl.name}</span>
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>{tpl.steps.length} steps</span>
                  <button
                    onClick={() => handleUseTemplate(tpl)}
                    style={{ marginLeft: "auto", background: "var(--accent)", color: "#fff", border: "none", borderRadius: 7, padding: "6px 14px", fontSize: 12, fontWeight: 700 }}
                  >
                    Use this template
                  </button>
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)", margin: "6px 0 8px" }}>{tpl.description}</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                  {tpl.steps.map((st, i) => (
                    <span
                      key={i}
                      style={{ border: "1px solid var(--border)", background: "var(--surface)", borderRadius: 999, padding: "2px 9px", fontSize: 11 }}
                    >
                      {i + 1}. {CHANNEL_META[st.channel].icon} {CHANNEL_META[st.channel].label}
                      {st.waitHours > 0 ? ` · ${formatWait(st.waitHours)}` : " · immediately"}
                    </span>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: "var(--muted)", fontStyle: "italic" }}>{tpl.source}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {managingGroups && (
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 16px", marginBottom: 16 }}>
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
              background: statusFilter === f ? "linear-gradient(90deg, var(--accent), var(--accent-blue))" : "var(--surface)",
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
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: 28, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
          No sequences yet — name one above to start building it.
        </div>
      ) : visible.length === 0 ? (
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: 28, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
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
                        borderRadius: 10,
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
                              {seq.emailAccountId && ` · sends from: ${emailAccountLabel(emailAccounts, seq.emailAccountId)}`}
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
                            <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 700, textTransform: "uppercase" }}>Send from</span>
                            <select
                              title="Which email account this sequence's email steps will send from once real sending exists — not a live connection yet"
                              aria-label="Send from"
                              value={seq.emailAccountId || ""}
                              onChange={(e) => onSetEmailAccount(seq.id, e.target.value || null)}
                              style={{ border: "1px solid var(--border)", borderRadius: 7, padding: "5px 8px", fontSize: 12.5 }}
                            >
                              <option value="">None selected</option>
                              {emailAccounts.map((a) => (
                                <option key={a.id} value={a.id}>{a.label}</option>
                              ))}
                            </select>
                            {!runnable && (
                              <span style={{ fontSize: 11.5, color: "#9A5B22" }}>
                                {status === "paused" ? "Paused" : "Archived"} — no new enrollments or step tasks until reactivated.
                              </span>
                            )}
                          </div>
                          <SequenceRulesPanel seq={seq} />
                          <SequenceDetail
                            seq={seq}
                            emailAccounts={emailAccounts}
                            selfName={selfName}
                            selfCompany={selfCompany}
                            enrollments={seqEnrollments}
                            contacts={contacts}
                            leadLists={leadLists}
                            contactById={contactById}
                            taskById={taskById}
                            runnable={runnable}
                            onRename={(name) => onRename(seq.id, name)}
                            onAddStep={(channel, waitHours, note, extra) => onAddStep(seq.id, channel, waitHours, note, extra)}
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
  emailAccounts,
  selfName,
  selfCompany,
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
  emailAccounts: EmailAccount[];
  selfName: string;
  selfCompany: string;
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
  onAddStep: (channel: SequenceChannel, waitHours: number, note?: string, extra?: StepExtra) => void;
  onRemoveStep: (stepId: string) => void;
  onUpdateStep: (stepId: string, patch: Partial<Pick<SequenceStep, "note" | "systemPrompt" | "userPrompt" | "subject" | "body" | "sampleBody">>) => void;
  onMoveStep: (stepId: string, dir: -1 | 1) => void;
  onEnroll: (contactIds: string[]) => { enrolled: number; blocked: number };
  onRestart: (enrollmentId: string) => void;
  onRemoveEnrollment: (enrollmentId: string) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(seq.name);
  const [stepWaitValue, setStepWaitValue] = useState(1);
  const [stepWaitUnit, setStepWaitUnit] = useState<"hours" | "days">("days");
  const [stepNote, setStepNote] = useState("");
  // Which step's AI-prompt editor (system/user prompt) is expanded — one
  // at a time, collapsed by default so the step list stays scannable.
  const [promptEditorStepId, setPromptEditorStepId] = useState<string | null>(null);
  const [contentEditorStepId, setContentEditorStepId] = useState<string | null>(null);
  const [listPickerId, setListPickerId] = useState("");
  const [stepType, setStepType] = useState<StepType>("call");
  const [linkedinWithMessage, setLinkedinWithMessage] = useState(true);
  const [stepDay, setStepDay] = useState<string>("");
  const [stepTime, setStepTime] = useState<string>("");
  const [enrollPicker, setEnrollPicker] = useState<Set<string>>(new Set());
  const [enrollSearch, setEnrollSearch] = useState("");
  // Enrollments that still count: a removed one is history, not a member.
  const liveEnrollments = useMemo(() => enrollments.filter((e) => e.status !== "removed"), [enrollments]);
  const stepCounts = useMemo(() => stepStats(seq.steps, liveEnrollments), [seq.steps, liveEnrollments]);
  const ENROLL_PAGE = 50;
  const enrollMatches = useMemo(() => {
    const q = enrollSearch.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter((c) =>
      [c.fullName, c.firstName, c.lastName, c.company, c.email, c.title]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    );
  }, [contacts, enrollSearch]);
  const enrollMatchCount = enrollMatches.length;
  const enrollCandidates = useMemo(() => enrollMatches.slice(0, ENROLL_PAGE), [enrollMatches]);
  const [enrollNotice, setEnrollNotice] = useState<string | null>(null);

  function commitRename() {
    onRename(nameDraft);
    setRenaming(false);
  }
  function submitAddStep() {
    const hours = stepWaitUnit === "hours" ? stepWaitValue : stepWaitValue * 24;
    const t = STEP_TYPES.find((x) => x.key === stepType)!;
    onAddStep(t.channel, hours, stepNote.trim() || undefined, {
      sendMode: t.sendMode,
      bodyMode: t.bodyMode,
      ...(t.channel === "linkedin" ? { linkedinWithMessage } : {}),
      ...(stepDay !== "" ? { sendDayOfWeek: Number(stepDay) } : {}),
      ...(stepTime ? { sendTime: stepTime } : {}),
    });
    setStepNote("");
    setStepWaitValue(1);
  }
  function submitEnroll() {
    const ids = [...enrollPicker];
    if (!ids.length) return;
    const { enrolled, blocked } = onEnroll(ids);
    const skipped = ids.length - enrolled - blocked;
    const parts = [`Enrolled ${enrolled} contact${enrolled === 1 ? "" : "s"}`];
    if (skipped > 0) parts.push(`${skipped} already active in this sequence`);
    if (blocked > 0) parts.push(`${blocked} skipped as Do not contact`);
    setEnrollNotice(`${parts.join(" — ")}.`);
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
    const { enrolled, blocked } = onEnroll(resolved.map((c) => c.id));
    const skipped = resolved.length - enrolled - blocked;
    const parts = [`Enrolled ${enrolled} contact${enrolled === 1 ? "" : "s"} from "${list.name}"`];
    if (skipped > 0) parts.push(`${skipped} already active in this sequence`);
    if (blocked > 0) parts.push(`${blocked} skipped as Do not contact`);
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

      {/* Sequence summary, the strip Apollo puts above its steps. */}
      <div className="seq-summary">
        <div className="seq-stat"><span>Active</span><b>{liveEnrollments.filter((e) => e.status === "active").length}</b></div>
        <div className="seq-stat"><span>Finished</span><b>{liveEnrollments.filter((e) => e.status === "finished").length}</b></div>
        <div className="seq-stat"><span>Total enrolled</span><b>{liveEnrollments.length}</b></div>
        <div className="seq-stat"><span>Steps</span><b>{seq.steps.length} of {MAX_STEPS}</b></div>
        <div className="seq-stat"><span>Runs</span><b>{totalSpanDays(seq)}d</b></div>
      </div>

      <div className="seq-section-head">
        <span>Steps</span>
        {seq.steps.length > 0 && (
          <span className="seq-section-note">
            Each step generates a task when the one before it is completed.
          </span>
        )}
      </div>
      {seq.steps.length === 0 ? (
        <div className="calm-state" style={{ marginBottom: 10 }}>
          <div className="calm-title">No steps yet</div>
          <div className="calm-body">Add the first touch below — a call, an email, or a LinkedIn request.</div>
        </div>
      ) : (
        <div className="seq-steps">
          {seq.steps.map((step, i) => {
            const hasPrompt = Boolean(step.systemPrompt?.trim() || step.userPrompt?.trim());
            const promptOpen = promptEditorStepId === step.id;
            const contentOpen = contentEditorStepId === step.id;
            // A call step has no message to write — content is only
            // meaningful on the channels that actually send something.
            const writesContent = step.channel !== "call";
            const hasContent = Boolean(step.subject?.trim() || step.body?.trim());
            const wait = resolveWaitHours(step);
            const stat = stepCounts[i] || { active: 0, completed: 0 };
            return (
              <div key={step.id} data-step-type={stepTypeLabel(step).label} data-step-channel={step.channel}>
                {/* The wait sits BETWEEN steps, as its own rule — Apollo
                    reads as a timeline for this reason: the gap is a thing
                    that happens, not an attribute of the row after it. */}
                <div className="seq-wait">
                  <span className="seq-wait-line" />
                  <span className="seq-wait-text">
                    {wait > 0 ? `Wait ${formatWait(wait)}` : i === 0 ? "Starts immediately" : "Immediately after"}
                  </span>
                  <span className="seq-wait-line" />
                </div>
                <div className="seq-step">
                  <div className="seq-step-num">STEP {i + 1}</div>
                  <div className="seq-step-main">
                  <span style={{ fontWeight: 600 }}>{stepTypeLabel(step).icon} {stepTypeLabel(step).label}</span>
                  {(step.sendDayOfWeek !== null && step.sendDayOfWeek !== undefined) && (
                    <span title="Rolled forward to this weekday" style={{ fontSize: 10.5, fontWeight: 700, color: "#0A66C2", background: "#EAF3FC", borderRadius: 999, padding: "1px 7px" }}>
                      {DAY_NAMES[step.sendDayOfWeek]}s
                    </span>
                  )}
                  {step.sendTime && (
                    <span title="Time of day on the generated task" style={{ fontSize: 10.5, fontWeight: 700, color: "var(--muted)", background: "var(--surface-sunken)", border: "1px solid var(--border)", borderRadius: 999, padding: "1px 7px" }}>
                      {step.sendTime}
                    </span>
                  )}

                  {/* Where people actually are, per step — Apollo's own
                      per-step reporting, from our enrollments. */}
                  {(stat.active > 0 || stat.completed > 0) && (
                    <span className="seq-step-counts">
                      {stat.active > 0 && <span title="Contacts sitting on this step now">{stat.active} on this step</span>}
                      {stat.completed > 0 && <span title="Contacts who have worked past this step">{stat.completed} past it</span>}
                    </span>
                  )}
                  <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4 }}>
                    {writesContent && (
                      <button
                        onClick={() => {
                          // ONE editor per step. Content and the AI prompts
                          // were two buttons opening two stacked panels that
                          // edit the same message; they are one panel now.
                          const open = contentOpen || promptOpen;
                          setContentEditorStepId(open ? null : step.id);
                          setPromptEditorStepId(open ? null : step.id);
                        }}
                        title="Write this step — subject, body, and the AI prompts, with a live preview against a real lead"
                        style={{
                          border: `1px solid ${hasContent || hasPrompt ? "#BFE5DC" : "var(--border)"}`,
                          borderRadius: 999,
                          padding: "2px 10px",
                          fontSize: 10.5,
                          fontWeight: 700,
                          cursor: "pointer",
                          background: hasContent || hasPrompt ? "#E6F5F1" : "var(--surface)",
                          color: hasContent || hasPrompt ? "var(--accent)" : "var(--muted)",
                        }}
                      >
                        {contentOpen || promptOpen ? "Close" : "Edit"}{hasContent || hasPrompt ? " ✓" : ""}
                      </button>
                    )}
                    <button onClick={() => onMoveStep(step.id, -1)} disabled={i === 0} title="Move earlier" style={{ border: "none", background: "none", cursor: i === 0 ? "default" : "pointer", opacity: i === 0 ? 0.3 : 1 }}>▲</button>
                    <button onClick={() => onMoveStep(step.id, 1)} disabled={i === seq.steps.length - 1} title="Move later" style={{ border: "none", background: "none", cursor: i === seq.steps.length - 1 ? "default" : "pointer", opacity: i === seq.steps.length - 1 ? 0.3 : 1 }}>▼</button>
                    <button onClick={() => onRemoveStep(step.id)} title="Remove step" style={{ border: "none", background: "none", color: "#B5443B" }}>✕</button>
                  </span>
                  </div>
                  {step.note && <div className="seq-step-note">{step.note}</div>}
                </div>
                {promptOpen && (
                  <div className="prompt-split" style={{ background: "var(--surface)", border: "1px solid var(--border)", borderTop: "none", borderRadius: "0 0 8px 8px", padding: "10px 12px", marginTop: -1 }}>
                    <div className="prompt-col">
                      <StepContentEditor
                        step={step}
                        onUpdate={(patch) => onUpdateStep(step.id, patch)}
                      />
                    <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 10, lineHeight: 1.5 }}>
                      These two prompts <strong>are</strong> the email on an automatic step — the body is written per
                      contact from them rather than sent as fixed text, so editing them changes every email this step
                      produces. Kept exactly as written, no reformatting.{" "}
                      <strong>Nothing calls an AI from this app yet</strong>; these are stored so the wording is ready
                      the moment sending is.
                      <div style={{ marginTop: 6 }}>
                        Merge fields available:{" "}
                        {["{{contact.first_name}}", "{{account.name}}", "{{contact.title}}"].map((v) => (
                          <code
                            key={v}
                            style={{ background: "var(--surface-sunken)", border: "1px solid var(--border)", borderRadius: 4, padding: "1px 5px", marginRight: 4, fontSize: 10.5 }}
                          >
                            {v}
                          </code>
                        ))}
                        <span style={{ marginLeft: 4 }}>
                          — wrap an optional one as <code style={{ fontSize: 10.5 }}>{"{{#if contact.title}}…{{#endif}}"}</code>
                        </span>
                      </div>
                    </div>
                    <label style={{ display: "block", fontSize: 10.5, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", marginBottom: 3 }}>System prompt</label>
                    <textarea
                      aria-label="System prompt"
                      defaultValue={step.systemPrompt || ""}
                      onBlur={(e) => onUpdateStep(step.id, { systemPrompt: e.target.value })}
                      placeholder="e.g. You are a friendly, concise SDR at Wired CIO writing a short first-touch email…"
                      rows={2}
                      style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 7, padding: "6px 8px", fontSize: 12, marginBottom: 8, resize: "vertical", boxSizing: "border-box" }}
                    />
                    <label style={{ display: "block", fontSize: 10.5, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", marginBottom: 3 }}>User prompt</label>
                    <textarea
                      aria-label="User prompt"
                      defaultValue={step.userPrompt || ""}
                      onBlur={(e) => onUpdateStep(step.id, { userPrompt: e.target.value })}
                      placeholder="e.g. Write a 3-sentence intro referencing {{company}}'s Dynamics 365 interest and asking for 15 minutes."
                      rows={10}
                      style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 7, padding: "8px 10px", fontSize: 12, lineHeight: 1.5, resize: "vertical", boxSizing: "border-box", fontFamily: "var(--font-mono, ui-monospace, monospace)" }}
                    />
                    <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 6 }}>
                      Saved when you click away from the box.
                    </div>
                    </div>
                    <div className="preview-col">
                      <EmailPreview
                        step={step}
                        contacts={contacts}
                        account={emailAccounts.find((a) => a.id === seq.emailAccountId) || null}
                        sender={{ name: selfName, company: selfCompany }}
                        apolloCampaignId={seq.apolloCampaignId}
                        onUpdateDraft={(text) => onUpdateStep(step.id, { sampleBody: text })}
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
        <select
          value={stepType}
          onChange={(e) => setStepType(e.target.value as StepType)}
          aria-label="Step type"
          style={{ border: "1px solid var(--border)", borderRadius: 7, padding: "5px 8px", fontSize: 12.5 }}
        >
          {STEP_TYPES.map((t) => (
            <option key={t.key} value={t.key}>{t.icon} {t.label}</option>
          ))}
        </select>
        {stepType === "linkedin" && (
          <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--muted)" }}>
            <input type="checkbox" checked={linkedinWithMessage} onChange={(e) => setLinkedinWithMessage(e.target.checked)} />
            with a message
          </label>
        )}
        <input
          type="number"
          min={0}
          max={stepWaitUnit === "hours" ? MAX_WAIT_HOURS : Math.round(MAX_WAIT_HOURS / 24)}
          value={stepWaitValue}
          onChange={(e) => setStepWaitValue(Number(e.target.value))}
          style={{ width: 60, border: "1px solid var(--border)", borderRadius: 7, padding: "5px 8px", fontSize: 12.5 }}
        />
        <select value={stepWaitUnit} onChange={(e) => setStepWaitUnit(e.target.value as "hours" | "days")} style={{ border: "1px solid var(--border)", borderRadius: 7, padding: "5px 8px", fontSize: 12.5 }}>
          <option value="hours">hours</option>
          <option value="days">days</option>
        </select>
        <span style={{ fontSize: 11.5, color: "var(--muted)" }}>after previous step</span>
        <select
          value={stepDay}
          onChange={(e) => setStepDay(e.target.value)}
          aria-label="Preferred day"
          title="Roll this step forward to a particular weekday. Forward only — it can delay a touch, never make it land earlier."
          style={{ border: "1px solid var(--border)", borderRadius: 7, padding: "5px 8px", fontSize: 12.5 }}
        >
          <option value="">Any day</option>
          {DAY_NAMES.map((d, i) => (
            <option key={d} value={i}>{d}</option>
          ))}
        </select>
        <input
          type="time"
          value={stepTime}
          onChange={(e) => setStepTime(e.target.value)}
          aria-label="Time of day"
          title="Time of day for the generated task"
          style={{ border: "1px solid var(--border)", borderRadius: 7, padding: "5px 8px", fontSize: 12.5 }}
        />
        <input value={stepNote} onChange={(e) => setStepNote(e.target.value)} placeholder="Optional note/script" style={{ border: "1px solid var(--border)", borderRadius: 7, padding: "5px 8px", fontSize: 12.5, flex: "1 1 160px" }} />
        <button
          onClick={submitAddStep}
          disabled={seq.steps.length >= MAX_STEPS}
          title={seq.steps.length >= MAX_STEPS ? `A sequence holds at most ${MAX_STEPS} steps.` : undefined}
          style={{
            background: seq.steps.length >= MAX_STEPS ? "var(--surface-sunken)" : "#2CC295",
            color: seq.steps.length >= MAX_STEPS ? "var(--muted)" : "#081E22",
            border: "none", borderRadius: 7, padding: "6px 12px", fontSize: 12, fontWeight: 700,
          }}
        >
          + Add step
        </button>
      </div>
      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 18 }}>
        {seq.steps.length} of {MAX_STEPS} steps · runs about {totalSpanDays(seq)} day{totalSpanDays(seq) === 1 ? "" : "s"} end to end.
        Use 0 to fire immediately after the previous step; a single gap can be up to {Math.round(MAX_WAIT_HOURS / 24)} days.
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
      {/* Searched and capped. This rendered EVERY contact — the same
          unpaginated pattern measured at ~5 seconds and 77,500 DOM nodes
          in Contacts, still here because this picker was never touched.
          Selection is a Set of ids, so it survives narrowing the search. */}
      <input
        value={enrollSearch}
        onChange={(e) => setEnrollSearch(e.target.value)}
        placeholder="Search contacts…"
        style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 7, padding: "6px 9px", fontSize: 12.5, marginBottom: 6, boxSizing: "border-box" }}
      />
      <div style={{ maxHeight: 160, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 8, marginBottom: 4 }}>
        {enrollCandidates.map((c) => (
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
        {enrollCandidates.length === 0 && (
          <div style={{ padding: "8px 10px", fontSize: 12, color: "var(--muted)" }}>No contacts match that search.</div>
        )}
      </div>
      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8 }}>
        {enrollMatchCount > enrollCandidates.length
          ? `Showing ${enrollCandidates.length} of ${enrollMatchCount} matches — search to narrow. ${enrollPicker.size} selected.`
          : `${enrollMatchCount} contact${enrollMatchCount === 1 ? "" : "s"}. ${enrollPicker.size} selected.`}
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

/* ------------------------------------------------------------------ */
/* Step content — subject/body with merge fields and a live preview     */
/* ------------------------------------------------------------------ */

// Only rendered for channels that actually say something (email,
// LinkedIn). Values save on blur, the same low-friction pattern the AI
// prompt editor beside it already uses.
//
// The preview resolves against a real Contact from the directory rather
// than fake sample data, so what shows here is exactly what the rep will
// read on the generated task. With no contacts on file yet it says so
// instead of rendering a template full of empty gaps.
function StepContentEditor({
  step,
  onUpdate,
}: {
  step: SequenceStep;
  onUpdate: (patch: Partial<Pick<SequenceStep, "subject" | "body">>) => void;
}) {
  const isEmail = step.channel === "email";
  const unresolved: string[] = [];
  const used = Array.from(new Set([...tokensIn(step.subject || ""), ...tokensIn(step.body || "")]));

  const label: CSSProperties = {
    display: "block",
    fontSize: 10.5,
    fontWeight: 700,
    color: "var(--muted)",
    textTransform: "uppercase",
    marginBottom: 3,
  };
  const field: CSSProperties = {
    width: "100%",
    border: "1px solid var(--border)",
    borderRadius: 7,
    padding: "6px 8px",
    fontSize: 12,
    resize: "vertical",
    boxSizing: "border-box",
  };

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 10.5, color: "var(--muted)", marginBottom: 8, lineHeight: 1.4 }}>
        What this step says. Merge fields like <code>{"{{contact.first_name}}"}</code>, <code>{"{{contact.title}}"}</code>{" "}
        and <code>{"{{account.name}}"}</code> are filled from the contact when the step&rsquo;s task is created.{" "}
        <strong>Saving content here does not send anything</strong> &mdash; the step still generates a task to work by
        hand.
      </div>

      {isEmail && (
        <>
          <label style={label}>Subject</label>
          <input
            aria-label="Subject line"
            defaultValue={step.subject || ""}
            onBlur={(e) => onUpdate({ subject: e.target.value })}
            placeholder="e.g. Microsoft Solutions"
            style={{ ...field, marginBottom: 8 }}
          />
        </>
      )}

      <label style={label}>{isEmail ? "Body" : "Message"}</label>
      <textarea
        aria-label="Message body"
        defaultValue={step.body || ""}
        onBlur={(e) => onUpdate({ body: e.target.value })}
        placeholder={isEmail ? "Leave blank if the body is written from the AI prompts on this step." : "Hey {{contact.first_name}}, …"}
        rows={4}
        style={field}
      />

      {isEmail && !step.body?.trim() && (step.systemPrompt?.trim() || step.userPrompt?.trim()) && (
        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6, lineHeight: 1.4 }}>
          No fixed body &mdash; this step&rsquo;s email is written from its <strong>AI prompt</strong> (the button beside
          Content). That matches how it runs in Apollo. Nothing here generates it yet, so today you write the body from
          those prompts when you work the task.
        </div>
      )}

      {used.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={label}>Merge fields used</div>
          <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
            {used.map((t) => `{{${t}}}`).join(", ")} — see the preview beside this panel for how they fill in for a
            real lead.
          </div>
          {unresolved.length > 0 && (
            <div style={{ fontSize: 11, color: "#8A5A00", marginTop: 6 }}>
              Not a field this app knows: {unresolved.map((t) => `{{${t}}}`).join(", ")} — left visible so it
              can&rsquo;t ship half-filled.
            </div>
          )}
        </div>
      )}
    </div>
  );
}


// The house rules a sequence runs under, copied from Apollo's own
// settings. RECORDED, NOT ENFORCED — there is no sending engine in this
// app to enforce them against, and saying otherwise would be the same
// kind of lie as a fake "connected" badge. The panel states that in
// plain text rather than leaving it to be discovered.
function SequenceRulesPanel({ seq }: { seq: Sequence }) {
  const [open, setOpen] = useState(false);
  const r = seq.rules;
  if (!r) return null;
  const rows: { label: string; value: string; enforced: boolean }[] = [
    { label: "Finish on reply", value: r.finishOnReply ? "On" : "Off", enforced: false },
    { label: "Finish if marked interested", value: r.finishIfInterested ? "On" : "Off", enforced: true },
    { label: "Pause on out-of-office", value: r.pauseIfOutOfOffice ? "On" : "Off", enforced: false },
    { label: "Wait before a reply counts", value: `${r.daysToWaitBeforeResponse ?? 0} days`, enforced: false },
    { label: "Same-company reply delay", value: `${r.sameAccountReplyDelayDays ?? 0} days`, enforced: false },
    { label: "Max emails per day", value: r.maxEmailsPerDay ? String(r.maxEmailsPerDay) : "No cap", enforced: false },
  ];
  if (r.autoPause) {
    rows.push({
      label: "Auto-pause",
      value: r.autoPause.enabled
        ? `warn ${r.autoPause.warningThresholdPct}% · pause ${r.autoPause.pauseThresholdPct}% over ${r.autoPause.evaluationWindowDays}d (min ${r.autoPause.minVolume} sends)`
        : "Off",
      enforced: false,
    });
  }
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 8, marginTop: 8, background: "var(--surface-sunken)" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", border: "none", background: "none", padding: "7px 10px", cursor: "pointer", fontSize: 12, fontWeight: 700, color: "var(--muted)" }}
      >
        <span>{open ? "▾" : "▸"}</span>
        <span>Sequence rules</span>
        <span style={{ fontWeight: 500 }}>— copied from Apollo, recorded but not yet enforced</span>
      </button>
      {open && (
        <div style={{ padding: "0 10px 10px" }}>
          <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 8, lineHeight: 1.5 }}>
            These are the settings the sequence runs under in Apollo. This app has no sending engine, so only the
            rule marked <b>Live</b> below actually does anything here today — the rest are stored so they survive to
            whenever real sending is built, not silently obeyed.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: "4px 10px", fontSize: 12 }}>
            {rows.map((row) => (
              <span key={row.label} style={{ display: "contents" }}>
                <span style={{ color: "var(--muted)" }}>{row.label}</span>
                <span style={{ fontWeight: 600 }}>{row.value}</span>
                <span
                  title={row.enforced
                    ? "This one really happens here: a connected disposition finishes the contact's enrollment."
                    : "Stored only — nothing in this app acts on it yet."}
                  style={{
                    fontSize: 9.5,
                    fontWeight: 700,
                    borderRadius: 999,
                    padding: "1px 7px",
                    color: row.enforced ? "#2CC295" : "var(--muted)",
                    background: row.enforced ? "#E7F1EA" : "var(--surface)",
                    border: row.enforced ? "none" : "1px solid var(--border)",
                  }}
                >
                  {row.enforced ? "Live" : "Recorded"}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}


// Preview one step's email against a real lead.
//
// It runs composeStepEmail — the SAME function a real send would use, and
// the one scripts/test-email-send.mjs covers — so the preview and an
// actual send can never disagree about what would go out or about why it
// would not. That is the whole point of previewing here rather than
// re-rendering the fields separately.
function EmailPreview({
  step,
  contacts,
  account,
  sender,
  apolloCampaignId,
  onUpdateDraft,
}: {
  step: SequenceStep;
  contacts: Contact[];
  account: EmailAccount | null;
  sender: { name: string; company: string };
  apolloCampaignId?: string | null;
  onUpdateDraft?: (text: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [pickedId, setPickedId] = useState<string>("");
  const [samples, setSamples] = useState<SentSample[]>([]);
  const [sampleErr, setSampleErr] = useState<string | null>(null);
  const [loadingSamples, setLoadingSamples] = useState(false);

  async function pullSamples() {
    if (!apolloCampaignId) return;
    setLoadingSamples(true);
    setSampleErr(null);
    const res = await fetchSentSamples(apolloCampaignId, 3, sender.name);
    setSamples(res.samples);
    setSampleErr(res.error || null);
    setLoadingSamples(false);
  }

  // Leads worth previewing against are ones with an email — a contact
  // with none can still be picked (it demonstrates the blocker) but the
  // ones that can actually receive mail come first.
  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    const scored = contacts.filter((c) => {
      if (!q) return true;
      return [c.firstName, c.lastName, c.fullName, c.company, c.email, c.title]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
    return [...scored].sort((a, b) => Number(Boolean(b.email)) - Number(Boolean(a.email))).slice(0, 50);
  }, [contacts, search]);

  // The previewed lead must be one the dropdown is actually showing —
  // otherwise narrowing the search leaves the <select> displaying
  // candidates[0] while the preview below still describes a hidden
  // contact, and the two silently disagree.
  const picked = useMemo(
    () => candidates.find((c) => c.id === pickedId) || candidates[0] || null,
    [pickedId, candidates]
  );

  // A LinkedIn step is not an email: it has no subject, no sending
  // account and no envelope, so running the email composer over it
  // produced a red "Would not send" it could never clear. Preview its
  // note instead.
  const isEmailStep = step.channel === "email";
  const composed = useMemo(
    () => (picked && isEmailStep ? composeStepEmail(step, picked, account, sender) : null),
    [step, picked, account, sender, isEmailStep]
  );
  const noteRendered = useMemo(
    () => (picked ? renderMerge(step.body || "", { contact: picked, senderName: sender.name, senderCompany: sender.company }).text : ""),
    [step.body, picked, sender]
  );
  const bodyMode = resolveBodyMode(step);
  // The draft. On an AI step the real body is written per contact at send
  // time and this app has no model to write it — so what is previewed is
  // a draft kept ON the step, merged for whichever lead is picked. It is
  // an example of what the prompts produce, not a promise of what will
  // send, and the panel says so.
  const draftRendered = useMemo(
    () => (picked ? renderMerge(step.sampleBody || "", { contact: picked, senderName: sender.name, senderCompany: sender.company }).text : ""),
    [step.sampleBody, picked, sender]
  );

  // The prompts as they would actually reach a model: merge fields
  // resolved against THIS lead. This is the part Jack tunes by hand, so
  // seeing it filled in for a real person is the test that matters.
  const promptCtx = { contact: picked, senderName: sender.name, senderCompany: sender.company };
  const systemResolved = step.systemPrompt ? renderMerge(step.systemPrompt, promptCtx).text : "";
  const userResolved = step.userPrompt ? renderMerge(step.userPrompt, promptCtx).text : "";

  const mono: CSSProperties = {
    whiteSpace: "pre-wrap",
    fontFamily: "var(--font-mono, ui-monospace, monospace)",
    fontSize: 11.5,
    lineHeight: 1.55,
    background: "var(--surface-sunken)",
    border: "1px solid var(--border)",
    borderRadius: 7,
    padding: "8px 10px",
    maxHeight: 260,
    overflow: "auto",
  };
  const label: CSSProperties = {
    display: "block",
    fontSize: 10.5,
    fontWeight: 700,
    color: "var(--muted)",
    textTransform: "uppercase",
    margin: "10px 0 4px",
  };

  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderTop: "none", borderRadius: "0 0 8px 8px", padding: "10px 12px", marginTop: -1 }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" }}>Preview against</span>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search leads…"
          style={{ border: "1px solid var(--border)", borderRadius: 7, padding: "5px 8px", fontSize: 12.5, width: 160 }}
        />
        <select
          value={picked?.id || ""}
          onChange={(e) => setPickedId(e.target.value)}
          aria-label="Preview lead"
          style={{ border: "1px solid var(--border)", borderRadius: 7, padding: "5px 8px", fontSize: 12.5, flex: "1 1 220px" }}
        >
          {candidates.length === 0 && <option value="">No contacts yet — upload a CSV in Scanner</option>}
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {(c.fullName || `${c.firstName} ${c.lastName}`).trim() || "Unnamed"}
              {c.company ? ` · ${c.company}` : ""}
              {c.email ? "" : " (no email)"}
            </option>
          ))}
        </select>
      </div>

      {!picked && (
        <div style={{ fontSize: 12, color: "var(--muted)" }}>
          Upload a CSV in Scanner first — the preview fills merge fields from a real lead rather than made-up sample data.
        </div>
      )}

      {picked && !isEmailStep && (
        <>
          <label style={label}>Note — as it would send</label>
          <div style={mono}>{noteRendered || "(this step sends a connection request with no note)"}</div>
          <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 6 }}>
            A LinkedIn step has no subject or sending account — it generates a task you send from LinkedIn yourself.
          </div>
        </>
      )}

      {picked && isEmailStep && composed && (
        <>
          {/* Would this actually go out? Same check the sender runs. */}
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              borderRadius: 7,
              padding: "7px 10px",
              fontSize: 12,
              background: isSendable(composed) ? "#E7F1EA" : "#FBEAE8",
              color: isSendable(composed) ? "#1F7A45" : "#B5443B",
            }}
          >
            <span style={{ fontWeight: 700 }}>{isSendable(composed) ? "✓ Would send" : "✕ Would not send"}</span>
            <span style={{ flex: 1 }}>
              {isSendable(composed)
                ? "Everything this message needs is present. Nothing sends yet — there is no relay connected."
                : composed.blockers.map((b) => b.message).join(" ")}
            </span>
          </div>

          <label style={label}>Envelope</label>
          <div style={{ ...mono, maxHeight: "none" }}>
            {`From: ${composed.fromName || "(no sending account selected)"}${composed.fromEmail ? ` <${composed.fromEmail}>` : ""}
To:   ${composed.toName}${composed.to ? ` <${composed.to}>` : " (no email on file)"}
Subj: ${composed.subject || "(none)"}`}
          </div>

          {bodyMode === "ai" ? (
            <>
              <div style={{ fontSize: 11.5, color: "var(--muted)", margin: "10px 0 0", lineHeight: 1.5 }}>
                This step&rsquo;s body is written per contact from the two prompts below. They are shown here{" "}
                <strong>exactly as they would reach a model</strong>, with merge fields filled in for{" "}
                {(picked.fullName || `${picked.firstName} ${picked.lastName}`).trim() || "this lead"}. No model is
                connected to this app, so the finished body cannot be generated here — what you are checking is that
                the instructions are right.
              </div>
              <label style={label}>Draft — merged for {(picked.fullName || `${picked.firstName} ${picked.lastName}`).trim() || "this lead"}</label>
              {draftRendered ? (
                <div style={mono}>{draftRendered}</div>
              ) : (
                <div style={{ fontSize: 11.5, color: "var(--muted)", lineHeight: 1.5 }}>
                  No draft saved on this step yet. Paste one below and it will render here merged for whichever lead
                  you pick — useful for judging the prompts against real wording.
                </div>
              )}
              <textarea
                aria-label="Draft"
                defaultValue={step.sampleBody || ""}
                onBlur={(e) => onUpdateDraft?.(e.target.value)}
                placeholder="Paste a draft here — {{contact.first_name}} and {{account.name}} merge per lead."
                rows={4}
                style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 7, padding: "7px 9px", fontSize: 11.5, lineHeight: 1.5, resize: "vertical", boxSizing: "border-box", marginTop: 6, fontFamily: "var(--font-mono, ui-monospace, monospace)" }}
              />
              <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 4 }}>
                A draft is an example of what these prompts produce. The body that actually sends is written per contact
                at send time.
              </div>

              {/* Real output. Apollo has no preview API — checked — but it
                  does have every email this sequence already sent, written
                  by these same prompts. Real delivered copy beats an
                  invented sample. */}
              <label style={label}>What these prompts actually produced</label>
              {apolloCampaignId ? (
                <>
                  <button
                    onClick={pullSamples}
                    disabled={loadingSamples}
                    style={{ border: "1px solid var(--border)", background: "var(--surface)", borderRadius: 7, padding: "5px 10px", fontSize: 12, fontWeight: 700, color: "var(--accent)" }}
                  >
                    {loadingSamples ? "Pulling…" : samples.length ? "↻ Pull 3 more" : "Pull real examples from Apollo"}
                  </button>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
                    Reads emails this sequence has already delivered. No credits, nothing written back.
                  </div>
                  {sampleErr && <div style={{ fontSize: 11.5, color: "#9A5B22", marginTop: 6 }}>{sampleErr}</div>}
                  {samples.map((sm) => (
                    <div key={sm.id} style={{ marginTop: 8 }}>
                      <div style={{ fontSize: 10.5, color: "var(--muted)", marginBottom: 3 }}>
                        to {sm.to}{sm.sentAt ? ` · ${sm.sentAt.slice(0, 10)}` : ""}
                      </div>
                      <div style={mono}>{sm.body}</div>
                    </div>
                  ))}
                </>
              ) : (
                <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
                  This sequence isn&rsquo;t linked to an Apollo sequence, so there is no delivered output to read back.
                </div>
              )}

              <label style={label}>System prompt — as sent</label>
              <div style={mono}>{systemResolved || "(empty — this step has no system prompt)"}</div>
              <label style={label}>User prompt — as sent</label>
              <div style={mono}>{userResolved || "(empty — this step has no user prompt)"}</div>
            </>
          ) : (
            <>
              <label style={label}>Body — as it would send</label>
              <div style={mono}>{composed.body || "(this step has no body written)"}</div>
            </>
          )}

          {composed.warnings.length > 0 && (
            <div style={{ fontSize: 11.5, color: "#9A5B22", marginTop: 8 }}>
              {composed.warnings.join(" ")}
            </div>
          )}
        </>
      )}
    </div>
  );
}
