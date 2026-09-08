// The post-login landing page — orientation + the Weekly Goals board, not
// a module of its own. Per Jack: "everything on the left hand side,
// nothing under Modules" — navigation lives entirely in the sidebar
// (App.tsx), so Home no longer duplicates it as a tile grid. Reads only
// its own Profile (for the greeting) beyond the counts it's handed.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { loadProfile, type Profile } from "../lib/profile";
import { computeAutoActual, countCompletedChannelTasks, sameWeekdayAverage, weekProgressFraction, type WeeklyGoals } from "../lib/weeklyGoals";
import { compareByTimeThenCreated, formatTaskTime, localDayKeyFromIso, startOfWeek, todayDateKey, weekRangeLabel, type Task } from "../lib/tasks";
import type { Contact } from "../lib/contacts";
import { CATEGORY_META } from "../lib/detection";
import { resolveStatus, type Sequence } from "../lib/sequences";
import { SELF_USER_ID, userLabel, type PlatformUser } from "../lib/users";

interface HomeProps {
  tasks: Task[];
  contacts: Contact[];
  sequences: Sequence[];
  onToggleTask: (id: string) => void;
  weeklyGoals: WeeklyGoals;
  onUpdateMetric: (id: string, patch: Partial<{ label: string; target: number; actual: number }>) => void;
  onAddMetric: (label: string) => void;
  onRemoveMetric: (id: string) => void;
  users: PlatformUser[];
  onUpdateTaskFields: (id: string, patch: Partial<Pick<Task, "userId" | "repliedAt">>) => void;
  // The action band's single primary button needs somewhere to go. Home
  // has no router of its own, so App hands it a navigate callback.
  onNavigate?: (tab: "calls" | "sequences" | "contacts") => void;
}


const CHANNEL_ICON: Record<string, string> = { call: "📞", email: "✉️" };

function dateKeyOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function Home({
  tasks,
  contacts,
  sequences,
  onToggleTask,
  weeklyGoals,
  onUpdateMetric,
  onAddMetric,
  onRemoveMetric,
  users,
  onUpdateTaskFields,
  onNavigate,
}: HomeProps) {
  const [profile, setProfile] = useState<Profile | null>(null);
  useEffect(() => {
    loadProfile().then(setProfile);
  }, []);
  const firstName = profile?.name?.trim().split(/\s+/)[0] || "Jack";

  // "Viewing as" — per Jack: "when they click it at a high level they can
  // see anything they need to act on and can see whats fully on their
  // plate for that user." Defaults to "you" (the local profile's own
  // roster entry), with an "Everyone" option for the all-up view Home
  // originally showed. A task with no userId set (every task created
  // before this field existed, or left unassigned on purpose) stays
  // visible under ANY selected user rather than silently disappearing —
  // same "don't orphan legacy data" rule used elsewhere in this app
  // (see StoredRow.__isGoogleToMicrosoft etc. in CLAUDE.md).
  const [viewingUserId, setViewingUserId] = useState<string>(SELF_USER_ID);
  const scopedTasks = useMemo(
    () => (viewingUserId === "all" ? tasks : tasks.filter((t) => !t.userId || t.userId === viewingUserId)),
    [tasks, viewingUserId]
  );
  const scopedSequences = useMemo(
    () => (viewingUserId === "all" ? sequences : sequences.filter((s) => !s.ownerId || s.ownerId === viewingUserId)),
    [sequences, viewingUserId]
  );

  // Start-of-day dashboard — per Jack, this is the screen you land on to
  // start the day: today's date, what's due today, and the day's numbers.
  // Everything here is derived from state App.tsx already holds (Tasks +
  // Contacts); Home still reads no IndexedDB of its own beyond Profile.
  const today = todayDateKey();
  const todayLabel = new Date(`${today}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const contactById = useMemo(() => new Map(contacts.map((c) => [c.id, c])), [contacts]);
  const todaysTasks = useMemo(
    () => scopedTasks.filter((t) => t.date === today && !t.done).sort(compareByTimeThenCreated),
    [scopedTasks, today]
  );
  const callsToday = useMemo(() => countCompletedChannelTasks(scopedTasks, "call", today, today), [scopedTasks, today]);
  const emailsToday = useMemo(() => countCompletedChannelTasks(scopedTasks, "email", today, today), [scopedTasks, today]);
  // Booked TODAY — the Today panel is a day view, so an all-time count of
  // every meeting-booked contact (what this tile used to show) read as a
  // number that never moves. Per Jack's "meetings booked should be for
  // the week," nothing on this page shows an untimed all-time booking
  // count any more: this is today's bookings, the banner tile above is
  // the week's (and navigable back week over week).
  const meetingsBookedToday = useMemo(
    () => contacts.filter((c) => c.disposition === "meeting-booked" && c.meetingBookedAt && localDayKeyFromIso(c.meetingBookedAt) === today).length,
    [contacts, today]
  );

  // The banner's headline numbers, per Jack: assigned tasks, active
  // sequences, meetings booked this week, follow-up leads — the sales
  // motion, not how much data is sitting in the system.
  // Assigned = an open task tied to a specific contact (someone is on the
  // hook for it), as opposed to a loose personal to-do on the Board.
  // A lead with an open follow-up scheduled — distinct people, not tasks,
  // so two tasks on one lead count once.
  const activeSequences = useMemo(() => scopedSequences.filter((sq) => resolveStatus(sq) === "active").length, [scopedSequences]);
  // Meetings booked, week by week. Reads the meetingBookedAt stamp — the
  // date the disposition BECAME Meeting booked, not any date a meeting is
  // held for (this app has no meeting-date field). Navigable backwards so
  // any past week is readable; forward is capped at the current week,
  // since the stamp can never be in the future.
  const [bookedWeekOffset, setBookedWeekOffset] = useState(0);
  const bookedWeekRange = useMemo(() => {
    const start = startOfWeek(new Date());
    start.setDate(start.getDate() + bookedWeekOffset * 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    return { start: dateKeyOf(start), end: dateKeyOf(end) };
  }, [bookedWeekOffset]);
  const meetingsBookedInWeek = useMemo(
    () =>
      contacts.filter((c) => {
        if (c.disposition !== "meeting-booked" || !c.meetingBookedAt) return false;
        const key = localDayKeyFromIso(c.meetingBookedAt);
        return key >= bookedWeekRange.start && key <= bookedWeekRange.end;
      }).length,
    [contacts, bookedWeekRange]
  );
  const followUpLeads = useMemo(
    () => new Set(scopedTasks.filter((t) => !t.done && t.contactId).map((t) => t.contactId)).size,
    [scopedTasks]
  );

  /* ---- Tier 1: greeting and the one-line state ---- */
  const greeting = useMemo(() => {
    const h = new Date().getHours();
    return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  }, []);
  const openTasks = useMemo(() => scopedTasks.filter((t) => !t.done), [scopedTasks]);
  const overdueTasks = useMemo(
    () => openTasks.filter((t) => t.date < today).sort((a, b) => a.date.localeCompare(b.date)),
    [openTasks, today]
  );
  const repliesWaiting = useMemo(
    () => scopedTasks.filter((t) => t.channel === "email" && t.repliedAt).sort((a, b) => String(b.repliedAt).localeCompare(String(a.repliedAt))),
    [scopedTasks]
  );
  // Zero clauses are dropped entirely rather than printing "0 overdue" —
  // a clean day should read clean.
  const stateClauses = useMemo(() => {
    const parts: string[] = [];
    if (openTasks.length) parts.push(`${openTasks.length} open task${openTasks.length === 1 ? "" : "s"}`);
    if (overdueTasks.length) parts.push(`${overdueTasks.length} overdue`);
    if (repliesWaiting.length) parts.push(`${repliesWaiting.length} repl${repliesWaiting.length === 1 ? "y" : "ies"} flagged`);
    return parts;
  }, [openTasks, overdueTasks, repliesWaiting]);

  /* ---- Tier 2: the call queue behind the action band ---- */
  const callQueue = useMemo(
    () => openTasks.filter((t) => t.channel === "call" && t.date <= today),
    [openTasks, today]
  );
  const callQueueOverdue = useMemo(() => callQueue.filter((t) => t.date < today).length, [callQueue, today]);
  // Which product lines the queue covers, read off each task's contact.
  const callQueueLines = useMemo(() => {
    const set = new Set<string>();
    callQueue.forEach((t) => {
      const c = t.contactId ? contactById.get(t.contactId) : null;
      const label = c?.category ? CATEGORY_META[c.category]?.label : null;
      if (label) set.add(label);
    });
    return [...set];
  }, [callQueue, contactById]);

  /* ---- Tier 3: today's numbers, against your own same-weekday history ---- */
  const callsAvg = useMemo(() => sameWeekdayAverage(scopedTasks, "call", today), [scopedTasks, today]);
  const emailsAvg = useMemo(() => sameWeekdayAverage(scopedTasks, "email", today), [scopedTasks, today]);
  const followUpsDueToday = todaysTasks.filter((t) => !t.done).length;

  /* ---- Tier 4 right: this week ---- */
  const weekStartKey = useMemo(() => dateKeyOf(startOfWeek(new Date())), []);
  const callsThisWeek = useMemo(() => countCompletedChannelTasks(scopedTasks, "call", weekStartKey, today), [scopedTasks, weekStartKey, today]);
  const emailsThisWeek = useMemo(() => countCompletedChannelTasks(scopedTasks, "email", weekStartKey, today), [scopedTasks, weekStartKey, today]);
  // Sequences that are not running. Nothing auto-pauses in this app (that
  // needs bounce data from a real sending backend), so these are only ever
  // sequences somebody paused or archived by hand — labelled as such
  // rather than implying the system decided.
  const stalledSequences = useMemo(
    () => scopedSequences.filter((sq) => resolveStatus(sq) === "paused"),
    [scopedSequences]
  );

  /* ---- Day / week scope for the task blocks ---- */
  // Per Jack: Home should show "tasks for that day or week." One toggle
  // rescopes the due-task block; overdue is deliberately NOT rescoped —
  // anything past due is past due regardless of which window you're
  // looking at, so it always shows in full.
  const [taskScope, setTaskScope] = useState<"day" | "week">("day");
  const weekEndKey = useMemo(() => {
    const end = startOfWeek(new Date());
    end.setDate(end.getDate() + 6);
    return dateKeyOf(end);
  }, []);
  // Due in the chosen window, not yet done, and not already overdue
  // (overdue has its own block above it — a task can't be in both).
  const dueTasks = useMemo(() => {
    const upper = taskScope === "day" ? today : weekEndKey;
    return openTasks
      .filter((t) => t.date >= today && t.date <= upper)
      .sort((a, b) => (a.date === b.date ? compareByTimeThenCreated(a, b) : a.date.localeCompare(b.date)));
  }, [openTasks, today, weekEndKey, taskScope]);

  /* ---- People to work: call backs, follow-ups, hot leads ---- */
  // Call backs are not a guess: "Call back scheduled" is one of the nine
  // real call dispositions (lib/detection.ts), so this is simply everyone
  // currently sitting on that outcome. Ordered most recently seen first.
  const callBacks = useMemo(
    () =>
      contacts
        .filter((c) => c.disposition === "call-back-scheduled")
        .sort((a, b) => String(b.lastSeenAt).localeCompare(String(a.lastSeenAt))),
    [contacts]
  );

  // "Hot leads" needed a definition, and this one is built only from
  // fields that already exist — nothing here is a new flag or a guess at
  // intent. A hot lead is a contact the detection engine already put at
  // Strong Signal, who is still in play, and who is either asking for
  // something or has never been worked:
  //   - tier "signal" (Strong Signal), not crossed out
  //   - not Not interested and not Do not contact
  //   - not already covered by the Call backs block above
  //   - and either disposition "Info requested", or zero calls AND zero
  //     emails logged (qualified but untouched)
  // Info-requested leads rank first — they asked. Then untouched ones, most
  // recently seen first. The definition is stated on screen so the number
  // is never a mystery; say the word and it changes.
  const hotLeads = useMemo(() => {
    const out = contacts.filter((c) => {
      if (c.tier !== "signal" || c.crossedOut) return false;
      if (c.disposition === "not-interested" || c.disposition === "do-not-contact") return false;
      if (c.disposition === "call-back-scheduled") return false;
      const untouched = !(c.callCount || 0) && !(c.emailCount || 0);
      return c.disposition === "info-requested" || untouched;
    });
    return out.sort((a, b) => {
      const ai = a.disposition === "info-requested" ? 0 : 1;
      const bi = b.disposition === "info-requested" ? 0 : 1;
      if (ai !== bi) return ai - bi;
      return String(b.lastSeenAt).localeCompare(String(a.lastSeenAt));
    });
  }, [contacts]);

  return (
    <div className="home">
      {/* ---- Tier 1: greeting + one line of real state ---- */}
      <div className="page-head" style={{ marginBottom: "var(--s4)" }}>
        <div>
          <h1 className="page-title">{greeting}, {firstName}</h1>
          <p className="page-sub">
            {stateClauses.length ? stateClauses.join(" · ") : "Nothing open. Clean slate."}
          </p>
        </div>
        <div className="page-actions">
          <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>{todayLabel}</span>
          <select
            value={viewingUserId}
            onChange={(e) => setViewingUserId(e.target.value)}
            title="Scope this page to one person's plate, or everyone's"
            className="field"
            style={{ height: 30 }}
          >
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.isSelf ? `${u.name} (you)` : u.name}</option>
            ))}
            <option value="all">Everyone</option>
          </select>
        </div>
      </div>

      {/* ---- Tier 2: the action band. The page's ONLY primary button. ---- */}
      <div className="action-band">
        <div>
          <div className="action-title">
            {callQueue.length ? "Your call queue is ready" : "Nothing queued"}
          </div>
          <div className="action-sub">
            {callQueue.length
              ? [
                  `${callQueue.length} contact${callQueue.length === 1 ? "" : "s"}`,
                  callQueueOverdue ? `${callQueueOverdue} overdue` : "",
                  callQueueLines.join(", "),
                ].filter(Boolean).join(" · ")
              : "Add contacts to a sequence, or schedule a call, to generate call tasks."}
          </div>
        </div>
        {callQueue.length ? (
          <button className="btn btn-primary" onClick={() => onNavigate?.("calls")}>
            Start calling
          </button>
        ) : (
          <button className="btn btn-secondary" onClick={() => onNavigate?.("sequences")}>
            Go to sequences
          </button>
        )}
      </div>

      {/* ---- Tier 3: today's numbers, one container, hairline splits ---- */}
      <div className="section-label">Today</div>
      <div className="metric-row">
        <DayMetric label="Calls" value={callsToday} avg={callsAvg} />
        <DayMetric label="Emails" value={emailsToday} avg={emailsAvg} />
        <DayMetric label="Meetings booked" value={meetingsBookedToday} />
        <DayMetric label="Follow-ups due" value={followUpsDueToday} />
      </div>

      {/* ---- Tier 4: needs you now / this week ---- */}
      <div className="home-cols">
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <div className="section-label" style={{ margin: 0 }}>Needs you now</div>
            <div className="seg" style={{ marginLeft: "auto" }}>
              <button
                className={`seg-btn${taskScope === "day" ? " active" : ""}`}
                onClick={() => setTaskScope("day")}
                title="Tasks due today"
              >
                Day
              </button>
              <button
                className={`seg-btn${taskScope === "week" ? " active" : ""}`}
                onClick={() => setTaskScope("week")}
                title="Tasks due any time this week"
              >
                Week
              </button>
            </div>
          </div>
          {overdueTasks.length === 0 && repliesWaiting.length === 0 && dueTasks.length === 0 && stalledSequences.length === 0 && callBacks.length === 0 && hotLeads.length === 0 ? (
            <div className="calm-state">
              <div className="calm-icon" aria-hidden="true">✓</div>
              <div className="calm-title">You&rsquo;re clear</div>
              <div className="calm-body">No replies flagged and nothing overdue.</div>
            </div>
          ) : (
            <div className="stack-card">
              {overdueTasks.length > 0 && (
                <NeedsBlock title={`${overdueTasks.length} overdue task${overdueTasks.length === 1 ? "" : "s"}`} pill="danger" pillText="Overdue">
                  {overdueTasks.slice(0, 3).map((t) => (
                    <NeedsRow
                      key={t.id}
                      title={t.text}
                      meta={`${t.contactId ? contactById.get(t.contactId)?.company || "" : ""}${t.contactId && contactById.get(t.contactId)?.company ? " · " : ""}due ${relativeDay(t.date, today)}`}
                      onDone={() => onToggleTask(t.id)}
                    />
                  ))}
                  {overdueTasks.length > 3 && <div className="needs-more">+{overdueTasks.length - 3} more</div>}
                </NeedsBlock>
              )}
              {dueTasks.length > 0 && (
                <NeedsBlock
                  title={`${dueTasks.length} due ${taskScope === "day" ? "today" : "this week"}`}
                  pill="info"
                  pillText={taskScope === "day" ? "Today" : "This week"}
                >
                  {dueTasks.slice(0, taskScope === "day" ? 4 : 6).map((t) => {
                    const c = t.contactId ? contactById.get(t.contactId) : null;
                    return (
                      <NeedsRow
                        key={t.id}
                        title={t.text}
                        meta={[
                          c?.company,
                          taskScope === "week" && t.date !== today ? relativeDay(t.date, today) : null,
                          t.time ? formatTaskTime(t.time) : "Anytime",
                          CHANNEL_ICON[t.channel || ""] || "",
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                        onDone={() => onToggleTask(t.id)}
                      />
                    );
                  })}
                  {dueTasks.length > (taskScope === "day" ? 4 : 6) && (
                    <div className="needs-more">+{dueTasks.length - (taskScope === "day" ? 4 : 6)} more</div>
                  )}
                </NeedsBlock>
              )}
              {callBacks.length > 0 && (
                <NeedsBlock
                  title={`${callBacks.length} call back${callBacks.length === 1 ? "" : "s"} to make`}
                  pill="warning"
                  pillText="Call back"
                >
                  {callBacks.slice(0, 4).map((c) => (
                    <NeedsRow
                      key={c.id}
                      title={c.fullName || `${c.firstName} ${c.lastName}`.trim() || c.company || "Unnamed contact"}
                      meta={[c.company, c.title].filter(Boolean).join(" · ")}
                      action={
                        <button className="btn btn-sm btn-ghost" onClick={() => onNavigate?.("calls")}>
                          Call
                        </button>
                      }
                    />
                  ))}
                  {callBacks.length > 4 && <div className="needs-more">+{callBacks.length - 4} more</div>}
                </NeedsBlock>
              )}
              {hotLeads.length > 0 && (
                <NeedsBlock title={`${hotLeads.length} hot lead${hotLeads.length === 1 ? "" : "s"}`} pill="success" pillText="Hot">
                  {hotLeads.slice(0, 4).map((c) => (
                    <NeedsRow
                      key={c.id}
                      title={c.fullName || `${c.firstName} ${c.lastName}`.trim() || c.company || "Unnamed contact"}
                      meta={[
                        c.company,
                        c.category ? CATEGORY_META[c.category]?.label : null,
                        c.disposition === "info-requested" ? "Asked for info" : "Not worked yet",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                      action={
                        <button className="btn btn-sm btn-ghost" onClick={() => onNavigate?.("contacts")}>
                          Open
                        </button>
                      }
                    />
                  ))}
                  {hotLeads.length > 4 && <div className="needs-more">+{hotLeads.length - 4} more</div>}
                  <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 6, lineHeight: 1.4 }}>
                    Strong Signal leads still in play that asked for info or have never been called or emailed.
                  </div>
                </NeedsBlock>
              )}
              {repliesWaiting.length > 0 && (
                <NeedsBlock title={`${repliesWaiting.length} repl${repliesWaiting.length === 1 ? "y" : "ies"} flagged`} pill="info" pillText="Replied">
                  {repliesWaiting.slice(0, 3).map((t) => {
                    const c = t.contactId ? contactById.get(t.contactId) : null;
                    return (
                      <NeedsRow
                        key={t.id}
                        title={c ? c.fullName || c.company : t.text}
                        meta={[c?.company, t.repliedAt ? relativeDay(localDayKeyFromIso(t.repliedAt), today) : ""].filter(Boolean).join(" · ")}
                        action={
                          <button className="btn btn-sm btn-ghost" onClick={() => onUpdateTaskFields(t.id, { repliedAt: null })} title="Clear the replied flag">
                            Clear
                          </button>
                        }
                      />
                    );
                  })}
                </NeedsBlock>
              )}
              {stalledSequences.length > 0 && (
                <NeedsBlock title={`${stalledSequences.length} sequence${stalledSequences.length === 1 ? "" : "s"} paused`} pill="warning" pillText="Paused">
                  {stalledSequences.slice(0, 3).map((sq) => (
                    <NeedsRow key={sq.id} title={sq.name} meta="Paused by hand — no new enrollments or step tasks" />
                  ))}
                </NeedsBlock>
              )}
            </div>
          )}
        </div>

        <div>
          <div className="section-label">This week</div>
          <div className="stack-card">
            <WeekRow label="Calls" value={callsThisWeek} />
            <WeekRow label="Emails" value={emailsThisWeek} />
            <WeekRow
              label="Meetings booked"
              value={meetingsBookedInWeek}
              extra={
                <span className="week-stepper">
                  <button onClick={() => setBookedWeekOffset(bookedWeekOffset - 1)} title="Previous week">◀</button>
                  <button onClick={() => setBookedWeekOffset(Math.min(0, bookedWeekOffset + 1))} disabled={bookedWeekOffset === 0} title="Next week">▶</button>
                </span>
              }
            />
            <WeekRow label="Active sequences" value={activeSequences} />
            <WeekRow label="Follow-up leads" value={followUpLeads} />
          </div>

          <WeeklyGoalsPanel
            goals={weeklyGoals}
            tasks={scopedTasks}
            onUpdateMetric={onUpdateMetric}
            onAddMetric={onAddMetric}
            onRemoveMetric={onRemoveMetric}
          />
        </div>
      </div>

      <NotificationsPanel
        tasks={scopedTasks}
        allTasks={tasks}
        contactById={contactById}
        users={users}
        today={today}
        onToggleTask={onToggleTask}
        onUpdateTaskFields={onUpdateTaskFields}
      />
    </div>
  );
}

// "3d ago" / "in 2d" / "today" — relative under a week, absolute beyond.
function relativeDay(dayKey: string, today: string): string {
  const a = new Date(`${dayKey}T12:00:00`).getTime();
  const b = new Date(`${today}T12:00:00`).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return dayKey;
  const days = Math.round((a - b) / 86400000);
  if (days === 0) return "today";
  if (Math.abs(days) < 7) return days < 0 ? `${-days}d ago` : `in ${days}d`;
  return new Date(a).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// A today tile: label, mono value, and a delta against your own average
// for this weekday. The delta is omitted entirely when there isn't enough
// history for it to mean anything.
function DayMetric({ label, value, avg }: { label: string; value: number; avg?: number | null }) {
  const delta = avg == null ? null : value - avg;
  return (
    <div className="metric">
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      {delta == null ? (
        <div className="metric-hint">&nbsp;</div>
      ) : (
        <div className={`metric-hint ${delta >= 0 ? "up" : "down"}`}>
          {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(delta % 1 === 0 ? 0 : 1)} vs your {new Date().toLocaleDateString(undefined, { weekday: "long" })}s
        </div>
      )}
    </div>
  );
}

function NeedsBlock({ title, pill, pillText, children }: { title: string; pill: string; pillText: string; children: ReactNode }) {
  return (
    <div className="needs-block">
      <div className="needs-head">
        <span className="needs-title">{title}</span>
        <span className={`status-pill ${pill}`}>{pillText}</span>
      </div>
      {children}
    </div>
  );
}
function NeedsRow({ title, meta, onDone, action }: { title: string; meta?: string; onDone?: () => void; action?: ReactNode }) {
  return (
    <div className="needs-row">
      {onDone && <input type="checkbox" checked={false} onChange={onDone} title="Mark done" />}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="needs-row-title">{title}</div>
        {meta && <div className="needs-row-meta">{meta}</div>}
      </div>
      {action}
    </div>
  );
}

function WeekRow({ label, value, extra }: { label: string; value: number; extra?: ReactNode }) {
  return (
    <div className="week-row">
      <span className="week-label">{label}</span>
      {extra}
      <span className="week-value">{value}</span>
    </div>
  );
}

function NotificationsPanel({
  tasks,
  allTasks,
  contactById,
  users,
  today,
  onToggleTask,
  onUpdateTaskFields,
}: {
  tasks: Task[]; // already scoped to the viewed user (or everyone)
  allTasks: Task[]; // unscoped — needed for the "by each user" breakdown
  contactById: Map<string, Contact>;
  users: PlatformUser[];
  today: string;
  onToggleTask: (id: string) => void;
  onUpdateTaskFields: (id: string, patch: Partial<Pick<Task, "userId" | "repliedAt">>) => void;
}) {
  const [open, setOpen] = useState(false);

  const scheduledEmails = useMemo(
    () => tasks.filter((t) => t.channel === "email" && !t.done && t.date > today).sort((a, b) => a.date.localeCompare(b.date)),
    [tasks, today]
  );
  // Deliberately reads from allTasks, not the viewing-scoped list — the
  // whole point of this row is a per-user breakdown, so it always shows
  // every user regardless of who's currently being viewed.
  const emailsSentTodayByUser = useMemo(() => {
    const counts = new Map<string, number>();
    allTasks.forEach((t) => {
      if (t.channel === "email" && t.done && t.date === today) {
        const key = t.userId || "unassigned";
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    });
    return [...counts.entries()]
      .map(([userId, count]) => ({ userId, count, label: userId === "unassigned" ? "Unassigned" : userLabel(users, userId) }))
      .sort((a, b) => b.count - a.count);
  }, [allTasks, today, users]);
  const repliedEmails = useMemo(
    () => tasks.filter((t) => t.channel === "email" && t.repliedAt).sort((a, b) => (b.repliedAt || "").localeCompare(a.repliedAt || "")),
    [tasks]
  );
  const overdueTasks = useMemo(
    () => tasks.filter((t) => !t.done && t.date < today).sort((a, b) => a.date.localeCompare(b.date)),
    [tasks, today]
  );
  const missedSequenceSteps = useMemo(() => overdueTasks.filter((t) => t.sequenceEnrollmentId), [overdueTasks]);
  const upcomingFollowUps = useMemo(
    () => tasks.filter((t) => !t.done && t.contactId && t.date > today).sort((a, b) => a.date.localeCompare(b.date)),
    [tasks, today]
  );

  const actionableCount = overdueTasks.length;

  function contactLine(t: Task) {
    const c = t.contactId ? contactById.get(t.contactId) : undefined;
    if (!c) return null;
    return `${c.fullName || "(no name)"}${c.company ? ` — ${c.company}` : ""}`;
  }

  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 18px", marginBottom: 18 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", border: "none", background: "none", cursor: "pointer", textAlign: "left", padding: 0 }}
      >
        <span style={{ fontSize: 12, color: "var(--muted)" }}>{open ? "▾" : "▸"}</span>
        <h2 style={{ margin: 0, fontSize: 14, flex: 1 }}>🔔 Notifications</h2>
        {actionableCount > 0 && (
          <span style={{ fontSize: 10.5, fontWeight: 700, color: "#B5443B", background: "#FBE4E1", borderRadius: 999, padding: "2px 9px" }}>
            {actionableCount} overdue
          </span>
        )}
        {!open && <span style={{ fontSize: 11.5, color: "var(--muted)" }}>Click to expand</span>}
      </button>

      {open && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 16 }}>
          <NotificationSection title="⏰ Outstanding & overdue tasks" empty="Nothing overdue — you're caught up.">
            {overdueTasks.map((t) => (
              <NotificationRow key={t.id} task={t} contactLine={contactLine(t)} onToggleTask={onToggleTask} accent="#B5443B" />
            ))}
          </NotificationSection>

          <NotificationSection title="📡 Missed sequence steps" empty="No sequence-generated tasks are overdue.">
            {missedSequenceSteps.map((t) => (
              <NotificationRow key={t.id} task={t} contactLine={contactLine(t)} onToggleTask={onToggleTask} accent="#9A5B22" />
            ))}
          </NotificationSection>

          <NotificationSection title="📅 Upcoming follow-ups" empty="Nothing scheduled ahead of today.">
            {upcomingFollowUps.map((t) => (
              <NotificationRow key={t.id} task={t} contactLine={contactLine(t)} onToggleTask={onToggleTask} accent="var(--accent-blue, #0A66C2)" />
            ))}
          </NotificationSection>

          <NotificationSection title="✉️ Emails scheduled for delivery" empty="No upcoming email tasks queued.">
            {scheduledEmails.map((t) => (
              <NotificationRow key={t.id} task={t} contactLine={contactLine(t)} onToggleTask={onToggleTask} accent="var(--accent-blue, #0A66C2)" />
            ))}
          </NotificationSection>

          <NotificationSection title="📤 Emails sent today, by user" empty="No completed email tasks yet today.">
            {emailsSentTodayByUser.length > 0 && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {emailsSentTodayByUser.map((row) => (
                  <div key={row.userId} style={{ background: "var(--surface-sunken)", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 12px", textAlign: "center", minWidth: 68 }}>
                    <div style={{ fontSize: 16, fontWeight: 700, color: "var(--ink)" }}>{row.count}</div>
                    <div style={{ fontSize: 9.5, color: "var(--muted)", fontWeight: 700, textTransform: "uppercase" }}>{row.label}</div>
                  </div>
                ))}
              </div>
            )}
          </NotificationSection>

          <NotificationSection title="↩️ Emails replied to" empty='No replies marked yet — use "Mark replied" on an email task in Engage → Emails (manual: this app has no inbox to detect a real reply).'>
            {repliedEmails.map((t) => (
              <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, background: "var(--surface-sunken)", border: "1px solid var(--border)", borderRadius: 9, padding: "7px 12px" }}>
                <span style={{ fontSize: 12, flex: 1, color: "var(--ink)" }}>{t.text}</span>
                {contactLine(t) && <span style={{ fontSize: 11.5, color: "var(--muted)", whiteSpace: "nowrap" }}>{contactLine(t)}</span>}
                <span style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap" }}>{new Date(t.repliedAt as string).toLocaleDateString()}</span>
                <button
                  onClick={() => onUpdateTaskFields(t.id, { repliedAt: null })}
                  title="Unmark replied"
                  style={{ border: "none", background: "none", color: "#B5443B", fontSize: 12, cursor: "pointer" }}
                >
                  ✕
                </button>
              </div>
            ))}
          </NotificationSection>
        </div>
      )}
    </div>
  );
}

function NotificationSection({ title, empty, children }: { title: string; empty: string; children: ReactNode }) {
  const hasContent = Array.isArray(children) ? children.some((c) => c) : Boolean(children);
  return (
    <div>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)", marginBottom: 6 }}>{title}</div>
      {!hasContent ? (
        <div style={{ fontSize: 12, color: "var(--muted)", border: "1px dashed var(--border)", borderRadius: 9, padding: "10px 12px" }}>{empty}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>{children}</div>
      )}
    </div>
  );
}

function NotificationRow({
  task,
  contactLine,
  onToggleTask,
  accent,
}: {
  task: Task;
  contactLine: string | null;
  onToggleTask: (id: string) => void;
  accent: string;
}) {
  const timeLabel = formatTaskTime(task.time);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, background: "var(--surface-sunken)", border: "1px solid var(--border)", borderLeft: `3px solid ${accent}`, borderRadius: 9, padding: "7px 12px" }}>
      <input type="checkbox" checked={task.done} onChange={() => onToggleTask(task.id)} title="Mark done" />
      <span style={{ fontSize: 11.5, color: "var(--muted)", whiteSpace: "nowrap" }}>
        {task.date}
        {timeLabel ? ` · ${timeLabel}` : ""}
      </span>
      {task.channel && <span title={task.channel} style={{ fontSize: 12 }}>{CHANNEL_ICON[task.channel]}</span>}
      <span style={{ fontSize: 12.5, flex: 1, color: "var(--ink)" }}>{task.text}</span>
      {contactLine && <span style={{ fontSize: 11.5, color: "var(--muted)", whiteSpace: "nowrap" }}>{contactLine}</span>}
    </div>
  );
}

// Weekly Goals, rebuilt. Per Jack: "much more defined and not ai crap."
// The old version was three rows of bare number inputs with a thin bar,
// which told you how full a bar was but never whether you were actually
// on track. This states, per metric: where you are, where you should be
// by now, and whether that is ahead or behind — the thing a rep actually
// wants at a glance on a Wednesday afternoon.
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
  // Open in edit mode when NOTHING has a target yet. Otherwise a fresh
  // week reads "No target set" three times with the only way to fix it
  // hidden behind a button — a clean display state is worth nothing if
  // you can't get started from it.
  const noTargetsYet = goals.metrics.every((m) => !m.target);
  const [editing, setEditing] = useState(noTargetsYet);
  const weekLabel = weekRangeLabel(startOfWeek(new Date()));
  // How far through the working week we are — a goal at 40% on Monday is
  // ahead; the same 40% on Friday is behind. Without this a progress bar
  // is decoration.
  const pace = weekProgressFraction();

  function submitAdd() {
    if (!addingLabel.trim()) return;
    onAddMetric(addingLabel);
    setAddingLabel("");
  }

  return (
    <>
      <div className="section-label" style={{ marginTop: "var(--s4)" }}>Weekly goals</div>
      <div className="stack-card">
        <div className="goals-head">
          <span className="goals-week">{weekLabel}</span>
          <span style={{ flex: 1 }} />
          <span className="goals-pace">{Math.round(pace * 100)}% through the week</span>
          <button className="btn btn-sm btn-ghost" onClick={() => setEditing((v) => !v)}>
            {editing ? "Done" : "Edit"}
          </button>
        </div>

        {goals.metrics.map((m) => {
          const actual = m.autoSource === "outboundCalls" ? computeAutoActual(tasks, goals.weekKey) : m.actual;
          const pct = m.target > 0 ? (actual / m.target) * 100 : 0;
          const expected = m.target > 0 ? m.target * pace : 0;
          const diff = actual - expected;
          // "On pace" is a band, not a knife edge — being half a call
          // behind on a target of 50 is not a status worth colouring red.
          const band = m.target > 0 ? Math.max(1, m.target * 0.05) : 1;
          const state = m.target <= 0 ? "none" : actual >= m.target ? "hit" : diff >= -band ? "on" : "behind";
          return (
            <div key={m.id} className="goal-row">
              <div className="goal-top">
                {editing ? (
                  <input
                    value={m.label}
                    onChange={(e) => onUpdateMetric(m.id, { label: e.target.value })}
                    className="field"
                    style={{ height: 28, flex: "1 1 140px", fontWeight: 600 }}
                  />
                ) : (
                  <span className="goal-label">{m.label}</span>
                )}
                <span className="goal-figures">
                  <strong>{actual}</strong>
                  <span className="goal-of">of</span>
                  {editing ? (
                    <input
                      type="number"
                      min={0}
                      value={m.target}
                      onChange={(e) => onUpdateMetric(m.id, { target: Math.max(0, Number(e.target.value) || 0) })}
                      className="field"
                      style={{ height: 28, width: 62, textAlign: "right" }}
                    />
                  ) : (
                    <span className="goal-target">{m.target}</span>
                  )}
                </span>
                {editing && (
                  <button className="btn btn-sm btn-ghost" onClick={() => onRemoveMetric(m.id)} title="Remove this metric">✕</button>
                )}
              </div>

              <div className="goal-bar">
                <div className={`goal-fill ${state}`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
                {m.target > 0 && (
                  <div className="goal-pace-mark" style={{ left: `${Math.min(100, pace * 100)}%` }} title={`On pace would be ${Math.round(expected)} by now`} />
                )}
              </div>

              <div className="goal-foot">
                <span className={`goal-state ${state}`}>
                  {state === "hit" ? "Goal hit" : state === "on" ? "On pace" : state === "behind" ? `${Math.abs(Math.round(diff))} behind pace` : "No target set"}
                </span>
                <span style={{ flex: 1 }} />
                {m.autoSource === "outboundCalls" ? (
                  <span className="goal-source" title="Counted live from completed call tasks this week">Auto</span>
                ) : editing ? (
                  <span className="goal-figures">
                    <span className="goal-of">actual</span>
                    <input
                      type="number"
                      min={0}
                      value={m.actual}
                      onChange={(e) => onUpdateMetric(m.id, { actual: Math.max(0, Number(e.target.value) || 0) })}
                      className="field"
                      style={{ height: 26, width: 58, textAlign: "right" }}
                    />
                  </span>
                ) : (
                  <span className="goal-source" title="Tracked by hand — no data source for this one yet">Manual</span>
                )}
              </div>
            </div>
          );
        })}

        {editing && (
          <div className="goal-add">
            <input
              value={addingLabel}
              onChange={(e) => setAddingLabel(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitAdd()}
              placeholder="Add a metric, e.g. Meetings booked"
              className="field"
              style={{ flex: 1, height: 30 }}
            />
            <button className="btn btn-sm btn-secondary" onClick={submitAdd} disabled={!addingLabel.trim()}>Add</button>
          </div>
        )}
      </div>
    </>
  );
}
