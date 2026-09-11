// CRM deal import — per Jack: "add in every deal from HubSpot with their
// company name, the contact, make sure it builds into the company database
// here but also matches, and add them to intro meetings booked."
//
// Every deal in the CRM started life at the Intro Discovery stage, so a
// deal IS an intro meeting that was booked. Importing one therefore does
// three things at once: creates (or MATCHES) the contact, rolls that
// contact up into the company directory, and stamps the contact as
// "Intro meeting booked".
//
// It deliberately reuses mergeContactInputs rather than writing its own
// insert: that is the single path with the email-first / name+company /
// name-only / company-only dedup ladder, so importing someone already in
// the directory merges into their existing record instead of creating a
// second one — which is exactly the "but also matches" half of the ask.
// Companies need no separate import at all: Companies is a rollup computed
// from Contacts (lib/companies.ts), so a merged contact lands under its
// company automatically.
import { guessColumn, type ParsedFile, type ResolvedFields } from "./detection";
import { mergeContactInputs, type Contact } from "./contacts";

// Header candidates, matched by the Scanner's own tolerant guessColumn, so
// a HubSpot export ("Associated Company", "First Name") and a hand-made
// sheet ("Company", "Contact") both land without renaming columns first.
const FIELD_DEFS = [
  { key: "company", label: "Company", candidates: ["associatedcompany", "companyname", "company", "dealname", "account", "accountname"] },
  { key: "firstName", label: "First name", candidates: ["firstname", "first", "givenname"] },
  { key: "lastName", label: "Last name", candidates: ["lastname", "last", "surname", "familyname"] },
  { key: "fullName", label: "Full name", candidates: ["fullname", "contactname", "name", "contact"] },
  { key: "email", label: "Email", candidates: ["email", "emailaddress", "workemail"] },
  { key: "title", label: "Title", candidates: ["jobtitle", "title", "position"] },
  { key: "workPhone", label: "Phone", candidates: ["phonenumber", "phone", "workphone", "directphone"] },
  { key: "bookedAt", label: "Booked date", candidates: ["createdate", "createddate", "bookeddate", "meetingdate", "date"] },
  { key: "stage", label: "Deal stage", candidates: ["dealstage", "stage", "status"] },
] as const;

type FieldKey = (typeof FIELD_DEFS)[number]["key"];

export interface CrmImportResult {
  rowsRead: number;
  added: number;
  merged: number;
  companies: number;
  skippedNoIdentity: number;
  unmapped: string[];
}

// A date-only or ISO string parsed at LOCAL noon, the same convention the
// rest of this app uses, so a timezone offset can never shift a booking to
// the previous day. Anything unparseable falls back to null and the caller
// stamps "now" rather than inventing a date.
function parseBookedAt(raw: unknown): string | null {
  const v = String(raw || "").trim();
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(`${v}T12:00:00`).toISOString();
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length < 2) return { firstName: parts[0] || "", lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

export function importCrmDeals(
  existing: Contact[],
  parsedFiles: ParsedFile[]
): { contacts: Contact[]; touched: Contact[]; result: CrmImportResult } {
  let contacts = existing;
  const touchedAll: Contact[] = [];
  const result: CrmImportResult = { rowsRead: 0, added: 0, merged: 0, companies: 0, skippedNoIdentity: 0, unmapped: [] };
  const companyKeys = new Set<string>();
  const unmapped = new Set<string>();

  parsedFiles.forEach((pf) => {
    const mapping = {} as Record<FieldKey, string>;
    FIELD_DEFS.forEach((d) => {
      const col = guessColumn(pf.fields, d.candidates as unknown as string[]);
      if (col) mapping[d.key] = col;
      else if (d.key === "company") unmapped.add(d.label);
    });

    const inputs: { resolved: ResolvedFields; sourceFile: string; bookedAt: string | null }[] = [];
    pf.data.forEach((row) => {
      result.rowsRead += 1;
      const get = (k: FieldKey) => String(row[mapping[k]] ?? "").trim();
      const company = get("company");
      let firstName = get("firstName");
      let lastName = get("lastName");
      const full = get("fullName");
      if (!firstName && !lastName && full) ({ firstName, lastName } = splitName(full));
      const email = get("email");
      // A row with no company AND no person is not an identity — it would
      // key as nothing and pile up a fresh record on every re-import.
      if (!company && !firstName && !lastName && !email) {
        result.skippedNoIdentity += 1;
        return;
      }
      if (company) companyKeys.add(company.trim().toLowerCase().replace(/\s+/g, " "));
      inputs.push({
        resolved: {
          firstName, lastName, title: get("title"), company, email,
          workPhone: get("workPhone"), mobilePhone: "", employees: "", productArea: "", comments: "",
        } as ResolvedFields,
        sourceFile: pf.name,
        bookedAt: parseBookedAt(get("bookedAt")),
      });
    });

    const merged = mergeContactInputs(contacts, inputs.map(({ resolved, sourceFile }) => ({ resolved, sourceFile })));
    contacts = merged.contacts;
    result.added += merged.added;
    result.merged += merged.updated;

    // Stamp every contact this file touched as an intro meeting booked.
    // Done AFTER the merge so it applies to matched existing contacts too,
    // not just newly created ones — a lead already in the directory who
    // turns out to have a CRM deal has genuinely had an intro booked.
    const touchedIds = new Set(merged.touched.map((c) => c.id));
    const now = new Date().toISOString();
    // Earliest booked date wins for a contact appearing on several rows:
    // the first intro is the one that happened.
    const bookedByRow = inputs.map((i) => i.bookedAt).filter(Boolean) as string[];
    const earliest = bookedByRow.length ? bookedByRow.reduce((a, b) => (a < b ? a : b)) : null;
    contacts = contacts.map((c: Contact) => {
      if (!touchedIds.has(c.id)) return c;
      return {
        ...c,
        disposition: "meeting-booked",
        // Never overwrite a stamp already on file — that date is when the
        // meeting actually became booked here.
        meetingBookedAt: c.meetingBookedAt || earliest || now,
      };
    });
    touchedAll.push(...contacts.filter((c) => touchedIds.has(c.id)));
  });

  result.companies = companyKeys.size;
  result.unmapped = Array.from(unmapped);
  return { contacts, touched: touchedAll, result };
}
