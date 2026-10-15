// Committed regression suite. Run via `npm run suites` or standalone with
// `BASE=http://localhost:4173 xvfb-run -a node <this file>`.
//
// Two post-scan controls: the combined "All Strong Signal" download that
// sits alongside the two product-line files, and filing a batch into any
// existing Lead Library folder or a new one named on the spot.
const BASE = process.env.BASE || 'http://localhost:4173';
const EXE = process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { chromium } = require('playwright');
const P=BASE; let pass=0,fail=0;
const ok=(n,c,d='')=>{c?(pass++,console.log('  PASS',n)):(fail++,console.log('  FAIL',n,d));};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const num = t => { const m=/(\d[\d,]*)\s*$/.exec(t.trim()); return m?Number(m[1].replace(/,/g,'')):null; };

const HEAD='First Name,Last Name,Title,Company,Email,Phone,Comments';
const rows=[
 'Ada,Brant,IT Director,Northwind Freight,ada@northwindfreight.com,(312) 555-0101,"Dynamics 365 Business Central for 40 users, looking for an implementation partner"',
 'Eve,Frost,IT Manager,Frost Dental,eve@frostdental.com,(415) 555-0105,"Migrating from Google Workspace to Microsoft 365 with an MSP"',
 'Ivy,Jones,Manager,Jones Realty,ivy@jonesrealty.com,(602) 555-0109,"They mentioned Dynamics 365 once"',
];
const csv=[HEAD,...rows].join('\n');

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
 await page.click('.side-nav-btn:has-text("Scanner")'); await sleep(400); await unlockScanner();
 await page.setInputFiles('input[type=file]',{name:'dl.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
 await sleep(2200);

 // --- combined download sits alongside the two product-line files ---
 const strip = page.locator('.dl-strip');
 const t = await strip.innerText();
 ok('Dynamics download present', /Dynamics/.test(t), t);
 ok('M365 / Azure download present', /M365 ?\/ ?Azure/.test(t), t);
 ok('combined download present', /All Strong Signal/.test(t), t);

 const counts = await strip.locator('.dl-count').allInnerTexts();
 ok('three download buttons', counts.length === 3, counts.join(','));
 const [dyn, m365, all] = counts.map(c => Number(c.replace(/[^\d]/g,'')));
 ok('combined count equals the two product lines summed', all === dyn + m365, `${dyn}+${m365} != ${all}`);
 ok('combined is not a third bucket', all === 2, `expected the 2 Strong Signal leads, got ${all}`);

 // Per Jack: "File Strong Signal leads into … Save to Lead Library — remove
 // this on the scanner page". Every scanned row is already stored in All
 // leads, so the post-scan filing row is gone from the Scanner.
 ok('the Lead Library filing row is gone from the Scanner',
    await page.locator('select[aria-label="Lead Library folder"]').count() === 0
    && await page.locator('button:has-text("Save to Lead Library")').count() === 0);

 ok('no page errors', errs.length===0, errs.slice(0,2).join(' | '));
 console.log(`\n${pass}/${pass+fail} passed`);
 await b.close(); process.exit(fail?1:0);
})();
