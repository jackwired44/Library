// Position buckets, checked against the most common real titles in Jack's
// files (15,311 rows surveyed; 65% have no title at all).
import { titleLevel, titleFunction } from "../../src/lib/titleLevel";
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { c ? pass++ : (fail++, console.log(`  FAIL ${n}${d ? " — " + d : ""}`)); };
const L = (t: string, want: string) => ok(`"${t}" -> ${want}`, titleLevel(t) === want, titleLevel(t));
// the top real titles
L("company administrator", "role"); L("IT manager", "manager"); L("IT", "staff"); L("IT director", "director");
L("POC", "role"); L("CEO", "csuite"); L("owner", "csuite"); L("manager", "manager"); L("CIO", "csuite");
L("president", "csuite"); L("admin", "staff"); L("TI", "staff"); L("billing administrator", "role"); L("CTO", "csuite");
L("director of IT", "director"); L("chief information officer", "csuite"); L("company administrator, information worker", "role");
L("principal", "csuite"); L("director of information technology", "director"); L("project manager", "manager");
L("partner", "role"); L("chief executive officer", "csuite"); L("vice president", "vp"); L("primary", "role");
L("buyer", "role"); L("technical contact", "role"); L("project owner", "manager"); L("vp of it", "vp");
L("personal user", "role"); L("systems administrator", "staff"); L("director of operations", "director");
L("general manager", "manager"); L("decision maker", "role");
// the traps
L("Contact Center Manager", "manager");
L("IT Director, Technical contact", "director");
L("Managing Partner", "csuite");
L("Senior Vice President of IT", "vp"); L("President & CEO", "csuite");
L("", "none"); L("NULL", "none"); L("N/A", "none"); L("undisclosed", "none");
// function
ok("IT manager is IT", titleFunction("IT manager") === "it");
ok("CIO is IT", titleFunction("CIO") === "it");
ok("CFO is business", titleFunction("CFO") === "business");
ok("Director of Operations is business", titleFunction("Director of Operations") === "business");
ok("Systems administrator is IT", titleFunction("Systems administrator") === "it");
ok("blank is unknown", titleFunction("") === "unknown");
console.log(`title-level ${fail ? "FAIL" : "PASS"} ${pass}/${pass + fail}`);
if (fail) process.exit(1);
