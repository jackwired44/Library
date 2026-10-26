// Gifting — the folder for lunches, treats and appreciation sent to clients
// and prospects. One record per company: where to deliver, the company's
// gift policy, what each person likes, what's been sent, and ideas for next
// time. See lib/gifting.ts for the data model and why location is typed in
// by hand.
import { useEffect, useMemo, useState } from "react";
import type { Contact } from "../lib/contacts";
import type { CompanyProfile } from "../lib/companyProfiles";
import { groupContactsByCompany } from "../lib/companies";
import { timeZoneFromLocation } from "../lib/timezones";
import { todayDateKey } from "../lib/tasks";
import { useNow } from "../lib/useNow";
import LocalTime from "./LocalTime";
import { downloadBlob, toCSV } from "../lib/csv";
import {
  GIFT_OCCASIONS,
  GIFT_RESULTS,
  GIFT_LOG_COLUMNS,
  RELATIONSHIP_STAGES,
  giftLogRows,
  createGift,
  createIdea,
  createPerson,
  dietaryFlags,
  formatMoney,
  giftsNewestFirst,
  hasPolicy,
  lastGift,
  locationLabel,
  openIdeas,
  parseMoney,
  policyLabel,
  policyViolation,
  spentThisYear,
  type GiftAccount,
  type GiftEntry,
  type GiftOccasion,
  type GiftResult,
  type RelationshipStage,
  type PersonPreference,
} from "../lib/gifting";

interface GiftingProps {
  accounts: GiftAccount[];
  contacts: Contact[];
  companyProfiles: CompanyProfile[];
  loading: boolean;
  error: string | null;
  // Create (when missing) and return the record for a company.
  onOpenAccount: (companyName: string) => GiftAccount | null;
  onUpdateAccount: (key: string, fn: (a: GiftAccount) => GiftAccount) => void;
  onDeleteAccount: (key: string) => void;
  onLogGift: (key: string, gift: GiftEntry) => void;
  onRemoveGift: (key: string, giftId: string) => void;
  // Seed-only: the record to open on arrival (from a company card).
  initialKey?: string | null;
}

export default function Gifting({
  accounts,
  contacts,
  companyProfiles,
  loading,
  error,
  onOpenAccount,
  onUpdateAccount,
  onDeleteAccount,
  onLogGift,
  onRemoveGift,
  initialKey,
}: GiftingProps) {
  const [selectedKey, setSelectedKey] = useState<string | null>(initialKey || null);
  const [search, setSearch] = useState("");
  const [newName, setNewName] = useState("");
  const now = useNow();

  const companies = useMemo(() => groupContactsByCompany(contacts, companyProfiles), [contacts, companyProfiles]);
  const companyByKey = useMemo(() => new Map(companies.map((c) => [c.key, c])), [companies]);

  // Default to the most recently touched record once data is in, so the
  // page never opens on an empty right-hand side when there's something
  // to show.
  const sorted = useMemo(() => [...accounts].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [accounts]);
  useEffect(() => {
    if (!selectedKey && sorted.length) setSelectedKey(sorted[0].key);
  }, [selectedKey, sorted]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((a) =>
      [a.companyName, a.city, a.state, ...a.people.map((p) => p.name)].some((v) => v.toLowerCase().includes(q))
    );
  }, [sorted, search]);

  const selected = accounts.find((a) => a.key === selectedKey) || null;
  const year = new Date().getFullYear();
  const giftsThisYear = accounts.reduce((n, a) => n + a.gifts.filter((g) => g.date.startsWith(String(year))).length, 0);
  const spentYear = accounts.reduce((n, a) => n + spentThisYear(a, year), 0);
  const ideaCount = accounts.reduce((n, a) => n + openIdeas(a).length, 0);
  const existingKeys = new Set(accounts.map((a) => a.key));

  function startRecord() {
    const acc = onOpenAccount(newName);
    if (acc) {
      setSelectedKey(acc.key);
      setNewName("");
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Gifting</h1>
          <p className="page-sub">
            Lunches, treats and appreciation for clients and prospects: where to deliver, what each person likes, what's been sent, and ideas for next time.
          </p>
        </div>
        <div className="page-actions">
          <input
            className="field"
            list="gifting-company-options"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && startRecord()}
            placeholder="Company name…"
            aria-label="Company for a new gifting record"
            style={{ width: 220 }}
          />
          <datalist id="gifting-company-options">
            {companies.filter((c) => !existingKeys.has(c.key)).map((c) => (
              <option key={c.key} value={c.name} />
            ))}
          </datalist>
          <button className="btn btn-primary btn-sm" onClick={startRecord} disabled={!newName.trim()}>
            + New gifting record
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => downloadBlob(toCSV(giftLogRows(accounts), GIFT_LOG_COLUMNS), `gift-log-${todayDateKey()}.csv`)}
            disabled={!accounts.length}
            title="Every gift across every company: when, what, stage, how it landed, and delivery details. Opens in Excel or Sheets."
          >
            ⬇ Download gift log
          </button>
        </div>
      </div>

      <div className="metric-row">
        <div className="metric">
          <div className="metric-label">Accounts</div>
          <div className="metric-value">{accounts.length}</div>
        </div>
        <div className="metric">
          <div className="metric-label">Gifts sent in {year}</div>
          <div className="metric-value">{giftsThisYear}</div>
        </div>
        <div className="metric">
          <div className="metric-label">Spent in {year}</div>
          <div className="metric-value">${formatMoney(spentYear)}</div>
          <div className="metric-hint">gifts with a cost entered</div>
        </div>
        <div className="metric">
          <div className="metric-label">Open ideas</div>
          <div className="metric-value">{ideaCount}</div>
        </div>
      </div>

      {error && <div style={{ color: "var(--danger)", fontSize: 13, marginBottom: 10 }}>{error}</div>}
      {loading ? (
        <div style={{ color: "var(--muted)", fontSize: 13 }}>Loading…</div>
      ) : !accounts.length ? (
        <div className="panel">
          <div className="panel-body" style={{ color: "var(--muted)", fontSize: 13, lineHeight: 1.6 }}>
            No gifting records yet. Type a company name above (or open a company in <strong>Companies</strong> and choose
            <strong> 🎁 Start gifting record</strong>) to keep its delivery details, people's preferences, gift log and ideas in one place.
          </div>
        </div>
      ) : (
        <div className="gifting-layout">
          <div className="gifting-list">
            <input
              className="field"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search company, city, person…"
              style={{ width: "100%", marginBottom: 8 }}
            />
            {visible.map((a) => {
              const last = lastGift(a);
              return (
                <button
                  key={a.key}
                  className={`gifting-list-item${a.key === selectedKey ? " active" : ""}`}
                  onClick={() => setSelectedKey(a.key)}
                >
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{a.companyName}</div>
                  <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>
                    {[locationLabel(a), last ? `last sent ${last.date}` : "nothing sent yet"].filter(Boolean).join(" · ")}
                  </div>
                  {hasPolicy(a.policy) && (
                    <span className={`status-pill ${a.policy.noGifts ? "danger" : "warning"}`} style={{ marginTop: 4 }}>
                      {policyLabel(a.policy)}
                    </span>
                  )}
                </button>
              );
            })}
            {!visible.length && <div style={{ fontSize: 12.5, color: "var(--muted)", padding: 8 }}>No match.</div>}
          </div>

          <div style={{ minWidth: 0 }}>
            {selected ? (
              <AccountDetail
                key={selected.key}
                account={selected}
                companyContacts={companyByKey.get(selected.key)?.contacts || []}
                companyZone={companyByKey.get(selected.key)?.timeZone || null}
                now={now}
                onUpdate={(fn) => onUpdateAccount(selected.key, fn)}
                onDelete={() => {
                  const n = selected.gifts.length;
                  if (
                    window.confirm(
                      `Delete the gifting record for ${selected.companyName}? This removes its delivery details, ${selected.people.length} preference profile(s), ${n} logged gift(s) and their outreach touches. The company and its contacts are not affected.`
                    )
                  ) {
                    onDeleteAccount(selected.key);
                    setSelectedKey(null);
                  }
                }}
                onLogGift={(g) => onLogGift(selected.key, g)}
                onRemoveGift={(id) => onRemoveGift(selected.key, id)}
              />
            ) : (
              <div style={{ color: "var(--muted)", fontSize: 13 }}>Pick a company on the left.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* One company's record                                                 */
/* ------------------------------------------------------------------ */

interface AccountDetailProps {
  account: GiftAccount;
  companyContacts: Contact[];
  companyZone: string | null;
  now: Date;
  onUpdate: (fn: (a: GiftAccount) => GiftAccount) => void;
  onDelete: () => void;
  onLogGift: (g: GiftEntry) => void;
  onRemoveGift: (id: string) => void;
}

function contactName(c: Contact): string {
  return c.fullName || [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "Unnamed contact";
}

function AccountDetail({ account, companyContacts, companyZone, now, onUpdate, onDelete, onLogGift, onRemoveGift }: AccountDetailProps) {
  // The delivery address's state wins over the contacts' phone area codes:
  // it is where the food is actually going.
  const deliveryZone = timeZoneFromLocation(account.state) || companyZone;
  const dietary = dietaryFlags(account);
  const set = (patch: Partial<GiftAccount>) => onUpdate((a) => ({ ...a, ...patch }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="panel">
        <div className="panel-head" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="panel-title" style={{ fontSize: 16 }}>🎁 {account.companyName}</div>
            <div className="panel-sub">
              {locationLabel(account) || "No delivery location yet"} · their time{" "}
              <LocalTime zone={deliveryZone} now={now} source={deliveryZone ? "phone" : "unknown"} />
            </div>
          </div>
          <span className={`status-pill ${account.policy.noGifts ? "danger" : hasPolicy(account.policy) ? "warning" : "neutral"}`}>
            {policyLabel(account.policy)}
          </span>
          <button className="btn btn-sm btn-ghost" onClick={onDelete} title="Delete this gifting record">Delete record</button>
        </div>
        {dietary.length > 0 && (
          <div className="panel-body gifting-dietary">
            <strong>Dietary / allergies:</strong>{" "}
            {dietary.map((d) => `${d.name}: ${d.dietary}`).join(" · ")}
          </div>
        )}
      </div>

      <div className="gifting-two-col">
        <div className="panel">
          <div className="panel-head"><div className="panel-title">Delivery location</div></div>
          <div className="panel-body gifting-form">
            <TextField label="Street address" value={account.address} onCommit={(v) => set({ address: v })} placeholder="123 Main St, Suite 400" />
            <div style={{ display: "flex", gap: 8 }}>
              <TextField label="City" value={account.city} onCommit={(v) => set({ city: v })} />
              <TextField label="State" value={account.state} onCommit={(v) => set({ state: v })} placeholder="IL" width={80} />
            </div>
            <TextField label="Headcount to feed" value={account.headcount} onCommit={(v) => set({ headcount: v })} placeholder="~12 in office Tue/Thu" />
            <TextField
              label="Delivery notes"
              value={account.deliveryNotes}
              onCommit={(v) => set({ deliveryNotes: v })}
              placeholder="Office hours, who signs for it, front desk, parking…"
              multiline
            />
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <div className="panel-title">Gift policy</div>
            <div className="panel-sub">Government and regulated employers often cap or ban gifts. Logging over the limit warns first.</div>
          </div>
          <div className="panel-body gifting-form">
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              <input
                type="checkbox"
                checked={account.policy.noGifts}
                onChange={(e) => set({ policy: { ...account.policy, noGifts: e.target.checked } })}
              />
              This company does not accept gifts
            </label>
            <TextField
              label="Per-gift limit ($)"
              value={account.policy.limit === null ? "" : formatMoney(account.policy.limit)}
              onCommit={(v) => set({ policy: { ...account.policy, limit: parseMoney(v) } })}
              placeholder="e.g. 25 (blank = none recorded)"
              width={200}
            />
            <TextField
              label="Policy notes"
              value={account.policy.note}
              onCommit={(v) => set({ policy: { ...account.policy, note: v } })}
              placeholder="Where this came from, exceptions, who confirmed it…"
              multiline
            />
          </div>
        </div>
      </div>

      <PeoplePanel account={account} companyContacts={companyContacts} onUpdate={onUpdate} />
      <GiftLogPanel account={account} companyContacts={companyContacts} onLogGift={onLogGift} onRemoveGift={onRemoveGift} onUpdate={onUpdate} />
      <IdeasPanel account={account} onUpdate={onUpdate} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* People & preferences                                                 */
/* ------------------------------------------------------------------ */

function PeoplePanel({ account, companyContacts, onUpdate }: { account: GiftAccount; companyContacts: Contact[]; onUpdate: AccountDetailProps["onUpdate"] }) {
  const [pick, setPick] = useState("");
  const [freeName, setFreeName] = useState("");
  const linked = new Set(account.people.map((p) => p.contactId).filter(Boolean));
  const available = companyContacts.filter((c) => !linked.has(c.id));

  function add() {
    let person: PersonPreference | null = null;
    if (pick) {
      const c = companyContacts.find((x) => x.id === pick);
      if (c) person = createPerson({ name: contactName(c), contactId: c.id, role: c.title || "" });
    } else if (freeName.trim()) {
      person = createPerson({ name: freeName });
    }
    if (!person) return;
    const p = person;
    onUpdate((a) => ({ ...a, people: [...a.people, p] }));
    setPick("");
    setFreeName("");
  }
  function patchPerson(id: string, patch: Partial<PersonPreference>) {
    onUpdate((a) => ({ ...a, people: a.people.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <div className="panel-title">People & preferences ({account.people.length})</div>
        <div className="panel-sub">Who we're talking to there, and what they like. Office managers and front desk count too.</div>
      </div>
      <div className="panel-body">
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          <select className="field" value={pick} onChange={(e) => { setPick(e.target.value); setFreeName(""); }} aria-label="Add a contact">
            <option value="">{available.length ? "Pick a contact at this company…" : "No more contacts on file"}</option>
            {available.map((c) => (
              <option key={c.id} value={c.id}>{contactName(c)}{c.title ? ` (${c.title})` : ""}</option>
            ))}
          </select>
          <span style={{ alignSelf: "center", fontSize: 12, color: "var(--muted)" }}>or</span>
          <input
            className="field"
            value={freeName}
            onChange={(e) => { setFreeName(e.target.value); setPick(""); }}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder="Someone not in Contacts"
          />
          <button className="btn btn-sm btn-secondary" onClick={add} disabled={!pick && !freeName.trim()}>+ Add person</button>
        </div>
        {!account.people.length && <div style={{ fontSize: 12.5, color: "var(--muted)" }}>Nobody added yet.</div>}
        <div className="gifting-people">
          {account.people.map((p) => (
            <div key={p.id} className="gifting-person">
              <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                <strong style={{ fontSize: 13 }}>{p.name}</strong>
                {p.contactId ? <span className="status-pill neutral">In Contacts</span> : null}
                <span style={{ flex: 1 }} />
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() => {
                    if (window.confirm(`Remove ${p.name}'s preferences from this record?`)) {
                      onUpdate((a) => ({ ...a, people: a.people.filter((x) => x.id !== p.id) }));
                    }
                  }}
                  aria-label={`Remove ${p.name}`}
                >✕</button>
              </div>
              <TextField label="Role" value={p.role} onCommit={(v) => patchPerson(p.id, { role: v })} />
              <TextField label="Phone" value={p.phone || ""} onCommit={(v) => patchPerson(p.id, { phone: v })} />
              <TextField label="Favorites" value={p.favorites} onCommit={(v) => patchPerson(p.id, { favorites: v })} placeholder="Tacos, Lou Malnati's, dark chocolate…" />
              <TextField label="Dietary / allergies" value={p.dietary} onCommit={(v) => patchPerson(p.id, { dietary: v })} placeholder="Vegetarian, nut allergy…" />
              <TextField label="Dislikes" value={p.dislikes} onCommit={(v) => patchPerson(p.id, { dislikes: v })} />
              <TextField label="Coffee order" value={p.coffeeOrder} onCommit={(v) => patchPerson(p.id, { coffeeOrder: v })} />
              <TextField label="Notes" value={p.notes} onCommit={(v) => patchPerson(p.id, { notes: v })} placeholder="Kids, teams, birthdays, anything personal they've shared" multiline />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Gift log                                                             */
/* ------------------------------------------------------------------ */

function GiftLogPanel({
  account,
  companyContacts,
  onLogGift,
  onRemoveGift,
  onUpdate,
}: {
  account: GiftAccount;
  companyContacts: Contact[];
  onLogGift: (g: GiftEntry) => void;
  onRemoveGift: (id: string) => void;
  onUpdate: AccountDetailProps["onUpdate"];
}) {
  const [date, setDate] = useState(todayDateKey());
  const [item, setItem] = useState("");
  const [vendor, setVendor] = useState("");
  const [cost, setCost] = useState("");
  const [occasion, setOccasion] = useState<GiftOccasion>("thank-you");
  // Defaults to the stage on this company's most recent gift — the
  // relationship rarely moves backwards between two gifts.
  const [stage, setStage] = useState<RelationshipStage | "">(() => giftsNewestFirst(account).find((g) => g.stage)?.stage || "");
  // "" = whole office; "c:<contactId>" = a contact; "p:<personId>" = a
  // preference profile with no linked contact.
  const [forKey, setForKey] = useState("");
  const [note, setNote] = useState("");

  const recipients = useMemo(() => {
    const out: { key: string; label: string; contactId: string | null }[] = [];
    const seen = new Set<string>();
    for (const p of account.people) {
      if (p.contactId) {
        seen.add(p.contactId);
        out.push({ key: `c:${p.contactId}`, label: p.name, contactId: p.contactId });
      } else {
        out.push({ key: `p:${p.id}`, label: `${p.name} (not in Contacts)`, contactId: null });
      }
    }
    for (const c of companyContacts) {
      if (!seen.has(c.id)) out.push({ key: `c:${c.id}`, label: contactName(c), contactId: c.id });
    }
    return out;
  }, [account.people, companyContacts]);

  const costValue = parseMoney(cost);
  const violation = policyViolation(account.policy, costValue);
  const recipient = recipients.find((r) => r.key === forKey) || null;

  function submit() {
    if (!item.trim() || !date) return;
    if (violation && !window.confirm(`${violation} Log this gift anyway?`)) return;
    onLogGift(
      createGift({
        date,
        item,
        vendor,
        cost: costValue,
        occasion,
        stage: stage || undefined,
        forContactId: recipient?.contactId ?? null,
        forName: recipient ? recipient.label.replace(/ \(not in Contacts\)$/, "") : "Whole office",
        note,
      })
    );
    setItem("");
    setVendor("");
    setCost("");
    setNote("");
  }

  const gifts = giftsNewestFirst(account);

  return (
    <div className="panel">
      <div className="panel-head">
        <div className="panel-title">Gift log ({gifts.length})</div>
        <div className="panel-sub">A gift to a specific contact also shows as a 🎁 touch on their Reached board. It never changes their disposition.</div>
      </div>
      <div className="panel-body">
        <div className="gifting-log-form">
          <input className="field" type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date sent" />
          <input className="field" value={item} onChange={(e) => setItem(e.target.value)} placeholder="What was sent (lunch for 10, cookie box…)" aria-label="What was sent" style={{ flex: 2, minWidth: 200 }} />
          <input className="field" value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="Vendor / local spot" aria-label="Vendor" />
          <input className="field" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="$ cost" aria-label="Cost" style={{ width: 90 }} />
          <select className="field" value={occasion} onChange={(e) => setOccasion(e.target.value as GiftOccasion)} aria-label="Occasion">
            {GIFT_OCCASIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
          <select className="field" value={stage} onChange={(e) => setStage(e.target.value as RelationshipStage | "")} aria-label="Relationship stage">
            <option value="">Stage…</option>
            {RELATIONSHIP_STAGES.map((st) => <option key={st.key} value={st.key}>{st.label}</option>)}
          </select>
          <select className="field" value={forKey} onChange={(e) => setForKey(e.target.value)} aria-label="For">
            <option value="">Whole office</option>
            {recipients.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
          <input className="field" value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="Note (optional)" aria-label="Note" style={{ flex: 1, minWidth: 160 }} />
          <button className={`btn btn-sm ${violation ? "btn-warn" : "btn-primary"}`} onClick={submit} disabled={!item.trim() || !date}>
            {violation ? "Log anyway" : "Log gift"}
          </button>
        </div>
        {violation && <div className="gifting-violation" role="alert">⚠ {violation}</div>}

        {!gifts.length ? (
          <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 10 }}>Nothing logged yet.</div>
        ) : (
          <div className="table-card" style={{ marginTop: 10 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Gift</th>
                  <th>For</th>
                  <th>Occasion</th>
                  <th>Stage</th>
                  <th style={{ textAlign: "right" }}>Cost</th>
                  <th>How it landed</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {gifts.map((g) => {
                  const over = policyViolation(account.policy, g.cost);
                  return (
                    <tr key={g.id}>
                      <td style={{ whiteSpace: "nowrap" }}>{g.date}</td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{g.item}</div>
                        <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{[g.vendor, g.note].filter(Boolean).join(" · ")}</div>
                      </td>
                      <td>{g.forName}{g.attemptId ? <span title="Logged as a touch on this contact's Reached board"> 🎁</span> : null}</td>
                      <td>{GIFT_OCCASIONS.find((o) => o.key === g.occasion)?.label || g.occasion}</td>
                      <td>
                        <select
                          className="field"
                          value={g.stage || ""}
                          onChange={(e) => {
                            const next = (e.target.value || undefined) as RelationshipStage | undefined;
                            onUpdate((a) => ({ ...a, gifts: a.gifts.map((x) => (x.id === g.id ? { ...x, stage: next } : x)) }));
                          }}
                          aria-label="Stage"
                          style={{ fontSize: 12 }}
                        >
                          <option value="">Not recorded</option>
                          {RELATIONSHIP_STAGES.map((st) => <option key={st.key} value={st.key}>{st.label}</option>)}
                        </select>
                      </td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        {g.cost === null ? "—" : `$${formatMoney(g.cost)}`}
                        {over && <span className="status-pill warning" title={over} style={{ marginLeft: 6 }}>over</span>}
                      </td>
                      <td>
                        <select
                          className="field"
                          value={g.result}
                          onChange={(e) => {
                            const result = e.target.value as GiftResult;
                            onUpdate((a) => ({ ...a, gifts: a.gifts.map((x) => (x.id === g.id ? { ...x, result } : x)) }));
                          }}
                          aria-label="How it landed"
                          style={{ fontSize: 12 }}
                        >
                          {GIFT_RESULTS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                        </select>
                      </td>
                      <td>
                        <button
                          className="btn btn-sm btn-ghost"
                          onClick={() => {
                            if (window.confirm(`Delete "${g.item}" from the gift log${g.attemptId ? " (and its touch on the Reached board)" : ""}?`)) onRemoveGift(g.id);
                          }}
                          aria-label="Delete gift"
                        >✕</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Ideas                                                                */
/* ------------------------------------------------------------------ */

function IdeasPanel({ account, onUpdate }: { account: GiftAccount; onUpdate: AccountDetailProps["onUpdate"] }) {
  const [text, setText] = useState("");
  function add() {
    const idea = createIdea(text);
    if (!idea) return;
    onUpdate((a) => ({ ...a, ideas: [idea, ...a.ideas] }));
    setText("");
  }
  return (
    <div className="panel">
      <div className="panel-head">
        <div className="panel-title">Ideas ({openIdeas(account).length} open)</div>
        <div className="panel-sub">Local spots near them, occasions coming up, things someone mentioned on a call.</div>
      </div>
      <div className="panel-body">
        <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
          <input
            className="field"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder="e.g. Portillo's for the team after go-live"
            style={{ flex: 1 }}
          />
          <button className="btn btn-sm btn-secondary" onClick={add} disabled={!text.trim()}>+ Add idea</button>
        </div>
        {!account.ideas.length && <div style={{ fontSize: 12.5, color: "var(--muted)" }}>No ideas yet.</div>}
        {account.ideas.map((i) => (
          <div key={i.id} className="gifting-idea">
            <input
              type="checkbox"
              checked={i.done}
              onChange={(e) => {
                const done = e.target.checked;
                onUpdate((a) => ({ ...a, ideas: a.ideas.map((x) => (x.id === i.id ? { ...x, done } : x)) }));
              }}
              aria-label={i.done ? "Mark idea open" : "Mark idea used"}
            />
            <span style={{ flex: 1, textDecoration: i.done ? "line-through" : "none", color: i.done ? "var(--muted)" : undefined }}>{i.text}</span>
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => onUpdate((a) => ({ ...a, ideas: a.ideas.filter((x) => x.id !== i.id) }))}
              aria-label="Delete idea"
            >✕</button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Field that saves on blur                                             */
/* ------------------------------------------------------------------ */

function TextField({
  label,
  value,
  onCommit,
  placeholder,
  multiline,
  width,
}: {
  label: string;
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  width?: number;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    const v = draft.trim();
    if (v !== value) onCommit(v);
  };
  return (
    <label className="gifting-field" style={width ? { width, flex: "none" } : undefined}>
      <span className="rd-label">{label}</span>
      {multiline ? (
        <textarea className="field" rows={2} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} placeholder={placeholder} />
      ) : (
        <input className="field" value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} placeholder={placeholder} />
      )}
    </label>
  );
}
