const path=require('path');const esbuild=require('esbuild');
const entry=path.join(process.cwd(),'scripts/probes/real-file-columns.probe.ts');
const out=path.join(require('os').tmpdir(),`rfc-${process.pid}.mjs`);
esbuild.buildSync({entryPoints:[entry],bundle:true,platform:'node',format:'esm',outfile:out});
import(require('url').pathToFileURL(out).href).catch(e=>{console.error(String(e).slice(0,500));process.exit(1);});
