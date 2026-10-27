// The recycle queue rules — lib/recycle.ts. Per Jack: 3 unanswered attempts,
// 22 days rest, Not interested after 6 months.
import { recycleOf, recycleWhyLabel, cleanRules, DEFAULT_RECYCLE_RULES, recycleLabel, countRecycle } from "../../src/lib/recycle";
import { setEngagementIndex, buildEngagementIndex } from "../../src/lib/engagements";
import type { StoredLead } from "../../src/lib/leadStore";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { pass++; console.log("  ok   " + n); } else { fail++; console.log(`  FAIL ${n}${d ? " — " + d : ""}`); } };

const TODAY = "2026-10-19";
const lead = (o: Partial<StoredLead> & { outcomes?: Record<string, number>; calls?: number; last?: string; seq?: string } = {}): StoredLead => {
  const { outcomes, calls, last, seq, ...rest } = o;
  return {
    key: rest.email || "k", source: "main", company: "Acme", contact: "Ada Brant", title: "", email: "ada@acme.com", phone: "", mobilePhone: "",
    productArea: "", tier: "Strong Signal", notes: "", score: 0, firstSeenAt: "", lastSeenAt: "", sourceFiles: [], timesSeen: 1,
    ...(outcomes ? { apollo: { syncedAt: "2026-10-19", sequences: seq ? [{ name: "Main", status: seq, step: null }] : [], callCount: calls ?? Object.values(outcomes).reduce((a, b) => a + b, 0), outcomes, lastOutcome: "", lastCallAt: last ?? "" } } : {}),
    ...rest,
  } as StoredLead;
};
const R = DEFAULT_RECYCLE_RULES;

console.log("\n== defaults ==");
ok("3 attempts, 22 days, 6 months", R.attempts === 3 && R.restDays === 22 && R.notInterestedMonths === 6);
ok("a zero or blank rule is never kept", cleanRules({ attempts: 0, restDays: NaN, notInterestedMonths: -1 }).attempts === 3 && cleanRules({ attempts: 0, restDays: NaN, notInterestedMonths: -1 }).restDays === 22);

console.log("\n== the attempts rule ==");
let r = recycleOf(lead({ outcomes: { "No Answer": 2, "Left Voicemail": 1 }, last: "2026-09-01T15:00:00Z", seq: "finished" }), R, TODAY);
ok("3 unanswered, 48 days ago: Ready", r.stage === "ready" && r.unanswered === 3, JSON.stringify(r));
ok("  comes back 22 days after the last attempt", r.recycleOn === "2026-09-23", r.recycleOn);
r = recycleOf(lead({ outcomes: { "No Answer": 3 }, last: "2026-10-10T15:00:00Z", seq: "finished" }), R, TODAY);
ok("3 unanswered, 9 days ago: Resting until Nov 1", r.stage === "resting" && r.recycleOn === "2026-11-01", JSON.stringify(r));
ok("  label says when", /Recycle on .*\(in 13d\)/.test(recycleLabel(r, TODAY)), recycleLabel(r, TODAY));
r = recycleOf(lead({ outcomes: { "No Answer": 2 }, last: "2026-08-01T15:00:00Z" }), R, TODAY);
ok("2 unanswered: not enough attempts yet", r.stage === "building" && /2 of 3/.test(r.reason), JSON.stringify(r));
r = recycleOf(lead({ outcomes: { "Gatekeeper / Front Desk": 4 }, last: "2026-08-01T15:00:00Z" }), R, TODAY);
ok("gatekeeper counts as unanswered", r.stage === "ready" && r.unanswered === 4);
r = recycleOf(lead({ outcomes: {}, calls: 5, last: "2026-08-01T15:00:00Z" }), R, TODAY);
ok("calls with no outcome names, nobody reached: every call counts", r.stage === "ready" && r.unanswered === 5, JSON.stringify(r));
r = recycleOf(lead({ outcomes: { "No Answer": 3 } }), R, TODAY);
ok("no date on the last attempt: Ready, and says so", r.stage === "ready" && !r.recycleOn && /No date/.test(r.reason));

console.log("\n== not interested ==");
r = recycleOf(lead({ outcomes: { "Not Interested": 1 }, last: "2026-03-10T15:00:00Z" }), R, TODAY);
ok("Not interested 7 months ago: Ready", r.stage === "ready" && r.why === "not-interested" && r.recycleOn === "2026-09-10", JSON.stringify(r));
r = recycleOf(lead({ outcomes: { "Not Interested": 1 }, last: "2026-06-10T15:00:00Z" }), R, TODAY);
ok("Not interested 4 months ago: Resting until December", r.stage === "resting" && r.recycleOn === "2026-12-10", JSON.stringify(r));
r = recycleOf(lead({ outcomes: { "Not Interested": 1 }, last: "2026-08-31T15:00:00Z" }), R, TODAY);
ok("Aug 31 + 6 months clamps to Feb 28", r.recycleOn === "2027-02-28", r.recycleOn);

console.log("\n== never recycled ==");
ok("Do not contact", recycleOf(lead({ outcomes: { "No Answer": 5, "Do Not Contact": 1 }, last: "2026-01-01T00:00:00Z" }), R, TODAY).stage === "excluded");
ok("Meeting booked", recycleOf(lead({ outcomes: { "Meeting Booked": 1 }, last: "2026-01-01T00:00:00Z" }), R, TODAY).stage === "excluded");
ok("Wrong number only", recycleOf(lead({ outcomes: { "Wrong Number": 2 }, last: "2026-01-01T00:00:00Z" }), R, TODAY).stage === "excluded");
ok("Bad Lead", recycleOf(lead({ tier: "Bad Leads", outcomes: { "No Answer": 5 }, last: "2026-01-01T00:00:00Z" }), R, TODAY).stage === "excluded");
r = recycleOf(lead({ outcomes: { "No Answer": 5, "Connected - Positive": 1 }, last: "2026-01-01T00:00:00Z" }), R, TODAY);
ok("reached someone: being worked, not recycled", r.stage === "working" && /Spoken with/.test(r.reason));
r = recycleOf(lead({ outcomes: { "No Answer": 5 }, last: "2026-01-01T00:00:00Z", seq: "active" }), R, TODAY);
ok("in a live sequence: being worked", r.stage === "working");
ok("no Apollo call history: Not checked, never guessed", recycleOf(lead(), R, TODAY).stage === "unchecked");
setEngagementIndex(buildEngagementIndex([{ id: "x", source: "hubspot", company: "Acme", domain: "", email: "", contact: "", stage: "Discovery", at: "", url: "" }]));
ok("Account manager only", recycleOf(lead({ outcomes: { "No Answer": 5 }, last: "2026-01-01T00:00:00Z" }), R, TODAY).reason === "Account manager only");
setEngagementIndex(null);

console.log("\n== sequence end (live check, no call history) ==");
// Per Jack: "i need a simple way to check leads in here agasint apollo so i
// know when to recycle a lead to a new sequence" — the live check reads the
// sequence and why it ended even where it cannot read calls.
const live = (sq: Record<string, unknown>, extra: Partial<StoredLead> = {}) => lead({ apollo: { syncedAt: "", sequences: [{ name: "Main", step: null, ...sq }], callCount: 0, outcomes: {}, lastOutcome: "", lastCallAt: "", callsUnknown: true }, ...extra } as Partial<StoredLead>);
r = recycleOf(live({ status: "finished", finishedAt: "2026-09-01T00:00:00Z", reason: "Finished sequence" }), R, TODAY);
ok("sequence finished, no reply, 48 days ago: Ready", r.stage === "ready" && r.why === "sequence-ended" && r.recycleOn === "2026-09-23", JSON.stringify(r));
ok("  says why in words", recycleWhyLabel(r) === "Sequence ended, no reply");
r = recycleOf(live({ status: "finished", finishedAt: "2026-10-10T00:00:00Z" }), R, TODAY);
ok("sequence finished 9 days ago: Resting", r.stage === "resting");
for (const reason of ["Contact replied", "Talked on phone", "Info requested", "Pending review", "Call back"]) {
  ok(`ended "${reason}": spoken with, never recycled`, recycleOf(live({ status: "finished", finishedAt: "2026-01-01T00:00:00Z", reason }), R, TODAY).stage === "working");
}
ok("ended \"Meeting booked\": never recycled", recycleOf(live({ status: "finished", finishedAt: "2026-01-01T00:00:00Z", reason: "Meeting booked" }), R, TODAY).stage === "excluded");
ok("ended \"Unsubscribed\": do not contact", recycleOf(live({ status: "finished", finishedAt: "2026-01-01T00:00:00Z", reason: "Unsubscribed" }), R, TODAY).reason === "Do not contact");
ok("ended \"Not interested\": comes back after 6 months", recycleOf(live({ status: "finished", finishedAt: "2026-01-01T00:00:00Z", reason: "Not interested" }), R, TODAY).why === "not-interested");
ok("active in one sequence: never offered for a second", recycleOf(live({ status: "active" }), R, TODAY).stage === "working");
ok("a status set by hand to reached is never recycled", recycleOf(live({ status: "finished", finishedAt: "2026-01-01T00:00:00Z" }, { statusOverride: { status: "reached", at: "2026-10-01" } }), R, TODAY).stage === "working");
ok("checked, not in Apollo: Never sequenced, not a recycle", recycleOf(lead({ apolloCheckedAt: "2026-10-18T00:00:00Z" }), R, TODAY).stage === "fresh");

console.log("\n== the workflow ==");
const base = { outcomes: { "No Answer": 3 }, last: "2026-09-01T15:00:00Z", seq: "finished" };
r = recycleOf(lead({ ...base, recycle: { downloadedAt: "2026-10-18T10:00:00Z" } }), R, TODAY);
ok("downloaded after the last attempt: Downloaded", r.stage === "downloaded");
r = recycleOf(lead({ ...base, seq: "active", recycle: { downloadedAt: "2026-10-18T10:00:00Z" } }), R, TODAY);
ok("downloaded, now in a live sequence: Back in a sequence", r.stage === "back");
r = recycleOf(lead({ outcomes: { "No Answer": 6 }, last: "2026-10-15T15:00:00Z", seq: "finished", recycle: { downloadedAt: "2026-09-25T10:00:00Z" } }), R, TODAY);
ok("worked again since the download: back to Resting with a new date", r.stage === "resting" && r.recycleOn === "2026-11-06", JSON.stringify(r));
ok("a stamp alone never makes a lead Downloaded", recycleOf(lead({ outcomes: { "No Answer": 1 }, last: "2026-09-01T15:00:00Z", recycle: { downloadedAt: "2026-10-18T10:00:00Z" } }), R, TODAY).stage === "building");

console.log("\n== custom rules ==");
r = recycleOf(lead({ outcomes: { "No Answer": 5 }, last: "2026-10-01T15:00:00Z" }), { attempts: 5, restDays: 10, notInterestedMonths: 3 }, TODAY);
ok("5 attempts, 10 days: Ready on Oct 11", r.stage === "ready" && r.recycleOn === "2026-10-11", JSON.stringify(r));
const c = countRecycle([lead({ ...base }), lead({ outcomes: { "No Answer": 3 }, last: "2026-10-05T15:00:00Z" }), lead()], R, TODAY);
ok("counts: 1 ready, 1 resting back this month, 1 unchecked", c.by.ready === 1 && c.by.resting === 1 && c.thisMonth === 1 && c.by.unchecked === 1, JSON.stringify(c));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
