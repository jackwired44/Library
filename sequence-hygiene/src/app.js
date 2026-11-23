// Sequence Hygiene: page state, run orchestration and rendering.
(function () {
  const R = window.SH_RULES, C = window.SH_COLLECT, D = window.SH_CONFIG.DEFAULTS;
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const safeUrl = (u) => (typeof u === "string" && /^https:\/\//i.test(u) ? u : null);
  const link = (u, text, cls = "") => (safeUrl(u) ? `<a class="${cls}" href="${esc(u)}" target="_blank" rel="noopener">${esc(text)}</a>` : esc(text));
  const fmtDate = (s) => { const t = R.toMs(s); return t ? new Date(t).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—"; };
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const initials = (n) => (n || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0].toUpperCase()).join("");
  const CHUNK = 15;
  const PARALLEL = 4; // people or companies checked at the same time
  const ACTIONS = { remove: "Remove", keep: "Keep", move: "Move to another sequence", followup: "Follow up manually", skip: "Skip for now" };
  const BUCKETS = ["REMOVE", "REVIEW", "KEEP", "CONFLICTS"];
  const BUCKET_INFO = {
    REMOVE: { title: "Remove", help: "Contact made, or a hard block" },
    REVIEW: { title: "Review", help: "No contact, but you should decide" },
    KEEP: { title: "Keep", help: "Safe to sequence" },
    CONFLICTS: { title: "Conflicts", help: "Being worked somewhere else" },
  };
  const PHASES = [
    ["sequences", "Read your Apollo sequences"], ["snapshot", "Read everyone in the sequence"], ["colleagues", "Read your live call sequences"],
    ["people", "Check each person: Apollo calls, email, duplicates, HubSpot"], ["companies", "Check each company: Switchboard, Echo, HubSpot, Outlook"], ["done", "Done"],
  ];
  const CONNECTOR_INFO = {
    "Apollo.io": { short: "Apollo", what: "Contacts, sequences, calls, emails, stages, deals. Also where removals are written." },
    "HubSpot": { short: "HubSpot", what: "Lifecycle stage and deals on the contact and company." },
    "Echo MCP": { short: "Echo", what: "Recorded sales and delivery meetings, matched by company name." },
    "WiredCIO Switchboard": { short: "Switchboard", what: "Deals, proposals and client rooms for the company." },
    "WiredCIO PSA": { short: "PSA", what: "Connected, but it can only list your own projects and tickets, so client accounts aren't checked here yet." },
    "Microsoft 365": { short: "Outlook", what: "Anyone at the company writing to you, and calendar meetings with them." },
  };

  const S = {
    view: "check", demo: false, mcp: null, perms: null, store: null, persistent: false, uid: null,
    servers: {}, permStates: {}, cfg: clone(D), sequences: null, seqLoading: false,
    runs: [], data: null, result: null, decisions: {}, actionLog: [],
    filters: { bucket: "REMOVE", keep: "", q: "", status: "", rule: "", source: "", from: "", to: "", minDays: "", maxDays: "", sort: "lastTouch", dir: "desc" },
    showFilters: false, selected: new Set(), detail: null, progress: null, collector: null, toast: "", confirm: null, limit: 300,
    newRun: { seqId: "", product: "" }, applying: false, saved: "", pendingDelete: null, ruleOpen: new Set(), readd: new Set(),
    bulk: { action: "remove", moveTo: "", note: "", finishElsewhere: false },
  };

  // ---------- storage ----------
  function memoryStore() {
    const m = new Map();
    return { async get(id) { return m.has(id) ? clone(m.get(id)) : null; }, async set(id, v) { m.set(id, clone(v)); }, async del(id) { m.delete(id); },
      async listRuns() { return [...m.values()].filter((v) => v.kind === "run").map(clone); } };
  }
  function dbStore(db, uid) {
    const col = db.collection(`data/users/${uid}`);
    const queue = new Map();
    return {
      // Snapshots from the store are frozen, so every read is copied before anything can change it.
      async get(id) { const s = await col.doc(id).get(); return s.exists ? clone(s.data()) : null; },
      async set(id, v) { const body = clone(v); const prev = queue.get(id) || Promise.resolve(); const p = prev.then(() => col.doc(id).set(body)); queue.set(id, p.catch(() => {})); return p; },
      async del(id) { await col.doc(id).delete(); },
      async listRuns() { const snap = await col.where("kind", "==", "run").get(); return snap.docs.map((d) => clone(d.data())); },
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
    const [mcp, db, user, perms] = claude && claude.use ? await Promise.all(["mcp", "db", "user", "permissions"].map((n) => claude.use(n))) : [null, null, null, null];
    S.mcp = mcp; S.perms = perms;
    if (db && user) {
      try { S.uid = await user.id(); } catch { S.uid = null; }
      if (S.uid) { S.store = dbStore(db, S.uid); S.persistent = true; } else S.store = memoryStore();
    } else S.store = memoryStore();
    if (!mcp) { loadDemo(); return; }
    try { const saved = await S.store.get("settings"); if (saved) S.cfg = mergeCfg(saved); } catch { /* first visit */ }
    await refreshConnectors();
    await refreshRuns();
    render();
    // Ask for every source once, up front, so a run never stops to ask halfway through.
    if (S.perms && C.MANIFEST.some((m) => S.permStates[m.server] === "prompt")) await allowAll();
    loadSequences();
  }
  function mergeCfg(saved) {
    const c = { ...clone(D), ...saved, budgets: clone(D.budgets) };
    c.keywords = { ...clone(D.keywords), ...(saved.keywords || {}) };
    c.callSequences = { ...clone(D.callSequences), ...(saved.callSequences || {}) };
    c.allStages = { ...clone(D.allStages), ...(saved.allStages || {}) };
    return c;
  }
  function loadDemo() {
    S.demo = true;
    const demo = window.SH_DEMO.build();
    S.cfg.callSequences = demo.callSequences;
    S.data = { ...demo, companyFound: {} };
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
        S.servers[m.server] = !s ? "missing" : s.authStatus === "needs_reauth" ? "reauth" : s.tools && s.tools.length ? "listed" : "missing";
      }
    } catch { S.servers = {}; }
    if (S.perms) {
      for (const m of C.MANIFEST) {
        try { S.permStates[m.server] = await S.perms.state(`mcp:${m.server}`); } catch { S.permStates[m.server] = "unavailable"; }
      }
    }
  }
  function connState(server) {
    if (S.demo) return { key: "demo", label: "Example data" };
    const listed = S.servers[server];
    const perm = S.permStates[server];
    if (listed === "missing") return { key: "bad", label: "Not connected", fix: "Add it in claude.ai Settings → Connectors." };
    if (listed === "reauth") return { key: "bad", label: "Reconnect needed", fix: "Reconnect it in claude.ai Settings → Connectors." };
    if (perm === "denied") return { key: "bad", label: "Turned off for this page", fix: "Use Manage permissions to turn it back on." };
    if (perm === "granted") return { key: "ok", label: "Allowed" };
    return { key: "ask", label: "Not allowed yet", fix: "Allow it so checks can use it." };
  }
  async function allowAll() {
    if (!S.perms) { S.toast = "This view can't ask for permissions. Open the page in claude.ai."; render(); return; }
    const names = C.MANIFEST.filter((m) => S.permStates[m.server] !== "granted").map((m) => `mcp:${m.server}`);
    try { await S.perms.request(names.length ? names : undefined); } catch { /* request never rejects on a "no" */ }
    await refreshConnectors(); render();
  }
  async function managePerms() {
    if (!S.perms) return;
    try { await S.perms.manage(); } catch { S.toast = "Open the artifact's Permissions menu in claude.ai to change this."; }
    await refreshConnectors(); render();
  }
  async function refreshRuns() {
    try { S.runs = (await S.store.listRuns()).sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")); } catch { S.runs = []; }
    S.runsLoaded = true;
  }
  async function loadSequences() {
    if (S.seqLoading || S.demo || !S.mcp) return;
    S.seqLoading = true; render();
    const col = new C.Collector({ mcp: S.mcp, store: S.store, cfg: S.cfg });
    try { await col.loadBudget(); S.sequences = await C.listSequences(col); await col.saveBudget(); }
    catch (e) { S.toast = `Couldn't load your Apollo sequences: ${e.message}`; }
    S.seqLoading = false; render();
  }
  function guessProduct(name) {
    if (/dynamics|d365|business central|erp|crm/i.test(name || "")) return "dynamics";
    if (/m365|365|azure|licens|copilot|office/i.test(name || "")) return "m365";
    return "";
  }
  const EMAIL_TYPES = new Set(["auto_email", "manual_email"]);
  const isEmailOnly = (seq) => seq && seq.steps && seq.steps.length > 0 && seq.steps.every((s) => EMAIL_TYPES.has(s.type));
  const seqName = (id) => (S.sequences && S.sequences[id] ? S.sequences[id].name : (S.data && S.data.sequences && S.data.sequences[id] ? S.data.sequences[id].name : id));

  // Settings changes save shortly after, and re-check the open run right away.
  let saveTimer = null;
  function cfgChanged({ reeval = true } = {}) {
    if (reeval && S.result) { for (const [k, v] of Object.entries(S.decisions)) if (v.auto) delete S.decisions[k]; evaluate(); }
    if (S.demo) { render(); return; }
    clearTimeout(saveTimer);
    S.saved = "Saving…";
    saveTimer = setTimeout(async () => {
      try { const c = clone(S.cfg); delete c.budgets; await S.store.set("settings", c); S.saved = "Saved"; }
      catch (e) { S.saved = ""; S.toast = `Couldn't save settings: ${e.message}`; }
      renderSaved();
    }, 500);
    render();
  }

  // ---------- run pipeline ----------
  async function startRun() {
    const seq = S.sequences && S.sequences[S.newRun.seqId];
    if (!seq) return;
    if (S.perms && C.MANIFEST.some((m) => S.permStates[m.server] === "prompt")) await allowAll();
    const product = S.newRun.product || guessProduct(seq.name);
    const id = `${Date.now().toString(36)}`;
    const meta = {
      kind: "run", id, createdAt: new Date().toISOString(), targetId: seq.id, targetName: seq.name,
      product, targetEmailOnly: isEmailOnly(seq), targetEverSent: (seq.delivered || 0) > 0,
      phase: "sequences", cursor: 0, status: "running", notChecked: [], counts: {}, chunks: {},
      callSequences: (S.cfg.callSequences[product] || []).slice(),
    };
    await S.store.set(`run__${id}`, meta);
    S.data = { meta, sequences: S.sequences, people: [], colleagues: [], companyFound: {} };
    S.result = null; S.decisions = {}; S.actionLog = []; S.selected.clear();
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
    S.selected.clear(); S.result = null; S.progress = null;
    if (meta.status === "done") { evaluate(); S.view = "review"; } else S.view = "check";
    scheduleAutoResume();
    render();
  }
  function setProgress(label, done, total) { S.progress = { ...(S.progress || {}), label, done, total }; renderProgress(); }
  function startEta(from) { S.eta = { t0: Date.now(), from }; }
  function etaText(p) {
    if (!S.eta || !p.total || p.done <= S.eta.from) return "";
    const rate = (p.done - S.eta.from) / (Date.now() - S.eta.t0);
    if (!rate) return "";
    const mins = Math.ceil((p.total - p.done) / rate / 60000);
    return mins <= 1 ? "about a minute left" : `about ${mins} minutes left`;
  }
  function logLine(t) {
    S.progress = S.progress || { log: [] };
    S.progress.log = (S.progress.log || []).concat(`${new Date().toLocaleTimeString()}  ${t}`).slice(-80);
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
        const label = `Reading everyone in “${meta.targetName}”`;
        setProgress(label, 0, 1);
        const people = await C.sequenceContacts(col, meta.targetId, (n, t) => setProgress(label, n, t));
        for (const p of people) {
          const st = p.enrollments.find((e) => e.sequenceId === meta.targetId) || {};
          p.targetContactId = p.apolloId; p.targetMailbox = st.mailbox || null; p.targetStatus = st.status || ""; p.addedAt = st.addedAt || null;
        }
        d.people = people;
        meta.counts.people = people.length;
        meta.chunks.p = await saveChunks("p", meta.id, people);
        meta.phase = "colleagues"; await S.store.set(`run__${meta.id}`, meta);
        logLine(`${plural(people.length, "contact")} in the sequence`);
      }
      if (meta.phase === "colleagues") {
        const all = [];
        for (const sid of meta.callSequences || []) {
          const label = `Reading the call sequence “${seqName(sid)}”`;
          setProgress(label, 0, 1);
          const ppl = await C.sequenceContacts(col, sid, (n, t) => setProgress(label, n, t));
          all.push(...ppl.map((p) => ({ ...p, customText: "" })));
        }
        d.colleagues = all;
        meta.chunks.c = await saveChunks("c", meta.id, all);
        meta.phase = "people"; meta.cursor = 0; await S.store.set(`run__${meta.id}`, meta);
        if (!(meta.callSequences || []).length) logLine("No live call sequence picked for this product, so rules 13 and 14 were skipped");
      }
      if (meta.phase === "people") {
        const ppl = d.people;
        const checkPerson = async (p) => {
          p.sourceChecks = p.sourceChecks || {};
          // Apollo and HubSpot for one person run side by side.
          await Promise.all([
            C.apolloPerson(col, p).then(() => { p.sourceChecks.Apollo = { state: "checked" }; }, (e) => { if (e instanceof C.BudgetHit || e instanceof C.Stopped) throw e; if (!markDown(e)) p.sourceChecks.Apollo = { state: "error", reason: e.message }; }),
            C.hubspotPerson(col, p).then(() => { p.sourceChecks["HubSpot contact"] = { state: "checked" }; }, (e) => { if (e instanceof C.BudgetHit || e instanceof C.Stopped) throw e; if (!markDown(e)) p.sourceChecks["HubSpot contact"] = { state: "error", reason: e.message }; }),
          ]);
        };
        startEta(meta.cursor);
        for (let i = meta.cursor; i < ppl.length; i += PARALLEL) {
          setProgress("Checking each person", i, ppl.length);
          const results = await Promise.allSettled(ppl.slice(i, i + PARALLEL).map(checkPerson));
          const failed = results.find((r) => r.status === "rejected");
          if (failed) throw failed.reason;
          const next = Math.min(i + PARALLEL, ppl.length);
          for (let c = Math.floor(i / CHUNK); c <= Math.floor((next - 1) / CHUNK); c++) await saveChunk("p", meta.id, ppl, c);
          meta.cursor = next;
          await S.store.set(`run__${meta.id}`, meta); await col.saveBudget();
        }
        meta.phase = "companies"; meta.cursor = 0; await S.store.set(`run__${meta.id}`, meta);
      }
      if (meta.phase === "companies") {
        const comps = companiesOf(d.people);
        let cal = null;
        try {
          startEta(0);
          setProgress("Reading your Outlook calendar", 0, 1);
          cal = await C.calendarIndex(col, S.cfg, (n, t) => setProgress("Reading your Outlook calendar", n, t));
        } catch (e) { if (e instanceof C.BudgetHit || e instanceof C.Stopped) throw e; if (!markDown(e)) meta.notChecked.push({ source: "Outlook calendar", reason: e.message }); }
        const coItems = await loadChunks("co", meta.id, (meta.chunks && meta.chunks.co) || 0);
        coItems.length = Math.min(coItems.length, meta.cursor);
        const checkCompany = async (c) => {
          let found;
          try { found = await C.companySources(col, c, S.cfg); }
          catch (e) { if (e instanceof C.BudgetHit || e instanceof C.Stopped) throw e; found = { sources: [], personMeetings: {}, personMail: {}, checks: { Companies: { state: "error", reason: e.message } } }; }
          for (const [k, chk] of Object.entries(found.checks || {})) if (chk.state === "error" && /not connected|Reconnect|Add it|turned off|Allow it|blocks/.test(chk.reason || "")) markDown(new C.SourceDown(k, "down", chk.reason));
          if (cal) {
            for (const pp of c.people) {
              for (const ev of cal.byEmail.get(pp.email) || []) (found.personMeetings[pp.uid] = found.personMeetings[pp.uid] || []).push({ title: ev.subject, at: ev.at, link: ev.link, source: "Outlook calendar", type: "Calendar meeting" });
            }
            if (c.domain) for (const ev of cal.byDomain.get(c.domain) || []) {
              const withPerson = ev.attendees.some((a) => c.emails.has(a));
              if (!withPerson) found.sources.push({ companyKey: c.key, domain: c.domain, kind: "contact", reason: `Calendar meeting “${ev.subject}” with someone at ${c.domain}`, source: "Outlook calendar", at: ev.at, link: ev.link });
            }
            found.checks["Outlook calendar"] = { state: "checked" };
          }
          d.companyFound[c.id] = found;
          return { id: c.id, found };
        };
        startEta(meta.cursor);
        for (let i = meta.cursor; i < comps.length; i += PARALLEL) {
          setProgress("Checking each company", i, comps.length);
          const results = await Promise.allSettled(comps.slice(i, i + PARALLEL).map(checkCompany));
          const failed = results.find((r) => r.status === "rejected");
          if (failed) throw failed.reason;
          const next = Math.min(i + PARALLEL, comps.length);
          results.forEach((r, k) => { coItems[i + k] = r.value; });
          for (let c = Math.floor(i / CHUNK); c <= Math.floor((next - 1) / CHUNK); c++) await saveChunk("co", meta.id, coItems, c);
          meta.chunks.co = Math.ceil(next / CHUNK);
          meta.cursor = next;
          await S.store.set(`run__${meta.id}`, meta); await col.saveBudget();
        }
        meta.phase = "done";
      }
      meta.status = "done"; meta.finishedAt = new Date().toISOString();
      await S.store.set(`run__${meta.id}`, meta); await col.saveBudget();
      logLine("Check finished");
      evaluate(); S.view = "review";
    } catch (e) {
      if (e instanceof C.BudgetHit) { meta.status = "paused"; meta.resumeAt = new Date(e.resumeAt).toISOString(); logLine(`Paused at Apollo's limit. Resume after ${new Date(e.resumeAt).toLocaleTimeString()}.`); }
      else if (e instanceof C.Stopped) { meta.status = "paused"; logLine("Stopped. Progress is saved; resume any time."); }
      else { meta.status = "error"; meta.error = e.message || String(e); logLine(`Stopped on an error: ${meta.error}`); }
      try { await S.store.set(`run__${meta.id}`, meta); await col.saveBudget(); } catch { /* keep going */ }
    }
    S.collector = null;
    await refreshConnectors();
    await refreshRuns();
    scheduleAutoResume();
    render();
  }
  // A check paused at Apollo's hourly limit picks itself back up when the limit resets.
  let resumeTimer = null;
  function scheduleAutoResume() {
    clearTimeout(resumeTimer);
    const meta = S.data && S.data.meta;
    if (!meta || meta.status !== "paused" || !meta.resumeAt || S.collector || S.demo) return;
    const wait = Math.max(0, R.toMs(meta.resumeAt) - Date.now()) + 5000;
    resumeTimer = setTimeout(() => { if (!S.collector && S.data && S.data.meta.id === meta.id && S.data.meta.status === "paused") runPipeline(); }, wait);
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
      return { ...p, uid: p.apolloId, meetings: (p.meetings || []).concat(ex.meetings), outlookMail: (p.outlookMail || []).concat(ex.mail), sourceChecks: checks, notChecked: unavailable.map((u) => u.source) };
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
  function defaultAction(p) { return p.bucket === "REMOVE" || p.bucket === "CONFLICTS" ? "remove" : p.bucket === "KEEP" ? "keep" : "skip"; }
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
      step: (p) => (p.totals.furthest ? p.totals.furthest.step : -1), touches: (p) => p.totals.touchpoints, lastTouch: (p) => R.toMs(p.totals.lastTouch) || 0 }[f.sort] || (() => 0);
    return list.slice().sort((a, b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * (f.dir === "asc" ? 1 : -1); });
  }
  const activeFilterCount = () => ["status", "rule", "source", "from", "to", "minDays", "maxDays"].filter((k) => S.filters[k] !== "").length;

  // ---------- CSV ----------
  async function download(filename, text) {
    const dl = window.claude && window.claude.use ? await window.claude.use("downloads") : null;
    if (!dl) { S.toast = "Downloads aren't available in this view. Open the page in claude.ai."; render(); return; }
    try { await dl.save({ filename, data: text }); } catch (e) { if (e && !["cancelled", "declined"].includes(e.code)) { S.toast = `Download failed: ${e.message || e.code}`; render(); } }
  }
  const exportScope = () => { const all = S.result ? S.result.people : []; return S.selected.size ? all.filter((p) => S.selected.has(p.uid)) : all; };
  const slug = (s) => R.lc(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "run";
  function exportContacts() {
    const cols = R.CONTACT_COLS.concat([{ label: "Your choice", get: (p) => ACTIONS[(S.decisions[p.uid] || {}).action] || "" }, { label: "Your note", get: (p) => (S.decisions[p.uid] || {}).note || "" }]);
    download(`sequence-hygiene-${slug(S.data.meta.targetName)}-contacts.csv`, R.toCsv(exportScope(), cols));
  }
  function exportTouches() {
    const out = [];
    for (const p of exportScope()) for (const t of R.touchpoints(p, S.result.ctx)) out.push({ ...t, name: p.name, email: p.email, company: p.company });
    download(`sequence-hygiene-${slug(S.data.meta.targetName)}-touchpoints.csv`, R.toCsv(out, R.TOUCH_COLS));
  }

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
          for (const b of batches(pl.removeHere.filter((x) => x.mode === mode), 50)) {
            try { await C.removeOrStop(col, b.map((x) => x.contactId), meta.targetId, mode, "Sequence Hygiene: contact already made or blocked"); record(b, `removed (${mode})`, true, ""); }
            catch (e) { record(b, `removed (${mode})`, false, e.message); }
          }
        }
        for (const it of pl.removeHere) { const p = S.result.people.find((x) => x.uid === it.uid); const lg = S.actionLog.filter((l) => l.uid === it.uid && l.action.startsWith("removed")).pop(); if (lg && p) lg.mailbox = p.targetMailbox; }
      }
      if (kind === "finishElsewhere") {
        const bySeq = {};
        for (const it of pl.finishElsewhere) (bySeq[it.sequenceId] = bySeq[it.sequenceId] || []).push(it);
        for (const [sid, items] of Object.entries(bySeq)) for (const b of batches(items, 50)) {
          try { await C.removeOrStop(col, b.map((x) => x.contactId), sid, "stop", b[0].reason); record(b, `finished in ${seqName(sid)}`, true, ""); }
          catch (e) { record(b, `finished in ${seqName(sid)}`, false, e.message); }
        }
      }
      if (kind === "moveTo") {
        const removedOk = new Set(S.actionLog.filter((l) => l.ok && l.action.startsWith("removed")).map((l) => l.uid));
        const groups = {};
        for (const it of pl.moveTo) {
          if (!removedOk.has(it.uid)) { record([it], "move", false, "Not moved: remove them from this sequence first (step 1)"); continue; }
          if (!it.mailbox || !it.sequenceId) { record([it], "move", false, "No sending mailbox on record for this contact"); continue; }
          (groups[`${it.sequenceId}|${it.mailbox}`] = groups[`${it.sequenceId}|${it.mailbox}`] || []).push(it);
        }
        for (const [k, items] of Object.entries(groups)) {
          const [sid, mailbox] = k.split("|");
          for (const b of batches(items, 50)) {
            try {
              const res = await C.addToSequence(col, b.map((x) => x.contactId), sid, mailbox, "active");
              const skipped = new Set(((res.payload || {}).skipped_contact_ids) || []);
              for (const it of b) record([it], `moved to ${seqName(sid)}`, !skipped.has(it.contactId), skipped.has(it.contactId) ? "Apollo skipped this contact (opt-out or enrollment rule)" : "");
            } catch (e) { record(b, `moved to ${seqName(sid)}`, false, e.message); }
          }
        }
      }
    } finally { S.applying = false; await saveDecisions(); render(); }
  }
  async function reAdd(uids) {
    const meta = S.data.meta;
    const col = new C.Collector({ mcp: S.mcp, store: S.store, cfg: S.cfg });
    const statuses = S.result.people.map((p) => p.targetStatus).filter(Boolean);
    const status = statuses.filter((s) => s === "active").length >= statuses.length / 2 ? "active" : "paused";
    const logs = S.actionLog.filter((l) => l.ok && l.action.startsWith("removed") && uids.includes(l.uid));
    const groups = {};
    for (const l of logs) (groups[l.mailbox || ""] = groups[l.mailbox || ""] || []).push(l);
    S.applying = true; S.confirm = null; render();
    const push = (l, ok, msg) => S.actionLog.push({ at: new Date().toISOString(), uid: l.uid, name: l.name, contactId: l.contactId, action: "re-added", ok, msg });
    for (const [mailbox, items] of Object.entries(groups)) {
      if (!mailbox) { items.forEach((l) => push(l, false, "No original mailbox on record")); continue; }
      try { await C.addToSequence(col, items.map((l) => l.contactId), meta.targetId, mailbox, status); items.forEach((l) => push(l, true, `Back in at step 1 (${status})`)); }
      catch (e) { items.forEach((l) => push(l, false, e.message)); }
    }
    S.applying = false; await saveDecisions(); render();
  }

  // ---------- icons ----------
  const ICONS = {
    check: '<path d="M4 12.5l5 5L20 6.5"/>', search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
    play: '<path d="M7 5l12 7-12 7z"/>', review: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 9h8M8 13h8M8 17h5"/>',
    send: '<path d="M4 12l16-8-6 16-2.5-6.5z"/>', rules: '<path d="M6 4h9l3 3v13H6z"/><path d="M9 10h6M9 14h6M9 18h4"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>',
    filter: '<path d="M4 6h16M7 12h10M10 18h4"/>', download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>',
    alert: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17.5v.5"/>', plug: '<path d="M9 3v5M15 3v5M7 8h10v4a5 5 0 01-10 0zM12 17v4"/>',
    minus: '<path d="M5 12h14"/>',
  };
  const icon = (k, cls = "") => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[k] || ""}</svg>`;

  // ---------- rendering ----------
  function render() {
    const el = $("#app");
    if (!el) return;
    const tw = el.querySelector(".table-wrap"), scroll = tw ? tw.scrollTop : 0;
    const db = el.querySelector(".drawer-body"), dscroll = db ? db.scrollTop : 0;
    el.innerHTML = `<div class="shell">${sidebar()}<div class="main">${pagebar()}<div class="content">${S.demo ? demoBanner() : ""}${S.toast ? `<div class="toast" role="status">${icon("check")}<span>${esc(S.toast)}</span><button class="icon-btn" data-act="toast-x" aria-label="Dismiss">${icon("x")}</button></div>` : ""}${
      S.view === "check" ? viewCheck() : S.view === "review" ? viewReview() : S.view === "apply" ? viewApply() : S.view === "rules" ? viewRules() : viewSettings()}</div></div></div>${S.detail ? drawer() : ""}${S.confirm ? confirmBox() : ""}`;
    const tw2 = el.querySelector(".table-wrap"); if (tw2) tw2.scrollTop = scroll;
    const db2 = el.querySelector(".drawer-body"); if (db2) db2.scrollTop = dscroll;
  }
  function renderProgress() { const el = $("#progress"); if (el) el.outerHTML = progressCard(); }
  function renderSaved() { const el = $("#saved"); if (el) el.textContent = S.saved; }

  function sidebar() {
    const counts = S.result ? Object.fromEntries(BUCKETS.map((b) => [b, S.result.people.filter((p) => p.bucket === b).length])) : null;
    const pl = S.result ? plan() : null;
    const toWrite = pl ? pl.removeHere.length + pl.finishElsewhere.length + pl.moveTo.length : 0;
    const items = [
      ["check", "play", "Run a check", S.collector ? `<span class="badge live">running</span>` : ""],
      ["review", "review", "Review", counts ? `<span class="badge">${counts.REMOVE + counts.REVIEW + counts.CONFLICTS}</span>` : "", !S.result],
      ["apply", "send", "Apply", toWrite ? `<span class="badge">${toWrite}</span>` : "", !S.result],
      ["rules", "rules", "Rules", `<span class="badge quiet">${R.RULES.length - (S.cfg.disabledRules || []).length} on</span>`],
      ["settings", "gear", "Settings", ""],
    ];
    const meta = S.data && S.data.meta;
    const conns = C.MANIFEST.map((m) => { const st = connState(m.server); return `<li><span class="dot d-${st.key}"></span>${esc(CONNECTOR_INFO[m.server].short)}<span class="conn-st">${esc(st.label)}</span></li>`; }).join("")
      + `<li><span class="dot d-via"></span>Trellus<span class="conn-st">Via Apollo notes</span></li>`;
    const needAllow = !S.demo && C.MANIFEST.some((m) => connState(m.server).key === "ask");
    return `<aside class="side"><div class="brand"><span class="mark" aria-hidden="true">${icon("check")}</span><div><div class="title">Sequence Hygiene</div><div class="by">Wired CIO</div></div></div>
      <nav class="nav" aria-label="Main">${items.map(([v, ic, label, badge, off]) => `<button class="nav-item ${S.view === v ? "on" : ""}" data-act="view" data-v="${v}" ${off ? "disabled" : ""}>${icon(ic)}<span>${label}</span>${badge}</button>`).join("")}</nav>
      ${meta ? `<div class="side-run"><div class="eyebrow">Open check</div><div class="run-name">${esc(meta.targetName)}</div><div class="run-meta">${esc(runStatusText(meta))}</div></div>` : ""}
      <div class="side-conn"><div class="eyebrow">Sources</div><ul>${conns}</ul>${needAllow ? `<button class="btn sm block" data-act="allow-all">${icon("plug")}Allow all sources</button>` : ""}</div></aside>`;
  }
  const isLive = (r) => S.collector && S.data && S.data.meta.id === r.id;
  function runStatusText(r) {
    if (r.status === "running" && !isLive(r)) return "Interrupted before it finished. Resume to pick up where it stopped.";
    if (r.status === "done") return `${plural(r.counts && r.counts.people != null ? r.counts.people : 0, "contact")} · checked ${fmtDate(r.finishedAt || r.createdAt)}`;
    if (r.status === "paused") return r.resumeAt && R.toMs(r.resumeAt) > Date.now()
      ? `Paused at Apollo's hourly limit. Resumes on its own at ${new Date(r.resumeAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} while this page is open.`
      : "Paused. Resume to pick up where it stopped.";
    if (r.status === "error") return "Stopped on an error";
    return "Running";
  }
  function pagebar() {
    const titles = {
      check: ["Run a check", "Pick an Apollo sequence. Every contact, and their company, is checked against every rule."],
      review: ["Review", S.data ? `${S.data.meta.targetName} · decide Remove or Keep for each person` : ""],
      apply: ["Apply", "Nothing has been written to Apollo yet. Each step asks you to confirm, with every contact listed."],
      rules: ["Rules", "What gets someone removed, flagged or kept. Changes apply to the open check right away."],
      settings: ["Settings", "Sources and live call sequences."],
    };
    const [t, sub] = titles[S.view];
    let right = "";
    if (S.view === "review" && S.result) {
      const pl = plan();
      right = `<button class="btn" data-act="export-contacts">${icon("download")}Contacts CSV${S.selected.size ? ` (${S.selected.size})` : ""}</button><button class="btn" data-act="export-touches">${icon("download")}Touchpoints CSV${S.selected.size ? ` (${S.selected.size})` : ""}</button><button class="btn primary" data-act="view" data-v="apply">${icon("send")}Review and apply${pl.removeHere.length ? ` (${pl.removeHere.length})` : ""}</button>`;
    }
    if (S.view === "rules" || S.view === "settings") right = `<span class="saved" id="saved" aria-live="polite">${esc(S.saved)}</span>`;
    return `<header class="pagebar"><div class="pb-text"><h1>${esc(t)}</h1>${sub ? `<p>${esc(sub)}</p>` : ""}</div><div class="pb-actions">${right}</div></header>`;
  }
  const demoBanner = () => `<div class="banner">${icon("alert")}<div><strong>Example data.</strong> Every person and company here is made up. Open this page in claude.ai to check a real Apollo sequence through your own connectors. Nothing here writes anywhere.</div></div>`;

  // ----- Run a check -----
  function viewCheck() {
    const seqs = S.sequences ? Object.values(S.sequences).filter((s) => !s.archived).sort((a, b) => a.name.localeCompare(b.name)) : [];
    const pick = S.sequences && S.sequences[S.newRun.seqId];
    const product = S.newRun.product || (pick ? guessProduct(pick.name) : "");
    const callSeqs = (S.cfg.callSequences[product] || []).map(seqName);
    const running = S.collector != null;
    const conns = C.MANIFEST.map((m) => connState(m.server));
    const notReady = conns.filter((c) => c.key !== "ok").length;
    const unfinished = pick ? S.runs.find((r) => r.targetId === pick.id && r.status !== "done" && !r.demo) : null;
    const checklist = pick ? [
      [true, "Sequence", `${pick.numSteps} steps · ${isEmailOnly(pick) ? "email only" : "mixed channels"} · ${pick.delivered ? "has sent, so removals stop people and keep their history" : "never sent, so removals take people out cleanly"}`, ""],
      [callSeqs.length > 0, "Live call sequence", callSeqs.length ? callSeqs.join(", ") : "None picked for this product, so rules 13 and 14 are skipped.", callSeqs.length ? "" : `<button class="link" data-act="view" data-v="settings">Pick in Settings</button>`],
      [notReady === 0, "Sources", notReady === 0 ? "All allowed" : `${plural(notReady, "source")} not allowed yet`, notReady === 0 ? "" : `<button class="link" data-act="allow-all">Allow all</button>`],
    ] : [];
    return `<div class="grid-2">
      <section class="card hero-card">
        ${S.demo ? `<p class="muted">Not available with example data.</p>` : `
        <label class="lbl" for="seq-pick">Which sequence?</label>
        ${S.sequences ? `<select id="seq-pick" class="input xl" data-act="pick-seq"><option value="">Choose an Apollo sequence…</option>${seqs.map((s) => `<option value="${esc(s.id)}" ${s.id === S.newRun.seqId ? "selected" : ""}>${esc(s.name)}${s.active ? "" : " (inactive)"}</option>`).join("")}</select>`
          : `<div class="input xl ghosted">${S.seqLoading ? "Loading your sequences…" : `<button class="link" data-act="load-seqs">Load my sequences</button>`}</div>`}
        ${pick ? `<div class="row-gap mt"><span class="lbl inline-lbl">Product</span><div class="seg" role="radiogroup" aria-label="Product">${[["dynamics", "Dynamics 365"], ["m365", "M365 / Azure"]].map(([v, l]) => `<button class="seg-btn ${product === v ? "on" : ""}" data-act="pick-product" data-v="${v}" role="radio" aria-checked="${product === v}">${l}</button>`).join("")}</div></div>
          <ul class="checklist">${checklist.map(([ok, k, v, act]) => `<li class="${ok ? "ok" : "warn"}">${icon(ok ? "check" : "alert")}<div><strong>${k}</strong><span>${esc(v)}</span>${act}</div></li>`).join("")}</ul>
          <p class="note">Each person takes about three Apollo calls, and Apollo allows about 400 an hour. A big sequence pauses at that limit and picks up where it stopped.</p>` : ""}
        ${unfinished ? `<div class="resume-box">${icon("play")}<div><strong>This sequence has a check in progress.</strong><span>${esc(phaseLabel(unfinished))}. Resuming keeps everything already checked, so it's much faster than starting over.</span></div></div>` : ""}
        <div class="card-foot">${unfinished ? `<button class="btn ghost" data-act="start-run" ${running || !product ? "disabled" : ""}>Start over</button><button class="btn primary lg" data-act="resume-run" data-id="${esc(unfinished.id)}" ${running ? "disabled" : ""}>${icon("play")}Resume check</button>`
          : `<button class="btn primary lg" data-act="start-run" ${!pick || running || !product ? "disabled" : ""}>${icon("play")}Start check</button>`}</div>`}
      </section>
      <div class="stack">${S.progress || (S.data && S.data.meta.status !== "done" && !S.demo) ? progressCard() : ""}${pastRuns()}</div></div>`;
  }
  function phaseLabel(r) {
    const n = r.counts && r.counts.people;
    if (r.phase === "people") return `${r.cursor || 0} of ${n || "?"} people checked`;
    if (r.phase === "companies") return `All ${n || ""} people checked; companies ${r.cursor ? `${r.cursor} done` : "next"}`;
    return "Just started";
  }
  function progressCard() {
    const meta = S.data && S.data.meta;
    if (!meta) return `<div id="progress"></div>`;
    const p = S.progress || {};
    const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
    const idx = PHASES.findIndex(([k]) => k === meta.phase);
    const running = !!S.collector;
    return `<section class="card" id="progress" aria-live="polite"><div class="card-head"><div><h2>${esc(meta.targetName)}</h2><p class="muted">${esc(runStatusText(meta))}</p></div>
      ${running ? `<button class="btn" data-act="stop-run">Stop</button>` : meta.status !== "done" ? `<button class="btn primary" data-act="resume-run" data-id="${esc(meta.id)}">${icon("play")}Resume</button>` : ""}</div>
      ${meta.status === "error" ? `<div class="alert">${icon("alert")}<div><strong>Stopped on an error</strong><span>${esc(meta.error)}</span><span class="muted">Resume picks up where it stopped.</span></div></div>` : ""}
      <ol class="phases">${PHASES.slice(0, -1).map(([k, label], i) => {
        const state = meta.status === "done" || i < idx ? "done" : i === idx ? (running ? "now" : "paused") : "todo";
        return `<li class="ph-${state}"><span class="ph-dot">${state === "done" ? icon("check") : ""}</span><div><span>${esc(label)}</span>${state === "now" ? `<div class="bar"><span style="width:${pct}%"></span></div><small>${esc(p.label || "")} · ${p.done || 0} of ${p.total || 0}${etaText(p) ? ` · ${etaText(p)}` : ""}</small>` : ""}</div></li>`;
      }).join("")}</ol>
      ${(p.log || []).length ? `<details class="log-wrap"><summary>Activity log</summary><pre class="log">${esc(p.log.join("\n"))}</pre></details>` : ""}</section>`;
  }
  function pastRuns() {
    const running = S.collector != null;
    return `<section class="card"><div class="card-head"><h2>Past checks</h2></div>
      ${!S.runsLoaded && !S.demo ? `<p class="muted">Loading your saved checks…</p>` : S.runs.length ? `<ul class="runs">${S.runs.map((r) => `<li><div class="run-main"><span class="run-dot rs-${esc(r.status === "running" && !isLive(r) ? "paused" : r.status)}"></span><div><div class="run-title">${esc(r.targetName)}</div><div class="muted small">${fmtDate(r.createdAt)} · ${esc(runStatusText(r))}</div>${r.status === "error" ? `<div class="err small">${esc(r.error)}</div>` : ""}</div></div>
        <div class="run-actions">${r.status === "done" ? `<button class="btn sm" data-act="open-run" data-id="${esc(r.id)}">Open</button>` : r.demo ? "" : `<button class="btn sm" data-act="resume-run" data-id="${esc(r.id)}" ${running ? "disabled" : ""}>Resume</button>`}${r.demo ? "" : `<button class="btn sm ${S.pendingDelete === r.id ? "danger" : "ghost"}" data-act="del-run" data-id="${esc(r.id)}">${S.pendingDelete === r.id ? "Confirm delete" : "Delete"}</button>`}</div></li>`).join("")}</ul>`
        : `<div class="empty-state">${icon("review")}<p>No checks yet. Each one is saved here so you can come back to it.</p></div>`}
      ${!S.persistent && !S.demo ? `<p class="warn small">Checks aren't being saved in this view. They'll be lost when the page closes.</p>` : ""}</section>`;
  }

  // ----- Review -----
  function viewReview() {
    if (!S.result) return `<div class="empty-state">${icon("review")}<p>Run a check first.</p></div>`;
    const all = S.result.people;
    const counts = Object.fromEntries(BUCKETS.map((b) => [b, all.filter((p) => p.bucket === b).length]));
    const list = rows(), f = S.filters, shown = list.slice(0, S.limit);
    const allSel = shown.length > 0 && shown.every((p) => S.selected.has(p.uid));
    const sources = [...new Set(all.flatMap((p) => p.findings.map((x) => x.source)))].sort();
    const rulesUsed = [...new Set(all.flatMap((p) => p.findings.map((x) => x.rule)))].sort((a, b) => a - b);
    const nf = activeFilterCount();
    return `${S.result.unavailable.length ? `<details class="notice">${icon("alert")}<summary>${plural(S.result.unavailable.length, "source")} not checked on this run</summary><ul>${S.result.unavailable.map((u) => `<li><strong>${esc(u.source)}</strong> ${esc(u.reason)}</li>`).join("")}</ul></details>` : ""}
      <div class="buckets" role="tablist" aria-label="Buckets">${BUCKETS.map((b) => `<button role="tab" class="bucket b-${b} ${f.bucket === b ? "on" : ""}" data-act="bucket" data-b="${b}" aria-selected="${f.bucket === b}"><span class="b-count">${counts[b]}</span><span class="b-name">${BUCKET_INFO[b].title}</span><span class="b-help">${BUCKET_INFO[b].help}</span></button>`).join("")}</div>
      <div class="toolbar">
        <label class="search">${icon("search")}<input id="f-q" data-act="filter" data-k="q" value="${esc(f.q)}" placeholder="Search name, company, email or title" aria-label="Search"></label>
        ${f.bucket === "KEEP" ? `<div class="seg">${[["", "All"], ["Never touched", "Never touched"], ["Touched, no contact", "Touched, no contact"]].map(([v, l]) => `<button class="seg-btn ${f.keep === v ? "on" : ""}" data-act="keep-group" data-v="${esc(v)}">${l}</button>`).join("")}</div>` : ""}
        <button class="btn ${S.showFilters || nf ? "active" : ""}" data-act="toggle-filters" aria-expanded="${S.showFilters}">${icon("filter")}Filters${nf ? ` <span class="badge">${nf}</span>` : ""}</button>
      </div>
      ${S.showFilters ? `<div class="filters">
        <label class="field"><span>Status</span><select id="f-status" class="input" data-act="filter" data-k="status"><option value="">Any</option>${Object.entries(R.STATUS_LABEL).map(([k, l]) => `<option value="${k}" ${f.status === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        <label class="field"><span>Reason</span><select id="f-rule" class="input" data-act="filter" data-k="rule"><option value="">Any</option>${rulesUsed.map((r) => `<option value="${r}" ${f.rule === String(r) ? "selected" : ""}>${r}. ${esc(R.RULE_LABEL[r])}</option>`).join("")}</select></label>
        <label class="field"><span>Source</span><select id="f-source" class="input" data-act="filter" data-k="source"><option value="">Any</option>${sources.map((s) => `<option ${f.source === s ? "selected" : ""}>${esc(s)}</option>`).join("")}</select></label>
        <label class="field"><span>Last touch from</span><input class="input" type="date" id="f-from" data-act="filter" data-k="from" value="${esc(f.from)}"></label>
        <label class="field"><span>Last touch to</span><input class="input" type="date" id="f-to" data-act="filter" data-k="to" value="${esc(f.to)}"></label>
        <label class="field narrow"><span>Days since, at least</span><input class="input" type="number" min="0" id="f-min" data-act="filter" data-k="minDays" value="${esc(f.minDays)}"></label>
        <label class="field narrow"><span>Days since, at most</span><input class="input" type="number" min="0" id="f-max" data-act="filter" data-k="maxDays" value="${esc(f.maxDays)}"></label>
        <button class="link" data-act="clear-filters">Clear filters</button></div>` : ""}
      <div class="listbar"><span class="muted">${list.length} ${list.length === 1 ? "person" : "people"}${S.selected.size ? ` · <strong>${S.selected.size} selected</strong>` : ""}</span>
        ${list.length && S.selected.size < list.length ? `<button class="link" data-act="select-filter">Select all ${list.length}</button>` : ""}${S.selected.size ? `<button class="link" data-act="select-none">Clear selection</button>` : ""}</div>
      ${S.selected.size ? decisionBar() : ""}
      <div class="table-wrap"><table class="grid"><thead><tr>
        <th class="cb"><input type="checkbox" id="sel-page" aria-label="Select all shown" data-act="sel-page" ${allSel ? "checked" : ""}></th>
        ${th("name", "Person")}${th("status", "Status")}<th>Why</th>${th("touches", "Touches", "num")}${th("lastTouch", "Last touch", "num")}<th>Decision</th></tr></thead>
        <tbody>${shown.map(rowHtml).join("") || `<tr><td colspan="7" class="empty">Nobody here with these filters.</td></tr>`}</tbody></table></div>
      ${list.length > S.limit ? `<div class="more"><button class="btn" data-act="more">Show ${Math.min(300, list.length - S.limit)} more</button></div>` : ""}`;
  }
  function th(k, label, cls = "") {
    const on = S.filters.sort === k;
    return `<th class="${cls}" aria-sort="${on ? (S.filters.dir === "asc" ? "ascending" : "descending") : "none"}"><button class="sort ${on ? "on" : ""}" data-act="sort" data-k="${k}">${label}${on ? (S.filters.dir === "asc" ? " ↑" : " ↓") : ""}</button></th>`;
  }
  function rowHtml(p) {
    const d = S.decisions[p.uid] || {};
    const more = p.findings.length - 1;
    const why = p.primaryReason || (p.bucket === "KEEP" ? (p.status === "never" ? "No calls, emails or meetings anywhere" : "Only one-way touches") : "");
    const f0 = p.findings.find((x) => x.reason === p.primaryReason);
    const other = d.action && d.action !== "remove" && d.action !== "keep";
    return `<tr class="${S.selected.has(p.uid) ? "sel" : ""}">
      <td class="cb"><input type="checkbox" data-act="sel" data-uid="${esc(p.uid)}" aria-label="Select ${esc(p.name)}" ${S.selected.has(p.uid) ? "checked" : ""}></td>
      <td><div class="who"><span class="avatar">${esc(initials(p.name || p.email))}</span><div><button class="person" data-act="open" data-uid="${esc(p.uid)}">${esc(p.name || p.email)}</button><div class="sub">${esc(p.title)}${p.title && p.company ? " · " : ""}${esc(p.company)}</div>${p.companyPick ? `<span class="tag ok">Best at company</span>` : ""}</div></div></td>
      <td><span class="status s-${p.status}">${esc(R.STATUS_LABEL[p.status])}</span></td>
      <td class="why">${f0 ? `<span class="rule-chip" title="${esc(R.RULE_LABEL[f0.rule])}">${f0.rule}</span>` : ""}${esc(why)}${more > 0 ? ` <button class="link small" data-act="open" data-uid="${esc(p.uid)}">+${more} more</button>` : ""}</td>
      <td class="num">${p.totals.touchpoints}<div class="sub">${p.totals.sequences ? plural(p.totals.sequences, "seq") : ""}${p.totals.furthestLabel ? ` · ${esc(p.totals.furthestLabel)}` : ""}</div></td>
      <td class="num">${p.totals.lastTouch ? `${fmtDate(p.totals.lastTouch)}<div class="sub">${p.totals.daysSince}d ago</div>` : "—"}</td>
      <td><div class="quick" role="group" aria-label="Decision for ${esc(p.name)}">
        <button class="q q-remove ${d.action === "remove" ? "on" : ""}" data-act="quick" data-uid="${esc(p.uid)}" data-v="remove" aria-pressed="${d.action === "remove"}">Remove</button>
        <button class="q q-keep ${d.action === "keep" ? "on" : ""}" data-act="quick" data-uid="${esc(p.uid)}" data-v="keep" aria-pressed="${d.action === "keep"}">Keep</button></div>
        ${other ? `<div class="sub">${esc(ACTIONS[d.action])}</div>` : d.auto ? `<div class="sub">suggested</div>` : ""}</td></tr>`;
  }
  function moveOptions(sel) {
    const seqs = S.data && S.data.sequences ? Object.values(S.data.sequences).filter((s) => !s.archived && s.id !== S.data.meta.targetId).sort((a, b) => a.name.localeCompare(b.name)) : [];
    return `<option value="">Pick a sequence…</option>${seqs.map((s) => `<option value="${esc(s.id)}" ${sel === s.id ? "selected" : ""}>${esc(s.name)}</option>`).join("")}`;
  }
  function decisionBar() {
    const b = S.bulk;
    return `<div class="decide" role="group" aria-label="Choose an outcome for the selection"><strong>${S.selected.size} selected</strong>
      <select id="bulk-action" class="input" data-act="bulk-field" data-k="action">${Object.entries(ACTIONS).map(([k, l]) => `<option value="${k}" ${b.action === k ? "selected" : ""}>${l}</option>`).join("")}</select>
      ${b.action === "move" ? `<select id="bulk-move" class="input" data-act="bulk-field" data-k="moveTo">${moveOptions(b.moveTo)}</select>` : ""}
      <input id="bulk-note" class="input grow" data-act="bulk-field" data-k="note" value="${esc(b.note)}" placeholder="Note (optional)">
      <label class="inline"><input type="checkbox" id="bulk-finish" data-act="bulk-field" data-k="finishElsewhere" ${b.finishElsewhere ? "checked" : ""}> Also finish them in other active sequences</label>
      <button class="btn primary" data-act="bulk-apply" ${b.action === "move" && !b.moveTo ? "disabled" : ""}>Set for ${S.selected.size}</button></div>`;
  }

  function drawer() {
    const p = S.result && S.result.people.find((x) => x.uid === S.detail);
    if (!p) return "";
    const d = S.decisions[p.uid] || {}, t = p.totals;
    const tps = R.touchpoints(p, S.result.ctx);
    const calls = p.callResults || [];
    const hasConflict = p.findings.some((f) => f.rule === 12);
    return `<div class="scrim" data-act="close"></div><aside class="drawer" role="dialog" aria-modal="true" aria-label="${esc(p.name)}">
      <div class="drawer-head"><span class="avatar lg">${esc(initials(p.name || p.email))}</span><div class="dh-text"><h2>${esc(p.name || p.email)}</h2><div class="sub">${esc(p.title)}${p.title ? " · " : ""}${esc(p.company)}</div>
        <div class="dh-links"><span class="mono">${esc(p.email)}</span>${link(p.link, "Open in Apollo", "chip-link")}${(p.duplicateRecords || []).map((r, i) => link(r.link, `Duplicate record ${i + 1}`, "chip-link")).join("")}</div></div>
        <button class="icon-btn" data-act="close" aria-label="Close">${icon("x")}</button></div>
      <div class="drawer-body">
        <div class="tags"><span class="bucket-tag b-${p.bucket}">${BUCKET_INFO[p.bucket].title}</span><span class="status s-${p.status}">${esc(R.STATUS_LABEL[p.status])}</span>${p.keepGroup ? `<span class="tag">${esc(p.keepGroup)}</span>` : ""}</div>
        <section class="panel-s"><h3>Your decision</h3><div class="seg wrap">${Object.entries(ACTIONS).map(([k, l]) => `<button class="seg-btn ${d.action === k ? "on" : ""}" data-act="choose" data-uid="${esc(p.uid)}" data-v="${k}">${l}</button>`).join("")}</div>
          ${d.action === "move" ? `<label class="field"><span>Move to</span><select id="d-move" class="input" data-act="dfield" data-uid="${esc(p.uid)}" data-k="moveTo">${moveOptions(d.moveTo)}</select></label>` : ""}
          ${hasConflict ? `<label class="inline"><input type="checkbox" id="d-finish" data-act="dfield" data-uid="${esc(p.uid)}" data-k="finishElsewhere" ${d.finishElsewhere ? "checked" : ""}> Also finish them in their other active sequences</label>` : ""}
          <label class="field"><span>Note</span><textarea id="d-note" class="input" rows="2" data-act="dfield" data-uid="${esc(p.uid)}" data-k="note">${esc(d.note || "")}</textarea></label></section>
        <section class="panel-s"><h3>Why</h3>${p.findings.length ? `<ul class="findings">${p.findings.map((f) => `<li class="f-${f.effect}"><div class="f-top"><span class="rule-chip">${f.rule}</span><strong>${esc(R.RULE_LABEL[f.rule])}</strong><span class="eff e-${f.effect}">${f.effect === "remove" ? "Remove" : f.effect === "conflict" ? "Conflict" : "Review"}</span></div><p>${esc(f.reason)}</p><div class="sub">${esc(f.source)}${f.at ? ` · ${fmtDate(f.at)}` : ""}${f.basis ? ` · matched on ${esc(f.basis)}` : ""}${safeUrl(f.link) ? ` · ${link(f.link, "Open record")}` : ""}</div></li>`).join("")}</ul>` : `<p class="muted">Nothing found in any checked source.</p>`}
          ${(p.notChecked || []).length ? `<p class="sub">Not checked: ${esc(p.notChecked.join(", "))}</p>` : ""}</section>
        <section class="panel-s"><h3>Totals</h3><div class="stats">
          ${stat("Sequences", t.sequences)}${stat("Furthest step", t.furthestLabel || "—", t.furthest && t.furthest.sequenceName)}${stat("Calls", t.calls, `${t.callsConnected} connected`)}${stat("Emails sent", t.emailsSent, `${t.emailsOpened} opened · ${t.emailsReplied} replied`)}
          ${stat("LinkedIn steps", t.linkedin)}${stat("Meetings", t.meetings)}${stat("All touches", t.touchpoints)}${stat("Last touch", t.lastTouch ? fmtDate(t.lastTouch) : "—", t.daysSince != null ? `${t.daysSince} days ago · first ${fmtDate(t.firstTouch)}` : "")}</div></section>
        <section class="panel-s"><h3>Touchpoint history</h3>${tps.length ? `<ol class="timeline">${tps.map((x) => `<li class="tl-${esc(R.lc(x.kind))}"><span class="tl-dot"></span><div><div class="tl-top"><strong>${esc(x.type)}</strong><span class="muted small">${x.at ? fmtDate(x.at) : ""}</span></div><div>${safeUrl(x.link) ? link(x.link, x.result) : esc(x.result)}</div><div class="sub">${esc([x.sequence, x.step].filter(Boolean).join(" · "))}${x.subject ? ` · “${esc(x.subject)}”` : ""}</div></div></li>`).join("")}</ol>` : `<p class="muted">No touchpoints anywhere.</p>`}</section>
        ${calls.length ? `<section class="panel-s"><h3>Calls</h3><ul class="calls">${calls.map(({ call, cls }) => `<li><div class="tl-top"><strong>${esc((S.cfg.outcomeLabels || {})[call.outcomeId] || "No disposition")}</strong><span class="muted small">${fmtDate(call.at)} · ${esc(R.fmtDur(call.durationSec))} · ${esc(call.caller)}</span>${cls.connected ? `<span class="tag warn">Connected</span>` : ""}</div>${call.summary ? `<p>${esc(call.summary)}</p>` : `<p class="muted">No note</p>`}${call.trellusUrl ? link(call.trellusUrl, "Trellus recording and transcript", "chip-link") : ""}</li>`).join("")}</ul></section>` : ""}
      </div></aside>`;
  }
  const stat = (k, v, sub) => `<div class="stat"><span class="stat-k">${esc(k)}</span><span class="stat-v">${esc(v)}</span>${sub ? `<span class="stat-s">${esc(sub)}</span>` : ""}</div>`;

  // ----- Apply -----
  function viewApply() {
    if (!S.result) return "";
    const pl = plan(), meta = S.data.meta;
    const moveBySeq = {};
    for (const m of pl.moveTo) (moveBySeq[m.sequenceId] = moveBySeq[m.sequenceId] || []).push(m);
    const removedOk = S.actionLog.filter((l) => l.ok && l.action.startsWith("removed"));
    const reAdded = new Set(S.actionLog.filter((l) => l.ok && l.action === "re-added").map((l) => l.uid));
    const canReAdd = removedOk.filter((l) => !reAdded.has(l.uid));
    const names = (items) => `<details class="names-wrap"><summary>Show ${plural(items.length, "contact")}</summary><ul class="names">${items.map((x) => `<li><span class="avatar sm">${esc(initials(x.name))}</span><div>${esc(x.name)}<div class="sub">${esc(x.company)} · ${esc(x.email)}${x.note ? ` · “${esc(x.note)}”` : ""}</div></div></li>`).join("")}</ul></details>`;
    const block = (n, kind, title, desc, items, btn) => `<section class="card apply-step"><div class="apply-n">${n}</div><div class="apply-body"><div class="card-head"><div><h2>${title}</h2><p class="muted">${desc}</p></div><span class="big-num">${items.length}</span></div>
      ${items.length ? names(items) : ""}${btn && items.length ? `<div class="card-foot"><button class="btn primary" data-act="ask-confirm" data-kind="${kind}" ${S.applying ? "disabled" : ""}>${btn}</button></div>` : ""}</div></section>`;
    return `<div class="metrics">${metric("Remove here", pl.removeHere.length)}${metric("Finish elsewhere", pl.finishElsewhere.length)}${metric("Move", pl.moveTo.length)}${metric("Follow up", pl.tagged.length)}${metric("Keep", pl.kept.length)}${metric("Skip", pl.skipped.length)}</div>
      ${block(1, "removeHere", `Remove from “${esc(meta.targetName)}”`, meta.targetEverSent ? "This sequence has sent, so Apollo will stop them with a reason. Their history stays." : "This sequence has never sent, so Apollo removes them outright.", pl.removeHere, `Remove ${pl.removeHere.length}…`)}
      ${block(2, "finishElsewhere", "Finish them in other sequences", "Stops each person in the other sequences they're active or paused in.", pl.finishElsewhere, `Finish ${pl.finishElsewhere.length}…`)}
      ${block(3, "moveTo", "Move to another sequence", `Adds them after step 1 removes them here. Apollo always starts added contacts at step 1.${Object.keys(moveBySeq).length ? ` ${Object.entries(moveBySeq).map(([sid, it]) => `${esc(seqName(sid))}: ${it.length}`).join(" · ")}` : ""}`, pl.moveTo, `Move ${pl.moveTo.length}…`)}
      ${block("·", "", "Follow up manually", "Tagged here only. Nothing is written to Apollo.", pl.tagged, "")}
      <section class="card"><div class="card-head"><div><h2>Re-add anyone removed by mistake</h2><p class="muted">Puts them back in this sequence with their original mailbox. Apollo starts them at step 1, not where they were.</p></div></div>
        ${canReAdd.length ? `<ul class="names">${canReAdd.map((l) => `<li><label class="inline"><input type="checkbox" data-act="readd-pick" data-uid="${esc(l.uid)}" ${S.readd.has(l.uid) ? "checked" : ""}> ${esc(l.name)}</label></li>`).join("")}</ul><div class="card-foot"><button class="btn" data-act="ask-confirm" data-kind="reAdd" ${S.readd.size && !S.applying ? "" : "disabled"}>Re-add ${S.readd.size}…</button></div>` : `<p class="muted">Nobody has been removed from this check yet.</p>`}</section>
      ${S.actionLog.length ? `<section class="card"><div class="card-head"><h2>What was written</h2></div><div class="table-wrap short"><table class="mini"><thead><tr><th>When</th><th>Contact</th><th>Action</th><th>Result</th></tr></thead><tbody>${S.actionLog.slice().reverse().slice(0, 400).map((l) => `<tr><td class="nowrap">${new Date(l.at).toLocaleString()}</td><td>${esc(l.name)}</td><td>${esc(l.action)}</td><td>${l.ok ? `<span class="tag ok">Done</span>` : `<span class="tag bad">Failed</span> ${esc(l.msg)}`}</td></tr>`).join("")}</tbody></table></div></section>` : ""}`;
  }
  const metric = (k, v) => `<div class="metric"><span class="metric-v">${v}</span><span class="metric-k">${esc(k)}</span></div>`;
  function confirmBox() {
    const pl = plan(), meta = S.data.meta, k = S.confirm;
    let items = [], title = "", verb = "";
    if (k === "removeHere") { items = pl.removeHere; title = `${meta.targetEverSent ? "Stop" : "Remove"} ${plural(items.length, "contact")} in “${meta.targetName}”`; verb = meta.targetEverSent ? "Stop them" : "Remove them"; }
    if (k === "finishElsewhere") { items = pl.finishElsewhere.map((x) => ({ ...x, extra: seqName(x.sequenceId) })); title = `Finish ${plural(items.length, "enrollment")} in other sequences`; verb = "Finish them"; }
    if (k === "moveTo") { items = pl.moveTo.map((x) => ({ ...x, extra: seqName(x.sequenceId) })); title = `Add ${plural(items.length, "contact")} to another sequence`; verb = "Add them"; }
    if (k === "reAdd") { items = S.result.people.filter((p) => S.readd.has(p.uid)); title = `Re-add ${items.length} to “${meta.targetName}”`; verb = "Re-add them"; }
    return `<div class="scrim" data-act="cancel-confirm"></div><div class="confirm" role="alertdialog" aria-modal="true" aria-label="${esc(title)}"><div class="confirm-ic">${icon("alert")}</div><h2>${esc(title)}</h2><p>This writes to your live Apollo account. Everyone affected:</p>
      <ul class="names scroll">${items.map((x) => `<li><span class="avatar sm">${esc(initials(x.name))}</span><div>${esc(x.name)}<div class="sub">${esc(x.company || "")} · ${esc(x.email || "")}${x.extra ? ` → ${esc(x.extra)}` : ""}</div></div></li>`).join("")}</ul>
      <div class="card-foot"><button class="btn ghost" data-act="cancel-confirm">Cancel</button><button class="btn danger" data-act="do-confirm">${esc(verb)}</button></div></div>`;
  }

  // ----- Rules -----
  function viewRules() {
    const hits = {};
    if (S.result) for (const p of S.result.people) for (const r of new Set(p.findings.map((f) => f.rule))) hits[r] = (hits[r] || 0) + 1;
    const groups = [...new Set(R.RULES.map((r) => r.group))];
    const off = new Set((S.cfg.disabledRules || []).map(Number));
    const effLabel = { remove: "Removes", review: "Flags for review", conflict: "Flags a conflict" };
    return `<div class="card rules-intro"><div class="legend"><span><span class="eff e-remove">Removes</span> out of this sequence</span><span><span class="eff e-review">Flags for review</span> you decide</span><span><span class="eff e-conflict">Flags a conflict</span> already being worked elsewhere</span></div>
      <p class="muted">Every rule checks the person and their company. A source that can't be reached is shown as “not checked” on every row it would have covered, never skipped silently.${S.result ? ` Hit counts are from the open check on “${esc(S.data.meta.targetName)}”.` : ""}</p></div>
      ${groups.map((g) => `<section class="rule-group"><h2 class="group-title">${esc(g)}</h2><div class="rule-list">${R.RULES.filter((r) => r.group === g).map((r) => {
        const on = !off.has(r.id);
        const open = S.ruleOpen.has(r.id);
        const hasParams = r.params.length > 0 || r.id === 1;
        return `<article class="rule ${on ? "" : "off"}"><div class="rule-head">
          <span class="rule-num">${r.id}</span><div class="rule-title"><h3>${esc(r.name)}</h3><span class="eff e-${r.effect}">${effLabel[r.effect]}</span>${S.result && hits[r.id] ? `<button class="hit" data-act="rule-hits" data-r="${r.id}">${plural(hits[r.id], "contact")} →</button>` : S.result ? `<span class="hit none">No hits</span>` : ""}</div>
          <label class="switch"><input type="checkbox" data-act="rule-toggle" data-r="${r.id}" ${on ? "checked" : ""} aria-label="${esc(r.name)}"><span></span></label></div>
          <p class="rule-what">${esc(r.what)}</p><p class="rule-why">${esc(r.why)}</p>
          ${hasParams ? `<button class="link" data-act="rule-open" data-r="${r.id}" aria-expanded="${open}">${open ? "Hide settings" : "Settings"}</button>${open ? `<div class="params">${r.id === 1 ? outcomeTable() : ""}${r.params.map(param).join("")}</div>` : ""}` : ""}
        </article>`;
      }).join("")}</div></section>`).join("")}`;
  }
  function outcomeTable() {
    const o = S.cfg.outcomes;
    const keepNote = "Keep · touched, unless the call note shows they spoke";
    const rows = [["meetingBooked", "Remove · Live"], ["infoRequested", "Remove · Live"], ["callBack", "Remove · Live"], ["pendingReview", "Remove · Live"], ["notInterested", "Remove · Closed"], ["doNotContact", "Remove · Closed"],
      ["wrongNumber", S.cfg.wrongNumber === "remove" ? "Remove" : "Review"], ["gatekeeper", keepNote], ["leftVoicemail", keepNote], ["noAnswer", keepNote]];
    return `<table class="mini outcomes"><thead><tr><th>Apollo outcome</th><th>What happens</th></tr></thead><tbody>${rows.map(([k, v]) => `<tr><td>${esc(S.cfg.outcomeLabels[o[k]] || k)}</td><td>${esc(v)}</td></tr>`).join("")}<tr><td>No disposition</td><td>Decided by the call note and duration (rule 2)</td></tr></tbody></table>`;
  }
  function param(key) {
    const c = S.cfg;
    const list = (id, k, label, val, hint) => `<label class="field"><span>${label}</span><textarea id="${id}" class="input" rows="2" data-act="set-list" data-k="${k}">${esc((val || []).join(", "))}</textarea>${hint ? `<small class="muted">${hint}</small>` : ""}</label>`;
    switch (key) {
      case "wrongNumber": return `<div class="field"><span>Wrong Number goes to</span><div class="seg">${["review", "remove"].map((v) => `<button class="seg-btn ${c.wrongNumber === v ? "on" : ""}" data-act="set-str" data-k="wrongNumber" data-v="${v}">${v === "review" ? "Review" : "Remove"}</button>`).join("")}</div></div>`;
      case "longCallSec": return `<label class="field narrow"><span>Counts as a conversation at</span><span class="with-unit"><input id="p-long" class="input" type="number" min="1" data-act="set-num" data-k="longCallSec" value="${esc(c.longCallSec)}"><em>seconds</em></span></label>`;
      case "midCallSec": return `<label class="field narrow"><span>Or, with no note, at</span><span class="with-unit"><input id="p-mid" class="input" type="number" min="1" data-act="set-num" data-k="midCallSec" value="${esc(c.midCallSec)}"><em>seconds</em></span></label>`;
      case "extraMailboxes": return list("p-boxes", "extraMailboxes", "Other Outlook mailboxes to search besides yours", c.extraMailboxes, "Comma-separated. You need delegated access to each one.");
      case "calendarMonths": return `<label class="field narrow"><span>Look back in your calendar</span><span class="with-unit"><input id="p-cal" class="input" type="number" min="1" max="60" data-act="set-num" data-k="calendarMonths" value="${esc(c.calendarMonths)}"><em>months</em></span></label>`;
      case "removeStages": return `<div class="field"><span>Stages that remove someone</span><div class="chips">${Object.entries(c.allStages || {}).map(([id, name]) => `<button class="chip-t ${c.removeStages[id] ? "on" : ""}" data-act="stage-toggle" data-id="${esc(id)}" aria-pressed="${!!c.removeStages[id]}">${c.removeStages[id] ? icon("check") : ""}${esc(name)}</button>`).join("")}</div><small class="muted">Highlighted stages remove. The rest are fine to sequence.</small></div>`;
      case "contactEndReasons": return list("p-end", "contactEndReasons", "End reasons that mean contact was made", c.contactEndReasons, "Matched as text inside Apollo's end reason.");
      case "callSequences": return `<div class="field"><span>Live call sequences</span>${["dynamics", "m365"].map((prod) => `<div class="sub">${prod === "dynamics" ? "Dynamics 365" : "M365 / Azure"}: ${(c.callSequences[prod] || []).length ? esc(c.callSequences[prod].map(seqName).join(", ")) : "none picked"}</div>`).join("")}<button class="link" data-act="view" data-v="settings">Pick them in Settings</button></div>`;
      case "titlePriority": return list("p-titles", "titlePriority", "Title priority, first match wins", c.titlePriority);
      case "keywords": return list("p-kd", "keywords.dynamics", "Dynamics 365 keywords", c.keywords.dynamics, "Short codes like NAV, GP or AX only count in capitals.") + list("p-km", "keywords.m365", "M365 / Azure keywords", c.keywords.m365);
      case "freeDomains": return list("p-free", "freeDomains", "Free email domains, never used to link people to a company", c.freeDomains);
      default: return "";
    }
  }

  // ----- Settings -----
  function viewSettings() {
    const c = S.cfg;
    const seqs = S.sequences ? Object.values(S.sequences).filter((s) => !s.archived).sort((a, b) => a.name.localeCompare(b.name)) : [];
    const seqPick = (prod) => S.sequences ? `<div class="checks">${seqs.map((s) => `<label class="check-row"><input type="checkbox" data-act="cs" data-prod="${prod}" data-id="${esc(s.id)}" ${(c.callSequences[prod] || []).includes(s.id) ? "checked" : ""}><span>${esc(s.name)}</span>${s.active ? "" : `<em class="muted">inactive</em>`}</label>`).join("")}</div>`
      : `<button class="btn" data-act="load-seqs" ${S.seqLoading ? "disabled" : ""}>${S.seqLoading ? "Loading…" : "Load my sequences"}</button>`;
    return `<section class="card"><div class="card-head"><div><h2>Sources</h2><p class="muted">Every call uses your own claude.ai connectors. This page holds no passwords or keys. Allow them once and choose “always” so checks never stop to ask.</p></div>
        ${S.demo ? "" : `<div class="row-gap"><button class="btn primary" data-act="allow-all">${icon("plug")}Allow all</button><button class="btn ghost" data-act="manage-perms">Manage permissions</button></div>`}</div>
        <ul class="sources">${C.MANIFEST.map((m) => { const st = connState(m.server); const info = CONNECTOR_INFO[m.server]; return `<li><span class="dot d-${st.key}"></span><div class="src-main"><strong>${esc(info.short)}</strong><span class="muted">${esc(info.what)}</span></div><div class="src-st"><span class="tag ${st.key === "ok" ? "ok" : st.key === "bad" ? "bad" : st.key === "ask" ? "warn" : ""}">${esc(st.label)}</span>${st.fix ? `<small class="muted">${esc(st.fix)}</small>` : ""}</div></li>`; }).join("")}
          <li><span class="dot d-via"></span><div class="src-main"><strong>Trellus</strong><span class="muted">Not reachable as its own source yet. Trellus writes its AI summary and a recording and transcript link into each Apollo call note, and rule 2 reads that.</span></div><div class="src-st"><span class="tag">Read through Apollo</span></div></li></ul></section>
      <section class="card"><div class="card-head"><div><h2>Live call sequences</h2><p class="muted">Used by rules 13 and 14. Anyone ever in one is out of an email-only sequence for the same product, and a colleague active in one takes their company out.</p></div></div>
        <div class="two"><div><h3 class="h-sm">Dynamics 365</h3>${seqPick("dynamics")}</div><div><h3 class="h-sm">M365 / Azure</h3>${seqPick("m365")}</div></div></section>
      <section class="card"><div class="card-head"><div><h2>Apollo limits</h2><p class="muted">Checks pause at these and resume where they stopped.</p></div></div>
        <div class="metrics">${Object.entries(c.budgets).map(([k, v]) => metric(k.replace("apollo_", "").replace(/_/g, " "), `${v.hour}/hr`)).join("")}</div></section>
      <section class="card"><div class="card-head"><div><h2>Where your data lives</h2><p class="muted">${S.persistent ? "Checks and decisions are saved in this page's private storage, visible only to you." : "This view can't save. Checks last until the page closes."} Rule settings are on the Rules page.</p></div></div></section>`;
  }

  // ---------- events ----------
  let filterTimer = null;
  function setNested(obj, path, val) { const ks = path.split("."); let o = obj; for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]]; o[ks[ks.length - 1]] = val; }
  document.addEventListener("click", async (ev) => {
    const t = ev.target.closest("[data-act]");
    if (!t || t.disabled) return;
    const act = t.dataset.act;
    if (t.tagName === "SELECT" || (t.tagName === "INPUT" && t.type !== "checkbox") || t.tagName === "TEXTAREA") return;
    switch (act) {
      case "view": S.view = t.dataset.v; S.detail = null; if ((S.view === "settings" || S.view === "check") && !S.sequences && S.mcp && !S.demo) { render(); await loadSequences(); return; } break;
      case "toast-x": S.toast = ""; break;
      case "allow-all": await allowAll(); return;
      case "manage-perms": await managePerms(); return;
      case "load-seqs": await loadSequences(); return;
      case "pick-product": S.newRun.product = t.dataset.v; break;
      case "start-run": await startRun(); return;
      case "open-run": await openRun(t.dataset.id); return;
      case "resume-run": if (!S.data || S.data.meta.id !== t.dataset.id) await openRun(t.dataset.id); if (S.data && S.data.meta.status !== "done") runPipeline(); return;
      case "del-run": {
        const r = S.runs.find((x) => x.id === t.dataset.id);
        if (S.pendingDelete !== t.dataset.id) { S.pendingDelete = t.dataset.id; break; }
        S.pendingDelete = null;
        if (r) { for (const [pfx, n] of Object.entries(r.chunks || {})) for (let i = 0; i < n; i++) await S.store.del(`${pfx}__${r.id}__${i}`); await S.store.del(`seq__${r.id}`); await S.store.del(`dec__${r.id}`); await S.store.del(`run__${r.id}`); }
        if (S.data && r && S.data.meta.id === r.id) { S.data = null; S.result = null; S.progress = null; }
        await refreshRuns(); break;
      }
      case "stop-run": if (S.collector) S.collector.stop(); break;
      case "bucket": S.filters.bucket = t.dataset.b; S.filters.keep = ""; S.limit = 300; S.selected.clear(); break;
      case "keep-group": S.filters.keep = t.dataset.v; break;
      case "toggle-filters": S.showFilters = !S.showFilters; break;
      case "sort": { const k = t.dataset.k; S.filters.dir = S.filters.sort === k && S.filters.dir === "desc" ? "asc" : "desc"; S.filters.sort = k; break; }
      case "clear-filters": Object.assign(S.filters, { q: "", status: "", rule: "", source: "", from: "", to: "", minDays: "", maxDays: "" }); break;
      case "sel": if (S.selected.has(t.dataset.uid)) S.selected.delete(t.dataset.uid); else S.selected.add(t.dataset.uid); break;
      case "sel-page": { const shown = rows().slice(0, S.limit); const all = shown.every((p) => S.selected.has(p.uid)); shown.forEach((p) => (all ? S.selected.delete(p.uid) : S.selected.add(p.uid))); break; }
      case "select-filter": rows().forEach((p) => S.selected.add(p.uid)); break;
      case "select-none": S.selected.clear(); break;
      case "more": S.limit += 300; break;
      case "open": S.detail = t.dataset.uid; break;
      case "close": S.detail = null; break;
      case "quick":
      case "choose": { const d = S.decisions[t.dataset.uid] = { ...(S.decisions[t.dataset.uid] || {}), action: t.dataset.v, auto: false }; if (d.action !== "move") d.moveTo = ""; await saveDecisions(); break; }
      case "bulk-apply": {
        const b = S.bulk;
        for (const uid of S.selected) S.decisions[uid] = { ...(S.decisions[uid] || {}), action: b.action, moveTo: b.action === "move" ? b.moveTo : "", note: b.note || (S.decisions[uid] || {}).note || "", finishElsewhere: b.finishElsewhere, auto: false };
        S.toast = `Set “${ACTIONS[b.action]}” for ${plural(S.selected.size, "contact")}.`;
        S.selected.clear(); await saveDecisions(); break;
      }
      case "export-contacts": exportContacts(); return;
      case "export-touches": exportTouches(); return;
      case "ask-confirm": S.confirm = t.dataset.kind; break;
      case "cancel-confirm": S.confirm = null; break;
      case "do-confirm": { const k = S.confirm; if (k === "reAdd") { const u = [...S.readd]; S.readd = new Set(); await reAdd(u); } else await execute(k); return; }
      case "readd-pick": { const u = t.dataset.uid; if (S.readd.has(u)) S.readd.delete(u); else S.readd.add(u); break; }
      case "cs": { const prod = t.dataset.prod, id = t.dataset.id; const arr = S.cfg.callSequences[prod] || (S.cfg.callSequences[prod] = []); const i = arr.indexOf(id); if (i >= 0) arr.splice(i, 1); else arr.push(id); cfgChanged({ reeval: false }); return; }
      case "rule-toggle": { const r = Number(t.dataset.r); const off = new Set((S.cfg.disabledRules || []).map(Number)); if (off.has(r)) off.delete(r); else off.add(r); S.cfg.disabledRules = [...off]; cfgChanged(); return; }
      case "rule-open": { const r = Number(t.dataset.r); if (S.ruleOpen.has(r)) S.ruleOpen.delete(r); else S.ruleOpen.add(r); break; }
      case "rule-hits": {
        const r = t.dataset.r;
        const byBucket = {};
        for (const p of S.result.people) if (p.findings.some((f) => String(f.rule) === r)) byBucket[p.bucket] = (byBucket[p.bucket] || 0) + 1;
        S.filters.bucket = Object.entries(byBucket).sort((a, b) => b[1] - a[1])[0][0];
        Object.assign(S.filters, { rule: r, keep: "" }); S.showFilters = true; S.view = "review"; break;
      }
      case "stage-toggle": { const id = t.dataset.id; if (S.cfg.removeStages[id]) delete S.cfg.removeStages[id]; else S.cfg.removeStages[id] = S.cfg.allStages[id]; cfgChanged(); return; }
      case "set-str": setNested(S.cfg, t.dataset.k, t.dataset.v); cfgChanged(); return;
      default: return;
    }
    render();
  });
  document.addEventListener("change", async (ev) => {
    const t = ev.target.closest("[data-act]");
    if (!t) return;
    const act = t.dataset.act;
    if (act === "pick-seq") { S.newRun.seqId = t.value; S.newRun.product = ""; render(); }
    if (act === "filter" && (t.tagName === "SELECT" || t.type === "date" || t.type === "number")) { S.filters[t.dataset.k] = t.value; render(); }
    if (act === "bulk-field") { S.bulk[t.dataset.k] = t.type === "checkbox" ? t.checked : t.value; if (t.tagName === "SELECT") render(); }
    if (act === "dfield") { const d = S.decisions[t.dataset.uid] = { ...(S.decisions[t.dataset.uid] || {}), auto: false }; d[t.dataset.k] = t.type === "checkbox" ? t.checked : t.value; await saveDecisions(); if (t.tagName === "SELECT") render(); }
    if (act === "set-list") { setNested(S.cfg, t.dataset.k, t.value.split(",").map((x) => x.trim()).filter(Boolean)); cfgChanged(); }
    if (act === "set-num") { const n = Number(t.value); if (n >= 1) { setNested(S.cfg, t.dataset.k, n); cfgChanged(); } }
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
