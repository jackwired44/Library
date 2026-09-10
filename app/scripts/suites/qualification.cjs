// Committed regression suite. Run via `npm run suites` or standalone with
// `node scripts/suites/scan-integrity.cjs`.
//
// The qualification audit: does the scanner capture what Jack sells, and
// does it stay off what he does not want. Both halves run together on
// purpose — loosening a rule to fix a miss shows up immediately as a
// precision failure here rather than as noise in a real batch.
const path = require('path');
const esbuild = require('esbuild');

const entry = path.join(__dirname, 'qualification.probe.ts');
const out = path.join(require('os').tmpdir(), `qualification-${process.pid}.mjs`);
esbuild.buildSync({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile: out });
import(require('url').pathToFileURL(out).href).catch((e) => { console.error(e); process.exit(1); });
