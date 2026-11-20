// Archive → Apollo rules: Apollo's dispositions, contact stages and sequence
// settings as read on APOLLO_RULES_AT, beside what this platform does with
// each. Reference only; nothing here writes to Apollo.
import { APOLLO_RULES_AT, CONTACT_STAGES, OUTCOME_RULES, PLATFORM_RULES, SEQUENCE_RULES, finishesSequence } from "../lib/apolloRules";

const BUCKET = { reached: ["Reached them", "success"], "not-reached": ["Didn't reach them", "neutral"], none: ["No outcome", "warning"] } as const;

export default function ApolloRules() {
  return (
    <div>
      <div className="page-head">
        <div>
          <h2 className="page-title">Apollo rules</h2>
          <div className="page-sub">Your Apollo dispositions, contact stages and sequence settings, read from Apollo on {APOLLO_RULES_AT}, next to what the Vault does with each.</div>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 14 }}>
        <div className="panel-head"><div className="panel-title">Call dispositions</div>
          <div className="panel-sub">Apollo doesn't share its per-disposition automations through the connector, so "In Apollo" is what was seen happen on real contacts.</div></div>
        <div className="panel-body">
          <table className="data-table" aria-label="Dispositions">
            <thead><tr><th>Disposition</th><th>Type</th><th className="num">Calls logged</th><th>In Apollo</th><th>In the Vault</th></tr></thead>
            <tbody>
              {OUTCOME_RULES.map((o) => (
                <tr key={o.id}>
                  <td><strong>{o.name}</strong>{finishesSequence(o.id) && <div><span className="status-pill danger" style={{ marginTop: 4 }}>Ends the sequence</span></div>}</td>
                  <td><span className={`status-pill ${BUCKET[o.bucket][1]}`}>{BUCKET[o.bucket][0]}</span></td>
                  <td className="num">{o.callsLogged.toLocaleString()}</td>
                  <td className="panel-sub" style={{ maxWidth: 260 }}>{o.inApollo}</td>
                  <td style={{ maxWidth: 420 }}><ul style={{ margin: 0, paddingLeft: 16, fontSize: 13 }}>{o.platform.map((p, i) => <li key={i}>{p}</li>)}</ul></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 14 }}>
        <div className="panel-head"><div className="panel-title">The six sequences</div></div>
        <div className="panel-body" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(330px, 1fr))", gap: 12 }}>
          {SEQUENCE_RULES.map((s) => (
            <div key={s.name} data-seq-rule style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><strong>{s.name}</strong><span className="status-pill neutral">{s.owner}</span></div>
              {s.note && <div className="panel-sub" style={{ marginTop: 4 }}>{s.note}</div>}
              <ol style={{ margin: "8px 0", paddingLeft: 18, fontSize: 13 }}>{s.steps.map((st, i) => <li key={i}>{st}</li>)}</ol>
              <div className="panel-sub" style={{ fontSize: 12.5, lineHeight: 1.6 }}>
                Finishes on reply: {s.finishOnReply ? "yes" : "no"} · on interested: {s.finishOnInterested ? "yes" : "no"} · pauses on out of office: {s.pauseOnOutOfOffice ? "yes" : "no"}<br />
                Counts a reply within {s.replyWaitDays} days · same-company reply holds others {s.sameCompanyReplyDelayDays} days<br />
                {s.excludedAccountStages ? `Skips ${s.excludedAccountStages} account stages` : "No account stages skipped"}{s.maxEmailsPerDay ? ` · max ${s.maxEmailsPerDay} emails a day` : ""}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 14 }}>
        <div className="panel-head"><div className="panel-title">Contact stages</div></div>
        <div className="panel-body">
          <table className="data-table" aria-label="Contact stages">
            <thead><tr><th>Stage</th><th>Category</th><th>Notes</th></tr></thead>
            <tbody>{CONTACT_STAGES.map((c) => (
              <tr key={c.id}><td><strong>{c.name}</strong></td><td>{c.category}</td>
                <td className="panel-sub">{c.ignoresTriggers ? "Ignores Apollo's automatic stage triggers; set by hand." : ""}{c.name === "Not Interested" ? " The Vault flags anyone at this stage in a sequence." : ""}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head"><div className="panel-title">Vault rules</div></div>
        <div className="panel-body"><ul style={{ margin: 0, paddingLeft: 18 }}>{PLATFORM_RULES.map((r, i) => <li key={i} style={{ marginBottom: 4 }}>{r}</li>)}</ul></div>
      </div>
    </div>
  );
}
