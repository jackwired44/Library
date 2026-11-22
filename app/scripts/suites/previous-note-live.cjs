// Per Jack (11/22): "state previous note on lead", then "can we make this a
// rule going forward if there is a previous note in here" and "look at the
// last 3 months of leads and see which need this update to happen".
//
// The rule, asserted here end to end: ANY stored lead holding more than one
// note states the one before it, wherever its note is shown or downloaded,
// and it does so WITHOUT anything being run by hand. Leads from three
// months are planted straight into IndexedDB the way they would already be
// stored, the app is opened once, and each case is read back.
//
// Case A  Sep + Nov notes, rules marker CURRENT  -> states the Sep note on
//         open alone. Nothing to run: this is the "nothing needed" answer.
// Case B  the old same-day stacking bug (a no-signal line sitting on top of
//         a real note from the same day) -> cleaned by the refresh.
// Case C  one note only -> no previous line invented.
// Case D  the CSV download carries the line, so it survives into Apollo
//         whichever way an import treats the contact's note.
const BASE = process.env.BASE || 'http://localhost:4173';
const EXE = (require('fs').existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : undefined);
const { chromium } = require('playwright');
const os = require('os'); const fs = require('fs'); const path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const q = v => `"${String(v).replace(/"/g, '""')}"`;
const csv = (head, rows) => [head.join(',')].concat(rows.map(r => r.map(q).join(','))).join('\n');
const HEAD = ['Company', 'Full Name', 'Title', 'Email', 'msp_primaryproductcodename', 'Comments'];
const FILE = path.join(os.tmpdir(), 'previous-note.csv');
fs.writeFileSync(FILE, csv(HEAD, [
  ['SEEDCO', 'Seed Lead', 'IT Director', 'seed@seedco.com', 'Dynamics 365',
   'Customer wants to evaluate Dynamics 365 Business Central for 40 users and asked for pricing.'],
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

const SEP = '(30) ▸ Wants Microsoft 365 E3 for 40 users. Ask how they manage licensing today, in-house or through a partner, and where the pain is.';
const NOV = '(56) ▲ Wants Dynamics 365 Business Central (40 users). Ask whether they have ever looked at the platform.';
const NO_SIGNAL = '▼ No Dynamics, M365, Azure or licensing signal.';

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
  await page.evaluate(() => { try { localStorage.setItem('skipFileNameBox', '1'); } catch { /* ignore */ } });
  // One real upload, purely to get a correctly shaped stored lead to clone.
  await page.locator('.side-nav-btn', { hasText: 'Main Scanner' }).first().click(); await sleep(500);
  await page.setInputFiles('input[type=file]', FILE);
  await page.waitForFunction(() => !!document.querySelector('.data-table tbody tr'), null, { timeout: 120000 });
  await page.locator('button[aria-label="Save to platform"]').first().click(); await sleep(1500);
  const seed = (await idb(page, getAll)).find(l => /seedco/i.test(l.company));
  ok('a seeded Main lead is stored', !!seed, JSON.stringify(seed && seed.company));

  const clone = (n, extra) => ({
    ...seed, key: `e:${n}@three.com`, email: `${n}@three.com`,
    company: `${n.toUpperCase()} CO`, contact: `${n} Lead`, ...extra,
  });
  // A: two months of notes, nothing stacked wrong.
  await idb(page, putLead, clone('alpha', { notes: `2026-11-20 · ${NOV}\n2026-09-15 · ${SEP}` }));
  // B: the old same-day stacking bug.
  await idb(page, putLead, clone('bravo', { notes: `2026-10-05 · ${NO_SIGNAL}\n2026-10-05 · ${NOV}` }));
  // E: the same burial ACROSS months, which is how it showed up on Jack's
  // real November files (11 leads, one of them graded High).
  await idb(page, putLead, clone('delta', { notes: `2026-11-17 · ${NO_SIGNAL}\n2026-09-15 · ${SEP}` }));
  // C: one note only.
  await idb(page, putLead, clone('charlie', { notes: `2026-11-20 · ${NOV}` }));

  // Open the app again with the rules marker CURRENT — so nothing is being
  // refreshed on purpose, and case A has to stand on its own.
  await page.reload(); await unlock(); await sleep(1500);
  await page.locator('.side-nav-btn', { hasText: 'All leads' }).first().click(); await sleep(1500);
  const search = page.locator('main input[placeholder^="Search company"]');

  const rowText = async (name) => {
    await search.fill(name); await sleep(900);
    return (await page.locator('.data-table tbody tr').first().innerText()).replace(/\s+/g, ' ');
  };

  const a = await rowText('ALPHA CO');
  ok('A: a lead with two months of notes states the earlier one', /Previous note \(9\/15, Needs Review\): Wants Microsoft 365 E3 for 40 users\./.test(a), a.slice(0, 300));
  ok('A:   and did it with nothing run by hand', /Wants Dynamics 365 Business Central \(40 users\)/.test(a), a.slice(0, 200));
  ok('A:   the previous line never carries the older note’s question', !/Previous note[^|]*Ask how they manage/.test(a), a.slice(0, 300));

  const c = await rowText('CHARLIE CO');
  ok('C: a lead with one note invents no previous line', !/Previous note/.test(c), c.slice(0, 200));

  // Case B needs the refresh, which is what a version bump triggers.
  await page.evaluate(() => localStorage.setItem('mainNoteRulesVersion', 'old'));
  await page.reload(); await unlock();
  await page.waitForFunction(() => localStorage.getItem('mainNoteRulesVersion') !== 'old', null, { timeout: 90000 });
  await sleep(1200);
  const bravo = (await idb(page, getAll)).find(l => /bravo/i.test(l.company));
  ok('B: the same-day no-signal line is dropped', !/No Dynamics, M365, Azure or licensing signal/.test(bravo.notes), bravo.notes);
  ok('B:   and the real note from that day is kept', /Wants Dynamics 365 Business Central/.test(bravo.notes), bravo.notes);
  ok('B:   leaving one note, so nothing claims a previous one', bravo.notes.split('\n').length === 1, bravo.notes);
  const delta = (await idb(page, getAll)).find(l => /delta/i.test(l.company));
  ok('E: a no-signal line from a LATER month never buries an earlier real note', !/No Dynamics, M365, Azure or licensing signal/.test(delta.notes), delta.notes);
  ok('E:   the real note is what is left', /Wants Microsoft 365 E3 for 40 users/.test(delta.notes), delta.notes);

  // D: the line reaches the CSV, which is the whole point — an Apollo
  // import that overwrites the contact's note still carries the history.
  await page.locator('.side-nav-btn', { hasText: 'All leads' }).first().click(); await sleep(1200);
  await search.fill('ALPHA CO'); await sleep(900);
  const dl = page.locator('main button', { hasText: /Export .* for Apollo/ }).first();
  let text = '';
  if (await dl.count()) {
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }).catch(() => null), dl.click()]);
    if (download) text = fs.readFileSync(await download.path(), 'utf8');
  }
  ok('D: the download carries the previous-note line', /Previous note \(9\/15, Needs Review\)/.test(text), text.slice(0, 400) || '(no download)');

  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close();
  console.log(`\n${pass}/${pass + fail} checks passed`);
  if (fail) process.exit(1);
})();
