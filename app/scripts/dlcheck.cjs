const BASE='http://localhost:4177';
const EXE='/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const {chromium}=require('playwright');
const samples=require('./fixtures/smc-samples.json');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const esc=v=>`"${String(v).replace(/"/g,'""')}"`;
// Jack's real header shape, including the duplicate description column.
const HEAD=['address1_country','description','emailaddress1','fullname','jobtitle','mobilephone','telephone1','accountidname','websiteurl','address1_city','address1_stateorprovince','msdyn_segmentidname','industrycodename','statuscodename','revenue','numberofemployees','campaignidname','companyname','description','estimatedclosedate'];
const CAMPS=['US~US~FY26~CMP~Fabric as Next Logical Workload - VDS~SRAIM638026_6','US~US~FY26~CMP~Expand M365 Copilot - VDS~SRAIM638026_10','US~US~FY25~CMP~First Workload MW to Azure AVD - VDS~SRAIM521867_7','US~US~FY26~CMP~COE True Up 1~SRAIM419760','US~US~FY25~CMP~Partner CoSell~SRAIM562011','US~US~FY26~CMP~Expand Security - VDS~SRAIM638026_2','NULL','US~US~FY25~CMP~Advanced XDR - VDS~SRAIM521867_33','US~US~FY26~CMP~COE True Up 1~SRAIM419760','NULL','US~US~FY25~CMP~On-prem Windows Server migration to Azure - VDS~SRAIM521867_13','US~US~FY25~CMP~TUM~SRAIM514049','US~US~FY26~CMP~Expand Security - VDS~SRAIM638026_2'];
const csv=[HEAD.join(',')].concat(samples.map((d,i)=>{
  const row={address1_country:'US',description:d,emailaddress1:'',fullname:'',jobtitle:'',mobilephone:'',telephone1:'',accountidname:'Acct '+i,websiteurl:'',address1_city:'Chicago',address1_stateorprovince:'IL',msdyn_segmentidname:'Seg',industrycodename:'Tech',statuscodename:'Open',revenue:'100',numberofemployees:'50',campaignidname:CAMPS[i]||'NULL',companyname:'',estimatedclosedate:'2026-12-01'};
  return [row.address1_country,row.description,row.emailaddress1,row.fullname,row.jobtitle,row.mobilephone,row.telephone1,row.accountidname,row.websiteurl,row.address1_city,row.address1_stateorprovince,row.msdyn_segmentidname,row.industrycodename,row.statuscodename,row.revenue,row.numberofemployees,row.campaignidname,row.companyname,'second desc',row.estimatedclosedate].map(esc).join(',');
})).join('\n');
(async()=>{
  const b=await chromium.launch({executablePath:EXE});
  const ctx=await b.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
  const page=await ctx.newPage();
  page.on('dialog',d=>d.accept());
  await page.goto(BASE); await sleep(800);
  await page.fill('input[aria-label="Email"]','jack@wiredcio.com');
  await page.fill('input[type=password]','changeme');
  await page.click('button:has-text("Unlock")'); await sleep(1300);
  await page.locator('.side-nav-btn',{hasText:'Custom Scanner'}).first().click(); await sleep(700);
  await page.setInputFiles('input[type=file]',{name:'smc.csv',mimeType:'text/csv',buffer:Buffer.from(csv)}); await sleep(2800);
  const [dl]=await Promise.all([
    page.waitForEvent('download',{timeout:20000}),
    page.locator('button[aria-label="Download All Strong Signal leads"]').click(),
  ]);
  const p='/tmp/claude-0/-home-user-Library/dd1348d8-8ff6-501c-af5d-361f8a90722b/scratchpad/final-download.csv';
  await dl.saveAs(p);
  console.log('saved as:', dl.suggestedFilename());
  const fs=require('fs');
  const text=fs.readFileSync(p,'utf8');
  const header=text.split('\n')[0];
  const cols=header.match(/("([^"]|"")*"|[^,]*)/g).filter(x=>x!=='').map(c=>c.replace(/^"|"$/g,'').replace(/""/g,'"'));
  console.log('\ncolumn count:', cols.length);
  cols.forEach((c,i)=>console.log(`  ${String(i+1).padStart(2)}. ${c}`));
  const why = text.split('\n')[1] || '';
  console.log('\nfirst data row (truncated):', why.slice(0,300));
  await b.close();
})();
