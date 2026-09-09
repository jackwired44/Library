import { useMemo, useState } from "react";
import { getWeekDays, startOfWeek, tasksForDay, weekRangeLabel, type Task } from "../lib/tasks";
import type { Contact } from "../lib/contacts";
import type { Sequence, SequenceEnrollment } from "../lib/sequences";
import { normalizeCompanyKey, SIZE_BUCKETS, employeeCountOf, type CompanyProfile } from "../lib/companyProfiles";

interface TaskBoardProps {
  tasks: Task[];
  // Everything the work filters need. Per Jack: the Sequences tab is for
  // BUILDING sequences; Tasks is where you actually work the leads off
  // them — so the ability to pick a sequence and slice by company facts
  // belongs here, not there. All read-only; nothing here mutates a
  // contact, a company or a sequence.
  contacts?: Contact[];
  sequences?: Sequence[];
  enrollments?: SequenceEnrollment[];
  companyProfiles?: CompanyProfile[];
  loading: boolean;
  error: string | null;
  onAddTask: (date: string, text: string) => void;
  onToggleTask: (id: string) => void;
  onEditTask: (id: string, text: string) => void;
  onDeleteTask: (id: string) => void;
}

export default function TaskBoard({
  tasks,
  loading,
  error,
  onAddTask,
  onToggleTask,
  onEditTask,
  onDeleteTask,
  contacts = [],
  sequences = [],
  enrollments = [],
  companyProfiles = [],
}: TaskBoardProps) {
  const [seqFilter, setSeqFilter] = useState("");
  const [industryFilter, setIndustryFilter] = useState("");
  const [sizeFilter, setSizeFilter] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);

  const contactById = useMemo(() => new Map(contacts.map((c) => [c.id, c])), [contacts]);
  // Company facts are keyed the same way lib/companies.ts groups them, so
  // a task's contact resolves to the same profile the Companies tab shows.
  const profileByKey = useMemo(
    () => new Map(companyProfiles.map((p) => [p.key, p])),
    [companyProfiles]
  );
  const profileFor = (contactId?: string | null) => {
    if (!contactId) return null;
    const c = contactById.get(contactId);
    if (!c?.company) return null;
    return profileByKey.get(normalizeCompanyKey(c.company)) || null;
  };
  // Which sequence a task belongs to, via its enrollment back-link.
  const seqIdByEnrollment = useMemo(
    () => new Map(enrollments.map((e) => [e.id, e.sequenceId])),
    [enrollments]
  );

  const industries = useMemo(() => {
    const set = new Set<string>();
    companyProfiles.forEach((p) => { if (p.industry) set.add(p.industry); });
    return [...set].sort();
  }, [companyProfiles]);
  const locations = useMemo(() => {
    const set = new Set<string>();
    companyProfiles.forEach((p) => {
      const loc = [p.state, p.country].filter(Boolean).join(", ");
      if (loc) set.add(loc);
    });
    return [...set].sort();
  }, [companyProfiles]);

  const activeFilterCount =
    (seqFilter ? 1 : 0) + (industryFilter ? 1 : 0) + (sizeFilter ? 1 : 0) + (locationFilter ? 1 : 0);

  const visibleTasks = useMemo(() => {
    if (!activeFilterCount) return tasks;
    return tasks.filter((t) => {
      if (seqFilter) {
        const sid = t.sequenceEnrollmentId ? seqIdByEnrollment.get(t.sequenceEnrollmentId) : null;
        if (sid !== seqFilter) return false;
      }
      if (industryFilter || sizeFilter || locationFilter) {
        const p = profileFor(t.contactId);
        // A task whose company has no enriched profile can't satisfy a
        // company filter, so it drops out rather than being kept on a
        // guess. Stated in the empty state so it doesn't read as a bug.
        if (!p) return false;
        if (industryFilter && p.industry !== industryFilter) return false;
        if (locationFilter && [p.state, p.country].filter(Boolean).join(", ") !== locationFilter) return false;
        if (sizeFilter) {
          const n = employeeCountOf(p);
          const bucket = SIZE_BUCKETS.find((b) => b.key === sizeFilter);
          if (n === null || !bucket || !bucket.test(n)) return false;
        }
      }
      return true;
    });
  }, [tasks, seqFilter, industryFilter, sizeFilter, locationFilter, activeFilterCount, seqIdByEnrollment, contactById, profileByKey]);

  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const days = useMemo(() => getWeekDays(weekStart), [weekStart]);
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }, []);

  function shiftWeek(delta: number) {
    setWeekStart((prev) => {
      const next = new Date(prev);
      next.setDate(next.getDate() + delta * 7);
      return next;
    });
  }

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: "#9aa1ac" }}>Loading your board…</div>;

  return (
    <div>
      <p style={{ color: "#4c6167", maxWidth: 700, marginBottom: 16 }}>
        Where sequence work actually gets done. Pick a sequence to work, or slice by the company facts behind each
        lead, then run the week.
      </p>
      {error && <div style={{ color: "#9A5B22", marginBottom: 12 }}>{error}</div>}

      <div className="control-strip" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <div className="filter-wrap" style={{ position: "relative" }}>
          <button className={`filter-btn${activeFilterCount ? " on" : ""}`} onClick={() => setFiltersOpen((v) => !v)}>
            Work filters
            {activeFilterCount > 0 && <span className="filter-count">{activeFilterCount}</span>}
          </button>
          {filtersOpen && (
            <>
              <div className="filter-pop-backdrop" onClick={() => setFiltersOpen(false)} />
              <div className="filter-pop">
                <div className="filter-group">
                  <div className="filter-group-title">Sequence</div>
                  <select value={seqFilter} onChange={(e) => setSeqFilter(e.target.value)} className="field" style={{ width: "100%" }}>
                    <option value="">Any sequence</option>
                    {sequences.map((sq) => (
                      <option key={sq.id} value={sq.id}>{sq.name}</option>
                    ))}
                  </select>
                </div>
                <div className="filter-group">
                  <div className="filter-group-title">Industry</div>
                  <select value={industryFilter} onChange={(e) => setIndustryFilter(e.target.value)} className="field" style={{ width: "100%" }}>
                    <option value="">Any industry</option>
                    {industries.map((i) => <option key={i} value={i}>{i}</option>)}
                  </select>
                  {industries.length === 0 && <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 4 }}>No company data yet — import or enrich in Companies.</div>}
                </div>
                <div className="filter-group">
                  <div className="filter-group-title">Company size</div>
                  <select value={sizeFilter} onChange={(e) => setSizeFilter(e.target.value)} className="field" style={{ width: "100%" }}>
                    <option value="">Any size</option>
                    {SIZE_BUCKETS.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
                  </select>
                </div>
                <div className="filter-group">
                  <div className="filter-group-title">Location</div>
                  <select value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)} className="field" style={{ width: "100%" }}>
                    <option value="">Anywhere</option>
                    {locations.map((l) => <option key={l} value={l}>{l}</option>)}
                  </select>
                </div>
                {activeFilterCount > 0 && (
                  <div style={{ marginTop: 12, textAlign: "right" }}>
                    <button className="chip-clear" onClick={() => { setSeqFilter(""); setIndustryFilter(""); setSizeFilter(""); setLocationFilter(""); }}>Clear all filters</button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
        <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
          {activeFilterCount
            ? `${visibleTasks.length} of ${tasks.length} tasks shown`
            : `${tasks.length} task${tasks.length === 1 ? "" : "s"}`}
        </span>
        {activeFilterCount > 0 && visibleTasks.length === 0 && (
          <span style={{ fontSize: 12, color: "#9A5B22" }}>
            Nothing matches. Company filters only match tasks whose company has enriched data.
          </span>
        )}
      </div>

      {activeFilterCount > 0 && (
        <div className="chip-row">
          {seqFilter && <span className="chip">{sequences.find((sq) => sq.id === seqFilter)?.name || "Sequence"}<button onClick={() => setSeqFilter("")} title="Remove">✕</button></span>}
          {industryFilter && <span className="chip">{industryFilter}<button onClick={() => setIndustryFilter("")} title="Remove">✕</button></span>}
          {sizeFilter && <span className="chip">{SIZE_BUCKETS.find((b) => b.key === sizeFilter)?.label}<button onClick={() => setSizeFilter("")} title="Remove">✕</button></span>}
          {locationFilter && <span className="chip">{locationFilter}<button onClick={() => setLocationFilter("")} title="Remove">✕</button></span>}
          <button className="chip-clear" onClick={() => { setSeqFilter(""); setIndustryFilter(""); setSizeFilter(""); setLocationFilter(""); }}>Clear all</button>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
        <button onClick={() => shiftWeek(-1)} style={{ border: "1px solid var(--border)", background: "#fff", borderRadius: 8, padding: "6px 12px", fontWeight: 700 }}>‹ Prev</button>
        <div style={{ fontWeight: 700, fontSize: 15 }}>{weekRangeLabel(weekStart)}</div>
        <button onClick={() => shiftWeek(1)} style={{ border: "1px solid var(--border)", background: "#fff", borderRadius: 8, padding: "6px 12px", fontWeight: 700 }}>Next ›</button>
        <button onClick={() => setWeekStart(startOfWeek(new Date()))} style={{ border: "none", background: "none", textDecoration: "underline", color: "#4c6167", fontSize: 12.5 }}>This week</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
        {days.map((day) => (
          <DayColumn
            key={day.key}
            day={day}
            isToday={day.date.getTime() === today}
            tasks={tasksForDay(visibleTasks, day.key)}
            onAddTask={(text) => onAddTask(day.key, text)}
            onToggleTask={onToggleTask}
            onEditTask={onEditTask}
            onDeleteTask={onDeleteTask}
          />
        ))}
      </div>
    </div>
  );
}

function DayColumn({
  day,
  isToday,
  tasks,
  onAddTask,
  onToggleTask,
  onEditTask,
  onDeleteTask,
}: {
  day: { key: string; label: string };
  isToday: boolean;
  tasks: Task[];
  onAddTask: (text: string) => void;
  onToggleTask: (id: string) => void;
  onEditTask: (id: string, text: string) => void;
  onDeleteTask: (id: string) => void;
}) {
  const [draft, setDraft] = useState("");

  function submit() {
    if (!draft.trim()) return;
    onAddTask(draft);
    setDraft("");
  }

  return (
    <div data-day-key={day.key} style={{ background: "#fff", border: `1px solid ${isToday ? "#2CC295" : "#E4E7EC"}`, borderRadius: 10, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8, minHeight: 180 }}>
      <div style={{ fontWeight: 700, fontSize: 12.5, color: isToday ? "#2CC295" : "#1B2430" }}>{day.label}{isToday ? " · Today" : ""}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
        {tasks.length === 0 && <div style={{ fontSize: 11.5, color: "#c3c9cf" }}>No tasks</div>}
        {tasks.map((t) => (
          <div key={t.id} style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
            <input type="checkbox" checked={t.done} onChange={() => onToggleTask(t.id)} style={{ marginTop: 3 }} />
            <input
              defaultValue={t.text}
              onBlur={(e) => { if (e.target.value.trim() && e.target.value !== t.text) onEditTask(t.id, e.target.value); }}
              style={{
                flex: 1,
                border: "none",
                fontSize: 12.5,
                textDecoration: t.done ? "line-through" : "none",
                color: t.done ? "#9aa1ac" : "#1B2430",
                background: "transparent",
                padding: 0,
              }}
            />
            <button onClick={() => onDeleteTask(t.id)} title="Delete task" style={{ border: "none", background: "none", color: "#B5443B", fontSize: 12, padding: 0 }}>✕</button>
          </div>
        ))}
      </div>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        onBlur={submit}
        placeholder="+ Add task"
        style={{ border: "1px solid var(--border)", borderRadius: 7, padding: "6px 9px", fontSize: 12 }}
      />
    </div>
  );
}
