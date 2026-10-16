// Per Jack: "says all strong signal is 91 but has 887". A name-only Apollo
// match must agree on company, or a different person with the same name is
// taken out of every download.
import { buildRosterIndex, apolloHitFor, sameCompany } from "../../src/lib/apolloRoster";
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) pass++; else { fail++; console.log("✗", n, d); } };
const idx = buildRosterIndex([
  { key: "x:john smith", name: "John Smith", email: "", company: "Acme Manufacturing", sequences: ["Carly Main Sequence"], syncedAt: "" },
  { key: "e:dana@diaz.io", name: "Dana Diaz", email: "dana@diaz.io", company: "Diaz Consulting", sequences: [], syncedAt: "" },
  { key: "x:pat lee", name: "Pat Lee", email: "", company: "", sequences: [], syncedAt: "" },
]);
ok("same name, same company: in Apollo", !!apolloHitFor({ contact: "John Smith", company: "Acme Manufacturing, Inc." }, idx));
ok("same name, company is a shorter form: in Apollo", !!apolloHitFor({ contact: "John Smith", company: "Acme" }, idx));
ok("same name, different company: NOT in Apollo", !apolloHitFor({ contact: "John Smith", company: "Brightway Logistics" }, idx));
ok("same name, row has no company: name match stands", apolloHitFor({ contact: "John Smith" }, idx)?.how === "name");
ok("roster has no company: name match stands", !!apolloHitFor({ contact: "Pat Lee", company: "Anything Co" }, idx));
ok("email match ignores company", apolloHitFor({ email: "dana@diaz.io", contact: "Dana Diaz", company: "Other Co" }, idx)?.how === "email");
ok("same name, different email, different company: NOT in Apollo", !apolloHitFor({ email: "dana@other.com", contact: "Dana Diaz", company: "Other Co" }, idx));
ok("sameCompany strips suffixes", sameCompany("The Acme Group, LLC", "acme"));
ok("sameCompany: blanks never agree", !sameCompany("", "Acme"));
console.log(`\n${pass}/${pass + fail} checks passed`);
if (fail) process.exit(1);
