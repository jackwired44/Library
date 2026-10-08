// Lead status: derived from evidence, highest evidence first, with a hand
// override that wins and that survives a re-upload and an Apollo sync.
import { derivedStatus, statusOf, withStatusOverride, countByStatus } from "../../src/lib/leadStatus";
import { mergeLeads, type StoredLead, type LeadInput } from "../../src/lib/leadStore";
import { applyApolloSync } from "../../src/lib/apolloSync";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { c ? pass++ : (fail++, console.log(`  FAIL ${n}${d ? " — " + d : ""}`)); };

const base: StoredLead = {
  key: "e:a@x.com", source: "main", company: "X Co", contact: "Ann Lee", title: "", email: "a@x.com",
  phone: "", mobilePhone: "", productArea: "Dynamics 365", tier: "High priority", notes: "", score: 70,
  firstSeenAt: "2026-10-01T00:00:00Z", lastSeenAt: "2026-10-01T00:00:00Z", sourceFiles: ["f.csv"], timesSeen: 1,
};
const ap = (o: Partial<NonNullable<StoredLead["apollo"]>>) => ({
  syncedAt: "2026-10-08T00:00:00Z", sequences: [], callCount: 0, outcomes: {}, lastOutcome: "", lastCallAt: "", ...o,
});

// Intake, from the scan tier on every scanner's vocabulary.
ok("High priority -> qualified", derivedStatus(base) === "qualified");
ok("Strong Signal -> qualified", derivedStatus({ ...base, tier: "Strong Signal" }) === "qualified");
ok("Bad Leads -> disqualified", derivedStatus({ ...base, tier: "Bad Leads" }) === "disqualified");
ok("Medium priority -> review", derivedStatus({ ...base, tier: "Medium priority" }) === "review");
ok("No signal -> review", derivedStatus({ ...base, tier: "No signal" }) === "review");
ok("CSP Low priority is NOT disqualified (it is a score, not a rule)", derivedStatus({ ...base, tier: "Low priority" }) === "review");

// Placed, from the queue.
ok("queued plan -> queued", derivedStatus({ ...base, plan: { sequence: "S", status: "queued", assignedAt: "", by: "rule" } }) === "queued");
ok("exported plan -> sent", derivedStatus({ ...base, plan: { sequence: "S", status: "exported", assignedAt: "", by: "rule" } }) === "sent");

// Working and outcome, from Apollo — and Apollo outranks the queue.
const exported = { ...base, plan: { sequence: "S", status: "exported" as const, assignedAt: "", by: "rule" as const } };
ok("active sequence -> in sequence, even when exported", derivedStatus({ ...exported, apollo: ap({ sequences: [{ name: "S", status: "active", step: 2 }] }) }) === "in-sequence");
ok("only no-answers in a live sequence stays in sequence",
   derivedStatus({ ...base, apollo: ap({ sequences: [{ name: "S", status: "active", step: 2 }], callCount: 4, outcomes: { "No Answer": 4 } }) }) === "in-sequence");
ok("a real conversation -> reached",
   derivedStatus({ ...base, apollo: ap({ sequences: [{ name: "S", status: "active", step: 2 }], callCount: 3, outcomes: { "No Answer": 2, "Info Requested": 1 } }) }) === "reached");
ok("finished with only no-answers -> called, not reached (never 'contacted')",
   derivedStatus({ ...base, apollo: ap({ sequences: [{ name: "S", status: "finished", step: 5 }], callCount: 5, outcomes: { "No Answer": 5 } }) }) === "called");
ok("a gatekeeper is not reaching the lead",
   derivedStatus({ ...base, apollo: ap({ callCount: 2, outcomes: { "Gatekeeper / Front Desk": 1, "Left Voicemail": 1 } }) }) === "called");
ok("calls with no outcome names at all -> called",
   derivedStatus({ ...base, apollo: ap({ callCount: 3 }) }) === "called");
ok("finished, never dialled -> sequence finished",
   derivedStatus({ ...base, apollo: ap({ sequences: [{ name: "S", status: "finished", step: 4 }] }) }) === "finished");
ok("meeting booked outranks everything",
   derivedStatus({ ...base, tier: "Bad Leads", apollo: ap({ callCount: 9, outcomes: { "No Answer": 8, "Meeting Booked": 1 } }) }) === "meeting");
ok("not interested", derivedStatus({ ...base, apollo: ap({ callCount: 1, outcomes: { "Not interested": 1 } }) }) === "not-interested");
ok("do not contact reads as not interested", derivedStatus({ ...base, apollo: ap({ callCount: 1, outcomes: { "Do Not Contact": 1 } }) }) === "not-interested");
ok("an Apollo record with nothing in it falls back to the scan", derivedStatus({ ...base, apollo: ap({}) }) === "qualified");

// Override.
const o = withStatusOverride(base, "not-interested");
ok("override wins", statusOf(o) === "not-interested" && derivedStatus(o) === "qualified");
ok("clearing hands it back", statusOf(withStatusOverride(o, null)) === "qualified" && !withStatusOverride(o, null).statusOverride);
ok("setting what the evidence already says stores nothing", !withStatusOverride(base, "qualified").statusOverride);

// The override survives a re-upload of the same person …
const inc: LeadInput = {
  source: "main", company: "X Co", contact: "Ann Lee", title: "CIO", email: "a@x.com", phone: "", mobilePhone: "",
  productArea: "Dynamics 365", tier: "Bad Leads", notes: "new note", score: 10, sourceFile: "g.csv",
};
const { leads: after } = mergeLeads([o], [inc]);
ok("override survives a re-upload", statusOf(after[0]) === "not-interested" && after[0].timesSeen === 2, JSON.stringify(after[0].statusOverride));
// … and an Apollo sync.
const { leads: synced } = applyApolloSync(after, [{
  email: "a@x.com", contact: "Ann Lee", company: "X Co",
  sequences: [{ name: "S", status: "active", step: 1 }], callCount: 0, outcomes: {}, lastOutcome: "", lastCallAt: "",
}]);
ok("override survives a sync", statusOf(synced[0]) === "not-interested" && derivedStatus(synced[0]) === "in-sequence");

const counts = countByStatus([base, o, { ...base, key: "k3", tier: "Bad Leads" }]);
ok("countByStatus", counts.qualified === 1 && counts["not-interested"] === 1 && counts.disqualified === 1);

console.log(`lead-status ${fail ? "FAIL" : "PASS"} ${pass}/${pass + fail}`);
if (fail) process.exit(1);
