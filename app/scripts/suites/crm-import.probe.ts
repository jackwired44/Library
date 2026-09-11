// CRM deal import. Every deal in the pipeline started at Intro Discovery,
// so importing one marks its contact as an intro meeting booked — and,
// critically, MATCHES an existing contact rather than duplicating them.
import { importCrmDeals } from "../../src/lib/crmImport";
import { mergeContactsFromParsedFiles, type Contact } from "../../src/lib/contacts";
import { groupContactsByCompany } from "../../src/lib/companies";
import { DISPOSITION_META } from "../../src/lib/detection";
import type { ParsedFile } from "../../src/lib/detection";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d)); };
const file = (rows: Record<string, string>[], name: string): ParsedFile => ({ name, fields: Object.keys(rows[0] || {}), data: rows });

// The label rename Jack asked for.
ok('Disposition reads "Intro meeting booked"', DISPOSITION_META["meeting-booked"].label === "Intro meeting booked", DISPOSITION_META["meeting-booked"].label);
ok("Its key is unchanged so filed leads are not orphaned", "meeting-booked" in DISPOSITION_META);
ok("It still counts as a connected outcome", DISPOSITION_META["meeting-booked"].connected === true);

// A directory that already holds one of the deal contacts, from a CSV upload.
let contacts: Contact[] = mergeContactsFromParsedFiles([], [file([
  { "First Name": "Dana", "Last Name": "Whitfield", Company: "Ridgeline Orthopedics", Email: "dana@ridgelineortho.com", Title: "IT Director", Comments: "" },
  { "First Name": "Unrelated", "Last Name": "Person", Company: "Other Co", Email: "x@other.com", Title: "", Comments: "" },
], "leads.csv")]).contacts;
ok("Directory seeded with 2 contacts", contacts.length === 2, String(contacts.length));

// A HubSpot-shaped export: one brand-new company, one that matches Dana by
// EMAIL even though the company is spelled differently, and one that
// matches by name+company with no email at all.
const deals = file([
  { "Deal Name": "Northgate Freight", "First Name": "Ben", "Last Name": "Hale", Email: "ben@northgatefreight.com", "Job Title": "COO", "Create Date": "2026-04-15" },
  { "Deal Name": "Ridgeline Ortho Group", "First Name": "Dana", "Last Name": "Whitfield", Email: "dana@ridgelineortho.com", "Job Title": "IT Director", "Create Date": "2026-03-02" },
  { "Deal Name": "Other Co", "First Name": "Unrelated", "Last Name": "Person", Email: "", "Job Title": "", "Create Date": "2026-05-01" },
], "hubspot-deals.csv");

const out = importCrmDeals(contacts, [deals]);
contacts = out.contacts;
ok("3 deal rows read", out.result.rowsRead === 3, String(out.result.rowsRead));
ok("Only the genuinely new contact is added", out.result.added === 1, `added=${out.result.added}`);
ok("The two already on file are MATCHED, not duplicated", out.result.merged === 2, `merged=${out.result.merged}`);
ok("Directory grew by exactly 1", contacts.length === 3, String(contacts.length));

const dana = contacts.find((c) => c.email === "dana@ridgelineortho.com");
ok("Email match wins over a differently-spelled company", Boolean(dana) && contacts.filter((c) => c.fullName === "Dana Whitfield").length === 1);
ok("Merge never overwrote the original company name", dana?.company === "Ridgeline Orthopedics", dana?.company);

// Every touched contact is stamped.
ok("All imported contacts are Intro meeting booked", contacts.every((c) => c.disposition === "meeting-booked"), JSON.stringify(contacts.map((c) => c.disposition)));
ok("Booked date comes from the deal, not today", String(dana?.meetingBookedAt || "").startsWith("2026-03-02"), String(dana?.meetingBookedAt));

// The company directory is a rollup, so it picks them up with no separate import.
const cos = groupContactsByCompany(contacts, []);
ok("New deal company appears in the company directory", cos.some((c) => c.name === "Northgate Freight"), cos.map((c) => c.name).join(","));
ok("No duplicate company for the matched contact", cos.filter((c) => /Ridgeline/i.test(c.name)).length === 1, cos.map((c) => c.name).join(","));
ok("Company rollup counts the booked intro", (cos.find((c) => c.name === "Ridgeline Orthopedics")?.meetingBookedCount || 0) === 1);

// Re-importing the same file must not duplicate anything.
const again = importCrmDeals(contacts, [deals]);
ok("Re-importing the same export adds nobody", again.result.added === 0, `added=${again.result.added}`);
ok("Re-import leaves the directory the same size", again.contacts.length === 3, String(again.contacts.length));

// A row with neither company nor person is skipped rather than piling up.
const junk = importCrmDeals(contacts, [file([{ "Deal Name": "", "First Name": "", "Last Name": "", Email: "", "Job Title": "", "Create Date": "" }], "junk.csv")]);
ok("A row with no company and no person is skipped", junk.result.skippedNoIdentity === 1 && junk.result.added === 0);

// An existing stamp is never overwritten by a later import.
const preStamped = contacts.map((c) => (c.company === "Other Co" ? { ...c, meetingBookedAt: "2026-01-01T12:00:00.000Z" } : c));
const keep = importCrmDeals(preStamped, [deals]);
ok("An earlier booked date already on file is kept", keep.contacts.find((c) => c.company === "Other Co")?.meetingBookedAt === "2026-01-01T12:00:00.000Z");

console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
