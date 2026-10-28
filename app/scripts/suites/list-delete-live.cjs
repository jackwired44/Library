// Lists: Delete must work inside the claude.ai artifact frame. Per Jack:
// "make sure the delete button works in lists". That frame blocks the
// browser's own confirm() popup, which then answers false at once, so the
// old Delete read every click as Cancel. Here the app runs inside an iframe
// sandboxed the same way (no allow-modals); the in-page box must take over.
const BASE = process.env.BASE || 'http://localhost:4173';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { chromium } = require('playwright');
const os = require('os'); const fs = require('fs'); const path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const q = v => `"${String(v).replace(/"/g, '""')}"`;
const LEADS = path.join(os.tmpdir(), 'listdelete-leads.csv');
fs.writeFileSync(LEADS, ['Company,Full Name,Title,Email,Comments',
  ['KEEP CO', 'Kim Lane', 'CIO', 'kim@keep.com', 'Looking to move from Google Workspace to Microsoft 365 for 240 users.'].map(q).join(','),
].join('\n'));

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log(`  FAIL ${n}${d ? ' — ' + d : ''}`)); };

(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const ctx = await b.newContext({ viewport: { width: 1600, height: 950 } });
  const page = await ctx.newPage();
  const errs = []; let nativeDialogs = 0;
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  page.on('dialog', d => { nativeDialogs++; d.accept(); });
  page.setDefaultTimeout(60000);
  await page.route(BASE + '/__host', r => r.fulfill({ contentType: 'text/html',
    body: `<!doctype html><body style="margin:0"><iframe id="app" src="${BASE}" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads" style="width:100vw;height:100vh;border:0"></iframe></body>` }));
  await page.goto(BASE + '/__host'); await sleep(1500);
  const f = page.frameLocator('#app');
  const frame = () => page.frames().find(x => x !== page.mainFrame());
  const nav = async name => { await f.locator('.side-nav-btn', { hasText: name }).first().click(); await sleep(700); };

  await f.locator('input[aria-label="Email"]').fill('jack@wiredcio.com');
  await f.locator('input[type=password]').fill('changeme');
  await f.locator('button:has-text("Unlock")').click(); await sleep(1200);
  await frame().evaluate(() => { try { localStorage.setItem('skipFileNameBox', '1'); } catch { /* ignore */ } });

  const blocked = await frame().evaluate(() => { const t = performance.now(); const r = window.confirm('probe'); return { r, ms: performance.now() - t }; });
  ok('the sandboxed frame blocks the browser confirm popup (as the artifact does)', blocked.r === false && blocked.ms < 60 && nativeDialogs === 0, JSON.stringify(blocked));

  await nav('Main Scanner');
  await f.locator('input[type=file]').setInputFiles(LEADS);
  await f.locator('.data-table tbody tr').first().waitFor();
  await sleep(600);
  const strip = f.locator('[role=group][aria-label="Add to list"]');
  for (const name of ['Doomed list', 'Kept list']) {
    await strip.locator('select').selectOption('__new__');
    await strip.locator('input[aria-label="New list name"]').fill(name);
    await strip.locator('button').click(); await sleep(500);
  }
  await nav('Lists');
  const card = f.locator('[aria-label="List Doomed list"]');
  ok('two lists exist', await card.count() === 1 && await f.locator('[aria-label="List Kept list"]').count() === 1);

  await card.locator('button', { hasText: 'Delete' }).click(); await sleep(300);
  const box = f.locator('[role=alertdialog][aria-label="Confirm"]');
  ok('Delete asks in the page instead of the blocked popup', await box.count() === 1 && /Delete the list "Doomed list"/.test(await box.innerText()));
  await box.locator('[data-act="cancel"]').click(); await sleep(300);
  ok('Cancel keeps the list', await card.count() === 1 && await box.count() === 0);

  await card.locator('button', { hasText: 'Delete' }).click(); await sleep(300);
  await box.locator('[data-act="ok"]').click(); await sleep(600);
  ok('confirming deletes the list', await card.count() === 0);
  ok('the other list is untouched', await f.locator('[aria-label="List Kept list"]').count() === 1);

  await page.reload(); await sleep(2000);
  await nav('Lists');
  ok('the deleted list stays deleted after a reload', await f.locator('[aria-label="List Doomed list"]').count() === 0 && await f.locator('[aria-label="List Kept list"]').count() === 1);

  ok('no native popup was ever shown', nativeDialogs === 0);
  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  console.log(fail ? 'list-delete-live FAIL' : `list-delete-live PASS ${pass}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
