// Committed regression suite. Run via `npm test` or standalone with
// `node scripts/suites/blocklist.cjs`.
//
// Companies that are never a lead, on ANY scanner — per Jack, "for any
// scanner if there ever is a company called contess remove it instantly".
// Half of this suite is negative cases on purpose: the match is EXACT, and
// the reason is that Contessa is a real company a prefix rule would delete.
const path = require('path');
const esbuild = require('esbuild');

const entry = path.join(__dirname, 'blocklist.probe.ts');
const out = path.join(require('os').tmpdir(), `blocklist-${process.pid}.mjs`);
esbuild.buildSync({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile: out });
import(require('url').pathToFileURL(out).href).catch((e) => { console.error(e); process.exit(1); });
