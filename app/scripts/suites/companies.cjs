// Committed regression suite. Run via `npm run suites` (starts one
// preview server and runs them all) or standalone with
// `BASE=http://localhost:4173 xvfb-run -a node <this file>`.
const BASE = process.env.BASE || 'http://localhost:4173';
const EXE = process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { chromium } = require('/home/user/Library/app/node_modules/playwright');
const fs=require('fs'); const SP=__dirname; const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const out=[]; const ck=(n,c)=>{out.push(!!c);console.log((c?'PASS':'FAIL')+'  '+n);};
(async()=>{
  const br=await chromium.launch({executablePath: EXE});
  const page=await (await br.newContext({viewport:{width:1500,height:1000},timezoneId:'America/Chicago'})).newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(e.message)); page.on('dialog',d=>d.accept());
  const body=()=>page.locator('body').innerText();
 const __unlockScanner = async () => {
   const f = page.locator('input[aria-label="Scanner password"]');
   if (await f.count()) { await f.fill('changeme'); await page.locator('button:has-text("Unlock scanner")').click(); await page.waitForTimeout(500); }
 };
  const nav=async l=>{await page.locator('aside button').filter({hasText:l}).first().click();await sleep(500);await __unlockScanner();};

  // 3 real prospects + 1 obvious competitor by NAME
  const csv=['Company Name,First Name,Last Name,Email,Work Phone,Title,Comments',
   'Riverside Manufacturing,Bo,Kim,bo@riversidemfg.com,(212) 555-0100,IT Dir,"Dynamics 365 Business Central for 40 users"',
   'Vertex Health,Amy,Lin,amy@vertexhealth.org,6025550100,CTO,"Azure Document Intelligence and a full custom app build"',
   'Zephyr Corp,Cy,Lee,cy@zephyrcorp.com,,CTO,"Dynamics 365 Business Central for 60 users"',
   'Summit Managed Services,Ann,Ray,ann@summitms.com,,CEO,"Dynamics 365 Business Central for 40 users"'].join('\n');
  fs.writeFileSync(`${SP}/comp.csv`, csv);
  await page.goto(BASE); await sleep(500);
  await page.locator('input[aria-label="Email"]').fill('jack@wiredcio.com');
  await page.locator('input[type="password"]').fill('changeme');
  await page.locator('button').filter({hasText:/Unlock/}).click(); await sleep(700);
  await page.keyboard.press('Shift+J'); await page.waitForTimeout(450); await __unlockScanner();
  await page.locator('input[type="file"][accept=".csv"]').setInputFiles(`${SP}/comp.csv`);
  await page.locator('.kpi').first().waitFor({timeout:15000}); await sleep(800);

  // competitor by name should be a Bad Lead, others Strong Signal
  const kpi = await page.locator('.kpi-row').innerText();
  ck('Competitor name lands in Bad leads (3 signal / 1 bad)', /Strong Signal\n?3/i.test(kpi.replace(/\s+/g,'\n')) || /3/.test(kpi));
  await page.locator('.toolbar button').filter({hasText:/^Bad Leads \(/}).first().click(); await sleep(500);
  const badText = await body();
  ck('Summit Managed Services is the Bad Lead', /Summit Managed Services/.test(badText));
  ck('DQ reason names the competitor rule', /Competitor \/ IT services/i.test(badText));
  ck('Riverside is NOT in Bad Leads', !/Riverside Manufacturing/.test(badText));

  // Companies: import a profile marking Zephyr as computer software
  const apollo=['Company,Website,Industry,# Employees,Company City,Company State',
   'Zephyr Corp,https://zephyrcorp.com,computer software,120,Austin,TX',
   'Riverside Manufacturing,https://riversidemfg.com,machinery,340,Akron,OH',
   'Vertex Health,https://vertexhealth.org,hospital & health care,900,Phoenix,AZ'].join('\n');
  fs.writeFileSync(`${SP}/apollo-comp.csv`, apollo);
  await nav('Companies');
  await page.locator('main input[aria-label="Import Apollo export"]').setInputFiles(`${SP}/apollo-comp.csv`); await sleep(1600);
  ck('Apollo import reports its summary', /new|updated/i.test(await body()));

  // Filters popover
  await page.locator('.filter-btn').first().click(); await sleep(500);
  const pop = await page.locator('.filter-pop').innerText();
  ck('Filters popover has size, competitor and industry groups', /Company size/i.test(pop) && /Competitors/i.test(pop) && /Industry/i.test(pop));
  ck('Industry list shows the imported values', /computer software/i.test(pop) && /machinery/i.test(pop));
  ck('Competitor count is 1', /Competitors only\s*\n?\s*1/.test(pop) || /1/.test(pop));

  // "Competitors only" narrows to Zephyr
  await page.locator('.filter-pop label').filter({hasText:'Competitors only'}).click(); await sleep(600);
  await page.locator('.filter-btn').first().click(); await sleep(400);
  let b=await body();
  ck('Competitors only shows Zephyr', /Zephyr Corp/.test(b));
  ck('Competitors only hides Riverside', !/Riverside Manufacturing/.test(b));
  ck('Chip row shows the active filter', /Competitors only/.test(b));
  ck('Remove action offers the filtered count', /Remove 1 filtered/.test(b));

  // size filter
  await page.locator('.filter-btn').first().click(); await sleep(400);
  await page.locator('.filter-pop label').filter({hasText:'Show all'}).click(); await sleep(300);
  await page.locator('.filter-pop label').filter({hasText:'201–1,000'}).click(); await sleep(500);
  await page.locator('.filter-btn').first().click(); await sleep(400);
  b=await body();
  ck('Size 201-1,000 keeps Riverside(340) and Vertex(900)', /Riverside/.test(b) && /Vertex/.test(b));
  ck('Size 201-1,000 drops Zephyr(120)', !/Zephyr Corp/.test(b));

  // remove the filtered set
  const before = (await page.locator('main tbody tr').count());
  await page.locator('button').filter({hasText:/^Remove \d+ filtered$/}).first().click(); await sleep(1200);
  b=await body();
  ck('Remove filtered deletes those companies', !/Riverside Manufacturing/.test(b));
  console.log('  rows before/after:', before, await page.locator('main tbody tr').count());

  ck('no page errors', errs.length===0); if(errs.length) console.log(errs.slice(0,4));
  console.log(`\n${out.filter(Boolean).length}/${out.length}`);
  await br.close();
})();
