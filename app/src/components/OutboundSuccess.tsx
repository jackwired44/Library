// Outbound Success — per Jack: "an outbound success tab where we can view
// this and run it against the uploaded leads, so we can go back and see
// leads who have never been successfully contacted and meetings that were
// booked. This will be a good high level way to view outbound success and
// where the gaps are."
//
// Reads ONLY data the platform already holds — the Contacts directory and
// the OutreachAttempt log. No new store, no new field, no network call.
// Every number here is derived, which is deliberate: this view exists to
// expose gaps in the outbound motion, so it must never be able to disagree
// with the records those gaps live in.
import { useEffect, useMemo, useState } from "react";
import { ACTIVE_CATEGORY_KEYS, CATEGORY_META, TIER_META, type CategoryKey, type Disposition } from "../lib/detection";
import { hasLeadData, type Contact } from "../lib/contacts";
import { ATTEMPT_CHANNEL_META, groupAttemptsByContact, summarizeAttempts, type OutreachAttempt } from "../lib/outreachAttempts";
import { dispositionMetaFor, isConnectedDisposition, type CustomDisposition } from "../lib/dispositions";
import { localDayKeyFromIso } from "../lib/tasks";

const PAGE_SIZE = 25;

// The three questions Jack named, in the order he named them. "gap" first
// because a gap is the thing you act on; "booked" last because it is the
// outcome, not the work.
type Bucket = "never-reached" | "never-tried" | "booked";

const BUCKET_META: Record<Bucket, { label: string; blurb: string }> = {
  "never-reached": {
    label: "Tried, never reached",
    blurb: "At least one logged attempt, but no outcome that ever actually reached the person. These are the leads the current approach is failing on.",
  },
  "never-tried": {
    label: "Never contacted at all",
    blurb: "Uploaded and sitting in the directory with zero calls, zero emails and zero logged attempts. Pure untouched inventory.",
  },
  booked: {
    label: "Intro meetings booked",
    blurb: "Currently sitting on a meeting-booked disposition. This is the outbound motion working.",
  },
};

// Per Jack: "the outbound success will show us over x amount of days or
// months how many calls were made, emails and so forth, and we can fully
// analyze the success rate of our outbound attempts and prioritize
// better."
//
// This is a DIFFERENT axis from the lead-state buckets below and is kept
// visibly separate for that reason. A bucket answers "where does this lead
// stand, all time" — reaching someone eight months ago still means they
// are not an unreached gap today. The window answers "what did we actually
// do lately, and how well did it work." Collapsing the two would quietly
// turn every old success into a fresh-looking gap whenever the window
// shortened.
type WindowKey = "7d" | "30d" | "90d" | "6mo" | "12mo" | "all";

const WINDOW_META: { key: WindowKey; label: string; days: number | null }[] = [
  { key: "7d", label: "Last 7 days", days: 7 },
  { key: "30d", label: "Last 30 days", days: 30 },
  { key: "90d", label: "Last 90 days", days: 90 },
  { key: "6mo", label: "Last 6 months", days: 182 },
  { key: "12mo", label: "Last 12 months", days: 365 },
  { key: "all", label: "All time", days: null },
];

// Inclusive local-day cutoff. Date-only strings are parsed at local noon,
// the same convention lib/tasks.ts and lib/history.ts already use, so a
// timezone offset can never shift the boundary by a day.
function windowStartKey(days: number | null, now = new Date()): string | null {
  if (days === null) return null;
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
  d.setDate(d.getDate() - (days - 1));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface ActivityTotals {
  calls: number;
  emails: number;
  linkedin: number;
  attempts: number;
  reached: number;
  booked: number;
  // Distinct people touched in the window — a different and more honest
  // measure of reach than raw attempt volume, since 40 dials into the same
  // 5 accounts is not 40 leads worked.
  leadsTouched: number;
}

// Counts attempts that fall inside the window. Only the dated attempt log
// can answer this: Contact.callCount/emailCount are undated running totals
// (see CLAUDE.md "Reached status"), so they cannot be attributed to any
// period and are deliberately excluded here rather than being smeared
// across the window and inflating it.
export function activityInWindow(
  attempts: OutreachAttempt[],
  startKey: string | null,
  isConnected: (o: Disposition) => boolean
): ActivityTotals {
  const people = new Set<string>();
  const t: ActivityTotals = { calls: 0, emails: 0, linkedin: 0, attempts: 0, reached: 0, booked: 0, leadsTouched: 0 };
  attempts.forEach((a) => {
    if (startKey && localDayKeyFromIso(a.at) < startKey) return;
    t.attempts += 1;
    people.add(a.contactId);
    if (a.channel === "call") t.calls += 1;
    else if (a.channel === "email") t.emails += 1;
    else if (a.channel === "linkedin") t.linkedin += 1;
    if (isConnected(a.outcome)) t.reached += 1;
    if (a.outcome === "meeting-booked") t.booked += 1;
  });
  t.leadsTouched = people.size;
  return t;
}

// A lead's outbound state, computed once per contact so the buckets, the
// KPI strip and the table all read the same numbers off the same pass.
interface LeadState {
  contact: Contact;
  attempts: OutreachAttempt[];
  attemptCount: number;
  reachedCount: number;
  // Counts the manual callCount/emailCount too, not just logged attempts —
  // those counters predate the attempt log (see CLAUDE.md "Reached status")
  // and a contact carrying them HAS been worked, even though no dated
  // attempt row exists to prove how it went. Treating them as untouched
  // would overstate the gap.
  touched: boolean;
  booked: boolean;
  lastAt: string | null;
}

function buildLeadStates(
  contacts: Contact[],
  attempts: OutreachAttempt[],
  dispositions: CustomDisposition[]
): LeadState[] {
  const byContact = groupAttemptsByContact(attempts);
  const connected = (o: Disposition) => isConnectedDisposition(o, dispositions);
  return contacts.map((c) => {
    const list = byContact.get(c.id) || [];
    const sum = summarizeAttempts(list, connected);
    const manual = (c.callCount || 0) + (c.emailCount || 0);
    return {
      contact: c,
      attempts: list,
      attemptCount: sum.total,
      reachedCount: sum.reached,
      touched: sum.total > 0 || manual > 0,
      booked: c.disposition === "meeting-booked",
      lastAt: sum.latest ? sum.latest.at : null,
    };
  });
}

function bucketOf(s: LeadState): Bucket | null {
  // Booked wins outright. A booked lead that was reached on the third dial
  // is a success, not a "tried, never reached" gap, and double-counting it
  // in both would make the buckets stop summing to anything meaningful.
  if (s.booked) return "booked";
  if (!s.touched) return "never-tried";
  if (s.reachedCount === 0) return "never-reached";
  return null; // reached, not booked — real progress, neither a gap nor a win
}

export default function OutboundSuccess({
  contacts,
  attempts,
  dispositions,
  loading,
}: {
  contacts: Contact[];
  attempts: OutreachAttempt[];
  dispositions: CustomDisposition[];
  loading: boolean;
}) {
  const [bucket, setBucket] = useState<Bucket>("never-reached");
  const [windowKey, setWindowKey] = useState<WindowKey>("30d");
  const [sourceFile, setSourceFile] = useState("all");
  const [category, setCategory] = useState<CategoryKey | "all" | "none">("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);

  const states = useMemo(() => buildLeadStates(contacts, attempts, dispositions), [contacts, attempts, dispositions]);

  // Every distinct uploaded file, so "run it against the uploaded leads"
  // can actually be scoped to one upload rather than the whole directory.
  const sourceFiles = useMemo(() => {
    const set = new Set<string>();
    contacts.forEach((c) => c.sourceFiles.forEach((f) => set.add(f)));
    return Array.from(set).sort();
  }, [contacts]);

  // Filters apply BEFORE bucketing, so the bucket counts describe the slice
  // being looked at rather than the whole directory.
  const scoped = useMemo(() => {
    let list = states;
    if (sourceFile !== "all") list = list.filter((s) => s.contact.sourceFiles.includes(sourceFile));
    if (category === "none") list = list.filter((s) => !s.contact.category);
    else if (category !== "all") list = list.filter((s) => s.contact.category === category);
    if (dateFrom) list = list.filter((s) => localDayKeyFromIso(s.contact.lastSeenAt) >= dateFrom);
    if (dateTo) list = list.filter((s) => localDayKeyFromIso(s.contact.lastSeenAt) <= dateTo);
    return list;
  }, [states, sourceFile, category, dateFrom, dateTo]);

  const activity = useMemo(() => {
    const spec = WINDOW_META.find((w) => w.key === windowKey) || WINDOW_META[1];
    const startKey = windowStartKey(spec.days);
    // Restrict to the leads the filters left in view, so "last 30 days on
    // the August upload" means exactly that rather than all activity
    // everywhere over the same dates.
    const inScope = new Set(scoped.map((s) => s.contact.id));
    const relevant = attempts.filter((a) => inScope.has(a.contactId));
    return activityInWindow(relevant, startKey, (o) => isConnectedDisposition(o, dispositions));
  }, [attempts, scoped, windowKey, dispositions]);

  const counts = useMemo(() => {
    const c = { "never-reached": 0, "never-tried": 0, booked: 0, reachedNotBooked: 0, touched: 0, reached: 0 };
    scoped.forEach((s) => {
      const b = bucketOf(s);
      if (b) c[b] += 1;
      else c.reachedNotBooked += 1;
      if (s.touched) c.touched += 1;
      if (s.reachedCount > 0) c.reached += 1;
    });
    return c;
  }, [scoped]);

  // Per Jack: "...and prioritize better." Qualification rank comes first,
  // because an untouched Strong Signal lead is worth more than a freshly
  // failed Bad Lead — sorting a gap bucket purely by recency buries the
  // leads actually worth working. Recency is the tiebreak inside a tier.
  const TIER_RANK: Record<string, number> = { signal: 0, mention: 1, dq: 2 };
  const rows = useMemo(() => {
    const list = scoped.filter((s) => bucketOf(s) === bucket);
    return [...list].sort((a, b) => {
      const ta = TIER_RANK[a.contact.tier || ""] ?? 3;
      const tb = TIER_RANK[b.contact.tier || ""] ?? 3;
      if (ta !== tb) return ta - tb;
      return String(b.lastAt || b.contact.lastSeenAt).localeCompare(String(a.lastAt || a.contact.lastSeenAt));
    });
  }, [scoped, bucket]);

  useEffect(() => { setPage(1); }, [bucket, sourceFile, category, dateFrom, dateTo]);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageItems = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const total = scoped.length;
  const pct = (n: number) => (total === 0 ? "—" : `${Math.round((n / total) * 100)}%`);
  const filtersOn = sourceFile !== "all" || category !== "all" || Boolean(dateFrom) || Boolean(dateTo);

  if (loading) return <div style={{ color: "var(--muted)", fontSize: 13 }}>Loading outbound data…</div>;

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Outbound success</h2>
          <div className="page-sub">
            Every uploaded lead measured against what actually happened to it — where outreach is landing, and where it never started.
          </div>
        </div>
      </div>

      <div className="control-strip" style={{ flexWrap: "wrap", gap: 10 }}>
        <label style={{ fontSize: 12, color: "var(--muted)", display: "flex", alignItems: "center", gap: 6 }}>
          Upload
          <select value={sourceFile} onChange={(e) => setSourceFile(e.target.value)} style={{ maxWidth: 260 }}>
            <option value="all">All uploads ({contacts.length} leads)</option>
            {sourceFiles.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </label>
        <label style={{ fontSize: 12, color: "var(--muted)", display: "flex", alignItems: "center", gap: 6 }}>
          Product line
          <select value={category} onChange={(e) => setCategory(e.target.value as CategoryKey | "all" | "none")}>
            <option value="all">All</option>
            {ACTIVE_CATEGORY_KEYS.map((k) => (
              <option key={k} value={k}>{CATEGORY_META[k].label}</option>
            ))}
            <option value="none">No lead data</option>
          </select>
        </label>
        <label style={{ fontSize: 12, color: "var(--muted)", display: "flex", alignItems: "center", gap: 6 }} title="When the lead was last seen in an upload — not when outreach happened. Outreach timing is the Window control below.">
          Lead seen
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          to
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </label>
        {filtersOn && (
          <button
            className="chip-clear"
            onClick={() => { setSourceFile("all"); setCategory("all"); setDateFrom(""); setDateTo(""); }}
          >
            Clear
          </button>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginTop: 18, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontSize: 14 }}>Outbound activity</h3>
        <label style={{ fontSize: 12, color: "var(--muted)", display: "flex", alignItems: "center", gap: 6 }}>
          Window
          <select value={windowKey} onChange={(e) => setWindowKey(e.target.value as WindowKey)}>
            {WINDOW_META.map((w) => (
              <option key={w.key} value={w.key}>{w.label}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="metric-row" style={{ marginTop: 8 }}>
        <div className="metric" title="Logged call attempts in this window">
          <div className="metric-label">Calls made</div>
          <div className="metric-value">{activity.calls}</div>
        </div>
        <div className="metric" title="Logged email attempts in this window">
          <div className="metric-label">Emails sent</div>
          <div className="metric-value">{activity.emails}</div>
        </div>
        <div className="metric" title="Distinct people touched — not raw attempt volume, since repeated dials into one account are not multiple leads worked">
          <div className="metric-label">Leads touched</div>
          <div className="metric-value">{activity.leadsTouched}</div>
        </div>
        <div className="metric" title="Attempts that reached a real person, over all attempts in this window">
          <div className="metric-label">Connect rate</div>
          <div className="metric-value">{activity.attempts === 0 ? "—" : `${Math.round((activity.reached / activity.attempts) * 100)}%`}</div>
          <div className="metric-delta">{activity.reached} of {activity.attempts} attempts</div>
        </div>
        <div className="metric" title="Attempts in this window whose outcome was a booked meeting">
          <div className="metric-label">Intro meetings booked</div>
          <div className="metric-value">{activity.booked}</div>
          <div className="metric-delta">
            {activity.reached === 0 ? "no connects yet" : `${Math.round((activity.booked / activity.reached) * 100)}% of connects`}
          </div>
        </div>
      </div>
      {activity.attempts === 0 && (
        <div style={{ fontSize: 12, color: "var(--muted)", margin: "8px 2px 0" }}>
          No logged attempts in this window. Only dated attempts count here — a contact's running call/email counters
          carry no date, so they can't be attributed to a period and are left out rather than inflating it.
        </div>
      )}

      <h3 style={{ margin: "22px 0 0", fontSize: 14 }}>Where every lead stands</h3>
      <div style={{ fontSize: 12, color: "var(--muted)", margin: "4px 2px 0" }}>
        All-time state, independent of the window above — reaching someone months ago still means they are not a gap today.
      </div>
      <div className="metric-row" style={{ marginTop: 10 }}>
        <div className="metric">
          <div className="metric-label">Leads in view</div>
          <div className="metric-value">{total}</div>
        </div>
        <div className="metric" title="At least one call, email or logged attempt">
          <div className="metric-label">Contacted</div>
          <div className="metric-value">{counts.touched}</div>
          <div className="metric-delta">{pct(counts.touched)} of leads</div>
        </div>
        <div className="metric" title="Reached a real person at least once — a connected call outcome">
          <div className="metric-label">Actually reached</div>
          <div className="metric-value">{counts.reached}</div>
          <div className="metric-delta">{pct(counts.reached)} of leads</div>
        </div>
        <div className="metric" title="Currently sitting on a meeting-booked disposition">
          <div className="metric-label">Intro meetings booked</div>
          <div className="metric-value">{counts.booked}</div>
          <div className="metric-delta">{pct(counts.booked)} of leads</div>
        </div>
      </div>

      <div className="seg" style={{ marginTop: 16 }}>
        {(Object.keys(BUCKET_META) as Bucket[]).map((b) => (
          <button
            key={b}
            className={`seg-btn${bucket === b ? " on" : ""}`}
            onClick={() => setBucket(b)}
            title={BUCKET_META[b].blurb}
          >
            {BUCKET_META[b].label} ({counts[b]})
          </button>
        ))}
      </div>
      <div style={{ fontSize: 12, color: "var(--muted)", margin: "8px 2px 14px" }}>{BUCKET_META[bucket].blurb}</div>

      {counts.reachedNotBooked > 0 && (
        <div style={{ fontSize: 12, color: "var(--muted)", margin: "-6px 2px 14px" }}>
          {counts.reachedNotBooked} more {counts.reachedNotBooked === 1 ? "lead was" : "leads were"} reached but
          {" "}{counts.reachedNotBooked === 1 ? "has" : "have"} no meeting booked — real progress, so they sit in none of
          the three buckets above rather than being counted as a gap.
        </div>
      )}

      {rows.length === 0 ? (
        <div style={{ color: "var(--muted)", fontSize: 13, padding: "20px 2px" }}>
          Nothing in this bucket{filtersOn ? " for the current filters" : ""}.
        </div>
      ) : (
        <div className="table-card">
          <table className="data-table">
            <thead>
              <tr>
                <th>Contact</th>
                <th>Company</th>
                <th>Product line</th>
                <th title="Ranked first in this table — an untouched Strong Signal lead outranks a freshly failed Bad Lead">Tier</th>
                <th>Attempts</th>
                <th>Last outcome</th>
                <th>Last touched</th>
                <th>Upload</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((s) => {
                const c = s.contact;
                const latest = s.attempts.length
                  ? s.attempts.reduce((a, b) => (String(a.at) > String(b.at) ? a : b))
                  : null;
                const meta = latest ? dispositionMetaFor(latest.outcome, dispositions) : null;
                return (
                  <tr key={c.id}>
                    <td style={{ whiteSpace: "nowrap" }}>{c.fullName || <span style={{ color: "var(--muted)" }}>—</span>}</td>
                    <td>{c.company || <span style={{ color: "var(--muted)" }}>—</span>}</td>
                    <td>
                      {c.category ? (
                        <span className="status-pill" style={{ background: CATEGORY_META[c.category].bg, color: CATEGORY_META[c.category].color }}>
                          {CATEGORY_META[c.category].label}
                        </span>
                      ) : hasLeadData(c) ? (
                        <span style={{ color: "var(--muted)" }}>—</span>
                      ) : (
                        <span className="status-pill" style={{ background: "#FFF7E5", color: "#8A5A00" }} title="Detection never scored this contact on any upload they appeared in">
                          No lead data
                        </span>
                      )}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {c.tier ? (
                        <span className="status-pill" style={{ background: TIER_META[c.tier].bg, color: TIER_META[c.tier].color }}>
                          {TIER_META[c.tier].label}
                        </span>
                      ) : (
                        <span style={{ color: "var(--muted)" }}>—</span>
                      )}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }} title={`${s.attemptCount} logged attempt(s); manual counters: ${c.callCount || 0} calls, ${c.emailCount || 0} emails`}>
                      {s.attemptCount > 0 ? `${s.attemptCount}×` : (c.callCount || 0) + (c.emailCount || 0) > 0 ? `${(c.callCount || 0) + (c.emailCount || 0)}× (untracked)` : "—"}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {latest && meta ? (
                        <span className="status-pill" style={{ background: meta.bg, color: meta.color }}>
                          {ATTEMPT_CHANNEL_META[latest.channel].icon} {meta.label}
                        </span>
                      ) : (
                        <span style={{ color: "var(--muted)" }}>—</span>
                      )}
                    </td>
                    <td style={{ whiteSpace: "nowrap", color: "var(--muted)", fontSize: 12 }}>
                      {s.lastAt ? new Date(s.lastAt).toLocaleDateString() : "Never"}
                    </td>
                    <td style={{ color: "var(--muted)", fontSize: 12 }} title={c.sourceFiles.join(", ")}>
                      {c.sourceFiles.length === 1 ? c.sourceFiles[0] : `${c.sourceFiles.length} files`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {totalPages > 1 && (
            <div className="pager">
              <button className="btn btn-sm btn-secondary" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Prev</button>
              <span>Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, rows.length)} of {rows.length} · Page {page} of {totalPages}</span>
              <button className="btn btn-sm btn-secondary" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
