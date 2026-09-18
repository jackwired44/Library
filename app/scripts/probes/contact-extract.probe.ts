// Are title / email / phone actually IN the blob and being dropped, or are
// they genuinely absent? Compares what the parser produced against what the
// raw text contains.
import { parseSmcLead } from "../../src/lib/smcLead";
import samples from "../fixtures/smc-samples.json";

const has = (t: string, label: RegExp) => label.test(t);
let dropped = 0;
(samples as string[]).forEach((d, i) => {
  const l = parseSmcLead(d);
  const rawHasEmail = /(^|\s)Email(Address)?\s*:\s*\S+@/i.test(d) || /@[a-z0-9.-]+\.[a-z]{2,}/i.test(d);
  const rawHasPhone = /(^|\s)(Phone|PhoneNumber|Main Phone Number)\s*:\s*\S/i.test(d);
  const rawHasTitle = /(^|\s)(Job\s*Title|JobTitle)\s*:\s*\S/i.test(d);
  const c = l.contacts;
  const gotEmail = c.some((x) => x.email);
  const gotPhone = c.some((x) => x.phone) || !!l.mainPhone;
  const gotTitle = c.some((x) => x.title);
  const flag = (raw: boolean, got: boolean) => (raw && !got ? "  <-- IN TEXT, NOT PARSED" : "");
  const miss = (raw: boolean, got: boolean) => (raw && !got ? 1 : 0);
  dropped += miss(rawHasEmail, gotEmail) + miss(rawHasPhone, gotPhone) + miss(rawHasTitle, gotTitle);
  console.log(
    `row ${String(i).padStart(2)} contacts=${c.length}` +
    ` | email raw=${rawHasEmail?'Y':'n'} parsed=${gotEmail?'Y':'n'}${flag(rawHasEmail,gotEmail)}` +
    ` | phone raw=${rawHasPhone?'Y':'n'} parsed=${gotPhone?'Y':'n'}${flag(rawHasPhone,gotPhone)}` +
    ` | title raw=${rawHasTitle?'Y':'n'} parsed=${gotTitle?'Y':'n'}${flag(rawHasTitle,gotTitle)}`
  );
});
console.log(`\nfields present in the text but not extracted: ${dropped}`);

console.log('\n--- multi-contact rows: does the FIRST contact carry the details? ---');
(samples as string[]).forEach((d, i) => {
  const l = parseSmcLead(d);
  if (l.contacts.length < 2) return;
  const c0 = l.contacts[0];
  const anyEmail = l.contacts.find((x) => x.email);
  const anyPhone = l.contacts.find((x) => x.phone);
  console.log(`row ${i}: ${l.contacts.length} contacts · first="${c0.firstName} ${c0.lastName}" email=${c0.email || 'NONE'} phone=${c0.phone || 'NONE'} title=${c0.title || 'NONE'}`);
  if (!c0.email && anyEmail) console.log(`   !! first contact has no email but contact "${anyEmail.firstName}" does -> shown blank today`);
  if (!c0.phone && anyPhone) console.log(`   !! first contact has no phone but contact "${anyPhone.firstName}" does -> shown blank today`);
});
