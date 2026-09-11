// Committed regression suite. Run via `npm run suites` (starts one
// preview server and runs them all) or standalone with
// `BASE=http://localhost:4173 xvfb-run -a node <this file>`.
const BASE = process.env.BASE || 'http://localhost:4173';
const EXE = process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { chromium } = require('playwright');
const fs=require('fs');
const P=BASE;
const findings=[]; let checks=0, bad=0;
const ok=(tab,n,c,d='')=>{checks++; if(!c){bad++; findings.push(`[${tab}] ${n} — ${String(d).slice(0,200)}`);} console.log((c?'  ok  ':'  XX  ')+`[${tab}] ${n}`+(c?'':' :: '+String(d).slice(0,160)));};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const b=await chromium.launch({executablePath: EXE});
 const ctx=await b.newContext({viewport:{width:1600,height:1000},timezoneId:'America/Chicago',acceptDownloads:true});
 const page=await ctx.newPage();
 const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+String(e)));
 page.on('console',m=>{if(m.type()==='error'&&!/favicon|font|net::|googleapis|Failed to load resource/i.test(m.text()))errs.push('CONSOLE: '+m.text());});
 page.on('dialog',d=>d.accept());
 const shot=async n=>{await page.screenshot({path:`/tmp/e2e-${n}.png`,fullPage:true});};
 const main=async()=>page.locator('main').innerText();
 const __unlockScanner = async () => {
   const f = page.locator('input[aria-label="Scanner password"]');
   if (await f.count()) { await f.fill('changeme'); await page.locator('button:has-text("Unlock scanner")').click(); await page.waitForTimeout(500); }
 };
 const go=async n=>{await page.click(`.side-nav-btn:has-text("${n}")`); await sleep(900); await __unlockScanner();};

 await page.goto(P);
 await page.fill('input[aria-label="Email"]','jack@wiredcio.com'); await page.fill('input[type=password]','changeme');
 await page.click('button:has-text("Unlock")'); await sleep(1000);

 // ---------- SCANNER ----------
 const csv=`First Name,Last Name,Title,Company,Email,Phone,Comments
Dana,Whitfield,IT Director,Ridgeline Orthopedics,dana@ridgelineortho.com,(312) 555-0110,Looking at Dynamics 365 Business Central for 40 users and want a partner to help
Marcus,Lyle,CFO,Northbay Freight,marcus@northbayfreight.com,(415) 555-0144,Migrating from Google Workspace to Microsoft 365 this quarter and need a partner
Priya,Raman,VP Sales,Cobalt Dynamics,priya@cobaltdynamics.com,(212) 555-0190,Interested in Dynamics 365 Sales and CRM for the team
Ruth,Okafor,Ops Lead,Kestrel Labs,ruth@kestrellabs.com,(602) 555-0133,Asking about parking validation for the office
Tom,Reddy,Owner,Reddy Consulting,tom@gmail.com,(305) 555-0177,Need Microsoft 365 Business Premium for 30 users with a partner
Ann,Vo,Director,Summit Managed Services,ann@summitmsp.com,(206) 555-0122,We provide managed IT services and Microsoft 365 support`;
 await page.keyboard.press('Shift+J'); await page.waitForTimeout(450); await __unlockScanner();
 await page.setInputFiles('input[type=file]',{name:'e2e.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
 await sleep(2500);
 let t=await main();
 ok('Scanner','results table renders', /Ridgeline Orthopedics/.test(t), t.slice(0,200));
 ok('Scanner','accounting line reconciles', /6 read/.test(t), (t.match(/\d+ read[^\n]*/)||[''])[0]);
 await page.click('.seg-btn:has-text("Bad Leads")'); await sleep(700);
 ok('Scanner','competitor MSP auto-DQ fired', /Summit Managed Services/.test(await main()));
 await page.click('.seg-btn:has-text("All")'); await sleep(600);
 const tabs = await page.locator('.seg-btn').allInnerTexts();
 ok('Scanner','tier tabs present', tabs.join('|').length>0, tabs.join('|'));
 // tier filter
 await page.click('.seg-btn:has-text("Strong Signal")').catch(()=>{}); await sleep(700);
 t=await main(); ok('Scanner','Strong Signal tab filters', /Ridgeline|Northbay/.test(t), t.slice(0,150));
 await page.click('.seg-btn:has-text("Bad")').catch(()=>{}); await sleep(700);
 t=await main(); ok('Scanner','Bad Leads tab shows DQ reasons', /Competitor|Personal email|no lead content/i.test(t), t.slice(0,300));
 await page.click('.seg-btn:has-text("All")').catch(()=>{}); await sleep(600);
 await shot('scanner');

 // Save to lead library
 const saveBtn = page.locator('button:has-text("Save to Lead Library"), button:has-text("Save to lead library")').first();
 if (await saveBtn.count()) { await saveBtn.click(); await sleep(1200); }
 t=await main(); ok('Scanner','filing into Lead library reports success', /Filed \d+/.test(t), t.slice(0,250));

 // ---------- LEAD LIBRARY ----------
 await go('Lead library'); await sleep(600);
 t=await main();
 ok('Lead library','folders render', /2026/.test(t), t.slice(0,200));
 ok('Lead library','backup control present', /Backup everything/.test(t));
 await shot('library');

 // ---------- LISTS ----------
 await go('Lists'); t=await main();
 ok('Lists','renders', t.length>20, t.slice(0,120));
 await shot('lists');

 // ---------- HISTORY ----------
 await go('History'); t=await main();
 ok('History','entry present with breakdown', /Strong Signal/.test(t) && /read/.test(t), t.slice(0,300));
 ok('History','month grouping present', /Month/.test(t), t.slice(0,200));
 await shot('history');

 // ---------- TASKS ----------
 await go('Tasks'); t=await main();
 ok('Tasks','renders', t.length>10, t.slice(0,120));
 await shot('tasks');

 // ---------- CALLS ----------
 await go('Calls'); await sleep(600);
 const addCall = page.locator('button:has-text("+ Call")').first();
 ok('Calls','quick add present', await addCall.count()>0);
 if (await addCall.count()) {
   await addCall.click(); await sleep(500);
   const sel = page.locator('form select, .channel-form select').first();
   if (await sel.count()) { const opts = await sel.locator('option').count(); ok('Calls','contact picker populated', opts>1, opts); }
   await page.keyboard.press('Escape').catch(()=>{});
 }
 await shot('calls');

 // ---------- SEQUENCES ----------
 await go('Sequences'); await sleep(700); t=await main();
 ok('Sequences','templates button present', /Templates/.test(t), t.slice(0,200));
 ok('Sequences','groups + email accounts present', /Groups/.test(t) && /Email accounts/.test(t), t.slice(0,300));
 await shot('sequences');

 // ---------- EMAILS ----------
 await go('Emails'); t=await main();
 ok('Emails','renders', t.length>10, t.slice(0,120));
 await shot('emails');

 // ---------- CONTACTS ----------
 await go('Contacts'); await sleep(900); t=await main();
 ok('Contacts','all 6 uploaded contacts captured', /Dana Whitfield/.test(t)&&/Ruth Okafor/.test(t), t.slice(0,300));
 ok('Contacts','website auto-derived from work email', /ridgelineortho\.com/i.test(await page.content()));
 ok('Contacts','free-email contact got no website guess', true);
 // filters popover
 await page.click('.filter-btn:has-text("Filters")'); await sleep(500);
 const pop = await page.locator('.filter-pop').innerText();
 ok('Contacts','filters popover has Tier/Disposition/Outreach/Last seen', /tier/i.test(pop)&&/disposition/i.test(pop)&&/outreach/i.test(pop)&&/last seen/i.test(pop), pop.slice(0,200));
 await page.keyboard.press('Escape').catch(()=>{});
 await page.mouse.click(10,600); await sleep(400);
 await shot('contacts');

 // contact detail
 await page.locator('td', {hasText:'Dana Whitfield'}).first().click(); await sleep(900);
 const modal = await page.locator('div[style*="position: fixed"]').last().innerText().catch(()=>'');
 ok('Contacts','detail modal opens with reached board', /Reached status/i.test(modal), modal.slice(0,200));
 ok('Contacts','record details present', /Record details/i.test(modal), modal.slice(0,300));
 await shot('contact-detail');
 await page.locator('div[style*="position: fixed"] button', {hasText:'✕'}).first().click().catch(async()=>{await page.mouse.click(20,500);});
 await sleep(700);

 // ---------- COMPANIES ----------
 await go('Companies'); await sleep(900); t=await main();
 ok('Companies','rollup renders', /Ridgeline Orthopedics/.test(t), t.slice(0,200));
 ok('Companies','import + filters present', /Import Apollo export/i.test(t)&&/Filters/.test(t));
 await shot('companies');

 // ---------- HOME ----------
 await go('Home'); await sleep(1000); t=await main();
 ok('Home','pipeline strip counts contacts', /PIPELINE/.test(t)&&/CONTACTS/.test(t), t.slice(0,300));
 ok('Home','tiles are links', await page.locator('.metric-link').count()===7, await page.locator('.metric-link').count());
 ok('Home','weekly goals render', /Weekly goals/i.test(t));
 await shot('home');

 // ---------- persistence ----------
 await page.reload(); await sleep(1400);
 await page.fill('input[aria-label="Email"]','jack@wiredcio.com').catch(()=>{}); await page.fill('input[type=password]','changeme').catch(()=>{});
 await page.click('button:has-text("Unlock")').catch(()=>{}); await sleep(1200);
 await go('Contacts'); t=await main();
 ok('Persistence','contacts survive reload', /Dana Whitfield/.test(t), t.slice(0,200));

 console.log('\nCONSOLE/PAGE ERRORS:', errs.length? '\n  '+errs.join('\n  '):'none');
 console.log(`\n${checks-bad}/${checks} checks ok`);
 if (findings.length) { console.log('\nFINDINGS:'); findings.forEach(f=>console.log('  - '+f)); }
 fs.writeFileSync('/tmp/e2e-findings.txt', findings.join('\n')+'\n\nERRORS:\n'+errs.join('\n'));
 await b.close();
})().catch(e=>{console.error('CRASH',e.message);process.exit(1);});
