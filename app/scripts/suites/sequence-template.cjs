// Committed regression suite. Run via `npm run suites` (starts one
// preview server and runs them all) or standalone with
// `BASE=http://localhost:4173 xvfb-run -a node <this file>`.
const BASE = process.env.BASE || 'http://localhost:4173';
const EXE = process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { chromium } = require('playwright');
const P = BASE;
let pass=0, fail=0;
const ok=(n,c,d='')=>{ c?(pass++,console.log('  PASS',n)):(fail++,console.log('  FAIL',n,d)); };

(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const ctx = await b.newContext({ timezoneId: 'America/Chicago' });
  const page = await ctx.newPage();
  const errs=[];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if(m.type()==='error' && !/favicon|font|net::|fonts\.googleapis|Failed to load resource/i.test(m.text())) errs.push(m.text()); });

  await page.goto(P);
 const unlockScanner = async () => {
   const f = page.locator('input[aria-label="Scanner password"]');
   if (await f.count()) { await f.fill('changeme'); await page.locator('button:has-text("Unlock scanner")').click(); await page.waitForTimeout(500); }
 };
  await page.fill('input[aria-label="Email"]','jack@wiredcio.com'); await page.fill('input[type=password]', 'changeme');
  await page.click('button:has-text("Unlock")');
  await page.waitForTimeout(700);

  // Seed a contact so the merge preview has real data.
  const csv = `First Name,Last Name,Title,Company,Email,Phone,Comments
Dana,Whitfield,IT Director,Ridgeline Orthopedics,dana@ridgelineortho.com,(312) 555-0110,Looking at Dynamics 365 Business Central for 40 users this year`;
  await page.keyboard.press('Control+Shift+S'); await page.waitForTimeout(450); await unlockScanner();
  await page.waitForTimeout(300);
  await page.setInputFiles('input[type=file]', { name:'seed.csv', mimeType:'text/csv', buffer: Buffer.from(csv) });
  await page.waitForTimeout(1500);

  // --- Sequences ---
  await page.click('.side-nav-btn:has-text("Sequences")');
  await page.waitForTimeout(700);

  ok('Templates button present', await page.locator('button:has-text("Templates (")').count() > 0);
  await page.click('button:has-text("Templates (")');
  await page.waitForTimeout(300);
  const panel = await page.locator('text=Start from a template').count();
  ok('Template panel opens', panel > 0);
  ok('Dynamics Sequence listed', await page.locator('text=Copied from Apollo').count() > 0);

  const chips = await page.locator('span:has-text("1. 📞 Call")').count();
  ok('Step chips render', chips > 0);
  const immediate = await page.getByText('immediately', { exact: false }).count();
  ok('Wait-0 step shows "immediately"', immediate > 0, `count=${immediate}`);

  await page.click('button:has-text("Use this template")');
  await page.waitForTimeout(900);

  // The new sequence should be open with 5 steps.
  const stepRows = await page.locator('text=/^\\d+\\.$/').count();
  ok('Sequence created and opened', await page.locator('text=Dynamics Sequence').count() > 0);

  // Content button on the email step
  const contentBtns = page.locator('button:has-text("Edit")');
  const nContent = await contentBtns.count();
  ok('Content buttons only on non-call steps (2 expected)', nContent === 2, `got ${nContent}`);
  // Content and prompts share one Edit button now; the ✓ means either is filled.
  const contentChecked = await page.locator('button:has-text("Edit ✓")').count();
  ok('Both message steps show filled ✓', contentChecked === 2, `got ${contentChecked}`);

  // AI prompt present on the email step
  // The email step is now named by what it is rather than badged.
  const aiNamed = await page.locator('[data-step-type*="AI-written"]').count();
  ok('Email step is named as AI-written', aiNamed > 0, `got ${aiNamed}`);

  // Open the email step's AI prompt and verify the REAL text landed.
  await page.locator('[data-step-channel="email"]').locator('button:has-text("Edit"), button:has-text("Close")').first().click();
  await page.waitForTimeout(500);
  await page.click('.seg-btn:has-text("AI instructions")');
  await page.waitForTimeout(400);
  const sys = await page.locator('textarea[aria-label="System prompt"]').inputValue();
  ok('System prompt is Apollo\'s verbatim', sys.includes('skilled conversationalist') && sys.includes('Once-in-a-Lifetime'), sys.slice(0,60));
  const usr = await page.locator('textarea[aria-label="User prompt"]').inputValue();
  ok('User prompt is Apollo\'s verbatim', usr.includes('Microsoft Solutions partner serving small and midsize') && usr.includes('(14) never use these words'), usr.slice(0,60));
  ok('User prompt keeps merge fields', usr.includes('{{contact.first_name}}') && usr.includes('{{#if contact.title}}'));
  await page.waitForTimeout(200);

  // Open the LinkedIn step's content editor and check merge preview.
  // Scope to the LinkedIn step's own row — an already-open step's button
  // reads "Close", so a bare .last() over "Edit" is ambiguous.
  await page.locator('[data-step-channel="linkedin"]').locator('button:has-text("Edit"), button:has-text("Close")').first().click();
  await page.waitForTimeout(900);
  const bodyVal = await page.locator('textarea[aria-label="Message body"]').last().inputValue();
  ok('LinkedIn body copied verbatim', bodyVal.includes('in case my email or call didn'), bodyVal.slice(0,50));
  // The step editor used to render a SECOND preview that always used
  // contacts[0], disagreeing with the lead picked in the real preview
  // beside it. That duplicate is gone; the live preview names its own
  // chosen lead.
  const previewTxt = await page.locator('.preview-col').innerText();
  ok('Preview names the real contact', /Dana Whitfield/.test(previewTxt), previewTxt.slice(0,160));
  ok('Merge field resolved in preview', /Hey Dana/.test(previewTxt), previewTxt.slice(0,240));

  // Email step content: subject
  await page.locator('[data-step-channel="email"]').locator('button:has-text("Edit"), button:has-text("Close")').first().click();
  await page.waitForTimeout(700);
  const subj = await page.locator('input[aria-label="Subject line"]').first().inputValue().catch(()=> '');
  ok('Email subject is "Microsoft Solutions"', subj === 'Microsoft Solutions', `got "${subj}"`);
  ok('Explains the body is AI-written', /AI-written from its prompts|written per contact/i.test(await page.locator('.prompt-split').innerText()));

  // Enroll and confirm the task text carries the subject.
  await page.locator('label:has-text("Dana Whitfield") input[type=checkbox]').check();
  await page.waitForTimeout(200);
  await page.click('button:has-text("Enroll 1 contact")');
  await page.waitForTimeout(900);
  const enrolledTxt = await page.locator('main').innerText();
  ok('Contact now enrolled', /ENROLLED CONTACTS[\s\S]{0,200}Dana Whitfield/.test(enrolledTxt), enrolledTxt.slice(enrolledTxt.indexOf('ENROLLED CONTACTS'), enrolledTxt.indexOf('ENROLLED CONTACTS')+180));
  ok('Enrollment sits on step 1 of 5', /Step 1\/5/.test(enrolledTxt));

  // The generated task should carry the step-1 note, and step 2's task
  // (once reached) would carry the email subject — check task text now.
  await page.click('.side-nav-btn:has-text("Calls")');
  await page.waitForTimeout(700);
  const callsTxt = await page.locator('main').innerText();
  ok('Step-1 call task generated for the contact', /Dana Whitfield/.test(callsTxt) && /Dynamics Sequence/.test(callsTxt), callsTxt.slice(0,200));
  await page.click('.side-nav-btn:has-text("Sequences")');
  await page.waitForTimeout(500);

  // Reload -> persistence
  await page.reload();
  await page.waitForTimeout(1200);
  await page.click('.side-nav-btn:has-text("Sequences")');
  await page.waitForTimeout(700);
  ok('Sequence survived reload', await page.locator('text=Dynamics Sequence').count() > 0);

  ok('No page errors', errs.length === 0, errs.slice(0,3).join(' | '));
  console.log(`\n${pass}/${pass+fail} checks passed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
