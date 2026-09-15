// Committed regression suite. Run via `npm run suites` or standalone with
// `node scripts/suites/snippet-capture.cjs`.
//
// Snippet quality + capture gaps + the precision cost of closing them.
const path = require('path');
const esbuild = require('esbuild');
const entry = path.join(__dirname, 'snippet-capture.probe.ts');
const out = path.join(require('os').tmpdir(), `snippet-capture-${process.pid}.mjs`);
esbuild.buildSync({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile: out });
import(require('url').pathToFileURL(out).href).catch((e) => { console.error(e); process.exit(1); });
