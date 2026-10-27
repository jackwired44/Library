// Stored Main notes are rewritten with today's note rules. Per Jack: "we
// need to make sure we update all the leads in here with the new note
// rule". An old-style note is planted on a stored lead, the rules-version
// marker is rolled back, and a reload must rewrite it — keeping the stored
// score mark, the tier and older dated segments — while Custom/CSP leads
// and the manual ↻ Refresh with today's rules button behave. The scan
// verdict refreshes too: a lead the old rules called Strong Signal that
// today's rules call a Bad Lead becomes one, unless someone marked it
// not-a-fit by hand.
const BASE = process.env.BASE || 'http://localhost:4173';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { chromium } = require('playwright');
const os = require('os'); const fs = require('fs'); const path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const q = v => `"${String(v).replace(/"/g, '""')}"`;
const csv = (head, rows) => [head.join(',')].concat(rows.map(r => r.map(q).join(','))).join('\n');
const HEAD = ['Company', 'Full Name', 'Title', 'Email', 'msp_primaryproductcodename', 'Comments'];
const NOTE = 'SA - 9/Mar - Follow-up sent to the partner requesting an update on the current project status and estimated ACR. Client Info: Acme Bank Account ID: 9-ZZF Referral ID: 7426adc0 Notes: Microsoft Partner is engaging with Acme Bank to enable the Microsoft Foundry Platform with a focus on Agent Service. Help Needed from Microsoft ========== We seek Microsoft\'s assistance: - Support in implementing the analytics platform on Microsoft Azure to ensure seamless integration and scalability. - Guidance on cloud migration strategies and connectivity to enable efficient data access across multiple sources.';
const FILE = path.join(os.tmpdir(), 'note-refresh.csv');
const PENDING = 'In the 09/25 session the customer confirmed 3 Microsoft 365 Business Standard licenses at the nonprofit price. The purchase is pending because the admin assistant has the payment card. Uses Google for email and will keep it.';
fs.writeFileSync(FILE, csv(HEAD, [
  ['ACME BANK', 'Pat Lee', 'CIO', 'pat@acmebank.com', 'AI Ready with Surface Copilot PCs', NOTE],
  ['RAMPS NONPROFIT', 'Ann Ray', 'Director', 'ann@rampsnp.org', 'Microsoft 365', PENDING],
]));

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log(`  FAIL ${n}${d ? ' — ' + d : ''}`)); };

const idb = (page, fn, arg) => page.evaluate(async ([src, a]) => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('wiredCioUnifiedLeadScannerLibrary_v1'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const out = await (new Function('db', 'a', `return (${src})(db, a)`))(db, a);
  db.close(); return out;
}, [fn.toString(), arg]);
const getAll = (db) => new Promise((res) => { const r = db.transaction('leads').objectStore('leads').getAll(); r.onsuccess = () => res(r.result); });
const putLead = (db, l) => new Promise((res) => { const t = db.transaction('leads', 'readwrite'); t.objectStore('leads').put(l); t.oncomplete = () => res(true); });

(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const page = await (await b.newContext({ viewport: { width: 1600, height: 950 } })).newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('dialog', d => d.accept());
  page.setDefaultTimeout(120000);
  const unlock = async () => {
    await page.goto(BASE); await sleep(700);
    if (await page.locator('input[type=password]').count()) {
      await page.fill('input[aria-label="Email"]', 'jack@wiredcio.com');
      await page.fill('input[type=password]', 'changeme');
      await page.click('button:has-text("Unlock")'); await sleep(1200);
    }
  };
  await unlock();
  await page.locator('.side-nav-btn', { hasText: 'Main Scanner' }).first().click(); await sleep(500);
  await page.setInputFiles('input[type=file]', FILE);
  await page.waitForFunction(() => !!document.querySelector('.data-table tbody tr'), null, { timeout: 120000 });
  await page.locator('button[aria-label="Save to platform"]').first().click(); await sleep(1500);

  let leads = await idb(page, getAll);
  const acme = leads.find(l => /acme/i.test(l.company));
  ok('the upload is stored as a Main lead', !!acme && acme.source === 'main', JSON.stringify(acme && acme.source));
  ok('  already written with the new rule', !!acme && /Looking for Azure architecture support/.test(acme.notes), acme && acme.notes);

  // Plant an old-rule note: an old dated segment underneath, and a stale
  // newest segment with a score mark of its own.
  const old = { ...acme, notes: '2026-10-01 · (38) ▲ Runs Copilot. Partner on record: AI Ready with Surface Copilot PCs. Ask how they manage licensing today, in-house or through a partner, and where the pain is.\n2026-09-01 · (30) ▲ Older history line.' };
  await idb(page, putLead, old);
  const ramps = leads.find(l => /ramps/i.test(l.company));
  ok('a pending-purchase row scans as a Bad Lead today', !!ramps && /^Bad Lead/.test(ramps.tier), ramps && ramps.tier);
  await idb(page, putLead, { ...ramps, tier: 'Strong Signal', score: 80 });
  await page.evaluate(() => localStorage.setItem('mainNoteRulesVersion', 'old'));
  await page.reload(); await unlock();
  await page.waitForFunction(() => localStorage.getItem('mainNoteRulesVersion') !== 'old', null, { timeout: 60000 });
  await sleep(800);

  leads = await idb(page, getAll);
  const rampsAfter = leads.find(l => l.key === ramps.key);
  ok('a stored Strong Signal the new rule calls bad becomes a Bad Lead', /^Bad Lead/.test(rampsAfter.tier), rampsAfter.tier);
  ok('  its note no longer reads as a High lead', !/\) ▲ /.test(rampsAfter.notes.split('\n')[0]), rampsAfter.notes);
  const after = leads.find(l => l.key === acme.key);
  const top = (after.notes || '').split('\n')[0];
  ok('reload rewrites the stale note with today\'s rule', /Partner is engaging with Acme Bank/.test(top) && /Looking for Azure architecture support/.test(top), top);
  ok('  closes on the Azure ask, not the old licensing one', /Ask how Azure is managed today/.test(top) && !/manage licensing/.test(top), top);
  ok('  keeps its date and carries a score mark', /^2026-10-01 · \(\d{1,3}\) [▲▼▸✕] /.test(top), top);
  ok('  leaves the older dated segment alone', /\n2026-09-01 · \(30\) ▲ Older history line\.$/.test(after.notes), after.notes);
  ok('  tier and score match today\'s scan', after.tier === acme.tier && after.score === acme.score, `${after.tier}/${after.score}`);

  // Plant again with the marker current, so the reload does NOT refresh on
  // its own and the button is what rewrites it. This time it is marked
  // not-a-fit by hand, which a refresh must never undo.
  await idb(page, putLead, { ...old, tier: 'Bad Lead', notFit: 'Hand-marked' });
  await page.reload(); await unlock(); await sleep(800);
  leads = await idb(page, getAll);
  ok('a current marker does not refresh again on load', /Runs Copilot/.test(leads.find(l => l.key === acme.key).notes));
  await page.locator('.side-nav-btn', { hasText: 'All leads' }).first().click(); await sleep(800);
  const btn = page.locator('button', { hasText: '↻ Refresh with today' });
  ok('All leads offers ↻ Refresh with today\'s rules', await btn.count() === 1);
  await btn.click();
  await page.waitForFunction(() => /Notes refreshed/.test(document.querySelector('main')?.textContent || ''), null, { timeout: 60000 });
  const msg = (await page.locator('main').innerText()).match(/Notes refreshed · [\d,]+ updated/);
  ok('  the button reports what it updated', !!msg && /1 updated/.test(msg[0]), msg && msg[0]);
  leads = await idb(page, getAll);
  const hand = leads.find(l => l.key === acme.key);
  ok('  and rewrote the note', /Looking for Azure architecture support/.test(hand.notes.split('\n')[0]), hand.notes);
  ok('  but a hand-marked not-a-fit lead stays a Bad Lead', hand.tier === 'Bad Lead' && hand.notFit === 'Hand-marked', hand.tier);

  // Per Jack: "is there an easier way to mass push it" — a lead saved before
  // raw rows were kept can't be refreshed, and the button names its file.
  await idb(page, putLead, { ...acme, key: acme.key + '-noraw', company: 'OLD ROW CO', email: 'x@oldrow.com', sourceFiles: ['Old Sheet 40.csv'] });
  await page.reload(); await unlock(); await sleep(800);
  await page.locator('.side-nav-btn', { hasText: 'All leads' }).first().click(); await sleep(800);
  await page.locator('button', { hasText: '↻ Refresh with today' }).click();
  await page.waitForFunction(() => /Notes refreshed/.test(document.querySelector('main')?.textContent || ''), null, { timeout: 60000 });
  const miss = page.locator('details[aria-label="Files to re-upload"]');
  const missText = (await miss.innerText().catch(() => '')).replace(/\s+/g, ' ');
  ok('a lead with no saved CSV row is counted, with its file to re-upload', /1 have no saved CSV row · re-upload 1 file/.test(missText), missText);
  await miss.locator('summary').click(); await sleep(200);
  ok('  and the file is named', /Old Sheet 40\.csv \(1\)/.test((await miss.innerText()).replace(/\s+/g, ' ')));
  ok('no page errors', errs.length === 0, errs.join(' | '));

  await b.close();
  console.log(`\n${pass}/${pass + fail} checks passed`);
  if (fail) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
