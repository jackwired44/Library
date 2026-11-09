// Per Jack (11/9), "execute" on the five Sep/Oct Strong Signal audit
// recommendations: split names in the download, lost / reversed deals to
// Needs Review, IT firms caught by name / self-named partner / IT-firm email
// domain, the same email is a duplicate, and under 5 means company size.
import { parseCSVText } from "../../src/lib/csv";
import { scanParsedFiles, buildExportRow, splitFullName, isCompetitorName, COMPETITOR_DQ_LABEL, UNDER_FIVE_DQ_LABEL } from "../../src/lib/detection";
import { addExportRowsToList, createLeadList, listRowKey } from "../../src/lib/leadLists";
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { c ? pass++ : (fail++, console.log(`  FAIL ${n}${d ? " — " + d : ""}`)); };
const q = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
type Row = { name?: string; co?: string; email?: string; pa?: string; notes: string; emp?: string };
const scan = (rows: Row[]) => {
  const csv = "fullname,companyname,emailaddress1,msp_primaryproductcodename,Comments,numberofemployees\n" +
    rows.map((r) => [r.name ?? "Pat Lee", r.co ?? "Acme Manufacturing", r.email ?? "pat@acmemfg.com", r.pa ?? "", r.notes, r.emp ?? ""].map(q).join(",")).join("\n");
  return scanParsedFiles([parseCSVText("t.csv", csv) as any]);
};
const one = (r: Row) => scan([r]).results[0] as any;

// 1. Names split in the download.
const ex = buildExportRow(one({ name: "Adriana Urista-Firsich", notes: "Wants Microsoft 365 E3 for 40 users." }));
ok("full name splits: first", ex["First Name"] === "Adriana", ex["First Name"]);
ok("full name splits: last", ex["Last Name"] === "Urista-Firsich", ex["Last Name"]);
ok("'Lee, Mary' is last, first", splitFullName("Lee, Mary").join("|") === "Mary|Lee");
ok("a one-word name stays in First Name", splitFullName("Cher").join("|") === "Cher|");
ok("'John Smith, MBA' keeps the suffix with the last name", splitFullName("John Smith, MBA").join("|") === "John|Smith MBA");
{
  // A list row saved before the split still matches the split form.
  let lists = createLeadList([], "L").lists;
  const old = { ...ex, "First Name": "Adriana Urista-Firsich", "Last Name": "" };
  lists = addExportRowsToList(lists, lists[0].id, [{ row: old, scanner: "main" }]).lists;
  const r2 = addExportRowsToList(lists, lists[0].id, [{ row: ex, scanner: "main" }]);
  ok("a list does not take the split row twice", r2.added === 0 && r2.skipped === 1, JSON.stringify([r2.added, r2.skipped]));
  ok("John Smith and John Doe at one company are two list rows",
    listRowKey({ ...ex, "First Name": "John", "Last Name": "Smith" }) !== listRowKey({ ...ex, "First Name": "John", "Last Name": "Doe" }));
}

// 2. Lost / reversed deals are Needs Review.
const t = (notes: string, extra: Partial<Row> = {}) => one({ notes, ...extra })?.tier;
ok("declined is Needs Review", t("Client would like to get Entra ID and Copilot for 40 users. The customer declined.") === "mention");
ok("staying on QuickBooks is Needs Review", t("We looked at Dynamics 365 Business Central, but decided to stay on QuickBooks for now.", { pa: "Dynamics 365" }) === "mention");
ok("marked as lost is Needs Review", t("Wants Microsoft 365 E3 for 40 users. It will be marked as lost due to inactivity.") === "mention");
ok("'lost or deleted data' is not a reversal", t("They want to buy 40 Microsoft 365 E3 licenses and Azure Backup so no files are lost or deleted.") === "signal");
ok("'won't be until December' is not a reversal", t("They want to buy 40 Microsoft 365 E3 licenses, but it won't be until December.") === "signal");
ok("'cancelled the old invites' is not a reversal", t("They want to buy 40 Microsoft 365 E3 licenses. You cancelled the old invites and sent new ones.") === "signal");
ok("'at first they were not interested' is not a reversal", t("At first they were not interested, but now they want to buy 40 Microsoft 365 E3 licenses.") === "signal");
ok("a Google lead staying on Google stays Strong", t("They are staying on Google Workspace for now but are curious about Microsoft 365.") === "signal");

// 3. IT firms.
for (const n of ["Honu IT & Security", "Prutech Solutions", "Data Center Systems"]) ok(`${n} reads as an IT firm`, isCompetitorName(n));
for (const n of ["Biotech Solutions Lab", "Fintech Services Group", "Acme Technologies", "Vertex Health Systems", "Baker Solutions"]) ok(`${n} is not`, !isCompetitorName(n));
const dq = (r: Row) => one(r)?.dqReasons as string[];
ok("a company named as its own partner is a competitor", dq({ co: "Moser Consulting", email: "pat@moserit.com", notes: "Wants Microsoft 365 E3 for 30 users. Partner Name: Moser Consulting" }).includes(COMPETITOR_DQ_LABEL));
ok("Product Area naming the lead's own company is a competitor", dq({ co: "Ampcus Inc.", email: "pat@ampcus.com", pa: "Ampcus Inc", notes: "Wants Microsoft 365 E5 for 50 users." }).includes(COMPETITOR_DQ_LABEL));
ok("a different partner is not", dq({ notes: "Wants Microsoft 365 E3 for 30 users. Partner: CDW" }).length === 0);
ok("a contact on another firm's IT domain is a competitor", dq({ co: "TAT Technologies", email: "pat@nexustek.com", notes: "Wants Microsoft 365 E3 for 30 users." }).includes(COMPETITOR_DQ_LABEL));
ok("their own tech domain is not", dq({ co: "Acme Manufacturing", email: "pat@acme-tech.com", notes: "Wants Microsoft 365 E3 for 30 users." }).length === 0);
ok("initials as their own domain is not", dq({ co: "Tri County Electric", email: "pat@tcetek.com", notes: "Wants Microsoft 365 E3 for 30 users." }).length === 0);

// 4. The same email is the same person.
{
  const s = scan([
    { name: "Pat Lee", co: "Smith & Jones LLC", email: "pat@smithjones.com", notes: "Wants Microsoft 365 E3 for 30 users." },
    { name: "Pat Lee", co: "Smith and Jones", email: "pat@smithjones.com", notes: "Wants Microsoft 365 E3 for 30 users." },
    { name: "Kim Ray", co: "Smith and Jones", email: "info@smithjones.com", notes: "Wants Microsoft 365 E3 for 30 users." },
    { name: "Lou Ray", co: "Smith and Jones", email: "info@smithjones.com", notes: "Wants Microsoft 365 E3 for 30 users." },
  ]);
  ok("same email, company written two ways: one lead", s.results.filter((r: any) => /Pat Lee/.test(r.row.fullname)).length === 1);
  ok("two people on info@ stay two leads", s.results.filter((r: any) => /Ray/.test(r.row.fullname)).length === 2);
  ok("duplicatesRemoved counts it", s.duplicatesRemoved === 1, String(s.duplicatesRemoved));
}

// 5. Under 5 is company size only.
ok("1 licence is not a Bad Lead", t("Wants Microsoft 365 E3 for 1 user.") !== "dq");
ok("  ...it is Needs Review", t("Wants Microsoft 365 E3 for 1 user.") === "mention");
ok("1 licence with 300 employees stays Strong", t("They want to buy 1 Copilot license to try it; 300 employees.") === "signal");
ok("a 3-person company is a Bad Lead", (dq({ notes: "We are a 3 person company looking at Microsoft 365 Business Premium." }) || []).includes(UNDER_FIVE_DQ_LABEL));
ok("company of 2 is a Bad Lead", (dq({ notes: "Company of 2 wants Microsoft 365 Business Premium." }) || []).includes(UNDER_FIVE_DQ_LABEL));
ok("Number of Employees 3 is a Bad Lead", (dq({ notes: "Wants Microsoft 365 E3 for everyone.", emp: "3" }) || []).includes(UNDER_FIVE_DQ_LABEL));
ok("Number of Employees 250 is not", !(dq({ notes: "Wants Microsoft 365 E3 for 2 users.", emp: "250" }) || []).includes(UNDER_FIVE_DQ_LABEL));
ok("  ...and 250 employees lifts the 2-licence cap", t("Wants Microsoft 365 E3 for 2 users.", { emp: "250" }) === "signal");
ok("Dynamics for 3 users stays Strong", t("Wants Dynamics 365 Business Central for 3 users.", { pa: "Dynamics 365" }) === "signal");

console.log(`${pass} / ${pass + fail}`);
if (fail) process.exit(1);
