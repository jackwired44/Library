// Per Jack (11/5): "alot of the needs review for dynamics from august and
// september should be strong". Real rows from his 9/30 and 10/30 files.
import { parseCSVText } from "../../src/lib/csv";
import { scanParsedFiles } from "../../src/lib/detection";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { c ? pass++ : (fail++, console.log(`  FAIL ${n}${d ? " — " + d : ""}`)); };
const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
const tierOf = (pa: string, note: string) => {
  const csv = `fullname,companyname,emailaddress1,msp_primaryproductcodename,Comments\nPat Lee,Acme Co,pat@acmeco.com,${q(pa)},${q(note)}`;
  const r = scanParsedFiles([parseCSVText("t.csv", csv) as any]).results[0];
  return r ? `${r.tier}/${r.category}` : "none";
};
const strong = (n: string, pa: string, note: string) => { const t = tierOf(pa, note); ok(n, t === "signal/dynamics365", t); };
const notStrong = (n: string, pa: string, note: string) => { const t = tierOf(pa, note); ok(n, !t.startsWith("signal"), t); };

strong("wants to use D365 CRM, quote, demo", "", "FSA - 28/Oct - FSA 10/28/2026 Need The customer wants to use Dynamics 365 CRM for their sales team and would like to discuss their requirements, get a quote, and see a product demo. Purchasing Process Customer timeline implementation is 2027");
strong("would like Dynamics 365 Business Central", "", "FSA - 28/Oct - FSA: 10/28/2026 Business Overview: Carrington Foods, Inc is a company within the Food industry The total number of users for the solution Is 18 Need The customer expressed that they would like Dynamics 365 Business Central There were no limitations disclosed by the customer.");
strong("inbound line, Dynamics ERP code", "Dynamics ERP", "Dynamics 365 Business Central");
strong("inbound line with dashes", "Dynamics 365", "Services - Dynamics 365 Business Central -");
strong("Dynamic ERP", "Dynamics ERP", "Dynamic ERP");
strong("customer engagement", "Dynamics CRM", "dynamics 365 customer engagement");
strong("would like a demo of Power Automate", "Dynamics CRM", "I would like a demo of Power Automate and to understand if/how it can automate many of my RCM processes.");

strong("'demonstrating' is not a demo (11/6: anything Dynamics is Strong)", "", "Customer is actively evaluating expansion of Copilot Studio. DJ has already developed a Copilot agent that creates records in Dynamics 365, demonstrating an established foundation for agent-based automation.");
strong("inbound line needs a Dynamics Product Area (11/6: anything Dynamics is Strong)", "Azure", "Dynamics 365 Business Central");
notStrong("empty note with a Dynamics code", "Dynamics ERP Online", "");
notStrong("campaign name alone", "", "Opportunity Generated US~US~FY25~CMP~Modernize Accounting/ERP Systems with D365 Bus Central - VDS~SRAIM521867_22 US ALLIANCE PAPER");
strong("a question is not an inbound line (11/6: anything Dynamics is Strong)", "Dynamics CRM", "Is Dynamics CRM included with our E3?");
notStrong("Auto-DQ still wins", "", "Not interested. We would like Dynamics 365 Business Central later maybe but please unsubscribe us.");

// Per Jack (11/6): "anything to do with microsoft dynamics is a strong
// lead". The three cases above were Needs Review under the older
// new-platform test and are Strong now. What stays out: an empty note over a
// Dynamics code, a campaign name, and every Auto-DQ.
console.log(`${pass} / ${pass + fail}`);
if (fail) process.exit(1);
