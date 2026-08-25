// Engage — a nav-level grouping of the two sales-motion tools (the Board
// and Contacts) under one tab, separate from the lead-processing tools
// (Scanner/Lead Library/History). Per Jack's explicit ask, this is purely
// a navigation regroup: TaskBoard and Contacts are unchanged, same props,
// same data — this component only adds the "Tasks"/"Contacts" tab strip
// and renders whichever one is active.
import { useState } from "react";
import TaskBoard from "./TaskBoard";
import ContactsView from "./Contacts";
import type { Task, TaskPriority } from "../lib/tasks";
import type { Contact } from "../lib/contacts";

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
  onAddContactTask: (contactId: string, date: string, priority: TaskPriority, text: string) => void;
}

type EngageTab = "tasks" | "contacts";

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
}: EngageProps) {
  const [tab, setTab] = useState<EngageTab>("tasks");

  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 18 }}>
        {(
          [
            ["tasks", "Tasks"],
            ["contacts", "Contacts"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`nav-btn${tab === key ? " active" : ""}`}
            style={{ textTransform: "none", letterSpacing: "normal" }}
          >
            {label}
          </button>
        ))}
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
        />
      )}
    </div>
  );
}
