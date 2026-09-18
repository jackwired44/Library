const BASE='http://localhost:4174';
const EXE='/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const {chromium}=require('playwright');
const samples=require('./fixtures/smc-samples.json');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const esc=v=>`"${String(v).replace(/"/g,'""')}"`;
const CAMPS=['US~US~FY26~CMP~Fabric as Next Logical Workload - VDS~SRAIM638026_6','US~US~FY26~CMP~Expand M365 Copilot - VDS~SRAIM638026_10','US~US~FY25~CMP~First Workload MW to Azure AVD - VDS~SRAIM521867_7','US~FY24~CMP~COE True Up 1~SRAIM419760','US~US~FY25~CMP~Partner CoSell~SRAIM562011','US~US~FY26~CMP~Expand Security - VDS~SRAIM638026_2','NULL','US~US~FY25~CMP~Advanced XDR - VDS~SRAIM521867_33','US~FY24~CMP~COE True Up 1~SRAIM419760','NULL','US~US~FY25~CMP~On-prem Windows Server migration to Azure - VDS~SRAIM521867_13','US~US~FY25~CMP~TUM~SRAIM514049','US~US~FY26~CMP~Expand Security - VDS~SRAIM638026_2'];
const csv=['companyname,description,campaignidname,emailaddress1,fullname,jobtitle,telephone1']
  .concat(samples.map((d,i)=>[esc(''),esc(d),esc(CAMPS[i]||'NULL'),esc(''),esc(''),esc(''),esc('')].join(','))).join('\n');
let pass=0,fail=0; const ok=(n,c,d='')=>{c?(pass++,console.log('  PASS',n)):(fail++,console.log('  FAIL',n,d));};
(async()=>{
  const b=await chromium.launch({executablePath:EXE});
  const page=await (await b.newContext({viewport:{width:1440,height:1250}})).newPage();
  const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR '+e.message));
  page.on('console',m=>{if(m.type()==='error'&&!/favicon|font|net::|googleapis|Failed to load/i.test(m.text()))errs.push('CONSOLE '+m.text());});
  page.on('dialog',d=>d.accept());
  await page.goto(BASE); await sleep(800);
  await page.fill('input[aria-label="Email"]','jack@wiredcio.com');
  await page.fill('input[type=password]','changeme');
  await page.click('button:has-text("Unlock")'); await sleep(1200);
  ok('production build rejects the test password', await page.locator('input[type=password]').count()>0);
  await page.fill('input[type=password]','Wiredcio44');
  await page.click('button:has-text("Unlock")'); await sleep(1500);
  ok('production build accepts the real password', await page.locator('.side-nav-btn').count()>0);
  await page.locator('.side-nav-btn',{hasText:'Custom Scanner'}).first().click(); await sleep(700);
  ok('Custom Scanner opens with no extra gate', await page.locator('input[type=file]').count()>0);
  await page.setInputFiles('input[type=file]',{name:'smc.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
  await sleep(2800);
  const t=await page.locator('main').innerText();
  ok('scans and reports rows read', /ROWS READ\s*13/i.test(t), (t.match(/ROWS READ\s*\d+/i)||[])[0]);
  ok('Final downloads offers each product line on its own',
     await page.locator('button[aria-label="Download Dynamics leads"]').count()>0 &&
     await page.locator('button[aria-label="Download M365 / Azure leads"]').count()>0 &&
     await page.locator('button[aria-label="Download All Strong Signal leads"]').count()>0);
  ok('setup is one collapsed bar, not three panels', /SCAN SETUP/i.test(t) && !/Which column is what/.test(t));
  await page.locator('button[aria-label="Scan setup"]').click(); await sleep(600);
  ok('Edit setup reveals the mapping and rules', /Which column is what/.test(await page.locator('main').innerText()));
  await page.locator('button[aria-label="Scan setup"]').click(); await sleep(400);
  await page.screenshot({path:'/tmp/claude-0/-home-user-Library/dd1348d8-8ff6-501c-af5d-361f8a90722b/scratchpad/ui-prod.png'});
  ok('no page or console errors', errs.length===0, JSON.stringify(errs.slice(0,3)));
  console.log(`\n${pass}/${pass+fail} checks passed`);
  await b.close(); process.exit(fail?1:0);
})();
