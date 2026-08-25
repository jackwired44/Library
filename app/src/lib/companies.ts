// Companies — a company-level roll-up derived from Contacts (see
// lib/contacts.ts), not its own data source: no new IndexedDB store, no new
// upload path. Purely grouping/computed from the same Contact[] every
// upload already builds. Per Jack: "we will slowly build this out with
// more data fields and closer to an actual Apollo down the road" — this is
// the seed of that (see CLAUDE.md Roadmap's "richer company-level data"
// item) — start with the roll-up, layer in real company fields later.
import type { Contact } from "./contacts";

export interface Company {
  name: string; // first-seen casing/spelling
  key: string; // normalized grouping key
  contactCount: number;
  totalTimesSeen: number;
  firstSeenAt: string;
  lastSeenAt: string;
  sourceFiles: string[];
  contacts: Contact[];
}

function normalizeCompanyKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

// Same exact-match normalization Contacts already uses for its own
// name+company dedup fallback — no fuzzy matching, so "Adams Co" and
// "Adams Co." group separately until/unless that's asked for.
export function groupContactsByCompany(contacts: Contact[]): Company[] {
  const byKey = new Map<string, Company>();
  contacts.forEach((c) => {
    const name = c.company.trim();
    if (!name) return; // a contact with no company isn't grouped anywhere yet
    const key = normalizeCompanyKey(name);
    const existing = byKey.get(key);
    if (existing) {
      existing.contactCount += 1;
      existing.totalTimesSeen += c.timesSeen;
      if (new Date(c.lastSeenAt).getTime() > new Date(existing.lastSeenAt).getTime()) existing.lastSeenAt = c.lastSeenAt;
      if (new Date(c.firstSeenAt).getTime() < new Date(existing.firstSeenAt).getTime()) existing.firstSeenAt = c.firstSeenAt;
      c.sourceFiles.forEach((f) => { if (!existing.sourceFiles.includes(f)) existing.sourceFiles.push(f); });
      existing.contacts.push(c);
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
      });
    }
  });
  return Array.from(byKey.values());
}

export function searchCompanies(companies: Company[], query: string): Company[] {
  const q = query.trim().toLowerCase();
  if (!q) return companies;
  return companies.filter((c) => c.name.toLowerCase().includes(q) || c.contacts.some((p) => p.fullName.toLowerCase().includes(q)));
}
