// Does the SMC parser actually read Jack's real rows?
// Every sample below is verbatim from his own export.
import { parseSmcLead, parseCampaign, actNowGaps, describeLead, fiscalYearNumber } from "../../src/lib/smcLead";
import samples from "../fixtures/smc-samples.json";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d)); };

console.log("\n=== description blob ===");

// 1. Multi-contact company, stray "rCompany Name" in the real data.
{
  const l = parseSmcLead(samples[0]);
  ok("TPID read", l.tpids[0] === "93634874", JSON.stringify(l.tpids));
  ok("company read despite stray 'r' prefix", l.company === "CARING ENDPOINTS", JSON.stringify(l.company));
  ok("website read", l.website === "https://www.imagingendpoints.com", l.website);
  ok("both contacts read", l.contacts.length === 2, String(l.contacts.length));
  ok("contact 1 name+title", l.contacts[0].firstName === "Fernando" && l.contacts[0].lastName === "Lopez" && l.contacts[0].title === "VP of IT", JSON.stringify(l.contacts[0]));
  ok("contact 1 email", l.contacts[0].email === "flopez@imagingendpoints.com", l.contacts[0].email);
  ok("contact 2 read", l.contacts[1].firstName === "Satendra" && l.contacts[1].title === "IT Manager", JSON.stringify(l.contacts[1]));
}

// 2. Multiple TPIDs, trailing empty Linkedin.
{
  const l = parseSmcLead(samples[1]);
  ok("multiple TPIDs read", l.tpids.length === 2 && l.tpids[0] === "64111102", JSON.stringify(l.tpids));
  ok("company read", l.company === "SOFVARE", l.company);
  ok("both contacts read", l.contacts.length === 2, String(l.contacts.length));
}

// 3. Three contacts + full propensity + ownership.
{
  const l = parseSmcLead(samples[2]);
  ok("three contacts read", l.contacts.length === 3, String(l.contacts.length));
  ok("SMC type read", l.smcType === "Medium", l.smcType);
  ok("all six propensity rows read", l.propensity.length === 6, String(l.propensity.length));
  const azure = l.propensity.find((p) => p.product === "Azure")!;
  ok("Azure = Act Now / High / Very Low", azure.stage === "Act Now" && azure.fit === "High" && azure.index === "Very Low", JSON.stringify(azure));
  const m365 = l.propensity.find((p) => p.product === "M365")!;
  ok("M365 = Educate / Very Low", m365.stage === "Educate" && m365.fit === "Very Low", JSON.stringify(m365));
  ok("ownership read", l.owns.O365 === true && l.owns.Azure === false && l.owns.D365 === false, JSON.stringify(l.owns));
  ok("#PROFILED tag read", l.tags.includes("#PROFILED"), JSON.stringify(l.tags));
  // The whole point: Act Now + High Fit + does NOT own it.
  const gaps = actNowGaps(l);
  ok("Azure is an Act-Now gap (high fit, not owned)", gaps.some((g) => g.product === "Azure"), JSON.stringify(gaps.map((g) => g.product)));
}

// 4. Propensity-only row, no contacts.
{
  const l = parseSmcLead(samples[3]);
  ok("propensity-only row parses", l.propensity.length === 6 && l.contacts.length === 0, `${l.propensity.length}/${l.contacts.length}`);
  const gaps = actNowGaps(l);
  ok("Azure gap found (Act Now/High, Has Azure: No)", gaps.some((g) => g.product === "Azure"), JSON.stringify(gaps.map((g) => g.product)));
  ok("M365 NOT a gap — they already own it", !gaps.some((g) => g.product === "M365"), JSON.stringify(gaps.map((g) => g.product)));
}

// 5. BANT long form with bullets and en-dashes.
{
  const l = parseSmcLead(samples[12]);
  ok("BANT authority read", /George Morris/.test(l.bant.authority || ""), l.bant.authority);
  ok("BANT need read", /secure, native AI/.test(l.bant.need || ""), l.bant.need);
  ok("TPID still read past the BANT preamble", l.tpids[0] === "12489418", JSON.stringify(l.tpids));
  ok("SMC type with spaces read", l.smcType === "SMC NonAE Covered", l.smcType);
}

// 6. BANT short form.
{
  const l = parseSmcLead(samples[6]);
  ok("short-form BANT budget", l.bant.budget === "200", l.bant.budget);
  ok("short-form BANT authority", l.bant.authority === "Naveen Sathiya", l.bant.authority);
  ok("Business Name read as company", l.company === "Ana Data", l.company);
}

// 7. [PPA] contact block + profiler comment.
{
  const l = parseSmcLead(samples[11]);
  ok("[PPA] contacts read", l.contacts.length === 2, String(l.contacts.length));
  ok("[PPA] contact email read", l.contacts.some((c) => c.email === "jhoeme@bhccu.org"), JSON.stringify(l.contacts.map((c) => c.email)));
  ok("employee count read", l.employeesMin === 130 && l.employeesMax === 130, `${l.employeesMin}/${l.employeesMax}`);
  ok("Industry 'Unknown' treated as blank", l.industry === "", JSON.stringify(l.industry));
}

// 8. Degenerate rows.
{
  ok("literal NULL is empty", parseSmcLead(samples[9]).empty);
  ok("empty string is empty", parseSmcLead("").empty);
  const thin = parseSmcLead(samples[4]);
  ok("TPID-only row is not empty but has no contacts", !thin.empty && thin.contacts.length === 0 && thin.tpids[0] === "126649047", JSON.stringify(thin.tpids));
}

console.log("\n=== campaign code ===");
const CAMPAIGNS: [string, string, string, string][] = [
  ["US~US~FY26~CMP~Fabric as Next Logical Workload - VDS~SRAIM638026_6", "FY26", "Fabric as Next Logical Workload", "SRAIM638026_6"],
  ["US~US~FY25~CMP~First Workload MW to Azure AVD - VDS~SRAIM521867_7", "FY25", "First Workload MW to Azure AVD", "SRAIM521867_7"],
  ["US~US~FY25~CMP~Modernize Accounting/ERP Systems with D365 Bus Central - VDS~SRAIM521867_22", "FY25", "Modernize Accounting/ERP Systems with D365 Bus Central", "SRAIM521867_22"],
  ["US~FY24~CMP~COE True Up 1~SRAIM419760", "FY24", "COE True Up 1", "SRAIM419760"],
  ["US~US~FY26~CMP~Expand M365 Copilot - VDS~SRAIM638026_10", "FY26", "Expand M365 Copilot", "SRAIM638026_10"],
  ["US~US~FY25~CMP~Partner CoSell~SRAIM562011", "FY25", "Partner CoSell", "SRAIM562011"],
];
for (const [raw, fy, name, id] of CAMPAIGNS) {
  const c = parseCampaign(raw);
  ok(`campaign: ${name.slice(0, 42)}`, c.fiscalYear === fy && c.name === name && c.id === id,
     JSON.stringify({ fy: c.fiscalYear, name: c.name, id: c.id }));
}
{
  const free = parseCampaign("Concentrix - Manila - Dev Tools - Button Chat");
  ok("free-text campaign kept as the name", !free.empty && free.name.startsWith("Concentrix"), free.name);
  ok("NULL campaign is empty", parseCampaign("NULL").empty);
  ok("FY sorts numerically for recency", fiscalYearNumber(parseCampaign(CAMPAIGNS[0][0])) === 26 && fiscalYearNumber(parseCampaign(CAMPAIGNS[3][0])) === 24);
}

console.log("\n=== what a rep would read ===");
for (const i of [2, 3, 12]) {
  console.log(`  · ${describeLead(parseSmcLead(samples[i]))}`);
}

console.log(`\n${pass}/${pass + fail} checks passed`);
if (fail) process.exit(1);
