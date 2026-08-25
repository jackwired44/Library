// Companies — a company-level roll-up of Contacts (see lib/companies.ts).
// Read-only, no data of its own. First pass per Jack: "we will slowly
// build this out with more data fields and closer to an actual Apollo down
// the road" — start with the roll-up, expect real company fields later.
import { Fragment, useMemo, useState } from "react";
import { groupContactsByCompany, searchCompanies } from "../lib/companies";
import type { Contact } from "../lib/contacts";

interface CompaniesProps {
  contacts: Contact[];
}

type SortKey = "recent" | "name" | "contactCount";

export default function Companies({ contacts }: CompaniesProps) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("recent");
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const companies = useMemo(() => groupContactsByCompany(contacts), [contacts]);
  const filtered = useMemo(() => {
    const list = searchCompanies(companies, search);
    const sorted = [...list];
    if (sort === "recent") sorted.sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime());
    else if (sort === "name") sorted.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "contactCount") sorted.sort((a, b) => b.contactCount - a.contactCount);
    return sorted;
  }, [companies, search, sort]);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4, flexWrap: "wrap", gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Companies</h2>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          {companies.length} compan{companies.length === 1 ? "y" : "ies"} — grouped from Contacts by exact company name match.
        </span>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "16px 0", flexWrap: "wrap" }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search company or contact name…"
          style={{ flex: "1 1 280px", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px", fontSize: 13 }}
        />
        <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", fontSize: 12.5, fontWeight: 600 }}>
          <option value="recent">Most recently seen</option>
          <option value="name">Name (A–Z)</option>
          <option value="contactCount">Most contacts</option>
        </select>
      </div>

      {companies.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--muted)", padding: "24px 0" }}>
          No companies yet — every contact with a company name (from any CSV upload) is grouped here automatically.
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--muted)", padding: "24px 0" }}>No companies match "{search}".</div>
      ) : (
        <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 12 }}>
          <table>
            <thead>
              <tr style={{ background: "var(--bg)", textAlign: "left" }}>
                <th style={{ padding: "9px 12px" }}></th>
                <th style={{ padding: "9px 12px" }}>Company</th>
                <th style={{ padding: "9px 12px" }}>Contacts</th>
                <th style={{ padding: "9px 12px" }}>Times seen</th>
                <th style={{ padding: "9px 12px" }}>Last seen</th>
                <th style={{ padding: "9px 12px" }}>Sources</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((co) => {
                const expanded = expandedKey === co.key;
                return (
                  <Fragment key={co.key}>
                    <tr style={{ borderTop: "1px solid var(--border)", cursor: "pointer" }} onClick={() => setExpandedKey(expanded ? null : co.key)}>
                      <td style={{ padding: "9px 12px", color: "var(--muted)" }}>{expanded ? "▾" : "▸"}</td>
                      <td style={{ padding: "9px 12px", fontWeight: 600 }}>{co.name}</td>
                      <td style={{ padding: "9px 12px" }}>{co.contactCount}</td>
                      <td style={{ padding: "9px 12px" }}>{co.totalTimesSeen}×</td>
                      <td style={{ padding: "9px 12px", whiteSpace: "nowrap" }} title={new Date(co.lastSeenAt).toLocaleString()}>
                        {new Date(co.lastSeenAt).toLocaleDateString()}
                      </td>
                      <td style={{ padding: "9px 12px", color: "var(--muted)", fontSize: 12 }} title={co.sourceFiles.join(", ")}>
                        {co.sourceFiles.length === 1 ? co.sourceFiles[0] : `${co.sourceFiles.length} files`}
                      </td>
                    </tr>
                    {expanded && (
                      <tr style={{ background: "var(--bg)" }}>
                        <td></td>
                        <td colSpan={5} style={{ padding: "6px 12px 12px" }}>
                          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            {co.contacts.map((p) => (
                              <div key={p.id} style={{ display: "flex", gap: 10, fontSize: 12.5 }}>
                                <span style={{ fontWeight: 600, minWidth: 160 }}>{p.fullName || "—"}</span>
                                <span style={{ color: "var(--muted)", minWidth: 140 }}>{p.title || "—"}</span>
                                <span style={{ color: "var(--muted)" }}>{p.email || p.workPhone || p.mobilePhone || "—"}</span>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
