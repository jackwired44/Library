// Companies — a company-level roll-up derived from Contacts (see
// lib/contacts.ts), not its own data source: no new IndexedDB store, no new
// upload path. Purely grouping/computed from the same Contact[] every
// upload already builds. Per Jack: "we will slowly build this out with
// more data fields and closer to an actual Apollo down the road" — this is
// the seed of that (see CLAUDE.md Roadmap's "richer company-level data"
// item) — start with the roll-up, layer in real company fields later.
import type { Contact } from "./contacts";
import { mostCommonZone, resolveContactTimeZone, timeZoneFromLocation } from "./timezones";
import { profileForCompany, type CompanyProfile } from "./companyProfiles";

export interface Company {
  name: string; // first-seen casing/spelling
  key: string; // normalized grouping key
  contactCount: number;
  totalTimesSeen: number;
  firstSeenAt: string;
  lastSeenAt: string;
  sourceFiles: string[];
  contacts: Contact[];
  // Rolled up from each contact's own outreach tracking (lib/contacts.ts)
  // — read-only here, per Jack's call: calls/emails/status are tracked on
  // the person, Companies just sums/counts them for an at-a-glance view.
  totalCalls: number;
  totalEmails: number;
  contactedCount: number; // outreachStatus set to anything but "not-contacted"/unset
  meetingBookedCount: number;
  // The most common resolved time zone among this company's contacts
  // (lib/timezones.ts — manual override, else phone area code). There is
  // no company location field yet, so this IS the company's zone until
  // Apollo company enrichment lands an HQ location to read instead. Null
  // when no contact resolves.
  timeZone: string | null;
  // "Known info" from a bulk Apollo export (lib/companyProfiles.ts) —
  // null until one has been imported for this company.
  profile: CompanyProfile | null;
  // Where timeZone came from: the profile's HQ state/country when there is
  // one, else the contacts' phone area codes, else nothing.
  timeZoneSource: "hq" | "contacts" | "unknown";
}

function normalizeCompanyKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

// Same exact-match normalization Contacts already uses for its own
// name+company dedup fallback — no fuzzy matching, so "Adams Co" and
// "Adams Co." group separately until/unless that's asked for.
export function groupContactsByCompany(contacts: Contact[], profiles: CompanyProfile[] = []): Company[] {
  const byKey = new Map<string, Company>();
  contacts.forEach((c) => {
    const name = c.company.trim();
    if (!name) return; // a contact with no company isn't grouped anywhere yet
    const key = normalizeCompanyKey(name);
    const contacted = Boolean(c.outreachStatus && c.outreachStatus !== "not-contacted");
    const meetingBooked = c.outreachStatus === "meeting-booked";
    const existing = byKey.get(key);
    if (existing) {
      existing.contactCount += 1;
      existing.totalTimesSeen += c.timesSeen;
      if (new Date(c.lastSeenAt).getTime() > new Date(existing.lastSeenAt).getTime()) existing.lastSeenAt = c.lastSeenAt;
      if (new Date(c.firstSeenAt).getTime() < new Date(existing.firstSeenAt).getTime()) existing.firstSeenAt = c.firstSeenAt;
      c.sourceFiles.forEach((f) => { if (!existing.sourceFiles.includes(f)) existing.sourceFiles.push(f); });
      existing.contacts.push(c);
      existing.totalCalls += c.callCount || 0;
      existing.totalEmails += c.emailCount || 0;
      if (contacted) existing.contactedCount += 1;
      if (meetingBooked) existing.meetingBookedCount += 1;
    } else {
      byKey.set(key, {
        name,
        key,
        contactCount: 1,
        totalTimesSeen: c.timesSeen,
        firstSeenAt: c.firstSeenAt,
        lastSeenAt: c.lastSeenAt,
        sourceFiles: [...c.sourceFiles],
        contacts: [c],
        totalCalls: c.callCount || 0,
        totalEmails: c.emailCount || 0,
        contactedCount: contacted ? 1 : 0,
        meetingBookedCount: meetingBooked ? 1 : 0,
        timeZone: null,
        profile: null,
        timeZoneSource: "unknown",
      });
    }
  });
  const companies = Array.from(byKey.values());
  companies.forEach((co) => {
    co.profile = profileForCompany(
      profiles,
      co.key,
      co.contacts.flatMap((c) => [c.companyWebsite || "", c.email || ""]).filter(Boolean)
    );
    // HQ location is the better signal when we have it; contacts' phones
    // are the fallback. Never guessed beyond those two.
    const fromHq = co.profile ? timeZoneFromLocation(co.profile.state, co.profile.country) : null;
    if (fromHq) { co.timeZone = fromHq; co.timeZoneSource = "hq"; return; }
    const fromContacts = mostCommonZone(co.contacts.map((c) => resolveContactTimeZone(c).zone));
    co.timeZone = fromContacts;
    co.timeZoneSource = fromContacts ? "contacts" : "unknown";
  });
  return companies;
}

export function searchCompanies(companies: Company[], query: string): Company[] {
  const q = query.trim().toLowerCase();
  if (!q) return companies;
  return companies.filter((c) => c.name.toLowerCase().includes(q) || c.contacts.some((p) => p.fullName.toLowerCase().includes(q)));
}
