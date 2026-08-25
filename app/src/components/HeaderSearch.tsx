// Global header search — per Jack: "so i can search by contacts companies
// or phone number etc." Searches the existing Contacts directory (which
// already carries company and phone per contact — see lib/contacts.ts's
// searchContacts), surfaced from anywhere in the app rather than only from
// Engage's own Contacts tab. Picking a result (or hitting Enter) jumps to
// Engage → Contacts with that search already applied — no new data path,
// no new store.
import { useMemo, useState } from "react";
import { type Contact, searchContacts } from "../lib/contacts";

interface HeaderSearchProps {
  contacts: Contact[];
  onJumpToContacts: (query: string) => void;
}

export default function HeaderSearch({ contacts, onJumpToContacts }: HeaderSearchProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const results = useMemo(() => (query.trim() ? searchContacts(contacts, query).slice(0, 6) : []), [contacts, query]);

  function jump(q: string) {
    if (!q.trim()) return;
    onJumpToContacts(q);
    setOpen(false);
    setQuery("");
  }

  return (
    <div
      className="header-search"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => e.key === "Enter" && jump(query)}
        placeholder="Search contacts, companies, phone…"
        className="header-search-input"
      />
      {open && query.trim() && (
        <div className="header-search-dropdown">
          {results.length === 0 ? (
            <div className="header-search-empty">No matches</div>
          ) : (
            results.map((c) => (
              <button key={c.id} className="header-search-result" onClick={() => jump(c.fullName || c.company)}>
                <span className="header-search-result-name">{c.fullName || "—"}</span>
                <span className="header-search-result-meta">
                  {c.company}
                  {c.workPhone || c.mobilePhone ? ` · ${c.workPhone || c.mobilePhone}` : ""}
                </span>
              </button>
            ))
          )}
          <button className="header-search-viewall" onClick={() => jump(query)}>
            View all matches in Contacts →
          </button>
        </div>
      )}
    </div>
  );
}
