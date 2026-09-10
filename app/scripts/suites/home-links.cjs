// Committed regression suite. Run via `npm run suites` (starts one
// preview server and runs them all) or standalone with
// `BASE=http://localhost:4173 xvfb-run -a node <this file>`.
const BASE = process.env.BASE || 'http://localhost:4173';
const EXE = process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { chromium } = require('playwright');
let pass=0,fail=0;
const ok=(n,c,d='')=>{c?(pass++,console.log('  PASS',n)):(fail++,console.log('  FAIL',n,String(d).slice(0,220)));};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const b=await chromium.launch({executablePath: EXE});
 const page=await (await b.newContext({viewport:{width:1680,height:1000},timezoneId:'America/Chicago'})).newPage();
 const errs=[];page.on('pageerror',e=>errs.push(String(e)));
 page.on('console',m=>{if(m.type()==='error'&&!/favicon|font|net::|googleapis|Failed to load/i.test(m.text()))errs.push(m.text());});
 page.on('dialog',d=>d.accept());
 const unlockScanner = async () => {
   const f = page.locator('input[aria-label="Scanner password"]');
   if (await f.count()) { await f.fill('changeme'); await page.locator('button:has-text("Unlock scanner")').click(); await page.waitForTimeout(500); }
 };
 await page.goto(BASE);
 await page.fill('input[aria-label="Email"]','jack@wiredcio.com'); await page.fill('input[type=password]','changeme');
 await page.click('button:has-text("Unlock")'); await sleep(1000);
 const csv=`First Name,Last Name,Title,Company,Email,Phone,Comments
Dana,Whitfield,IT Director,Ridgeline Orthopedics,dana@ridgelineortho.com,(312) 555-0110,Looking at Dynamics 365 Business Central for 40 users and want a partner
Marcus,Lyle,CFO,Northbay Freight,marcus@northbayfreight.com,(415) 555-0144,Migrating from Google Workspace to Microsoft 365 and need a partner
Ruth,Okafor,Ops Lead,Kestrel Labs,ruth@kestrellabs.com,(212) 555-0190,Just asking about parking validation`;
 await page.click('.side-nav-btn:has-text("Scanner")'); await sleep(400); await unlockScanner();
 await page.setInputFiles('input[type=file]',{name:'s.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
 await sleep(2200);
 await page.click('.side-nav-btn:has-text("Home")'); await sleep(1000);

 let t = await page.locator('main').innerText();
 ok('lead mix is gone', !/lead mix/i.test(t), t.slice(0,300));
 ok('pipeline strip renders', /PIPELINE/.test(t) && /LEAD LIBRARY FILES/i.test(t));
 const tiles = await page.locator('.metric-link').count();
 ok('all 7 pipeline tiles are clickable', tiles===7, tiles);

 // Contacts tile
 await page.locator('.metric-link', {hasText:'CONTACTS'}).first().click(); await sleep(1100);
 t = await page.locator('main').innerText();
 ok('Contacts tile lands on Contacts', /Dana Whitfield/.test(t) && /Marcus Lyle/.test(t), t.slice(0,200));

 // Strong Signal tile -> filtered
 await page.click('.side-nav-btn:has-text("Home")'); await sleep(900);
 await page.locator('.metric-link', {hasText:'STRONG SIGNAL'}).first().click(); await sleep(1100);
 t = await page.locator('main').innerText();
 ok('Strong Signal tile applies the tier filter (chip shown)', /Strong Signal/.test(t) && await page.locator('.chip-row').count()>0, t.slice(0,300));
 ok('Strong Signal filter excludes the no-signal lead', !/Ruth Okafor/.test(t), t.slice(0,400));

 // Not worked yet tile
 await page.click('.side-nav-btn:has-text("Home")'); await sleep(900);
 await page.locator('.metric-link', {hasText:'NOT WORKED'}).first().click(); await sleep(1100);
 t = await page.locator('main').innerText();
 ok('Not worked yet tile applies its own chip', /Not worked yet/.test(t), t.slice(0,300));

 // Companies tile
 await page.click('.side-nav-btn:has-text("Home")'); await sleep(900);
 await page.locator('.metric-link', {hasText:'COMPANIES'}).first().click(); await sleep(1100);
 t = await page.locator('main').innerText();
 ok('Companies tile lands on Companies', /Ridgeline Orthopedics/.test(t) && /Import Apollo export/i.test(t), t.slice(0,200));

 // Uploads tile -> History
 await page.click('.side-nav-btn:has-text("Home")'); await sleep(900);
 await page.locator('.metric-link', {hasText:'UPLOADS'}).first().click(); await sleep(1000);
 ok('Uploads tile lands on History', /History/i.test(await page.locator('main').innerText()));

 // Lead library tile
 await page.click('.side-nav-btn:has-text("Home")'); await sleep(900);
 await page.locator('.metric-link', {hasText:'LEAD LIBRARY'}).first().click(); await sleep(1000);
 ok('Lead library tile lands on the Lead library', /Lead library/i.test(await page.locator('main').innerText()));

 // Needs you now: hot lead row click
 await page.click('.side-nav-btn:has-text("Home")'); await sleep(1000);
 const rows = await page.locator('.needs-row-open').count();
 ok('needs-you-now rows are clickable', rows>0, rows);
 await page.locator('.needs-row-open').first().click(); await sleep(1100);
 t = await page.locator('main').innerText();
 ok('clicking a hot lead opens that contact search', /Dana Whitfield|Marcus Lyle/.test(t), t.slice(0,250));

 ok('no page errors', errs.length===0, errs.join(' | '));
 console.log(`\n${pass}/${pass+fail} passed`);
 await b.close(); process.exit(fail?1:0);
})().catch(e=>{console.error('CRASH',e.message);process.exit(1);});
