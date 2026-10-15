// Home: check where every stored lead stands in Apollo.
//
// Per Jack: "the leads get uploaded here and are checked lead by lead in
// apollo / create a button to do it by 100 by one or all ... but need home
// page access for this". The run itself lives in App, so it keeps going
// while you move to another view; this panel only starts, stops and reports.
// Read-only against Apollo, free (contacts_search), and — per "no calls or
// downloads" — never changes call counts or what a download leaves out.
import RateLimitNote from "./RateLimitNote";
import { useMemo } from "react";
import type { StoredLead } from "../lib/leadStore";
import type { CheckProgress } from "../lib/apolloLive";
import type { RosterIndex } from "../lib/apolloRoster";
import { apolloStandingOf, STATUS_META as STANDING_META, STATUS_ORDER as STANDING_ORDER, type Status as Standing } from "./ApolloStatus";
import { verdictOf } from "../lib/leadStatus";

/** A lead checked this recently is not looked up again unless asked. */
export const RECHECK_AFTER_DAYS = 7;

/** Who to look up next: never-checked (or stale) leads, Strong Signal first,
 *  then the most recently seen. */
export function leadsDueForApollo(leads: StoredLead[], now = Date.now(), includeRecent = false): StoredLead[] {
  const cutoff = new Date(now - RECHECK_AFTER_DAYS * 86_400_000).toISOString();
  const rank = (l: StoredLead) => (verdictOf(l.tier) === "strong" ? 0 : verdictOf(l.tier) === "review" ? 1 : 2);
  return leads
    .filter((l) => includeRecent || !(l.apolloCheckedAt && l.apolloCheckedAt > cutoff))
    .sort((a, b) => rank(a) - rank(b) || (b.lastSeenAt || "").localeCompare(a.lastSeenAt || ""));
}

export default function ApolloSyncPanel({ leads, apolloIndex = null, progress, error, onRun, onStop, onOpenLeads }: {
  leads: StoredLead[];
  apolloIndex?: RosterIndex | null;
  progress: CheckProgress | null;
  error: string;
  onRun: (targets: StoredLead[]) => void;
  onStop: () => void;
  onOpenLeads: () => void;
}) {
  // The same six answers All leads and In Apollo show, from the same
  // function — so Home, All leads and In Apollo can never disagree. Before
  // this Home counted only live checks and ignored leads matched from the
  // pulled Apollo uploads or an imported sync.
  const stats = useMemo(() => {
    const by = Object.fromEntries(STANDING_ORDER.map((k) => [k, 0])) as Record<Standing, number>;
    for (const l of leads) by[apolloStandingOf(l, apolloIndex)]++;
    const inApollo = by.active + by.finished + by.reached + by.none;
    return { by, inApollo, known: leads.length - by.unchecked, needs: by.finished + by.none + by.out };
  }, [leads, apolloIndex]);
  const due = useMemo(() => leadsDueForApollo(leads), [leads]);
  const running = !!progress && !progress.finished;
  const fmt = (n: number) => n.toLocaleString();
  const mins = (n: number) => Math.max(1, Math.round(n / 240));
  const hours = (n: number) => (n <= 400 ? "under an hour" : `${Math.ceil(n / 400)} hours`);

  return (
    <div className="panel" aria-label="Apollo status" style={{ marginBottom: 14 }}>
      <div className="panel-head" style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <strong>Where every lead stands in Apollo</strong>
        <span className="muted" style={{ fontSize: 12 }}>Read-only lookup, no credits. Results save on each lead.</span>
      </div>
      <div className="panel-body">
        <div className="metric-row" style={{ marginBottom: 12 }}>
          <div className="metric" title="Leads whose Apollo standing is known: checked live, or matched from Apollo uploads or a sync."><div className="metric-label">Known in Apollo terms</div><div className="metric-value">{fmt(stats.known)}<span className="muted" style={{ fontSize: 13 }}> / {fmt(leads.length)}</span></div></div>
          <div className="metric"><div className="metric-label">In Apollo</div><div className="metric-value">{fmt(stats.inApollo)}</div></div>
          <div className="metric"><div className="metric-label">{STANDING_META.active.label}</div><div className="metric-value">{fmt(stats.by.active)}</div></div>
          <div className="metric"><div className="metric-label">Ended (never / reached)</div><div className="metric-value">{fmt(stats.by.finished)}<span className="muted" style={{ fontSize: 13 }}> / {fmt(stats.by.reached)}</span></div></div>
          <div className="metric"><div className="metric-label">Needs a sequence</div><div className="metric-value" style={{ color: "#B5443B" }}>{fmt(stats.needs)}</div></div>
          <div className="metric"><div className="metric-label">{STANDING_META.unchecked.label}</div><div className="metric-value">{fmt(stats.by.unchecked)}</div></div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {running ? (
            <button className="btn btn-secondary" onClick={onStop}>Stop</button>
          ) : (
            <>
              <button className="btn btn-primary" disabled={!due.length} onClick={() => onRun(due.slice(0, 100))}>
                Check next {fmt(Math.min(100, due.length))}
              </button>
              <button className="btn btn-secondary" disabled={!due.length} onClick={() => onRun(due.slice(0, 400))}
                      title="Apollo allows 400 lookups an hour, so this is one hour's worth.">
                Check next {fmt(Math.min(400, due.length))}
              </button>
              <button className="btn btn-ghost" disabled={!due.length} onClick={() => onRun(due)}
                      title={`${fmt(due.length)} due at 400 an hour is about ${hours(due.length)}. It pauses at each hourly cap; run it again after. Stop keeps everything already read.`}>
                Check all {fmt(due.length)} due
              </button>
            </>
          )}
          <button className="btn btn-ghost" onClick={onOpenLeads}>See them in All leads →</button>
          <span className="muted" style={{ fontSize: 12 }}>One lead at a time: open it in All leads and press Check in Apollo.</span>
        </div>
        {(progress || error) && (
          <div style={{ marginTop: 10, fontSize: 12.5 }} aria-label="Apollo check progress">
            {progress && <>
              {progress.finished ? "Done:" : "Checking…"} <b>{fmt(progress.done)}</b> of {fmt(progress.total)}
              {" · "}<b>{fmt(progress.found)}</b> in Apollo · {fmt(progress.notFound)} not in Apollo
              {progress.skipped > 0 && <> · {fmt(progress.skipped)} skipped (no email or full name)</>}
              {progress.errors > 0 && <span style={{ color: "#B5443B" }}> · {progress.errors} failed{progress.lastError ? `: ${progress.lastError}` : ""}</span>}
                <RateLimitNote progress={progress} />
              {running && progress.total - progress.done > 240 && <span className="muted"> · about {progress.total - progress.done > 400 ? `${hours(progress.total - progress.done)} at Apollo's hourly cap` : `${mins(progress.total - progress.done)} min`} left</span>}
            </>}
            {error && <span style={{ color: "#B5443B" }}> Apollo check stopped: {error}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
