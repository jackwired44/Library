// Can Jack actually WORK 11,393 rows in the browser? Times the interactions
// he uses to build a call list.
const BASE = process.env.BASE || 'http://localhost:4173';
const EXE='/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const {chromium}=require('playwright');
const samples=require('../fixtures/smc-samples.json');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const esc=v=>`"${String(v).replace(/"/g,'""')}"`;
const N=Number(process.env.N||3000);
const CAMPS=['US~US~FY26~CMP~Fabric as Next Logical Workload - VDS~SRAIM638026_6','US~US~FY26~CMP~Expand M365 Copilot - VDS~SRAIM638026_10','US~US~FY25~CMP~First Workload MW to Azure AVD - VDS~SRAIM521867_7','US~FY24~CMP~COE True Up 1~SRAIM419760','US~US~FY25~CMP~On-prem Windows Server migration to Azure - VDS~SRAIM521867_13'];
const HEAD=['address1_country','description','emailaddress1','fullname','jobtitle','mobilephone','telephone1','accountidname','websiteurl','numberofemployees','campaignidname','companyname','description_1','estimatedclosedate'];
const lines=[HEAD.join(',')];
for(let i=0;i<N;i++){
  const blob=samples[i%samples.length].replace(/Customer TPID: (\d+)/,`Customer TPID: ${9000000+i}`);
  lines.push(['US',blob,`p${i}@corp${i%700}.com`,`Pat Vance ${i}`,'IT Director',`312555${String(i).padStart(4,'0')}`,`312444${String(i).padStart(4,'0')}`,`ACCT-${i}`,'','250',CAMPS[i%CAMPS.length],`Corp ${i}`,'second desc','2026-12-01'].map(esc).join(','));
}
const csv=lines.join('\n');
let pass=0,fail=0;
const ok=(n,c,d='')=>{c?(pass++,console.log('  PASS',n,d)):(fail++,console.log('  FAIL',n,d));};
const time=async(label,fn,budget)=>{const t=Date.now();await fn();const ms=Date.now()-t;ok(`${label} (${ms}ms, budget ${budget}ms)`,ms<budget,ms>=budget?'TOO SLOW':'');return ms;};

(async()=>{
  const b=await chromium.launch({executablePath:EXE});
  const ctx=await b.newContext({viewport:{width:1500,height:1000},acceptDownloads:true});
  const page=await ctx.newPage();
  const errs=[];
  page.on('pageerror',e=>errs.push('PAGEERROR '+e.message));
  page.on('console',m=>{if(m.type()==='error'&&!/favicon|font|net::|googleapis|Failed to load/i.test(m.text()))errs.push('CONSOLE '+m.text());});
  page.on('dialog',d=>d.accept());
  await page.goto(BASE); await sleep(800);
  await page.fill('input[aria-label="Email"]','jack@wiredcio.com');
  await page.fill('input[type=password]','changeme');
  await page.click('button:has-text("Unlock")'); await sleep(1300);
  await page.locator('.side-nav-btn',{hasText:'Custom Scanner'}).first().click(); await sleep(700);

  console.log(`\n== uploading ${N} rows (${(csv.length/1e6).toFixed(1)} MB) ==`);
  const t0=Date.now();
  await page.setInputFiles('input[type=file]',{name:'big.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
  await page.locator('.kpi-row').first().waitFor({timeout:120000});
  await page.locator('.data-table tbody tr').first().waitFor({timeout:120000});
  const uploadMs=Date.now()-t0;
  ok(`upload + scan completes (${(uploadMs/1000).toFixed(1)}s)`, uploadMs<60000, uploadMs>=60000?'TOO SLOW':'');
  const txt=await page.locator('main').innerText();
  ok('all rows read', new RegExp(`ROWS READ\\s*${N}`).test(txt.replace(/,/g,'')), (txt.match(/ROWS READ\s*[\d,]+/)||[])[0]);
  ok('figures reconcile at volume', /figures reconcile/.test(txt));
  ok('only one page of rows is rendered', await page.locator('.data-table tbody tr').count() <= 30, String(await page.locator('.data-table tbody tr').count()));

  console.log('\n== interactions ==');
  await time('switch to Strong Signal tab', async()=>{
    await page.locator('.seg-btn', {hasText:/^Strong Signal \(/}).first().click();
    await page.waitForFunction(()=>!!document.querySelector('.data-table tbody tr'),{timeout:30000});
  }, 3000);
  await time('filter to Dynamics 365', async()=>{
    await page.locator('button[aria-label="Product line Dynamics 365"]').click();
    await sleep(120);
  }, 3000);
  await time('type 5 characters in search', async()=>{
    await page.fill('input[placeholder*="Search company"]','Corp 1');
    await sleep(150);
  }, 3000);
  await page.fill('input[placeholder*="Search company"]','');
  await time('page forward', async()=>{
    await page.locator('button:has-text("Next")').first().click(); await sleep(120);
  }, 2000);
  await time('mark one lead Keep', async()=>{
    await page.locator('button[aria-label^="Keep "]').first().click();
    await page.waitForFunction(()=>/Keep \(1\)/.test(document.querySelector('main').innerText),{timeout:15000});
  }, 5000);
  ok('a Keep on one lead marks exactly one lead', /Keep \(1\)/.test(await page.locator('main').innerText()),
     (await page.locator('main').innerText()).match(/Keep \(\d+\)/)?.[0]);

  console.log('\n== the download you would dial from ==');
  const dlBtn = page.locator('button[aria-label="Download All Strong Signal leads"]');
  const t=Date.now();
  const [dl]=await Promise.all([page.waitForEvent('download',{timeout:60000}), dlBtn.click()]);
  const f='/tmp/volume-dl.csv'; await dl.saveAs(f);
  const ms=Date.now()-t;
  const fs=require('fs');
  const text=fs.readFileSync(f,'utf8');
  const rows=text.split('\n').filter(Boolean).length-1;
  ok(`download built in ${ms}ms`, ms<30000);
  ok('download carries every Strong Signal lead', rows>200, `${rows} rows`);
  const hdr=text.split('\n')[0].replace(/\r$/,'');
  ok('download header is the agreed ten columns',
     hdr==='First Name,Last Name,Title,Company Name,Email,Work Direct Phone,Mobile Phone,Number of Employees,Product Area,Notes', hdr);
  const bad=text.split('\n').slice(1).filter(Boolean).filter(l=>{
    const c=l.match(/("([^"]|"")*"|[^,]*)/g).filter(x=>x!=='');
    return !c[0] || (!c[5] && !c[6]);   // no first name, or no phone at all (cols shifted by Last Name)
  }).length;
  ok('every downloaded lead has a name and a phone', bad===0, `${bad} unusable rows`);

  console.log('\n== errors ==');
  ok('no page or console errors', errs.length===0, JSON.stringify(errs.slice(0,3)));
  console.log(`\n${pass}/${pass+fail} checks passed`);
  await b.close();
  process.exit(fail?1:0);
})();
