// Power Platform product line, the Dynamics Power Platform tab, and the merged M365 tab (2026-11-22).
process.env.TZ = 'America/Chicago';
const path=require('path');const esbuild=require('esbuild');
const entry=path.join(process.cwd(),'scripts/suites/power-platform.probe.ts');
const out=path.join(require('os').tmpdir(),`pp-${process.pid}.mjs`);
esbuild.buildSync({entryPoints:[entry],bundle:true,platform:'node',format:'esm',outfile:out});
import(require('url').pathToFileURL(out).href).catch(e=>{console.error(e);process.exit(1);});
