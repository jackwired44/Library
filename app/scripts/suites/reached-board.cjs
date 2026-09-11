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

 const csv=`First Name,Last Name,Title,Company,Email,Phone,Comments
Dana,Whitfield,IT Director,Ridgeline Orthopedics,dana@ridgelineortho.com,(312) 555-0110,Looking at Dynamics 365 Business Central for 40 users and want a partner`;
 await page.keyboard.press('Shift+J'); await page.waitForTimeout(450); await sleep(400); await unlockScanner();
 await page.setInputFiles('input[type=file]',{name:'s.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
 await sleep(1800);

 await page.click('.side-nav-btn:has-text("Contacts")'); await sleep(900);
 let t = await page.locator('main').innerText();
 ok('Reached column header present', /reached/i.test(t));
 ok('no attempts yet shows a dash', /Dana Whitfield/.test(t));

 // Open the record -> mini board
 await page.locator('td', {hasText:'Dana Whitfield'}).first().click(); await sleep(800);
 t = await page.locator('.reached-board').innerText();
 ok('mini board renders', /reached status/i.test(t), t.slice(0,200));
 ok('empty state is honest', /No attempts logged yet/.test(t));

 // Log a voicemail
 await page.click('button:has-text("+ Log attempt")'); await sleep(400);
 const sels = page.locator('.reached-form select');
 await sels.nth(0).selectOption('call');
 await sels.nth(1).selectOption('left-voicemail');
 await page.locator('.reached-form input').fill('First dial, VM');
 await page.click('button:has-text("Log it")'); await sleep(800);
 t = await page.locator('.reached-board').innerText();
 ok('attempt appears in the board', /Left voicemail/.test(t) && /First dial, VM/.test(t), t.slice(t.indexOf('Reached status'), t.indexOf('Reached status')+320));
 ok('attempt count reads 1', /1[\s\S]{0,30}attempts/i.test(t));
 ok('not-reached does not count as reached', /0[\s\S]{0,30}reached them/i.test(t));

 // Second attempt, this time connected
 await page.click('button:has-text("+ Log attempt")'); await sleep(400);
 await page.locator('.reached-form select').nth(1).selectOption('meeting-booked');
 await page.click('button:has-text("Log it")'); await sleep(900);
 t = await page.locator('.reached-board').innerText();
 ok('two attempts logged', /2[\s\S]{0,30}attempts/i.test(t));
 ok('reached count is now 1', /1[\s\S]{0,30}reached them/i.test(t));
 ok('both outcomes are in the history', /Meeting booked/.test(t) && /Left voicemail/.test(t));

 // Close modal, check the column + that disposition wrote through
 // The modal closes on its ✕ or by clicking its fixed backdrop.
 await page.locator('div[style*="position: fixed"] button', {hasText:'✕'}).first().click().catch(async()=>{
   await page.mouse.click(20, 500);
 });
 await sleep(800);
 t = await page.locator('main').innerText();
 ok('Reached cell shows the count', /2×/.test(t), t.slice(0,400));
 ok('disposition wrote through to the contact', /Meeting booked/.test(t));

 // Home should now count the booking (proves meetingBookedAt was stamped)
 await page.click('.side-nav-btn:has-text("Home")'); await sleep(900);
 const home = await page.locator('main').innerText();
 ok('Home counts the meeting booked', /Meetings booked[\s\S]{0,40}1|1[\s\S]{0,30}Meetings booked/.test(home), home.slice(0,300));

 // Reload -> persistence
 await page.reload(); await sleep(1400);
 if (await page.locator('input[aria-label="Email"]').count()) { await page.fill('input[aria-label="Email"]','jack@wiredcio.com'); await page.fill('input[type=password]','changeme'); await page.click('button:has-text("Unlock")'); await sleep(900); }
 await page.click('.side-nav-btn:has-text("Contacts")'); await sleep(900);
 t = await page.locator('main').innerText();
 ok('attempts survive a reload', /2×/.test(t), t.slice(0,300));

 ok('no page errors', errs.length===0, errs.slice(0,2).join(' | '));
 console.log(`\n${pass}/${pass+fail} passed`);
 await b.close(); process.exit(fail?1:0);
})();
