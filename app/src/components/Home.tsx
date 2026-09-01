// The post-login landing page — orientation + the Weekly Goals board, not
// a module of its own. Per Jack: "everything on the left hand side,
// nothing under Modules" — navigation lives entirely in the sidebar
// (App.tsx), so Home no longer duplicates it as a tile grid. Reads only
// its own Profile (for the greeting) beyond the counts it's handed.
import { useEffect, useState } from "react";
import { loadProfile, type Profile } from "../lib/profile";
import { computeAutoActual, type WeeklyGoals } from "../lib/weeklyGoals";
import { startOfWeek, weekRangeLabel, type Task } from "../lib/tasks";

interface HomeProps {
  libraryCount: number;
  historyCount: number;
  tasksOpenCount: number;
  contactsCount: number;
  tasks: Task[];
  weeklyGoals: WeeklyGoals;
  onUpdateMetric: (id: string, patch: Partial<{ label: string; target: number; actual: number }>) => void;
  onAddMetric: (label: string) => void;
  onRemoveMetric: (id: string) => void;
}

export default function Home({
  libraryCount,
  historyCount,
  tasksOpenCount,
  contactsCount,
  tasks,
  weeklyGoals,
  onUpdateMetric,
  onAddMetric,
  onRemoveMetric,
}: HomeProps) {
  const [profile, setProfile] = useState<Profile | null>(null);
  useEffect(() => {
    loadProfile().then(setProfile);
  }, []);
  const firstName = profile?.name?.trim().split(/\s+/)[0] || "Jack";

  return (
    <div>
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: "16px 20px",
          marginBottom: 18,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div>
          <h1 style={{ margin: "0 0 3px", fontSize: 19 }}>Welcome, {firstName}.</h1>
          <p style={{ margin: 0, maxWidth: 560, fontSize: 12.5, lineHeight: 1.5, color: "var(--muted)" }}>
            The <strong style={{ color: "var(--ink)" }}>Lead Library</strong> is the single source of truth for every qualified
            lead — the first step toward a lighter-weight, self-hosted CRM built solely for outbound sales.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {[
            { label: "Lead Library", value: libraryCount },
            { label: "Contacts", value: contactsCount },
            { label: "Open tasks", value: tasksOpenCount },
            { label: "Uploads", value: historyCount },
          ].map((s) => (
            <div
              key={s.label}
              style={{
                background: "var(--surface-sunken)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: "6px 12px",
                textAlign: "center",
                minWidth: 68,
              }}
            >
              <div style={{ fontSize: 16, fontWeight: 700, color: "var(--ink)", lineHeight: 1.2 }}>{s.value}</div>
              <div style={{ fontSize: 9.5, color: "var(--muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      <WeeklyGoalsPanel goals={weeklyGoals} tasks={tasks} onUpdateMetric={onUpdateMetric} onAddMetric={onAddMetric} onRemoveMetric={onRemoveMetric} />
    </div>
  );
}

// Weekly Goals — see CLAUDE.md and lib/weeklyGoals.ts. Every metric is a
// plain row (label/target/actual), editable inline; "Outbound calls" is
// the one built-in metric whose actual is pulled live from completed
// call-channel Tasks rather than typed in — everything else (Call backs,
// Incoming voicemails, and anything added via "+ Add metric") is a
// manually-tracked running count, since there's no other data source for
// those yet. Deliberately minimal per Jack's own "little functionalities
// yet" — no charts, no history view, just the current week's numbers.
function WeeklyGoalsPanel({
  goals,
  tasks,
  onUpdateMetric,
  onAddMetric,
  onRemoveMetric,
}: {
  goals: WeeklyGoals;
  tasks: Task[];
  onUpdateMetric: (id: string, patch: Partial<{ label: string; target: number; actual: number }>) => void;
  onAddMetric: (label: string) => void;
  onRemoveMetric: (id: string) => void;
}) {
  const [addingLabel, setAddingLabel] = useState("");
  const weekLabel = weekRangeLabel(startOfWeek(new Date()));

  function submitAdd() {
    if (!addingLabel.trim()) return;
    onAddMetric(addingLabel);
    setAddingLabel("");
  }

  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 18px", marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 6 }}>
        <h2 style={{ margin: 0, fontSize: 14 }}>🎯 Weekly Goals</h2>
        <span style={{ fontSize: 11.5, color: "var(--muted)" }}>{weekLabel}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
        {goals.metrics.map((m) => {
          const actual = m.autoSource === "outboundCalls" ? computeAutoActual(tasks, goals.weekKey) : m.actual;
          const pct = m.target > 0 ? Math.min(100, Math.round((actual / m.target) * 100)) : 0;
          return (
            <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <input
                value={m.label}
                onChange={(e) => onUpdateMetric(m.id, { label: e.target.value })}
                style={{ flex: "1 1 160px", minWidth: 120, border: "1px solid var(--border)", borderRadius: 7, padding: "6px 8px", fontSize: 12.5, fontWeight: 600 }}
              />
              <div style={{ flex: "2 1 160px", minWidth: 140, display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ flex: 1, height: 7, borderRadius: 999, background: "var(--surface-sunken)", overflow: "hidden" }}>
                  <div style={{ width: `${pct}%`, height: "100%", background: pct >= 100 ? "#2CC295" : "var(--accent)", borderRadius: 999 }} />
                </div>
                <span style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap", minWidth: 30, textAlign: "right" }}>{pct}%</span>
              </div>
              {m.autoSource === "outboundCalls" ? (
                <span title="Pulled live from completed call tasks this week" style={{ fontSize: 12.5, fontWeight: 700, minWidth: 30, textAlign: "right" }}>
                  {actual}
                </span>
              ) : (
                <input
                  type="number"
                  min={0}
                  value={m.actual}
                  onChange={(e) => onUpdateMetric(m.id, { actual: Math.max(0, Number(e.target.value) || 0) })}
                  style={{ width: 56, border: "1px solid var(--border)", borderRadius: 7, padding: "5px 6px", fontSize: 12.5, textAlign: "right" }}
                />
              )}
              <span style={{ fontSize: 11.5, color: "var(--muted)" }}>of</span>
              <input
                type="number"
                min={0}
                value={m.target}
                onChange={(e) => onUpdateMetric(m.id, { target: Math.max(0, Number(e.target.value) || 0) })}
                style={{ width: 56, border: "1px solid var(--border)", borderRadius: 7, padding: "5px 6px", fontSize: 12.5, textAlign: "right" }}
              />
              {m.autoSource === "outboundCalls" && (
                <span style={{ fontSize: 9.5, fontWeight: 700, color: "var(--muted)", background: "var(--surface-sunken)", borderRadius: 999, padding: "1px 7px" }}>
                  auto
                </span>
              )}
              <button
                onClick={() => onRemoveMetric(m.id)}
                title="Remove this metric"
                style={{ border: "none", background: "none", color: "#B5443B", fontSize: 13, cursor: "pointer" }}
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input
          value={addingLabel}
          onChange={(e) => setAddingLabel(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submitAdd()}
          placeholder="+ Add a metric (e.g. Meetings booked)"
          style={{ flex: "1 1 220px", border: "1px solid var(--border)", borderRadius: 7, padding: "6px 8px", fontSize: 12.5 }}
        />
        <button
          onClick={submitAdd}
          disabled={!addingLabel.trim()}
          style={{ border: "none", background: "#2CC295", color: "#081E22", borderRadius: 7, padding: "6px 12px", fontSize: 12, fontWeight: 700, opacity: addingLabel.trim() ? 1 : 0.5 }}
        >
          Add
        </button>
      </div>
    </div>
  );
}
