// Committed regression suite. Run via `npm run suites` (starts one
// preview server and runs them all) or standalone with
// `BASE=http://localhost:4173 xvfb-run -a node <this file>`.
//
// The sidebar time-zone lock: pick a zone and pin it, so travelling (or
// working another region's hours) doesn't silently move what "you" means
// across the whole app. The browser here is pinned to America/Chicago,
// so an unlocked run must read Central and a lock to New York must move
// both this clock AND a contact's "from you" offset.
const BASE = process.env.BASE || 'http://localhost:4173';
const EXE = process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { chromium } = require('playwright');
const P=BASE; let pass=0,fail=0;
const ok=(n,c,d='')=>{c?(pass++,console.log('  PASS',n)):(fail++,console.log('  FAIL',n,d));};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const b=await chromium.launch({executablePath: EXE});
 const ctx=await b.newContext({viewport:{width:1500,height:950},timezoneId:'America/Chicago'});
 const page=await ctx.newPage();
 const errs=[]; page.on('pageerror',e=>errs.push(String(e)));
 page.on('console',m=>{if(m.type()==='error'&&!/favicon|font|net::|googleapis|Failed to load resource/i.test(m.text()))errs.push(m.text());});
 page.on('dialog',d=>d.accept());
 await page.goto(P);
 await page.fill('input[type=password]','changeme');
 await page.click('button:has-text("Unlock")'); await sleep(900);

 // A contact with a 212 (Eastern) number, so "from you" has something to move.
 const csv=`First Name,Last Name,Title,Company,Email,Phone,Comments
Marcus,Ellery,IT Director,Ellery Freight,marcus@elleryfreight.com,(212) 555-0144,Wants Dynamics 365 Business Central for 40 users with a partner`;
 await page.click('.side-nav-btn:has-text("Scanner")'); await sleep(400);
 await page.setInputFiles('input[type=file]',{name:'tz.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
 await sleep(1800);

 // --- unlocked: follows the device (Chicago) ---
 let t = await page.locator('.tz-lock').innerText();
 ok('lock control renders', t.length>0, t);
 ok('unlocked says it follows the device', /Follows this device/i.test(t), t);
 ok('unlocked clock reads Central', /C[DS]T/.test(t), t);

 // A contact in Eastern is +1h from a Central rep.
 await page.click('.side-nav-btn:has-text("Contacts")'); await sleep(900);
 await page.locator('td', {hasText:'Marcus Ellery'}).first().click(); await sleep(800);
 let rec = await page.locator('body').innerText();
 ok('contact offset is +1h from a Central rep', /\+1h from you/.test(rec), (rec.match(/[-+\u2212]\d+h from you/)||[])[0]||'none');
 await page.locator('div[style*="position: fixed"] button', {hasText:'✕'}).first().click(); await sleep(500);

 // --- lock to Eastern ---
 await page.click('.tz-lock-btn'); await sleep(300);
 ok('picker opens', await page.locator('.tz-lock-select').isVisible());
 await page.selectOption('.tz-lock-select','America/New_York'); await sleep(600);
 t = await page.locator('.tz-lock').innerText();
 ok('lock now reads Locked', /Locked/.test(t), t);
 ok('locked clock reads Eastern', /E[DS]T/.test(t), t);

 // Same Eastern contact is now 0h from a locked-Eastern rep.
 await page.click('.side-nav-btn:has-text("Contacts")'); await sleep(700);
 await page.locator('td', {hasText:'Marcus Ellery'}).first().click(); await sleep(900);
 rec = await page.locator('body').innerText();
 ok('offset follows the lock, not the device', /same as you/i.test(rec), (rec.match(/(same as you|[-+\u2212]\d+h from you)/i)||[])[0]||'none');
 await page.locator('div[style*="position: fixed"] button', {hasText:'✕'}).first().click(); await sleep(500);

 // --- survives a reload ---
 await page.reload(); await sleep(1400);
 await page.fill('input[type=password]','changeme').catch(()=>{});
 await page.click('button:has-text("Unlock")').catch(()=>{}); await sleep(900);
 t = await page.locator('.tz-lock').innerText();
 ok('lock survives a reload', /Locked/.test(t) && /E[DS]T/.test(t), t);

 // --- unlock goes back to the device ---
 await page.click('.tz-lock-btn'); await sleep(300);
 await page.click('.tz-lock-clear'); await sleep(600);
 t = await page.locator('.tz-lock').innerText();
 ok('unlock returns to the device zone', /Follows this device/i.test(t) && /C[DS]T/.test(t), t);

 ok('no page errors', errs.length===0, errs.join(' | '));
 console.log(`\n${pass}/${pass+fail} passed`);
 await b.close();
 process.exit(fail?1:0);
})();
