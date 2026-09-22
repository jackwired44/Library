// The Custom Scanner's note has to say what to CALL them about.
//
// Per Jack: "matched snippet for custom scanner needs to show what it is
// to call them about aside from being a match." It used to open with
// classification metadata — "Score 83 — High priority · Act Now + High+
// Fit, not owned: Azure · High prioritization: Azure · SMC Medium" — which
// says why the ENGINE liked the row and nothing a rep can open with.
//
// Everything in the angle is lifted from the blob's own fields, and a
// stated Need is QUOTED, never paraphrased — same rule the Main Scanner's
// snippets follow, for the same reason: a note read down the phone has to
// be true.
import { callAngle, parseSmcLead, parseCampaign, tidyBantValue } from "../../src/lib/smcLead";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { c ? (pass++, console.log("  PASS " + n)) : (fail++, console.log(`  FAIL ${n}${d ? " — " + d : ""}`)); };

const PROP = "Product Propensity Details (as pulled from Cloud Ascent on 2026-06-27): "
  + "- Azure: Act Now (High Fit; High Prioritization Index) "
  + "- M365: Nurture (Low Fit; Low Prioritization Index) ";
const OWNS = "Product Ownership Details: - Has O365: Yes - Has M365: Yes - Has Azure: No ";
const camp = parseCampaign("US~US~FY26~CMP~Expand Security - VDS~SRAIM638026_2");

console.log("\n== the angle leads with something you can say ==");
const full = callAngle(parseSmcLead(
  "Company Name: Alpine Freight " + PROP + OWNS
  + "Budget: 90000 Authority: Dana Reyes Need: Copilot+Security Timeline: 11/2/2026 "), camp);
console.log("  " + full);
ok("quotes the stated need verbatim", /They said they need: "Copilot\+Security"/.test(full), full);
ok("names what they can buy and do not have", /Ready to buy Azure, not on it yet/.test(full), full);
ok("names what they already run", /Already runs O365, M365/.test(full), full);
ok("names who to ask for", /ask for Dana Reyes/.test(full), full);
ok("carries budget and timeline", /budget 90000/.test(full) && /timeline 11\/2\/2026/.test(full), full);
ok("names the Microsoft play", /already pitching them "Expand Security"/.test(full), full);
ok("does NOT open with a score", !/^Score/.test(full), full);
ok("does NOT open with Cloud Ascent jargon", !/^Act Now \+/.test(full), full);

console.log("\n== no stated need: still says what to pitch ==");
const noNeed = callAngle(parseSmcLead("Company Name: Borden Labs " + PROP + OWNS), camp);
console.log("  " + noNeed);
ok("falls back to the whitespace product", /Ready to buy Azure, not on it yet/.test(noNeed), noNeed);
ok("does not invent a need", !/They said they need/.test(noNeed), noNeed);

console.log("\n== an empty blob gets no angle rather than a fabricated one ==");
ok("empty in, empty out", callAngle(parseSmcLead("")) === "" && callAngle(parseSmcLead("NULL")) === "");

console.log("\n== a BANT value ends where the next field begins ==");
// Real bleed from Jack's export: the Timeline swallowed two more fields
// because field() only stops at labels it knows, and "Partner Name:" was
// not one. Cutting at anything that LOOKS like a label fixes the class.
const BLEED: [string, string][] = [
  ["4/2/2027 Partner Name: SISL Infotech Comments Copilot", "4/2/2027"],
  ["2 months Next Step: follow up", "2 months"],
  ["90000", "90000"],
  ["Cloud & Security Evaluation", "Cloud & Security Evaluation"],
  ["USD 1000.00 CSP ANNUAL Renewal", "USD 1000.00 CSP ANNUAL Renewal"],
  // Must NOT cut: a plain colon inside a real value.
  ["ratio 3:1 improvement", "ratio 3:1 improvement"],
];
BLEED.forEach(([input, want]) => {
  const got = tidyBantValue(input);
  ok(`${JSON.stringify(input.slice(0, 40))} -> ${JSON.stringify(want)}`, got === want, JSON.stringify(got));
});

console.log(`\n${pass}/${pass + fail} checks passed`);
if (fail) process.exit(1);
