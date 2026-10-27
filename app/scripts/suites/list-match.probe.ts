// "Already on a list" — lib/leadLists.ts listMatchIndex / listsHolding /
// onPickedList. Per Jack: "filter out leads added to a list so if i upload a
// csv to scan i can remove ones i added to a list or even in all leads".
// Approved: lists he BUILT count (cycled ones too); smart lists never do.
import { listMatchIndex, listsHolding, onPickedList, isBuiltList, type LeadList, type ListedLeadRow } from "../../src/lib/leadLists";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { pass++; console.log("  ok   " + n); } else { fail++; console.log(`  FAIL ${n}${d ? " — " + d : ""}`); } };

const row = (first: string, last: string, company: string, email = ""): ListedLeadRow => ({
  "First Name": first, "Last Name": last, Title: "", "Company Name": company, Email: email,
  "Work Direct Phone": "", "Mobile Phone": "", "Number of Employees": "", "Product Area": "", Notes: "", __rowKey: `${first}::${company}`.toLowerCase(),
});
const list = (id: string, rows: ListedLeadRow[], extra: Partial<LeadList> = {}): LeadList => ({ id, name: id, createdAt: "2026-10-01T00:00:00Z", rows, ...extra });

const hand = list("hand", [row("Dana", "Lee", "Acme Inc.", "dana@acme.com"), row("Sam", "Ortiz", "Beta LLC")]);
const cycled = list("old", [row("Pat", "Kim", "Gamma Corp")], { status: "cycled", createdAt: "2026-08-01T00:00:00Z" });
const smart = list("smart", [row("Lee", "Park", "Delta")], { rule: { grades: ["signal"] } as never });
const idx = listMatchIndex([hand, cycled, smart]);

ok("smart lists are not built lists", !isBuiltList(smart) && isBuiltList(hand) && isBuiltList(cycled));
ok("picker holds the two built lists, newest first", idx.lists.map((l) => l.id).join(",") === "hand,old");
ok("email match, case and spaces ignored", listsHolding(idx, { email: "  DANA@acme.com " }).map((l) => l.id).join() === "hand");
ok("full name + company match", listsHolding(idx, { contact: "sam ortiz", company: "Beta" }).length === 1);
ok("company legal suffix ignored", listsHolding(idx, { contact: "Dana Lee", company: "ACME" }).length === 1);
ok("same name at a different company is not a match", listsHolding(idx, { contact: "Sam Ortiz", company: "Omega" }).length === 0);
ok("first name alone is not a match", listsHolding(idx, { contact: "Sam", company: "Beta LLC" }).length === 0);
ok("a different person at the same company is not a match", listsHolding(idx, { contact: "Sam Jones", company: "Beta LLC" }).length === 0);
ok("cycled list still counts", listsHolding(idx, { contact: "Pat Kim", company: "Gamma" }).map((l) => l.id).join() === "old");
ok("smart list never hides anyone", listsHolding(idx, { contact: "Lee Park", company: "Delta" }).length === 0);
ok("a lead with no email and no company is never matched", listsHolding(idx, { contact: "Dana Lee" }).length === 0);
ok("email and name hitting the same list count it once", listsHolding(idx, { email: "dana@acme.com", contact: "Dana Lee", company: "Acme" }).length === 1);
ok("full name in the first-name field still matches", listsHolding(listMatchIndex([list("x", [row("Dana Lee", "", "Acme")])]), { contact: "Dana Lee", company: "Acme" }).length === 1);
ok("pick any", onPickedList(idx, { contact: "Pat Kim", company: "Gamma" }, "any"));
ok("pick one list: on it", onPickedList(idx, { contact: "Pat Kim", company: "Gamma" }, "old"));
ok("pick one list: on another list only", !onPickedList(idx, { contact: "Pat Kim", company: "Gamma" }, "hand"));
ok("no lists: nobody is on a list", !onPickedList(listMatchIndex([]), { email: "dana@acme.com" }, "any"));

console.log(`\nlist-match: ${pass} / ${pass + fail}`);
if (fail) process.exit(1);
