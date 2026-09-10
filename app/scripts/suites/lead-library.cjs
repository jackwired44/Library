// Committed regression suite. Run via `npm run suites` (starts one
// preview server and runs them all) or standalone with
// `BASE=http://localhost:4173 xvfb-run -a node <this file>`.
const BASE = process.env.BASE || 'http://localhost:4173';
const EXE = process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { chromium } = require('playwright');
const P=BASE; let pass=0,fail=0;
const ok=(n,c,d='')=>{c?(pass++,console.log('  PASS',n)):(fail++,console.log('  FAIL',n,d));};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const b=await chromium.launch({executablePath: EXE});
 const ctx=await b.newContext({viewport:{width:1440,height:900},timezoneId:'America/Chicago'});
 const page=await ctx.newPage();
 const errs=[]; page.on('pageerror',e=>errs.push(String(e)));
 page.on('console',m=>{if(m.type()==='error'&&!/favicon|font|net::|googleapis|Failed to load resource/i.test(m.text()))errs.push(m.text());});
 page.on('dialog',d=>d.accept());
 await page.goto(P);
 await page.fill('input[aria-label="Email"]','jack@wiredcio.com'); await page.fill('input[type=password]','changeme');
 await page.click('button:has-text("Unlock")'); await sleep(900);

 await page.click('.side-nav-btn:has-text("Lead library")'); await sleep(900);
 let t = await page.locator('main').innerText();
 const months=[...new Set(t.match(/(January|February|March|April|May|June|July|August|September|October|November|December) 20\d\d/g)||[])];
 ok('no folder older than May 2026', !months.some(m=>/2025|January 2026|February 2026|March 2026|April 2026/.test(m)), months.join(","));
 ok('May 2026 present', months.includes('May 2026'), months.join(","));
 ok('current month present', months.includes('September 2026'), months.join(","));
 ok('exactly 5 month folders', months.length===5, months.join(","));
 ok('subtitle reads from the constant', /filed by month from May 2026/.test(t), t.slice(0,220));
 ok('old subtitle prose gone', !/October 2025/.test(t) && !/Each holds up to 3 files/.test(t));

 // Filing must still work end to end after touching the load path.
 const csv=`First Name,Last Name,Title,Company,Email,Phone,Comments
Dana,Whitfield,IT Director,Ridgeline Orthopedics,dana@ridgelineortho.com,(312) 555-0110,Looking at Dynamics 365 Business Central for 40 users and want a partner`;
 await page.click('.side-nav-btn:has-text("Scanner")'); await sleep(400);
 await page.setInputFiles('input[type=file]',{name:'seed.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
 await sleep(1800);
 const monthSel = page.locator('main select').first();
 const opts = await monthSel.locator('option').allInnerTexts().catch(()=>[]);
 ok('Scanner month picker offers no pre-May month', !opts.some(o=>/2025|January 2026|February 2026|March 2026|April 2026/.test(o)), opts.join(","));
 await page.locator('button:has-text("Save")').first().click(); await sleep(1400);
 t = await page.locator('main').innerText();
 ok('filing still succeeds', /Filed/i.test(t), t.slice(0,300));

 await page.click('.side-nav-btn:has-text("Lead library")'); await sleep(900);
 t = await page.locator('main').innerText();
 ok('filed lead landed in the current month', /September 2026[\s\S]{0,40}(1|2) of 3 files/.test(t), t.slice(t.indexOf('September 2026'), t.indexOf('September 2026')+80));

 // Reload: prune must be idempotent and must not resurrect anything.
 await page.reload(); await sleep(1400);
 if (await page.locator('input[type=password]').count()) { await page.fill('input[aria-label="Email"]','jack@wiredcio.com'); await page.fill('input[type=password]','changeme'); await page.click('button:has-text("Unlock")'); await sleep(900); }
 await page.click('.side-nav-btn:has-text("Lead library")'); await sleep(900);
 t = await page.locator('main').innerText();
 const months2=[...new Set(t.match(/(January|February|March|April|May|June|July|August|September|October|November|December) 20\d\d/g)||[])];
 ok('after reload still exactly 5 months', months2.length===5, months2.join(","));
 ok('after reload the filed file survived', /September 2026[\s\S]{0,40}[12] of 3 files/.test(t));
 ok('no blocked-folder warning (nothing was stranded)', !/Kept \d+ older folder/.test(t), t.slice(0,200));

 ok('no page errors', errs.length===0, errs.slice(0,2).join(' | '));
 console.log(`\n${pass}/${pass+fail} passed`);
 await b.close(); process.exit(fail?1:0);
})();
