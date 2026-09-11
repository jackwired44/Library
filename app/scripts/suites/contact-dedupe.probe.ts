// Contact deduplication + outbound-success aggregation, tested as pure
// logic. Both were built in response to a reproduced defect: re-uploading
// one 4-row CSV three times produced 8 contacts because a row carrying
// only a name, or only a company, keyed as null under both original
// dedup rungs and so matched nothing.
import {
  buildContactIndex,
  dedupeExistingContacts,
  hasLeadData,
  lookupContact,
  mergeContactsFromParsedFiles,
  type Contact,
} from "../../src/lib/contacts";
import { activityInWindow } from "../../src/components/OutboundSuccess";
import type { ParsedFile } from "../../src/lib/detection";
import type { OutreachAttempt } from "../../src/lib/outreachAttempts";
import {
  ARCHIVE_MONTH_KEY,
  ARCHIVE_MONTH_LABEL,
  ensureMonthFoldersExist,
  getMonthOptionsForFiling,
  getRequiredMonthKeys,
  monthKeyFromGroupName,
  monthLabelFromKey,
  pruneEmptyMonthFoldersBefore,
  type LibraryEntry,
  type LibraryGroup,
} from "../../src/lib/library";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d)); };

const file = (rows: Record<string, string>[], name: string): ParsedFile => ({
  name,
  fields: Object.keys(rows[0] || {}),
  data: rows,
});

const ROWS = [
  { "First Name": "Ana", "Last Name": "Cruz", Company: "", Email: "", Title: "Ops", Comments: "" },
  { "First Name": "", "Last Name": "", Company: "Northgate Freight", Email: "", Title: "", Comments: "" },
  { "First Name": "Ben", "Last Name": "Hale", Company: "Northgate Freight", Email: "", Title: "", Comments: "" },
  { "First Name": "Cara", "Last Name": "Ng", Company: "Vela Labs", Email: "cara@velalabs.com", Title: "", Comments: "" },
];

// --- the original defect: three uploads of the SAME file ---
let contacts: Contact[] = [];
for (let i = 0; i < 3; i++) contacts = mergeContactsFromParsedFiles(contacts, [file(ROWS, "leads.csv")]).contacts;
ok("Re-uploading one file 3x yields 4 contacts, not 8", contacts.length === 4, `got ${contacts.length}`);
ok("Name-only row stays a single record", contacts.filter((c) => c.fullName === "Ana Cruz").length === 1);
ok("Company-only row stays a single record", contacts.filter((c) => !c.fullName && c.company === "Northgate Freight").length === 1);
ok("Name+company row still dedups", contacts.filter((c) => c.fullName === "Ben Hale").length === 1);
ok("Email row still dedups", contacts.filter((c) => c.email === "cara@velalabs.com").length === 1);
ok("timesSeen still counts raw row occurrences", contacts.every((c) => c.timesSeen === 3), JSON.stringify(contacts.map((c) => c.timesSeen)));
ok("sourceFiles stays at one distinct file", contacts.every((c) => c.sourceFiles.length === 1));

// --- the weaker rungs must NOT over-merge ---
let two: Contact[] = mergeContactsFromParsedFiles([], [file([
  { "First Name": "Ana", "Last Name": "Cruz", Company: "Acme Co", Email: "", Title: "", Comments: "" },
  { "First Name": "Ana", "Last Name": "Cruz", Company: "Beta LLC", Email: "", Title: "", Comments: "" },
], "two.csv")]).contacts;
ok("Same name at two companies stays two contacts", two.length === 2, `got ${two.length}`);
const ambiguous = mergeContactsFromParsedFiles(two, [file([
  { "First Name": "Ana", "Last Name": "Cruz", Company: "", Email: "", Title: "", Comments: "" },
], "nameonly.csv")]).contacts;
ok("A name-only row does NOT attach to an ambiguous name", ambiguous.length === 3, `got ${ambiguous.length}`);

const placeholder = mergeContactsFromParsedFiles(
  mergeContactsFromParsedFiles([], [file([{ "First Name": "Dee", "Last Name": "Park", Company: "Orion Mills", Email: "", Title: "", Comments: "" }], "a.csv")]).contacts,
  [file([{ "First Name": "", "Last Name": "", Company: "Orion Mills", Email: "", Title: "", Comments: "" }], "b.csv")]
).contacts;
ok("A company-only row never attaches onto a real person", placeholder.length === 2, `got ${placeholder.length}`);

// --- email still wins over a differing company ---
const moved = mergeContactsFromParsedFiles(
  mergeContactsFromParsedFiles([], [file([{ "First Name": "Eli", "Last Name": "Ross", Company: "Old Corp", Email: "eli@oldcorp.com", Title: "", Comments: "" }], "a.csv")]).contacts,
  [file([{ "First Name": "Eli", "Last Name": "Ross", Company: "New Corp", Email: "eli@oldcorp.com", Title: "VP", Comments: "" }], "b.csv")]
).contacts;
ok("Same email at a new company merges, not duplicates", moved.length === 1, `got ${moved.length}`);
ok("Merge is additive — blank title filled in", moved[0]?.title === "VP");
ok("Merge never blanks an existing value", moved[0]?.company === "Old Corp");

// --- the one-time cleanup of already-accumulated duplicates ---
const now = new Date().toISOString();
const base = (over: Partial<Contact>): Contact => ({
  id: over.id || "x", firstName: "", lastName: "", fullName: "", title: "", company: "", email: "",
  workPhone: "", mobilePhone: "", employees: "", productArea: "", sourceFiles: ["f.csv"],
  firstSeenAt: now, lastSeenAt: now, timesSeen: 1, ...over,
});
const dirty: Contact[] = [
  base({ id: "a1", fullName: "Ana Cruz", firstName: "Ana", lastName: "Cruz", callCount: 2, sourceFiles: ["one.csv"] }),
  base({ id: "a2", fullName: "Ana Cruz", firstName: "Ana", lastName: "Cruz", emailCount: 3, disposition: "meeting-booked", sourceFiles: ["two.csv"] }),
  base({ id: "a3", fullName: "Ana Cruz", firstName: "Ana", lastName: "Cruz", onCrm: true, sourceFiles: ["three.csv"] }),
  base({ id: "b1", fullName: "Ben Hale", company: "Northgate Freight" }),
];
const res = dedupeExistingContacts(dirty);
ok("Cleanup folds 3 accumulated duplicates into 1", res.contacts.length === 2, `got ${res.contacts.length}`);
ok("Cleanup reports the merge count", res.merged === 2, `got ${res.merged}`);
const ana = res.contacts.find((c) => c.fullName === "Ana Cruz");
ok("Folded record keeps every call logged against a duplicate", ana?.callCount === 2, `got ${ana?.callCount}`);
ok("Folded record keeps every email logged against a duplicate", ana?.emailCount === 3, `got ${ana?.emailCount}`);
ok("Folded record keeps a manual disposition", ana?.disposition === "meeting-booked");
ok("Folded record keeps a manual On CRM flag", ana?.onCrm === true);
ok("Folded record unions every source file", (ana?.sourceFiles.length || 0) === 3, JSON.stringify(ana?.sourceFiles));
ok("Remap covers every folded id so attempts/tasks can be re-pointed", res.remap.size === 2 && [...res.remap.values()].every((v) => v === ana?.id));
const again = dedupeExistingContacts(res.contacts);
ok("Cleanup is idempotent — a second run merges nothing", again.merged === 0);
ok("An unrelated contact is untouched", res.contacts.some((c) => c.fullName === "Ben Hale"));

// --- the gap predicate ---
ok("No tier/category/snippet reads as no lead data", !hasLeadData(base({ id: "g1" })));
ok("A scored tier counts as lead data", hasLeadData(base({ id: "g2", tier: "signal" })));
ok("A category counts as lead data", hasLeadData(base({ id: "g3", category: "dynamics365" })));
ok("A blank snippet does not count", !hasLeadData(base({ id: "g4", matchedSnippet: "   " })));

// --- index lookups agree with the merge path ---
const idx = buildContactIndex(res.contacts);
ok("Index finds a name-only lookup when unambiguous", lookupContact(idx, "Ana Cruz", "", "")?.id === ana?.id);
ok("Index returns nothing for an unknown person", lookupContact(idx, "Zoe Quill", "Nowhere", "") === undefined);

// --- outbound activity window ---
const day = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString(); };
const atts: OutreachAttempt[] = [
  { id: "1", contactId: "a1", channel: "call", outcome: "no-answer", at: day(1) },
  { id: "2", contactId: "a1", channel: "call", outcome: "meeting-booked", at: day(2) },
  { id: "3", contactId: "b1", channel: "email", outcome: "none", at: day(3) },
  { id: "4", contactId: "b1", channel: "call", outcome: "left-voicemail", at: day(40) },
] as OutreachAttempt[];
const connected = (o: string) => o === "meeting-booked";
const w7 = activityInWindow(atts, (() => { const d = new Date(); d.setDate(d.getDate() - 6); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })(), connected as never);
ok("7-day window counts only recent calls", w7.calls === 2, `got ${w7.calls}`);
ok("7-day window counts only recent emails", w7.emails === 1, `got ${w7.emails}`);
ok("7-day window excludes the 40-day-old attempt", w7.attempts === 3, `got ${w7.attempts}`);
ok("Connect count reflects the predicate", w7.reached === 1, `got ${w7.reached}`);
ok("Leads touched counts distinct people, not attempts", w7.leadsTouched === 2, `got ${w7.leadsTouched}`);
const wAll = activityInWindow(atts, null, connected as never);
ok("All-time window includes every attempt", wAll.attempts === 4, `got ${wAll.attempts}`);

// --- Lead Library: the "April and Past 2026" archive folder ---
const monthKeys = getRequiredMonthKeys();
ok("Archive folder key sorts first", monthKeys[0] === ARCHIVE_MONTH_KEY, monthKeys.slice(0, 3).join(","));
ok("May 2026 is still the first real month", monthKeys[1] === "2026-05", String(monthKeys[1]));
ok("Archive key resolves to its label", monthLabelFromKey(ARCHIVE_MONTH_KEY) === "April and Past 2026");
ok("Archive label round-trips back to the key", monthKeyFromGroupName(ARCHIVE_MONTH_LABEL) === ARCHIVE_MONTH_KEY);
ok("Filing picker offers the archive folder", getMonthOptionsForFiling().some((o) => o.key === ARCHIVE_MONTH_KEY));
const seeded = ensureMonthFoldersExist([]);
ok("Seeding creates the archive folder", seeded.groups.some((g) => g.name === ARCHIVE_MONTH_LABEL));
// The archive key sorts BELOW the May cutoff under a plain string compare,
// so without an explicit guard the prune would delete it on every load and
// seeding would re-create it — an invisible create/delete loop.
const pruned = pruneEmptyMonthFoldersBefore(seeded.groups, [] as LibraryEntry[]);
ok("Prune spares the EMPTY archive folder", pruned.groups.some((g) => g.name === ARCHIVE_MONTH_LABEL), pruned.removed.map((g) => g.name).join(","));
ok("Seed/prune cycle is stable — no churn", ensureMonthFoldersExist(pruned.groups).created.length === 0);
const withOldMonth: LibraryGroup[] = [
  { id: "o1", name: "January 2026", createdAt: now, isAutoMonthFolder: true } as LibraryGroup,
  ...pruned.groups,
];
ok("A real pre-cutoff month is still pruned", !pruneEmptyMonthFoldersBefore(withOldMonth, [] as LibraryEntry[]).groups.some((g) => g.name === "January 2026"));

console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
