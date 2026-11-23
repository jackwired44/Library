// Made-up example run, shown only when the page cannot reach any connector (preview, or opened
// outside claude.ai). Every name, company and id here is invented.
(function (root) {
  const R = root.SH_RULES;
  const O = root.SH_CONFIG.DEFAULTS.outcomes;
  function build() {
    const seqs = {
      demoTarget: { id: "demoTarget", name: "Example: Dynamics email-only", numSteps: 3, steps: [{ position: 1, type: "auto_email" }, { position: 2, type: "auto_email" }, { position: 3, type: "auto_email" }], delivered: 0 },
      demoCall: { id: "demoCall", name: "Example: Dynamics call sequence", numSteps: 6, steps: [{ position: 1, type: "call" }, { position: 2, type: "auto_email" }, { position: 3, type: "call" }, { position: 4, type: "call" }, { position: 5, type: "auto_email" }, { position: 6, type: "linkedin_step_message" }] },
      demoOld: { id: "demoOld", name: "Example: Spring ERP push", numSteps: 6, steps: [{ position: 1, type: "auto_email" }, { position: 2, type: "call" }, { position: 3, type: "auto_email" }, { position: 4, type: "linkedin_step_connect" }, { position: 5, type: "call" }, { position: 6, type: "auto_email" }] },
    };
    let i = 0;
    const mk = (first, last, company, domain, title, extra) => {
      i += 1;
      const id = `demo${i}`;
      return {
        apolloId: id, uid: id, name: `${first} ${last}`, first, last, email: `${first.toLowerCase()}@${domain}`, emailStatus: "verified", title,
        company, companyKey: R.companyKey(company), domain, stageId: null, unsubscribed: false, callOptedOut: false,
        customText: "Evaluating Dynamics 365 Business Central", addedAt: "2026-11-20T15:00:00Z",
        enrollments: [{ sequenceId: "demoTarget", sequenceName: seqs.demoTarget.name, status: "paused", addedAt: "2026-11-20T15:00:00Z", apolloContactId: id }],
        calls: [], emails: [], meetings: [], deals: [], outlookMail: [], clientFlags: [], sourceChecks: {}, link: "https://app.apollo.io/",
        targetContactId: id, targetMailbox: "demo-mailbox", ...extra,
      };
    };
    const call = (o) => ({ id: `k${Math.random()}`, contactId: "", durationSec: 0, summary: "", trellusUrl: null, at: "2026-10-14T16:00:00Z", caller: "Jack Snellgrove", sequenceId: "demoCall", sequenceName: seqs.demoCall.name, step: 1, ...o });
    const people = [
      mk("Avery", "Lindqvist", "Northwind Fabrication", "northwind-fab.example", "Controller", {}),
      mk("Bruno", "Okafor", "Harbor Point Logistics", "harborpoint.example", "CFO", { emails: [{ id: "e1", sequenceId: "demoOld", delivered: true, status: "completed", subject: "ERP that fits", at: "2026-04-02T14:00:00Z" }],
        enrollments: [{ sequenceId: "demoTarget", status: "paused" }, { sequenceId: "demoOld", sequenceName: seqs.demoOld.name, status: "finished", reason: "Completed", step: 4, addedAt: "2026-04-01T14:00:00Z", finishedAt: "2026-04-25T14:00:00Z" }],
        calls: [call({ outcomeId: O.noAnswer, sequenceId: "demoOld", sequenceName: seqs.demoOld.name, step: 2, at: "2026-04-06T15:00:00Z" })] }),
      mk("Carmen", "Ruiz", "Ridgeline Dental Group", "ridgeline-dental.example", "Office Manager", { calls: [call({ outcomeId: O.meetingBooked })] }),
      mk("Dmitri", "Volkov", "Copperleaf Foods", "copperleaf.example", "VP Finance", { calls: [call({ outcomeId: O.noAnswer, trellusUrl: "https://app.trellus.ai/transcripts?id=example", summary: "Jack spoke with Dmitri about replacing their accounting system. Dmitri said they are evaluating Business Central and asked for pricing." })] }),
      mk("Elena", "Marsh", "Bluewater Marine Supply", "bluewater-marine.example", "Owner", { calls: [call({ outcomeId: O.gatekeeper, summary: "The receptionist said Elena was out and took Jack's number." })] }),
      mk("Felix", "Tran", "Summit Ridge Builders", "summitridge.example", "Controller", { calls: [call({ outcomeId: null, durationSec: 262 })] }),
      mk("Grace", "Holloway", "Ironclad Tooling", "ironclad-tool.example", "CFO", { emails: [{ id: "e2", delivered: true, replied: true, subject: "Quick question", at: "2026-09-12T13:00:00Z" }] }),
      mk("Hiro", "Tanaka", "Ironclad Tooling", "ironclad-tool.example", "IT Manager", {}),
      mk("Imani", "Brooks", "Lakeshore Credit Union", "lakeshore-cu.example", "COO", { stageId: "6a73bd6b59c987000cc2c50c" }),
      mk("Jonas", "Weber", "Granite Peak Health", "granitepeak.example", "Director of Finance", { enrollments: [{ sequenceId: "demoTarget", status: "paused" }, { sequenceId: "demoCall", sequenceName: seqs.demoCall.name, status: "active", step: 3, addedAt: "2026-11-10T14:00:00Z" }] }),
      mk("Kara", "Nguyen", "Pinecrest Hospitality", "pinecrest-hosp.example", "Accounting Manager", { customText: "Needs Microsoft 365 licensing for 60 users" }),
      mk("Liam", "Foster", "Orchard Valley Farms", "orchardvalley.example", "Owner", { customText: "" }),
      mk("Maya", "Castillo", "Tidewater Engineering", "tidewater-eng.example", "CFO", {}),
      mk("Noah", "Bennett", "Tidewater Engineering", "tidewater-eng.example", "Project Coordinator", {}),
      mk("Olivia", "Park", "Silverline Freight", "silverline.example", "Controller", { unsubscribed: true }),
      mk("Pablo", "Ibarra", "Cedar Hollow Clinics", "cedarhollow.example", "CEO", { emails: [{ id: "e3", delivered: true, status: "completed", subject: "ERP that fits", at: "2026-08-01T13:00:00Z" }, { id: "e4", delivered: true, opened: true, status: "completed", subject: "Following up", at: "2026-08-05T13:00:00Z" }] }),
      mk("Quinn", "Adler", "Westgate Machining", "westgate-mach.example", "Controller", { calls: [call({ outcomeId: O.wrongNumber })] }),
      mk("Rosa", "Delgado", "Brightwater Schools Foundation", "brightwater.example", "Finance Director", {}),
    ];
    const companySources = [
      { companyKey: R.companyKey("Maya's colleague"), domain: "tidewater-eng.example", kind: "contact", reason: "Echo sales meeting \"Tidewater: Discovery\"", source: "Echo", at: "2026-07-15T15:00:00Z", link: "https://echo.example/m/demo" },
      { companyKey: R.companyKey("Brightwater Schools Foundation"), domain: "brightwater.example", kind: "client", reason: "HubSpot lifecycle stage is Customer (Brightwater Schools Foundation)", source: "HubSpot", link: "https://app.hubspot.com/" },
    ];
    const colleagues = [{ apolloId: "demoC1", name: "Sam Ortiz", email: "sam@summitridge.example", domain: "summitridge.example", company: "Summit Ridge Builders", companyKey: R.companyKey("Summit Ridge Builders"), enrollments: [{ sequenceId: "demoCall", sequenceName: seqs.demoCall.name, status: "active", step: 2 }], calls: [], emails: [], link: "https://app.apollo.io/" }];
    return {
      meta: { id: "demo", kind: "run", demo: true, targetId: "demoTarget", targetName: seqs.demoTarget.name, product: "dynamics", targetEmailOnly: true, targetEverSent: false, status: "done", createdAt: "2026-11-23T15:00:00Z", phase: "done", notChecked: [], counts: { people: people.length } },
      sequences: seqs, people, colleagues, companySources, callSequences: { dynamics: ["demoCall"], m365: [] },
    };
  }
  root.SH_DEMO = { build };
})(typeof window !== "undefined" ? window : globalThis);
