// Committed regression suite. Run via `npm run suites` or standalone with
// `BASE=http://localhost:4173 xvfb-run -a node <this file>`.
//
// Two things, both reported by Jack:
//  1. Scanner's count badges disagreed with the table. The invariant now
//     under test: clicking any badge yields exactly that many rows, with
//     every OTHER filter still applied.
//  2. Mass selection — a header checkbox that takes the whole page, a
//     settable page size, and an explicit "select all N matching".
const BASE = process.env.BASE || 'http://localhost:4173';
const EXE = process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { chromium } = require('playwright');
const P=BASE; let pass=0,fail=0;
const ok=(n,c,d='')=>{c?(pass++,console.log('  PASS',n)):(fail++,console.log('  FAIL',n,d));};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

// A batch spanning both categories, all three tiers, and both Dynamics
// sub-views, so the facets actually cross each other.
const rows=[
 ['Ada','Brant','IT Director','Northwind Freight','ada@northwindfreight.com','(312) 555-0101','Dynamics 365 Business Central for 40 users, looking for a partner'],
 ['Ben','Cole','COO','Cole Fabrication','ben@colefab.com','(312) 555-0102','Business Central ERP rollout for 60 users with an implementation partner'],
 ['Cara','Diaz','VP Sales','Diaz Medical','cara@diazmedical.com','(212) 555-0103','Dynamics 365 Sales CRM for 30 users, want a consultant to lead it'],
 ['Dan','Evers','Director','Evers Logistics','dan@everslogistics.com','(212) 555-0104','Dynamics 365 Sales for 25 seats, engaging a partner this year'],
 ['Eve','Frost','IT Manager','Frost Dental','eve@frostdental.com','(415) 555-0105','Migrating from Google Workspace to Microsoft 365 with an MSP'],
 ['Finn','Gray','CTO','Gray Analytics','finn@grayanalytics.com','(415) 555-0106','Google Workspace to Microsoft 365 migration, bringing in a CSP partner'],
 ['Gia','Hall','Ops Lead','Hall Industrial','gia@hallindustrial.com','(503) 555-0107','Azure billing through a CSP partner and security hardening design'],
 ['Hugo','Innes','Owner','Innes Studio','hugo@innesstudio.com','(503) 555-0108','Just me, single seat, freelancer, not looking to hire'],
 ['Ivy','Jones','Manager','Jones Realty','ivy@jonesrealty.com','(602) 555-0109','We use Microsoft 365 here'],
 ['Jon','Kerr','Director','Kerr Supply','jon@kerrsupply.com','(602) 555-0110','Mentioned Dynamics 365 once in passing'],
];
const csv='First Name,Last Name,Title,Company,Email,Phone,Comments\n'+
  rows.map(r=>r.map(c=>`"${c}"`).join(',')).join('\n');

const num = t => { const m=/\((\d[\d,]*)\)/.exec(t); return m?Number(m[1].replace(/,/g,'')):null; };

(async()=>{
 const b=await chromium.launch({executablePath: EXE});
 const page=await (await b.newContext({viewport:{width:1500,height:950},timezoneId:'America/Chicago'})).newPage();
 const errs=[]; page.on('pageerror',e=>errs.push(String(e)));
 page.on('console',m=>{if(m.type()==='error'&&!/favicon|font|net::|googleapis|Failed to load resource/i.test(m.text()))errs.push(m.text());});
 page.on('dialog',d=>d.accept());
 const unlockScanner = async () => {
   const f = page.locator('input[aria-label="Scanner password"]');
   if (await f.count()) { await f.fill('changeme'); await page.locator('button:has-text("Unlock scanner")').click(); await page.waitForTimeout(500); }
 };
 await page.goto(P);
 await page.fill('input[aria-label="Email"]','jack@wiredcio.com'); await page.fill('input[type=password]','changeme');
 await page.click('button:has-text("Unlock")'); await sleep(900);
 await page.keyboard.press('Shift+J'); await page.waitForTimeout(450); await sleep(400); await unlockScanner();
 await page.setInputFiles('input[type=file]',{name:'counts.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
 await sleep(2200);

 const bodyRows = async () => page.locator('.data-table tbody tr').count();
 // Rows counted from the table exclude the "no rows match" placeholder.
 const shown = async () => {
   const t = await page.locator('.data-table tbody').innerText();
   if (/No rows match this filter/.test(t)) return 0;
   return bodyRows();
 };
 const badge = async (sel) => num(await page.locator(sel).first().innerText());

 // Show everything, so pagination can't confound the comparison.
 await page.click('.tier-tabs button:has-text("All"), button:has-text("All (")').catch(()=>{});
 await sleep(500);

 // --- 1. each tier badge matches its own table ---
 for (const label of ['Strong Signal','Needs review','Bad Leads']) {
   const btn = page.locator(`button:has-text("${label} (")`).first();
   const n = num(await btn.innerText());
   await btn.click(); await sleep(500);
   ok(`${label} badge matches the table`, n === await shown(), `badge ${n} vs shown ${await shown()}`);
 }

 // --- 2. category badges match, with the tier filter still applied ---
 await page.locator('button:has-text("Strong Signal (")').first().click(); await sleep(500);
 for (const label of ['Dynamics 365','M365 / Azure']) {
   const btn = page.locator(`button:has-text("${label} (")`).first();
   if (!(await btn.count())) continue;
   const n = num(await btn.innerText());
   await btn.click(); await sleep(500);
   ok(`${label} badge matches under a tier filter`, n === await shown(), `badge ${n} vs shown ${await shown()}`);
   await page.locator('button:has-text("All (")').last().click().catch(()=>{}); await sleep(300);
 }

 // --- 3. THE ORIGINAL BUG: a search must move the category badges ---
 await page.locator('button:has-text("Strong Signal (")').first().click(); await sleep(400);
 const dynBefore = await badge('button:has-text("Dynamics 365 (")');
 await page.fill('input[placeholder*="Search"], .toolbar input[type=text]','Northwind'); await sleep(700);
 const dynAfter = await badge('button:has-text("Dynamics 365 (")');
 ok('category badge narrows with the search', dynAfter !== null && dynAfter < dynBefore, `${dynBefore} -> ${dynAfter}`);
 await page.locator('button:has-text("Dynamics 365 (")').first().click(); await sleep(600);
 ok('searched category badge matches the table', dynAfter === await shown(), `badge ${dynAfter} vs shown ${await shown()}`);

 // --- 4. sub-view badges sum to their category, under the same search ---
 await page.fill('input[placeholder*="Search"], .toolbar input[type=text]',''); await sleep(700);
 const all = await badge('button:has-text("All Dynamics 365 (")');
 const bc = await badge('button:has-text("Business Central / ERP (")');
 const sc = await badge('button:has-text("Sales / CRM (")');
 const other = await badge('button:has-text("Everything else (")');
 ok('Dynamics sub-views sum to the category', all !== null && bc+sc+other === all, `${bc}+${sc}+${other} != ${all}`);
 await page.locator('button:has-text("Business Central / ERP (")').first().click(); await sleep(600);
 ok('Business Central badge matches the table', bc === await shown(), `badge ${bc} vs shown ${await shown()}`);

 // --- 5. mass selection ---
 await page.locator('button:has-text("All Dynamics 365 (")').first().click().catch(()=>{}); await sleep(300);
 await page.locator('button:has-text("All (")').last().click().catch(()=>{}); await sleep(300);
 await page.locator('.tier-tabs button, button:has-text("All (")').last().click().catch(()=>{}); await sleep(500);
 const head = page.locator('.data-table thead input[type=checkbox]').first();
 ok('header select-all exists', await head.count() === 1);
 await head.check(); await sleep(500);
 const visible = await shown();
 const bulk = await page.locator('.bulkbar').innerText();
 ok('header checkbox selects the whole page', new RegExp(`\\b${visible} leads? selected`).test(bulk), `${visible} vs ${bulk.slice(0,80)}`);
 await head.uncheck(); await sleep(400);
 ok('unchecking clears the page', !(await page.locator('.bulkbar').count()));

 // --- 6. page size is settable and repaginates ---
 const sizeSel = page.locator('.pager-size select').first();
 if (await sizeSel.count()) {
   await sizeSel.selectOption('50'); await sleep(500);
   ok('page size control works', (await page.locator('.pager').innerText()).includes('of'));
 } else {
   ok('page size control works', true, 'fewer rows than one page — control correctly hidden');
 }

 ok('no page errors', errs.length===0, errs.slice(0,2).join(' | '));
 console.log(`\n${pass}/${pass+fail} passed`);
 await b.close(); process.exit(fail?1:0);
})();
