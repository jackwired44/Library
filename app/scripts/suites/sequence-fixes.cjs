// Committed regression suite. Run via `npm run suites` (starts one
// preview server and runs them all) or standalone with
// `BASE=http://localhost:4173 xvfb-run -a node <this file>`.
const BASE = process.env.BASE || 'http://localhost:4173';
const EXE = process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { chromium } = require('playwright');
let pass=0,fail=0;
const ok=(n,c,d='')=>{c?(pass++,console.log('  PASS',n)):(fail++,console.log('  FAIL',n,String(d).slice(0,280)));};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const b=await chromium.launch({executablePath: EXE});
 const page=await (await b.newContext({viewport:{width:1700,height:1050}})).newPage();
 const errs=[];page.on('pageerror',e=>errs.push(String(e)));
 page.on('console',m=>{if(m.type()==='error'&&!/favicon|font|net::|googleapis|Failed to load/i.test(m.text()))errs.push(m.text());});
 page.on('dialog',d=>d.accept());
 const unlockScanner = async () => {
   const f = page.locator('input[aria-label="Scanner password"]');
   if (await f.count()) { await f.fill('changeme'); await page.locator('button:has-text("Unlock scanner")').click(); await page.waitForTimeout(500); }
 };
 await page.goto(BASE);
 await page.fill('input[aria-label="Email"]','jack@wiredcio.com'); await page.fill('input[type=password]','changeme'); await page.click('button:has-text("Unlock")'); await sleep(1100);
 const csv=`First Name,Last Name,Title,Company,Email,Phone,Comments
Dana,Whitfield,IT Director,Ridgeline Orthopedics,dana@ridgelineortho.com,(312) 555-0110,Business Central for 40 users with a partner
Nora,Ellis,CFO,Harbor Dental,nora@harbordental.com,(415) 555-0144,Google Workspace to Microsoft 365 with a partner`;
 await page.keyboard.press('Control+Shift+S'); await page.waitForTimeout(450); await sleep(400); await unlockScanner();
 await page.setInputFiles('input[type=file]',{name:'f.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
 await sleep(2200);
 await page.click('.side-nav-btn:has-text("Sequences")'); await sleep(900);
 await page.click('button:has-text("Templates")'); await sleep(600);
 await page.locator('button:has-text("Use this")').first().click(); await sleep(1600);

 // FIX: header no longer claims only two outcomes end an enrollment
 // The seven-line intro was condensed to one line; the rest of the
 // disclosures moved behind "How sequences run here" rather than being
 // deleted. sequence-layout.cjs asserts each one survives.
 await page.click('button:has-text("How sequences run here")'); await sleep(400);
 const head = await page.locator('main').innerText();
 ok('states any reached-them outcome ends enrollment', /reached them/i.test(head) && !/Meeting booked or Not interested/.test(head), head.slice(0,300));

 // FIX #9: days stepper allows up to 182
 const num = page.locator('input[type=number]').first();
 const unit = page.locator('select').filter({hasText:'days'}).first();
 await unit.selectOption('days').catch(()=>{});
 ok('day stepper allows 182', await num.getAttribute('max') === '182', await num.getAttribute('max'));

 // Email step preview: draft renders, merged
 await page.locator('[data-step-channel="email"]').locator('button:has-text("Edit")').first().click(); await sleep(900);
 let prev = await page.locator('.preview-col').innerText();
 // The preview is a mail card now: To / From / Subject, then the body.
 // "Draft —" was the old label; what matters is that the message renders
 // rather than an empty-body placeholder.
 ok('the message renders, not "no body written"',
   /\bSUBJECT\b/.test(prev) && !/this step has no body written/i.test(prev), prev.slice(0,300));
 ok('draft is merged for the picked lead', /I'm Jack from Wired CIO/.test(prev) && /(Ridgeline Orthopedics|Harbor Dental)/.test(prev), prev.slice(prev.indexOf('Draft'), prev.indexOf('Draft')+320));
 const firstLead = /Dana/.test(prev) ? 'Dana' : 'Nora';
 await page.locator('select[aria-label="Preview lead"]').selectOption({index:1}); await sleep(800);
 const prev2 = await page.locator('.preview-col').innerText();
 ok('switching lead re-merges the draft', prev2 !== prev, prev2.slice(0,160));

 // FIX #3: LinkedIn step no longer claims "would not send"
 await page.locator('[data-step-channel="linkedin"]').locator('button:has-text("Edit"), button:has-text("Close")').first().click(); await sleep(900);
 prev = await page.locator('.preview-col').innerText();
 ok('LinkedIn preview shows its note, no email verdict', /Note — as it would send/i.test(prev) && !/Would not send/.test(prev), prev.slice(0,320));
 ok('LinkedIn note is merged', /Hey (Dana|Nora)/.test(prev), prev.slice(0,240));

 // FIX #4: copy keeps rules + Apollo link. onCopy auto-opens the copy.
 await page.locator('button:has-text("Copy")').first().click(); await sleep(1600);
 const all = await page.locator('main').innerText();
 ok('copy exists', /\(copy\)/.test(all));
 ok('copy keeps its sequence rules', /Sequence rules/.test(all), all.slice(all.indexOf('(copy)'), all.indexOf('(copy)')+300));
 ok('copy keeps the Apollo link', /Pull real examples from Apollo/.test(all) || !/isn.t linked to an Apollo sequence/.test(all));

 ok('no page errors', errs.length===0, errs.join('|'));
 console.log(`\n${pass}/${pass+fail} passed`);
 await b.close(); process.exit(fail?1:0);
})().catch(e=>{console.error('CRASH',e.message);process.exit(1);});
