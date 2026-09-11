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
 const unlockScanner = async () => {
   const f = page.locator('input[aria-label="Scanner password"]');
   if (await f.count()) { await f.fill('changeme'); await page.locator('button:has-text("Unlock scanner")').click(); await page.waitForTimeout(500); }
 };
 await page.goto(P);
 await page.fill('input[aria-label="Email"]','jack@wiredcio.com'); await page.fill('input[type=password]','changeme');
 await page.click('button:has-text("Unlock")'); await sleep(900);

 await page.click('.side-nav-btn:has-text("Lead library")'); await sleep(900);
 let t = await page.locator('main').innerText();
 const hasArchive = /April and Past 2026/.test(t);
 const stripped = t.replace(/April and Past 2026/g,'');
 const months=[...new Set(stripped.match(/(January|February|March|April|May|June|July|August|September|October|November|December) 20\d\d/g)||[])];
 ok('archive folder "April and Past 2026" present', hasArchive, t.slice(0,240));
 ok('no individual folder older than May 2026', !months.some(m=>/2025|January 2026|February 2026|March 2026|April 2026/.test(m)), months.join(","));
 ok('May 2026 present', months.includes('May 2026'), months.join(","));
 ok('current month present', months.includes('September 2026'), months.join(","));
 ok('exactly 5 dated month folders besides the archive', months.length===5, months.join(","));
 ok('subtitle reads from the constant', /filed by month from May 2026/.test(t), t.slice(0,220));
 ok('old subtitle prose gone', !/October 2025/.test(t) && !/Each holds up to 3 files/.test(t));

 // Filing must still work end to end after touching the load path.
 const csv=`First Name,Last Name,Title,Company,Email,Phone,Comments
Dana,Whitfield,IT Director,Ridgeline Orthopedics,dana@ridgelineortho.com,(312) 555-0110,Looking at Dynamics 365 Business Central for 40 users and want a partner`;
 await page.keyboard.press('Shift+J'); await page.waitForTimeout(450); await sleep(400); await unlockScanner();
 await page.setInputFiles('input[type=file]',{name:'seed.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
 await sleep(1800);
 const monthSel = page.locator('main select').first();
 const opts = await monthSel.locator('option').allInnerTexts().catch(()=>[]);
 ok('Scanner month picker offers the archive folder', opts.some(o=>/April and Past 2026/.test(o)), opts.join(","));
 ok('Scanner month picker offers no pre-May dated month', !opts.filter(o=>!/April and Past 2026/.test(o)).some(o=>/2025|January 2026|February 2026|March 2026|April 2026/.test(o)), opts.join(","));
 await page.locator('button:has-text("Save")').first().click(); await sleep(1400);
 t = await page.locator('main').innerText();
 ok('filing still succeeds', /Filed/i.test(t), t.slice(0,300));

 await page.click('.side-nav-btn:has-text("Lead library")'); await sleep(900);
 t = await page.locator('main').innerText();
 ok('filed lead landed in the current month', /September 2026[\s\S]{0,40}(1|2) of 3 files/.test(t), t.slice(t.indexOf('September 2026'), t.indexOf('September 2026')+80));

 // Reload: prune must be idempotent and must not resurrect anything.
 await page.reload(); await sleep(1400);
 if (await page.locator('input[aria-label="Email"]').count()) { await page.fill('input[aria-label="Email"]','jack@wiredcio.com'); await page.fill('input[type=password]','changeme'); await page.click('button:has-text("Unlock")'); await sleep(900); }
 await page.click('.side-nav-btn:has-text("Lead library")'); await sleep(900);
 t = await page.locator('main').innerText();
 const months2=[...new Set(t.replace(/April and Past 2026/g,'').match(/(January|February|March|April|May|June|July|August|September|October|November|December) 20\d\d/g)||[])];
 ok('after reload still exactly 5 dated months', months2.length===5, months2.join(","));
 ok('after reload the archive folder survived (never pruned/re-created)', /April and Past 2026/.test(t));
 ok('after reload the filed file survived', /September 2026[\s\S]{0,40}[12] of 3 files/.test(t));
 ok('no blocked-folder warning (nothing was stranded)', !/Kept \d+ older folder/.test(t), t.slice(0,200));

 // Month folders are now password-gated (Jack: "make the password for each
 // month folder 'wiredcio'"). The test build substitutes the placeholder
 // hash, so the suite unlocks with 'changeme'.
 await page.locator('text=September 2026').first().click(); await sleep(700);
 t = await page.locator('main').innerText();
 ok('opening a month folder asks for the password', /is locked/i.test(t), t.slice(0,240));
 const gate = page.locator('input[aria-label="Folder password"]');
 ok('the gate renders a password field', await gate.count()>0);
 await gate.fill('nope'); await page.locator('button:has-text("Unlock folder")').click(); await sleep(700);
 ok('a wrong password is refused', /Wrong password/i.test(await page.locator('main').innerText()));
 await gate.fill('changeme'); await page.locator('button:has-text("Unlock folder")').click(); await sleep(1000);
 t = await page.locator('main').innerText();
 ok('the right password opens the folder', /category file/i.test(t), t.slice(0,240));
 ok('a month folder offers no per-folder privacy toggle', !/make public/i.test(t) && !/Make private/i.test(t), t.slice(0,300));

 ok('no page errors', errs.length===0, errs.slice(0,2).join(' | '));
 console.log(`\n${pass}/${pass+fail} passed`);
 await b.close(); process.exit(fail?1:0);
})();
