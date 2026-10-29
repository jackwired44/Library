// Regression checks for the 2026-10-29 code review fixes. Each check is a
// defect a reviewer reproduced; it fails on the code before the fix.
import { newestRow, unscannedFix } from "../../src/lib/noteRefresh";
import { leadInputsFromNoSignal } from "../../src/lib/leadFiling";
import { parseRuleText, ruleParts, ruleMatches, factsForLead, isEmptyRule } from "../../src/lib/smartRules";
import { combineNotes, type StoredLead } from "../../src/lib/leadStore";
import { recycleOf, DEFAULT_RECYCLE_RULES } from "../../src/lib/recycle";
import { buildRosterIndex, apolloHitFor } from "../../src/lib/apolloRoster";
import { contactStateOf, withStatusOverride } from "../../src/lib/leadStatus";
import { localDay, arrivalOf } from "../../src/lib/leadFiling";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { c ? pass++ : (fail++, console.log(`  FAIL ${n}${d ? " — " + d : ""}`)); };

// 1. The note refresh reads the NEWEST saved CSV row, whatever the order.
const rows = [
  { at: "2026-09-01T12:00:00Z", file: "old.csv", fields: { "Product Area": "Dynamics 365" } },
  { at: "2026-10-20T12:00:00Z", file: "new.csv", fields: { "Product Area": "Azure" } },
];
ok("newest row when stored oldest-first", newestRow({ key: "k", segments: [], rows })?.file === "new.csv");
ok("newest row when stored newest-first", newestRow({ key: "k", segments: [], rows: [...rows].reverse() })?.file === "new.csv");

// 2. A customer's own lowercase "ask how" is not the generated ask tail.
const older = "(50) ▲ Customer wants to ask how much 40 E3 seats cost and needs a partner. Ask how they manage licensing today, in-house or through a partner.";
const combined = combineNotes(older, "(60) ▲ New note about Azure.", "2026-10-29");
ok("older note keeps the customer's 'ask how much'", /ask how much 40 E3 seats cost and needs a partner/.test(combined), combined);
ok("older note still drops the generated 'Ask how they manage…'", !/Ask how they manage/.test(combined.split("\n").slice(1).join("\n")), combined);

// 3. A hand-set Not interested rests 6 months, it never reads Ready at 22 days.
const base: StoredLead = {
  key: "e:a@x.com", source: "main", company: "X Co", contact: "Ann Lee", title: "", email: "a@x.com",
  phone: "", mobilePhone: "", productArea: "M365 / Azure", tier: "Strong Signal", notes: "", score: 70,
  firstSeenAt: "2026-07-01T00:00:00Z", lastSeenAt: "2026-07-01T00:00:00Z", sourceFiles: ["f.csv"], timesSeen: 1,
  apolloCheckedAt: "2026-10-01T00:00:00Z",
  apollo: { syncedAt: "2026-10-01T00:00:00Z", callCount: 0, outcomes: {}, lastOutcome: "", lastCallAt: "", callsUnknown: true,
    sequences: [{ name: "Jack Main Sequence", status: "finished", finishedAt: "2026-08-01" }] },
} as StoredLead;
const ended = recycleOf(base, DEFAULT_RECYCLE_RULES, "2026-10-29");
ok("sequence ended with no reply is Ready", ended.stage === "ready" && ended.why === "sequence-ended", JSON.stringify(ended));
ok("rest counts from the local day: Aug 1 + 22 = Aug 23", ended.recycleOn === "2026-08-23", ended.recycleOn);
const handNo = withStatusOverride(base, "not-interested", "2026-09-15T15:00:00Z");
const r = recycleOf(handNo, DEFAULT_RECYCLE_RULES, "2026-10-29");
ok("hand-set Not interested is resting, not ready", r.stage === "resting" && r.why === "not-interested", JSON.stringify(r));
ok("  and comes back 6 months after it was set", r.recycleOn === "2027-03-15", r.recycleOn);
const handNoNoApollo = withStatusOverride({ ...base, apollo: undefined } as StoredLead, "not-interested", "2026-09-15T15:00:00Z");
ok("hand-set Not interested with no Apollo data rests too", recycleOf(handNoNoApollo, DEFAULT_RECYCLE_RULES, "2026-10-29").stage === "resting");

// 4. Two different people with one name: a name-only lead matches neither.
const idx = buildRosterIndex([
  { key: "e:john@alpha.com", name: "John Smith", email: "john@alpha.com", company: "Alpha Inc", sequences: ["S1"], syncedAt: "" },
  { key: "e:john@beta.com", name: "John Smith", email: "john@beta.com", company: "Beta LLC", sequences: ["S2"], syncedAt: "" },
]);
ok("same name, different emails is ambiguous by name", apolloHitFor({ email: "", contact: "John Smith", company: "" }, idx) === null);
ok("  email still matches the right one", apolloHitFor({ email: "john@beta.com", contact: "John Smith", company: "Beta LLC" }, idx)?.sequences[0] === "S2");
const idx2 = buildRosterIndex([
  { key: "e:jane@alpha.com", name: "Jane Doe", email: "jane@alpha.com", company: "Alpha Inc", sequences: ["S1"], syncedAt: "" },
  { key: "x:jane doe", name: "Jane Doe", email: "", company: "Alpha Inc", sequences: ["S1"], syncedAt: "" },
]);
ok("same person seen with and without email is not ambiguous", apolloHitFor({ email: "", contact: "Jane Doe", company: "Alpha Inc" }, idx2) !== null);

// 5. Apollo ending a sequence as "Not interested" is a no, not "Contact made".
const noReason = { ...base, apollo: { ...base.apollo!, sequences: [{ name: "S", status: "finished", reason: "Not interested" }] } } as StoredLead;
ok("end reason Not interested -> contact state no", contactStateOf(noReason) === "no", contactStateOf(noReason));

// 6. A timestamp is filed under the local day it happened (TZ America/Chicago).
ok("8pm Central on Oct 31 is Oct 31, not Nov 1", localDay("2026-11-01T01:00:00Z") === "2026-10-31", localDay("2026-11-01T01:00:00Z"));
ok("a bare date passes through", localDay("2026-08-01") === "2026-08-01");
ok("arrival month follows the local day", arrivalOf({ ...base, firstSeenAt: "2026-11-01T01:00:00Z", sourceFiles: ["upload.csv"] }).month === "2026-10");


// 7. Needs Review / Bad Lead notes are scanned, never the raw CSV text.
const RAW = "Customer called about the office printers and phones, will follow up next month about general office needs and a new copier lease.";
const ns = leadInputsFromNoSignal([{ id: "nosignal-0-0", sourceFile: "f.csv", company: "Buckeye Pools", contact: "Andy Kummerer", title: "", email: "andy@buckeyepools.com", phone: "", notes: RAW, notesSummary: "" }])[0];
ok("a no-signal row stores a scanned note", ns.notes !== RAW && /^\u25BC No Dynamics, M365, Azure or licensing signal\./.test(ns.notes), ns.notes);
ok("  and keeps the raw text behind the PIN", ns.rawNotes === RAW);
const rawRec = { key: "k", segments: [{ at: "2026-10-01T00:00:00Z", file: "f.csv", text: RAW }] };
const storedNoSignal = { ...base, tier: "No signal", notes: RAW, apollo: undefined } as StoredLead;
const fixedNs = unscannedFix(storedNoSignal, rawRec);
ok("a stored no-signal lead with a raw note is rewritten", fixedNs.notes !== RAW && /^\u25BC /.test(fixedNs.notes), fixedNs.notes);
const oldBad = { ...base, tier: "Bad Leads", notes: "We are not interested at this time, happy with our current provider. They run Microsoft 365 E3 for 40 users.", apollo: undefined } as StoredLead;
const fixedBad = unscannedFix(oldBad, undefined);
ok("an old Bad Lead with a raw note and no saved row gets a scanned note", fixedBad.notes !== oldBad.notes && /^\(\d+\) /.test(fixedBad.notes), fixedBad.notes);
ok("  and keeps its grade", fixedBad.tier === "Bad Leads");
const dyn = { ...base, notes: "Wants Dynamics 365 Business Central (25 users).", productArea: "Dynamics 365" } as StoredLead;
ok("a scanned Dynamics line (no score by design) is left alone", unscannedFix(dyn, undefined) === dyn);
const csp = { ...base, source: "csp", tier: "Low priority", score: 12, notes: "Some pasted seller text about the account with no product named at all here.", apollo: undefined } as StoredLead;
const fixedCsp = unscannedFix(csp, undefined);
ok("a CSP lead with a raw note gets one scanned line, one mark", /^\(12\) \u25BC Nothing in the note qualified/.test(fixedCsp.notes) && (fixedCsp.notes.match(/[\u25B2\u25B8\u25BC\u2715]/g) || []).length === 1, fixedCsp.notes);

// 8. Ask for leads: plain topics and leftover words become a keyword search.
const ctx = { industries: [] as string[], today: new Date("2026-10-29T12:00:00") };
const sup = parseRuleText("leads that indicate ongoing support", ctx);
ok("'ongoing support' is not an empty rule", !isEmptyRule(sup), JSON.stringify(sup));
ok("  and reads as notes about ongoing support", ruleParts(sup).some((p) => p.label === "Notes: about ongoing support"), ruleParts(sup).map((p) => p.label).join(" | "));
const supLead = { ...base, notes: "(60) \u25B2 Wants Microsoft 365 Business Premium for 40 users.", apollo: undefined } as StoredLead;
const f = factsForLead(supLead, { industry: "", employees: null, hit: null, engaged: false });
ok("  matches a lead whose ORIGINAL note asks for a managed service partner", ruleMatches(sup, supLead, f, ctx.today, "looking for a managed service provider for ongoing it support"));
ok("  and not one that never says it", !ruleMatches(sup, supLead, f, ctx.today, "wants copilot licenses"));
const free = parseRuleText("printer lease", ctx);
ok("unrecognised words become keywords", free.keywords === "printer lease", JSON.stringify(free));
const sec = parseRuleText("strong signal leads with security needs not contacted in 30 days", ctx);
ok("topic + grade + stale combine", sec.grades?.[0] === "strong" && sec.contact === "stale" && /intune/.test(sec.keywords || ""), JSON.stringify(sec));
const dynAsk = parseRuleText("Uncontacted Dynamics leads from the last 30 days", ctx);
ok("existing presets are unchanged (no keywords added)", !dynAsk.keywords && dynAsk.contact === "never" && dynAsk.product?.[0] === "dynamics", JSON.stringify(dynAsk));

console.log(`review-fixes ${fail ? "FAIL" : "PASS"} ${pass}/${pass + fail}`);
if (fail) process.exit(1);
