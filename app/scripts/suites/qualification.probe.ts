import { scanParsedFiles, scanRowLicensing, type ParsedFile } from "../../src/lib/detection";

// Capture + precision audit for the qualification rules. Two halves that
// pull against each other on purpose: the first proves real leads are not
// missed, the second proves the rules did not get loosened into noise.
// Run both together or a change that fixes one silently breaks the other.
console.log("-- capture: these must qualify --");

// Each case: what a real note might say, and what Jack would WANT.
const capture: [string, string, "signal"|"mention"|"dq"|"none"][] = [
  // ---- Dynamics 365: modules that exist in the ranking but maybe not the catalogue
  ["D365 Field Service", "Looking at Dynamics Field Service for 30 technicians, want a partner to implement.", "signal"],
  ["Project Operations", "Evaluating Project Operations for 25 users this year with an implementation partner.", "signal"],
  ["Customer Insights", "Interested in Customer Insights for our marketing team, 40 seats, engaging a consultant.", "signal"],
  ["D365 Human Resources", "Rolling out Dynamics Human Resources for 200 employees, need a partner.", "signal"],
  ["Power Apps", "We want to build internal apps on Power Apps and Power Automate, bringing in a partner.", "signal"],
  ["Power Platform", "Standardizing on the Power Platform this year, looking for an implementation partner.", "signal"],
  ["Dataverse", "Consolidating data into Dataverse, need a Microsoft partner to lead it.", "signal"],
  ["Navision legacy name", "Still running Navision, planning to upgrade to Business Central with a partner.", "signal"],
  ["Great Plains legacy", "We are on Great Plains and want to modernize with a Microsoft partner.", "signal"],
  ["Axapta legacy", "Legacy Axapta install, evaluating a move with an implementation partner.", "signal"],

  // ---- M365 / Azure products not in any catalogue
  ["Purview", "Interested in leveraging Purview for compliance and data governance, want a partner.", "signal"],
  ["Sentinel", "Evaluating Microsoft Sentinel for SIEM, bringing in an MSP to run it.", "signal"],
  ["Defender for Cloud", "Looking at Defender for Cloud across our Azure estate with a CSP partner.", "signal"],
  ["Azure Virtual Desktop", "Deploying Azure Virtual Desktop for 150 users, need a partner.", "signal"],
  ["Windows 365 Cloud PC", "Evaluating Windows 365 Cloud PC for 80 users with a partner.", "signal"],
  ["Exchange Online", "Need to move 200 mailboxes to Exchange Online, engaging an MSP.", "signal"],
  ["SharePoint", "SharePoint Online migration for the whole company, looking for a partner.", "signal"],
  ["Intune/Endpoint", "Rolling out Microsoft Endpoint Manager to 300 devices with a partner.", "signal"],
  ["Copilot bare", "We want Microsoft Copilot rolled out to 100 people, need a partner.", "signal"],
  ["Teams Rooms", "Outfitting 12 Teams Rooms, want a Microsoft partner to handle it.", "signal"],

  // ---- Government / education SKUs
  ["M365 G3", "The county has 348 Microsoft 365 G3 licenses up for renewal, evaluating a new CSP.", "signal"],
  ["M365 A3 education", "District runs Microsoft 365 A3 for 900 staff, looking at a new partner.", "signal"],
  ["GCC High", "We need GCC High tenant support for 120 users, looking for a CSP partner.", "signal"],

  // ---- Bare SKU wording variants
  ["Business Basic bare", "We're on Business Basic for 40 users and want to move up, evaluating partners.", "signal"],
  ["M365 Apps", "Microsoft 365 Apps for enterprise, 250 seats, renewal coming up with a new partner.", "signal"],

  // ---- Long-comment distance: partner language far from the product mention
  ["Azure far from partner", "Azure consumption has grown a lot over the last two years across several subscriptions and resource groups, and the finance team has flagged the spend repeatedly in quarterly reviews. Separately, leadership has decided to bring in a Microsoft partner to take this over.", "signal"],

  // ---- Things that SHOULD stay out
  ["Coffee shop", "We roast and sell coffee across the midwest.", "none"],
  ["Support ticket number", "Support Ticket ID: 4521", "none"],
];

const HEAD_G = ["First Name","Last Name","Title","Company","Email","Phone","Comments"];
let miss = 0;
capture.forEach(([name, comment, want], i) => {
  const pf: ParsedFile = { name: "t.csv", fields: HEAD_G, data: [{
    "First Name": "Test", "Last Name": `L${i}`, Title: "IT Director",
    Company: `Co ${i} Inc`, Email: `t${i}@co${i}corp.com`, Phone: "(312) 555-0100", Comments: comment }] };
  const s = scanParsedFiles([pf]);
  const r = s.results[0];
  const got = r ? r.tier : "none";
  const cats = r ? r.categories.join("+") : "-";
  const okc = got === want;
  if (!okc) miss++;
  console.log(`${okc ? "ok  " : "MISS"} ${name.padEnd(24)} want=${String(want).padEnd(8)} got=${String(got).padEnd(8)} ${cats}`);
});
console.log(`${capture.length - miss}/${capture.length} matched intent`);

const HEAD_N=["First Name","Last Name","Title","Company","Email","Phone","Comments"];
const t=(c:string)=>{const s=scanParsedFiles([{name:"t.csv",fields:HEAD_N,data:[{"First Name":"A","Last Name":"B",Title:"IT",Company:"Co Inc",Email:"a@cocorp.com",Phone:"(312) 555-0100",Comments:c}]}]);
 const r=s.results[0]; return r?r.tier:"none";};
// Things that must NOT become Strong Signal.
const cases:[string,string,string[]][]=[
 ["plain company blurb","We manufacture industrial fasteners in Ohio.",["none"]],
 ["we ARE the partner","We are a Microsoft partner ourselves and resell licensing.",["none","mention","dq"]],
 ["CRM opportunity notes","Nicole Vargas is the owner of this opportunity and Partner: SIS LLC. Interest in Purview to support SOC 2 and improve security posture.",["dq"]],
 ["metadata only","F1 / Company Tenant Partner",["none"]],
 ["bare product mention","They use SharePoint and OneDrive internally.",["mention"]],
 ["bare Copilot mention","Asked about Copilot at the conference.",["mention"]],
 ["bare Azure mention","Their infrastructure runs on Azure.",["none","mention"]],
 ["bare Dynamics mention","They mentioned Dynamics 365 once.",["mention"]],
 ["password reset","I forgot my password and can't log in.",["dq","none"]],
 ["not interested","Not interested, please remove me.",["dq","none"]],
 ["single seat","Just me, one user license needed for Business Standard.",["dq"]],
 ["no budget","Small project, no budget, just want some advice.",["dq","none"]],
 
 ["version number","We need support on upgrade from our current version which is 15.",["none","mention"]],
 ["ticket id","Support Ticket ID: 4521",["none"]],
 ["9 seats under new min","Microsoft 365 Business Premium for 9 users.",["dq"]],
 ["10 seats at new min","Microsoft 365 Business Premium for 10 users.",["signal"]],
 ["12 seats over new min","Microsoft 365 Business Premium for 12 users.",["signal"]],
];
const ADVERSARIAL = 14;
let advBad = 0;
const advChk = (n: string, cond: boolean, d: string) => {
  cond ? console.log("  ok  ", n) : (advBad++, console.log("  BAD ", n, "->", d));
};
const scanOne = (c: string) => {
  const s = scanParsedFiles([{ name: "t.csv", fields: HEAD_N, data: [{ "First Name": "A", "Last Name": "B", Title: "IT", Company: "Co Inc", Email: "a@cocorp.com", Phone: "(312) 555-0100", Comments: c }] }]);
  return s.results[0] || null;
};
const countOf = (c: string) => scanRowLicensing({ Comments: c }, ["Comments"])?.count ?? null;

function ADV_RUN() {
  console.log("\n-- adversarial: seat-count extraction --");
  const counts: [string, string, number | null][] = [
    ["real gapped count", "They have 348 Microsoft 365 G3 licenses.", 348],
    ["direct count", "Microsoft 365 E3 for 120 users.", 120],
    ["no count at all", "They run Microsoft 365 E3 across the org.", null],
    ["365 is never a count", "Rolling out Microsoft 365 E5 company-wide.", null],
    ["version is never a count", "Support on upgrade from our current version which is 15, on E3.", null],
    ["ticket number is never a count", "E3 tenant. Support Ticket ID: 4521", null],
    ["number belongs to the later unit", "We run E3 across 3 offices with 240 seats.", 240],
    ["year is never a count", "Been on E3 since 2019 with 60 users.", 60],
    ["phone digits are never a count", "E3 tenant, call (312) 555-0142 for 45 users.", 45],
  ];
  counts.forEach(([n, text, want]) => { const got = countOf(text); advChk(n, got === want, `got ${got}, want ${want}`); });

  console.log("\n-- adversarial: the 260-char gate window --");
  const filler = "The account has been with us for several years and the notes below were copied from an older record that nobody has cleaned up since the last review cycle completed. ";
  const near = "Azure spend keeps climbing. " + filler + "Leadership decided to bring in a Microsoft partner.";
  advChk("partner language within reach counts", scanOne(near)?.tier === "signal", JSON.stringify(scanOne(near)?.tier));
  const far = "Azure is where the workloads sit. " + filler + filler + filler + "Unrelated: we also resell through a partner for hardware.";
  advChk("partner language beyond the window does not", scanOne(far)?.tier !== "signal", JSON.stringify(scanOne(far)?.tier));

  console.log("\n-- adversarial: widened partner gate must not over-fire --");
  advChk("a lead that IS a partner", scanOne("We are a Microsoft partner and resell Azure to our own clients.")?.tier !== "signal", "over-qualified");
  advChk("Partner: is a CRM field, not intent", scanOne("Azure tenant. Partner: SIS LLC. Owner of this opportunity is Dana.")?.tier !== "signal", "over-qualified");

  console.log(`\n${ADVERSARIAL - advBad}/${ADVERSARIAL} adversarial cases behaved`);
}

let bad=0;
console.log("\n-- precision: these must NOT over-qualify --");
cases.forEach(([n,c,want])=>{const got=t(c);const okc=want.includes(got);if(!okc)bad++;
 console.log(`${okc?"ok  ":"BAD "} ${n.padEnd(22)} got=${got.padEnd(8)} allowed=${want.join("/")}`);});
console.log(`\n${cases.length-bad}/${cases.length} behaved`);
const total = 28 + cases.length + ADVERSARIAL;
ADV_RUN();
console.log(`\n${total - miss - bad - advBad}/${total} passed`);
process.exit(miss || bad || advBad ? 1 : 0);


/* ---------------------------------------------------------------- *
 * Adversarial: the seat-count extractor and the widened gate window.
 * These two carry the most risk of the qualification pass, because a
 * wrong count does not just miss a lead — it DQs one ("348 Microsoft
 * 365 E3 licenses" was read as 3 seats and auto-DQ'd under the
 * threshold). Digits that belong to a product name, a version, a
 * ticket number, a year or a phone number must never be read as seats.
 * ---------------------------------------------------------------- */
