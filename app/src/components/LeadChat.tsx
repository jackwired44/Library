// "Ask for leads" — the chat box in All leads.
//
// Per Jack: "i want to build a chatbot in here under all leads where i can
// type in what i want to search and it can create a list of the rules and
// prompt inputted … pull up and create a list of all uncontacted leads
// around dynamics for the last 30 days". He chose "Claude reads it": the
// request goes to Claude (lib/leadChat.ts) and comes back as a rule, shown
// as chips before anything happens. Each chip can be removed. Then: show
// the leads in the table, save the rule as a smart list that refreshes,
// snapshot today's leads into a plain list, or download a CSV in the Main
// Scanner's columns. Nothing here writes to Apollo.
import { useMemo, useState } from "react";
import { readRequest, type RuleSource } from "../lib/leadChat";
import { parseRuleText, ruleParts, withoutKeys, isEmptyRule, type SmartRule } from "../lib/smartRules";
import type { StoredLead } from "../lib/leadStore";

export interface LeadChatProps {
  industries: string[];
  /** Leads the rule matches right now, best first. */
  leadsFor: (rule: SmartRule) => StoredLead[];
  /** The rule driving the table, if any. */
  activeRule: SmartRule | null;
  onShow: (rule: SmartRule | null) => void;
  onSaveSmart?: (name: string, rule: SmartRule, text: string, matched: StoredLead[]) => { listId: string; added: number } | null;
  onSnapshot?: (name: string, matched: StoredLead[]) => { added: number; skipped: number } | null;
  onDownload: (name: string, matched: StoredLead[]) => Promise<void>;
}

interface Answer { text: string; rule: SmartRule; by: RuleSource; note?: string }

const EXAMPLES = [
  "Uncontacted Dynamics leads from the last 30 days",
  "Strong Signal M365 / Azure, not contacted in 45 days, not in a sequence",
  "Strong Signal leads that want a partner, 50+ employees",
];

export default function LeadChat({ industries, leadsFor, activeRule, onShow, onSaveSmart, onSnapshot, onDownload }: LeadChatProps) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [staleDays, setStaleDays] = useState(30);
  const [listName, setListName] = useState("");
  const [notice, setNotice] = useState("");

  const ctx = { industries };
  const matched = useMemo(() => (answer ? leadsFor(answer.rule) : []), [answer, leadsFor]);
  const defaultName = (t: string) => t.trim().replace(/\s+/g, " ").slice(0, 60) || "Smart list";

  async function ask(t = text) {
    const q = t.trim();
    if (!q || busy) return;
    setBusy(true); setNotice("");
    try {
      const a = await readRequest(q, ctx);
      setAnswer({ text: q, ...a });
      setListName(defaultName(q));
      onShow(isEmptyRule(a.rule) ? null : a.rule);
    } finally { setBusy(false); }
  }
  function preset(t: string) {
    const rule = parseRuleText(t, ctx);
    setText(t);
    setAnswer({ text: t, rule, by: "builtin" });
    setListName(defaultName(t));
    setNotice("");
    onShow(rule);
  }
  function edit(rule: SmartRule) {
    if (!answer) return;
    setAnswer({ ...answer, rule });
    if (activeRule) onShow(isEmptyRule(rule) ? null : rule);
  }

  return (
    <div className="panel" aria-label="Ask for leads" style={{ padding: "10px 14px", marginBottom: 10 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <b style={{ fontSize: 13 }}>✨ Ask for leads</b>
        <input className="field" aria-label="Ask for leads" value={text} onChange={(e) => setText(e.target.value)}
               onKeyDown={(e) => { if (e.key === "Enter") void ask(); }}
               placeholder="e.g. all uncontacted leads around Dynamics from the last 30 days"
               style={{ flex: 1, minWidth: 260 }} />
        <button className="btn btn-sm btn-primary" disabled={!text.trim() || busy} onClick={() => void ask()}>
          {busy ? "Reading…" : "Find leads"}
        </button>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 8, fontSize: 12 }}>
        <span className="muted">Quick:</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <button className="chip-btn" onClick={() => preset(`Strong Signal leads not contacted in ${staleDays} days`)}
                  title="Strong Signal leads nobody has worked in that many days: not active in a sequence, no meeting booked or do-not-contact, and not an account-manager account.">
            Strong Signal not contacted in
          </button>
          <input className="field" type="number" min={1} max={365} aria-label="Days since last contact" value={staleDays}
                 onChange={(e) => { const v = Number(e.target.value); if (v > 0) setStaleDays(Math.min(365, Math.round(v))); }}
                 style={{ width: 62, padding: "2px 6px" }} />
          <span className="muted">days</span>
        </span>
        {EXAMPLES.map((x) => <button key={x} className="chip-btn" onClick={() => preset(x)}>{x}</button>)}
      </div>

      {answer && (
        <div aria-label="What I understood" style={{ borderTop: "1px solid var(--border)", marginTop: 10, paddingTop: 8 }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", fontSize: 12.5 }}>
            <span className="muted">{answer.by === "claude" ? "Claude read this as:" : "Read as:"}</span>
            {ruleParts(answer.rule).map((p) => (
              <span key={p.label} className="chip" style={{ fontSize: 11.5 }}>
                {p.label}
                <button aria-label={`Remove ${p.label}`} onClick={() => edit(withoutKeys(answer.rule, p.keys))}
                        style={{ background: "none", border: "none", cursor: "pointer", marginLeft: 4, color: "var(--muted)" }}>✕</button>
              </span>
            ))}
            {isEmptyRule(answer.rule) && <span style={{ color: "#9A5B22" }}>Nothing to filter on in that. Try naming a product, a grade, a time frame or "uncontacted".</span>}
          </div>
          {answer.note && <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>{answer.note}</div>}
          {!isEmptyRule(answer.rule) && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8, fontSize: 12.5 }}>
              <b aria-label="Matching leads">{matched.length.toLocaleString()} lead{matched.length === 1 ? "" : "s"} match</b>
              <button className="btn btn-sm btn-secondary" onClick={() => onShow(answer.rule)} disabled={!!activeRule && activeRule === answer.rule}>
                Show in table
              </button>
              <input className="field" aria-label="List name" value={listName} onChange={(e) => setListName(e.target.value)} style={{ minWidth: 200 }} />
              {onSaveSmart && (
                <button className="btn btn-sm btn-primary" disabled={!listName.trim()}
                        title="Save this rule as a list that keeps itself current: it re-runs whenever Lists is open, so new uploads and Apollo checks flow in."
                        onClick={() => {
                          const r = onSaveSmart(listName.trim(), answer.rule, answer.text, matched);
                          setNotice(r ? `Saved smart list "${listName.trim()}" with ${r.added.toLocaleString()} leads. It refreshes itself in Lists.` : "That list name is taken or empty.");
                        }}>
                  ⚡ Save as smart list
                </button>
              )}
              {onSnapshot && (
                <button className="btn btn-sm btn-secondary" disabled={!listName.trim() || !matched.length}
                        title="Copy today's matches into a plain list that never changes on its own: the campaign record of who you contacted."
                        onClick={() => {
                          const r = onSnapshot(listName.trim(), matched);
                          setNotice(r ? `Added ${r.added.toLocaleString()} leads to "${listName.trim()}"${r.skipped ? ` (${r.skipped} already there)` : ""}.` : "Couldn't create that list.");
                        }}>
                  📋 Snapshot to list
                </button>
              )}
              <button className="btn btn-sm btn-secondary" disabled={!matched.length}
                      title="The Main Scanner's ten columns: name, title, company, email, phones, employees, product area, note."
                      onClick={() => void onDownload(listName.trim() || "leads", matched)}>
                ⬇ Download CSV
              </button>
            </div>
          )}
          {notice && <div role="status" style={{ fontSize: 12, marginTop: 6 }}>{notice}</div>}
        </div>
      )}
    </div>
  );
}
