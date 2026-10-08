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
  lead, companyProfiles, onClose,
}: {
  lead: StoredLead;
  companyProfiles: CompanyProfile[];
  onClose: () => void;
}) {
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
    <div className="notes-popover-backdrop" onClick={onClose}>
      <div
        className="panel"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 620, width: "92vw", maxHeight: "86vh", overflowY: "auto", margin: "4vh auto" }}
      >
        <div className="panel-head" style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600 }}>{lead.contact || "Unnamed contact"}</div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>
              {[lead.title, lead.company].filter(Boolean).join(" · ") || "—"}
            </div>
          </div>
          <button className="btn btn-sm btn-ghost" onClick={onClose}>Close</button>
        </div>

        <div className="panel-body">
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
