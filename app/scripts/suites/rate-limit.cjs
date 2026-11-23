// Apollo's rate-limit refusals, read rather than assumed. Per Jack, 11/22,
// pasting the real one: the DAILY cap (2,000 contact searches) came back
// "retry_after_seconds: 56815", and the app reported every refusal as the
// hourly cap — sending him back into the same wall an hour later.
process.env.TZ = 'America/Chicago';
const path=require('path');const esbuild=require('esbuild');
const entry=path.join(process.cwd(),'scripts/suites/rate-limit.probe.ts');
const out=path.join(require('os').tmpdir(),`rl-${process.pid}.mjs`);
esbuild.buildSync({entryPoints:[entry],bundle:true,platform:'node',format:'esm',outfile:out});
import(require('url').pathToFileURL(out).href).catch(e=>{console.error(e);process.exit(1);});
