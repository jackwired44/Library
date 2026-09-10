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
 await page.goto(P);
 await page.fill('input[aria-label="Email"]','jack@wiredcio.com'); await page.fill('input[type=password]','changeme'); await page.click('button:has-text("Unlock")'); await sleep(900);

 const csv=`First Name,Last Name,Title,Company,Email,Phone,Comments
Dana,Whitfield,IT Director,Ridgeline Orthopedics,dana@ridgelineortho.com,(312) 555-0110,Dynamics 365 Business Central for 40 users and want a partner`;
 await page.click('.side-nav-btn:has-text("Scanner")'); await sleep(400);
 await page.setInputFiles('input[type=file]',{name:'s.csv',mimeType:'text/csv',buffer:Buffer.from(csv)}); await sleep(1700);

 // Add a call task
 await page.click('.side-nav-btn:has-text("Calls")'); await sleep(800);
 await page.click('button:has-text("+ Call")'); await sleep(500);
 await page.locator('main select').filter({hasText:'Choose a contact'}).first().selectOption({index:1});
 const d=new Date(); const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
 await page.locator('main input[type=date]').first().fill(key);
 await page.locator('main button').filter({hasText:/^Add$/}).last().click(); await sleep(900);

 let t = await page.locator('main').innerText();
 ok('call task created', /Dana Whitfield/.test(t));
 ok('Log outcome control present', /Log outcome/.test(t), t.slice(0,300));

 // Log an outcome from the Calls tab
 await page.click('button:has-text("Log outcome")'); await sleep(400);
 await page.locator('main select').last().selectOption('left-voicemail'); await sleep(1000);
 t = await page.locator('main').innerText();
 ok('task auto-completed on logging', /Left voicemail/.test(t), t.slice(0,400));

 // Verify the attempt landed on the contact
 await page.click('.side-nav-btn:has-text("Contacts")'); await sleep(900);
 t = await page.locator('main').innerText();
 ok('Reached column shows the attempt', /1×/.test(t), t.slice(0,400));
 await page.locator('td', {hasText:'Dana Whitfield'}).first().click(); await sleep(800);
 const board = await page.locator('.reached-board').innerText();
 ok('mini board has the Calls-tab attempt', /Left voicemail/i.test(board), board.slice(0,300));
 ok('counted as 1 attempt', /1[\s\S]{0,30}attempts/i.test(board));
 ok('not counted as reached', /0[\s\S]{0,30}reached them/i.test(board));

 ok('no page errors', errs.length===0, errs.slice(0,2).join(' | '));
 console.log(`\n${pass}/${pass+fail} passed`);
 await b.close(); process.exit(fail?1:0);
})();
