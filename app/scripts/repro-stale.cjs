// Reproduce Jack's browser: a rule set saved by an EARLIER build, then the
// current code uploading into it. Frozen mappings are the suspect.
const BASE='http://localhost:4180';
const EXE='/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const {chromium}=require('playwright');
const samples=require('./fixtures/smc-samples.json');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const esc=v=>`"${String(v).replace(/"/g,'""')}"`;
const HEAD=['address1_country','description','emailaddress1','fullname','jobtitle','mobilephone','telephone1','accountidname','websiteurl','address1_city','address1_stateorprovince','msdyn_segmentidname','industrycodename','statuscodename','revenue','numberofemployees','campaignidname','companyname','description','estimatedclosedate'];
const CAMPS=['US~US~FY26~CMP~Fabric as Next Logical Workload - VDS~SRAIM638026_6','US~US~FY26~CMP~Expand M365 Copilot - VDS~SRAIM638026_10','US~US~FY25~CMP~First Workload MW to Azure AVD - VDS~SRAIM521867_7','US~US~FY26~CMP~COE True Up 1~SRAIM419760','US~US~FY25~CMP~Partner CoSell~SRAIM562011','US~US~FY26~CMP~Expand Security - VDS~SRAIM638026_2','NULL','US~US~FY25~CMP~Advanced XDR - VDS~SRAIM521867_33','US~US~FY26~CMP~COE True Up 1~SRAIM419760','NULL','US~US~FY25~CMP~On-prem Windows Server migration to Azure - VDS~SRAIM521867_13','US~US~FY25~CMP~TUM~SRAIM514049','US~US~FY26~CMP~Expand Security - VDS~SRAIM638026_2'];
const csv=[HEAD.join(',')].concat(samples.map((d,i)=>[
  'US', d, 'real'+i+'@corp.com', 'Pat Vance '+i, 'IT Director', '312-555-90'+i, '312-555-10'+i,
  'ACCT-'+i+' (CRM record)', 'corp.com', 'Chicago','IL','Seg','Tech','Open','100','250',
  CAMPS[i]||'NULL', 'Real Company '+i, 'second desc', '2026-12-01'
].map(esc).join(','))).join('\n');

(async()=>{
  const b=await chromium.launch({executablePath:EXE});
  const ctx=await b.newContext({viewport:{width:1500,height:1000},acceptDownloads:true});
  const page=await ctx.newPage(); page.on('dialog',d=>d.accept());
  const fs=require('fs');
  await page.goto(BASE); await sleep(800);
  await page.fill('input[aria-label="Email"]','jack@wiredcio.com');
  await page.fill('input[type=password]','changeme');
  await page.click('button:has-text("Unlock")'); await sleep(1300);
  await page.locator('.side-nav-btn',{hasText:'Custom Scanner'}).first().click(); await sleep(1200);

  // Overwrite whatever rule set exists with one shaped like an OLD save:
  // five identity fields, company pointing at the account column, and the
  // old drop list (note the one-letter-short estimatedclosedat).
  const seeded = await page.evaluate(async () => {
    const open = () => new Promise((res, rej) => {
      const r = indexedDB.open('wiredCioUnifiedLeadScannerLibrary_v1');
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    const db = await open();
    const all = await new Promise((res, rej) => { const g = db.transaction('scanner2RuleSets').objectStore('scanner2RuleSets').getAll(); g.onsuccess = () => res(g.result); g.onerror = () => rej(g.error); });
    const rs = all[0];
    rs.fields = { company: 'accountidname', contact: 'fullname', title: 'jobtitle', email: 'emailaddress1', phone: 'mobilephone' };
    rs.notesColumns = ['description', 'description_1'];
    rs.campaignColumns = ['campaignidname'];
    rs.excludedColumns = ['estimatedclosedat','industrycodename','statuscodename','revenue','accountidname','address1_city','address1_stateorprovince','msdyn_segmentidname'];
    await new Promise((res, rej) => { const tx = db.transaction('scanner2RuleSets','readwrite'); tx.objectStore('scanner2RuleSets').put(rs); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    db.close();
    return rs.fields;
  });
  console.log('seeded stale mapping:', JSON.stringify(seeded));

  await page.reload(); await sleep(1500);
  await page.locator('.side-nav-btn',{hasText:'Custom Scanner'}).first().click(); await sleep(800);
  await page.setInputFiles('input[type=file]',{name:'smc.csv',mimeType:'text/csv',buffer:Buffer.from(csv)}); await sleep(3000);

  const [dl]=await Promise.all([page.waitForEvent('download',{timeout:20000}), page.locator('button[aria-label="Download All Strong Signal leads"]').click()]);
  const f='/tmp/stale-dl.csv'; await dl.saveAs(f);
  const text=fs.readFileSync(f,'utf8');
  console.log('\n--- header ---\n'+text.split('\n')[0]);
  console.log('\n--- first 2 rows ---');
  text.split('\n').slice(1,3).forEach(r=>console.log(r.slice(0,260)));
  await b.close();
})();
