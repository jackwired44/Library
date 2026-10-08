// One lead's whole record, in one place.
//
// Per Jack: "the status of eveery lead i upload here … i need to store this
// so i can build marketing cmapaigns and know every lead i have ever hit
// and how many times the status and wehre it stands."
//
// Everything here is READ-ONLY. A lead's facts come from the scan that
// produced it and from Apollo; there is no field on this screen a person
// should be hand-editing, because an edit here would be silently overwritten
// by the next upload of the same person (the store merges, it does not
// branch). Outreach that IS hand-tracked lives on Contact, which is a
// different record with its own editor.
import { useEffect } from "react";
import StatusPill from "./StatusPill";
import {
  STATUS_META, STATUS_ORDER, derivedStatus, statusOf, type LeadStatus,
} from "../lib/leadStatus";
import {
  LEAD_SOURCE_META, noteSegments, outcomeSummary, type StoredLead,
} from "../lib/leadStore";
import { SYNC_STALE_DAYS } from "../lib/apolloSync";
import {
  employeeCountOf, normalizeCompanyKey, profileForCompany, type CompanyProfile,
} from "../lib/companyProfiles";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 10, padding: "4px 0", fontSize: 13 }}>
      <div style={{ width: 130, flexShrink: 0, color: "var(--muted)" }}>{label}</div>
      <div style={{ minWidth: 0, wordBreak: "break-word" }}>{children}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--muted)", marginBottom: 4 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

const dash = <span style={{ color: "var(--muted)" }}>&mdash;</span>;

export default function LeadDetail({
  lead, companyProfiles, onClose, sequenceNames = [], onSetPlan, onSetStatus,
  onPrev, onNext, position,
}: {
  lead: StoredLead;
  companyProfiles: CompanyProfile[];
  onClose: () => void;
  /** Sequences to offer in the "headed for" picker. */
  sequenceNames?: string[];
  /** Set or clear (null) the Apollo sequence this lead is headed for.
   *  Absent where the caller does not manage the queue. */
  onSetPlan?: (sequence: string | null) => void;
  /** Hand-set the status, or null to hand it back to the evidence. */
  onSetStatus?: (status: LeadStatus | null) => void;
  /** Step through the list the record was opened from. */
  onPrev?: () => void;
  onNext?: () => void;
  /** e.g. "12 of 340" — where this record sits in that list. */
  position?: string;
}) {
  // Arrow keys step through the list, Escape closes — working a few
  // hundred leads one by one should not need the mouse for every move.
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

  const a = lead.apollo;
  const segments = noteSegments(lead.notes);
  const profile = companyProfiles.length
    ? profileForCompany(companyProfiles, normalizeCompanyKey(lead.company), [lead.email])
    : null;
  const employees = employeeCountOf(profile);
  const syncAge = a
    ? Math.floor((Date.now() - new Date(a.syncedAt).getTime()) / 86400000)
    : null;
  const outcomes = a ? Object.entries(a.outcomes).sort((x, y) => y[1] - x[1]) : [];

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(8,30,34,0.18)", zIndex: 60,
    }}>
      {/* A side panel rather than a centred modal: the list stays visible
          beside it, which is the point when stepping through leads. */}
      <div
        role="dialog"
        aria-label={`Lead: ${lead.contact || lead.company}`}
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "absolute", top: 0, right: 0, bottom: 0, width: "min(560px, 96vw)",
          background: "var(--bg-surface, #fff)", borderLeft: "1px solid var(--border)",
          boxShadow: "-8px 0 24px rgba(8,30,34,0.12)", display: "flex", flexDirection: "column",
        }}
      >
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
            {(onPrev || onNext) && (
              <>
                <button className="btn btn-sm btn-ghost" onClick={onPrev} disabled={!onPrev} title="Previous (↑)">↑ Prev</button>
                <button className="btn btn-sm btn-ghost" onClick={onNext} disabled={!onNext} title="Next (↓)">↓ Next</button>
                {position && <span style={{ fontSize: 12, color: "var(--muted)" }}>{position}</span>}
              </>
            )}
            <div style={{ flex: 1 }} />
            <button className="btn btn-sm btn-ghost" onClick={onClose} title="Close (Esc)">Close</button>
          </div>
          <div style={{ fontSize: 17, fontWeight: 600 }}>{lead.company || "No company"}</div>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>
            {[lead.contact, lead.title].filter(Boolean).join(" · ") || "—"}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <StatusPill lead={lead} />
            {onSetStatus && (
              <select
                className="field"
                style={{ fontSize: 12, width: 190 }}
                value=""
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
          {/* The two things that matter most at a glance. */}
          <div style={{ display: "flex", gap: 18, marginTop: 10, fontSize: 12.5 }}>
            <div>
              <div className="section-label" style={{ marginBottom: 2 }}>Sequence</div>
              {!a ? <span style={{ color: "var(--muted)" }}>not synced</span>
                : a.sequences.length === 0 ? "Not in a sequence"
                : a.sequences.map((sq, i) => (
                  <div key={i}>
                    <b>{sq.name}</b>
                    <span style={{ color: "var(--muted)" }}> · {sq.status}{sq.step != null ? ` · step ${sq.step}` : ""}</span>
                  </div>
                ))}
            </div>
            <div>
              <div className="section-label" style={{ marginBottom: 2 }}>Calls</div>
              {!a ? <span style={{ color: "var(--muted)" }}>not synced</span>
                : a.callCount === 0 ? "Not called"
                : <><b>{a.callCount}</b>{a.lastOutcome ? <span style={{ color: "var(--muted)" }}> · last: {a.lastOutcome}</span> : null}</>}
            </div>
          </div>
        </div>

        <div className="panel-body" style={{ overflowY: "auto", flex: 1 }}>
          {/* The one editable thing on this screen, and deliberately so: the
              target sequence is a plan, not a fact from the scan, so it is
              the person's to set — and it survives every re-upload. */}
          <Section title="Headed for">
            {lead.plan ? (
              <Row label="Sequence">
                <b>{lead.plan.sequence}</b>
                <span style={{ color: "var(--muted)", fontSize: 12 }}>
                  {" · "}{lead.plan.status === "exported"
                    ? `exported ${(lead.plan.exportedAt || "").slice(0, 10)}`
                    : `queued ${lead.plan.by === "manual" ? "by hand" : "by rule"} ${lead.plan.assignedAt.slice(0, 10)}`}
                </span>
              </Row>
            ) : (
              <Row label="Sequence"><span style={{ color: "var(--muted)" }}>not queued</span></Row>
            )}
            {onSetPlan && (
              <Row label="Change">
                <select
                  className="field"
                  style={{ width: 240 }}
                  value=""
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "__remove") onSetPlan(null);
                    else if (v) onSetPlan(v);
                  }}
                  aria-label="Set the sequence this lead is headed for"
                >
                  <option value="">{lead.plan ? "Move to…" : "Queue into…"}</option>
                  {sequenceNames.filter((n) => n !== lead.plan?.sequence).map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                  {lead.plan && <option value="__remove">Remove from queue</option>}
                </select>
              </Row>
            )}
          </Section>

          <Section title="Contact">
            <Row label="Email">{lead.email ? <a href={`mailto:${lead.email}`}>{lead.email}</a> : dash}</Row>
            <Row label="Work phone">{lead.phone || dash}</Row>
            <Row label="Mobile">{lead.mobilePhone || dash}</Row>
          </Section>

          <Section title="Company">
            <Row label="Name">{lead.company || dash}</Row>
            <Row label="Industry">{profile?.industry || <span style={{ color: "var(--muted)" }}>not enriched</span>}</Row>
            <Row label="Employees">
              {employees === null
                ? <span style={{ color: "var(--muted)" }}>unknown &mdash; the size floor has not been applied to this lead</span>
                : employees.toLocaleString()}
            </Row>
            <Row label="Website">
              {profile?.website
                ? <a href={profile.website} target="_blank" rel="noreferrer">{profile.website}</a>
                : dash}
            </Row>
          </Section>

          <Section title="How it scanned">
            <Row label="Scanner">{LEAD_SOURCE_META[lead.source].label}</Row>
            <Row label="Tier">{lead.tier || dash}</Row>
            <Row label="Product line">{lead.productArea || dash}</Row>
            <Row label="Score">{lead.score === null ? dash : lead.score}</Row>
          </Section>

          {/* Every note this person has ever carried, newest first. The
              table row shows only the newest; this is the reason the store
              combines rather than overwrites — 634 of 635 repeat uploads
              carried genuinely different text. */}
          <Section title={`Notes (${segments.length})`}>
            {segments.length === 0 ? dash : segments.map((s, i) => (
              <div key={i} style={{
                padding: "6px 8px", marginBottom: 4, fontSize: 13,
                background: "var(--surface-sunken)", borderRadius: 8,
              }}>
                {s.date && <div style={{ fontSize: 11, color: "var(--muted)" }}>{s.date}</div>}
                {s.text}
              </div>
            ))}
          </Section>

          <Section title="Apollo">
            {!a ? (
              <div style={{ fontSize: 13, color: "var(--muted)" }}>
                No Apollo record for this lead. That is not the same as never contacted &mdash;
                it means a sync has not matched them yet.
              </div>
            ) : (
              <>
                <Row label="Synced">
                  {syncAge === 0 ? "today" : `${syncAge} day${syncAge === 1 ? "" : "s"} ago`}
                  {syncAge !== null && syncAge > SYNC_STALE_DAYS && (
                    <span style={{ color: "#B5443B" }}> &mdash; stale</span>
                  )}
                </Row>
                <Row label="Sequences">
                  {a.sequences.length === 0 ? <span style={{ color: "var(--muted)" }}>none</span> : (
                    <div>
                      {a.sequences.map((s, i) => (
                        <div key={i} style={{ marginBottom: 2 }}>
                          {s.name}
                          <span style={{ color: s.status === "active" ? "var(--accent)" : "var(--muted)" }}>
                            {" · "}{s.status}{s.step != null ? ` · step ${s.step}` : ""}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </Row>
                <Row label="Calls">{a.callCount === 0 ? "never dialled" : a.callCount.toLocaleString()}</Row>
                {outcomes.length > 0 && (
                  <Row label="Outcomes">
                    <div>{outcomes.map(([name, n]) => <div key={name}>{name} &times;{n}</div>)}</div>
                  </Row>
                )}
                {a.lastCallAt && (
                  <Row label="Last call">
                    {a.lastCallAt.slice(0, 10)}{a.lastOutcome ? ` · ${a.lastOutcome}` : ""}
                  </Row>
                )}
                {!outcomes.length && a.callCount > 0 && (
                  <Row label="Outcomes">{outcomeSummary(a) || dash}</Row>
                )}
              </>
            )}
          </Section>

          <Section title="Provenance">
            <Row label="First seen">{lead.firstSeenAt.slice(0, 10)}</Row>
            <Row label="Last seen">{lead.lastSeenAt.slice(0, 10)}</Row>
            <Row label="Uploads">{lead.timesSeen}</Row>
            <Row label="Files">
              {lead.sourceFiles.length === 0 ? dash : (
                <div>{lead.sourceFiles.map((f) => <div key={f} style={{ fontSize: 12 }}>{f}</div>)}</div>
              )}
            </Row>
          </Section>
        </div>
      </div>
    </div>
  );
}
