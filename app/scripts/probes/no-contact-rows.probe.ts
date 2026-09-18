import { parseSmcLead } from "../../src/lib/smcLead";
import samples from "../fixtures/smc-samples.json";
(samples as string[]).forEach((d, i) => {
  const l = parseSmcLead(d);
  if (l.contacts.length) return;
  console.log(`===== row ${i} — no contact parsed (${d.length} chars) =====`);
  console.log(d.slice(0, 620));
  console.log("");
});
