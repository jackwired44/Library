// Apollo owner + sequence capture, tested as pure logic.
//
// Per Jack: "view through the lead list by who in apollo it is assigned to
// ... so she can see every lead she has ever worked on or been assigned
// with the note," plus "filter by sequences shes working on."
//
// What matters here is not that the fields exist but that they survive the
// merge ladder correctly, because Contacts is an ACCUMULATING directory:
// the same person arrives again in a later export, and the rules for owner
// and for sequences are deliberately OPPOSITE to each other.
//   - owner  : newest non-blank wins (a reassignment must stick)
//   - blank  : never erases (a sparser export must not unassign anyone)
//   - seqs   : union, never pruned ("ever worked on", not "currently in")
import { mergeContactsFromParsedFiles, parseSequenceCell, type Contact } from "../../src/lib/contacts";
import { computeFileFieldMapping, resolveRowFields, type ParsedFile } from "../../src/lib/detection";

let pass = 0, fail = 0;
function check(label: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`); }
}

function file(name: string, header: string[], rows: string[][]): ParsedFile {
  return {
    name,
    fields: header,
    data: rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""]))),
  } as ParsedFile;
}

console.log("\nApollo owner + sequence capture");

/* ---------- column mapping ---------- */
{
  // Apollo's real export header spelling, including the trap: BOTH
  // "Contact Owner" and "Account Owner" are present. The contact's own
  // owner must win — guessColumn exhausts "contactowner" (exact, then
  // substring) before it ever tries the bare "owner".
  const pf = file(
    "apollo.csv",
    ["First Name", "Last Name", "Company", "Email", "Account Owner", "Contact Owner", "Sequence", "Notes"],
    [["Dana", "Reyes", "Reyes Freight", "dana@reyesfreight.com", "Russell Vance", "Carly Parks", "Carly Main Sequence", "Wants a Business Central partner."]]
  );
  const mapping = computeFileFieldMapping(pf);
  check("owner maps to Contact Owner, not Account Owner", mapping.owner === "Contact Owner", `got ${mapping.owner}`);
  check("sequence column maps", mapping.sequence === "Sequence", `got ${mapping.sequence}`);

  const resolved = resolveRowFields(pf.data[0], mapping);
  check("owner value resolves", resolved.owner === "Carly Parks", `got ${resolved.owner}`);
  check("note still resolves alongside", (resolved.comments || "").includes("Business Central"));
}

/* ---------- sequence cell parsing ---------- */
{
  check("single sequence parses", JSON.stringify(parseSequenceCell("Carly Main Sequence")) === JSON.stringify(["Carly Main Sequence"]));
  check("semicolon-separated parses to two", parseSequenceCell("A Seq;B Seq").length === 2);
  check("whitespace around separator trimmed", JSON.stringify(parseSequenceCell(" A Seq ; B Seq ")) === JSON.stringify(["A Seq", "B Seq"]));
  check("blank cell parses to empty", parseSequenceCell("").length === 0);
  // A comma must NOT split: sequence names contain commas and the CSV
  // itself already owns that delimiter.
  check("comma does not split", parseSequenceCell("Carly (Azure, Fabric + Power Bi)").length === 1);
}

/* ---------- merge semantics ---------- */
const HDR = ["First Name", "Last Name", "Company", "Email", "Contact Owner", "Sequence"];
{
  const first = file("export-1.csv", HDR, [["Dana", "Reyes", "Reyes Freight", "dana@reyesfreight.com", "Carly Parks", "Carly Main Sequence"]]);
  let { contacts } = mergeContactsFromParsedFiles([] as Contact[], [first]);
  check("owner captured on first upload", contacts[0].apolloOwner === "Carly Parks", `got ${contacts[0].apolloOwner}`);
  check("sequence captured on first upload", JSON.stringify(contacts[0].sequences) === JSON.stringify(["Carly Main Sequence"]));

  // Same person, second sequence — must UNION, not replace. This is the
  // whole "every lead she has ever worked on" requirement.
  const second = file("export-2.csv", HDR, [["Dana", "Reyes", "Reyes Freight", "dana@reyesfreight.com", "Carly Parks", "Carly Main Sequence Recycled"]]);
  ({ contacts } = mergeContactsFromParsedFiles(contacts, [second]));
  check("one contact after re-upload (no duplicate)", contacts.length === 1, `got ${contacts.length}`);
  check("sequences union to two", (contacts[0].sequences || []).length === 2, JSON.stringify(contacts[0].sequences));

  // Re-stating a sequence already on file must not duplicate it.
  ({ contacts } = mergeContactsFromParsedFiles(contacts, [second]));
  check("re-stating a sequence does not duplicate it", (contacts[0].sequences || []).length === 2, JSON.stringify(contacts[0].sequences));

  // Case variation is the same sequence, not a second filter option.
  const casey = file("export-3.csv", HDR, [["Dana", "Reyes", "Reyes Freight", "dana@reyesfreight.com", "Carly Parks", "carly main sequence"]]);
  ({ contacts } = mergeContactsFromParsedFiles(contacts, [casey]));
  check("case-variant sequence does not create a second entry", (contacts[0].sequences || []).length === 2, JSON.stringify(contacts[0].sequences));

  // Reassignment in Apollo must stick.
  const reassigned = file("export-4.csv", HDR, [["Dana", "Reyes", "Reyes Freight", "dana@reyesfreight.com", "Jack Snellgrove", "Carly Main Sequence"]]);
  ({ contacts } = mergeContactsFromParsedFiles(contacts, [reassigned]));
  check("reassignment overwrites owner", contacts[0].apolloOwner === "Jack Snellgrove", `got ${contacts[0].apolloOwner}`);

  // A sparser export with no owner column must NOT unassign them.
  const sparse = file("export-5.csv", ["First Name", "Last Name", "Company", "Email"], [["Dana", "Reyes", "Reyes Freight", "dana@reyesfreight.com"]]);
  ({ contacts } = mergeContactsFromParsedFiles(contacts, [sparse]));
  check("blank owner does not erase an existing owner", contacts[0].apolloOwner === "Jack Snellgrove", `got ${contacts[0].apolloOwner}`);
  check("blank sequence does not erase existing sequences", (contacts[0].sequences || []).length === 2, JSON.stringify(contacts[0].sequences));
}

/* ---------- unowned rows stay unowned ---------- */
{
  const pf = file("no-owner.csv", HDR, [["Priya", "Shah", "Shah Dynamics Co", "priya@shahdynamics.com", "", ""]]);
  const { contacts } = mergeContactsFromParsedFiles([] as Contact[], [pf]);
  check("missing owner reads as undefined, not empty string", contacts[0].apolloOwner === undefined, `got ${JSON.stringify(contacts[0].apolloOwner)}`);
  check("missing sequence reads as undefined, not []", contacts[0].sequences === undefined, `got ${JSON.stringify(contacts[0].sequences)}`);
}

/* ---------- a pre-existing contact is untouched ---------- */
{
  // Every contact captured before these fields existed must keep working:
  // neither field is required anywhere, and an upload that does carry them
  // fills them in rather than rewriting the record.
  const legacy: Contact[] = [{
    id: "legacy-1",
    firstName: "Marcus", lastName: "Webb", fullName: "Marcus Webb",
    title: "IT Manager", company: "Webb Industrial", email: "mwebb@webbindustrial.com",
    workPhone: "", mobilePhone: "", employees: "", productArea: "",
    sourceFiles: ["old.csv"], firstSeenAt: "2026-01-01T00:00:00.000Z",
    lastSeenAt: "2026-01-01T00:00:00.000Z", timesSeen: 1,
  } as Contact];
  check("legacy contact has no owner field", legacy[0].apolloOwner === undefined);
  const pf = file("new.csv", HDR, [["Marcus", "Webb", "Webb Industrial", "mwebb@webbindustrial.com", "Carly Parks", "Carly Main Sequence"]]);
  const { contacts } = mergeContactsFromParsedFiles(legacy, [pf]);
  check("legacy contact matched, not duplicated", contacts.length === 1, `got ${contacts.length}`);
  check("legacy contact gains owner from new upload", contacts[0].apolloOwner === "Carly Parks");
  check("legacy contact gains sequence from new upload", (contacts[0].sequences || []).length === 1);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
