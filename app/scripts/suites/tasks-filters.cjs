// Committed regression suite. Run via `npm run suites` (starts one
// preview server and runs them all) or standalone with
// `BASE=http://localhost:4173 xvfb-run -a node <this file>`.
const BASE = process.env.BASE || 'http://localhost:4173';
const EXE = process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { chromium } = require('playwright');
let pass=0,fail=0;
const ok=(n,c,d='')=>{c?(pass++,console.log('  PASS',n)):(fail++,console.log('  FAIL',n,String(d).slice(0,260)));};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const b=await chromium.launch({executablePath: EXE});
 const page=await (await b.newContext({viewport:{width:1600,height:1000}})).newPage();
 const errs=[];page.on('pageerror',e=>errs.push(String(e)));
 page.on('console',m=>{if(m.type()==='error'&&!/favicon|font|net::|googleapis|Failed to load/i.test(m.text()))errs.push(m.text());});
 page.on('dialog',d=>d.accept());
 await page.goto(BASE);
 await page.fill('input[type=password]','changeme'); await page.click('button:has-text("Unlock")'); await sleep(1100);

 // seed contacts
 const csv=`First Name,Last Name,Title,Company,Email,Phone,Comments
Dana,Whitfield,IT Director,Ridgeline Orthopedics,dana@ridgelineortho.com,(312) 555-0110,Business Central for 40 users and want a partner
Marcus,Lyle,CFO,Northbay Freight,marcus@northbayfreight.com,(415) 555-0144,Google Workspace to Microsoft 365 migration with a partner`;
 await page.click('.side-nav-btn:has-text("Scanner")'); await sleep(400);
 await page.setInputFiles('input[type=file]',{name:'t.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
 await sleep(2200);

 // build a sequence from the template and enrol both contacts
 await page.click('.side-nav-btn:has-text("Sequences")'); await sleep(900);
 await page.click('button:has-text("Templates")'); await sleep(600);
 await page.locator('button:has-text("Use this")').first().click(); await sleep(1500);
 let t = await page.locator('main').innerText();
 ok('step cap and span are stated', /of 10 steps/.test(t) && /runs about/.test(t), t.slice(t.indexOf('of 10 steps')-60, t.indexOf('of 10 steps')+120));

 // day + time controls exist
 ok('preferred-day control present', await page.locator('select[aria-label="Preferred day"]').count()>0);
 ok('time control present', await page.locator('input[type=time]').count()>0);

 // add a step scheduled for Tuesdays at 09:30
 await page.locator('select[aria-label="Step type"]').first().selectOption('call'); await sleep(200);
 await page.locator('select[aria-label="Preferred day"]').first().selectOption('2');
 await page.locator('input[type=time]').first().fill('09:30');
 await page.locator('button:has-text("+ Add step")').first().click(); await sleep(900);
 t = await page.locator('main').innerText();
 ok('step shows its weekday', /Tuesdays/.test(t), t.slice(0,500));
 ok('step shows its time', /09:30/.test(t));

 // enrol contacts
 const boxes = page.locator('input[type=checkbox]');
 const n = await boxes.count();
 for (let i=0;i<Math.min(n,6);i++){ const bx=boxes.nth(i); if(await bx.isVisible().catch(()=>false)) await bx.check().catch(()=>{}); }
 const enrollBtn = page.locator('button:has-text("Enroll")').last();
 if (await enrollBtn.count()) { await enrollBtn.click(); await sleep(1200); }

 // Tasks: work filters
 await page.click('.side-nav-btn:has-text("Tasks")'); await sleep(1100);
 t = await page.locator('main').innerText();
 ok('Tasks explains it is the execution surface', /Where sequence work actually gets done/.test(t), t.slice(0,220));
 ok('Work filters button present', await page.locator('button:has-text("Work filters")').count()>0);
 await page.click('button:has-text("Work filters")'); await sleep(500);
 const pop = await page.locator('.filter-pop').innerText();
 console.log('  filter groups:', pop.replace(/\n/g,' | ').slice(0,220));
 ok('filters offer sequence, industry, size, location', /sequence/i.test(pop)&&/industry/i.test(pop)&&/size/i.test(pop)&&/location/i.test(pop), pop.slice(0,200));
 const seqSel = page.locator('.filter-pop select').first();
 const seqOpts = await seqSel.locator('option').allInnerTexts();
 ok('the built sequence is selectable', seqOpts.some(o=>/Dynamics/.test(o)), seqOpts.join('|'));
 await seqSel.selectOption({index:1}); await sleep(700);
 await page.mouse.click(10,700); await sleep(500);
 t = await page.locator('main').innerText();
 ok('selecting a sequence filters and shows a chip', /tasks shown/.test(t) && /Dynamics/.test(t), t.slice(0,300));

 ok('no page errors', errs.length===0, errs.join('|'));
 console.log(`\n${pass}/${pass+fail} passed`);
 await b.close(); process.exit(fail?1:0);
})().catch(e=>{console.error('CRASH',e.message);process.exit(1);});
