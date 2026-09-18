import { parseSmcLead, parseCampaign, isRenewalCampaign } from "../../src/lib/smcLead";
import { classifySmc } from "../../src/lib/scanner2";
import samples from "../fixtures/smc-samples.json";
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d)); };

// A real lead (row 2 qualifies on an Azure gap) under different campaigns.
const lead = parseSmcLead((samples as string[])[2]);
const why = (camp: string) => classifySmc(lead, parseCampaign(camp), 25).why;

const normal = why("US~US~FY26~CMP~Expand Security - VDS~SRAIM638026_2");
ok("a normal campaign is folded into the reason", /FY26 Expand Security/.test(normal), normal);

for (const c of [
  "US~US~FY26~CMP~COE True Up 1~SRAIM419760",
  "US~US~FY26~CMP~EA Renewal Q2~SRAIM111111",
  "US~US~FY26~CMP~True-Up Motion~SRAIM222222",
  "US~US~FY26~CMP~Renewals Play~SRAIM333333",
]) {
  const w = why(c);
  const name = parseCampaign(c).name;
  ok(`renewal campaign left out: "${name}"`, !w.includes(name) && !/FY26/.test(w), w);
}
ok("the lead still qualifies with the campaign dropped", /Act Now/.test(why("US~US~FY26~CMP~COE True Up 1~SRAIM419760")));

// A stale renewal campaign still names itself, because there it IS the reason.
const stale = classifySmc(lead, parseCampaign("US~FY24~CMP~COE True Up 1~SRAIM419760"), 25).why;
ok("a stale campaign still names itself", /Stale campaign — FY24 COE True Up 1/.test(stale), stale);

ok("isRenewalCampaign is narrow", !isRenewalCampaign("Expand M365 Copilot") && !isRenewalCampaign("First Workload MW to Azure AVD") && isRenewalCampaign("COE True Up 1"));
console.log(`\n${pass}/${pass + fail} checks passed`);
if (fail) process.exit(1);
