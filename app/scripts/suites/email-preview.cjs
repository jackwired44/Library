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
Justin,Bartlett,Ops Manager,Legacy Labor,justin@legacylabor.com,(312) 555-0110,Business Central for 40 users and want a partner
Nora,Ellis,CFO,Harbor Dental,nora@harbordental.com,(415) 555-0144,Google Workspace to Microsoft 365 with a partner`;
 await page.click('.side-nav-btn:has-text("Scanner")'); await sleep(400); await unlockScanner();
 await page.setInputFiles('input[type=file]',{name:'p.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
 await sleep(2200);

 await page.click('.side-nav-btn:has-text("Sequences")'); await sleep(900);
 await page.click('button:has-text("Templates")'); await sleep(600);
 await page.locator('button:has-text("Use this")').first().click(); await sleep(1600);

 // add an email account so the envelope has a real From
 await page.click('button:has-text("Email accounts")'); await sleep(500);
 const lab = page.locator('input[placeholder="Label"]').last();
 if (await lab.count()) {
   await lab.fill('Wired CIO Outbound');
   const fn = page.locator('input[placeholder*="From name" i]').last();
   if (await fn.count()) await fn.fill('Jack at Wired CIO');
   const fe = page.locator('input[placeholder*="from" i][placeholder*="mail" i], input[type=email]').last();
   if (await fe.count()) await fe.fill('jack@wiredcio.com');
   const addBtn = page.locator('button:has-text("Add account"), button:has-text("Add")').last();
   if (await addBtn.count()) await addBtn.click();
   await sleep(800);
 }
 await page.click('button:has-text("Email accounts")').catch(()=>{}); await sleep(400);

 // open the AI prompt editor on the email step
 const cnt = await page.locator('button:has-text("Edit")').count();
 console.log('  Edit buttons (message steps only):', cnt);
 const rowText = await page.locator('div').filter({hasText:/Automatic email/}).first().innerText();
 ok('step row names the type once, no contradictory badges', /Automatic email/.test(rowText) && !/\bManual\b/.test(rowText.split('\n')[0]), rowText.split('\n').slice(0,3).join(' | '));
 // the automatic email step is the one carrying the AI body badge
 const emailRow = page.locator('div').filter({hasText:/Automatic email/}).locator('button:has-text("Edit")').first();
 await emailRow.click().catch(async()=>{ await page.locator('button:has-text("Edit")').first().click(); });
 await sleep(800);
 const opened = (await page.locator('.prompt-split').count()) > 0;
 ok('prompt editor opens as a split view', opened);
 // The left column is two panes now: the email, then its instructions.
 ok('left column opens on the email', await page.locator('.prompt-col input[aria-label="Subject line"]').count() === 1);
 await page.click('.seg-btn:has-text("AI instructions")'); await sleep(500);
 ok('left column holds both prompts', await page.locator('.prompt-col textarea').count() === 2, String(await page.locator('.prompt-col textarea').count()));
 await page.click('.seg-btn:has-text("Email")'); await sleep(400);
 ok('right column holds the preview', await page.locator('.prompt-split .preview-col').count() === 1);

 const previewText = await page.locator('.preview-col').innerText();
 console.log('  preview head:', previewText.replace(/\n/g,' | ').slice(0,300));
 ok('preview has a lead picker', await page.locator('select[aria-label="Preview lead"]').count() === 1);
 // The envelope is the mail card's header now — To / From / Subject.
 ok('preview shows the envelope', /\bTO\b/.test(previewText) && /\bFROM\b/.test(previewText) && /\bSUBJECT\b/.test(previewText), previewText.slice(0,200));
 ok('subject is merge-resolved', /Microsoft Solutions/.test(previewText));
 ok('preview names the picked lead in the To line', /Justin Bartlett|Nora Ellis/.test(previewText), previewText.slice(0,300));
 ok('sendability verdict is shown', /Would send|Would not send/.test(previewText));
 ok('AI step explains the body is generated at send time', /AI-written from its prompts|written per contact/i.test(previewText), previewText.slice(0,240));
 ok('offers to pull real Apollo examples', /Pull real examples from Apollo/.test(previewText));
 // The resolved prompts moved behind a disclosure under the preview, so
 // the panel opens on the EMAIL rather than on eighty lines of prompt.
 await page.click('button:has-text("Show the prompts as they would reach a model")'); await sleep(400);
 const resolved = await page.locator('.preview-col').innerText();
 ok('resolved prompts are shown', /system prompt — as sent/i.test(resolved) && /user prompt — as sent/i.test(resolved), resolved.slice(0,200));
 ok('system prompt is resolved, not raw tokens', /skilled conversationalist/i.test(resolved), resolved.slice(0,160));

 // switch lead and confirm the envelope follows
 await page.locator('select[aria-label="Preview lead"]').selectOption({index:1}); await sleep(700);
 const p2 = await page.locator('.preview-col').innerText();
 ok('switching lead changes the envelope', p2 !== previewText && /(Nora Ellis|Justin Bartlett)/.test(p2), p2.slice(0,200));

 ok('no page errors', errs.length===0, errs.join('|'));
 await page.screenshot({path:'/tmp/preview.png', fullPage:true});
 console.log(`\n${pass}/${pass+fail} passed`);
 await b.close(); process.exit(fail?1:0);
})().catch(e=>{console.error('CRASH',e.message);process.exit(1);});
