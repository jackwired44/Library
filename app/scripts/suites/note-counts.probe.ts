// Per Jack (11/6), on his Sep/Oct Strong Signal export: "check these are all
// how i want them scanned". Each case is a defect found in that export.
import { parseCSVText } from "../../src/lib/csv";
import { scanParsedFiles } from "../../src/lib/detection";
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { c ? pass++ : (fail++, console.log(`  FAIL ${n}${d ? " — " + d : ""}`)); };
const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
const note = (pa: string, n: string) => {
  const csv = `fullname,companyname,emailaddress1,msp_primaryproductcodename,Comments\nPat Lee,Acme Co,pat@acmeco.com,${q(pa)},${q(n)}`;
  const r = scanParsedFiles([parseCSVText("t.csv", csv) as any]).results[0] as any;
  return r ? String(r.notesSummary) : "NO ROW";
};
let n = note("Dynamics 365", "Customer is evaluating Dynamics 365 Sales and Power Automate for their Microsoft 365 users.");
ok("'Microsoft 365 users' is not 365 users", !/\b365 users/.test(n), n);
n = note("Dynamics 365", "Wants Dynamics 365 Business Central for 30 users.");
ok("  a real Dynamics count still reads", /\(30 users\)/.test(n), n);
n = note("Dynamics 365", "Wants Dynamics 365 Business Central for 1 user.");
ok("one user reads '1 user'", /\(1 user\)/.test(n), n);
n = note("M365", "Wants to deploy Windows 11 Enterprise LTSC 2024 seats via a non-Intune MDM.");
ok("a version year is not a seat count", !/2024 seats|Large estate/.test(n), n);
ok("non-Intune is never read as Intune", !/Runs Intune|Wants Intune/.test(n), n);
n = note("M365", "M365 - Microsoft 365 Business Basic (non-profit) - 40");
ok("a hyphen inside a word is not a field break", /non-profit/.test(n), n);
n = note("M365", "Service-Microsoft 365 Business Standard-50 users");
ok("  a glued form line still splits", /Wants Microsoft 365 Business Standard for 50 users\./.test(n), n);
n = note("M365", "M365 - M365 Business Premium licenses + E7 Licenses.");
ok("no doubled period", !/\.\./.test(n), n);
console.log(`${pass} / ${pass + fail}`);
process.exit(fail ? 1 : 0);
