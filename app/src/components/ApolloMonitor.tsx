// Apollo Monitor — one screen that mirrors the live Apollo account:
// every sequence, the real workflow inside it, how many contacts are
// sitting on each step, and the health of every sending mailbox.
//
// Per Jack: "i want to go in here and see all my sequences how many
// contacts are in which steps and then emails also to view their health
// send rate how many daily sent and know where work is needed or
// attention."
//
// READ-ONLY, deliberately. Every Apollo call behind this view is a read
// and costs no credits. There is no delete control because Apollo exposes
// no sequence-delete API at all (only create and update), and shipping a
// "Delete" button that silently only paused would be worse than not
// having one. See the note rendered at the foot of the sequence panel.
//
// This component owns its own data — it calls Apollo directly rather than
// taking rows as props — because nothing else in the app stores Apollo
// state and threading it through App.tsx would invent a second source of
// truth for data that already lives in Apollo.
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  getMcp,
  describeApolloError,
  resolveApolloHandle,
  fetchMailboxes,
  fetchMailboxStats,
  fetchSequences,
  fetchStepDistribution,
  buildMailboxRows,
  buildInsights,
  summarizeByOwner,
  flagsForSequence,
  isSendingAlias,
  ownerForMailbox,
  stepMeta,
  waitLabel,
  worstSeverity,
  pct,
  WINDOW_DAYS,
  WINDOW_LABEL,
  type AnalyticsWindow,
  type ApolloHandle,
  type ApolloSequence,
  type HealthFlag,
  type Insight,
  type MailboxRow,
  type MailboxStats,
  type Severity,
  type StepDistribution,
} from "../lib/apolloMonitor";
import type { ClaudeMcpNamespace } from "../lib/claudeRuntime";

const SEV_COLOR: Record<Severity, { fg: string; bg: string }> = {
  critical: { fg: "#B5443B", bg: "#FBEAE8" },
  warn: { fg: "#9A6700", bg: "#FFF6E0" },
  info: { fg: "#0A66C2", bg: "#EAF3FC" },
};

function FlagChip({ flag }: { flag: HealthFlag }) {
  const c = SEV_COLOR[flag.severity];
  return (
    <span
      title={flag.detail}
      style={{
        display: "inline-block",
        fontSize: 11,
        fontWeight: 600,
        padding: "2px 7px",
        borderRadius: 999,
        color: c.fg,
        background: c.bg,
        whiteSpace: "nowrap",
      }}
    >
      {flag.label}
    </span>
  );
}

function HealthDot({ severity }: { severity: Severity | null }) {
  const color = severity ? SEV_COLOR[severity].fg : "var(--success, #2CC295)";
  return (
    <span
      aria-hidden
      style={{ display: "inline-block", width: 8, height: 8, borderRadius: 999, background: color, flexShrink: 0 }}
    />
  );
}

function relTime(iso: string | null): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  const days = Math.floor((Date.now() - t) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

export default function ApolloMonitor() {
  const [handle, setHandle] = useState<ApolloHandle | null>(null);
  const [mcp, setMcp] = useState<ClaudeMcpNamespace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [window_, setWindow] = useState<AnalyticsWindow>("last_30_days");
  const [sequences, setSequences] = useState<ApolloSequence[]>([]);
  const [mailboxes, setMailboxes] = useState<MailboxRow[]>([]);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [dists, setDists] = useState<Record<string, StepDistribution | "loading" | { error: string }>>({});
  const [panel, setPanel] = useState<"sequences" | "mailboxes">("sequences");
  const [showIdle, setShowIdle] = useState(false);

  const load = useCallback(async (win: AnalyticsWindow) => {
    setLoading(true);
    setError(null);
    setStatsError(null);
    const m = await getMcp();
    if (!m) {
      setError("Apollo data isn't available in this view — this needs the published app with your Apollo connector attached.");
      setLoading(false);
      return;
    }
    setMcp(m);
    let h: ApolloHandle | null;
    try {
      h = await resolveApolloHandle(m);
    } catch (err) {
      setError(describeApolloError(err));
      setLoading(false);
      return;
    }
    if (!h) {
      setError("Apollo isn't connected — add it in claude.ai Settings → Connectors, then refresh.");
      setLoading(false);
      return;
    }
    setHandle(h);

    try {
      const [boxes, seqs] = await Promise.all([fetchMailboxes(m, h), fetchSequences(m, h)]);
      // Stats are fetched separately and allowed to fail on their own —
      // losing the analytics table shouldn't blank the mailbox roster or
      // the entire sequence list.
      let stats = new Map<string, MailboxStats>();
      try {
        stats = await fetchMailboxStats(m, h, win);
      } catch (err) {
        setStatsError(describeApolloError(err));
      }
      setSequences(seqs);
      setMailboxes(buildMailboxRows(boxes, stats, WINDOW_DAYS[win]));
      setFetchedAt(new Date().toISOString());
    } catch (err) {
      setError(describeApolloError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(window_);
  }, [load, window_]);

  const toggleExpand = useCallback(
    async (seq: ApolloSequence) => {
      if (expanded === seq.id) {
        setExpanded(null);
        return;
      }
      setExpanded(seq.id);
      if (dists[seq.id] || !mcp || !handle) return;
      setDists((p) => ({ ...p, [seq.id]: "loading" }));
      try {
        const d = await fetchStepDistribution(mcp, handle, seq);
        setDists((p) => ({ ...p, [seq.id]: d }));
      } catch (err) {
        setDists((p) => ({ ...p, [seq.id]: { error: describeApolloError(err) } }));
      }
    },
    [expanded, dists, mcp, handle]
  );

  const worked = useMemo(() => sequences.filter((s) => s.delivered > 0 || s.overdueManualTasks > 0), [sequences]);
  const idle = useMemo(() => sequences.filter((s) => s.delivered === 0 && s.overdueManualTasks === 0), [sequences]);

  const seqFlags = useMemo(() => {
    const map: Record<string, HealthFlag[]> = {};
    for (const s of sequences) map[s.id] = flagsForSequence(s);
    return map;
  }, [sequences]);

  const insights: Insight[] = useMemo(
    () => (sequences.length ? buildInsights(sequences, mailboxes) : []),
    [sequences, mailboxes]
  );

  const attention = useMemo(() => {
    const items: { severity: Severity; source: string; flag: HealthFlag }[] = [];
    for (const s of sequences) for (const f of seqFlags[s.id] || []) items.push({ severity: f.severity, source: s.name, flag: f });
    for (const b of mailboxes) for (const f of b.flags) items.push({ severity: f.severity, source: b.email, flag: f });
    const rank: Record<Severity, number> = { critical: 0, warn: 1, info: 2 };
    return items.sort((a, b) => rank[a.severity] - rank[b.severity]);
  }, [sequences, seqFlags, mailboxes]);

  const criticalCount = attention.filter((a) => a.severity === "critical").length;
  const ownerSummaries = useMemo(() => summarizeByOwner(mailboxes), [mailboxes]);

  const sortedSeqs = useMemo(() => {
    const shown = showIdle ? [...worked, ...idle] : worked;
    const rank: Record<string, number> = { critical: 0, warn: 1, info: 2, none: 3 };
    return [...shown].sort((a, b) => {
      const sa = worstSeverity(seqFlags[a.id] || []) ?? "none";
      const sb = worstSeverity(seqFlags[b.id] || []) ?? "none";
      if (rank[sa] !== rank[sb]) return rank[sa] - rank[sb];
      return b.delivered - a.delivered;
    });
  }, [worked, idle, showIdle, seqFlags]);

  return (
    <div>
      <div className="page-head" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18 }}>🛰 Apollo Monitor</h2>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--muted)" }}>
            Live, read-only view of every Apollo sequence and sending mailbox.
            {fetchedAt ? ` As of ${new Date(fetchedAt).toLocaleTimeString()}.` : ""}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <select
            className="field"
            value={window_}
            onChange={(e) => setWindow(e.target.value as AnalyticsWindow)}
            style={{ fontSize: 12 }}
            aria-label="Analytics window"
          >
            {(Object.keys(WINDOW_LABEL) as AnalyticsWindow[]).map((w) => (
              <option key={w} value={w}>{WINDOW_LABEL[w]}</option>
            ))}
          </select>
          <button className="btn btn-secondary btn-sm" onClick={() => void load(window_)} disabled={loading}>
            {loading ? "Loading…" : "↻ Refresh"}
          </button>
        </div>
      </div>

      {error && (
        <div className="panel" style={{ borderColor: SEV_COLOR.critical.fg, marginBottom: 12 }}>
          <div className="panel-body" style={{ color: SEV_COLOR.critical.fg, fontSize: 13 }}>{error}</div>
        </div>
      )}

      {loading && !error && (
        <div className="panel"><div className="panel-body" style={{ fontSize: 13, color: "var(--muted)" }}>Reading Apollo…</div></div>
      )}

      {!loading && !error && sequences.length > 0 && (
        <>
          {/* ---------- Attention ---------- */}
          <div className="panel" style={{ marginBottom: 12 }}>
            <div className="panel-head">
              <strong style={{ fontSize: 13 }}>
                {attention.length === 0 ? "✅ Nothing needs attention" : `🔔 ${attention.length} need${attention.length === 1 ? "s" : ""} attention`}
              </strong>
              {criticalCount > 0 && (
                <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: SEV_COLOR.critical.fg }}>
                  {criticalCount} critical
                </span>
              )}
            </div>
            {attention.length > 0 && (
              <div className="panel-body" style={{ display: "grid", gap: 6 }}>
                {attention.slice(0, 12).map((a, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, alignItems: "baseline", fontSize: 12 }}>
                    <HealthDot severity={a.severity} />
                    <strong style={{ minWidth: 0, flexShrink: 0 }}>{a.source}</strong>
                    <span style={{ color: "var(--muted)" }}>{a.flag.detail}</span>
                  </div>
                ))}
                {attention.length > 12 && (
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>+{attention.length - 12} more below.</div>
                )}
              </div>
            )}
          </div>

          {/* ---------- What's working / what's not ---------- */}
          {insights.length > 0 && (
            <div className="panel" style={{ marginBottom: 12 }}>
              <div className="panel-head"><strong style={{ fontSize: 13 }}>📊 What's working, what's not</strong></div>
              <div className="panel-body" style={{ display: "grid", gap: 10 }}>
                {insights.map((ins, i) => (
                  <div key={i} style={{ fontSize: 12 }}>
                    <div style={{ fontWeight: 600 }}>
                      {ins.kind === "working" ? "✅ " : ins.kind === "broken" ? "⚠️ " : "💡 "}
                      {ins.headline}
                    </div>
                    <div style={{ color: "var(--muted)", marginTop: 2 }}>{ins.detail}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ---------- Panel switch ---------- */}
          <div className="seg" style={{ marginBottom: 10 }}>
            <button className={`seg-btn${panel === "sequences" ? " active" : ""}`} onClick={() => setPanel("sequences")}>
              Sequences ({worked.length})
            </button>
            <button className={`seg-btn${panel === "mailboxes" ? " active" : ""}`} onClick={() => setPanel("mailboxes")}>
              Mailboxes ({mailboxes.filter((m) => isSendingAlias(m.email)).length} sending)
            </button>
          </div>

          {panel === "sequences" && (
            <div className="table-card">
              <table className="data-table" style={{ width: "100%" }}>
                <thead>
                  <tr>
                    <th style={{ width: 28 }} />
                    <th>Sequence</th>
                    <th style={{ textAlign: "right" }}>Steps</th>
                    <th style={{ textAlign: "right" }}>Delivered</th>
                    <th style={{ textAlign: "right" }}>Reply</th>
                    <th style={{ textAlign: "right" }}>Demo</th>
                    <th style={{ textAlign: "right" }}>Overdue</th>
                    <th>Health</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedSeqs.map((s) => {
                    const flags = seqFlags[s.id] || [];
                    const isOpen = expanded === s.id;
                    const dist = dists[s.id];
                    return (
                      <Fragment key={s.id}>
                        <tr
                          onClick={() => void toggleExpand(s)}
                          style={{ cursor: "pointer" }}
                        >
                          <td>{isOpen ? "▾" : "▸"}</td>
                          <td>
                            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                              <HealthDot severity={worstSeverity(flags)} />
                              <span style={{ fontWeight: 600 }}>{s.name}</span>
                            </div>
                            <div style={{ fontSize: 11, color: "var(--muted)" }}>
                              {s.active ? "Active" : "Paused"} · last used {relTime(s.lastUsedAt)}
                            </div>
                          </td>
                          <td style={{ textAlign: "right" }}>{s.numSteps}</td>
                          <td style={{ textAlign: "right" }}>{s.delivered.toLocaleString()}</td>
                          <td style={{ textAlign: "right" }}>{s.delivered ? pct(s.replyRate) : "—"}</td>
                          <td style={{ textAlign: "right", fontWeight: s.demoed > 0 ? 600 : 400 }}>
                            {s.delivered ? `${pct(s.demoRate)} (${s.demoed})` : "—"}
                          </td>
                          <td style={{ textAlign: "right", color: s.overdueManualTasks > 0 ? SEV_COLOR.warn.fg : undefined }}>
                            {s.overdueManualTasks || "—"}
                          </td>
                          <td>
                            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                              {flags.length === 0 ? <span style={{ fontSize: 11, color: "var(--muted)" }}>OK</span> : flags.map((f, i) => <FlagChip key={i} flag={f} />)}
                            </div>
                          </td>
                        </tr>
                        {isOpen && (
                          <tr>
                            <td colSpan={8} style={{ background: "var(--surface-sunken)" }}>
                              <div style={{ padding: "10px 6px" }}>
                                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Workflow</div>
                                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "stretch", marginBottom: 12 }}>
                                  {s.steps.map((step, i) => {
                                    const meta = stepMeta(step.type);
                                    const bucket =
                                      dist && dist !== "loading" && !("error" in dist)
                                        ? dist.buckets.find((b) => b.position === step.position)
                                        : null;
                                    return (
                                      <div key={step.id || i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                        <div
                                          style={{
                                            border: "1px solid var(--border)",
                                            borderRadius: 10,
                                            padding: "6px 10px",
                                            background: "var(--surface)",
                                            minWidth: 120,
                                          }}
                                        >
                                          <div style={{ fontSize: 11, color: "var(--muted)" }}>
                                            Step {step.position} · {waitLabel(step)}
                                          </div>
                                          <div style={{ fontSize: 12, fontWeight: 600 }}>
                                            {meta.icon} {meta.label}
                                          </div>
                                          {bucket && (
                                            <div style={{ fontSize: 11, marginTop: 3 }}>
                                              <strong>{bucket.waiting}</strong> waiting
                                              {bucket.overdue > 0 && (
                                                <span style={{ color: SEV_COLOR.warn.fg }}> · {bucket.overdue} overdue</span>
                                              )}
                                            </div>
                                          )}
                                        </div>
                                        {i < s.steps.length - 1 && <span style={{ color: "var(--muted)" }}>→</span>}
                                      </div>
                                    );
                                  })}
                                </div>

                                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Contacts by step</div>
                                {dist === "loading" && <div style={{ fontSize: 12, color: "var(--muted)" }}>Reading open tasks…</div>}
                                {dist && typeof dist === "object" && "error" in dist && (
                                  <div style={{ fontSize: 12, color: SEV_COLOR.critical.fg }}>{dist.error}</div>
                                )}
                                {dist && typeof dist === "object" && !("error" in dist) && (
                                  <div style={{ fontSize: 12, color: "var(--muted)" }}>
                                    {dist.totalWaiting === 0 ? (
                                      "No contacts are sitting on an open step right now."
                                    ) : (
                                      <>
                                        <strong>{dist.totalWaiting.toLocaleString()}{dist.truncated ? "+" : ""}</strong> contact
                                        {dist.totalWaiting === 1 ? "" : "s"} waiting
                                        {dist.totalOverdue > 0 && <> · <strong style={{ color: SEV_COLOR.warn.fg }}>{dist.totalOverdue.toLocaleString()} overdue</strong></>}
                                        {dist.truncated && " (capped — more open tasks than this view pages through)"}
                                      </>
                                    )}
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
              <div className="panel-body" style={{ fontSize: 11, color: "var(--muted)", borderTop: "1px solid var(--border)" }}>
                {idle.length > 0 && (
                  <button className="btn btn-ghost btn-sm" onClick={() => setShowIdle((v) => !v)}>
                    {showIdle ? "Hide" : "Show"} {idle.length} never-used sequence{idle.length === 1 ? "" : "s"}
                  </button>
                )}
                <div style={{ marginTop: 6 }}>
                  Read-only. Apollo exposes no sequence-delete API — creating and pausing are possible, deleting is only
                  available in Apollo itself, so there's no delete control here rather than one that quietly does something else.
                </div>
              </div>
            </div>
          )}

          {panel === "mailboxes" && (
            <>
              {statsError && (
                <div className="panel" style={{ marginBottom: 10, borderColor: SEV_COLOR.warn.fg }}>
                  <div className="panel-body" style={{ fontSize: 12, color: SEV_COLOR.warn.fg }}>
                    Send volumes couldn't be read ({statsError}) — the roster below is accurate, but the numbers are missing
                    rather than zero.
                  </div>
                </div>
              )}
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
                {ownerSummaries.map((sum) => (
                  <div key={sum.owner.key} className="kpi" style={{ minWidth: 170 }}>
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>{sum.owner.label}</div>
                    <div style={{ fontSize: 18, fontWeight: 700 }}>
                      {sum.aliasCount}/{sum.owner.expectedAliasCount}
                      <span style={{ fontSize: 11, fontWeight: 400, color: "var(--muted)" }}> aliases connected</span>
                    </div>
                    <div style={{ fontSize: 11, color: sum.missingCount > 0 ? SEV_COLOR.warn.fg : "var(--muted)" }}>
                      {sum.missingCount > 0 ? `${sum.missingCount} not connected` : "All connected"} · {sum.totalSent.toLocaleString()} sent
                    </div>
                  </div>
                ))}
              </div>
              <div className="table-card">
                <table className="data-table" style={{ width: "100%" }}>
                  <thead>
                    <tr>
                      <th>Mailbox</th>
                      <th>Owner</th>
                      <th style={{ textAlign: "right" }}>Sent</th>
                      <th style={{ textAlign: "right" }}>Per day</th>
                      <th style={{ textAlign: "right" }}>Limit/day</th>
                      <th style={{ textAlign: "right" }}>Bounce</th>
                      <th style={{ textAlign: "right" }}>Reply</th>
                      <th>Synced</th>
                      <th>Health</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mailboxes.map((b) => {
                      const owner = ownerForMailbox(b.email);
                      const alias = isSendingAlias(b.email);
                      return (
                        <tr key={b.id} style={{ opacity: alias ? 1 : 0.62 }}>
                          <td>
                            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                              <HealthDot severity={worstSeverity(b.flags)} />
                              <span style={{ fontWeight: alias ? 600 : 400 }}>{b.email}</span>
                            </div>
                            <div style={{ fontSize: 11, color: "var(--muted)" }}>
                              {alias ? "Sending alias" : b.isDefault ? "Primary mailbox" : "Not an outbound alias"}
                            </div>
                          </td>
                          <td style={{ fontSize: 12 }}>{owner?.label || "—"}</td>
                          <td style={{ textAlign: "right" }}>{b.stats ? b.stats.sent.toLocaleString() : "—"}</td>
                          <td style={{ textAlign: "right" }}>{b.sendsPerDay === null ? "—" : b.sendsPerDay.toFixed(1)}</td>
                          <td style={{ textAlign: "right" }}>{b.stats ? b.stats.dailyLimit.toLocaleString() : "—"}</td>
                          <td style={{ textAlign: "right" }}>{b.bounceRate === null ? "—" : pct(b.bounceRate)}</td>
                          <td style={{ textAlign: "right" }}>{b.replyRate === null ? "—" : pct(b.replyRate)}</td>
                          <td style={{ fontSize: 12 }}>{relTime(b.lastSyncedAt)}</td>
                          <td>
                            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                              {b.flags.length === 0 ? <span style={{ fontSize: 11, color: "var(--muted)" }}>OK</span> : b.flags.map((f, i) => <FlagChip key={i} flag={f} />)}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
