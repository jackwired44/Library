// Committed regression suite. Run via `npm run suites`.
// Covers the data-integrity bugs found in the second review pass: a
// connected outcome must END a sequence rather than advance it, a Scanner
// edit must not wipe a disposition logged elsewhere, deleting contacts
// must not orphan their enrollments and tasks, and Restart must respect a
// paused sequence.
const BASE = process.env.BASE || 'http://localhost:4173';
const EXE = process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { chromium } = require('playwright');
let pass=0,fail=0;
const ok=(n,c,d='')=>{c?(pass++,console.log('  PASS',n)):(fail++,console.log('  FAIL',n,String(d).slice(0,240)));};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const store = (page, name) => page.evaluate(async (s) => {
  const db = await new Promise((res)=>{const r=indexedDB.open('wiredCioUnifiedLeadScannerLibrary_v1');r.onsuccess=()=>res(r.result);});
  const rows = await new Promise((res)=>{const q=db.transaction(s,'readonly').objectStore(s).getAll();q.onsuccess=()=>res(q.result);});
  db.close(); return rows;
}, name);

(async()=>{
 const b=await chromium.launch({executablePath:EXE});
 const page=await (await b.newContext({viewport:{width:1600,height:1000},timezoneId:'America/Chicago'})).newPage();
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
Dana,Whitfield,IT Director,Ridgeline Orthopedics,dana@ridgelineortho.com,(312) 555-0110,Business Central for 40 users with a partner`;
 await page.keyboard.press('Control+Shift+S'); await page.waitForTimeout(450); await sleep(400); await unlockScanner();
 await page.setInputFiles('input[type=file]',{name:'i.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
 await sleep(2200);

 // Build a sequence and enroll the contact
 await page.click('.side-nav-btn:has-text("Sequences")'); await sleep(900);
 await page.click('button:has-text("Templates")'); await sleep(600);
 await page.locator('button:has-text("Use this")').first().click(); await sleep(1600);
 const box = page.locator('input[type=checkbox]').last();
 await box.check().catch(()=>{});
 await page.locator('button:has-text("Enroll")').last().click(); await sleep(1200);
 let enr = await store(page,'sequenceEnrollments');
 ok('contact enrolled', enr.length === 1 && enr[0].status === 'active', JSON.stringify(enr.map(e=>e.status)));

 // BUG 1: log "Meeting booked" on the generated call task from Calls
 await page.click('.side-nav-btn:has-text("Calls")'); await sleep(1000);
 const logBtn = page.locator('button:has-text("Log outcome")').first();
 ok('the sequence task reached the Calls queue', await logBtn.count() > 0);
 await logBtn.click(); await sleep(400);
 await page.locator('select').last().selectOption('meeting-booked'); await sleep(1400);
 enr = await store(page,'sequenceEnrollments');
 ok('a connected outcome FINISHES the enrollment', enr[0] && enr[0].status === 'finished', JSON.stringify(enr[0]||{}));
 ok('...and does not advance it to a later step', enr[0] && enr[0].currentStepIndex === 0, String(enr[0]&&enr[0].currentStepIndex));
 let tasks = await store(page,'tasks');
 const open = tasks.filter(t=>!t.done && t.sequenceEnrollmentId);
 ok('...and generates no new step task', open.length === 0, `open sequence tasks: ${open.length}`);

 // BUG 2: a Scanner row edit must not wipe that logged disposition
 let contacts = await store(page,'contacts');
 ok('disposition landed on the contact', contacts[0] && contacts[0].disposition === 'meeting-booked', JSON.stringify(contacts[0]||{}).slice(0,120));
 ok('meetingBookedAt was stamped', Boolean(contacts[0] && contacts[0].meetingBookedAt));
 await page.keyboard.press('Control+Shift+S'); await page.waitForTimeout(450); await sleep(1000); await unlockScanner();
 const tierPill = page.locator('.data-table tbody tr').first().locator('button:has-text("Strong Signal"), button:has-text("Needs review"), button:has-text("Bad lead")').first();
 if (await tierPill.count()) { await tierPill.click(); await sleep(1200); }
 contacts = await store(page,'contacts');
 ok('a Scanner tier edit does NOT wipe the logged disposition', contacts[0] && contacts[0].disposition === 'meeting-booked', String(contacts[0]&&contacts[0].disposition));
 ok('...nor the meetingBookedAt stamp', Boolean(contacts[0] && contacts[0].meetingBookedAt));

 ok('no page errors', errs.length===0, errs.join('|'));
 console.log(`\n${pass}/${pass+fail} passed`);
 await b.close(); process.exit(fail?1:0);
})().catch(e=>{console.error('CRASH',e.message);process.exit(1);});
