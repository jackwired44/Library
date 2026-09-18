// The Documentation tab, driven in a real browser. Its numbers are read
// from the live rules, so this also catches a rule change that silently
// contradicts the docs.
const BASE = process.env.BASE || 'http://localhost:4173';
const { chromium } = require('playwright');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log('  PASS', n)) : (fail++, console.log('  FAIL', n, d)); };

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await (await b.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|font|net::|googleapis|Failed to load/i.test(m.text())) errs.push('CONSOLE ' + m.text()); });

  await page.goto(BASE); await sleep(700);
  await page.fill('input[aria-label="Email"]', 'jack@wiredcio.com');
  await page.fill('input[type=password]', 'changeme');
  await page.click('button:has-text("Unlock")'); await sleep(1200);

  console.log('\n== entry point ==');
  const btn = page.locator('button[aria-label="Documentation"]');
  ok('a Documentation button sits at the bottom left', await btn.count() === 1);
  const box = await btn.boundingBox();
  const nav = await page.locator('.sidebar').boundingBox();
  ok('  it is inside the sidebar, below the nav', !!box && !!nav && box.x < 260 && box.y > nav.height * 0.5, JSON.stringify(box));
  await btn.click(); await sleep(600);
  ok('  it opens the Documentation page', /Documentation/.test(await page.locator('main h2').innerText()));
  // The sidebar is dark; a light active fill would make the label vanish.
  const vis = await btn.evaluate((el) => {
    const cs = getComputedStyle(el);
    const parse = (c) => (c.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    const lum = (rgb) => { const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const bg = parse(cs.backgroundColor), fg = parse(cs.color);
    const L1 = lum(fg), L2 = lum(bg);
    return { ratio: (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05), bg: cs.backgroundColor, color: cs.color, rail: cs.borderLeftColor };
  });
  ok('  the active button is readable on the dark sidebar (>= 4.5:1)', vis.ratio >= 4.5, `${vis.ratio.toFixed(2)}:1  fg ${vis.color} on bg ${vis.bg}`);

  console.log('\n== sections ==');
  const wanted = ['How the platform is put together', 'CSP Scanner', 'Custom Scanner September', 'Main Scanner', 'The CSV, column by column', 'Capacity and storage', 'Known limits'];
  for (const w of wanted) ok(`section: ${w}`, await page.locator(`button[aria-label^="Toggle ${w}"]`).count() === 1);

  console.log('\n== each scanner is documented in its own terms ==');
  const openSec = async (name) => { await page.locator(`button[aria-label^="Toggle ${name}"]`).click(); await sleep(350); return page.locator('main').innerText(); };
  const csp = await openSec('CSP Scanner');
  // The docs list the header CANDIDATES the guesser matches on, which are
  // stored without the export's msp_ prefix.
  ok('CSP: names the header candidates it matches', /licensingprogramname/.test(csp) && /partneraccountidname/.test(csp) && /estimatedvalue/.test(csp), '');
  ok('CSP: explains the two-columns-one-hint rule that cost 6,500 phones', /address1_telephone1/.test(csp) && /telephone1/.test(csp));
  ok('CSP: states the score bands from the live rules', /High at 60\+/.test(csp) && /Medium at 25\+/.test(csp), (csp.match(/High at[^.]*/) || [''])[0]);
  ok('CSP: lists the six weighted factors', /Partner lane/.test(csp) && /Billing intent/.test(csp) && /Reachable/.test(csp));
  ok('CSP: explains the dead-language penalties by position', /newest seller entry/.test(csp) && /−35/.test(csp) && /−10/.test(csp));
  ok('CSP: explains the pinned lead', /asking for a partner, none assigned, and annual\s+new upfront/i.test(csp.replace(/\s+/g, ' ')), '');
  ok('CSP: says Product Area carries the priority', /Product Area carries the priority/.test(csp));
  ok('CSP: says there is no product line here', /no product line/i.test(csp));
  ok('CSP: documents which date it filters on', /createdon/.test(csp) && /forecast, not a receipt/.test(csp));

  const smc = await openSec('Custom Scanner September');
  ok('SMC: describes the propensity blob, not scoring', /propensity/i.test(smc) && !/0–100/.test(smc.split('Custom Scanner September')[1] || ''));
  ok('SMC: states its own Strong Signal rule', /whitespace play|already owned/i.test(smc));

  const main = await openSec('Main Scanner');
  ok('Main: documents the ten-column shape', /Last Name/.test(main));

  const csv = await openSec('The CSV, column by column');
  ok('CSV: warns about columns blank in every row', /Apollo hides those on import/.test(csv));
  ok('CSV: states the CSP export is eight columns, Title and Employees absent',
     /not written at all/.test(csv) && /not in the source/.test(csv), csv.slice(0, 200));
  ok('CSV: gives the CSP spreadsheet letters, Notes last',
     /Company Name is D/.test(csv) && /G and H/.test(csv), csv.slice(0, 200));
  ok('CSV: documents the Company Name recovery chain',
     /Company Name is recovered/.test(csv) && /email domain/.test(csv), csv.slice(0, 200));
  ok('CSV: documents the mangled-phone rule', /5\.25549E\+11/.test(csv));

  const cap = await openSec('Capacity and storage');
  ok('Capacity: gives measured numbers', /9,265/.test(cap) && /2\.3 s/.test(cap));
  ok('Capacity: says what is stored and what is not', /never the\s+rows/.test(cap.replace(/\s+/g, ' ')) || /never the rows/.test(cap.replace(/\s+/g, ' ')));

  const lim = await openSec('Known limits');
  ok('Limits: admits the wants-a-partner over-fire', /over-fires/i.test(lim));
  ok('Limits: says Title and employee count are not exported by CSP', /Title and employee count are not exported/i.test(lim));

  ok('no page errors', errs.length === 0, errs.join(' | '));
  console.log(`\n${pass}/${pass + fail} checks passed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
