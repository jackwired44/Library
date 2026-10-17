// Show/hide the pieces of a page. Shared by Home and All leads.
//
// Per Jack, first for Home ("filters view i can remove or add to homepage
// make a button here so i can have what i want"), then for All leads ("make
// it customizable like the home page"). A display preference, kept in this
// browser only; nothing about the leads changes.
import { useState } from "react";

export interface CustomizeItem { id: string; group: string; label: string }

export function loadHiddenSet(key: string, items: readonly CustomizeItem[]): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    const ids = raw ? (JSON.parse(raw) as string[]) : [];
    return new Set(ids.filter((x) => items.some((w) => w.id === x)));
  } catch { return new Set(); }
}

export function saveHiddenSet(key: string, hidden: Set<string>): void {
  try { localStorage.setItem(key, JSON.stringify([...hidden])); } catch { /* preference only */ }
}

export default function Customize({ items, hidden, onChange, label }: {
  items: readonly CustomizeItem[];
  hidden: Set<string>;
  onChange: (h: Set<string>) => void;
  /** The dialog's accessible name, e.g. "Customize home". */
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const groups = [...new Set(items.map((w) => w.group))];
  const toggle = (id: string) => { const n = new Set(hidden); if (n.has(id)) n.delete(id); else n.add(id); onChange(n); };
  const setGroup = (g: string, show: boolean) => {
    const n = new Set(hidden);
    for (const w of items) if (w.group === g) { if (show) n.delete(w.id); else n.add(w.id); }
    onChange(n);
  };
  return (
    <div className="filter-wrap">
      <button className={`filter-btn${hidden.size ? " on" : ""}`} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        ⚙ Customize{hidden.size > 0 && <span className="filter-count">{items.length - hidden.size}/{items.length}</span>}
      </button>
      {open && <>
        <div className="filter-pop-backdrop" onClick={() => setOpen(false)} />
        <div className="filter-pop" role="dialog" aria-label={label}>
          {groups.map((g) => (
            <div className="filter-group" key={g}>
              <div className="filter-group-title" style={{ display: "flex", gap: 8 }}>
                <span style={{ flex: 1 }}>{g}</span>
                <button className="btn btn-sm btn-ghost" style={{ padding: "0 4px", fontSize: 11 }} onClick={() => setGroup(g, true)}>All</button>
                <button className="btn btn-sm btn-ghost" style={{ padding: "0 4px", fontSize: 11 }} onClick={() => setGroup(g, false)}>None</button>
              </div>
              {items.filter((w) => w.group === g).map((w) => (
                <label key={w.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, padding: "3px 0", cursor: "pointer" }}>
                  <input type="checkbox" checked={!hidden.has(w.id)} onChange={() => toggle(w.id)} />
                  {w.label}
                </label>
              ))}
            </div>
          ))}
          <div className="filter-group" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span className="muted" style={{ fontSize: 11.5 }}>Saved in this browser.</span>
            <button className="btn btn-sm btn-ghost" disabled={!hidden.size} onClick={() => onChange(new Set())}>Show everything</button>
          </div>
        </div>
      </>}
    </div>
  );
}
