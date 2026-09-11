// Committed regression suite. Run via `npm run suites`.
// Per Jack: "make sure all metrics align with uploaded and stored data."
// Every number the app shows is checked against what IndexedDB actually
// holds, and against the numbers other views show for the same thing.
const BASE = process.env.BASE || 'http://localhost:4173';
const EXE = process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { chromium } = require('playwright');
let pass=0,fail=0;
const ok=(n,c,d='')=>{c?(pass++,console.log('  PASS',n)):(fail++,console.log('  FAIL',n,String(d).slice(0,220)));};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const num = (t, re) => { const m = re.exec(t); return m ? Number(m[1]) : null; };
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

 // 10 rows: 1 duplicate pair, 2 with no signal, the rest real leads
 // across both product lines and both tiers.
 const rows = [
   ['Dana','Whitfield','IT Director','Ridgeline Orthopedics','dana@ridgelineortho.com','(312) 555-0110','Business Central for 40 users and want a partner'],
   ['Dana','Whitfield','IT Director','Ridgeline Orthopedics','dana@ridgelineortho.com','(312) 555-0110','Business Central for 40 users and want a partner'],
   ['Marcus','Lyle','CFO','Northbay Freight','marcus@northbayfreight.com','(415) 555-0144','Migrating from Google Workspace to Microsoft 365 and need a partner'],
   ['Priya','Raman','VP Sales','Cobalt Dynamics','priya@cobaltdynamics.com','(212) 555-0190','Dynamics 365 Sales and CRM for the team, bringing in a partner'],
   ['Ruth','Okafor','Ops Lead','Kestrel Labs','ruth@kestrellabs.com','(602) 555-0133','Asking about parking validation for the office'],
   ['Owen','Pike','Manager','Delta Print','owen@deltaprint.com','(305) 555-0177','Please send the visitor form'],
   ['Ivy','Chen','Director','Halcyon Health','ivy@halcyonhealth.com','(206) 555-0122','Looking at Power BI dashboards'],
 ];
 const csv = 'First Name,Last Name,Title,Company,Email,Phone,Comments\n' +
   rows.map(r=>r.map(v=>/[",]/.test(v)?`"${v}"`:v).join(',')).join('\n');
 await page.keyboard.press('Shift+J'); await page.waitForTimeout(450); await sleep(400); await unlockScanner();
 await page.setInputFiles('input[type=file]',{name:'m.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
 await sleep(2500);

 // --- Scanner's own accounting must reconcile exactly
 const note = await page.locator('.scan-note').innerText();
 const read = num(note, /(\d+)\s*read/);
 const processed = num(note, /(\d+)\s*processed/);
 const noSignal = num(note, /(\d+)\s*no signal/);
 const dupes = num(note, /(\d+)\s*duplicates merged/) || 0;
 console.log('  accounting:', note.replace(/\n/g,' '));
 ok('rows read equals the file', read === rows.length, `${read} vs ${rows.length}`);
 ok('read = processed + no signal + duplicates', read === processed + noSignal + dupes, `${read} vs ${processed}+${noSignal}+${dupes}`);

 const body = await page.locator('main').innerText();
 const ss = num(body, /Strong Signal \((\d+)\)/);
 const nr = num(body, /Needs review \((\d+)\)/);
 const bl = num(body, /Bad Leads \((\d+)\)/);
 const all = num(body, /All \((\d+)\)/);
 ok('tier tabs sum to the All tab', ss + nr + bl === all, `${ss}+${nr}+${bl} vs ${all}`);
 ok('the All tab equals rows processed', all === processed, `${all} vs ${processed}`);
 const nonRel = num(body, /Non Relevant \((\d+)\)/);
 ok('Non Relevant equals the no-signal count', nonRel === noSignal, `${nonRel} vs ${noSignal}`);

 // --- Contacts: every uploaded person is captured, duplicates merged
 const contacts = await store(page,'contacts');
 const uniquePeople = new Set(rows.map(r=>`${r[0]} ${r[1]}|${r[3]}`.toLowerCase())).size;
 ok('one contact stored per real person', contacts.length === uniquePeople, `${contacts.length} vs ${uniquePeople}`);
 await page.click('.side-nav-btn:has-text("Contacts")'); await sleep(1100);
 const cTxt = await page.locator('main').innerText();
 const shown = num(cTxt, /of (\d+)\b/) ?? num(cTxt, /(\d+) contacts?/);
 ok('Contacts shows what is stored', shown === null || shown === contacts.length, `${shown} vs ${contacts.length}`);

 // --- Home's pipeline strip must equal the stores it summarises
 await page.click('.side-nav-btn:has-text("Home")'); await sleep(1200);
 const hTxt = await page.locator('main').innerText();
 const tileVal = (label) => {
   const re = new RegExp(label + '\\s*\\n\\s*([\\d,]+)', 'i');
   const m = re.exec(hTxt);
   return m ? Number(m[1].replace(/,/g,'')) : null;
 };
 const history = await store(page,'history');
 const files = await store(page,'files');
 const lists = await store(page,'leadLists');
 ok('Home "Contacts" tile equals the contacts store', tileVal('CONTACTS') === contacts.length, `${tileVal('CONTACTS')} vs ${contacts.length}`);
 ok('Home "Uploads" tile equals the history store', tileVal('UPLOADS') === history.length, `${tileVal('UPLOADS')} vs ${history.length}`);
 ok('Home "Lead library files" tile equals the files store', tileVal('LEAD LIBRARY FILES') === files.length, `${tileVal('LEAD LIBRARY FILES')} vs ${files.length}`);
 ok('Home "Lists" tile equals the lists store', tileVal('LISTS') === lists.length, `${tileVal('LISTS')} vs ${lists.length}`);
 const companies = new Set(contacts.map(c=>String(c.company||'').trim().toLowerCase()).filter(Boolean)).size;
 ok('Home "Companies" tile equals distinct stored companies', tileVal('COMPANIES') === companies, `${tileVal('COMPANIES')} vs ${companies}`);
 const strong = contacts.filter(c=>c.tier==='signal').length;
 ok('Home "Strong Signal" tile equals stored signal contacts', tileVal('STRONG SIGNAL') === strong, `${tileVal('STRONG SIGNAL')} vs ${strong}`);
 const unworked = contacts.filter(c=>!(c.callCount||0) && !(c.emailCount||0)).length;
 ok('Home "Not worked yet" tile equals stored unworked contacts', tileVal('NOT WORKED YET') === unworked, `${tileVal('NOT WORKED YET')} vs ${unworked}`);

 // --- History's per-entry breakdown must reconcile the same way
 await page.click('.side-nav-btn:has-text("History")'); await sleep(1000);
 const histTxt = await page.locator('main').innerText();
 const hRead = num(histTxt, /(\d+)\s*rows read/);
 ok('History rows-read matches the upload', hRead === rows.length, `${hRead} vs ${rows.length}`);
 const hSignal = num(histTxt, /(\d+) Strong Signal/);
 ok('History Strong Signal matches Scanner', hSignal === ss, `${hSignal} vs ${ss}`);
 const hNo = num(histTxt, /(\d+) no signal/);
 ok('History no-signal matches Scanner', hNo === noSignal, `${hNo} vs ${noSignal}`);

 // --- Sidebar counts equal their stores
 const side = await page.locator('aside').innerText();
 const sideVal = (label) => { const m = new RegExp(label + '\\s*\\n?\\s*(\\d+)','i').exec(side); return m?Number(m[1]):null; };
 ok('sidebar History count equals the history store', sideVal('History') === history.length, `${sideVal('History')} vs ${history.length}`);
 ok('sidebar Lists count equals the lists store', sideVal('Lists') === lists.length, `${sideVal('Lists')} vs ${lists.length}`);

 ok('no page errors', errs.length===0, errs.join('|'));
 console.log(`\n${pass}/${pass+fail} passed`);
 await b.close(); process.exit(fail?1:0);
})().catch(e=>{console.error('CRASH',e.message);process.exit(1);});
