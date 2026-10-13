// Google -> Microsoft migrations in the Main Scanner.
//
// Per Jack: "make sure google is detected properly for migrations in main
// scanner". A Google Workspace move is a top-priority pin and its own View
// tab, so a miss sends the best lead type in the file to the wrong tab
// (or to no row at all), and a false hit pins the wrong lead.
import { parseCSVText } from "../../src/lib/csv";
import { scanParsedFiles, topPriorityReason, m365SubViewOf, type ResultRow } from "../../src/lib/detection";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { c ? (pass++, console.log("  PASS " + n)) : (fail++, console.log(`  FAIL ${n}${d ? " — " + d : ""}`)); };
const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
function scan(n: string): ResultRow | undefined {
  const csv = ["Company,Full Name,Title,Email,Phone,Comments", ["Acme", "Pat Vale", "IT Director", "pat@acme.com", "312-555-0100", n].map(q).join(",")].join("\n");
  return scanParsedFiles([parseCSVText("t.csv", csv)]).results[0];
}
const show = (r: ResultRow | undefined) => (r ? `${r.tier}/${r.category}/${m365SubViewOf(r)}/${topPriorityReason(r)}` : "NO ROW");

console.log("\n== moving off Google, interested, or simply on Google: a lead, pinned, on the Google tab ==");
for (const n of [
  "Currently on Google Workspace and want to move to Microsoft 365 for 80 users.",
  "Looking to migrate off Google this quarter.",
  "Evaluating Office 365 to replace G Suite across the business.",
  "Google to Microsoft migration, budget approved.",
  "Moving from G-Suite to M365 next month.",
  "Want to switch from Gmail to Outlook and Teams for the whole company.",
  "Migrating email from Google Workspace to Exchange Online.",
  "Google Drive to SharePoint and OneDrive migration for 40 staff.",
  "They use Google Apps today and want to consolidate onto Microsoft 365.",
  "Google to M365 migration needed, 25 users.",
  "Google to O365 move planned for Q1.",
  "Currently on Google Workspace. Their team has been asking about Copilot and wants to get onto Microsoft 365 before renewal.",
  "Need help migrating from GSuite.",
  "Moving off Google Workspace.",
  "Transition from Google Workspace to Microsoft 365 Business Premium.",
  "Interested in leaving Google for Microsoft 365.",
  // Per Jack: "if theyre on google thats a lead".
  "They are on Google Workspace.",
  "Company uses G Suite for email.",
  "Google Workspace customer, 60 seats.",
  "Uses Gmail; their sales teams are growing fast.",
  "Running Google Drive for file storage today.",
  "They are on Google for email right now.",
]) {
  const r = scan(n);
  ok(JSON.stringify(n.slice(0, 60)), !!r && r.isGoogleWorkspaceMigration === true && m365SubViewOf(r) === "google" && topPriorityReason(r) === "google", show(r));
}

console.log("\n== not a move to Microsoft — never pinned as Google ==");
for (const n of [
  "Migrating from Microsoft 365 to Google Workspace next year.",
  "Moving off Office 365 onto G Suite.",
  "Switching from Outlook to Gmail.",
  "Found us on Google and asked about Dynamics 365 Business Central.",
  "Googled managed services and called in about Microsoft 365 licensing.",
  "Uses Google Analytics and Google Ads; on Microsoft 365 already.",
  "Migrated from Google Workspace to Microsoft 365 two years ago, now wants Business Central.",
  "Emailed in from a Gmail address asking about Outlook licensing.",
  "Hosts their app on Google Cloud, asked about Dynamics 365.",
  "Contact is john.doe@gmail.com, asked about Business Central for 20 users.",
  "Already on Microsoft 365 since leaving Google, wants Intune.",
]) {
  const r = scan(n);
  ok(JSON.stringify(n.slice(0, 60)), !r || !r.isGoogleWorkspaceMigration, show(r));
}

console.log(`\n${pass}/${pass + fail} checks passed`);
if (fail) process.exit(1);
