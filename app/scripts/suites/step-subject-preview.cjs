// Committed regression suite. Run via `npm run suites`.
// Two things Jack asked for on the email step: the subject must be
// editable without opening anything, and the preview lead picker must
// search the WHOLE contact directory, not just what happens to be listed.
const BASE = process.env.BASE || 'http://localhost:4173';
const EXE = process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { chromium } = require('playwright');
let pass=0,fail=0;
const ok=(n,c,d='')=>{c?(pass++,console.log('  PASS',n)):(fail++,console.log('  FAIL',n,String(d).slice(0,240)));};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const b=await chromium.launch({executablePath:EXE});
 const page=await (await b.newContext({viewport:{width:1600,height:1300}})).newPage();
 const errs=[];page.on('pageerror',e=>errs.push(String(e)));
 page.on('console',m=>{if(m.type()==='error'&&!/favicon|font|net::|googleapis|Failed to load/i.test(m.text()))errs.push(m.text());});
 page.on('dialog',d=>d.accept());
 const unlockScanner = async () => {
   const f = page.locator('input[aria-label="Scanner password"]');
   if (await f.count()) { await f.fill('changeme'); await page.locator('button:has-text("Unlock scanner")').click(); await page.waitForTimeout(500); }
 };
 await page.goto(BASE);
 await page.fill('input[aria-label="Email"]','jack@wiredcio.com'); await page.fill('input[type=password]','changeme'); await page.click('button:has-text("Unlock")'); await sleep(1100);

 // A directory big enough that the picker must really search it.
 const names = [];
 for (let i=0;i<80;i++) names.push([`First${i}`,`Last${i}`,'Director',`Company ${i}`,`p${i}@co${i}.com`,'(312) 555-0100','Business Central for 40 users with a partner']);
 names.push(['Zephyra','Quillfeather','COO','Nimbus Rail','zephyra@nimbusrail.com','(415) 555-0199','Dynamics 365 Business Central with a partner']);
 const csv='First Name,Last Name,Title,Company,Email,Phone,Comments\n'+names.map(r=>r.join(',')).join('\n');
 await page.click('.side-nav-btn:has-text("Scanner")'); await sleep(400); await unlockScanner();
 await page.setInputFiles('input[type=file]',{name:'big.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
 await sleep(3500);

 await page.click('.side-nav-btn:has-text("Sequences")'); await sleep(900);
 await page.click('button:has-text("Templates")'); await sleep(600);
 await page.locator('button:has-text("Use this")').first().click(); await sleep(1700);

 // --- subject editable straight off the step row
 const subj = page.locator('[data-step-channel="email"] input[aria-label="Step subject"]').first();
 ok('the email step shows its subject on the row', await subj.count() === 1);
 ok('it carries the template subject', (await subj.inputValue()) === 'Microsoft Solutions', await subj.inputValue());
 await subj.fill('Dynamics for your team');
 await page.locator('main').click({position:{x:5,y:5}}); await sleep(800);
 await page.reload(); await sleep(1400);
 await page.fill('input[aria-label="Email"]','jack@wiredcio.com').catch(()=>{}); await page.fill('input[type=password]','changeme').catch(()=>{});
 await page.click('button:has-text("Unlock")').catch(()=>{}); await sleep(1200);
 await page.click('.side-nav-btn:has-text("Sequences")'); await sleep(1000);
 // A reload collapses the card; open it again before reading the row.
 await page.locator('main button', {hasText:'Dynamics Sequence'}).first().click(); await sleep(900);
 const again = page.locator('[data-step-channel="email"] input[aria-label="Step subject"]').first();
 ok('an edited subject persists through a reload', (await again.inputValue()) === 'Dynamics for your team', await again.inputValue());

 // --- the preview picker searches the whole directory
 await page.locator('[data-step-channel="email"]').locator('button:has-text("Edit")').first().click(); await sleep(1000);
 const count = await page.locator('.preview-col').innerText();
 ok('it says how much of the directory it is showing', /of 81 contacts|of 81 matches/.test(count.replace(/,/g,'')), count.slice(0,200));
 const opts = await page.locator('select[aria-label="Preview lead"] option').count();
 ok('the dropdown is capped rather than listing everyone', opts <= 50, String(opts));
 // Zephyra sorts nowhere near the top — only a real search finds her.
 const listedBefore = (await page.locator('select[aria-label="Preview lead"]').innerText()).includes('Zephyra');
 await page.locator('.preview-col input[placeholder*="Search all contacts"]').fill('Zephyra'); await sleep(700);
 const listedAfter = (await page.locator('select[aria-label="Preview lead"]').innerText()).includes('Zephyra');
 ok('a contact outside the first 50 is reachable by search', listedAfter, `before=${listedBefore} after=${listedAfter}`);
 const mail = await page.locator('.mail-card').innerText();
 ok('the preview switches to the searched contact', /Zephyra/.test(mail), mail.slice(0,160));
 ok('the subject shown is the edited one', /Dynamics for your team/.test(mail), mail.slice(0,200));
 // searching by company works too
 await page.locator('.preview-col input[placeholder*="Search all contacts"]').fill('nimbusrail.com'); await sleep(700);
 ok('search also matches on email domain', /Zephyra/.test(await page.locator('.mail-card').innerText()));

 ok('no page errors', errs.length===0, errs.join('|'));
 console.log(`\n${pass}/${pass+fail} passed`);
 await b.close(); process.exit(fail?1:0);
})().catch(e=>{console.error('CRASH',e.message);process.exit(1);});
