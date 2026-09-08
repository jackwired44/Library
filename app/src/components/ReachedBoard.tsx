import { useState } from "react";
import {
  ATTEMPT_CHANNEL_META,
  attemptsForContact,
  summarizeAttempts,
  daysSinceLastAttempt,
  untrackedCount,
  type AttemptChannel,
  type OutreachAttempt,
} from "../lib/outreachAttempts";
import { dispositionMetaFor, isConnectedDisposition, type CustomDisposition } from "../lib/dispositions";
import DispositionOptions from "./DispositionOptions";
import type { Contact } from "../lib/contacts";

// The "mini board" — every attempt made against one contact, newest first,
// with the outcome of each. This is the view the per-contact history
// exists for; the Contacts table's Reached column is its one-line summary.
export default function ReachedBoard({
  contact,
  attempts,
  dispositions,
  onLog,
  onRemove,
}: {
  contact: Contact;
  attempts: OutreachAttempt[];
  dispositions: CustomDisposition[];
  onLog: (input: { channel: AttemptChannel; outcome?: string; note?: string }) => void;
  onRemove: (id: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [channel, setChannel] = useState<AttemptChannel>("call");
  const [outcome, setOutcome] = useState<string>("none");
  const [note, setNote] = useState("");

  const list = attemptsForContact(attempts, contact.id);
  const summary = summarizeAttempts(list, (o) => isConnectedDisposition(o, dispositions));
  const days = daysSinceLastAttempt(list);
  const untracked = untrackedCount(contact, list);

  function submit() {
    onLog({ channel, outcome, note: note.trim() || undefined });
    setNote("");
    setOutcome("none");
    setAdding(false);
  }

  return (
    <div className="reached-board">
      <div className="reached-head">
        <span className="section-label" style={{ margin: 0 }}>Reached status</span>
        <button className="btn btn-sm btn-secondary" onClick={() => setAdding((v) => !v)}>
          {adding ? "Cancel" : "+ Log attempt"}
        </button>
      </div>

      <div className="metric-row reached-metrics">
        <div className="metric">
          <div className="metric-value">{summary.total}</div>
          <div className="metric-label">Attempts</div>
        </div>
        <div className="metric">
          <div className="metric-value">{summary.reached}</div>
          <div className="metric-label">Reached them</div>
        </div>
        <div className="metric">
          <div className="metric-value">{summary.calls}</div>
          <div className="metric-label">Calls</div>
        </div>
        <div className="metric">
          <div className="metric-value">{days === null ? "—" : days === 0 ? "Today" : `${days}d`}</div>
          <div className="metric-label">Since last</div>
        </div>
      </div>

      {adding && (
        <div className="reached-form">
          <select className="field" value={channel} onChange={(e) => setChannel(e.target.value as AttemptChannel)} aria-label="Channel">
            {(Object.keys(ATTEMPT_CHANNEL_META) as AttemptChannel[]).map((c) => (
              <option key={c} value={c}>{ATTEMPT_CHANNEL_META[c].icon} {ATTEMPT_CHANNEL_META[c].label}</option>
            ))}
          </select>
          <select className="field" value={outcome} onChange={(e) => setOutcome(e.target.value)} aria-label="Outcome">
            <DispositionOptions dispositions={dispositions} />
          </select>
          <input
            className="field"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="What happened? (optional)"
            style={{ flex: "1 1 180px" }}
          />
          <button className="btn btn-sm btn-primary" onClick={submit}>Log it</button>
        </div>
      )}

      {list.length === 0 ? (
        <div className="reached-empty">
          No attempts logged yet.
          {untracked > 0 && (
            <> This contact carries <strong>{untracked}</strong> call{untracked === 1 ? "" : "s"}/email{untracked === 1 ? "" : "s"} counted
            before attempt history existed — those have no date or outcome recorded, so they can&rsquo;t be shown here.</>
          )}
        </div>
      ) : (
        <>
          <ol className="attempt-list">
            {list.map((a) => {
              const meta = dispositionMetaFor(a.outcome, dispositions);
              const reached = isConnectedDisposition(a.outcome, dispositions);
              return (
                <li key={a.id} className="attempt-row">
                  <span className="attempt-dot" data-reached={reached ? "yes" : "no"} aria-hidden="true" />
                  <span className="attempt-when">
                    {new Date(a.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </span>
                  <span className="attempt-ch">{ATTEMPT_CHANNEL_META[a.channel].icon}</span>
                  <span className="status-pill" style={{ background: meta.bg, color: meta.color }}>{meta.label}</span>
                  {a.note && <span className="attempt-note" title={a.note}>{a.note}</span>}
                  <button
                    className="btn btn-sm btn-ghost attempt-del"
                    onClick={() => onRemove(a.id)}
                    title="Remove this attempt from the history"
                  >
                    ✕
                  </button>
                </li>
              );
            })}
          </ol>
          {untracked > 0 && (
            <div className="reached-empty" style={{ marginTop: 8 }}>
              Plus <strong>{untracked}</strong> counted before attempt history existed — no date or outcome was recorded for those.
            </div>
          )}
        </>
      )}
    </div>
  );
}
