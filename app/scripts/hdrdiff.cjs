const BASE='http://localhost:4176';
const EXE='/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const {chromium}=require('playwright');
const samples=require('./fixtures/smc-samples.json');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const esc=v=>`"${String(v).replace(/"/g,'""')}"`;
const HEAD=['address1_country','description','emailaddress1','fullname','jobtitle','mobilephone','telephone1','accountidname','websiteurl','address1_city','address1_stateorprovince','msdyn_segmentidname','industrycodename','statuscodename','revenue','numberofemployees','campaignidname','companyname','description','estimatedclosedate'];
const CAMPS=['US~US~FY26~CMP~Fabric as Next Logical Workload - VDS~SRAIM638026_6','US~US~FY26~CMP~Expand M365 Copilot - VDS~SRAIM638026_10','US~US~FY25~CMP~First Workload MW to Azure AVD - VDS~SRAIM521867_7','US~US~FY26~CMP~COE True Up 1~SRAIM419760','US~US~FY25~CMP~Partner CoSell~SRAIM562011','US~US~FY26~CMP~Expand Security - VDS~SRAIM638026_2','NULL','US~US~FY25~CMP~Advanced XDR - VDS~SRAIM521867_33','US~US~FY26~CMP~COE True Up 1~SRAIM419760','NULL','US~US~FY25~CMP~On-prem Windows Server migration to Azure - VDS~SRAIM521867_13','US~US~FY25~CMP~TUM~SRAIM514049','US~US~FY26~CMP~Expand Security - VDS~SRAIM638026_2'];
const smcCsv=[HEAD.join(',')].concat(samples.map((d,i)=>[ 'US',d,'','','','312-555-0%d'.replace('%d',i),'312-555-1'+i,'Acct '+i,'','Chicago','IL','Seg','Tech','Open','100','50',CAMPS[i]||'NULL','','second desc','2026-12-01'].map(esc).join(','))).join('\n');
const mainCsv=['Company,Full Name,Title,Email,Phone,Comments']
  .concat([['Alpine Freight','Dana Reyes','Ops Director','dana@alpinefreight.com','312-555-0101','Looking at Dynamics 365 Business Central for 40 users this year.']].map(r=>r.map(esc).join(','))).join('\n');
const cols=t=>t.split('\n')[0].match(/("([^"]|"")*"|[^,]*)/g).filter(x=>x!=='').map(c=>c.replace(/^"|"$/g,''));
(async()=>{
  const b=await chromium.launch({executablePath:EXE});
  const ctx=await b.newContext({viewport:{width:1500,height:1000},acceptDownloads:true});
  const page=await ctx.newPage(); page.on('dialog',d=>d.accept());
  const fs=require('fs');
  await page.goto(BASE); await sleep(800);
  await page.fill('input[aria-label="Email"]','jack@wiredcio.com');
  await page.fill('input[type=password]','changeme');
  await page.click('button:has-text("Unlock")'); await sleep(1300);

  // Main Scanner download
  await page.locator('.side-nav-btn',{hasText:'Main Scanner'}).first().click(); await sleep(700);
  await page.setInputFiles('input[type=file]',{name:'main.csv',mimeType:'text/csv',buffer:Buffer.from(mainCsv)}); await sleep(2600);
  const [d1]=await Promise.all([page.waitForEvent('download',{timeout:20000}), page.locator('.dl-strip button.btn-primary').first().click()]);
  const f1='/tmp/main-dl.csv'; await d1.saveAs(f1);
  const mainCols=cols(fs.readFileSync(f1,'utf8'));

  // Custom Scanner download
  await page.locator('.side-nav-btn',{hasText:'Custom Scanner'}).first().click(); await sleep(700);
  await page.setInputFiles('input[type=file]',{name:'smc.csv',mimeType:'text/csv',buffer:Buffer.from(smcCsv)}); await sleep(2800);
  const [d2]=await Promise.all([page.waitForEvent('download',{timeout:20000}), page.locator('button[aria-label="Download All Strong Signal leads"]').click()]);
  const f2='/tmp/custom-dl.csv'; await d2.saveAs(f2);
  const custText=fs.readFileSync(f2,'utf8');
  const custCols=cols(custText);

  console.log('main   :', JSON.stringify(mainCols));
  console.log('custom :', JSON.stringify(custCols));
  console.log(JSON.stringify(mainCols)===JSON.stringify(custCols) ? '\nHEADERS IDENTICAL ✓' : '\nHEADERS DIFFER ✗');
  console.log('\ncustom first row:', custText.split('\n')[1].slice(0,220));
  await b.close();
})();
