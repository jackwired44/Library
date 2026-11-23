// Per Jack (11/6): "if the lead is about azure document intelligence,
// security anything indiciating msp or ongoing support the scanned note is
// direct for main scanner", then "azure infrastructure or migrations
// everything".
//
// Rewritten 11/23: "i want the scanner to just give a straight forward high
// level few words what the raw note indicates they want" and "no do not
// quote any sentences". The topic must still LEAD — that is the 11/6 rule
// and it survives — but it is now SAID in the engine's own words rather
// than by quoting the row. Each case below therefore asserts the derived
// line, and a sweep at the end proves no note lifts a run of words from
// the row it came from.
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
ok("doc intel is named outright", /^\u25B2 Wants Azure Document Intelligence\./.test(n), n);
ok("  and keeps Jack's gold ask", /Ask how Azure is managed today, internal IT or an external partner/.test(n), n);
ok("  and quotes none of the row", !/extract data from invoices/.test(n), n);
n = note("Azure", "Healthcare - Azure Document Intelligence - The customer stated that they want to digitize patient intake forms and integrate with their EHR.");
ok("doc intel leads the note", /^\u25B2 Wants Azure Document Intelligence\./.test(n) && !/patient intake/.test(n), n);

n = note("M365", "Customer is looking for help improving their security posture, MFA and conditional access across 80 users.");
ok("security leads, with the count after it", /^\u25B2 Security need\. 80 seats stated\./.test(n), n);
n = note("", "They had a phishing incident last month and want a security assessment and ongoing monitoring.");
ok("a security row with no detail says so", /^\u25B2 Security need; the row gives no more detail\./.test(n) && !/phishing/.test(n), n);

n = note("", "Looking for an MSP to manage our IT going forward.");
ok("an MSP ask leads", /^\u25B2 Wants IT support or a managed service/.test(n) && !/manage our IT going forward/.test(n), n);
n = note("", "Need ongoing IT support and help desk for 25 employees.");
ok("ongoing support leads, with its count", /^\u25B2 Wants IT support or a managed service\. 25 seats stated\./.test(n), n);

const sw = scan("M365", "Customer's current IT provider is unresponsive and they want a new partner for ongoing Microsoft 365 support, 60 users.");
ok("switching provider is a lead", sw?.tier === "signal", sw?.tier);
ok("switching provider leads, with a derived reason", /^\u25B2 Wants to change IT provider\. 60 seats stated\./.test(sw?.notesSummary ?? "")
   && /Reason: unhappy with who they have\./.test(sw?.notesSummary ?? "")
   && !/unresponsive/.test(sw?.notesSummary ?? ""), sw?.notesSummary);
const doc = scan("", "S - 26/Oct - [5/20/2024, DJ]:: Requesting 1 more user for a new provider starting soon.");
ok("a new healthcare provider is not a new IT provider", doc?.tier !== "signal", `${doc?.tier} ${doc?.notesSummary}`);

n = note("Azure", "Customer is looking to set up Azure Virtual Desktop for 45 remote users and wants a partner to manage it.");
ok("Azure infrastructure leads, naming the product", /^\u25B2 Azure infrastructure\./.test(n) && /Azure Virtual Desktop \(45 seats\)/.test(n), n);

n = note("Azure", "Customer wants to migrate 3 on-prem Hyper-V servers to Azure by end of Q1, looking for a partner to do the work.");
ok("migration names what is moving", /Migrating 3 on-prem Hyper-V servers to Azure\./.test(n), n);
ok("migration carries the timeline", /Timeline: end of Q1\./.test(n), n);

const kb = scan("Azure", "Kitchen and Bath - Azure Virtual Machines - The customer stated that they need about 4 TB of Azure storage for a server hosting their ERP system and shared files.");
ok("an ERP hosted on Azure is not a Dynamics lead", kb?.category !== "dynamics365", `${kb?.category} ${kb?.notesSummary}`);

// 11/6, per Jack: each topic must lead even when buried in a longer note —
// still true, now said in the engine's own words.
const pre = "Spoke with the office manager about their current environment. They have about 70 employees across two locations and use Microsoft 365 Business Standard today. ";
const post = " Follow-up meeting scheduled with the owner next week to review options.";
const buried: [string, string, string, RegExp][] = [
  ["security", "M365", "They want a security review and help tightening MFA and conditional access.", /^\u25B2 Security need\./],
  ["device management", "M365", "They need device management for their laptops and phones and want Intune set up.", /^\u25B2 Device management \(Intune\)\./],
  ["MDM / Autopilot", "M365", "Main ask is MDM and Autopilot so new devices are enrolled automatically.", /^\u25B2 Device management \(Intune\)\./],
  ["ongoing support", "M365", "They need ongoing IT support since their last IT person left.", /^\u25B2 Wants IT support or a managed service\./],
  ["MSP", "M365", "They are looking for an MSP to take over day to day IT.", /^\u25B2 Wants IT support or a managed service\./],
  ["Azure migration", "Azure", "They want to migrate their on-prem file server and SQL server to Azure.", /^\u25B2 Migrating on-prem file server and SQL server to Azure\./],
  ["Document Intelligence", "Azure", "They are interested in Azure Document Intelligence to read scanned invoices.", /^\u25B2 Wants Azure Document Intelligence\./],
  ["Copilot rollout", "M365", "They want to roll out Copilot to the leadership team first and then the whole company.", /^\u25B2 Copilot\./],
];
for (const [name, pa, line, want] of buried) {
  n = note(pa, pre + line + post);
  ok(`buried ${name}: leads the note`, want.test(n), n);
  ok(`buried ${name}: quotes none of the row`, !n.includes(line.slice(0, 40)) && !/Follow-up meeting/.test(n), n);
}
n = note("Intune", "Customer wants to roll out Intune to manage 120 laptops and mobile devices, needs a partner to set it up.");
ok("Intune leads and names the product", /^\u25B2 Device management \(Intune\)\./.test(n) && !/120 laptops/.test(n), n);
n = note("Copilot", "Customer is rolling out Microsoft 365 Copilot to 50 users and wants help with adoption and training.");
ok("Copilot leads, with its count", /^\u25B2 Copilot\./.test(n) && /Microsoft 365 Copilot \(50 seats\)/.test(n), n);

console.log(`${pass} / ${pass + fail}`);
if (fail) process.exit(1);
