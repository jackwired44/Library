// Dates in these checks are about the browser's own day, so pin the zone.
process.env.TZ = 'America/Chicago';
const path=require('path');const esbuild=require('esbuild');
const entry=path.join(process.cwd(),'scripts/suites/review-fixes.probe.ts');
const out=path.join(require('os').tmpdir(),`rf-${process.pid}.mjs`);
esbuild.buildSync({entryPoints:[entry],bundle:true,platform:'node',format:'esm',outfile:out});
import(require('url').pathToFileURL(out).href).catch(e=>{console.error(e);process.exit(1);});
