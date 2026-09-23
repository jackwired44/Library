// The Custom Scanner's note has to say WHY TO CALL, and nothing else.
//
// Per Jack, escalating over three messages: "matched snippet for custom
// scanner needs to show what it is to call them about aside from being a
// match" → "we need to know what the pain point is and why to call not just
// everything" → and then, pasting a real row he rates highly, "this is a
// great lead but we need to reconstruct it and get rid of what is not
// stated or indicated in the file."
//
// The honest constraint, measured on his real 13,106-row export: only 86 of
// 1,114 High rows carry a stated Need at all, and only 30 of those are a
// sentence rather than a product name. So a real pain point exists on ~3% of
// rows. On the other 92% the only truthful "why now" is Microsoft's own
// propensity read. Inventing anything more pain-shaped is the exact defect
// fixed on the Main Scanner (see snippet-truth).
import {
  callAngle, parseSmcLead, tidyBantValue, productLineFor,
} from "../../src/lib/smcLead";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { c ? (pass++, console.log("  PASS " + n)) : (fail++, console.log(`  FAIL ${n}${d ? " — " + d : ""}`)); };

const PROP = "Product Propensity Details (as pulled from Cloud Ascent on 2026-06-27): "
  + "- Azure: Act Now (High Fit; High Prioritization Index) "
  + "- D365 Sales Pro: Evaluate (Medium Fit; Medium Prioritization Index) ";
const OWNS = "Product Ownership Details: - Has O365: Yes - Has M365: Yes - Has Azure: No ";

console.log("\n== the note names ONE area, and leads with the instruction ==");
// Jack's own pasted lead, with the ownership his real row carries. 404
// characters before this work; the need names Microsoft 365 and Copilot, so
// M365 is the area regardless of what the propensity model ranks first.
const JACK_OWNS = "Product Ownership Details: - Has O365: No - Has M365: No - Has Azure: Yes ";
const JACK = parseSmcLead("Company Name: Acme " + PROP + JACK_OWNS
  + "Budget:30000 Authority Joseph Hickey Need: Copilot + EntraID P2 + Microsoft 365 E3 Timeline: 11/2/2026 ");
const jack = callAngle(JACK);
console.log("  " + jack);
ok("opens with the instruction, not a stage word", /^Pitch M365 /.test(jack), jack);
ok("the stated need picks the area, not the model", !/Azure \(/.test(jack), jack);
ok("quotes the need verbatim", /stated need: "Copilot \+ EntraID P2 \+ Microsoft 365 E3"/.test(jack), jack);
ok("says what they run", /runs Azure/.test(jack), jack);
ok("names no second product", !/ · then /.test(jack), jack);
ok("is under 120 characters", jack.length < 120, String(jack.length));

console.log("\n== everything Jack asked to be rid of is gone ==");
for (const [what, re] of [
  ["the budget", /budget/i],
  ["the authority name", /Joseph Hickey/],
  ["the timeline", /11\/2\/2026/],
  ["the Microsoft campaign", /pitching|MS play|FY2\d/i],
  ["the engine's own verdict vocabulary", /TOP QUALITY|whitespace|High prioritization|Act Now \+ High/i],
  ["the SMC segment", /SMC (Upper )?Medium/i],
] as [string, RegExp][]) {
  ok(`no ${what}`, !re.test(jack), jack);
}

console.log("\n== a long narrative need gets the room, and is visibly clipped ==");
const LONG = "PRC is interested in understanding how Microsoft Copilot can enhance productivity, information retrieval, and workflow efficiency across Microsoft 365. Key discussion points included security considerations, data access boundaries, and licensing implications for a phased rollout across several business units.";
const long = callAngle(parseSmcLead("Company Name: Acme " + PROP + OWNS + "Need: " + LONG + " "));
ok("keeps far more than a one-line clip would", long.length > 200, String(long.length));
ok("still cannot reproduce the 2,010-char note", long.length < 400, String(long.length));
ok("a clip is visibly elliptical", !/…/.test(long) || /…"/.test(long), long.slice(-60));
ok("the instruction still comes before the quote", long.indexOf("stated need") > 0 && /^(Pitch|Expand) /.test(long), long.slice(0, 40));

console.log("\n== no stated need: the honest why-now, per Jack ==");
// "state the buy signal and what they already run on."
const bare = callAngle(parseSmcLead("Company Name: Acme " + PROP + OWNS));
console.log("  " + bare);
ok("one area, named, with the buy signal behind it", /^Pitch Azure \(Act Now, High fit\)/.test(bare), bare);
ok("what they run", /runs O365, M365/.test(bare), bare);
ok("no competing second product", !/D365 Sales Pro/.test(bare), bare);
ok("invents no pain", !/stated need/.test(bare), bare);
ok("is under 90 characters", bare.length < 90, String(bare.length));

// The three defects measured on the real 13,106-row export, each now an
// invariant rather than a one-off fix. Counts are from that file.
console.log("\n== never pitch something they already run (560 real rows did) ==");
const OWNS_M365 = "Product Ownership Details: - Has O365: Yes - Has M365: Yes - Has Azure: Yes ";
const M365_ONLY = "Product Propensity Details: - M365: Act Now (High Fit; High Prioritization Index) ";
const ownIt = callAngle(parseSmcLead("Company Name: Acme " + M365_ONLY + OWNS_M365));
console.log("  " + ownIt);
ok("an owned area is an expand, not a pitch", /^Expand M365 /.test(ownIt), ownIt);
ok("and it is not also listed under runs", !/runs[^·]*M365/.test(ownIt), ownIt);

console.log("\n== 'Has D365' is one flag over three products, so it is never an expand ==");
const OWNS_D365 = "Product Ownership Details: - Has O365: Yes - Has D365: Yes ";
const BC_ONLY = "Product Propensity Details: - D365 BC: Act Now (High Fit; High Prioritization Index) ";
const bc = callAngle(parseSmcLead("Company Name: Acme " + BC_ONLY + OWNS_D365));
console.log("  " + bc);
ok("a D365 owner is still new to Business Central", /^Pitch D365 BC /.test(bc), bc);
ok("the Dynamics they do run is stated instead", /runs .*D365/.test(bc), bc);

console.log("\n== the stated need outranks the model, but only for a line we sell ==");
const wantBC = callAngle(parseSmcLead("Company Name: Acme " + PROP + OWNS
  + "Need: Looking at Business Central to replace our ERP "));
ok("a named product wins over the propensity rank", /^Pitch D365 BC /.test(wantBC), wantBC);
const wantFnO = callAngle(parseSmcLead("Company Name: Acme " + PROP + OWNS
  + "Need: supply chain planning overhaul "));
ok("a product on a line we do not sell falls back to the model", /^Pitch Azure /.test(wantFnO), wantFnO);

console.log("\n== the owned list is capped, never a four-product inventory ==");
const ALL = "Product Ownership Details: - Has O365: Yes - Has M365: Yes - Has Azure: Yes - Has D365: Yes ";
const capped = callAngle(parseSmcLead("Company Name: Acme " + BC_ONLY + ALL));
console.log("  " + capped);
const runsList = (/runs ([^·]+)/.exec(capped)?.[1] ?? "").trim().split(", ");
ok("at most two products listed", runsList.length <= 2, runsList.join("|"));
ok("the one on the pitched line comes first", runsList[0] === "D365", runsList.join("|"));


// Per Jack, on a Copilot/automation lead: "this is not strong for dynamics."
// productLineFor read the propensity matrix alone, with Dynamics winning any
// tie, and never looked at the stated need - so a lead whose need said
// Copilot got FILED under Dynamics 365 while its own note read "Expand
// M365", and landed in the Dynamics CSV. Measured on the real 13,106-row
// export: 56 scored rows filed against their own stated need, all of them
// wrongly Dynamics. The note and the file must agree.
console.log("\n== a stated need decides the download file, not just the note ==");
const DYN_PROP = "Product Propensity Details: - D365 Sales Pro: Act Now (High Fit; High Prioritization Index) "
  + "- Azure: Act Now (High Fit; High Prioritization Index) ";
const lineFor = (need: string) =>
  productLineFor(parseSmcLead("Company Name: Acme " + DYN_PROP + OWNS + (need ? `Need: ${need} ` : "")));
for (const [need, want] of [
  ["Evaluate opportunities for automation using Copilot and Copilot Studio", "M365 / Azure"],
  ["Copilot + EntraID P2 + Microsoft 365 E3", "M365 / Azure"],
  ["Copilot Chat Adoption", "M365 / Azure"],
  ["Licensing consultation", "M365 / Azure"],
  // A need naming a Dynamics product keeps the row on Dynamics - the need
  // decides the line, it does not simply push everything to M365.
  ["Business Central rollout", "Dynamics 365"],
  ["Dynamics CRM", "Dynamics 365"],
  // Dynamics is tested before M365, so a need listing both wins for Dynamics.
  ["Copilot M365 E5 and Dynamics 365 Business Central", "Dynamics 365"],
] as [string, string][]) {
  ok(`${want.padEnd(12)} <- ${JSON.stringify(need.slice(0, 44))}`, lineFor(need) === want, String(lineFor(need)));
}
// No need at all: unchanged, the model still decides.
ok("no stated need still falls through to the propensity model", lineFor("") === "Dynamics 365", String(lineFor("")));
// A need naming nothing recognisable must not hijack the line either.
ok("an unrecognisable need does not change the line",
   lineFor("Discovery call scheduled for next week") === "Dynamics 365",
   String(lineFor("Discovery call scheduled for next week")));
// The note and the file now agree on the same lead.
const both = parseSmcLead("Company Name: Acme " + DYN_PROP + OWNS + "Need: Copilot Chat Adoption ");
ok("the note says M365 and the file says M365",
   /M365/.test(callAngle(both)) && productLineFor(both) === "M365 / Azure",
   `${callAngle(both)} | ${productLineFor(both)}`);

console.log("\n== nothing to say beats saying something made up ==");
ok("empty in, empty out", callAngle(parseSmcLead("")) === "" && callAngle(parseSmcLead("NULL")) === "");

console.log("\n== a BANT value ends where the next field begins ==");
const BLEED: [string, string][] = [
  ["4/2/2027 Partner Name: SISL Infotech Comments Copilot", "4/2/2027"],
  ["2 months Next Step: follow up", "2 months"],
  ["90000", "90000"],
  ["Cloud & Security Evaluation", "Cloud & Security Evaluation"],
  ["USD 1000.00 CSP ANNUAL Renewal", "USD 1000.00 CSP ANNUAL Renewal"],
  ["ratio 3:1 improvement", "ratio 3:1 improvement"],
];
BLEED.forEach(([input, want]) => {
  const got = tidyBantValue(input);
  ok(`${JSON.stringify(input.slice(0, 38))} -> ${JSON.stringify(want)}`, got === want, JSON.stringify(got));
});

console.log(`\n${pass}/${pass + fail} checks passed`);
if (fail) process.exit(1);
