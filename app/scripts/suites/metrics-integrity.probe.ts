import { runIntegrityChecks } from "../../src/lib/metricsIntegrity";
import type { Contact } from "../../src/lib/contacts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d)); };

const contact = (over: Partial<Contact>): Contact => ({
  id: over.id || `c${Math.random()}`, firstName: "A", lastName: "B", fullName: "A B",
  title: "", company: "Acme", email: "", workPhone: "", mobilePhone: "", employees: "",
  productArea: "", sourceFiles: ["f.csv"], firstSeenAt: "2026-01-01T00:00:00.000Z",
  lastSeenAt: "2026-01-01T00:00:00.000Z", timesSeen: 1, ...over,
} as Contact);

const base = { historyEntries: [], libraryEntries: [], leadLists: [], tasks: [] } as never as
  { historyEntries: never[]; libraryEntries: never[]; leadLists: never[]; tasks: never[] };

{
  const contacts = [contact({ id: "1" }), contact({ id: "2", company: "Beta" }), contact({ id: "3", company: "" })];
  const r = runIntegrityChecks({ ...base, contacts });
  ok("clean data passes every check", r.failed.length === 0, r.failed.map((f) => f.id).join(","));
  ok("company-less contact still accounted for", r.checks.find((c) => c.id === "company-rollup")?.ok === true);
}
{
  const contacts = [contact({ id: "dup" }), contact({ id: "dup" })];
  const r = runIntegrityChecks({ ...base, contacts });
  ok("duplicate contact ids are caught", r.failed.some((c) => c.id === "contact-ids-unique"));
}
{
  const contacts = [contact({ id: "1", company: "Acme  Corp" }), contact({ id: "2", company: "Acme Corp" })];
  const r = runIntegrityChecks({ ...base, contacts });
  ok("whitespace variants count as one company", r.checks.find((c) => c.id === "companies-count")?.a === 1,
     String(r.checks.find((c) => c.id === "companies-count")?.a));
}
{
  const contacts = [contact({ id: "1" })];
  const tasks = [{ id: "t1", text: "call", date: "2026-01-01", done: false, contactId: "GONE" }] as never[];
  const r = runIntegrityChecks({ ...base, contacts, tasks });
  ok("task pointing at a deleted contact is caught", r.failed.some((c) => c.id === "tasks-resolve"));
}
{
  const historyEntries = [{
    id: "h1", fileName: "f.csv", files: [], importedAt: "2026-01-01T00:00:00.000Z",
    rowsScanned: 100, duplicatesRemoved: 5, results: new Array(80).fill({}),
    noSignalRows: new Array(10).fill({}), tag: "", notes: "", libraryEntryIds: [],
  }] as never[];
  const r = runIntegrityChecks({ ...base, contacts: [], historyEntries });
  ok("history that does not add up is caught", r.failed.some((c) => c.id === "history-rows-reconcile"));
  const c = r.checks.find((x) => x.id === "history-rows-reconcile");
  ok("and it names both numbers", c?.a === 100 && c?.b === 95, `${c?.a} vs ${c?.b}`);
}
{
  const leadLists = [{ id: "l1", name: "L", createdAt: "", rows: [{ __rowKey: "k" }, { __rowKey: "k" }] }] as never[];
  const r = runIntegrityChecks({ ...base, contacts: [], leadLists });
  ok("a list holding the same lead twice is caught", r.failed.some((c) => c.id === "list-rows-unique"));
}

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
