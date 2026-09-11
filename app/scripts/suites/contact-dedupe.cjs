// Committed regression suite. Run via `npm run suites` or standalone with
// `node scripts/suites/contact-dedupe.cjs`.
const path = require('path');
const esbuild = require('esbuild');
const entry = path.join(__dirname, 'contact-dedupe.probe.ts');
const out = path.join(require('os').tmpdir(), `contact-dedupe-${process.pid}.mjs`);
esbuild.buildSync({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile: out });
import(require('url').pathToFileURL(out).href).catch((e) => { console.error(e); process.exit(1); });
