// Sequence Hygiene: page state, run orchestration and rendering.
(function () {
  const R = window.SH_RULES, C = window.SH_COLLECT, D = window.SH_CONFIG.DEFAULTS;
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const safeUrl = (u) => (typeof u === "string" && /^https:\/\//i.test(u) ? u : null);
  const link = (u, text) => (safeUrl(u) ? `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(text)}</a>` : esc(text));
  const fmtDate = (s) => { const t = R.toMs(s); return t ? new Date(t).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—"; };
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const CHUNK = 15;
  const ACTIONS = { remove: "Remove", keep: "Keep in this sequence", move: "Move to another sequence", followup: "Follow up manually", skip: "Skip for now" };
  const BUCKETS = ["REMOVE", "REVIEW", "KEEP", "CONFLICTS"];
  const BUCKET_HELP = { REMOVE: "Contact made or a hard block", REVIEW: "No contact, but you should decide", KEEP: "Safe to sequence", CONFLICTS: "Already being worked elsewhere" };

  const S = {
    view: "runs", demo: false, mcp: null, store: null, persistent: false, uid: null,
    servers: {}, cfg: clone(D), sequences: null, seqLoading: false,
    runs: [], data: null, result: null, decisions: {}, actionLog: [],
    filters: { bucket: "REMOVE", keep: "", q: "", status: "", rule: "", source: "", from: "", to: "", minDays: "", maxDays: "", sort: "lastTouch", dir: "desc" },
    selected: new Set(), detail: null, progress: null, collector: null, toast: "", confirm: null, limit: 300,
    newRun: { seqId: "", product: "" }, applying: false,
  };

  // ---------- storage ----------
  function memoryStore() {
    const m = new Map();
    return { async get(id) { return m.has(id) ? clone(m.get(id)) : null; }, async set(id, v) { m.set(id, clone(v)); }, async del(id) { m.delete(id); },
      async listRuns() { return [...m.values()].filter((v) => v.kind === "run"); } };
  }
  function dbStore(db, uid) {
    const col = db.collection(`data/users/${uid}`);
    const queue = new Map();
    return {
      async get(id) { const s = await col.doc(id).get(); return s.exists ? s.data() : null; },
      async set(id, v) { const prev = queue.get(id) || Promise.resolve(); const p = prev.then(() => col.doc(id).set(v)).catch((e) => { throw e; }); queue.set(id, p.catch(() => {})); return p; },
      async del(id) { await col.doc(id).delete(); },
      async listRuns() { const snap = await col.where("kind", "==", "run").get(); return snap.docs.map((d) => d.data()); },
    };
  }

  async function saveChunks(prefix, runId, items) {
    const n = Math.ceil(items.length / CHUNK);
    for (let i = 0; i < n; i++) await S.store.set(`${prefix}__${runId}__${i}`, { kind: prefix, items: items.slice(i * CHUNK, (i + 1) * CHUNK) });
    return n;
  }
  async function saveChunk(prefix, runId, items, i) { await S.store.set(`${prefix}__${runId}__${i}`, { kind: prefix, items: items.slice(i * CHUNK, (i + 1) * CHUNK) }); }
  async function loadChunks(prefix, runId, n) {
    const out = [];
    for (let i = 0; i < n; i++) { const d = await S.store.get(`${prefix}__${runId}__${i}`); if (d && d.items) out.push(...d.items); }
    return out;
  }

  // ---------- boot ----------
  async function boot() {
    render();
    const claude = window.claude;
    const [mcp, db, user] = claude && claude.use ? await Promise.all([claude.use("mcp"), claude.use("db"), claude.use("user")]) : [null, null, null];
    S.mcp = mcp;
    if (db && user) {
      try { S.uid = await user.id(); S.store = dbStore(db, S.uid); S.persistent = true; } catch { S.store = memoryStore(); }
    } else S.store = memoryStore();
    if (!mcp) { loadDemo(); return; }
    try {
      const saved = await S.store.get("settings");
      if (saved) S.cfg = { ...clone(D), ...saved, budgets: D.budgets };
    } catch { /* first visit */ }
    await refreshConnectors();
    await refreshRuns();
    render();
  }

  function loadDemo() {
    S.demo = true;
    const demo = window.SH_DEMO.build();
    S.cfg.callSequences = demo.callSequences;
    S.data = demo;
    S.sequences = demo.sequences;
    S.runs = [demo.meta];
    evaluate();
    S.view = "review";
    render();
  }

  async function refreshConnectors() {
    try {
      const res = await S.mcp.listTools();
      S.servers = {};
      for (const m of C.MANIFEST) {
        const s = (res.servers || []).find((x) => x.server === m.server);
        S.servers[m.server] = !s ? "missing" : s.authStatus === "needs_reauth" ? "reauth" : s.tools && s.tools.length ? (s.authStatus === "connected" ? "ok" : "ask") : "missing";
      }
    } catch { S.servers = {}; }
  }
  async function refreshRuns() {
    try { S.runs = (await S.store.listRuns()).sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")); } catch { S.runs = []; }
  }

  async function loadSequences() {
    if (S.seqLoading) return;
    S.seqLoading = true; render();
    const col = new C.Collector({ mcp: S.mcp, store: S.store, cfg: S.cfg });
    try { await col.loadBudget(); S.sequences = await C.listSequences(col); await col.saveBudget(); }
    catch (e) { S.toast = e.message; }
    S.seqLoading = false; render();
  }

  function guessProduct(name) {
    if (/dynamics|d365|business central|erp|crm/i.test(name || "")) return "dynamics";
    if (/m365|365|azure|licens|copilot|office/i.test(name || "")) return "m365";
    return "";
  }
  const EMAIL_TYPES = new Set(["auto_email", "manual_email"]);
  const isEmailOnly = (seq) => seq && seq.steps && seq.steps.length > 0 && seq.steps.every((s) => EMAIL_TYPES.has(s.type));

  // ---------- run pipeline ----------
  async function startRun() {
    const seq = S.sequences && S.sequences[S.newRun.seqId];
    if (!seq) return;
    const id = `${Date.now().toString(36)}`;
    const meta = {
      kind: "run", id, createdAt: new Date().toISOString(), targetId: seq.id, targetName: seq.name,
      product: S.newRun.product || guessProduct(seq.name), targetEmailOnly: isEmailOnly(seq), targetEverSent: (seq.delivered || 0) > 0,
      phase: "sequences", cursor: 0, status: "running", notChecked: [], counts: {}, chunks: {},
      callSequences: (S.cfg.callSequences[S.newRun.product || guessProduct(seq.name)] || []).slice(),
    };
    await S.store.set(`run__${id}`, meta);
    S.data = { meta, sequences: S.sequences, people: [], colleagues: [], companyFound: {} };
    S.result = null; S.decisions = {}; S.selected.clear();
    await refreshRuns();
    runPipeline();
  }

  async function openRun(id) {
    const meta = await S.store.get(`run__${id}`);
    if (!meta) return;
    const seqDoc = await S.store.get(`seq__${id}`);
    const people = await loadChunks("p", id, (meta.chunks && meta.chunks.p) || 0);
    const colleagues = await loadChunks("c", id, (meta.chunks && meta.chunks.c) || 0);
    const coItems = await loadChunks("co", id, (meta.chunks && meta.chunks.co) || 0);
    const companyFound = {};
    for (const it of coItems) companyFound[it.id] = it.found;
    S.data = { meta, sequences: (seqDoc && seqDoc.sequences) || S.sequences || {}, people, colleagues, companyFound };
    const dec = await S.store.get(`dec__${id}`);
    S.decisions = (dec && dec.decisions) || {};
    S.actionLog = (dec && dec.log) || [];
    S.selected.clear();
    if (meta.status === "done") { evaluate(); S.view = "review"; } else S.view = "runs";
    render();
  }

  function setProgress(label, done, total) {
    S.progress = { ...(S.progress || {}), label, done, total };
    renderProgress();
  }
  function logLine(t) {
    S.progress = S.progress || { log: [] };
    S.progress.log = (S.progress.log || []).concat(`${new Date().toLocaleTimeString()}  ${t}`).slice(-60);
    renderProgress();
  }

  function companiesOf(people) {
    const map = new Map();
    for (const p of people) {
      const free = R.isFree(p.domain, S.cfg);
      const id = !free && p.domain ? `d:${p.domain}` : p.companyKey ? `n:${p.companyKey}` : null;
      if (!id) continue;
      if (!map.has(id)) map.set(id, { id, key: p.companyKey, name: p.company, domain: free ? "" : p.domain, emails: new Set(), people: [] });
      const c = map.get(id);
      if (p.email) c.emails.add(p.email);
      c.people.push({ uid: p.apolloId, nameKey: R.nameKey(p.first, p.last, p.name), email: p.email });
    }
    return [...map.values()];
  }

  async function runPipeline() {
    const d = S.data, meta = d.meta;
    const col = new C.Collector({ mcp: S.mcp, store: S.store, cfg: S.cfg });
    S.collector = col;
    S.progress = { label: "Starting", done: 0, total: 1, log: [] };
    meta.status = "running"; meta.resumeAt = null; meta.error = null;
    render();
    await col.loadBudget();
    const markDown = (e) => {
      if (!(e instanceof C.SourceDown)) return false;
      if (!meta.notChecked.some((x) => x.source === e.source)) { meta.notChecked.push({ source: e.source, reason: e.message }); logLine(`Not checked: ${e.message}`); }
      return true;
    };
    try {
      if (meta.phase === "sequences") {
        setProgress("Reading your Apollo sequences", 0, 1);
        d.sequences = await C.listSequences(col);
        await S.store.set(`seq__${meta.id}`, { kind: "seq", sequences: d.sequences });
        meta.phase = "snapshot"; await S.store.set(`run__${meta.id}`, meta);
      }
      if (meta.phase === "snapshot") {
        setProgress(`Reading everyone in "${meta.targetName}"`, 0, 1);
        const people = await C.sequenceContacts(col, meta.targetId, (n, t) => setProgress(`Reading everyone in "${meta.targetName}"`, n, t));
        for (const p of people) {
          const st = p.enrollments.find((e) => e.sequenceId === meta.targetId) || {};
          p.targetContactId = p.apolloId; p.targetMailbox = st.mailbox || null; p.targetStatus = st.status || ""; p.addedAt = st.addedAt || null;
        }
        d.people = people;
        meta.counts.people = people.length;
        meta.chunks.p = await saveChunks("p", meta.id, people);
        meta.phase = "colleagues"; await S.store.set(`run__${meta.id}`, meta);
        logLine(`${people.length} contacts in the sequence`);
      }
      if (meta.phase === "colleagues") {
        const all = [];
        for (const sid of meta.callSequences || []) {
          const nm = (d.sequences[sid] || {}).name || sid;
          setProgress(`Reading the call sequence "${nm}"`, 0, 1);
          const ppl = await C.sequenceContacts(col, sid, (n, t) => setProgress(`Reading the call sequence "${nm}"`, n, t));
          all.push(...ppl.map((p) => ({ ...p, customText: "" })));
        }
        d.colleagues = all;
        meta.chunks.c = await saveChunks("c", meta.id, all);
        meta.phase = "people"; meta.cursor = 0; await S.store.set(`run__${meta.id}`, meta);
        if (!(meta.callSequences || []).length) logLine("No call sequence picked for this product in Settings, so rules 13 and 14 were not checked");
      }
      if (meta.phase === "people") {
        const ppl = d.people;
        for (let i = meta.cursor; i < ppl.length; i++) {
          setProgress(`Checking each person (Apollo calls, email, duplicates; HubSpot)`, i, ppl.length);
          const p = ppl[i];
          p.sourceChecks = p.sourceChecks || {};
          try { await C.apolloPerson(col, p); p.sourceChecks.Apollo = { state: "checked" }; }
          catch (e) { if (e instanceof C.BudgetHit || e instanceof C.Stopped) throw e; if (!markDown(e)) p.sourceChecks.Apollo = { state: "error", reason: e.message }; }
          try { await C.hubspotPerson(col, p); p.sourceChecks["HubSpot contact"] = { state: "checked" }; }
          catch (e) { if (e instanceof C.BudgetHit || e instanceof C.Stopped) throw e; if (!markDown(e)) p.sourceChecks["HubSpot contact"] = { state: "error", reason: e.message }; }
          meta.cursor = i + 1;
          if ((i + 1) % CHUNK === 0 || i === ppl.length - 1) { await saveChunk("p", meta.id, ppl, Math.floor(i / CHUNK)); await S.store.set(`run__${meta.id}`, meta); await col.saveBudget(); }
        }
        meta.phase = "companies"; meta.cursor = 0; await S.store.set(`run__${meta.id}`, meta);
      }
      if (meta.phase === "companies") {
        const comps = companiesOf(d.people);
        let cal = null;
        try {
          setProgress("Reading your Outlook calendar", 0, 1);
          cal = await C.calendarIndex(col, S.cfg, (n, t) => setProgress("Reading your Outlook calendar", n, t));
        } catch (e) { if (e instanceof C.BudgetHit || e instanceof C.Stopped) throw e; if (!markDown(e)) meta.notChecked.push({ source: "Outlook calendar", reason: e.message }); }
        const coItems = await loadChunks("co", meta.id, (meta.chunks && meta.chunks.co) || 0);
        for (let i = meta.cursor; i < comps.length; i++) {
          const c = comps[i];
          setProgress(`Checking each company (Switchboard, Echo, HubSpot, Outlook)`, i, comps.length);
          let found;
          try { found = await C.companySources(col, c, S.cfg); }
          catch (e) { if (e instanceof C.BudgetHit || e instanceof C.Stopped) throw e; found = { sources: [], personMeetings: {}, personMail: {}, checks: { Companies: { state: "error", reason: e.message } } }; }
          for (const [k, chk] of Object.entries(found.checks || {})) if (chk.state === "error" && C.SERVERS && /not connected|Reconnect|Add it|turned off|Allow it|blocks/.test(chk.reason || "")) markDown(new C.SourceDown(k, "down", chk.reason));
          if (cal) {
            for (const pp of c.people) {
              for (const ev of cal.byEmail.get(pp.email) || []) (found.personMeetings[pp.uid] = found.personMeetings[pp.uid] || []).push({ title: ev.subject, at: ev.at, link: ev.link, source: "Outlook calendar", type: "Calendar meeting" });
            }
            if (c.domain) for (const ev of cal.byDomain.get(c.domain) || []) {
              const withPerson = ev.attendees.some((a) => c.emails.has(a));
              if (!withPerson) found.sources.push({ companyKey: c.key, domain: c.domain, kind: "contact", reason: `Calendar meeting "${ev.subject}" with someone at ${c.domain}`, source: "Outlook calendar", at: ev.at, link: ev.link });
            }
            found.checks["Outlook calendar"] = { state: "checked" };
          }
          d.companyFound[c.id] = found;
          coItems.push({ id: c.id, found });
          meta.cursor = i + 1;
          if ((i + 1) % CHUNK === 0 || i === comps.length - 1) {
            meta.chunks.co = Math.ceil(coItems.length / CHUNK);
            await saveChunk("co", meta.id, coItems, Math.floor(i / CHUNK));
            await S.store.set(`run__${meta.id}`, meta); await col.saveBudget();
          }
        }
        meta.phase = "done";
      }
      meta.status = "done"; meta.finishedAt = new Date().toISOString();
      await S.store.set(`run__${meta.id}`, meta); await col.saveBudget();
      logLine("Run finished");
      evaluate(); S.view = "review";
    } catch (e) {
      if (e instanceof C.BudgetHit) { meta.status = "paused"; meta.resumeAt = new Date(e.resumeAt).toISOString(); logLine(`Paused: ${e.message}. Resume after ${new Date(e.resumeAt).toLocaleTimeString()}.`); }
      else if (e instanceof C.Stopped) { meta.status = "paused"; logLine("Stopped. Progress is saved; resume any time."); }
      else { meta.status = "error"; meta.error = e.message || String(e); logLine(`Stopped on an error: ${meta.error}`); }
      try { await S.store.set(`run__${meta.id}`, meta); await col.saveBudget(); } catch { /* keep going */ }
    }
    S.collector = null;
    await refreshRuns();
    render();
  }

  // ---------- evaluate ----------
  function evaluate() {
    const d = S.data, meta = d.meta;
    const companySources = [];
    const personExtra = {};
    for (const found of Object.values(d.companyFound || {})) {
      companySources.push(...(found.sources || []));
      for (const [uid, ms] of Object.entries(found.personMeetings || {})) (personExtra[uid] = personExtra[uid] || { meetings: [], mail: [] }).meetings.push(...ms);
      for (const [uid, ms] of Object.entries(found.personMail || {})) (personExtra[uid] = personExtra[uid] || { meetings: [], mail: [] }).mail.push(...ms);
    }
    if (d.companySources) companySources.push(...d.companySources);
    const unavailable = C.ALWAYS_UNAVAILABLE.concat(meta.notChecked || []);
    const people = d.people.map((p) => {
      const ex = personExtra[p.apolloId] || { meetings: [], mail: [] };
      const checks = { ...(p.sourceChecks || {}) };
      for (const [cid, found] of Object.entries(d.companyFound || {})) {
        if (!companyMatches(cid, p)) continue;
        for (const [src, chk] of Object.entries(found.checks || {})) checks[src] = chk;
      }
      for (const u of meta.notChecked || []) checks[u.source] = { state: "error", reason: u.reason };
      return {
        ...p, uid: p.apolloId, meetings: (p.meetings || []).concat(ex.meetings), outlookMail: (p.outlookMail || []).concat(ex.mail),
        sourceChecks: checks, notChecked: unavailable.map((u) => u.source),
      };
    });
    const cfg = { ...S.cfg, callSequences: { ...S.cfg.callSequences, [meta.product]: meta.callSequences || S.cfg.callSequences[meta.product] || [] } };
    const res = R.evaluateRun({ cfg, now: Date.now(), target: { id: meta.targetId, name: meta.targetName }, sequences: d.sequences, product: meta.product, targetEmailOnly: meta.targetEmailOnly, people, colleagues: d.colleagues || [], companySources });
    S.result = { people: res.people, ctx: { cfg, sequences: d.sequences, target: { id: meta.targetId, name: meta.targetName } }, unavailable };
    for (const p of res.people) if (!S.decisions[p.uid]) S.decisions[p.uid] = { action: defaultAction(p), auto: true };
  }
  function companyMatches(cid, p) {
    if (cid.startsWith("d:")) return cid.slice(2) === p.domain && !R.isFree(p.domain, S.cfg);
    return cid.slice(2) === p.companyKey && (R.isFree(p.domain, S.cfg) || !p.domain);
  }
  function defaultAction(p) { return p.bucket === "REMOVE" ? "remove" : p.bucket === "KEEP" ? "keep" : p.bucket === "CONFLICTS" ? "remove" : "skip"; }

  async function saveDecisions() {
    if (!S.data || S.demo) return;
    try { await S.store.set(`dec__${S.data.meta.id}`, { kind: "dec", decisions: S.decisions, log: S.actionLog.slice(-2000) }); }
    catch (e) { S.toast = `Couldn't save your choices: ${e.message}`; render(); }
  }

  // ---------- filtering ----------
  function rows() {
    if (!S.result) return [];
    const f = S.filters;
    const q = R.lc(f.q);
    const fromT = f.from ? Date.parse(f.from) : null, toT = f.to ? Date.parse(f.to) + 86399999 : null;
    let list = S.result.people.filter((p) => p.bucket === f.bucket);
    if (f.bucket === "KEEP" && f.keep) list = list.filter((p) => p.keepGroup === f.keep);
    if (q) list = list.filter((p) => [p.name, p.email, p.company, p.title].some((x) => R.lc(x).includes(q)));
    if (f.status) list = list.filter((p) => p.status === f.status);
    if (f.rule) list = list.filter((p) => p.findings.some((x) => String(x.rule) === f.rule));
    if (f.source) list = list.filter((p) => p.findings.some((x) => x.source === f.source));
    if (fromT) list = list.filter((p) => R.toMs(p.totals.lastTouch) >= fromT);
    if (toT) list = list.filter((p) => R.toMs(p.totals.lastTouch) && R.toMs(p.totals.lastTouch) <= toT);
    if (f.minDays !== "") list = list.filter((p) => p.totals.daysSince != null && p.totals.daysSince >= Number(f.minDays));
    if (f.maxDays !== "") list = list.filter((p) => p.totals.daysSince != null && p.totals.daysSince <= Number(f.maxDays));
    const key = { name: (p) => R.lc(p.name), company: (p) => R.lc(p.company), status: (p) => R.STATUS_RANK[p.status], sequences: (p) => p.totals.sequences,
      step: (p) => (p.totals.furthest ? p.totals.furthest.step : -1), touches: (p) => p.totals.touchpoints, lastTouch: (p) => R.toMs(p.totals.lastTouch) || 0 }[f.sort] || ((p) => 0);
    list = list.slice().sort((a, b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * (f.dir === "asc" ? 1 : -1); });
    return list;
  }

  // ---------- CSV ----------
  async function download(filename, text) {
    const dl = window.claude && window.claude.use ? await window.claude.use("downloads") : null;
    if (!dl) { S.toast = "Downloads aren't available in this view. Open the page in claude.ai."; render(); return; }
    try { await dl.save({ filename, data: text }); } catch (e) { if (e && e.code !== "cancelled" && e.code !== "declined") { S.toast = `Download failed: ${e.message || e.code}`; render(); } }
  }
  function exportScope() {
    const all = S.result ? S.result.people : [];
    return S.selected.size ? all.filter((p) => S.selected.has(p.uid)) : all.filter((p) => p.bucket !== "KEEP" || true);
  }
  function exportContacts() {
    const list = exportScope();
    const cols = R.CONTACT_COLS.concat([{ label: "Your choice", get: (p) => ACTIONS[(S.decisions[p.uid] || {}).action] || "" }, { label: "Your note", get: (p) => (S.decisions[p.uid] || {}).note || "" }]);
    download(`sequence-hygiene-${slug(S.data.meta.targetName)}-contacts.csv`, R.toCsv(list, cols));
  }
  function exportTouches() {
    const list = exportScope();
    const out = [];
    for (const p of list) for (const t of R.touchpoints(p, S.result.ctx)) out.push({ ...t, name: p.name, email: p.email, company: p.company });
    download(`sequence-hygiene-${slug(S.data.meta.targetName)}-touchpoints.csv`, R.toCsv(out, R.TOUCH_COLS));
  }
  const slug = (s) => R.lc(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "run";

  // ---------- applying ----------
  function plan() {
    const meta = S.data.meta;
    const chosen = {};
    for (const p of S.result.people) { const dd = S.decisions[p.uid]; if (dd) chosen[p.uid] = dd; }
    return R.planActions(S.result.people, chosen, { id: meta.targetId, name: meta.targetName }, { targetEverSent: meta.targetEverSent });
  }
  async function execute(kind) {
    if (S.demo) { S.toast = "This is example data. Nothing was written."; S.confirm = null; render(); return; }
    const meta = S.data.meta, pl = plan();
    const col = new C.Collector({ mcp: S.mcp, store: S.store, cfg: S.cfg });
    S.applying = true; S.confirm = null; render();
    const record = (items, action, ok, msg, extra = {}) => { for (const it of items) S.actionLog.push({ at: new Date().toISOString(), uid: it.uid, name: it.name, contactId: it.contactId, action, ok, msg, ...extra }); };
    const batches = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
    try {
      if (kind === "removeHere") {
        for (const mode of ["remove", "stop"]) {
          const items = pl.removeHere.filter((x) => x.mode === mode);
          for (const b of batches(items, 50)) {
            try { await C.removeOrStop(col, b.map((x) => x.contactId), meta.targetId, mode, "Sequence Hygiene: contact already made or blocked"); record(b, `removed (${mode})`, true, "", { sequenceId: meta.targetId, mailbox: null }); }
            catch (e) { record(b, `removed (${mode})`, false, e.message); }
          }
        }
        for (const it of pl.removeHere) { const p = S.result.people.find((x) => x.uid === it.uid); const lg = S.actionLog.filter((l) => l.uid === it.uid && l.action.startsWith("removed")).pop(); if (lg && p) lg.mailbox = p.targetMailbox; }
      }
      if (kind === "finishElsewhere") {
        const bySeq = {};
        for (const it of pl.finishElsewhere) (bySeq[it.sequenceId] = bySeq[it.sequenceId] || []).push(it);
        for (const [sid, items] of Object.entries(bySeq)) for (const b of batches(items, 50)) {
          try { await C.removeOrStop(col, b.map((x) => x.contactId), sid, "stop", b[0].reason); record(b, `finished in ${(S.data.sequences[sid] || {}).name || sid}`, true, ""); }
          catch (e) { record(b, `finished in ${(S.data.sequences[sid] || {}).name || sid}`, false, e.message); }
        }
      }
      if (kind === "moveTo") {
        const removedOk = new Set(S.actionLog.filter((l) => l.ok && l.action.startsWith("removed")).map((l) => l.uid));
        const groups = {};
        for (const it of pl.moveTo) {
          if (!removedOk.has(it.uid)) { record([it], "move", false, "Not moved: remove them from this sequence first (step 1)"); continue; }
          if (!it.mailbox || !it.sequenceId) { record([it], "move", false, "No sending mailbox on record for this contact"); continue; }
          const k = `${it.sequenceId}|${it.mailbox}`;
          (groups[k] = groups[k] || []).push(it);
        }
        for (const [k, items] of Object.entries(groups)) {
          const [sid, mailbox] = k.split("|");
          for (const b of batches(items, 50)) {
            try {
              const res = await C.addToSequence(col, b.map((x) => x.contactId), sid, mailbox, "active");
              const skipped = new Set(((res.payload || {}).skipped_contact_ids) || []);
              for (const it of b) record([it], `moved to ${(S.data.sequences[sid] || {}).name || sid}`, !skipped.has(it.contactId), skipped.has(it.contactId) ? "Apollo skipped this contact (opt-out or enrollment rule)" : "");
            } catch (e) { record(b, `moved to ${(S.data.sequences[sid] || {}).name || sid}`, false, e.message); }
          }
        }
      }
    } finally {
      S.applying = false;
      await saveDecisions();
      render();
    }
  }
  async function reAdd(uids) {
    const meta = S.data.meta;
    const col = new C.Collector({ mcp: S.mcp, store: S.store, cfg: S.cfg });
    const statuses = S.result.people.map((p) => p.targetStatus).filter(Boolean);
    const status = statuses.filter((s) => s === "active").length >= statuses.length / 2 ? "active" : "paused";
    const logs = S.actionLog.filter((l) => l.ok && l.action.startsWith("removed") && uids.includes(l.uid));
    const groups = {};
    for (const l of logs) { const k = l.mailbox || ""; (groups[k] = groups[k] || []).push(l); }
    S.applying = true; S.confirm = null; render();
    for (const [mailbox, items] of Object.entries(groups)) {
      if (!mailbox) { for (const l of items) S.actionLog.push({ at: new Date().toISOString(), uid: l.uid, name: l.name, contactId: l.contactId, action: "re-added", ok: false, msg: "No original mailbox on record" }); continue; }
      try {
        await C.addToSequence(col, items.map((l) => l.contactId), meta.targetId, mailbox, status);
        for (const l of items) S.actionLog.push({ at: new Date().toISOString(), uid: l.uid, name: l.name, contactId: l.contactId, action: "re-added", ok: true, msg: `Back in at step 1 (${status})` });
      } catch (e) { for (const l of items) S.actionLog.push({ at: new Date().toISOString(), uid: l.uid, name: l.name, contactId: l.contactId, action: "re-added", ok: false, msg: e.message }); }
    }
    S.applying = false; await saveDecisions(); render();
  }

  // ---------- rendering ----------
  const app = () => $("#app");
  function render() {
    const el = app();
    if (!el) return;
    const keepScroll = el.querySelector(".table-wrap") ? el.querySelector(".table-wrap").scrollTop : 0;
    el.innerHTML = `${header()}${S.demo ? demoBanner() : ""}${S.toast ? `<div class="toast" role="status"><span>${esc(S.toast)}</span><button class="link" data-act="toast-x">Dismiss</button></div>` : ""}<main>${
      S.view === "runs" ? viewRuns() : S.view === "review" ? viewReview() : S.view === "apply" ? viewApply() : viewSettings()}</main>${S.detail ? drawer() : ""}${S.confirm ? confirmBox() : ""}`;
    const tw = el.querySelector(".table-wrap"); if (tw) tw.scrollTop = keepScroll;
  }
  function renderProgress() { const el = $("#progress"); if (el) el.outerHTML = progressBox(); }

  function header() {
    const tabs = [["runs", "Runs"], ["review", "Review"], ["apply", "Apply"], ["settings", "Settings"]];
    const meta = S.data && S.data.meta;
    return `<header class="top"><div class="brand"><span class="mark" aria-hidden="true">SH</span><div><div class="title">Sequence Hygiene</div><div class="sub">${meta ? `${esc(meta.targetName)} · ${meta.status === "done" ? `checked ${fmtDate(meta.finishedAt || meta.createdAt)}` : esc(meta.status)}` : "Pick a sequence to check"}</div></div></div>
      <nav aria-label="Views">${tabs.map(([k, l]) => `<button class="tab ${S.view === k ? "on" : ""}" data-act="view" data-v="${k}" ${(k === "review" || k === "apply") && !S.result ? "disabled" : ""}>${l}</button>`).join("")}</nav>
      <div class="conn">${C.MANIFEST.map((m) => { const st = S.demo ? "demo" : S.servers[m.server] || "ask"; return `<span class="chip st-${st}" title="${esc(m.server)}: ${esc(connLabel(st))}">${esc(shortName(m.server))}</span>`; }).join("")}</div></header>`;
  }
  const shortName = (s) => ({ "Apollo.io": "Apollo", "Echo MCP": "Echo", "WiredCIO Switchboard": "Switchboard", "WiredCIO PSA": "PSA", "Microsoft 365": "Outlook" }[s] || s);
  const connLabel = (st) => ({ ok: "connected", ask: "asks on first use", reauth: "reconnect in claude.ai Settings → Connectors", missing: "not connected: add it in claude.ai Settings → Connectors", demo: "example data" }[st] || st);
  function demoBanner() { return `<div class="banner">You're looking at made-up example data. Open this page in claude.ai to check a real Apollo sequence with your own connectors. Nothing here writes anywhere.</div>`; }

  function viewRuns() {
    const seqs = S.sequences ? Object.values(S.sequences).filter((s) => !s.archived).sort((a, b) => a.name.localeCompare(b.name)) : [];
    const pick = S.sequences && S.sequences[S.newRun.seqId];
    const product = S.newRun.product || (pick ? guessProduct(pick.name) : "");
    const callSeqs = (S.cfg.callSequences[product] || []).map((id) => (S.sequences && S.sequences[id] ? S.sequences[id].name : id));
    const running = S.collector != null;
    return `<section class="panel"><div class="panel-head"><h2>Check a sequence</h2><p>Reads every contact in the sequence and checks each one, and their company, against every source. Nothing is written until you confirm on the Apply screen.</p></div>
      ${S.demo ? `<p class="muted">Not available with example data.</p>` : `<div class="form-row">
        <label class="field grow"><span>Apollo sequence</span>${S.sequences ? `<select id="seq-pick" data-act="pick-seq"><option value="">Choose a sequence…</option>${seqs.map((s) => `<option value="${esc(s.id)}" ${s.id === S.newRun.seqId ? "selected" : ""}>${esc(s.name)}${s.active ? "" : " (inactive)"}</option>`).join("")}</select>` : `<button class="btn" data-act="load-seqs" ${S.seqLoading ? "disabled" : ""}>${S.seqLoading ? "Loading…" : "Load my sequences"}</button>`}</label>
        <label class="field"><span>Product</span><select id="product-pick" data-act="pick-product"><option value="">—</option><option value="dynamics" ${product === "dynamics" ? "selected" : ""}>Dynamics 365</option><option value="m365" ${product === "m365" ? "selected" : ""}>M365 / Azure</option></select></label>
      </div>
      ${pick ? `<dl class="facts"><div><dt>Steps</dt><dd>${pick.numSteps} · ${isEmailOnly(pick) ? "email only" : "mixed channels"}</dd></div><div><dt>Already sent</dt><dd>${pick.delivered ? `yes (${pick.delivered} delivered), so removals use "stop"` : `no, so removals use "remove"`}</dd></div>
        <div><dt>Live call sequence for this product</dt><dd>${callSeqs.length ? esc(callSeqs.join(", ")) : `<span class="warn">none picked. Rules 13 and 14 need one. <button class="link" data-act="view" data-v="settings">Pick in Settings</button></span>`}</dd></div></dl>
        <p class="muted">Apollo allows about 400 contact searches an hour. A sequence this size needs roughly three Apollo calls per person, so large runs pause at the limit and resume where they stopped.</p>` : ""}
      <div class="actions"><button class="btn primary" data-act="start-run" ${!pick || running ? "disabled" : ""}>Start check</button></div>`}
      </section>
      ${S.progress ? progressBox() : ""}
      <section class="panel"><div class="panel-head"><h2>Past runs</h2></div>${S.runs.length ? `<table class="mini"><thead><tr><th>Sequence</th><th>Started</th><th>Contacts</th><th>Status</th><th></th></tr></thead><tbody>${S.runs.map((r) => `<tr><td>${esc(r.targetName)}</td><td>${fmtDate(r.createdAt)}</td><td class="num">${r.counts && r.counts.people != null ? r.counts.people : "—"}</td><td>${runStatus(r)}</td><td class="row-actions">${r.status === "done" ? `<button class="btn sm" data-act="open-run" data-id="${esc(r.id)}">Open</button>` : r.demo ? "" : `<button class="btn sm" data-act="resume-run" data-id="${esc(r.id)}" ${running ? "disabled" : ""}>Resume</button>`}${r.demo ? "" : ` <button class="btn sm ${S.pendingDelete === r.id ? "danger" : "ghost"}" data-act="del-run" data-id="${esc(r.id)}">${S.pendingDelete === r.id ? "Click again to delete" : "Delete"}</button>`}</td></tr>`).join("")}</tbody></table>` : `<p class="muted">No runs yet. Your first one will show up here, with its results saved so you can come back to it.</p>`}
      ${!S.persistent && !S.demo ? `<p class="warn">Runs aren't being saved in this view. They'll be lost when the page closes.</p>` : ""}</section>`;
  }
  function runStatus(r) {
    if (r.status === "done") return `<span class="pill ok">Done</span>`;
    if (r.status === "paused") return `<span class="pill warn">Paused${r.resumeAt ? ` until ${new Date(r.resumeAt).toLocaleTimeString()}` : ""}</span>`;
    if (r.status === "error") return `<span class="pill bad" title="${esc(r.error)}">Stopped on an error</span>`;
    return `<span class="pill">${esc(r.phase || r.status)}</span>`;
  }
  function progressBox() {
    const p = S.progress;
    if (!p) return `<div id="progress"></div>`;
    const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
    return `<section class="panel" id="progress" aria-live="polite"><div class="panel-head row"><h2>${esc(p.label || "Working")}</h2>${S.collector ? `<button class="btn sm" data-act="stop-run">Stop</button>` : ""}</div>
      <div class="bar"><span style="width:${pct}%"></span></div><div class="muted">${p.done || 0} of ${p.total || 0}</div>
      ${(p.log || []).length ? `<pre class="log">${esc(p.log.join("\n"))}</pre>` : ""}</section>`;
  }

  function viewReview() {
    if (!S.result) return `<p class="muted">Run a check first.</p>`;
    const all = S.result.people;
    const counts = Object.fromEntries(BUCKETS.map((b) => [b, all.filter((p) => p.bucket === b).length]));
    const list = rows();
    const f = S.filters;
    const shown = list.slice(0, S.limit);
    const allSel = shown.length > 0 && shown.every((p) => S.selected.has(p.uid));
    const sources = [...new Set(all.flatMap((p) => p.findings.map((x) => x.source)))].sort();
    const rulesUsed = [...new Set(all.flatMap((p) => p.findings.map((x) => x.rule)))].sort((a, b) => a - b);
    const unavailable = S.result.unavailable;
    return `${unavailable.length ? `<details class="notice"><summary>${unavailable.length} source${unavailable.length > 1 ? "s" : ""} not checked on this run</summary><ul>${unavailable.map((u) => `<li><strong>${esc(u.source)}</strong>: ${esc(u.reason)}</li>`).join("")}</ul></details>` : ""}
      <div class="buckets" role="tablist">${BUCKETS.map((b) => `<button role="tab" class="bucket b-${b} ${f.bucket === b ? "on" : ""}" data-act="bucket" data-b="${b}" aria-selected="${f.bucket === b}"><span class="b-name">${b}</span><span class="b-count">${counts[b]}</span><span class="b-help">${BUCKET_HELP[b]}</span></button>`).join("")}</div>
      ${f.bucket === "KEEP" ? `<div class="seg">${[["", "All"], ["Never touched", "Never touched"], ["Touched, no contact", "Touched, no contact"]].map(([v, l]) => `<button class="seg-btn ${f.keep === v ? "on" : ""}" data-act="keep-group" data-v="${esc(v)}">${l} <span class="muted">${v ? all.filter((p) => p.bucket === "KEEP" && p.keepGroup === v).length : counts.KEEP}</span></button>`).join("")}</div>` : ""}
      <div class="filters">
        <label class="field grow"><span>Search</span><input id="f-q" data-act="filter" data-k="q" value="${esc(f.q)}" placeholder="Name, company, email or title"></label>
        <label class="field"><span>Status</span><select id="f-status" data-act="filter" data-k="status"><option value="">Any</option>${Object.entries(R.STATUS_LABEL).map(([k, l]) => `<option value="${k}" ${f.status === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        <label class="field"><span>Reason</span><select id="f-rule" data-act="filter" data-k="rule"><option value="">Any</option>${rulesUsed.map((r) => `<option value="${r}" ${f.rule === String(r) ? "selected" : ""}>${r}. ${esc(R.RULE_LABEL[r])}</option>`).join("")}</select></label>
        <label class="field"><span>Source</span><select id="f-source" data-act="filter" data-k="source"><option value="">Any</option>${sources.map((s) => `<option ${f.source === s ? "selected" : ""}>${esc(s)}</option>`).join("")}</select></label>
        <label class="field"><span>Last touch from</span><input type="date" id="f-from" data-act="filter" data-k="from" value="${esc(f.from)}"></label>
        <label class="field"><span>to</span><input type="date" id="f-to" data-act="filter" data-k="to" value="${esc(f.to)}"></label>
        <label class="field narrow"><span>Days since ≥</span><input type="number" min="0" id="f-min" data-act="filter" data-k="minDays" value="${esc(f.minDays)}"></label>
        <label class="field narrow"><span>≤</span><input type="number" min="0" id="f-max" data-act="filter" data-k="maxDays" value="${esc(f.maxDays)}"></label>
        <button class="btn ghost sm" data-act="clear-filters">Clear</button>
      </div>
      <div class="toolbar"><span class="muted">${list.length} shown${S.selected.size ? ` · <strong>${S.selected.size} selected</strong>` : ""}</span>
        ${list.length ? `<button class="link" data-act="select-filter">Select all ${list.length} in this filter</button>` : ""}${S.selected.size ? `<button class="link" data-act="select-none">Clear selection</button>` : ""}
        <span class="spacer"></span><button class="btn sm" data-act="export-contacts">Contacts CSV${S.selected.size ? " (selection)" : ""}</button><button class="btn sm" data-act="export-touches">Touchpoints CSV${S.selected.size ? " (selection)" : ""}</button></div>
      ${S.selected.size ? decisionBar() : ""}
      <div class="table-wrap"><table class="grid"><thead><tr>
        <th class="cb"><input type="checkbox" id="sel-page" aria-label="Select all shown" data-act="sel-page" ${allSel ? "checked" : ""}></th>
        ${th("name", "Person")}${th("company", "Company")}${th("status", "Status")}<th>Why</th>${th("sequences", "Seqs")}${th("step", "Furthest")}${th("touches", "Touches")}${th("lastTouch", "Last touch")}<th>Your choice</th></tr></thead>
        <tbody>${shown.map(rowHtml).join("") || `<tr><td colspan="10" class="empty">Nobody here with these filters.</td></tr>`}</tbody></table></div>
      ${list.length > S.limit ? `<div class="more"><button class="btn" data-act="more">Show ${Math.min(300, list.length - S.limit)} more</button></div>` : ""}`;
  }
  function th(k, label) {
    const on = S.filters.sort === k;
    return `<th><button class="sort ${on ? "on" : ""}" data-act="sort" data-k="${k}" aria-label="Sort by ${label}">${label}${on ? (S.filters.dir === "asc" ? " ↑" : " ↓") : ""}</button></th>`;
  }
  function rowHtml(p) {
    const d = S.decisions[p.uid] || {};
    const more = p.findings.length - 1;
    const nc = (p.notChecked || []).length;
    return `<tr class="${S.selected.has(p.uid) ? "sel" : ""}">
      <td class="cb"><input type="checkbox" data-act="sel" data-uid="${esc(p.uid)}" aria-label="Select ${esc(p.name)}" ${S.selected.has(p.uid) ? "checked" : ""}></td>
      <td><button class="person" data-act="open" data-uid="${esc(p.uid)}">${esc(p.name || p.email)}</button><div class="sub">${esc(p.title)}${p.companyPick ? ` <span class="pill ok">best at company</span>` : ""}</div></td>
      <td>${esc(p.company)}<div class="sub mono">${esc(p.email)}</div></td>
      <td><span class="status s-${p.status}">${esc(R.STATUS_LABEL[p.status])}</span></td>
      <td class="why">${esc(p.primaryReason || (p.bucket === "KEEP" ? (p.status === "never" ? "No calls, emails or meetings anywhere" : "Only one-way touches") : ""))}${more > 0 ? ` <span class="muted">+${more} more</span>` : ""}${nc ? `<div class="sub">${nc} source${nc > 1 ? "s" : ""} not checked</div>` : ""}</td>
      <td class="num">${p.totals.sequences}</td><td class="num">${esc(p.totals.furthestLabel || "—")}</td><td class="num">${p.totals.touchpoints}</td>
      <td class="num">${p.totals.lastTouch ? `${fmtDate(p.totals.lastTouch)}<div class="sub">${p.totals.daysSince}d ago</div>` : "—"}</td>
      <td>${d.action ? `<span class="choice c-${d.action}">${esc(ACTIONS[d.action])}</span>${d.auto ? `<div class="sub">suggested</div>` : ""}` : ""}</td></tr>`;
  }

  function moveOptions(sel) {
    const seqs = S.data && S.data.sequences ? Object.values(S.data.sequences).filter((s) => !s.archived && s.id !== S.data.meta.targetId).sort((a, b) => a.name.localeCompare(b.name)) : [];
    return `<option value="">Pick a sequence…</option>${seqs.map((s) => `<option value="${esc(s.id)}" ${sel === s.id ? "selected" : ""}>${esc(s.name)}</option>`).join("")}`;
  }
  function decisionBar() {
    const b = S.bulk || (S.bulk = { action: "remove", moveTo: "", note: "", finishElsewhere: false });
    return `<div class="decide" role="group" aria-label="Choose an outcome for the selection"><strong>${S.selected.size} selected:</strong>
      <select id="bulk-action" data-act="bulk-field" data-k="action">${Object.entries(ACTIONS).map(([k, l]) => `<option value="${k}" ${b.action === k ? "selected" : ""}>${l}</option>`).join("")}</select>
      ${b.action === "move" ? `<select id="bulk-move" data-act="bulk-field" data-k="moveTo">${moveOptions(b.moveTo)}</select>` : ""}
      <input id="bulk-note" data-act="bulk-field" data-k="note" value="${esc(b.note)}" placeholder="Note (optional)">
      <label class="inline"><input type="checkbox" id="bulk-finish" data-act="bulk-field" data-k="finishElsewhere" ${b.finishElsewhere ? "checked" : ""}> Also finish them in other active sequences</label>
      <button class="btn primary sm" data-act="bulk-apply" ${b.action === "move" && !b.moveTo ? "disabled" : ""}>Set for ${S.selected.size}</button></div>`;
  }

  function drawer() {
    const p = S.result && S.result.people.find((x) => x.uid === S.detail);
    if (!p) return "";
    const d = S.decisions[p.uid] || {};
    const t = p.totals;
    const tps = R.touchpoints(p, S.result.ctx);
    const calls = p.callResults || [];
    const hasConflict = p.findings.some((f) => f.rule === 12);
    return `<div class="scrim" data-act="close"></div><aside class="drawer" role="dialog" aria-modal="true" aria-label="${esc(p.name)}">
      <div class="drawer-head"><div><h2>${esc(p.name || p.email)}</h2><div class="sub">${esc(p.title)} · ${esc(p.company)}</div><div class="sub mono">${esc(p.email)} ${link(p.link, "Open in Apollo")}${(p.duplicateRecords || []).map((r, i) => ` · ${link(r.link, `duplicate record ${i + 1}`)}`).join("")}</div></div><button class="btn ghost sm" data-act="close" aria-label="Close">Close</button></div>
      <div class="drawer-body">
        <div class="tags"><span class="bucket-tag b-${p.bucket}">${p.bucket}</span><span class="status s-${p.status}">${esc(R.STATUS_LABEL[p.status])}</span>${p.keepGroup ? `<span class="pill">${esc(p.keepGroup)}</span>` : ""}</div>
        <section><h3>Your choice</h3><div class="choose">${Object.entries(ACTIONS).map(([k, l]) => `<button class="seg-btn ${d.action === k ? "on" : ""}" data-act="choose" data-uid="${esc(p.uid)}" data-v="${k}">${l}</button>`).join("")}</div>
          ${d.action === "move" ? `<label class="field"><span>Move to</span><select id="d-move" data-act="dfield" data-uid="${esc(p.uid)}" data-k="moveTo">${moveOptions(d.moveTo)}</select></label>` : ""}
          ${hasConflict ? `<label class="inline"><input type="checkbox" id="d-finish" data-act="dfield" data-uid="${esc(p.uid)}" data-k="finishElsewhere" ${d.finishElsewhere ? "checked" : ""}> Also finish them in their other active sequences</label>` : ""}
          <label class="field"><span>Note</span><textarea id="d-note" rows="2" data-act="dfield" data-uid="${esc(p.uid)}" data-k="note">${esc(d.note || "")}</textarea></label></section>
        <section><h3>Why they were flagged</h3>${p.findings.length ? `<ul class="findings">${p.findings.map((f) => `<li class="f-${f.effect}"><div><span class="rule">${f.rule}. ${esc(R.RULE_LABEL[f.rule])}</span> ${esc(f.reason)}</div><div class="sub">${esc(f.source)}${f.at ? ` · ${fmtDate(f.at)}` : ""}${f.basis ? ` · matched on ${esc(f.basis)}` : ""}${safeUrl(f.link) ? ` · ${link(f.link, "Open record")}` : ""}</div></li>`).join("")}</ul>` : `<p class="muted">Nothing found in any checked source.</p>`}
          ${(p.notChecked || []).length ? `<p class="sub">Not checked: ${esc(p.notChecked.join(", "))}</p>` : ""}</section>
        <section><h3>Totals</h3><dl class="totals">
          ${tot("Sequences", t.sequences)}${tot("Furthest step", t.furthestLabel ? `${t.furthestLabel}${t.furthest && t.furthest.sequenceName ? ` (${t.furthest.sequenceName})` : ""}` : "—")}${tot("Calls", `${t.calls} (${t.callsConnected} connected)`)}
          ${tot("Emails sent", t.emailsSent)}${tot("Opened", t.emailsOpened)}${tot("Replied", t.emailsReplied)}${tot("LinkedIn steps", t.linkedin)}${tot("Meetings", t.meetings)}${tot("All touchpoints", t.touchpoints)}
          ${tot("First touch", fmtDate(t.firstTouch))}${tot("Last touch", fmtDate(t.lastTouch))}${tot("Days since", t.daysSince == null ? "—" : t.daysSince)}</dl></section>
        <section><h3>Touchpoint history</h3>${tps.length ? `<div class="tp-wrap"><table class="mini"><thead><tr><th>Date</th><th>What</th><th>Sequence</th><th>Result</th></tr></thead><tbody>${tps.map((x) => `<tr><td class="nowrap">${fmtDate(x.at)}</td><td>${esc(x.type)}${x.step ? `<div class="sub">${esc(x.step)}</div>` : ""}</td><td>${esc(x.sequence || "—")}</td><td>${safeUrl(x.link) ? link(x.link, x.result) : esc(x.result)}${x.subject ? `<div class="sub">${esc(x.subject)}</div>` : ""}</td></tr>`).join("")}</tbody></table></div>` : `<p class="muted">No touchpoints anywhere.</p>`}</section>
        ${calls.length ? `<section><h3>Calls</h3><ul class="calls">${calls.map(({ call, cls }) => `<li><div><strong>${fmtDate(call.at)}</strong> · ${esc((S.cfg.outcomeLabels || {})[call.outcomeId] || "No disposition")} · ${esc(R.fmtDur(call.durationSec))} · ${esc(call.caller)}${cls.connected ? ` <span class="pill warn">connected</span>` : ""}</div>${call.summary ? `<p>${esc(call.summary)}</p>` : `<p class="muted">No note</p>`}${call.trellusUrl ? link(call.trellusUrl, "Trellus recording and transcript") : ""}</li>`).join("")}</ul></section>` : ""}
      </div></aside>`;
  }
  const tot = (k, v) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`;

  function viewApply() {
    if (!S.result) return "";
    const pl = plan(), meta = S.data.meta;
    const moveBySeq = {};
    for (const m of pl.moveTo) (moveBySeq[m.sequenceId] = moveBySeq[m.sequenceId] || []).push(m);
    const removedOk = S.actionLog.filter((l) => l.ok && l.action.startsWith("removed"));
    const reAdded = new Set(S.actionLog.filter((l) => l.ok && l.action === "re-added").map((l) => l.uid));
    const canReAdd = removedOk.filter((l) => !reAdded.has(l.uid));
    const names = (items) => `<details><summary>${items.length} contact${items.length === 1 ? "" : "s"}</summary><ul class="names">${items.map((x) => `<li>${esc(x.name)} <span class="muted">${esc(x.company)} · ${esc(x.email)}</span>${x.note ? ` <span class="sub">“${esc(x.note)}”</span>` : ""}</li>`).join("")}</ul></details>`;
    const block = (kind, title, desc, items, btn) => `<section class="panel"><div class="panel-head"><h2>${title}</h2><p>${desc}</p></div>${items.length ? names(items) : `<p class="muted">Nobody.</p>`}${btn && items.length ? `<div class="actions"><button class="btn primary" data-act="ask-confirm" data-kind="${kind}" ${S.applying ? "disabled" : ""}>${btn}</button></div>` : ""}</section>`;
    return `<section class="panel summary"><div class="panel-head"><h2>Summary of your choices</h2><p>Nothing has been written yet. Each step below asks you to confirm, with every affected contact listed.</p></div>
        <dl class="facts">${tot("Remove from this sequence", pl.removeHere.length)}${tot("Finish elsewhere", pl.finishElsewhere.length)}${tot("Move", pl.moveTo.length)}${tot("Follow up manually", pl.tagged.length)}${tot("Keep", pl.kept.length)}${tot("Skip for now", pl.skipped.length)}</dl></section>
      ${block("removeHere", `1. Remove from “${esc(meta.targetName)}”`, meta.targetEverSent ? "This sequence has already sent, so Apollo will <strong>stop</strong> them with a reason (their history stays)." : "This sequence has never sent, so Apollo will <strong>remove</strong> them outright.", pl.removeHere, `Remove ${pl.removeHere.length}…`)}
      ${block("finishElsewhere", "2. Finish them in other sequences", "Stops each person in the other sequences they're active or paused in, with the reason “being handled in this sequence”.", pl.finishElsewhere, `Finish ${pl.finishElsewhere.length}…`)}
      ${block("moveTo", "3. Move to another sequence", `Adds them to the sequence you picked, after step 1 removes them here. Apollo always starts added contacts at step 1. ${Object.entries(moveBySeq).map(([sid, it]) => `${esc((S.data.sequences[sid] || {}).name || sid)}: ${it.length}`).join(" · ")}`, pl.moveTo, `Move ${pl.moveTo.length}…`)}
      ${block("", "Follow up manually", "Tagged here only. Nothing is written to Apollo.", pl.tagged, "")}
      <section class="panel"><div class="panel-head"><h2>Re-add anyone removed by mistake</h2><p>Puts them back in this sequence with their original mailbox. Apollo starts them at step 1, not where they were.</p></div>
        ${canReAdd.length ? `<ul class="names">${canReAdd.map((l) => `<li><label class="inline"><input type="checkbox" data-act="readd-pick" data-uid="${esc(l.uid)}" ${(S.readd || new Set()).has(l.uid) ? "checked" : ""}> ${esc(l.name)}</label></li>`).join("")}</ul><div class="actions"><button class="btn" data-act="ask-confirm" data-kind="reAdd" ${(S.readd || new Set()).size && !S.applying ? "" : "disabled"}>Re-add ${(S.readd || new Set()).size}…</button></div>` : `<p class="muted">Nobody has been removed from this run yet.</p>`}</section>
      ${S.actionLog.length ? `<section class="panel"><div class="panel-head"><h2>What was written</h2></div><table class="mini"><thead><tr><th>When</th><th>Contact</th><th>Action</th><th>Result</th></tr></thead><tbody>${S.actionLog.slice().reverse().slice(0, 400).map((l) => `<tr><td class="nowrap">${new Date(l.at).toLocaleString()}</td><td>${esc(l.name)}</td><td>${esc(l.action)}</td><td>${l.ok ? `<span class="pill ok">Done</span>` : `<span class="pill bad">Failed</span> ${esc(l.msg)}`}</td></tr>`).join("")}</tbody></table></section>` : ""}`;
  }
  function confirmBox() {
    const pl = plan(), meta = S.data.meta, k = S.confirm;
    let items = [], title = "", verb = "";
    if (k === "removeHere") { items = pl.removeHere; title = `${meta.targetEverSent ? "Stop" : "Remove"} ${items.length} contact${items.length === 1 ? "" : "s"} in “${meta.targetName}”`; verb = meta.targetEverSent ? "Stop them" : "Remove them"; }
    if (k === "finishElsewhere") { items = pl.finishElsewhere.map((x) => ({ ...x, extra: (S.data.sequences[x.sequenceId] || {}).name || x.sequenceId })); title = `Finish ${items.length} enrollment${items.length === 1 ? "" : "s"} in other sequences`; verb = "Finish them"; }
    if (k === "moveTo") { items = pl.moveTo.map((x) => ({ ...x, extra: (S.data.sequences[x.sequenceId] || {}).name || x.sequenceId })); title = `Add ${items.length} contact${items.length === 1 ? "" : "s"} to another sequence`; verb = "Add them"; }
    if (k === "reAdd") { const set = S.readd || new Set(); items = S.result.people.filter((p) => set.has(p.uid)); title = `Re-add ${items.length} to “${meta.targetName}”`; verb = "Re-add them"; }
    return `<div class="scrim" data-act="cancel-confirm"></div><div class="confirm" role="alertdialog" aria-modal="true" aria-label="${esc(title)}"><h2>${esc(title)}</h2><p>This writes to your live Apollo account. These are everyone affected:</p>
      <ul class="names scroll">${items.map((x) => `<li>${esc(x.name)} <span class="muted">${esc(x.company || "")} · ${esc(x.email || "")}${x.extra ? ` → ${esc(x.extra)}` : ""}</span></li>`).join("")}</ul>
      <div class="actions"><button class="btn ghost" data-act="cancel-confirm">Cancel</button><button class="btn danger" data-act="do-confirm">${esc(verb)}</button></div></div>`;
  }

  function viewSettings() {
    const c = S.cfg;
    const seqs = S.sequences ? Object.values(S.sequences).filter((s) => !s.archived).sort((a, b) => a.name.localeCompare(b.name)) : [];
    const seqPick = (prod) => S.sequences ? `<div class="checks">${seqs.map((s) => `<label class="inline"><input type="checkbox" data-act="cs" data-prod="${prod}" data-id="${esc(s.id)}" ${(c.callSequences[prod] || []).includes(s.id) ? "checked" : ""}> ${esc(s.name)}</label>`).join("")}</div>` : `<button class="btn sm" data-act="load-seqs">${S.seqLoading ? "Loading…" : "Load my sequences"}</button>`;
    return `<section class="panel"><div class="panel-head"><h2>Live call sequences</h2><p>Rules 13 and 14 use these. Anyone ever in one is out of an email-only sequence for the same product, and a colleague active in one takes the company out.</p></div>
        <h3>Dynamics 365</h3>${seqPick("dynamics")}<h3>M365 / Azure</h3>${seqPick("m365")}</section>
      <section class="panel"><div class="panel-head"><h2>Product keywords</h2><p>Rule 17 (fit) sends a lead to REVIEW when its notes don't mention the sequence's product. Short codes like NAV or GP only count in capitals. Comma-separated.</p></div>
        <label class="field"><span>Dynamics 365</span><textarea id="kw-d" rows="2" data-act="set-list" data-k="keywords.dynamics">${esc(c.keywords.dynamics.join(", "))}</textarea></label>
        <label class="field"><span>M365 / Azure</span><textarea id="kw-m" rows="2" data-act="set-list" data-k="keywords.m365">${esc(c.keywords.m365.join(", "))}</textarea></label></section>
      <section class="panel"><div class="panel-head"><h2>Matching</h2></div>
        <label class="field"><span>Free email domains, ignored for company matching</span><textarea id="free" rows="3" data-act="set-list" data-k="freeDomains">${esc(c.freeDomains.join(", "))}</textarea></label>
        <label class="field"><span>Title priority for “keep the best one” (rule 15), first wins</span><textarea id="titles" rows="2" data-act="set-list" data-k="titlePriority">${esc(c.titlePriority.join(", "))}</textarea></label>
        <label class="field"><span>Other Outlook mailboxes to search (you need delegated access), comma-separated</span><input id="boxes" data-act="set-list" data-k="extraMailboxes" value="${esc((c.extraMailboxes || []).join(", "))}" placeholder="name@wiredcio.com"></label>
        <label class="field"><span>Outlook calendar lookback, months</span><input type="number" min="1" max="60" id="calm" data-act="set-num" data-k="calendarMonths" value="${esc(c.calendarMonths)}"></label></section>
      <section class="panel"><div class="panel-head"><h2>Calls</h2></div><div class="form-row">
        <label class="field"><span>No-disposition call counts as a conversation at (seconds)</span><input type="number" min="1" id="long" data-act="set-num" data-k="longCallSec" value="${esc(c.longCallSec)}"></label>
        <label class="field"><span>…or at (seconds) when it has no note</span><input type="number" min="1" id="mid" data-act="set-num" data-k="midCallSec" value="${esc(c.midCallSec)}"></label>
        <label class="field"><span>Wrong Number goes to</span><select id="wrong" data-act="set-str" data-k="wrongNumber"><option value="review" ${c.wrongNumber === "review" ? "selected" : ""}>REVIEW</option><option value="remove" ${c.wrongNumber === "remove" ? "selected" : ""}>REMOVE</option></select></label></div>
        <p class="muted">Calls logged by Trellus come into Apollo with a duration of 0, so the written summary in the call note decides most of these, not the duration.</p></section>
      <div class="actions"><button class="btn primary" data-act="save-settings" ${S.demo ? "disabled" : ""}>Save settings</button>${S.result ? `<button class="btn" data-act="reeval">Re-check the open run with these settings</button>` : ""}</div>`;
  }

  // ---------- events ----------
  let filterTimer = null;
  function setNested(obj, path, val) { const ks = path.split("."); let o = obj; for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]]; o[ks[ks.length - 1]] = val; }
  document.addEventListener("click", async (ev) => {
    const t = ev.target.closest("[data-act]");
    if (!t) return;
    const act = t.dataset.act;
    if (t.tagName === "SELECT" || (t.tagName === "INPUT" && t.type !== "checkbox") || t.tagName === "TEXTAREA") return;
    switch (act) {
      case "view": S.view = t.dataset.v; S.detail = null; break;
      case "toast-x": S.toast = ""; break;
      case "load-seqs": await loadSequences(); return;
      case "start-run": await startRun(); return;
      case "open-run": await openRun(t.dataset.id); return;
      case "resume-run": await openRun(t.dataset.id); if (S.data && S.data.meta.status !== "done") runPipeline(); return;
      case "del-run": {
        const r = S.runs.find((x) => x.id === t.dataset.id);
        if (S.pendingDelete !== t.dataset.id) { S.pendingDelete = t.dataset.id; break; }
        S.pendingDelete = null;
        if (r) { const ch = r.chunks || {}; for (const [pfx, n] of Object.entries(ch)) for (let i = 0; i < n; i++) await S.store.del(`${pfx}__${r.id}__${i}`); await S.store.del(`seq__${r.id}`); await S.store.del(`dec__${r.id}`); await S.store.del(`run__${r.id}`); }
        if (S.data && r && S.data.meta.id === r.id) { S.data = null; S.result = null; }
        await refreshRuns(); break;
      }
      case "stop-run": if (S.collector) S.collector.stop(); break;
      case "bucket": S.filters.bucket = t.dataset.b; S.filters.keep = ""; S.limit = 300; break;
      case "keep-group": S.filters.keep = t.dataset.v; break;
      case "sort": { const k = t.dataset.k; S.filters.dir = S.filters.sort === k && S.filters.dir === "desc" ? "asc" : "desc"; S.filters.sort = k; break; }
      case "clear-filters": Object.assign(S.filters, { q: "", status: "", rule: "", source: "", from: "", to: "", minDays: "", maxDays: "" }); break;
      case "sel": if (S.selected.has(t.dataset.uid)) S.selected.delete(t.dataset.uid); else S.selected.add(t.dataset.uid); break;
      case "sel-page": { const shown = rows().slice(0, S.limit); const all = shown.every((p) => S.selected.has(p.uid)); shown.forEach((p) => (all ? S.selected.delete(p.uid) : S.selected.add(p.uid))); break; }
      case "select-filter": rows().forEach((p) => S.selected.add(p.uid)); break;
      case "select-none": S.selected.clear(); break;
      case "more": S.limit += 300; break;
      case "open": S.detail = t.dataset.uid; break;
      case "close": S.detail = null; break;
      case "choose": { const d = S.decisions[t.dataset.uid] = { ...(S.decisions[t.dataset.uid] || {}), action: t.dataset.v, auto: false }; if (d.action !== "move") d.moveTo = ""; await saveDecisions(); break; }
      case "bulk-apply": {
        const b = S.bulk;
        for (const uid of S.selected) S.decisions[uid] = { ...(S.decisions[uid] || {}), action: b.action, moveTo: b.action === "move" ? b.moveTo : "", note: b.note || (S.decisions[uid] || {}).note || "", finishElsewhere: b.finishElsewhere, auto: false };
        S.toast = `Set “${ACTIONS[b.action]}” for ${S.selected.size} contacts.`;
        S.selected.clear(); await saveDecisions(); break;
      }
      case "export-contacts": exportContacts(); return;
      case "export-touches": exportTouches(); return;
      case "ask-confirm": S.confirm = t.dataset.kind; break;
      case "cancel-confirm": S.confirm = null; break;
      case "do-confirm": { const k = S.confirm; if (k === "reAdd") { const u = [...(S.readd || [])]; S.readd = new Set(); await reAdd(u); } else await execute(k); return; }
      case "readd-pick": { S.readd = S.readd || new Set(); const u = t.dataset.uid; if (S.readd.has(u)) S.readd.delete(u); else S.readd.add(u); break; }
      case "cs": { const prod = t.dataset.prod, id = t.dataset.id; const arr = S.cfg.callSequences[prod] || (S.cfg.callSequences[prod] = []); const i = arr.indexOf(id); if (i >= 0) arr.splice(i, 1); else arr.push(id); break; }
      case "save-settings": try { await S.store.set("settings", { ...S.cfg, budgets: undefined }); S.toast = "Settings saved."; } catch (e) { S.toast = `Couldn't save settings: ${e.message}`; } break;
      case "reeval": if (S.data) { S.data.meta.callSequences = S.cfg.callSequences[S.data.meta.product] || []; for (const [k, v] of Object.entries(S.decisions)) if (v.auto) delete S.decisions[k]; evaluate(); S.view = "review"; S.toast = "Re-checked with the new settings. Your own choices were kept."; } break;
      default: return;
    }
    render();
  });
  document.addEventListener("change", async (ev) => {
    const t = ev.target.closest("[data-act]");
    if (!t) return;
    const act = t.dataset.act;
    if (act === "pick-seq") { S.newRun.seqId = t.value; S.newRun.product = ""; render(); }
    if (act === "pick-product") { S.newRun.product = t.value; render(); }
    if (act === "filter" && t.tagName === "SELECT") { S.filters[t.dataset.k] = t.value; render(); }
    if (act === "filter" && (t.type === "date" || t.type === "number")) { S.filters[t.dataset.k] = t.value; render(); }
    if (act === "bulk-field") { S.bulk[t.dataset.k] = t.type === "checkbox" ? t.checked : t.value; if (t.tagName === "SELECT") render(); }
    if (act === "dfield") { const d = S.decisions[t.dataset.uid] = { ...(S.decisions[t.dataset.uid] || {}), auto: false }; d[t.dataset.k] = t.type === "checkbox" ? t.checked : t.value; await saveDecisions(); if (t.tagName === "SELECT") render(); }
    if (act === "set-list") { setNested(S.cfg, t.dataset.k, t.value.split(",").map((x) => x.trim()).filter(Boolean)); }
    if (act === "set-num") { const n = Number(t.value); if (n >= 1) setNested(S.cfg, t.dataset.k, n); }
    if (act === "set-str") { setNested(S.cfg, t.dataset.k, t.value); }
  });
  document.addEventListener("input", (ev) => {
    const t = ev.target.closest("[data-act='filter']");
    if (!t || t.dataset.k !== "q") return;
    S.filters.q = t.value;
    clearTimeout(filterTimer);
    filterTimer = setTimeout(() => { render(); const el = $("#f-q"); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, 200);
  });
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && (S.detail || S.confirm)) { S.detail = null; S.confirm = null; render(); } });

  boot();
})();
