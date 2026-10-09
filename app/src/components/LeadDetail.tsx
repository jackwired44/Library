// One lead's whole record: what it was when it arrived, what the platform
// made of it, and where it stands in Apollo now.
//
// Per Jack: "see a lead what sequence its been through how many times its
// been called its active sequence status in the sequence step wise the
// history of dispositions and most importantly the outcome and if a lead
// has never been contacted or reached … connect the lead with its csv and
// the date month wise it was received … see if any notes indicate dates
// and we can view the raw note form and scanned note form to cross
// reference", and "i want to see this all from before and after view so i
// know where everything stands."
//
// Read-only except for two things that are a person's to decide — the
// status override and the target sequence. Everything else comes from the
// scans and the Apollo sync, and an edit here would be overwritten by the
// next upload of the same person.
import { useEffect, useMemo, useState } from "react";
import StatusPill from "./StatusPill";
import {
  STATUS_META, STATUS_ORDER, derivedStatus, statusOf, type LeadStatus,
} from "../lib/leadStatus";
import {
  LEAD_SOURCE_META, noteSegments, type StoredLead,
} from "../lib/leadStore";
import { SYNC_STALE_DAYS } from "../lib/apolloSync";
import { realSteps, type ApolloFunnel } from "../lib/apolloFunnel";
import { isIntentDate, soonestUpcoming, type NoteDate } from "../lib/noteDates";
import { loadRawNotes, type RawNotes } from "../lib/rawNotes";
import { FUNCTION_META, LEVEL_META, titleFunction, titleLevel } from "../lib/titleLevel";
import { CONTACT_META, contactStateOf } from "../lib/leadStatus";
import {
  employeeCountOf, normalizeCompanyKey, profileForCompany, type CompanyProfile,
} from "../lib/companyProfiles";

const muted = { color: "var(--muted)" } as const;
const dash = <span style={muted}>&mdash;</span>;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 10, padding: "3px 0", fontSize: 13 }}>
      <div style={{ width: 118, flexShrink: 0, ...muted }}>{label}</div>
      <div style={{ minWidth: 0, wordBreak: "break-word", flex: 1 }}>{children}</div>
    </div>
  );
}

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 600, ...muted }}>{title}</div>
        {sub && <div style={{ fontSize: 11.5, ...muted }}>{sub}</div>}
      </div>
      {children}
    </div>
  );
}

const monthOf = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" });

/** Wrap every date the extractor found, so the raw text shows where each
 *  date sits. Built from the extracted wording, never re-detected here. */
function Highlighted({ text, dates }: { text: string; dates: NoteDate[] }) {
  const parts = useMemo(() => {
    const words = [...new Set(dates.map((d) => d.text).filter(Boolean))]
      .sort((a, b) => b.length - a.length)
      .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    if (!words.length) return [text];
    return text.split(new RegExp(`(${words.join("|")})`, "gi"));
  }, [text, dates]);
  return (
    <>
      {parts.map((p, i) => (i % 2 === 1
        ? <mark key={i} style={{ background: "#FFF1B8", padding: "0 2px", borderRadius: 3 }}>{p}</mark>
        : <span key={i}>{p}</span>))}
    </>
  );
}

/** A sequence's steps as a row of boxes: done, where they are, ahead. */
const TASK_TYPE_LABEL: Record<string, string> = {
  call: "Call", phone_call: "Call", outreach_manual_email: "Manual email",
  action_item: "Action item", linkedin_step_connect: "LinkedIn connect",
  linkedin_step_message: "LinkedIn message", linkedin_step_view_profile: "LinkedIn view",
  linkedin_step_interact_post: "LinkedIn post",
};

function StepTrack({ funnel, step, status }: { funnel: ApolloFunnel | undefined; step: number | null; status: string }) {
  const steps = realSteps(funnel);
  if (!steps.length) {
    return <span style={{ fontSize: 12, ...muted }}>{step != null ? `step ${step}` : "step not reported"}</span>;
  }
  return (
    <div style={{ display: "flex", gap: 3, flexWrap: "wrap", marginTop: 3 }}>
      {steps.map((s) => {
        const here = step === s.position;
        const done = step != null && s.position < step;
        const ended = here && status !== "active";
        return (
          <span
            key={s.position}
            title={`Step ${s.position}: ${s.type}${here ? (ended ? " — stopped here" : " — on this step now") : ""}`}
            style={{
              fontSize: 10.5, padding: "2px 6px", borderRadius: 4, whiteSpace: "nowrap",
              border: `1px solid ${here ? (ended ? "#B5443B" : "var(--accent)") : "var(--border)"}`,
              background: here ? (ended ? "#FBEAE8" : "#E3F3F1") : done ? "var(--surface-sunken)" : "transparent",
              color: here ? (ended ? "#B5443B" : "var(--accent)") : done ? "var(--ink)" : "var(--muted)",
              fontWeight: here ? 700 : 400,
            }}
          >
            {s.position} {s.type.replace(/_/g, " ").replace(/^auto /, "")}
          </span>
        );
      })}
    </div>
  );
}

/** The one line that says whether anyone has ever got through. */
function contactFlag(lead: StoredLead): { label: string; tone: "bad" | "warn" | "good" | "none"; sub: string } {
  const a = lead.apollo;
  const s = statusOf(lead);
  if (!a) return { label: "Not checked against Apollo", tone: "none", sub: "No sync has matched this lead yet, so contact history is unknown." };
  if (s === "meeting") return { label: "Meeting booked", tone: "good", sub: `${a.callCount} call${a.callCount === 1 ? "" : "s"} logged.` };
  if (s === "not-interested") return { label: "Reached — not interested", tone: "bad", sub: `${a.callCount} call${a.callCount === 1 ? "" : "s"} logged.` };
  if (s === "reached") return { label: "Reached", tone: "good", sub: `A real conversation is on record across ${a.callCount} call${a.callCount === 1 ? "" : "s"}.` };
  if (a.callCount > 0) return { label: "Never reached", tone: "warn", sub: `Called ${a.callCount} time${a.callCount === 1 ? "" : "s"} — no answer, voicemail or gatekeeper every time.` };
  if (a.sequences.length) return { label: "Never called", tone: "warn", sub: "In Apollo and in a sequence, but no call has been logged." };
  return { label: "Never contacted", tone: "warn", sub: "In Apollo, never in a sequence, never called." };
}

const TONE: Record<string, { color: string; bg: string }> = {
  good: { color: "#0A66C2", bg: "#EAF3FC" },
  bad: { color: "#B5443B", bg: "#FBEAE8" },
  warn: { color: "#9A5B22", bg: "#FBF0E2" },
  none: { color: "#5C7379", bg: "#F1F5F5" },
};

export default function LeadDetail({
  lead, companyProfiles, onClose, sequenceNames = [], onSetPlan, onSetStatus,
  onPrev, onNext, position, funnels = [], companyLeads = [], onOpenLead,
}: {
  lead: StoredLead;
  companyProfiles: CompanyProfile[];
  onClose: () => void;
  sequenceNames?: string[];
  /** Set or clear (null) the Apollo sequence this lead is headed for. */
  onSetPlan?: (sequence: string | null) => void;
  /** Hand-set the status, or null to hand it back to the evidence. */
  onSetStatus?: (status: LeadStatus | null) => void;
  onPrev?: () => void;
  onNext?: () => void;
  /** e.g. "12 of 340" — where this record sits in the list it came from. */
  position?: string;
  /** For drawing each sequence's steps. */
  funnels?: ApolloFunnel[];
  /** Every stored lead at the same company, this one included. */
  companyLeads?: StoredLead[];
  /** Open another lead's profile in place. */
  onOpenLead?: (key: string) => void;
}) {
  // Arrow keys step through the list, Escape closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowDown" || e.key === "ArrowRight") onNext?.();
      else if (e.key === "ArrowUp" || e.key === "ArrowLeft") onPrev?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onNext, onPrev]);

  // The raw note lives in its own store; fetch it for this lead only.
  const [raw, setRaw] = useState<RawNotes | null | "loading">("loading");
  useEffect(() => {
    let live = true;
    setRaw("loading");
    loadRawNotes(lead.key).then((r) => { if (live) setRaw(r ?? null); }).catch(() => { if (live) setRaw(null); });
    return () => { live = false; };
  }, [lead.key]);

  const [showAllRaw, setShowAllRaw] = useState(false);
  const [showLogged, setShowLogged] = useState(false);

  const a = lead.apollo;
  const scanned = noteSegments(lead.notes);
  const profile = companyProfiles.length
    ? profileForCompany(companyProfiles, normalizeCompanyKey(lead.company), [lead.email])
    : null;
  const employees = employeeCountOf(profile);
  const syncAge = a ? Math.floor((Date.now() - new Date(a.syncedAt).getTime()) / 86400000) : null;
  const outcomes = a ? Object.entries(a.outcomes).sort((x, y) => y[1] - x[1]) : [];
  const dates = lead.noteDates ?? [];
  const intentDates = dates.filter(isIntentDate);
  const loggedDates = dates.filter((d) => !isIntentDate(d));
  const next = soonestUpcoming(dates);
  const flag = contactFlag(lead);
  const tone = TONE[flag.tone];
  const files = lead.fileSeen?.length ? lead.fileSeen : lead.sourceFiles.map((f) => ({ file: f, at: "" }));
  const rawSegs = raw && raw !== "loading" ? raw.segments : [];
  const rawRows = raw && raw !== "loading" ? raw.rows ?? [] : [];

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(8,30,34,0.18)", zIndex: 60 }}>
      <div
        role="dialog"
        aria-label={`Lead: ${lead.contact || lead.company}`}
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "absolute", top: 0, right: 0, bottom: 0, width: "min(980px, 98vw)",
          background: "var(--bg-surface, #fff)", borderLeft: "1px solid var(--border)",
          boxShadow: "-8px 0 24px rgba(8,30,34,0.12)", display: "flex", flexDirection: "column",
        }}
      >
        {/* ---- header: who, where they stand, and the controls ---- */}
        <div style={{ padding: "12px 18px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
            {(onPrev || onNext) && (
              <>
                <button className="btn btn-sm btn-ghost" onClick={onPrev} disabled={!onPrev} title="Previous (↑)">↑ Prev</button>
                <button className="btn btn-sm btn-ghost" onClick={onNext} disabled={!onNext} title="Next (↓)">↓ Next</button>
                {position && <span style={{ fontSize: 12, ...muted }}>{position}</span>}
              </>
            )}
            <div style={{ flex: 1 }} />
            <button className="btn btn-sm btn-ghost" onClick={onClose} title="Close (Esc)">Close</button>
          </div>
          <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 240 }}>
              <div style={{ fontSize: 18, fontWeight: 600 }}>{lead.company || "No company"}</div>
              <div style={{ fontSize: 13, ...muted }}>{[lead.contact, lead.title].filter(Boolean).join(" · ") || "—"}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                <StatusPill lead={lead} />
                {onSetStatus && (
                  <select
                    className="field" style={{ fontSize: 12, width: 200 }} value=""
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "__auto") onSetStatus(null);
                      else if (v) onSetStatus(v as LeadStatus);
                    }}
                    aria-label="Change status"
                  >
                    <option value="">Change status…</option>
                    {STATUS_ORDER.filter((x) => x !== statusOf(lead)).map((x) => (
                      <option key={x} value={x}>{STATUS_META[x].label}</option>
                    ))}
                    {lead.statusOverride && <option value="__auto">Back to automatic ({STATUS_META[derivedStatus(lead)].label})</option>}
                  </select>
                )}
              </div>
            </div>
            {/* The outcome first: has anyone ever got through? */}
            <div style={{ minWidth: 240, maxWidth: 340, padding: "8px 12px", borderRadius: 10, background: tone.bg, borderLeft: `3px solid ${tone.color}` }}>
              <div style={{ fontWeight: 700, color: tone.color }}>{flag.label}</div>
              <div style={{ fontSize: 12, marginTop: 2 }}>{flag.sub}</div>
              {next && (
                <div style={{ fontSize: 12, marginTop: 6 }}>
                  📅 Next date in the notes: <b>{next.iso}</b>{next.about ? ` (${next.about})` : ""}
                </div>
              )}
            </div>
          </div>
        </div>

        <div style={{ overflowY: "auto", flex: 1, padding: "4px 18px 24px" }}>
          {/* ---- BEFORE → AFTER ---- */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 16, marginTop: 12 }}>
            <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>Before</div>
              <div style={{ fontSize: 11.5, ...muted, marginBottom: 8 }}>The lead exactly as it arrived.</div>
              <Row label="Received">
                {lead.receivedOn
                  ? <><b>{monthOf(lead.receivedOn)}</b> <span style={muted}>· {lead.receivedOn} (the file's own date)</span></>
                  : <><b>{monthOf(lead.firstSeenAt)}</b> <span style={muted}>· first uploaded {lead.firstSeenAt.slice(0, 10)} — the file states no date of its own</span></>}
              </Row>
              <Row label={`In ${files.length} file${files.length === 1 ? "" : "s"}`}>
                {files.length === 0 ? dash : files.map((f) => (
                  <div key={f.file} style={{ fontSize: 12 }}>
                    {f.file}{f.at && <span style={muted}> · uploaded {f.at.slice(0, 10)}</span>}
                  </div>
                ))}
              </Row>
              <div style={{ fontSize: 11.5, ...muted, margin: "8px 0 4px" }}>
                Raw note{rawSegs.length > 1 ? `s (${rawSegs.length} versions)` : ""}
              </div>
              {raw === "loading" ? <div style={{ fontSize: 12, ...muted }}>Loading…</div>
                : rawSegs.length === 0 ? (
                  <div style={{ fontSize: 12, ...muted }}>
                    No raw note stored. Leads uploaded before raw notes were kept show only the scanned version — re-upload the file to fill this in.
                  </div>
                ) : (
                  <>
                    {(showAllRaw ? rawSegs : rawSegs.slice(0, 1)).map((sg, i) => (
                      <div key={i} style={{ marginBottom: 8 }}>
                        <div style={{ fontSize: 11, ...muted }}>{sg.at.slice(0, 10)} · {sg.file}</div>
                        <div style={{
                          fontSize: 12.5, whiteSpace: "pre-wrap", background: "var(--surface-sunken)",
                          borderRadius: 8, padding: "6px 8px", maxHeight: showAllRaw ? 260 : 340, overflowY: "auto",
                        }}>
                          <Highlighted text={sg.text} dates={dates} />
                        </div>
                      </div>
                    ))}
                    {rawSegs.length > 1 && (
                      <button className="btn btn-sm btn-ghost" onClick={() => setShowAllRaw((v) => !v)}>
                        {showAllRaw ? "Show newest only" : `Show all ${rawSegs.length} versions`}
                      </button>
                    )}
                  </>
                )}
              {/* Every other column of the CSV, per file it arrived in. */}
              {rawRows.length > 0 && (
                <>
                  <div style={{ fontSize: 11.5, ...muted, margin: "10px 0 4px" }}>
                    CSV row{rawRows.length > 1 ? `s (${rawRows.length} uploads)` : ""} as uploaded
                  </div>
                  {rawRows.map((rw, i) => (
                    <details key={i} open={i === 0} style={{ marginBottom: 6 }}>
                      <summary style={{ fontSize: 11.5, cursor: "pointer", ...muted }}>{rw.at.slice(0, 10)} · {rw.file}</summary>
                      <table className="viz-table" style={{ width: "100%", fontSize: 12, marginTop: 4 }}>
                        <tbody>
                          {Object.entries(rw.fields).map(([k, v]) => (
                            <tr key={k}>
                              <td style={{ ...muted, whiteSpace: "nowrap", paddingRight: 10, verticalAlign: "top" }}>{k}</td>
                              <td style={{ wordBreak: "break-word" }}>{v}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </details>
                  ))}
                </>
              )}
            </div>

            <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>After</div>
              <div style={{ fontSize: 11.5, ...muted, marginBottom: 8 }}>What the platform made of it, and where it stands now.</div>
              <Row label="Scanned by">{LEAD_SOURCE_META[lead.source].label}</Row>
              <Row label="Verdict">
                {lead.tier || dash}{lead.score !== null && <span style={muted}> · score {lead.score}</span>}
              </Row>
              <Row label="Product line">{lead.productArea || dash}</Row>
              <Row label="Status">
                <StatusPill lead={lead} />
                {lead.statusOverride && <span style={{ fontSize: 11.5, ...muted }}> set by hand {lead.statusOverride.at.slice(0, 10)}</span>}
              </Row>
              <Row label="Headed for">
                {lead.plan ? (
                  <>
                    <b>{lead.plan.sequence}</b>
                    <span style={{ fontSize: 12, ...muted }}>
                      {" · "}{lead.plan.status === "exported"
                        ? `exported ${(lead.plan.exportedAt || "").slice(0, 10)}`
                        : `queued ${lead.plan.by === "manual" ? "by hand" : "by rule"} ${lead.plan.assignedAt.slice(0, 10)}`}
                    </span>
                  </>
                ) : <span style={muted}>not queued</span>}
                {onSetPlan && (
                  <div>
                    <select
                      className="field" style={{ width: 230, fontSize: 12, marginTop: 4 }} value=""
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === "__remove") onSetPlan(null);
                        else if (v) onSetPlan(v);
                      }}
                      aria-label="Set the sequence this lead is headed for"
                    >
                      <option value="">{lead.plan ? "Move to…" : "Queue into…"}</option>
                      {sequenceNames.filter((n) => n !== lead.plan?.sequence).map((n) => <option key={n} value={n}>{n}</option>)}
                      {lead.plan && <option value="__remove">Remove from queue</option>}
                    </select>
                  </div>
                )}
              </Row>
              <div style={{ fontSize: 11.5, ...muted, margin: "8px 0 4px" }}>
                Scanned note{scanned.length > 1 ? `s (${scanned.length}, newest first)` : ""}
              </div>
              {scanned.length === 0 ? dash : scanned.map((sg, i) => (
                <div key={i} style={{ fontSize: 12.5, background: "var(--surface-sunken)", borderRadius: 8, padding: "6px 8px", marginBottom: 6 }}>
                  {sg.date && <div style={{ fontSize: 11, ...muted }}>{sg.date}</div>}
                  {sg.text}
                </div>
              ))}
            </div>
          </div>

          {/* ---- Apollo: sequences step by step, calls, dispositions ---- */}
          <Section
            title="Apollo"
            sub={!a ? "not synced" : `synced ${syncAge === 0 ? "today" : `${syncAge} day${syncAge === 1 ? "" : "s"} ago`}${syncAge !== null && syncAge > SYNC_STALE_DAYS ? " — stale" : ""}`}
          >
            {!a ? (
              <div style={{ fontSize: 13, ...muted }}>
                No Apollo sync has matched this lead. That is not the same as never contacted — import a sync on
                All leads to fill this in.
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                    Sequences ({a.sequences.length})
                  </div>
                  {a.sequences.length === 0 ? <div style={{ fontSize: 13, ...muted }}>Never in a sequence.</div>
                    : a.sequences.map((sq, i) => (
                      <div key={i} style={{ marginBottom: 10 }}>
                        <div style={{ fontSize: 13 }}>
                          <b>{sq.name}</b>{" "}
                          <span style={{ color: sq.status === "active" ? "var(--accent)" : "var(--muted)", fontSize: 12 }}>
                            {sq.status === "active" ? "● active" : sq.status}
                            {sq.step != null ? ` · ${sq.status === "active" ? "on" : "stopped at"} step ${sq.step}` : ""}
                          </span>
                        </div>
                        {(sq.addedAt || sq.lastDoneAt) && (
                          <div style={{ fontSize: 12, ...muted }} title="Dated from Apollo task due dates — Apollo returns no separate enrolment or completion stamp.">
                            {sq.addedAt && <>Added {sq.addedAt}</>}
                            {sq.addedAt && sq.lastDoneAt && " · "}
                            {sq.lastDoneAt && <>last task done {sq.lastDoneAt}</>}
                          </div>
                        )}
                        <StepTrack funnel={funnels.find((f) => f.name === sq.name)} step={sq.step} status={sq.status} />
                      </div>
                    ))}
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                    Emails sent: {a.emailCount === undefined ? <span style={{ fontWeight: 400, ...muted }}>not in this sync</span> : a.emailCount}
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                    Calls: {a.callCount === 0 ? "none" : a.callCount}
                    {a.lastCallAt && <span style={{ fontWeight: 400, ...muted }}> · last {a.lastCallAt.slice(0, 10)}</span>}
                  </div>
                  {outcomes.length > 0 && (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                      {outcomes.map(([name, n]) => (
                        <span key={name} style={{ fontSize: 11.5, padding: "2px 8px", borderRadius: 999, background: "var(--surface-sunken)" }}>
                          {name} <b>×{n}</b>
                        </span>
                      ))}
                    </div>
                  )}
                  <div style={{ fontSize: 12, fontWeight: 600, margin: "6px 0 4px" }}>Disposition history</div>
                  {a.history?.length ? (
                    <div style={{ maxHeight: 220, overflowY: "auto", borderLeft: "2px solid var(--border)", paddingLeft: 10 }}>
                      {a.history.map((h, i) => (
                        <div key={i} style={{ fontSize: 12.5, padding: "2px 0" }}>
                          <span style={{ ...muted, fontVariantNumeric: "tabular-nums" }}>{h.at}</span>{" "}
                          <b>{h.outcome}</b>
                          {h.sequence && <span style={muted}> · {h.sequence}{h.step != null ? ` step ${h.step}` : ""}</span>}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, ...muted }}>
                      {a.callCount ? "The sync carried totals only, no dated call history." : "No calls to show."}
                    </div>
                  )}
                  {a.tasks && a.tasks.length > 0 && (
                    <>
                      <div style={{ fontSize: 12, fontWeight: 600, margin: "10px 0 4px" }} title="Dated by each task's due date; Apollo does not return when a task was actually completed.">
                        Sequence tasks ({a.tasks.length})
                      </div>
                      <div style={{ maxHeight: 220, overflowY: "auto", borderLeft: "2px solid var(--border)", paddingLeft: 10 }}>
                        {a.tasks.map((t, i) => (
                          <div key={i} style={{ fontSize: 12.5, padding: "2px 0" }}>
                            <span style={{ ...muted, fontVariantNumeric: "tabular-nums" }}>{t.at}</span>{" "}
                            <b>{TASK_TYPE_LABEL[t.type] ?? t.type}</b>{" "}
                            <span style={{ color: t.status === "completed" ? "var(--accent)" : "var(--muted)" }}>{t.status === "scheduled" ? "due" : t.status}</span>
                            {t.sequence && <span style={muted}> · {t.sequence}{t.step != null ? ` step ${t.step}` : ""}</span>}
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </Section>

          {/* ---- dates the notes mention ---- */}
          <Section
            title="Dates in the notes"
            sub={dates.length ? `${intentDates.length} that point at something · ${loggedDates.length} log stamp${loggedDates.length === 1 ? "" : "s"}` : undefined}
          >
            {dates.length === 0 ? (
              <div style={{ fontSize: 13, ...muted }}>No dates mentioned.</div>
            ) : (
              <>
                {intentDates.length === 0 && <div style={{ fontSize: 13, ...muted }}>Only log stamps — nothing forward-looking.</div>}
                {intentDates.map((d, i) => {
                  const upcoming = d.iso && d.iso >= new Date().toISOString().slice(0, 10);
                  return (
                    <div key={i} style={{ display: "flex", gap: 10, padding: "4px 0", fontSize: 12.5, borderBottom: "1px solid var(--border)" }}>
                      <div style={{ width: 92, flexShrink: 0, fontVariantNumeric: "tabular-nums", fontWeight: upcoming ? 700 : 400, color: upcoming ? "var(--accent)" : undefined }}>
                        {d.iso ?? d.text}
                      </div>
                      <div style={{ width: 70, flexShrink: 0, ...muted }}>{d.about ?? d.kind}</div>
                      <div style={{ minWidth: 0 }}>
                        <b>{d.text}</b> <span style={muted}>{d.snippet}</span>
                      </div>
                    </div>
                  );
                })}
                {loggedDates.length > 0 && (
                  <button className="btn btn-sm btn-ghost" style={{ marginTop: 4 }} onClick={() => setShowLogged((v) => !v)}>
                    {showLogged ? "Hide" : "Show"} {loggedDates.length} log stamp{loggedDates.length === 1 ? "" : "s"} (when entries were written)
                  </button>
                )}
                {showLogged && loggedDates.map((d, i) => (
                  <div key={i} style={{ fontSize: 12, padding: "2px 0", ...muted }}>
                    {d.iso ?? d.text} — {d.snippet}
                  </div>
                ))}
              </>
            )}
          </Section>

          {/* ---- everyone stored at this company ---- */}
          {companyLeads.length > 1 && (() => {
            const states = companyLeads.map((l) => contactStateOf(l));
            const worked = states.filter((x) => x !== "never" && x !== "unknown").length;
            const made = states.filter((x) => x === "made" || x === "meeting" || x === "no").length;
            const calls = companyLeads.reduce((n, l) => n + (l.apollo?.callCount ?? 0), 0);
            const emails = companyLeads.reduce((n, l) => n + (l.apollo?.emailCount ?? 0), 0);
            return (
              <Section
                title={`At ${lead.company || "this company"}`}
                sub={`${companyLeads.length} contacts · ${worked} worked · ${made} reached · ${calls} calls · ${emails} emails`}
              >
                <table className="viz-table" style={{ fontSize: 12.5 }}>
                  <thead>
                    <tr><th>Contact</th><th>Position</th><th>Contact</th><th>Sequence</th><th style={{ textAlign: "right" }}>Calls</th><th style={{ textAlign: "right" }}>Emails</th><th>Last outcome</th></tr>
                  </thead>
                  <tbody>
                    {companyLeads.map((l, i) => {
                      const cm = CONTACT_META[states[i]];
                      const sq = l.apollo?.sequences[0];
                      const me = l.key === lead.key;
                      return (
                        <tr key={l.key}
                            onClick={() => !me && onOpenLead?.(l.key)}
                            style={{ cursor: me || !onOpenLead ? "default" : "pointer", background: me ? "var(--bg-selected, #e6f3f1)" : undefined }}>
                          <td><b>{l.contact || "—"}</b>{me && <span style={muted}> (this lead)</span>}</td>
                          <td title={l.title}>{l.title || <span style={muted}>—</span>}</td>
                          <td><span style={{ fontSize: 11, fontWeight: 600, padding: "1px 7px", borderRadius: 999, color: cm.color, background: cm.bg, whiteSpace: "nowrap" }}>{cm.label}</span></td>
                          <td>{sq ? `${sq.name} · ${sq.status}${sq.step != null ? ` · step ${sq.step}` : ""}` : <span style={muted}>—</span>}</td>
                          <td style={{ textAlign: "right" }}>{l.apollo ? l.apollo.callCount : "—"}</td>
                          <td style={{ textAlign: "right" }}>{l.apollo?.emailCount ?? "—"}</td>
                          <td>{l.apollo?.lastOutcome || <span style={muted}>—</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </Section>
            );
          })()}

          {/* ---- company and contact ---- */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
            <Section title="Company">
              <Row label="Industry">{profile?.industry || <span style={muted}>not enriched</span>}</Row>
              <Row label="Employees">
                {employees === null ? <span style={muted}>unknown — the 10-employee floor has not been applied</span> : employees.toLocaleString()}
              </Row>
              <Row label="Website">
                {profile?.website ? <a href={profile.website} target="_blank" rel="noreferrer">{profile.website}</a> : dash}
              </Row>
            </Section>
            <Section title="Contact">
              <Row label="Position">
                {lead.title || <span style={muted}>no title</span>}
                <span style={{ fontSize: 11.5, ...muted }}>
                  {" · "}{LEVEL_META[titleLevel(lead.title)].label} · {FUNCTION_META[titleFunction(lead.title)].label}
                </span>
              </Row>
              <Row label="Email">{lead.email ? <a href={`mailto:${lead.email}`}>{lead.email}</a> : dash}</Row>
              <Row label="Work phone">{lead.phone || dash}</Row>
              <Row label="Mobile">{lead.mobilePhone || dash}</Row>
              <Row label="Seen">{lead.timesSeen}× · first {lead.firstSeenAt.slice(0, 10)} · last {lead.lastSeenAt.slice(0, 10)}</Row>
            </Section>
          </div>
        </div>
      </div>
    </div>
  );
}
