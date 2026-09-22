// The Custom Scanner's partner lane, and the download order that goes with
// it. Pure logic — no browser — because both are decisions the engine makes
// before anything renders.
//
// Per Jack: "For custom scanner is there any indications of partner
// involvement for the leads being qualified there." There is: the Cloud
// Ascent blob carries a "Partner:" field on about 2.7% of rows. It was
// parsed and then thrown away. This asserts what it now does, and — just
// as importantly — what it must NOT do to the 97% that state nothing.
import {
  cleanPartner, partnerPostureOf, scoreSmcLead, compareSmcScores, parseSmcLead, parseCampaign,
  DEFAULT_SMC_SCORE_RULES, DEFAULT_SMC_WEIGHTS, resolveSmcRules, SMC_PARTNER_META,
  type SmcLead,
} from "../../src/lib/smcLead";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { c ? (pass++, console.log("  PASS " + n)) : (fail++, console.log(`  FAIL ${n}${d ? " — " + d : ""}`)); };
const leadWith = (partner: string) => ({ bant: { partner } } as unknown as SmcLead);
const posture = (v: string) => partnerPostureOf(leadWith(cleanPartner(v)));

console.log("\n== cleanPartner strips what is not a name ==");
// Every one of these is a real value from Jack's own 13,106-row export.
ok("drops a trailing call log", cleanPartner("Microsoft Corporation F2 - Comp F1 TCR 2 - E F1 - Comp") === "Microsoft Corporation",
   cleanPartner("Microsoft Corporation F2 - Comp F1 TCR 2 - E F1 - Comp"));
ok("drops a POC block with a phone and emails",
   cleanPartner("Trusted Tech Team POC: 9497346400 David, Wani dwani@247hotels.com") === "Trusted Tech Team",
   cleanPartner("Trusted Tech Team POC: 9497346400 David, Wani dwani@247hotels.com"));
ok("drops a trailing TPID", cleanPartner("3RT Networks 6647767") === "3RT Networks", cleanPartner("3RT Networks 6647767"));
ok("drops a GUID entirely", cleanPartner("ec5901d3-3e7a-4753-a5cb-c2480402e823") === "");
ok("drops a placeholder entirely", cleanPartner("pendiente confirmar") === "" && cleanPartner("TBD") === "");
ok("keeps a plain name untouched", cleanPartner("Rackspace Technology") === "Rackspace Technology");
ok("keeps punctuation inside a real name", cleanPartner("GoDaddy.com, LLC") === "GoDaddy.com, LLC");
// readLead joins two notes columns with " \u00b7 ". A "Partner:" that runs to
// the end of one column would otherwise swallow the whole of the next one,
// which turned a plain "Microsoft Corporation" into a held account. Caught
// live in a browser, not by reading the code.
ok("cuts at the notes-column join separator",
   cleanPartner("Microsoft Corporation \u00b7 second description column") === "Microsoft Corporation",
   cleanPartner("Microsoft Corporation \u00b7 second description column"));
ok("a swallowed second column does not turn an open lane into a held one",
   posture("Microsoft Corporation \u00b7 second description column") === "open");
ok("keeps the prose that actually matters",
   cleanPartner("No partner identified yet. Opportunity to introduce a migration partner")
     === "No partner identified yet. Opportunity to introduce a migration partner");

console.log("\n== posture: open, held, or honestly unknown ==");
ok("nothing stated is unknown, never held", posture("") === "unknown");
ok("Microsoft Corporation is an open lane", posture("Microsoft Corporation") === "open");
ok("Microsoft corp. is an open lane", posture("Microsoft corp.") === "open");
ok("Direct is an open lane", posture("Direct") === "open" && posture("Microsoft Direct") === "open");
ok("'no partner involved' prose is an open lane", posture("Web Direct (Microsoft Corporation); no partner involved.") === "open");
ok("'No partner identified yet' is an open lane", posture("No partner identified yet. Opportunity to introduce a migration partner") === "open");
ok("a named reseller is held", posture("Rackspace Technology") === "held" && posture("SHI International Corp") === "held");
// The one that would be easy to get wrong: a partner whose name merely
// STARTS with Microsoft is still a partner holding the account.
ok("Microsoft followed by a real partner name is held",
   posture("Microsoft Corporation SkyView Technology, Inc.") === "held",
   posture("Microsoft Corporation SkyView Technology, Inc."));
ok("a GUID does not read as held", posture("ec5901d3-3e7a-4753-a5cb-c2480402e823") === "unknown");
ok("every posture has display copy", (["open", "held", "unknown"] as const).every((k) => !!SMC_PARTNER_META[k].label && !!SMC_PARTNER_META[k].hint));

console.log("\n== the score moves only where a partner is stated ==");
const BLOB = "Company Name: Alpine Freight Product Propensity Details (as pulled from Cloud Ascent on 2026-06-27): "
  + "Azure - Act Now - High Fit - High Prioritization Index Product Ownership Details: - Has O365: Yes - Has Azure: No "
  + "Need: modernizing the warehouse stack ";
const rules = resolveSmcRules(undefined);
const reach = { hasPhone: true, hasEmail: true, hasTitle: true };
const camp = parseCampaign("US~US~FY26~CMP~Expand Security - VDS~SRAIM638026_2");
const scoreOf = (extra: string, adjust = DEFAULT_SMC_SCORE_RULES.partnerAdjust) =>
  scoreSmcLead(parseSmcLead(BLOB + extra), camp, rules, DEFAULT_SMC_WEIGHTS, reach, adjust);

const silent = scoreOf("");
const open = scoreOf("Partner: Microsoft Corporation ");
const held = scoreOf("Partner: Rackspace Technology ");
ok("a row that states no partner is untouched", silent.partnerAdjust === 0 && silent.partnerPosture === "unknown",
   `${silent.partnerAdjust} / ${silent.partnerPosture}`);
ok("an open lane gains exactly the configured points",
   open.score === Math.min(100, silent.score + DEFAULT_SMC_SCORE_RULES.partnerAdjust) && open.partnerAdjust > 0,
   `${silent.score} -> ${open.score}`);
ok("a held account loses exactly the configured points",
   held.score === Math.max(0, silent.score - DEFAULT_SMC_SCORE_RULES.partnerAdjust) && held.partnerAdjust < 0,
   `${silent.score} -> ${held.score}`);
ok("the held partner's name is carried for display", held.partnerName === "Rackspace Technology", held.partnerName);
ok("setting the adjustment to 0 turns it off completely",
   scoreOf("Partner: Rackspace Technology ", 0).score === silent.score
   && scoreOf("Partner: Microsoft Corporation ", 0).score === silent.score);
ok("the breakdown says why the score moved",
   held.breakdown.some((b) => /Rackspace/.test(b)) && open.breakdown.some((b) => /no partner on it/.test(b)),
   JSON.stringify(held.breakdown.slice(-1)));
ok("the score never leaves 0-100", open.score <= 100 && held.score >= 0);
// A negative or absurd adjustment must not invert the lane.
ok("a negative configured adjustment is clamped to 0, not inverted",
   scoreOf("Partner: Rackspace Technology ", -20).score === silent.score);

console.log("\n== download order: pinned, then flagged, then score ==");
const mk = (score: number, statedNeed = false, perfect = false) =>
  ({ score, statedNeed, perfect } as ReturnType<typeof scoreSmcLead>);
const sorted = [mk(30), mk(90), mk(10, true), mk(55), mk(20, true, true), mk(70)]
  .slice().sort(compareSmcScores).map((s) => s.score);
ok("pinned first, then flagged, then descending score",
   JSON.stringify(sorted) === JSON.stringify([20, 10, 90, 70, 55, 30]), JSON.stringify(sorted));
ok("a missing score sorts last, never as zero",
   compareSmcScores(mk(5), undefined) < 0 && compareSmcScores(undefined, mk(5)) > 0);

console.log(`\n${pass}/${pass + fail} checks passed`);
if (fail) process.exit(1);
