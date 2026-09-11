// Committed regression suite. Run via `npm run suites` or standalone with
// `node scripts/suites/scan-integrity.cjs`.
//
// Unlike the other suites this one needs no browser: it exercises the
// detection pipeline directly, which is the right level for the questions
// it asks. These are the invariants Jack's scanner has to hold every day —
// nothing is lost silently, the arithmetic reconciles, and the same files
// always produce the same answer no matter what order they are dropped in.
// That last one was a real defect: the same batch scanned twice gave
// 170 Strong Signal one way and 188 the other.
const path = require('path');
const esbuild = require('esbuild');

const entry = path.join(__dirname, 'metrics-integrity.probe.ts');
const out = path.join(require('os').tmpdir(), `metrics-integrity-${process.pid}.mjs`);
esbuild.buildSync({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile: out });
import(require('url').pathToFileURL(out).href).catch((e) => { console.error(e); process.exit(1); });
