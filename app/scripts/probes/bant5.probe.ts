import { parseSmcLead } from "../../src/lib/smcLead";
import samples from "../fixtures/smc-samples.json";
for (const i of [5, 3, 4]) {
  const l = parseSmcLead((samples as string[])[i]);
  console.log(`row ${i} bant:`, JSON.stringify(l.bant));
}
const short = /(?:^|\s)B\s*[:–-]\s*(.*?)\s*A\s*[:–-]\s*(.*?)\s*N\s*[:–-]\s*(.*?)\s*T\s*[:–-]\s*(.*?)(?=\s*(?:P\s*[:–-]|•|Customer TPID|Lead I[dD]|$))/i;
console.log('\nrow 5 short-form match:', JSON.stringify(short.exec((samples as string[])[5])?.slice(1)));
