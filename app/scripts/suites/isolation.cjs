// Three scanners, one platform. Per Jack: "each of the three scanners
// remain purely different and nothing breaks and their rules remain theirs
// ... every time I receive data in a new way I am going to have to build a
// scanner." This suite pins the boundaries so a fourth scanner cannot
// quietly couple to the other three.
const fs = require('fs'), path = require('path');
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log('  PASS', n)) : (fail++, console.log('  FAIL', n, d)); };
const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');
const imports = (src) => [...src.matchAll(/^import\s[\s\S]*?from\s+"([^"]+)";/gm)].map((m) => m[1]);

console.log('=== engine modules import nothing from each other ===');
const ENGINES = {
  'Main Scanner': 'src/lib/detection.ts',
  'SMC (Cloud Ascent)': 'src/lib/smcLead.ts',
  'CSP (opportunities)': 'src/lib/cspRenewal.ts',
};
const OTHERS = { 'src/lib/detection.ts': 'detection', 'src/lib/smcLead.ts': 'smcLead', 'src/lib/cspRenewal.ts': 'cspRenewal' };
for (const [name, file] of Object.entries(ENGINES)) {
  const imp = imports(read(file));
  const bad = imp.filter((i) => Object.values(OTHERS).some((o) => i.endsWith(`/${o}`) || i === `./${o}`));
  ok(`${name} imports no other engine`, bad.length === 0, bad.join(', '));
}
const s2 = read('src/lib/scanner2.ts');
ok('scanner2 is the only composer, and takes only the shared column shape from detection',
   /import \{ EXPORT_LABELS, CATEGORY_META, type ExportRow \} from "\.\/detection";/.test(s2));
ok('detection.ts (Main Scanner) imports nothing at all — it cannot be broken from here', imports(read('src/lib/detection.ts')).length === 0);

console.log('\n=== rule vocabularies do not overlap ===');
const smc = read('src/lib/smcLead.ts'), csp = read('src/lib/cspRenewal.ts');
ok('CSP names no Cloud Ascent concept (propensity / fit / Act Now)', !/propensity|prioritization|\bAct Now\b/i.test(csp));
ok('SMC names no CSP concept (billing / partner of record / licensing programme)',
   !/billingRank|partnerOfRecord|licensingprogram/i.test(smc));
ok('CSP scores 0–100; SMC does not score at all', /score/.test(csp) && !/\bscore\b/i.test(smc));
ok('each engine owns its own rule type', /CspRules/.test(csp) && /SmcRules/.test(smc) && !/SmcRules/.test(csp) && !/CspRules/.test(smc));

console.log('\n=== storage is namespaced per scanner ===');
ok('rule sets are filtered by scanner kind', /loadRuleSets\(kind: ScannerKind = "smc"\)[\s\S]{0,220}scannerKindOf\(r\) === kind/.test(s2));
ok('runs are filtered by scanner kind', /loadRuns\(kind: ScannerKind = "smc"\)[\s\S]{0,220}scannerKindOf\(r\) === kind/.test(s2));
ok('curation keys are namespaced so one company is two decisions', /ruleSet\.mode === "csp" \? "csp:" : ""/.test(s2));
ok('a record saved before the CSP tab existed still reads as SMC', /scannerKindOf = [\s\S]{0,120}r\?\.scanner \?\? "smc"/.test(s2));

console.log('\n=== the shared layer is only plumbing ===');
const shared = ['profileColumns', 'guessFieldMapping', 'toApolloRow', 'SCANNER2_EXPORT_LABELS'];
for (const fn of shared) ok(`${fn} is defined once and shared`, (s2.match(new RegExp(`export (async )?(function|const) ${fn}\\b`, 'g')) || []).length === 1);
ok('CSV parsing lives in one module, used by every scanner', (read('src/lib/csv.ts').match(/export function parseCSVText/g) || []).length === 1);
ok('mode switch is explicit and exhaustive', /mode: "keywords" \| "smc" \| "csp"/.test(s2));
ok('a CSP row carries no product line, by design', /productLine = null;/.test(s2));
ok('an SMC row never carries a csp lead and vice versa', /let csp: CspLead \| undefined;/.test(s2) && /let smc: SmcLead \| undefined;/.test(s2));

console.log('\n=== the Main Scanner is untouched by any of this ===');
const det = read('src/lib/detection.ts');
ok('detection.ts knows nothing about scanner kinds', !/ScannerKind|scanner2|cspRenewal|smcLead/.test(det));
ok('its export labels are the single source of the CSV shape', /export const EXPORT_LABELS/.test(det));

console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
