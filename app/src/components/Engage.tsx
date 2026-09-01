// Engage — a nav-level grouping of the sales-motion tools (Contacts,
// Companies, and the task Board) under one tab, separate from the lead-
// processing tools (Scanner/Lead Library/History). Per Jack's explicit
// ask, switching between them is a dropdown on the main Engage screen
// (originally a button tab strip — replaced when Companies was added as a
// third option). TaskBoard and Contacts are otherwise unchanged, same
// props, same data; Companies is a new read-only roll-up (see
// lib/companies.ts) — "we will slowly build this out with more data
// fields and closer to an actual Apollo down the road."
import { useState } from "react";
import TaskBoard from "./TaskBoard";
import ContactsView from "./Contacts";
import CompaniesView from "./Companies";
import ChannelTasks from "./ChannelTasks";
import type { Task, TaskPriority } from "../lib/tasks";
import type { Contact, ManualContactInput } from "../lib/contacts";

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
  onAddContactTask: (contactId: string, date: string, priority: TaskPriority, text: string, channel?: "call" | "email") => void;
  onAddContact: (input: ManualContactInput) => void;
  onUpdateContact: (id: string, patch: Partial<Contact>) => void;

  // Set when navigating here from the header search (see App.tsx/
  // HeaderSearch.tsx) so Engage lands straight on the right tab/result
  // instead of always defaulting to Tasks. Engage unmounts whenever the
  // sidebar navigates away (App.tsx conditionally renders it), so these
  // only need to seed initial state, not stay in sync afterward.
  initialTab?: EngageTab;
  initialContactsSearch?: string;
}

export type EngageTab = "contacts" | "companies" | "tasks" | "calls" | "emails" | "sequences";
const TAB_OPTIONS: { key: EngageTab; label: string }[] = [
  { key: "contacts", label: "Contacts" },
  { key: "companies", label: "Companies" },
  { key: "tasks", label: "Tasks" },
  { key: "calls", label: "Calls" },
  { key: "emails", label: "Emails" },
  { key: "sequences", label: "Sequences" },
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
  initialTab,
  initialContactsSearch,
}: EngageProps) {
  const [tab, setTab] = useState<EngageTab>(initialTab || "tasks");

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
          initialSearch={initialContactsSearch}
        />
      )}
      {tab === "companies" && <CompaniesView contacts={contacts} onAddContact={onAddContact} onUpdateContact={onUpdateContact} />}
      {tab === "calls" && (
        <ChannelTasks channel="call" contacts={contacts} tasks={tasks} onAddContactTask={onAddContactTask} onToggleTask={onToggleTask} onDeleteTask={onDeleteTask} />
      )}
      {tab === "emails" && (
        <ChannelTasks channel="email" contacts={contacts} tasks={tasks} onAddContactTask={onAddContactTask} onToggleTask={onToggleTask} onDeleteTask={onDeleteTask} />
      )}
      {tab === "sequences" && (
        <div>
          <h2 style={{ margin: "0 0 8px", fontSize: 18 }}>📡 Sequences</h2>
          <div style={{ background: "var(--surface)", border: "1px dashed var(--border)", borderRadius: 12, padding: "20px 22px", maxWidth: 620, fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>
            Not built yet — this will pull your live Apollo sequences in as a
            chart-style, dual-screen view alongside Apollo itself (open/reply
            rates, per-contact call-task status, and disposition tracking).
            Scoping is underway; see CLAUDE.md "Apollo sequences
            investigation" for what's confirmed so far.
          </div>
        </div>
      )}
    </div>
  );
}
