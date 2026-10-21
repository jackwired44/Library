// Smart rules — lib/smartRules.ts. Per Jack: "pull up and create a list of
// all uncontacted leads around dynamics for the last 30 days" and "strong
// signal based leads that havent been contracted in x amount of days".
import { parseRuleText, ruleFromJson, ruleFromCompletion, ruleMatches, factsForLead, describeRule, ruleParts, withoutKeys, quarterOf, rulePrompt, isEmptyRule, type SmartRule } from "../../src/lib/smartRules";
import type { StoredLead } from "../../src/lib/leadStore";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { pass++; console.log("  ok   " + n); } else { fail++; console.log(`  FAIL ${n}${d ? " — " + d : ""}`); } };

const TODAY = new Date("2026-10-21T12:00:00Z");
const ctx = { industries: ["Manufacturing", "Hospital & Health Care", "Construction"], today: TODAY };
type Extra = { calls?: number; emails?: number; seq?: { name: string; status: string; addedAt?: string; reason?: string }[]; lastCall?: string };
const lead = (o: Partial<StoredLead> & Extra = {}): StoredLead => {
  const { calls, emails, seq, lastCall, ...rest } = o;
  const hasApollo = calls !== undefined || emails !== undefined || seq !== undefined;
  return {
    key: rest.email || "ada@acme.com", source: "main", company: "Acme", contact: "Ada Brant", title: "CFO", email: "ada@acme.com", phone: "", mobilePhone: "",
    productArea: "Dynamics 365", tier: "Strong Signal", notes: "(70) ▲ Wants Dynamics 365 Business Central (25 users).", score: 70,
    firstSeenAt: "2026-10-10T12:00:00Z", lastSeenAt: "2026-10-10T12:00:00Z", sourceFiles: ["Book10-10.csv"], timesSeen: 1, receivedOn: "2026-10-10",
    ...(hasApollo ? { apollo: { syncedAt: "2026-10-19", sequences: (seq ?? []).map((s) => ({ step: null, ...s })), callCount: calls ?? 0, emailCount: emails ?? 0, outcomes: calls ? { "No Answer": calls } : {}, lastOutcome: "", lastCallAt: lastCall ?? "" } } : {}),
    ...rest,
  } as StoredLead;
};
const facts = (l: StoredLead, x: Partial<{ industry: string; employees: number | null; engaged: boolean }> = {}) =>
  factsForLead(l, { industry: x.industry ?? "", employees: x.employees ?? null, hit: null, engaged: x.engaged ?? false });
const match = (r: SmartRule, l: StoredLead, x = {}) => ruleMatches(r, l, facts(l, x), TODAY);

console.log("\n== reading Jack's own request ==");
let r = parseRuleText("pull up and create a list of all uncontacted leads around dynamics for the last 30 days", ctx);
ok("Dynamics", JSON.stringify(r.product) === '["dynamics"]', JSON.stringify(r));
ok("never contacted", r.contact === "never");
ok("received in the last 30 days", r.arrivedWithinDays === 30);
ok("nothing else guessed", !r.grades && !r.scanners && !r.reps && !r.keywords, JSON.stringify(r));
r = parseRuleText("strong signal leads that havent been contacted in 45 days", ctx);
ok("not contacted in 45 days", r.contact === "stale" && r.staleDays === 45, JSON.stringify(r));
ok("  and Strong Signal", JSON.stringify(r.grades) === '["strong"]');
ok("  the 45 days is not read as a receive window", !r.arrivedWithinDays, JSON.stringify(r));
r = parseRuleText("m365 azure leads in manufacturing with 50-500 employees, not in a sequence, carly", ctx);
ok("M365 / Azure", JSON.stringify(r.product) === '["m365"]', JSON.stringify(r));
ok("industry from the known list", JSON.stringify(r.industries) === '["Manufacturing"]');
ok("employee range", r.minEmployees === 50 && r.maxEmployees === 500);
ok("not active in a sequence", r.excludeActive === true);
ok("Carly's", JSON.stringify(r.reps) === '["Carly"]');
r = parseRuleText("needs review leads from september, not construction", ctx);
ok("a named month (said in October) is this year's September", r.period?.kind === "month" && r.period.key === "2026-09", JSON.stringify(r.period));
ok("excluded industry", JSON.stringify(r.excludeIndustries) === '["Construction"]' && !r.industries, JSON.stringify(r));
ok("Needs Review", JSON.stringify(r.grades) === '["review"]');
r = parseRuleText("Q3 2026 csp renewals", ctx);
ok("a quarter", r.period?.kind === "quarter" && r.period.key === "2026-Q3");
ok("CSP scanner", JSON.stringify(r.scanners) === '["csp"]');
r = parseRuleText("leads mentioning \"business central\"", ctx);
ok("quoted words become a notes keyword", r.keywords === '"business central"', r.keywords);
ok("gibberish reads as an empty rule", isEmptyRule(parseRuleText("hello there", ctx)));

console.log("\n== what Claude sends back is checked ==");
const fromClaude = ruleFromCompletion('Here you go:\n{"product":["dynamics"],"contact":"never","arrivedWithinDays":30,"industries":["Manufacturing","Made Up"],"drop":"me","reps":["carly","bob"]}', ctx);
ok("parsed out of surrounding prose", !!fromClaude && fromClaude.contact === "never" && fromClaude.arrivedWithinDays === 30);
ok("an industry we do not hold is dropped", JSON.stringify(fromClaude?.industries) === '["Manufacturing"]', JSON.stringify(fromClaude));
ok("an unknown rep is dropped, a known one is cased", JSON.stringify(fromClaude?.reps) === '["Carly"]');
ok("an unknown key is dropped", !("drop" in (fromClaude ?? {})));
ok("not JSON reads as no rule", ruleFromCompletion("I can't do that", ctx) === null);
ok("a bad period is dropped", !ruleFromJson({ period: { kind: "month", key: "Sept" } }, ctx)?.period);
ok("stale without days defaults to 30", ruleFromJson({ contact: "stale" }, ctx)?.staleDays === 30);
ok("the prompt carries today and the industry list", rulePrompt("x", ctx).includes("2026-10-21") && rulePrompt("x", ctx).includes("Manufacturing"));

console.log("\n== uncontacted ==");
const never: SmartRule = { product: ["dynamics"], contact: "never", arrivedWithinDays: 30 };
ok("a fresh Dynamics lead from 11 days ago matches", match(never, lead()));
ok("an M365 lead does not", !match(never, lead({ productArea: "M365 / Azure" })));
ok("a lead received 60 days ago does not", !match(never, lead({ receivedOn: "2026-08-20", firstSeenAt: "2026-08-20T12:00:00Z", sourceFiles: ["Book8-20.csv"] })));
ok("one call on record is not uncontacted", !match(never, lead({ calls: 1 })));
ok("an email on record is not uncontacted", !match(never, lead({ emails: 1 })));
ok("in a sequence (even with no calls) is not uncontacted", !match(never, lead({ seq: [{ name: "Jack Main Sequence", status: "active" }] })));
ok("an account-manager account is never uncontacted", !match(never, lead(), { engaged: true }));
ok("an Apollo record with nothing on it is still uncontacted", match(never, lead({ calls: 0, emails: 0, seq: [] })));

console.log("\n== not contacted in N days ==");
const stale: SmartRule = { grades: ["strong"], contact: "stale", staleDays: 30 };
ok("never touched counts", match(stale, lead()));
ok("last call 50 days ago counts", match(stale, lead({ calls: 3, lastCall: "2026-09-01T15:00:00Z", seq: [{ name: "Main", status: "finished", addedAt: "2026-08-20" }] })));
ok("last call 5 days ago does not", !match(stale, lead({ calls: 3, lastCall: "2026-10-16T15:00:00Z" })));
ok("active in a sequence does not, however old", !match(stale, lead({ seq: [{ name: "Main", status: "active", addedAt: "2026-06-01" }] })));
ok("a meeting booked does not", !match(stale, lead({ seq: [{ name: "Main", status: "finished", addedAt: "2026-06-01", reason: "Meeting booked" }] })));
ok("touched with no date on record does not (can't prove N days)", !match(stale, lead({ calls: 2 })));
ok("Needs Review does not match a Strong Signal rule", !match(stale, lead({ tier: "Needs Review" })));

console.log("\n== company, period, keywords ==");
ok("size: unknown employees never passes a size rule", !match({ minEmployees: 50 }, lead()));
ok("size: 120 passes 50+", match({ minEmployees: 50 }, lead(), { employees: 120 }));
ok("industry exclusion", !match({ excludeIndustries: ["Construction"] }, lead(), { industry: "construction" }));
ok("month period", match({ period: { kind: "month", key: "2026-10" } }, lead()) && !match({ period: { kind: "month", key: "2026-09" } }, lead()));
ok("quarter period", match({ period: { kind: "quarter", key: "2026-Q4" } }, lead()));
ok("quarterOf", quarterOf("2026-09") === "2026-Q3" && quarterOf("2026-10") === "2026-Q4");
ok("keywords over the note", match({ keywords: '"business central"' }, lead()) && !match({ keywords: "copilot" }, lead()));
ok("partner ask reads the note's own words", match({ partnerAsk: true }, lead({ notes: "(70) ▲ Wants to work with a partner." })) && !match({ partnerAsk: true }, lead()));

console.log("\n== chips ==");
const chips = describeRule({ product: ["dynamics"], contact: "never", arrivedWithinDays: 30 });
ok("reads back as three chips", JSON.stringify(chips) === '["Dynamics 365","Never contacted","Received in the last 30 days"]', JSON.stringify(chips));
const part = ruleParts({ minEmployees: 50, maxEmployees: 500, contact: "stale", staleDays: 45 });
ok("one chip per idea", part.length === 2 && part[0].label === "Not contacted in 45 days" && part[1].label === "50–500 employees", JSON.stringify(part));
ok("removing a chip removes all its fields", JSON.stringify(withoutKeys({ minEmployees: 50, maxEmployees: 500, visited: true }, part[1].keys)) === '{"visited":true}');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
