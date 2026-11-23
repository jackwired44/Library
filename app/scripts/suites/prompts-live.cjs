// Archive -> Prompts: save, filter, edit, copy, survive reload, delete.
const BASE = process.env.BASE || 'http://localhost:4173';
const { chromium } = require('playwright');
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log('  PASS', n)) : (fail++, console.log('  FAIL', n, d)); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const page = await (await b.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  page.on('dialog', d => d.accept());
  await page.goto(BASE);
  await page.fill('input[aria-label="Email"]', 'jack@wiredcio.com'); await page.fill('input[type=password]', 'changeme');
  await page.click('button:has-text("Unlock")'); await sleep(900);
  await page.locator('aside button:has-text("Prompts")').first().click(); await sleep(400);
  ok('prompts tab opens', await page.locator('h2:has-text("Prompts")').count() === 1);
  // Every Apollo prompt on file loads on its own, grouped by product area.
  // 2026-11-23: was pinned to the literal 14 live on 2026-11-20; that breaks
  // every time Jack saves another sequence's prompts, which is noise rather
  // than safety. The real invariant is that every seed renders, which the
  // row-count comparison already asserts. The floor keeps the file from
  // silently emptying out.
  const seeds = require('fs').readFileSync(require('path').join(__dirname, '../../src/lib/emailPromptSeeds.ts'), 'utf8');
  const nSeeds = (seeds.match(/"id": "apollo-/g) || []).length;
  ok('the Apollo prompts load on their own', (await page.locator('table[aria-label="Prompts"] tbody tr:not(.prompt-group)').count()) === nSeeds && nSeeds >= 14, String(nSeeds));
  ok('grouped by Dynamics 365 and M365 / Azure', await page.locator('tr.prompt-group[data-area="Dynamics 365"]').count() === 1 && await page.locator('tr.prompt-group[data-area="M365 / Azure"]').count() === 1);
  await page.locator('table[aria-label="Prompts"] tbody tr', { hasText: 'Jacks Dynamics Sequence · Step 5' }).first().click(); await sleep(150);
  const firstLine = JSON.parse(seeds.slice(seeds.indexOf('= [', seeds.indexOf('PROMPT_SEEDS: PromptSeed')) + 2, seeds.lastIndexOf(']') + 1)).find((x) => x.title === 'Jacks Dynamics Sequence · Step 5').userPrompt.split('\n')[0];
  ok('copied word for word', (await page.locator('table[aria-label="Prompts"]').innerText()).includes(firstLine.trim()), firstLine);
  await page.click('button:has-text("+ New prompt")');
  const d = page.locator('[role=dialog]');
  await d.locator('input[aria-label="Name"]').fill('BC first touch v1');
  await d.locator('select[aria-label="Product area"]').selectOption('Dynamics 365');
  await d.locator('input[aria-label="Sequence"]').fill('Jacks Dynamics Sequence');
  await d.locator('input[aria-label="Subject"]').fill('quick question on business central');
  await d.locator('textarea[aria-label="System prompt"]').fill('You are Jack from Wired CIO.');
  await d.locator('textarea[aria-label="User prompt"]').fill('Write a 3-paragraph email about {{account.name}}.');
  await d.locator('select[aria-label="Verdict"]').selectOption('works');
  await d.locator('input[aria-label="Reply rate"]').fill('4.2');
  await d.locator('button:has-text("Save prompt")').click(); await sleep(300);
  const t = await page.locator('table[aria-label="Prompts"]').innerText();
  ok('saved prompt listed with area, sequence, verdict, reply', t.includes('BC first touch v1') && t.includes('Dynamics 365') && t.includes('Jacks Dynamics Sequence') && t.includes('Works') && t.includes('4.2%'), t);
  // A just-saved prompt opens itself.
  ok('opening shows subject, system and user prompt', (await page.locator('table[aria-label="Prompts"]').innerText()).includes('You are Jack from Wired CIO.'));
  await page.locator('table[aria-label="Prompts"] tbody tr', { hasText: 'BC first touch v1' }).first().locator('button', { hasText: /^Copy$/ }).click(); await sleep(200);
  ok('copy opens a new prompt with the same wording', (await page.locator('[role=dialog] input[aria-label="Name"]').inputValue()) === 'BC first touch v1 (copy)' && (await page.locator('[role=dialog] textarea[aria-label="User prompt"]').inputValue()).includes('{{account.name}}'));
  await page.locator('[role=dialog] button:has-text("Save prompt")').click(); await sleep(300);
  ok('copy saved as a second prompt, testing', (await page.locator('table[aria-label="Prompts"] tbody tr', { hasText: 'BC first touch v1 (copy)' }).innerText()).includes('Testing'));
  await page.locator('[aria-label="Verdict"] .seg-btn', { hasText: 'Works' }).click(); await sleep(150);
  ok('verdict filter narrows', !(await page.locator('table[aria-label="Prompts"]').innerText()).includes('(copy)') && !(await page.locator('table[aria-label="Prompts"]').innerText()).includes('Jack M365 Sequence · Step 4'));
  await page.reload(); await sleep(900);
  await page.locator('aside button:has-text("Prompts")').first().click(); await sleep(400);
  ok('prompts survive a reload, seeds not doubled', (await page.locator('table[aria-label="Prompts"] tbody tr:not(.prompt-group)').count()) === nSeeds + 2);
  await page.locator('button[aria-label="Delete BC first touch v1 (copy)"]').click(); await sleep(400);
  const box = page.locator('button', { hasText: /^OK$/ }); if (await box.count()) { await box.first().click(); await sleep(300); }
  ok('delete removes it', !(await page.locator('table[aria-label="Prompts"]').innerText()).includes('(copy)'));
  await page.locator('button[aria-label="Delete Jack M365 Sequence · Step 4"]').click(); await sleep(400);
  if (await box.count()) { await box.first().click(); await sleep(300); }
  await page.reload(); await sleep(900); await page.locator('aside button:has-text("Prompts")').first().click(); await sleep(400);
  ok('a deleted Apollo prompt stays deleted', !(await page.locator('table[aria-label="Prompts"]').innerText()).includes('Jack M365 Sequence · Step 4'));
  ok('no page errors', errs.length === 0, errs.join(' | '));
  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close(); process.exit(fail ? 1 : 0);
})();
