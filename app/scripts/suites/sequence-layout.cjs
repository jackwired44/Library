// Committed regression suite. Run via `npm run suites`.
// The Sequences tab laid out the way Apollo's own sequence page is: a
// summary strip, a step TIMELINE with the wait as a rule between steps,
// numbered step cards carrying their own counts — and every honesty
// disclaimer still reachable after the intro paragraph was condensed.
const BASE = process.env.BASE || 'http://localhost:4173';
const EXE = process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { chromium } = require('playwright');
let pass=0,fail=0;
const ok=(n,c,d='')=>{c?(pass++,console.log('  PASS',n)):(fail++,console.log('  FAIL',n,String(d).slice(0,240)));};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const b=await chromium.launch({executablePath:EXE});
 const page=await (await b.newContext({viewport:{width:1500,height:1200}})).newPage();
 const errs=[];page.on('pageerror',e=>errs.push(String(e)));
 page.on('console',m=>{if(m.type()==='error'&&!/favicon|font|net::|googleapis|Failed to load/i.test(m.text()))errs.push(m.text());});
 page.on('dialog',d=>d.accept());
 await page.goto(BASE);
 await page.fill('input[type=password]','changeme'); await page.click('button:has-text("Unlock")'); await sleep(1100);
 const csv=`First Name,Last Name,Title,Company,Email,Phone,Comments
Dana,Whitfield,IT Director,Ridgeline Orthopedics,dana@ridgelineortho.com,(312) 555-0110,Business Central for 40 users with a partner`;
 await page.click('.side-nav-btn:has-text("Scanner")'); await sleep(400);
 await page.setInputFiles('input[type=file]',{name:'l.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
 await sleep(2200);
 await page.click('.side-nav-btn:has-text("Sequences")'); await sleep(900);

 // The intro is one line now, but every disclaimer survives one click away.
 const head = await page.locator('main').innerText();
 ok('the page opens with one honest line, not a paragraph',
   /generate a task you work by hand/.test(head) && !/SendGrid connection lands/.test(head), head.slice(0,300));
 await page.click('button:has-text("How sequences run here")'); await sleep(400);
 const how = await page.locator('main').innerText();
 ok('nothing-fires-on-its-own disclaimer survives', /nothing fires on its own/i.test(how));
 ok('email-accounts-not-a-live-connection disclaimer survives', /not a live connection/i.test(how));
 ok('enrollment-finish rule survives', /reached them/i.test(how));

 await page.click('button:has-text("Templates")'); await sleep(600);
 await page.locator('button:has-text("Use this")').first().click(); await sleep(1600);

 // Apollo-style structure
 ok('summary strip renders', await page.locator('.seq-summary .seq-stat').count() === 5, String(await page.locator('.seq-summary .seq-stat').count()));
 const steps = await page.locator('.seq-step').count();
 ok('every step is its own numbered card', steps === 5, String(steps));
 const nums = await page.locator('.seq-step-num').allInnerTexts();
 ok('steps are numbered in order', nums.join('|') === 'STEP 1|STEP 2|STEP 3|STEP 4|STEP 5', nums.join('|'));
 const waits = await page.locator('.seq-wait-text').allInnerTexts();
 console.log('  waits:', JSON.stringify(waits));
 ok('the wait is a rule BETWEEN steps, one per step', waits.length === 5, String(waits.length));
 ok('the first wait reads as an immediate start', /immediately/i.test(waits[0]), waits[0]);
 ok('a real gap reads as a wait', waits.some(w=>/^Wait /i.test(w)), waits.join('|'));

 // per-step counts appear once someone is enrolled
 await page.locator('label:has-text("Dana Whitfield") input[type=checkbox]').check();
 await page.locator('button:has-text("Enroll 1 contact")').click(); await sleep(1300);
 const counts = await page.locator('.seq-step-counts').allInnerTexts();
 ok('the step someone sits on reports it', counts.some(c=>/on this step/.test(c)), counts.join('|'));
 const summary = await page.locator('.seq-summary').innerText();
 ok('summary counts the enrollment', /ACTIVE\s*\n?\s*1/i.test(summary), summary.replace(/\n/g,' ').slice(0,140));

 ok('no page errors', errs.length===0, errs.join('|'));
 console.log(`\n${pass}/${pass+fail} passed`);
 await b.close(); process.exit(fail?1:0);
})().catch(e=>{console.error('CRASH',e.message);process.exit(1);});
