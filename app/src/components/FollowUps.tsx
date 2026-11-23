// Follow-ups (Engage tab) — pull Apollo calls by rep, disposition and date,
// open the Trellus recording, and draft the follow-up email from the call.
// See lib/followups.ts for the rules and lib/apolloCalls.ts for the
// network side. Nothing here sends email: "Create Outlook draft" puts a
// draft in the viewer's Outlook Drafts folder, and that is the furthest
// this page ever goes.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  type ApolloCall,
  type CallOutcomeFacet,
  type FollowUp,
  type FollowUpStatus,
  type RangePreset,
  DEFAULT_OUTCOME_NAME,
  buildDraftPrompt,
  checkDraft,
  draftSource,
  filterCalls,
  findBannedPhrases,
  findOutcomeByName,
  hasDraftSource,
  latestCallPerContact,
  loadFollowUps,
  mergeFollowUp,
  normalizeBody,
  parseDraftJson,
  resolveRange,
  saveFollowUp,
  templateDraft,
  toFollowUp,
} from "../lib/followups";
import {
  type ApolloUser,
  type CallPullProgress,
  createOutlookDraft,
  describeSampleError,
  getSample,
  loadApolloUsers,
  pullCallsSince,
} from "../lib/apolloCalls";
import { loadProfile } from "../lib/profile";
import { buildContactIndex, lookupContact, type Contact } from "../lib/contacts";
import type { AttemptChannel } from "../lib/outreachAttempts";
import LocalTime from "./LocalTime";
import { useNow } from "../lib/useNow";

interface Props {
  contacts: Contact[];
  onLogAttempt: (input: { contactId: string; channel: AttemptChannel; outcome?: string; note?: string }) => void;
}

const PREF_KEY = "followups.prefs";
interface Prefs { preset: RangePreset; from: string; to: string; userId: string; outcomeId: string }
const ALL = "__all__";
const ME = "__me__";

function readPrefs(): Partial<Prefs> {
  try { return JSON.parse(localStorage.getItem(PREF_KEY) || "{}"); } catch { return {}; }
}
function writePrefs(p: Prefs) {
  try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch { /* preference only */ }
}

const PRESETS: { key: RangePreset; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "last7", label: "Last 7 days" },
  { key: "thisMonth", label: "This month" },
  { key: "custom", label: "Custom" },
];

const STATUS_META: Record<FollowUpStatus, { label: string; cls: string }> = {
  new: { label: "New", cls: "info" },
  drafted: { label: "Drafted", cls: "warning" },
  sent: { label: "Sent", cls: "success" },
  skipped: { label: "Skipped", cls: "neutral" },
};

function fmtCall(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} · ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

export default function FollowUps({ contacts, onLogAttempt }: Props) {
  const now = useNow();
  const saved = useMemo(readPrefs, []);
  const [preset, setPreset] = useState<RangePreset>(saved.preset || "last7");
  const [fromKey, setFromKey] = useState(saved.from || "");
  const [toKey, setToKey] = useState(saved.to || "");
  const [userSel, setUserSel] = useState(saved.userId || ME);
  const [outcomeSel, setOutcomeSel] = useState(saved.outcomeId || "");

  const [rows, setRows] = useState<FollowUp[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [me, setMe] = useState<ApolloUser | null>(null);
  const [users, setUsers] = useState<ApolloUser[]>([]);
  const [facets, setFacets] = useState<CallOutcomeFacet[]>([]);
  const [senderFirst, setSenderFirst] = useState("");

  const [pulling, setPulling] = useState(false);
  const [progress, setProgress] = useState<CallPullProgress | null>(null);
  const [pullNote, setPullNote] = useState<string | null>(null);
  const [pullError, setPullError] = useState<string | null>(null);
  const [lastPullKeys, setLastPullKeys] = useState<Set<string> | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    loadFollowUps().then(setRows).catch((e) => setLoadError(String(e?.message || e)));
    loadProfile().then((p) => setSenderFirst((p.name || "").trim().split(/\s+/)[0] || "")).catch(() => {});
  }, []);

  useEffect(() => {
    writePrefs({ preset, from: fromKey, to: toKey, userId: userSel, outcomeId: outcomeSel });
  }, [preset, fromKey, toKey, userSel, outcomeSel]);

  const range = useMemo(() => resolveRange(preset, new Date(), fromKey, toKey), [preset, fromKey, toKey]);
  const resolvedUserId = userSel === ALL ? null : userSel === ME ? me?.id || null : userSel;

  // Rows on screen = what's stored, narrowed to the current selection, so
  // a lead drafted yesterday still shows as Drafted today.
  const visible = useMemo(() => {
    if (!range) return [];
    return rows
      .filter((r) => {
        const t = Date.parse(r.callAt);
        if (Number.isNaN(t) || t < range.startMs || t > range.endMs) return false;
        if (outcomeSel && outcomeSel !== ALL && r.outcomeId !== outcomeSel) return false;
        if (userSel !== ALL && resolvedUserId && r.userId !== resolvedUserId) return false;
        if (lastPullKeys && !lastPullKeys.has(r.callId)) return false;
        if (!showDone && (r.status === "sent" || r.status === "skipped")) return false;
        return true;
      })
      .sort((a, b) => Date.parse(b.callAt) - Date.parse(a.callAt));
  }, [rows, range, outcomeSel, userSel, resolvedUserId, lastPullKeys, showDone]);

  const counts = useMemo(() => {
    const todayKey = new Date().toDateString();
    return {
      todo: visible.filter((r) => r.status === "new").length,
      draftedToday: rows.filter((r) => r.draftedAt && new Date(r.draftedAt).toDateString() === todayKey).length,
    };
  }, [visible, rows]);

  function persist(next: FollowUp) {
    setRows((prev) => {
      const i = prev.findIndex((r) => r.callId === next.callId);
      if (i === -1) return [next, ...prev];
      const copy = prev.slice();
      copy[i] = next;
      return copy;
    });
    saveFollowUp(next).catch((e) => setLoadError(String(e?.message || e)));
  }

  async function pull() {
    if (!range) { setPullError("Pick a from and to date first."); return; }
    setPulling(true);
    setPullError(null);
    setPullNote(null);
    setProgress(null);
    try {
      let meNow = me;
      let usersNow = users;
      if (!meNow && users.length === 0) {
        const u = await loadApolloUsers();
        meNow = u.me;
        usersNow = u.users;
        setMe(u.me);
        setUsers(u.users);
      }
      const uid = userSel === ALL ? null : userSel === ME ? meNow?.id || null : userSel;
      if (userSel === ME && !uid) {
        setPullError("Couldn't tell which Apollo user you are, so this pulls everyone. Pick yourself from the list to narrow it.");
      }
      const res = await pullCallsSince({ startMs: range.startMs, userId: uid, onProgress: setProgress });
      setFacets(res.facets);

      let outcomeId = outcomeSel;
      if (!outcomeId) {
        outcomeId = findOutcomeByName(res.facets, DEFAULT_OUTCOME_NAME)?.value || ALL;
        setOutcomeSel(outcomeId);
      }
      const matched: ApolloCall[] = filterCalls(res.calls, {
        outcomeIds: outcomeId === ALL ? [] : [outcomeId],
        userId: uid,
        range,
      });
      const grouped = latestCallPerContact(matched);
      const byId = new Map(rows.map((r) => [r.callId, r]));
      const fresh = grouped.map(({ call, count }) => mergeFollowUp(byId.get(call.id), toFollowUp(call, count, res.facets)));
      for (const f of fresh) await saveFollowUp(f);
      setRows((prev) => {
        const m = new Map(prev.map((r) => [r.callId, r]));
        fresh.forEach((f) => m.set(f.callId, f));
        return [...m.values()];
      });
      setLastPullKeys(new Set(fresh.map((f) => f.callId)));
      const oldest = res.calls.length ? new Date(Math.min(...res.calls.map((c) => Date.parse(c.start_time || "") || Infinity))) : null;
      const who = uid ? usersNow.find((u) => u.id === uid)?.name || meNow?.name || "selected user" : "everyone";
      setPullNote(
        `Scanned ${res.scanned.toLocaleString()} calls for ${who}` +
          (oldest ? ` back to ${oldest.toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : "") +
          ` · ${matched.length} matching call${matched.length === 1 ? "" : "s"}, ${fresh.length} lead${fresh.length === 1 ? "" : "s"}.` +
          (res.hitCap ? ` Stopped at ${res.pages} pages before reaching the start of the range, so older calls in this range are missing. Narrow the dates or pick one user.` : "")
      );
    } catch (e) {
      setPullError(String((e as Error)?.message || e));
    } finally {
      setPulling(false);
    }
  }

  const outcomeOptions = useMemo(() => {
    const list = facets.length ? facets : [];
    return list.slice().sort((a, b) => a.display_name.trim().localeCompare(b.display_name.trim()));
  }, [facets]);

  const open = openId ? rows.find((r) => r.callId === openId) || null : null;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Follow-ups</h1>
          <p className="page-sub">
            Pull calls by rep, disposition and date, then draft the follow-up email from what was said on the call.
          </p>
        </div>
        <button className="btn btn-primary" onClick={pull} disabled={pulling}>
          {pulling ? "Pulling…" : "Pull calls"}
        </button>
      </div>

      <div className="control-strip" style={{ flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <label className="fu-label">
          Rep
          <select className="field" value={userSel} onChange={(e) => { setUserSel(e.target.value); setLastPullKeys(null); }} aria-label="Rep">
            <option value={ME}>{me ? `Me (${me.name})` : "Me"}</option>
            {users.filter((u) => u.id !== me?.id).map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
            <option value={ALL}>Everyone</option>
          </select>
        </label>
        <label className="fu-label">
          Disposition
          <select className="field" value={outcomeSel} onChange={(e) => { setOutcomeSel(e.target.value); setLastPullKeys(null); }} aria-label="Disposition">
            {!outcomeSel && <option value="">{DEFAULT_OUTCOME_NAME}</option>}
            {outcomeOptions.map((f) => (
              <option key={f.value} value={f.value}>{f.display_name.trim()}</option>
            ))}
            {outcomeSel && !outcomeOptions.some((f) => f.value === outcomeSel) && outcomeSel !== ALL && (
              <option value={outcomeSel}>{DEFAULT_OUTCOME_NAME}</option>
            )}
            <option value={ALL}>Any disposition</option>
          </select>
        </label>
        <div className="seg" role="group" aria-label="Date range">
          {PRESETS.map((p) => (
            <button key={p.key} className={`seg-btn${preset === p.key ? " active" : ""}`} onClick={() => { setPreset(p.key); setLastPullKeys(null); }}>
              {p.label}
            </button>
          ))}
        </div>
        {preset === "custom" && (
          <span style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 13 }}>
            <input type="date" className="field" aria-label="From date" value={fromKey} onChange={(e) => { setFromKey(e.target.value); setLastPullKeys(null); }} />
            to
            <input type="date" className="field" aria-label="To date" value={toKey} onChange={(e) => { setToKey(e.target.value); setLastPullKeys(null); }} />
          </span>
        )}
        <label style={{ fontSize: 13, display: "inline-flex", gap: 6, alignItems: "center", marginLeft: "auto" }}>
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
          Show sent &amp; skipped
        </label>
      </div>

      {pulling && progress && (
        <p className="fu-note" role="status">
          Scanned {progress.scanned.toLocaleString()} calls
          {progress.oldestMs ? ` back to ${new Date(progress.oldestMs).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : ""}…
        </p>
      )}
      {pullNote && !pulling && <p className="fu-note" role="status">{pullNote}</p>}
      {pullError && <p className="fu-error" role="alert">{pullError}</p>}
      {loadError && <p className="fu-error" role="alert">{loadError}</p>}

      <div className="fu-counts">
        <strong>{counts.todo}</strong> to follow up · <strong>{counts.draftedToday}</strong> drafted today
        {range && <span className="fu-muted"> · {range.label}</span>}
      </div>

      <div className="table-card">
        <table className="data-table">
          <thead>
            <tr>
              <th>Contact</th>
              <th>Company</th>
              <th>Call</th>
              <th>Their time</th>
              <th>What was said</th>
              <th>Status</th>
              <th style={{ textAlign: "right" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={7} className="cell-empty" style={{ padding: 28, textAlign: "center" }}>
                  {rows.length === 0
                    ? "Pick a rep, disposition and dates, then click Pull calls."
                    : "Nothing matches this selection. Try another date range, or click Pull calls to refresh."}
                </td>
              </tr>
            )}
            {visible.map((r) => (
              <tr key={r.callId}>
                <td>
                  <div style={{ fontWeight: 600 }}>{r.name || "—"}</div>
                  <div className="fu-muted">{r.title}</div>
                </td>
                <td>{r.company || "—"}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <div>{fmtCall(r.callAt)}</div>
                  <div className="fu-muted">
                    {r.outcomeLabel}
                    {r.callCount > 1 ? ` · ${r.callCount} calls` : ""}
                    {r.callerName ? ` · ${r.callerName}` : ""}
                  </div>
                </td>
                <td>{r.timeZone ? <LocalTime zone={r.timeZone} now={now} /> : "—"}</td>
                <td style={{ maxWidth: 420 }}>
                  {hasDraftSource(r) ? (
                    <div className="fu-clamp" title={draftSource(r)}>{draftSource(r)}</div>
                  ) : (
                    <span className="status-pill warning">No call summary</span>
                  )}
                </td>
                <td><span className={`status-pill ${STATUS_META[r.status].cls}`}>{STATUS_META[r.status].label}</span></td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <button className="btn btn-primary btn-sm" onClick={() => setOpenId(r.callId)}>
                    {r.draftBody ? "Open draft" : "Draft"}
                  </button>{" "}
                  {r.trellusUrl && (
                    <a className="btn btn-ghost btn-sm" href={r.trellusUrl} target="_blank" rel="noopener noreferrer">
                      Recording ↗
                    </a>
                  )}{" "}
                  {r.status !== "skipped" && r.status !== "sent" && (
                    <button className="btn btn-ghost btn-sm" onClick={() => persist({ ...r, status: "skipped" })}>Skip</button>
                  )}
                  {(r.status === "skipped" || r.status === "sent") && (
                    <button className="btn btn-ghost btn-sm" onClick={() => persist({ ...r, status: r.draftBody ? "drafted" : "new", sentAt: undefined })}>Undo</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {open && (
        <DraftPanel
          key={open.callId}
          row={open}
          senderFirst={senderFirst || (me?.name || "").split(/\s+/)[0] || ""}
          onSave={persist}
          onClose={() => setOpenId(null)}
          onMarkSent={(r) => {
            persist({ ...r, status: "sent", sentAt: new Date().toISOString() });
            const local = lookupContact(buildContactIndex(contacts), r.name, r.company, r.email);
            if (local) onLogAttempt({ contactId: local.id, channel: "email", note: `Follow-up: ${r.draftSubject || ""}`.trim() });
            setOpenId(null);
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function DraftPanel({
  row,
  senderFirst,
  onSave,
  onClose,
  onMarkSent,
}: {
  row: FollowUp;
  senderFirst: string;
  onSave: (f: FollowUp) => void;
  onClose: () => void;
  onMarkSent: (f: FollowUp) => void;
}) {
  const [subject, setSubject] = useState(row.draftSubject || "");
  const [body, setBody] = useState(row.draftBody || "");
  const [source, setSource] = useState<"ai" | "template" | undefined>(row.draftSource);
  const [pasted, setPasted] = useState(row.pastedNotes || "");
  const [busy, setBusy] = useState<null | "draft" | "outlook">(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [outlookLink, setOutlookLink] = useState<string | null>(row.outlookWebLink || null);
  const started = useRef(false);

  const working: FollowUp = { ...row, pastedNotes: pasted };
  const canDraft = hasDraftSource(working);
  const check = body ? checkDraft(subject, body, working) : null;

  function commit(patch: Partial<FollowUp>) {
    onSave({ ...row, pastedNotes: pasted, draftSubject: subject, draftBody: body, draftSource: source, ...patch });
  }

  async function generate(mode: "ai" | "template") {
    if (!canDraft) { setErr("There's nothing from the call to draft from yet. Open the recording and paste a few notes below."); return; }
    setBusy("draft");
    setErr(null);
    setMsg(null);
    let out: { subject: string; body: string } | null = null;
    let used: "ai" | "template" = "template";
    if (mode === "ai") {
      const sample = await getSample();
      if (sample) {
        try {
          const prompt = buildDraftPrompt(working, senderFirst);
          out = parseDraftJson(await sample.json(prompt, { modelTier: "default", cache: false }));
          if (out) {
            const banned = findBannedPhrases(`${out.subject}\n${out.body}`);
            if (banned.length) {
              const retry = parseDraftJson(
                await sample.json(`${prompt}\n\nYour last draft used these, which are not allowed: ${banned.join(", ")}. Rewrite it without them.`, { modelTier: "default", cache: false })
              );
              if (retry) out = retry;
            }
            used = "ai";
          } else {
            setMsg("Claude's reply couldn't be read, so this is the template draft.");
          }
        } catch (e) {
          setMsg(describeSampleError(e));
        }
      } else {
        setMsg("Claude drafting isn't available in this view, so this is the template draft.");
      }
    }
    if (!out) out = templateDraft(working, senderFirst);
    setSubject(out.subject);
    setBody(out.body);
    setSource(used);
    onSave({
      ...row,
      pastedNotes: pasted,
      draftSubject: out.subject,
      draftBody: out.body,
      draftSource: used,
      draftedAt: new Date().toISOString(),
      status: row.status === "new" ? "drafted" : row.status,
    });
    setBusy(null);
  }

  // First open of a row with no draft yet: draft immediately — that's the
  // whole point of the button being called "Draft".
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!row.draftBody && canDraft) generate("ai");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toOutlook() {
    setBusy("outlook");
    setErr(null);
    setMsg(null);
    try {
      const res = await createOutlookDraft({ to: row.email, subject, body: normalizeBody(body) });
      setOutlookLink(res.webLink);
      commit({ outlookDraftId: res.id || undefined, outlookWebLink: res.webLink || undefined, status: row.status === "new" ? "drafted" : row.status, draftedAt: new Date().toISOString() });
      setMsg("Draft is in your Outlook Drafts folder. Review and send it from Outlook.");
    } catch (e) {
      setErr(String((e as Error)?.message || e));
    } finally {
      setBusy(null);
    }
  }

  async function copy() {
    const text = `Subject: ${subject}\n\n${normalizeBody(body)}`;
    try {
      await navigator.clipboard.writeText(text);
      setMsg("Copied.");
    } catch {
      setErr("Couldn't reach the clipboard here. Select the text and copy it by hand.");
    }
    commit({});
  }

  return (
    <div className="fu-drawer-backdrop" onClick={onClose}>
      <aside className="fu-drawer" onClick={(e) => e.stopPropagation()} aria-label="Follow-up draft">
        <header className="fu-drawer-head">
          <div>
            <div style={{ fontWeight: 700 }}>{row.name || "Unknown contact"}</div>
            <div className="fu-muted">
              {[row.title, row.company].filter(Boolean).join(" · ")} · {fmtCall(row.callAt)}
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">✕</button>
        </header>

        <section className="fu-source">
          <div className="fu-source-head">
            <span>From the call</span>
            {row.trellusUrl && (
              <a href={row.trellusUrl} target="_blank" rel="noopener noreferrer">Open recording ↗</a>
            )}
          </div>
          {row.summary ? <p>{row.summary}</p> : <p className="fu-muted">Trellus didn't leave a summary on this call.</p>}
          {row.leadNote && <p className="fu-muted"><strong>Lead note:</strong> {row.leadNote}</p>}
          <label className="fu-label" style={{ display: "block" }}>
            {row.summary ? "Add or correct notes (optional; used instead of the summary)" : "Paste notes from the recording"}
            <textarea
              className="field"
              rows={3}
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              onBlur={() => commit({})}
              placeholder="What they asked for, what you agreed to…"
              style={{ width: "100%", height: "auto", marginTop: 4 }}
            />
          </label>
        </section>

        <section className="fu-email">
          <label className="fu-label">
            To
            <input className="field" value={row.email || ""} readOnly placeholder="No email on file" />
          </label>
          <label className="fu-label">
            Subject
            <input className="field" value={subject} onChange={(e) => setSubject(e.target.value)} onBlur={() => commit({})} aria-label="Subject" />
          </label>
          <label className="fu-label" style={{ flex: 1 }}>
            <span>
              Body{" "}
              {source === "template" && <span className="status-pill neutral">Template draft</span>}
              {source === "ai" && <span className="status-pill info">Drafted from the call</span>}
            </span>
            <textarea
              className="field"
              value={busy === "draft" ? "Drafting from the call…" : body}
              onChange={(e) => setBody(e.target.value)}
              onBlur={() => commit({})}
              rows={13}
              aria-label="Body"
              disabled={busy === "draft"}
              style={{ width: "100%", height: "auto", lineHeight: 1.5 }}
            />
          </label>
          {check && busy !== "draft" && (
            <div className="fu-muted" style={{ fontSize: 12 }}>
              {check.words} words
              {check.problems.length ? <span className="fu-warn"> · {check.problems.join(" · ")}</span> : " · reads clean"}
            </div>
          )}
          {msg && <p className="fu-note">{msg}</p>}
          {err && <p className="fu-error">{err}</p>}
          {outlookLink && (
            <p className="fu-note"><a href={outlookLink} target="_blank" rel="noopener noreferrer">Open the draft in Outlook ↗</a></p>
          )}
        </section>

        <footer className="fu-drawer-foot">
          <button className="btn btn-primary" onClick={toOutlook} disabled={!body || !!busy}>
            {busy === "outlook" ? "Creating…" : "Create Outlook draft"}
          </button>
          <button className="btn btn-secondary" onClick={copy} disabled={!body || !!busy}>Copy</button>
          <button className="btn btn-secondary" onClick={() => generate("ai")} disabled={!!busy || !canDraft}>
            {body ? "Regenerate" : "Draft"}
          </button>
          <button className="btn btn-ghost" onClick={() => generate("template")} disabled={!!busy || !canDraft} title="Fill the structure from the call notes without Claude">
            Template
          </button>
          <button className="btn btn-ghost" style={{ marginLeft: "auto" }} onClick={() => onMarkSent({ ...row, pastedNotes: pasted, draftSubject: subject, draftBody: body, draftSource: source })} disabled={!body}>
            Mark sent
          </button>
        </footer>
      </aside>
    </div>
  );
}
