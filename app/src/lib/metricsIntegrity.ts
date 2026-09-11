// Metrics integrity — per Jack: "set rules to check metrics multiple ways
// when data changes or increases or is deleted so it all adds up."
//
// Every check below computes the SAME number two different ways and
// compares them. That is the whole idea: a count computed once can be
// quietly wrong forever, but a count computed two ways either agrees or
// tells you it doesn't. This has already been the recurring defect in
// this app — Scanner badges counted against a different base than the
// table they filtered, History's rows-read used a post-filter figure,
// Home's Companies tile normalized company names differently than the
// Companies page it linked to.
//
// These run on the live data in the browser, not just in tests, so a
// disagreement shows up when it happens rather than on the next audit.
import { isWorked, type Contact } from "./contacts";
import { countCompanies, groupContactsByCompany } from "./companies";
import type { HistoryEntry } from "./history";
import type { LibraryEntry } from "./library";
import type { LeadList } from "./leadLists";
import type { Task } from "./tasks";

export interface IntegrityCheck {
  id: string;
  label: string;
  ok: boolean;
  // The two independently computed values, so a failure names the actual
  // numbers rather than just saying something is wrong.
  a: number;
  b: number;
  aLabel: string;
  bLabel: string;
  detail: string;
}

export interface IntegrityReport {
  checks: IntegrityCheck[];
  failed: IntegrityCheck[];
  ranAt: string;
}

function check(
  id: string, label: string, a: number, aLabel: string, b: number, bLabel: string, detail: string
): IntegrityCheck {
  return { id, label, ok: a === b, a, b, aLabel, bLabel, detail };
}

export interface IntegrityInput {
  contacts: Contact[];
  historyEntries: HistoryEntry[];
  libraryEntries: LibraryEntry[];
  leadLists: LeadList[];
  tasks: Task[];
}

export function runIntegrityChecks(input: IntegrityInput): IntegrityReport {
  const { contacts, historyEntries, libraryEntries, leadLists, tasks } = input;
  const checks: IntegrityCheck[] = [];

  // 1. Companies: the Home tile's count vs actually grouping them.
  checks.push(check(
    "companies-count",
    "Company count agrees with the grouped list",
    countCompanies(contacts), "counted",
    groupContactsByCompany(contacts).length, "grouped",
    "Home's Companies tile and the Companies page must use the same name normalization."
  ));

  // 2. Worked vs not worked must partition the directory exactly — no
  //    contact in both, none in neither.
  const worked = contacts.filter(isWorked).length;
  const notWorked = contacts.filter((c) => !isWorked(c)).length;
  checks.push(check(
    "worked-partition",
    "Worked + not worked equals every contact",
    worked + notWorked, "worked + not worked",
    contacts.length, "contacts",
    "Every contact is either worked or not; nothing may fall outside both."
  ));

  // 3. Contacts grouped by company, plus those with no company, must
  //    account for the whole directory.
  const companies = groupContactsByCompany(contacts);
  const inACompany = companies.reduce((n, c) => n + c.contactCount, 0);
  const companyless = contacts.filter((c) => !(c.company || "").trim()).length;
  checks.push(check(
    "company-rollup",
    "Company roll-up accounts for every contact",
    inACompany + companyless, "in a company + company-less",
    contacts.length, "contacts",
    "Grouping must not drop or duplicate a contact."
  ));

  // 4. Contact ids are unique. A duplicate id silently shadows a record
  //    in every by-id lookup and makes counts disagree with what renders.
  checks.push(check(
    "contact-ids-unique",
    "No two contacts share an id",
    new Set(contacts.map((c) => c.id)).size, "distinct ids",
    contacts.length, "contacts",
    "A repeated id hides one record behind another."
  ));

  // 5. History's own arithmetic, per entry, summed: rows read must equal
  //    what was processed plus what was dropped.
  let rowsRead = 0;
  let accounted = 0;
  historyEntries.forEach((h) => {
    rowsRead += h.rowsScanned || 0;
    accounted +=
      (h.results?.length || 0) +
      (h.noSignalRows?.length || 0) +
      (h.duplicatesRemoved || 0);
  });
  checks.push(check(
    "history-rows-reconcile",
    "History rows read equal processed + no signal + duplicates",
    rowsRead, "rows read",
    accounted, "processed + no signal + merged",
    "Every row of every upload is either scored, unscored, or merged as a duplicate."
  ));

  // 6. Library file row counts match the rows actually stored in them.
  const declared = libraryEntries.reduce((n, e) => n + (e.rowCount || 0), 0);
  const actual = libraryEntries.reduce((n, e) => n + (e.rows?.length || 0), 0);
  checks.push(check(
    "library-rowcount",
    "Lead library file counts match their stored rows",
    declared, "declared rowCount",
    actual, "rows on file",
    "A file's stated size must match what it actually holds."
  ));

  // 7. Lead list sizes match their stored rows.
  const listDeclared = leadLists.reduce((n, l) => n + (l.rows?.length || 0), 0);
  const listActual = leadLists.reduce((n, l) => n + new Set((l.rows || []).map((r) => r.__rowKey)).size, 0);
  checks.push(check(
    "list-rows-unique",
    "No lead list holds the same lead twice",
    listDeclared, "rows in lists",
    listActual, "distinct rows in lists",
    "Adding a lead already on a list is meant to be a no-op."
  ));

  // 8. Tasks pointing at a contact must point at one that exists —
  //    otherwise a deleted contact leaves counts that can never resolve.
  const contactIds = new Set(contacts.map((c) => c.id));
  const linked = tasks.filter((t) => t.contactId);
  const resolvable = linked.filter((t) => contactIds.has(t.contactId as string)).length;
  checks.push(check(
    "tasks-resolve",
    "Every contact-linked task points at a contact that exists",
    linked.length, "contact-linked tasks",
    resolvable, "resolve to a contact",
    "Deleting a contact must not strand tasks behind it."
  ));

  return { checks, failed: checks.filter((c) => !c.ok), ranAt: new Date().toISOString() };
}
