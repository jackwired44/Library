// Unit suite. Run with `npm run test:unit`.
//
// Follow-ups: Trellus note parsing, local-day ranges, call selection,
// one-row-per-contact, sticky merge, the banned-word checker, and the
// email structure Jack specified.
const path = require('path');
const esbuild = require('esbuild');
const entry = path.join(__dirname, 'followups.probe.ts');
const out = path.join(require('os').tmpdir(), `followups-${process.pid}.mjs`);
process.env.TZ = 'America/Chicago'; // the date-range checks are written for Central
esbuild.buildSync({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile: out });
import(require('url').pathToFileURL(out).href).catch((e) => { console.error(e); process.exit(1); });
