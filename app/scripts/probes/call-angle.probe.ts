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
  callAngle, parseSmcLead, tidyBantValue,
} from "../../src/lib/smcLead";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { c ? (pass++, console.log("  PASS " + n)) : (fail++, console.log(`  FAIL ${n}${d ? " — " + d : ""}`)); };

const PROP = "Product Propensity Details (as pulled from Cloud Ascent on 2026-06-27): "
  + "- Azure: Act Now (High Fit; High Prioritization Index) "
  + "- D365 Sales Pro: Evaluate (Medium Fit; Medium Prioritization Index) ";
const OWNS = "Product Ownership Details: - Has O365: Yes - Has M365: Yes - Has Azure: No ";

console.log("\n== a stated need leads, quoted whole ==");
// Jack's own pasted lead. 404 characters before this change.
const JACK = parseSmcLead("Company Name: Acme " + PROP + OWNS
  + "Budget:30000 Authority Joseph Hickey Need: Copilot + EntraID P2 + Microsoft 365 E3 Timeline: 11/2/2026 ");
const jack = callAngle(JACK);
console.log("  " + jack);
ok("quotes the need verbatim", /Needs: "Copilot \+ EntraID P2 \+ Microsoft 365 E3"/.test(jack), jack);
ok("names ONE product to pitch", /Azure whitespace/.test(jack) && !/D365 Sales Pro whitespace/.test(jack), jack);
ok("says what they already run", /already on O365, M365/.test(jack), jack);
ok("says where they go next", /then D365 Sales Pro \(Evaluate\)/.test(jack), jack);
ok("is under 150 characters", jack.length < 150, String(jack.length));

console.log("\n== everything Jack asked to be rid of is gone ==");
for (const [what, re] of [
  ["the budget", /budget/i],
  ["the authority name", /Joseph Hickey/],
  ["the timeline", /11\/2\/2026/],
  ["the Microsoft campaign", /pitching|MS play|FY2\d/i],
  ["the engine's own verdict vocabulary", /TOP QUALITY|whitespace account|High prioritization|Act Now \+ High/i],
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

console.log("\n== no stated need: the honest why-now, per Jack ==");
// "state the buy signal and what they already run on and maybe where they
// may go direction wise."
const bare = callAngle(parseSmcLead("Company Name: Acme " + PROP + OWNS));
console.log("  " + bare);
ok("buy signal leads", /^Act Now on Azure/.test(bare), bare);
ok("what they run", /already on O365, M365/.test(bare), bare);
ok("direction", /then D365 Sales Pro \(Evaluate\)/.test(bare), bare);
ok("invents no pain", !/Needs:/.test(bare), bare);
ok("is under 120 characters", bare.length < 120, String(bare.length));

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
