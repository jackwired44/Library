// Engage — a nav-level grouping of the sales-motion tools under one tab,
// separate from the lead-processing tools (Scanner/Lead Library/History).
// Switching between them is a dropdown on the main Engage screen, mirrored
// by the sidebar's own collapsible Engage sub-nav (see App.tsx's
// ENGAGE_SUB_ITEMS) — both lists use the same tab order: Sequences, Tasks,
// Calls, Emails, Companies, Contacts, Lists. Per Jack: "add companies
// under emails and reorganize it top to bottom properly... move lists
// under there also."
import { useEffect, useState } from "react";
import TaskBoard from "./TaskBoard";
import ContactsView from "./Contacts";
import CompaniesView from "./Companies";
import ChannelTasks from "./ChannelTasks";
import SequencesView from "./Sequences";
import ListsView from "./Lists";
import type { Task, TaskPriority } from "../lib/tasks";
import type { Contact, ManualContactInput } from "../lib/contacts";
import type { Sequence, SequenceEnrollment, SequenceChannel, SequenceStatus } from "../lib/sequences";
import type { PlatformUser } from "../lib/users";
import type { SequenceGroup } from "../lib/sequenceGroups";
import type { EmailAccount } from "../lib/emailAccounts";
import type { LeadList } from "../lib/leadLists";

interface EngageProps {
  tasks: Task[];
  tasksLoading: boolean;
  tasksError: string | null;
  onAddTask: (date: string, text: string) => void;
  onToggleTask: (id: string) => void;
  onEditTask: (id: string, text: string) => void;
  onDeleteTask: (id: string) => void;

  contacts: Contact[];
  contactsLoading: boolean;
  contactsError: string | null;
  onAddContactTask: (contactId: string, date: string, priority: TaskPriority, text: string, channel?: "call" | "email", time?: string | null, userId?: string | null) => void;
  onAddContact: (input: ManualContactInput) => void;
  onUpdateContact: (id: string, patch: Partial<Contact>) => void;
  onUpdateTaskFields: (id: string, patch: Partial<Pick<Task, "userId" | "repliedAt">>) => void;

  sequences: Sequence[];
  enrollments: SequenceEnrollment[];
  sequencesLoading: boolean;
  sequencesError: string | null;
  onCreateSequence: (name: string) => Sequence | null;
  onRenameSequence: (id: string, name: string) => void;
  onAddSequenceStep: (id: string, channel: SequenceChannel, waitHours: number, note?: string) => void;
  onRemoveSequenceStep: (id: string, stepId: string) => void;
  onUpdateSequenceStep: (id: string, stepId: string, patch: Partial<{ note: string; systemPrompt: string; userPrompt: string }>) => void;
  onMoveSequenceStep: (id: string, stepId: string, direction: -1 | 1) => void;
  onDeleteSequence: (id: string) => void;
  onEnrollInSequence: (sequenceId: string, contactIds: string[]) => number;
  onRestartEnrollment: (enrollmentId: string) => void;
  onRemoveEnrollment: (enrollmentId: string) => void;
  users: PlatformUser[];
  sequenceGroups: SequenceGroup[];
  onSetSequenceStatus: (id: string, status: SequenceStatus) => void;
  onSetSequenceOwner: (id: string, ownerId: string | null) => void;
  onSetSequenceGroup: (id: string, groupId: string | null) => void;
  onCopySequence: (id: string) => Sequence | null;
  onAddSequenceGroup: (name: string) => void;
  onRenameSequenceGroup: (id: string, name: string) => void;
  onDeleteSequenceGroup: (id: string) => void;
  emailAccounts: EmailAccount[];
  onSetSequenceEmailAccount: (id: string, emailAccountId: string | null) => void;
  onAddEmailAccount: (label: string, fromName: string, fromEmail: string) => void;
  onEditEmailAccount: (id: string, patch: Partial<Pick<EmailAccount, "label" | "fromName" | "fromEmail">>) => void;
  onDeleteEmailAccount: (id: string) => void;

  leadLists: LeadList[];
  leadListsLoading: boolean;
  leadListsError: string | null;
  onRenameList: (id: string, name: string) => void;
  onDeleteList: (id: string) => void;
  onRemoveLeadFromList: (listId: string, rowKey: string) => void;

  // Set when navigating here from Home's tiles or the sidebar sub-nav so
  // Engage lands straight on the right tab instead of always defaulting
  // to Sequences. Engage unmounts whenever the sidebar navigates away
  // (App.tsx conditionally renders it), so this only needs to seed
  // initial state, not stay in sync afterward.
  initialTab?: EngageTab;
  initialContactsSearch?: string;
}

export type EngageTab = "sequences" | "tasks" | "calls" | "emails" | "companies" | "contacts" | "lists";
const TAB_OPTIONS: { key: EngageTab; label: string }[] = [
  { key: "sequences", label: "Sequences" },
  { key: "tasks", label: "Tasks" },
  { key: "calls", label: "Calls" },
  { key: "emails", label: "Emails" },
  { key: "companies", label: "Companies" },
  { key: "contacts", label: "Contacts" },
  { key: "lists", label: "Lists" },
];

export default function Engage({
  tasks,
  tasksLoading,
  tasksError,
  onAddTask,
  onToggleTask,
  onEditTask,
  onDeleteTask,
  contacts,
  contactsLoading,
  contactsError,
  onAddContactTask,
  onAddContact,
  onUpdateContact,
  onUpdateTaskFields,
  sequences,
  enrollments,
  sequencesLoading,
  sequencesError,
  onCreateSequence,
  onRenameSequence,
  onAddSequenceStep,
  onRemoveSequenceStep,
  onUpdateSequenceStep,
  onMoveSequenceStep,
  onDeleteSequence,
  onEnrollInSequence,
  onRestartEnrollment,
  onRemoveEnrollment,
  users,
  sequenceGroups,
  onSetSequenceStatus,
  onSetSequenceOwner,
  onSetSequenceGroup,
  onCopySequence,
  onAddSequenceGroup,
  onRenameSequenceGroup,
  onDeleteSequenceGroup,
  emailAccounts,
  onSetSequenceEmailAccount,
  onAddEmailAccount,
  onEditEmailAccount,
  onDeleteEmailAccount,
  leadLists,
  leadListsLoading,
  leadListsError,
  onRenameList,
  onDeleteList,
  onRemoveLeadFromList,
  initialTab,
  initialContactsSearch,
}: EngageProps) {
  const [tab, setTab] = useState<EngageTab>(initialTab || "sequences");
  // Engage does NOT unmount/remount when navigating between its own
  // sub-items while already on the Engage view (App.tsx keeps `view`
  // at "engage" the whole time) — so `useState`'s one-time initializer
  // above never re-fires. Without this effect, clicking a different
  // sidebar sub-item (or Home tile) while already viewing Engage did
  // nothing at all: `initialTab` changed but the visible tab silently
  // stayed put. Read as "tab switching is delayed/broken" — it wasn't
  // slow, it just wasn't happening. Confirmed by tracing the render
  // path, not guessed.
  useEffect(() => {
    setTab(initialTab || "sequences");
  }, [initialTab]);

  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <select
          value={tab}
          onChange={(e) => setTab(e.target.value as EngageTab)}
          style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px", fontSize: 13, fontWeight: 700, minWidth: 160 }}
        >
          {TAB_OPTIONS.map((opt) => (
            <option key={opt.key} value={opt.key}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {tab === "sequences" && (
        <SequencesView
          sequences={sequences}
          enrollments={enrollments}
          contacts={contacts}
          tasks={tasks}
          leadLists={leadLists}
          loading={sequencesLoading}
          error={sequencesError}
          onCreate={onCreateSequence}
          onRename={onRenameSequence}
          onAddStep={onAddSequenceStep}
          onRemoveStep={onRemoveSequenceStep}
          onUpdateStep={onUpdateSequenceStep}
          onMoveStep={onMoveSequenceStep}
          onDelete={onDeleteSequence}
          onEnroll={onEnrollInSequence}
          onRestart={onRestartEnrollment}
          onRemoveEnrollment={onRemoveEnrollment}
          users={users}
          groups={sequenceGroups}
          onSetStatus={onSetSequenceStatus}
          onSetOwner={onSetSequenceOwner}
          onSetGroup={onSetSequenceGroup}
          onCopy={onCopySequence}
          onAddGroup={onAddSequenceGroup}
          onRenameGroup={onRenameSequenceGroup}
          onDeleteGroup={onDeleteSequenceGroup}
          emailAccounts={emailAccounts}
          onSetEmailAccount={onSetSequenceEmailAccount}
          onAddEmailAccount={onAddEmailAccount}
          onEditEmailAccount={onEditEmailAccount}
          onDeleteEmailAccount={onDeleteEmailAccount}
        />
      )}
      {tab === "tasks" && (
        <TaskBoard
          tasks={tasks}
          loading={tasksLoading}
          error={tasksError}
          onAddTask={onAddTask}
          onToggleTask={onToggleTask}
          onEditTask={onEditTask}
          onDeleteTask={onDeleteTask}
        />
      )}
      {tab === "calls" && (
        <ChannelTasks channel="call" contacts={contacts} tasks={tasks} users={users} onAddContactTask={onAddContactTask} onToggleTask={onToggleTask} onDeleteTask={onDeleteTask} onUpdateTaskFields={onUpdateTaskFields} />
      )}
      {tab === "emails" && (
        <ChannelTasks channel="email" contacts={contacts} tasks={tasks} users={users} onAddContactTask={onAddContactTask} onToggleTask={onToggleTask} onDeleteTask={onDeleteTask} onUpdateTaskFields={onUpdateTaskFields} />
      )}
      {tab === "companies" && (
        <CompaniesView
          contacts={contacts}
          onAddContact={onAddContact}
          onUpdateContact={onUpdateContact}
          users={users}
          tasks={tasks}
          leadLists={leadLists}
          sequences={sequences}
          enrollments={enrollments}
        />
      )}
      {tab === "contacts" && (
        <ContactsView
          contacts={contacts}
          loading={contactsLoading}
          error={contactsError}
          tasks={tasks}
          onAddContactTask={onAddContactTask}
          onToggleTask={onToggleTask}
          onDeleteTask={onDeleteTask}
          onUpdateContact={onUpdateContact}
          users={users}
          leadLists={leadLists}
          sequences={sequences}
          enrollments={enrollments}
          initialSearch={initialContactsSearch}
        />
      )}
      {tab === "lists" && (
        <ListsView
          lists={leadLists}
          loading={leadListsLoading}
          error={leadListsError}
          onRename={onRenameList}
          onDelete={onDeleteList}
          onRemoveRow={onRemoveLeadFromList}
        />
      )}
    </div>
  );
}
