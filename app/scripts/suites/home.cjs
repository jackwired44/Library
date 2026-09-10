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
 const page=await (await b.newContext({timezoneId:'America/Chicago'})).newPage();
 const errs=[]; page.on('pageerror',e=>errs.push(String(e)));
 page.on('console',m=>{if(m.type()==='error'&&!/favicon|font|net::|googleapis|Failed to load resource/i.test(m.text()))errs.push(m.text());});
 page.on('dialog',d=>d.accept());
 const unlockScanner = async () => {
   const f = page.locator('input[aria-label="Scanner password"]');
   if (await f.count()) { await f.fill('changeme'); await page.locator('button:has-text("Unlock scanner")').click(); await page.waitForTimeout(500); }
 };
 await page.goto(P);
 await page.fill('input[aria-label="Email"]','jack@wiredcio.com'); await page.fill('input[type=password]','changeme');
 await page.click('button:has-text("Unlock")'); await sleep(700);

 const csv=`First Name,Last Name,Title,Company,Email,Phone,Comments
Dana,Whitfield,IT Director,Ridgeline Orthopedics,dana@ridgelineortho.com,(312) 555-0110,Looking at Dynamics 365 Business Central for 40 users this year and want a partner
Marcus,Ely,COO,Cedar Freight,marcus@cedarfreight.com,(415) 555-0144,We need a CSP partner to handle our Azure billing and a full migration off on-prem
Priya,Raman,Office Manager,Tiny Dental,priya@tinydental.com,(212) 555-0199,Just checking in about our invoice`;
 await page.click('.side-nav-btn:has-text("Scanner")'); await sleep(300); await unlockScanner();
 await page.setInputFiles('input[type=file]',{name:'seed.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
 await sleep(1600);

 await page.click('.side-nav-btn:has-text("Home")'); await sleep(900);
 let t = await page.locator('main').innerText();
 ok('Hot leads block appears', /hot lead/i.test(t), t.slice(0,300));
 ok('Hot leads counts the 2 Strong Signal leads', /2 hot leads/i.test(t), (t.match(/\d+ hot leads?/i)||[''])[0]);
 ok('Hot lead shows "Not worked yet"', /Not worked yet/.test(t));
 ok('Weak lead is NOT hot', !/Tiny Dental/.test(t), 'Tiny Dental leaked in');
 ok('Definition stated on screen', /never been called or emailed/i.test(t));
 ok('Day/Week toggle present', await page.locator('.seg-btn:has-text("Day")').count()>0 && await page.locator('.seg-btn:has-text("Week")').count()>0);

 await page.click('.side-nav-btn:has-text("Calls")'); await sleep(700);
 await page.click('button:has-text("+ Call")'); await sleep(500);
 const d=new Date(); d.setDate(d.getDate()+3);
 const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
 const form = page.locator('main').filter({hasText:'New call task'});
 await page.locator('main select').filter({hasText:'Choose a contact'}).first().selectOption({index:1});
 await page.locator('main input[type=date]').first().fill(key);
 const noteIn = page.locator('main input[type=text]').last();
 await noteIn.fill('Later-this-week dial').catch(()=>{});
 await page.locator('main button').filter({hasText:/^Add$/}).last().click(); await sleep(900);
 const callsTxt = await page.locator('main').innerText();
 ok('Future call task created', /1 open call task/.test(callsTxt) && /Dana Whitfield/.test(callsTxt), callsTxt.slice(0,250));

 await page.click('.side-nav-btn:has-text("Home")'); await sleep(900);
 t = await page.locator('main').innerText();
 const dayBlock = t.includes('due today') ? t.slice(t.indexOf('due today'), t.indexOf('due today')+400) : '';
 ok('Day scope hides a task due later this week', !/Call Dana Whitfield/.test(dayBlock), dayBlock.slice(0,200));
 await page.click('.seg-btn:has-text("Week")'); await sleep(500);
 t = await page.locator('main').innerText();
 const weekBlock = t.includes('due this week') ? t.slice(t.indexOf('due this week'), t.indexOf('due this week')+400) : '';
 ok('Week scope shows the future task', /Dana Whitfield/.test(weekBlock), weekBlock.slice(0,300));
 ok('Week row shows which day it is due', /in \d+d\b/i.test(weekBlock), weekBlock.slice(0,300));
 ok('Week block relabels', /due this week/i.test(t));

 await page.click('.side-nav-btn:has-text("Scanner")'); await sleep(700); await unlockScanner();
 const row = page.locator('.data-table tbody tr', {hasText:'Cedar Freight'}).first();
 await row.locator('select').nth(1).selectOption('call-back-scheduled'); await sleep(800);
 await page.click('.side-nav-btn:has-text("Home")'); await sleep(900);
 t = await page.locator('main').innerText();
 ok('Call backs block appears', /call back(s)? to make/i.test(t), t.slice(0,250));
 ok('Call back names the contact', /Marcus Ely/.test(t));
 ok('Call-back lead left the hot list', /1 hot lead\b/.test(t), (t.match(/\d+ hot leads?/i)||[''])[0]);

 await page.reload(); await sleep(1300);
 if (await page.locator('input[aria-label="Email"]').count()) { await page.fill('input[aria-label="Email"]','jack@wiredcio.com'); await page.fill('input[type=password]','changeme'); await page.click('button:has-text("Unlock")'); await sleep(800); }
 t = await page.locator('main').innerText();
 ok('Survives reload', /call back/i.test(t) && /hot lead/i.test(t));
 ok('No page errors', errs.length===0, errs.slice(0,2).join(' | '));
 console.log(`\n${pass}/${pass+fail} checks passed`);
 await b.close(); process.exit(fail?1:0);
})();
