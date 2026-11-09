// Main notes are direct for Document Intelligence, security, MSP / support, Azure infrastructure and migrations.
process.env.TZ = 'America/Chicago';
const path=require('path');const esbuild=require('esbuild');
const entry=path.join(process.cwd(),'scripts/suites/audit-rules.probe.ts');
const out=path.join(require('os').tmpdir(),`dn-${process.pid}.mjs`);
esbuild.buildSync({entryPoints:[entry],bundle:true,platform:'node',format:'esm',outfile:out});
import(require('url').pathToFileURL(out).href).catch(e=>{console.error(e);process.exit(1);});
