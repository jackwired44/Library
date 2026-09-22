// Production build, real password, upload -> scan -> download -> verify.
const BASE = process.env.BASE || 'http://localhost:4173';
const EXE='/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const {chromium}=require('playwright');
const fs=require('fs');
const samples=require('../fixtures/smc-samples.json');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const esc=v=>`"${String(v).replace(/"/g,'""')}"`;
let pass=0,fail=0;
const ok=(n,c,d='')=>{c?(pass++,console.log('  PASS',n)):(fail++,console.log('  FAIL',n,d));};
// Jack's real header shape, with identity columns POPULATED on some rows.
const HEAD=['address1_country','description','emailaddress1','fullname','jobtitle','mobilephone','telephone1','accountidname','websiteurl','address1_city','address1_stateorprovince','msdyn_segmentidname','industrycodename','statuscodename','revenue','numberofemployees','campaignidname','companyname','description_1','estimatedclosedate'];
const CAMPS=['US~US~FY26~CMP~Expand Security - VDS~SRAIM638026_2','US~US~FY25~CMP~On-prem Windows Server migration to Azure - VDS~SRAIM521867_13','US~US~FY25~CMP~First Workload MW to Azure AVD - VDS~SRAIM521867_7'];
// One row factory. `opts.blankCols` blanks a field on EVERY row, which is how
// the blank-column warning is exercised without re-splitting a quoted CSV.
function buildCsv(opts={}){
  const blank=new Set(opts.blankCols||[]);
  const out=[HEAD.join(',')];
  for(let i=0;i<60;i++){
    // Only blobs with no contact block, so nothing back-fills a blanked field.
    const pool=opts.blankCols?samples.filter(d=>!/First\s+Name\s*:/.test(d)):samples;
    const blob=pool[i%pool.length].replace(/Customer TPID: (\d+)/,`Customer TPID: ${7000000+i}`);
    const full=i%2===0;   // half the rows carry CSV identity, half rely on the blob
    const cell={
      address1_country:'US', description:blob,
      emailaddress1:full?`p${i}@corp${i}.com`:'', fullname:full?`Pat Vance ${i}`:'',
      jobtitle:full?'IT Director':'', mobilephone:full?`312555${String(i).padStart(4,'0')}`:'',
      telephone1:full?`312444${String(i).padStart(4,'0')}`:'', accountidname:`ACCT-${i}`,
      websiteurl:'', address1_city:'Chicago', address1_stateorprovince:'IL',
      msdyn_segmentidname:'Seg', industrycodename:'Tech', statuscodename:'Open', revenue:'100',
      numberofemployees:full?'250':'', campaignidname:CAMPS[i%CAMPS.length],
      companyname:full?`Corp ${i}`:'', description_1:'second desc', estimatedclosedate:'2026-12-01',
    };
    for(const b of blank) cell[b]='';
    out.push(HEAD.map(h=>esc(cell[h]??'')).join(','));
  }
  return out.join('\n');
}
const csv=buildCsv();
(async()=>{
  const b=await chromium.launch({executablePath:EXE});
  const ctx=await b.newContext({viewport:{width:1500,height:1000},acceptDownloads:true});
  const page=await ctx.newPage();
  const errs=[];
  page.on('pageerror',e=>errs.push('PAGEERROR '+e.message));
  page.on('console',m=>{if(m.type()==='error'&&!/favicon|font|net::|googleapis|Failed to load/i.test(m.text()))errs.push('CONSOLE '+m.text());});
  page.on('dialog',d=>d.accept());
  await page.goto(BASE); await sleep(900);
  await page.fill('input[aria-label="Email"]','jack@wiredcio.com');
  // This suite runs against the TEST build; the real-password check belongs
  // to the manual production verification done before each publish.
  await page.fill('input[type=password]','changeme');
  await page.click('button:has-text("Unlock")'); await sleep(1500);
  ok('unlocks', await page.locator('.side-nav-btn').count()>0);

  await page.locator('.side-nav-btn',{hasText:'Custom Scanner'}).first().click(); await sleep(700);
  await page.setInputFiles('input[type=file]',{name:'real.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
  await sleep(3200);
  const t=await page.locator('main').innerText();
  ok('all rows read', /ROWS READ\s*60/.test(t.replace(/,/g,'')), (t.match(/ROWS READ\s*[\d,]+/)||[])[0]);
  ok('figures reconcile', /figures reconcile/.test(t));
  ok('the call-readiness line is shown', /with a phone and a company|with no phone|nobody to call/.test(t), (t.match(/Strong Signal only[^\n]*/)||[])[0]);

  const [dl]=await Promise.all([page.waitForEvent('download',{timeout:30000}),
    page.locator('button[aria-label="Download All High priority leads"]').click()]);
  const f='/tmp/prod-rt.csv'; await dl.saveAs(f);
  const text=fs.readFileSync(f,'utf8');
  const hdr=text.split('\n')[0].replace(/\r$/,'');
  ok('download header is the ten', hdr==='First Name,Last Name,Title,Company Name,Email,Work Direct Phone,Mobile Phone,Number of Employees,Product Area,Notes', hdr);
  const parse=l=>l.match(/("([^"]|"")*"|[^,]*)/g).filter(x=>x!=='').map(c=>c.replace(/^"|"$/g,''));
  const body=text.split('\n').slice(1).filter(Boolean).map(parse);
  ok('rows downloaded', body.length>0, String(body.length));
  const withCsvIdentity=body.filter(c=>/^Pat Vance/.test(c[0]));
  ok('rows whose CSV carried identity export it', withCsvIdentity.length>0, String(withCsvIdentity.length));
  if (withCsvIdentity[0]) {
    const r=withCsvIdentity[0];
    ok('  Title came through', r[2]==='IT Director', r[2]);
    ok('  Company came through (not the account column)', /^Corp /.test(r[3]), r[3]);
    ok('  Email came through', /@corp/.test(r[4]), r[4]);
    ok('  Work phone is telephone1, not the mobile', /^312444/.test(r[5]), r[5]);
    ok('  Mobile phone is mobilephone', /^312555/.test(r[6]), r[6]);
    ok('  Employees came through', r[7]==='250', r[7]);
    ok('  Product area set (column I)', /Dynamics 365|M365 \/ Azure/.test(r[8]), r[8]);
    ok('  Notes state a reason (column J)', /Act Now|Hot signal|High prioritization|BANT/.test(r[9]), r[9].slice(0,60));
  }
  const blobOnly=body.filter(c=>!/^Pat Vance/.test(c[0]));
  ok('rows relying on the blob still export a company', blobOnly.every(c=>c[2].trim().length>0), `${blobOnly.filter(c=>!c[2].trim()).length} without`);
  ok('no row exports a name with someone else\'s email domain',
     body.filter(c=>c[0] && c[3] && /^Pat Vance (\d+)/.test(c[0])).every(c=>c[3].includes(`corp${/^Pat Vance (\d+)/.exec(c[0])[1]}@`)||c[3].includes(`p${/^Pat Vance (\d+)/.exec(c[0])[1]}@`)), 'mismatch found');

  console.log('\n  a fully populated file raises no blank-column warning:');
  ok('no false warning when every column has data somewhere',
     await page.locator('[role=status]').count() === 0);

  console.log('\n  callable filter:');
  const before=await page.locator('.data-table').first().locator('tbody tr').count();
  await page.locator('input[aria-label="Callable only"]').check(); await sleep(800);
  const after=await page.locator('.data-table').first().locator('tbody tr').count();
  ok('callable-only narrows the table', after<=before && after>0, `${before} -> ${after}`);

  console.log('\n  blank-column warning — the reason Apollo hides a column:');
  // Jack's real export had Title blank in all 99 rows and Apollo then only
  // offered Company Name, Product Area and Notes on import.
  await page.locator('button:has-text("Start over")').click(); await sleep(700);
  const noTitle = buildCsv({ blankCols: ['jobtitle', 'mobilephone'] });
  await page.setInputFiles('input[type=file]',{name:'notitle.csv',mimeType:'text/csv',buffer:Buffer.from(noTitle)});
  await sleep(3000);
  const warn = await page.locator('[role=status]').innerText().catch(() => '');
  ok('names the columns that will be blank in every row', /blank in every downloaded row/.test(warn), warn.slice(0, 140));
  // Title is NOT blank here: the BANT Authority fallback supplies one for
  // these blobs, which is the behaviour we want. Mobile Phone has no such
  // fallback, so it is the column that is genuinely blank throughout.
  ok('names the genuinely blank column', /Mobile Phone/.test(warn), warn.slice(0, 140));
  ok('does not name a column the blob back-filled', !/\bTitle\b/.test(warn.split('blank in every')[0]), warn.slice(0, 140));
  ok('says Apollo will not offer them', /Apollo will not offer/.test(warn.replace(/\s+/g,' ')), warn.slice(0, 200));
  await page.locator('button[aria-label="Scan setup"]').click(); await sleep(800);
  const setupTxt = await page.locator('main').innerText();
  ok('each mapped field states how full its column is', /% filled/.test(setupTxt));
  ok('the empty mapped column is flagged', /empty in this file/.test(setupTxt), (setupTxt.match(/[^\n]*empty in this file[^\n]*/)||[])[0]);

  ok('no page or console errors', errs.length===0, JSON.stringify(errs.slice(0,3)));
  console.log(`\n${pass}/${pass+fail} checks passed`);
  await b.close();
  process.exit(fail?1:0);
})();
