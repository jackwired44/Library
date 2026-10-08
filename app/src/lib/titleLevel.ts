// A contact's position, grouped so tens of thousands of free-text titles
// can be filtered in two clicks.
//
// Per Jack: "see the industry the contacts position … every person needs a
// profile but i need to be able to filter all at a high level quickly."
//
// Built against the real titles in his files (15,311 rows, 1,237 distinct
// titles). Two things that survey decided:
//   - 65% of rows carry NO title — the CSP export has no title column at
//     all. "No title" is therefore its own bucket, never folded into
//     another one.
//   - The single most common "title" is "Company Administrator" (633), a
//     Microsoft tenant ROLE, not a job. So are Billing administrator,
//     Technical contact, POC, Primary contact. Those get their own bucket,
//     "Contact role", rather than being read as a rank they do not state.
//
// Order is the rule: the first match wins, most senior first, so
// "Director of IT Infrastructure" is a Director and "IT Manager" a Manager.

export type TitleLevel = "csuite" | "vp" | "director" | "manager" | "staff" | "role" | "none";

export const LEVEL_META: Record<TitleLevel, { label: string }> = {
  csuite: { label: "Owner / C-suite" },
  vp: { label: "VP" },
  director: { label: "Director / Head of" },
  manager: { label: "Manager / Lead" },
  staff: { label: "IT & technical staff" },
  role: { label: "Contact role, not a title" },
  none: { label: "No title" },
};

export const LEVEL_ORDER: TitleLevel[] = ["csuite", "vp", "director", "manager", "staff", "role", "none"];

const NONE_RE = /^(n\/?a|na|none|null|undisclosed|unknown|-+|\.+|tbd|other)$/i;
/** Microsoft tenant and CRM contact ROLES. Checked after every rank, so a
 *  title naming both reads as the rank; "Company Administrator" names no
 *  rank at all and lands here. */
const ROLE_RE = /\b(company\s+administrator|billing\s+administrator|global\s+admin(istrator)?|technical\s+contact|primary\s+contact|point\s+of\s+contact|poc|decision\s+maker|buyer|personal\s+user|information\s+worker|main\s+contact|partner\s+referral)\b|^(primary|contact|partner)$/i;
const CSUITE_RE = /\b(chief\s+\w+(\s+\w+)?\s+officer|c[eitfo]o|cao|cmo|cro|ciso|cpo|president|owner|co-?owner|founder|co-?founder|principal|managing\s+director|managing\s+partner|general\s+partner|proprietor)\b/i;
const VP_RE = /\b(s?vp|e?vp|avp|vice\s+president)\b/i;
const DIRECTOR_RE = /\b(director|head\s+of|dir\.?)\b/i;
const MANAGER_RE = /\b(manager|mgr|lead|supervisor|superintendent|coordinator|controller|project\s+owner|product\s+owner)\b/i;
const STAFF_RE = /\b(admin(istrator)?|engineer|specialist|technician|analyst|architect|developer|support|desk|it|ti|sysadmin|consultant|professional|helpdesk|network|systems?)\b/i;

const IT_RE = /\b(it|ti|i\.t\.|information|technology|technical|tech|systems?|infrastructure|network|security|cyber|cio|cto|ciso|data|cloud|software|digital|helpdesk|desk|sysadmin|engineer|developer|architect)\b/i;

export function titleLevel(title: string | null | undefined): TitleLevel {
  const t = String(title || "").trim();
  if (!t || NONE_RE.test(t)) return "none";
  // "project owner" is a project role, not the owner of the company.
  if (/\bproject\s+owner|product\s+owner\b/i.test(t)) return "manager";
  // A stated rank beats a contact role: "IT Director, Technical contact"
  // is a Director. Only a title with no rank at all reads as a role.
  // VP first: "Vice President" contains "President".
  if (VP_RE.test(t)) return "vp";
  if (CSUITE_RE.test(t)) return "csuite";
  if (DIRECTOR_RE.test(t)) return "director";
  if (MANAGER_RE.test(t)) return "manager";
  if (ROLE_RE.test(t)) return "role";
  if (STAFF_RE.test(t)) return "staff";
  // A title that names something, just not a rank we recognise.
  return "staff";
}

export type TitleFunction = "it" | "business" | "unknown";

export const FUNCTION_META: Record<TitleFunction, { label: string }> = {
  it: { label: "IT / technical" },
  business: { label: "Business / leadership" },
  unknown: { label: "No title" },
};

export function titleFunction(title: string | null | undefined): TitleFunction {
  const t = String(title || "").trim();
  if (!t || NONE_RE.test(t)) return "unknown";
  return IT_RE.test(t) ? "it" : "business";
}
