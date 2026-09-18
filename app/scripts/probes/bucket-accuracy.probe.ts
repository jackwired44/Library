// Do the four buckets mean what they claim, and do the metrics reconcile?
//
// Every case below carries the bucket it SHOULD land in, derived from the
// documented rules in CLAUDE.md — not from whatever the engine happens to
// return. That is the whole point: this measures the engine against the
// spec, so a disagreement is a finding rather than a rubber stamp.
//
//   signal   Strong Signal — real, qualified buying intent
//   mention  Needs review  — product named, no qualifying intent
//   dq       Bad Leads     — matched, then a cross-cutting Auto-DQ fired
//   nosignal Non Relevant  — no Dynamics/M365/licensing language at all
import { scanParsedFiles, QUALIFY_THRESHOLD, type ParsedFile } from "../../src/lib/detection";

type Bucket = "signal" | "mention" | "dq" | "nosignal";
interface Case { id: string; group: string; want: Bucket; why: string; comments: string; company?: string; email?: string }

const HEAD = ["First Name", "Last Name", "Title", "Company", "Email", "Phone", "Comments"];
let n = 0;
const row = (c: Case) => ({
  "First Name": `F${++n}`, "Last Name": `L${n}`, Title: "IT Director",
  Company: c.company ?? `Case ${c.id} Inc`,
  Email: c.email ?? `p${n}@case${n}corp.com`,
  Phone: `(312) 555-${1000 + n}`, Comments: c.comments,
});

const CASES: Case[] = [
  // ---- A. Strong Signal: a product plus real intent -------------------
  { id: "A1", group: "Strong Signal", want: "signal", why: "BC + count + partner", comments: "Dynamics 365 Business Central for 40 users, bringing in an implementation partner this year." },
  { id: "A2", group: "Strong Signal", want: "signal", why: "hot signal: Google->Microsoft", comments: "We are migrating from Google Workspace to Microsoft 365 and need an MSP to run it." },
  { id: "A3", group: "Strong Signal", want: "signal", why: "hot signal: Document Intelligence", comments: "Evaluating Azure Document Intelligence for invoice extraction." },
  { id: "A4", group: "Strong Signal", want: "signal", why: "Azure billing via CSP partner", comments: "Looking for a CSP partner to route our Azure billing through." },
  { id: "A5", group: "Strong Signal", want: "signal", why: "licensing count at threshold", comments: `Service-Microsoft 365 Business Standard-${QUALIFY_THRESHOLD} users renewal coming up.` },
  { id: "A6", group: "Strong Signal", want: "signal", why: "security design language", comments: "We need help with security architecture and hardening design across the tenant." },
  { id: "A7", group: "Strong Signal", want: "signal", why: "D365 Sales + count + consultant", comments: "Dynamics 365 Sales CRM for 30 users, want a consultant to lead the rollout." },

  // ---- B. Needs review: named, but nothing qualifying -----------------
  { id: "B1", group: "Needs review", want: "mention", why: "bare product mention", comments: "They use Dynamics 365." },
  { id: "B2", group: "Needs review", want: "mention", why: "bare BC mention, no intent", comments: "Currently on Business Central." },
  { id: "B3", group: "Needs review", want: "mention", why: "passing reference", comments: "Mentioned Dynamics 365 once in passing on the call." },
  { id: "B4", group: "Needs review", want: "mention", why: "M365 stated as fact", comments: "We use Microsoft 365 here." },
  { id: "B5", group: "Needs review", want: "mention", why: "tightened: bare Power BI no longer qualifies", comments: "Would like better Power BI dashboards and reporting." },
  { id: "B6", group: "Needs review", want: "nosignal", why: "by design: bare Fabric is not a hit at all, so no row is produced", comments: "Someone asked about Microsoft Fabric." },
  { id: "B7", group: "Needs review", want: "nosignal", why: "by design: generic modernization without partner language is not a hit at all", comments: "Our legacy system needs modernizing at some point, budget this year." },

  // ---- C. Bad Leads: product present, then Auto-DQ --------------------
  { id: "C1", group: "Bad Leads", want: "dq", why: "single seat/freelancer", comments: "Dynamics 365 Business Central, but it is just me, a single user, freelancer." },
  { id: "C2", group: "Bad Leads", want: "dq", why: "explicit rejection", comments: "We looked at Dynamics 365 Business Central for 40 users. Not interested, please unsubscribe." },
  { id: "C3", group: "Bad Leads", want: "dq", why: "happy with current provider", comments: "Microsoft 365 for 60 users but we are happy with our current provider and locked in." },
  { id: "C4", group: "Bad Leads", want: "dq", why: "basic support/login issue", comments: "Microsoft 365 password reset, I am locked out of my account and need a login fix." },
  { id: "C5", group: "Bad Leads", want: "dq", why: "wants Microsoft direct", comments: "Microsoft 365 for 50 users, we want to work with Microsoft directly, not a reseller." },
  { id: "C6", group: "Bad Leads", want: "dq", why: "small one-off / free advice", comments: "Dynamics 365 Business Central question, just a quick project, no budget, want to pick your brain." },
  { id: "C7", group: "Bad Leads", want: "dq", why: `sub-threshold seat count (<${QUALIFY_THRESHOLD})`, comments: "Microsoft 365 Business Premium for 4 users." },
  { id: "C8", group: "Bad Leads", want: "dq", why: "CRM opportunity notes, not a fresh lead", comments: "Nicole Vargas is the owner of this opportunity and Partner: SIS LLC. Interest in Purview to support SOC 2 and improve overall security posture. Continued executive engagement will be key to advancing the sales cycle." },
  { id: "C9", group: "Bad Leads", want: "dq", why: "CRM metadata only", comments: "F1 / Company Tenant Partner" },
  { id: "C10", group: "Bad Leads", want: "dq", why: "competitor by name", comments: "Dynamics 365 Business Central for 40 users with a partner.", company: "Summit Managed Services LLC" },
  { id: "C11", group: "Bad Leads", want: "dq", why: "personal email, weak content", comments: "Asked about Microsoft 365.", email: "someone@gmail.com" },

  // ---- D. Non Relevant: no product/licensing language at all ----------
  { id: "D1", group: "Non Relevant", want: "nosignal", why: "unrelated business", comments: "We cater weddings across the tri-state area." },
  { id: "D2", group: "Non Relevant", want: "nosignal", why: "empty comments", comments: "" },
  { id: "D3", group: "Non Relevant", want: "nosignal", why: "generic pleasantry", comments: "Left a voicemail, will try again next week." },

  // ---- E. Boundary cases: the semantically interesting ones -----------
  { id: "E1", group: "Boundary", want: "signal", why: "personal email + genuinely strong content = Personal Prospect carve-out, stays Strong", comments: "Dynamics 365 Business Central for 40 users, engaging an implementation partner.", email: "owner@gmail.com" },
  { id: "E2", group: "Boundary", want: "dq", why: "personal email + another DQ = flat Bad Lead, no carve-out", comments: "Dynamics 365 Business Central for 40 users. Not interested.", email: "owner@gmail.com" },
  { id: "E3", group: "Boundary", want: "signal", why: "F1 inside a real sentence must NOT hit the metadata-only rule", comments: "We need F1 licenses for 200 frontline workers and a partner to manage it." },
  { id: "E4", group: "Boundary", want: "signal", why: "competitor-ish word in an ordinary company name must not DQ", comments: "Dynamics 365 Business Central for 40 users with an implementation partner.", company: "Vertex Health Systems" },
  { id: "E6", group: "Boundary", want: "dq", why: "rejection WITH product language reaches DQ", comments: "We evaluated Microsoft 365 licensing for 50 users. Not interested, remove us." },
];

// The case that is a genuine product question rather than a pass/fail:
// an explicit rejection with NO product language never reaches the DQ
// rules at all, because scanRowUnified bails out first.
const ORPHAN: Case = { id: "X1", group: "Boundary", want: "nosignal", why: "rejection with NO product language — bails before DQ runs", comments: "Not interested, please unsubscribe and do not contact us again." };

const F = (name: string, rows: Record<string, unknown>[]): ParsedFile => ({ name, fields: HEAD, data: rows });

const all = [...CASES, ORPHAN];
const file = F("accuracy.csv", all.map(row));
const s = scanParsedFiles([file]);

// Map every case back to its outcome. Company name is the join key.
const byCompany = new Map<string, string>();
s.results.forEach(r => byCompany.set(String(r.row.__f.company || "").trim(), r.tier));
const noSig = new Set(s.noSignalRows.map(r => String(r.company || "").trim()));
const reasons = new Map<string, string[]>();
s.results.forEach(r => reasons.set(String(r.row.__f.company || "").trim(), r.dqReasons));

const got = (c: Case): Bucket => {
  const key = (c.company ?? `Case ${c.id} Inc`).trim();
  if (noSig.has(key)) return "nosignal";
  const t = byCompany.get(key);
  return (t as Bucket) ?? "nosignal";
};

let pass = 0; const misses: { c: Case; got: Bucket }[] = [];
const groups = new Map<string, { p: number; t: number }>();
console.log("\n=== per-case classification ===");
let lastGroup = "";
for (const c of all) {
  const g = got(c);
  const okc = g === c.want;
  if (okc) pass++; else misses.push({ c, got: g });
  const gr = groups.get(c.group) ?? { p: 0, t: 0 };
  gr.t++; if (okc) gr.p++; groups.set(c.group, gr);
  if (c.group !== lastGroup) { console.log(`\n-- ${c.group} --`); lastGroup = c.group; }
  const rs = reasons.get((c.company ?? `Case ${c.id} Inc`).trim()) ?? [];
  console.log(`  ${okc ? "OK  " : "MISS"} ${c.id.padEnd(4)} want=${c.want.padEnd(8)} got=${g.padEnd(8)} ${c.why}${rs.length ? `  [DQ: ${rs.join("; ")}]` : ""}`);
}

console.log("\n=== accuracy by bucket ===");
for (const [g, v] of groups) console.log(`  ${g.padEnd(14)} ${v.p}/${v.t}`);
console.log(`  ${"OVERALL".padEnd(14)} ${pass}/${all.length}`);

console.log("\n=== metrics reconciliation ===");
const strong = s.results.filter(r => r.tier === "signal").length;
const review = s.results.filter(r => r.tier === "mention").length;
const bad = s.results.filter(r => r.tier === "dq").length;
console.log(`  rows read           ${s.rowsScanned}`);
console.log(`  processed           ${s.results.length}  (strong ${strong} · needs review ${review} · bad ${bad})`);
console.log(`  no signal           ${s.noSignalRows.length}`);
console.log(`  duplicates merged   ${s.duplicatesRemoved}`);
const identity = s.rowsScanned === s.results.length + s.noSignalRows.length + s.duplicatesRemoved;
const tiersSum = strong + review + bad === s.results.length;
console.log(`  ${identity ? "OK  " : "FAIL"} read = processed + no signal + duplicates`);
console.log(`  ${tiersSum ? "OK  " : "FAIL"} strong + review + bad = processed`);
console.log(`  ${s.results.every(r => (r.tier === "dq") === (r.dqReasons.length > 0)) ? "OK  " : "FAIL"} every Bad Lead carries a reason, and only Bad Leads do`);

if (misses.length) {
  console.log("\n=== disagreements with the documented rules ===");
  for (const m of misses) console.log(`  ${m.c.id} [${m.c.group}] expected ${m.c.want}, got ${m.got}\n      ${m.c.why}\n      "${m.c.comments.slice(0, 110)}"`);
}
console.log(`\n${pass}/${all.length} cases matched the documented rules`);
