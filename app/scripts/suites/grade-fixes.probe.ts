// Per Jack (11/6): "fix what is in needs review and what is in bad leads",
// "anything to do with microsoft dynamics is a strong lead", "Looking for a
// Microsoft partner to help us with our Microsoft 365 licensing and setup, 30
// users" — "yes this is strong", "like all these needs review look strong",
// "even a good bit of bad leads should auto go to strong".
import { parseCSVText } from "../../src/lib/csv";
import { scanParsedFiles } from "../../src/lib/detection";
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { c ? pass++ : (fail++, console.log(`  FAIL ${n}${d ? " — " + d : ""}`)); };
const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
const scan = (pa: string, note: string, email = "pat@acmeco.com") => {
  const csv = `fullname,companyname,emailaddress1,msp_primaryproductcodename,Comments\nPat Lee,Acme Co,${email},${q(pa)},${q(note)}`;
  return scanParsedFiles([parseCSVText("t.csv", csv) as any]).results[0] as any;
};
const tier = (pa: string, note: string, email?: string) => scan(pa, note, email)?.tier ?? "NO ROW";

ok("partner ask alone is Strong", tier("", "Looking for a Microsoft partner to help us with our Microsoft 365 licensing and setup, 30 users.") === "signal");
ok("partner ask with no product is Strong", tier("", "Looking for a Microsoft partner.") === "signal");
ok("a negated partner ask makes no lead", tier("", "We are not looking for a partner right now.") === "NO ROW");

ok("Dynamics named in passing is Strong", tier("", "They mentioned Dynamics 365 once.") === "signal");
ok("Dynamics BC 20 users in BANT is Strong", tier("", "Budget: $26,400 USD Authority: Michael Lieber Need: evaluating a Dynamics 365 Business Central solution for 20 users. Partner: Encore") === "signal");
ok("Dynamics: campaign name alone is not Strong", tier("", "Opportunity Generated US~US~FY25~CMP~Modernize Accounting/ERP Systems with D365 Bus Central - VDS~SRAIM521867_22 US ALLIANCE PAPER") !== "signal");
ok("Dynamics: empty note over a code is not Strong", tier("Dynamics ERP Online", "") !== "signal");

ok("M365: stated want is Strong", tier("M365", "Customer wants to get and implement Microsoft Defender for Endpoint.") === "signal");
ok("M365: form line count >= 10 is Strong", tier("M365", "Services - Microsoft Defender for Identity - 60") === "signal");
ok("M365: inbound header + want is Strong", tier("M365", "Healthcare - Microsoft 365 Business Premium - The customer stated that they want to roll it out to their office staff.") === "signal");
ok("M365: the same header with no want stays Needs Review", tier("M365", "Healthcare - Microsoft 365 Business Premium - The customer has it today.") === "mention");
ok("2 users is a Bad Lead (under 5)", tier("Copilot", "Service - Copilot Studio - 2 users") === "dq");
ok("one-person company is a Bad Lead", tier("M365", "One-person company looking at Microsoft 365 Business Premium.") === "dq");
ok("3 licences with 300 employees is not under 5", tier("M365", "Customer has 3 Copilot licenses today and 300 employees, wants to expand.") !== "dq");
ok("wants to purchase licences is Strong", tier("M365", "They want to purchase 40 Microsoft 365 E3 licenses.") === "signal");
ok("a software firm is a Bad Lead", (() => { const csv = `fullname,companyname,emailaddress1,Comments\nPat Lee,Acme Software Inc,pat@acmesoft.com,"Wants Microsoft 365 E5 for 40 users."`; return (scanParsedFiles([parseCSVText("t.csv", csv) as any]).results[0] as any)?.tier === "dq"; })());
ok("a personal email is no longer a Bad Lead", tier("M365", "They want to purchase 40 Microsoft 365 E3 licenses.", "pat@gmail.com") === "signal");
ok("unsubscribe still wins", tier("M365", "Wants Microsoft 365 E3 for 40 users. Please unsubscribe us.") === "dq");

ok("'Partner: X' alone no longer makes a Bad Lead", tier("", "Budget: $600, CSP monthly. Authority: Talon, owner. Need: Microsoft 365 E5 for 40 users. Partner: Aliando") === "signal");
ok("the CRM-notes rule no longer fires (11/6)", tier("", "Nicole Vargas is the owner of this opportunity and Partner: SIS LLC. Particular interest was shown in leveraging Purview to support SOC 2 preparation.") !== "dq");
ok("an unsubscribe still wins over Dynamics", tier("", "Not interested. We would like Dynamics 365 Business Central later maybe but please unsubscribe us.") === "dq");
ok("an IT services company is still a Bad Lead", (() => { const csv = `fullname,companyname,emailaddress1,Comments\nPat Lee,Stellar IT Solutions,tom@stellarit.net,"Wants Microsoft 365 E5 for 40 users."`; return (scanParsedFiles([parseCSVText("t.csv", csv) as any]).results[0] as any)?.tier === "dq"; })());

// 11/6, per Jack: a note that just says the product stays Needs Review.
ok("bare 'Dynamics CRM' stays Needs Review", tier("", "Dynamics CRM") === "mention");
ok("bare product line with a Dynamics code stays Needs Review", tier("Dynamics 365", "Services - Dynamics 365 Business Central -") === "mention");
ok("the product with a count is Strong", tier("", "Dynamics 365 Business Central - 20 users") === "signal");
ok("the product with an ask is Strong", tier("", "Dynamics CRM demo please") === "signal");
console.log(`${pass} / ${pass + fail}`);
if (fail) process.exit(1);
