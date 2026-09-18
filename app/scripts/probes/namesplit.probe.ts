import { parseSmcLead } from "../../src/lib/smcLead";
import samples from "../fixtures/smc-samples.json";
let both = 0, firstOnly = 0, none = 0, total = 0;
for (const d of samples as string[]) {
  const l = parseSmcLead(d);
  for (const c of l.contacts) {
    total++;
    if (c.firstName && c.lastName) both++;
    else if (c.firstName || c.lastName) firstOnly++;
    else none++;
  }
}
console.log(`contacts parsed from the blobs: ${total}`);
console.log(`  first AND last present : ${both}`);
console.log(`  only one of the two    : ${firstOnly}`);
console.log(`  neither                : ${none}`);
const ex = (samples as string[]).flatMap(d => parseSmcLead(d).contacts).slice(0, 6);
for (const c of ex) console.log(`  e.g. "${c.firstName}" | "${c.lastName}"`);
