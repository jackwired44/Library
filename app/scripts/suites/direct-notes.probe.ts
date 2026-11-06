// Per Jack (11/6): "if the lead is about azure document intelligence,
// security anything indiciating msp or ongoing support the scanned note is
// direct for main scanner", then "azure infrastructure or migrations
// everything".
import { parseCSVText } from "../../src/lib/csv";
import { scanParsedFiles } from "../../src/lib/detection";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { c ? pass++ : (fail++, console.log(`  FAIL ${n}${d ? " — " + d : ""}`)); };
const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
const scan = (pa: string, note: string) => {
  const csv = `fullname,companyname,emailaddress1,msp_primaryproductcodename,Comments\nPat Lee,Acme Co,pat@acmeco.com,${q(pa)},${q(note)}`;
  return scanParsedFiles([parseCSVText("t.csv", csv) as any]).results[0];
};
const note = (pa: string, n: string) => scan(pa, n)?.notesSummary ?? "";

let n = note("Azure", "The customer wants to use Azure Document Intelligence to extract data from invoices and purchase orders, about 2,000 documents a month.");
ok("doc intel: the row's own sentence", /Azure Document Intelligence to extract data from invoices/.test(n), n);
ok("doc intel keeps Jack's gold ask", /Ask how Azure is managed today, internal IT or an external partner/.test(n), n);
n = note("Azure", "Healthcare - Azure Document Intelligence - The customer stated that they want to digitize patient intake forms and integrate with their EHR.");
ok("doc intel leads the note", /^\(\d+\) ▲ Wants Azure Document Intelligence\. They want to digitize/.test(n), n);

n = note("M365", "Customer is looking for help improving their security posture, MFA and conditional access across 80 users.");
ok("security: quoted whole", /improving their security posture, MFA and conditional access across 80 users\./.test(n), n);
n = note("", "They had a phishing incident last month and want a security assessment and ongoing monitoring.");
ok("a relative time is cut, the sentence kept", /They had a phishing incident and want a security assessment/.test(n) && !/last month/.test(n), n);

n = note("", "Looking for an MSP to manage our IT going forward.");
ok("MSP: quoted", /Looking for an MSP to manage our IT going forward\./.test(n), n);
n = note("", "Need ongoing IT support and help desk for 25 employees.");
ok("support: quoted with its count", /Need ongoing IT support and help desk for 25 employees\./.test(n), n);

const sw = scan("M365", "Customer's current IT provider is unresponsive and they want a new partner for ongoing Microsoft 365 support, 60 users.");
ok("switching provider is a lead", sw?.tier === "signal", sw?.tier);
ok("switching provider: quoted whole, no repeat", /^\(\d+\) ▲ Customer's current IT provider is unresponsive and they want a new partner/.test(sw?.notesSummary ?? "") && !/Flagged/.test(sw?.notesSummary ?? ""), sw?.notesSummary);
const doc = scan("", "S - 26/Oct - [5/20/2024, DJ]:: Requesting 1 more user for a new provider starting soon.");
ok("a new healthcare provider is not a new IT provider", doc?.tier !== "signal", `${doc?.tier} ${doc?.notesSummary}`);

n = note("Azure", "Customer is looking to set up Azure Virtual Desktop for 45 remote users and wants a partner to manage it.");
ok("Azure infra: quoted", /set up Azure Virtual Desktop for 45 remote users/.test(n), n);

n = note("Azure", "Customer wants to migrate 3 on-prem Hyper-V servers to Azure by end of Q1, looking for a partner to do the work.");
ok("migration names what is moving", /Migrating 3 on-prem Hyper-V servers to Azure\./.test(n), n);
ok("migration carries the timeline", /Timeline: end of Q1\./.test(n), n);

const kb = scan("Azure", "Kitchen and Bath - Azure Virtual Machines - The customer stated that they need about 4 TB of Azure storage for a server hosting their ERP system and shared files.");
ok("an ERP hosted on Azure is not a Dynamics lead", kb?.category !== "dynamics365", `${kb?.category} ${kb?.notesSummary}`);

console.log(`${pass} / ${pass + fail}`);
if (fail) process.exit(1);
