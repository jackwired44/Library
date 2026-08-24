// Contacts — a searchable, permanent directory of every person ever seen
// in a CSV upload, deduplicated across uploads (see lib/contacts.ts for the
// dedup rules). Read-only for now — no per-contact editing here, that
// still lives on the lead itself in Scanner/Library. First pass per Jack:
// "start somewhere then fine tune."
import { useMemo, useState } from "react";
import { type Contact, searchContacts } from "../lib/contacts";

interface ContactsProps {
  contacts: Contact[];
  loading: boolean;
  error: string | null;
}

type SortKey = "recent" | "name" | "company" | "timesSeen";

export default function Contacts({ contacts, loading, error }: ContactsProps) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("recent");

  const filtered = useMemo(() => {
    const list = searchContacts(contacts, search);
    const sorted = [...list];
    if (sort === "recent") sorted.sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime());
    else if (sort === "name") sorted.sort((a, b) => a.fullName.localeCompare(b.fullName));
    else if (sort === "company") sorted.sort((a, b) => a.company.localeCompare(b.company));
    else if (sort === "timesSeen") sorted.sort((a, b) => b.timesSeen - a.timesSeen);
    return sorted;
  }, [contacts, search, sort]);

  if (loading) return <div style={{ color: "var(--muted)", fontSize: 13 }}>Loading contacts…</div>;
  if (error) return <div style={{ color: "#B5443B", fontSize: 13 }}>{error}</div>;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4, flexWrap: "wrap", gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Contacts</h2>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          {contacts.length} contact{contacts.length === 1 ? "" : "s"} across every upload — deduplicated by email, then name + company.
        </span>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "16px 0", flexWrap: "wrap" }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, company, title, email, or phone…"
          style={{ flex: "1 1 280px", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px", fontSize: 13 }}
        />
        <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", fontSize: 12.5, fontWeight: 600 }}>
          <option value="recent">Most recently seen</option>
          <option value="name">Name (A–Z)</option>
          <option value="company">Company (A–Z)</option>
          <option value="timesSeen">Times seen (most first)</option>
        </select>
      </div>

      {contacts.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--muted)", padding: "24px 0" }}>
          No contacts yet — every CSV you upload through the Scanner or file directly into a Library folder adds its rows here automatically.
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--muted)", padding: "24px 0" }}>No contacts match "{search}".</div>
      ) : (
        <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 12 }}>
          <table>
            <thead>
              <tr style={{ background: "var(--bg)", textAlign: "left" }}>
                <th style={{ padding: "9px 12px" }}>Contact</th>
                <th style={{ padding: "9px 12px" }}>Company</th>
                <th style={{ padding: "9px 12px" }}>Title</th>
                <th style={{ padding: "9px 12px" }}>Email</th>
                <th style={{ padding: "9px 12px" }}>Phone</th>
                <th style={{ padding: "9px 12px" }}>Seen</th>
                <th style={{ padding: "9px 12px" }}>Sources</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "9px 12px", fontWeight: 600 }}>{c.fullName || "—"}</td>
                  <td style={{ padding: "9px 12px" }}>{c.company || "—"}</td>
                  <td style={{ padding: "9px 12px", color: "var(--muted)" }}>{c.title || "—"}</td>
                  <td style={{ padding: "9px 12px" }}>{c.email || "—"}</td>
                  <td style={{ padding: "9px 12px" }}>{c.workPhone || c.mobilePhone || "—"}</td>
                  <td style={{ padding: "9px 12px", whiteSpace: "nowrap" }} title={new Date(c.lastSeenAt).toLocaleString()}>
                    {c.timesSeen}× · {new Date(c.lastSeenAt).toLocaleDateString()}
                  </td>
                  <td style={{ padding: "9px 12px", color: "var(--muted)", fontSize: 12 }} title={c.sourceFiles.join(", ")}>
                    {c.sourceFiles.length === 1 ? c.sourceFiles[0] : `${c.sourceFiles.length} files`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
