const BASE='http://localhost:4173';
const EXE='/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const {chromium}=require('playwright');
const OUT='/tmp/claude-0/-home-user-Library/dd1348d8-8ff6-501c-af5d-361f8a90722b/scratchpad/shots';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const rows=[['Ada','Brant','IT Director','Northwind Freight','ada@northwindfreight.com','(312) 555-0101','Dynamics 365 Business Central for 40 users, looking for a partner'],
['Eve','Frost','IT Manager','Frost Dental','eve@frostdental.com','(415) 555-0105','Migrating from Google Workspace to Microsoft 365 with an MSP']];
const csv='First Name,Last Name,Title,Company,Email,Phone,Comments\n'+rows.map(r=>r.map(c=>`"${c}"`).join(',')).join('\n');
(async()=>{
 const b=await chromium.launch({executablePath:EXE});
 for(const [name,opts] of [['dark',{colorScheme:'dark',viewport:{width:1440,height:900}}],
                           ['narrow',{colorScheme:'light',viewport:{width:400,height:850}}]]){
  const page=await (await b.newContext(opts)).newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(String(e)));
  page.on('dialog',d=>d.accept());
  await page.goto(BASE); await sleep(600);
  await page.screenshot({path:`${OUT}/${name}-01-lock.png`});
  await page.fill('input[aria-label="Email"]','jack@wiredcio.com');
  await page.fill('input[type=password]','Wiredcio44');
  await page.click('button:has-text("Unlock")'); await sleep(1200);
  const f=page.locator('input[aria-label="Scanner password"]');
  if(await f.count()){await f.fill('Jackcio28');await page.locator('button:has-text("Unlock scanner")').click();await sleep(800);}
  await page.setInputFiles('input[type=file]',{name:'t.csv',mimeType:'text/csv',buffer:Buffer.from(csv)}).catch(()=>{});
  await sleep(2200);
  await page.screenshot({path:`${OUT}/${name}-02-results.png`,fullPage:true});
  const m=await page.evaluate(()=>{
    const cs=getComputedStyle(document.body);
    return {bg:cs.backgroundColor,color:cs.color,
      sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth};});
  console.log(name,JSON.stringify(m),'errors',errs.length);
 }
 await b.close();
})();
