// Per Jack: "make sure dynamics leads always include the user count if
// there is one noted." Every phrasing below states a count; each must reach
// the lead's seat count and its note.
import { parseCSVText } from "../../src/lib/csv";
import { scanParsedFiles } from "../../src/lib/detection";
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { c ? (pass++, console.log("  PASS " + n)) : (fail++, console.log(`  FAIL ${n}${d ? " — " + d : ""}`)); };
const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
const scan = (n: string) => scanParsedFiles([parseCSVText("t.csv",
  ["Company,Full Name,Title,Email,Phone,Comments", ["Acme", "Pat Vale", "CFO", "pat@acme.com", "312-555-0100", n].map(q).join(",")].join("\n"))]).results[0];
for (const [n, want] of [
  ["Looking at Dynamics 365 Business Central for 25 users.", 25],
  ["Need Dynamics 365 Sales for our 30-person sales team.", 30],
  ["Evaluating D365 F&O, about 120 employees will use it.", 120],
  ["Dynamics 365 Business Central implementation, 15 licenses.", 15],
  ["Want Dynamics CRM for 12 reps.", 12],
  ["Dynamics 365 Field Service for 30 techs, bringing in a partner.", 30],
  ["Business Central — user count: 22", 22],
  ["Dynamics 365 Customer Service, 8 agents", 8],
  ["Dynamics 365 Business Central (approx. 60 users)", 60],
] as [string, number][]) {
  const r = scan(n);
  ok(`${want} <- ${JSON.stringify(n.slice(0, 50))}`, r?.dynamicsSeatCount === want && new RegExp(`\\b${want} seats\\b`).test(r?.notesSummary ?? ""), `${r?.dynamicsSeatCount} | ${r?.notesSummary}`);
}
// Company size is not a user count: it is shown, but as employees.
const co = scan("American Cementing has roughly 400 employees and is evaluating Dynamics 365 Business Central.");
ok("company headcount reads as employees, not seats", /\b400 employees\b/.test(co?.notesSummary ?? "") && !/400 seats/.test(co?.notesSummary ?? ""), co?.notesSummary);
// The CRM's one-line form: the closing number is the user count.
for (const [n, want] of [["Service Industry - D365 Sales - 50", 50], ["f1 Service Industry - D365 Business Central - 5", 5]] as [string, number][]) {
  const r = scan(n);
  ok(`form line ${want} <- ${JSON.stringify(n)}`, r?.dynamicsSeatCount === want, `${r?.dynamicsSeatCount} | ${r?.notesSummary}`);
}
// M365 rows too: a count stated away from any SKU still reaches the note,
// and company size is reported as employees, separately from seats.
const m365 = scan("Opportunity is focused on Microsoft 365 E5 and Teams Phone and Copilot for the business. Decision maker identified. The company has about 800 employees and plans an initial rollout to 200 users later this year.");
ok("M365 note carries the user count", /\b200 users\b/.test(m365?.notesSummary ?? ""), m365?.notesSummary);
ok("M365 note carries the employee count", /\b800 employees\b/.test(m365?.notesSummary ?? ""), m365?.notesSummary);
// A year is never a headcount.
const y = scan("Dynamics 365 Business Central go-live planned for 2026 staff training.");
ok("a year is not read as a user count", y?.dynamicsSeatCount !== 2026, String(y?.dynamicsSeatCount));
console.log(`\n${pass}/${pass + fail} checks passed`);
if (fail) process.exit(1);
