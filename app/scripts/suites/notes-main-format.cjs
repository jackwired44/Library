const path=require('path');const esbuild=require('esbuild');
const entry=path.join(process.cwd(),'scripts/suites/notes-main-format.probe.ts');
const out=path.join(require('os').tmpdir(),`notes-main-format-${process.pid}.mjs`);
esbuild.buildSync({entryPoints:[entry],bundle:true,platform:'node',format:'esm',outfile:out});
import(require('url').pathToFileURL(out).href).catch(e=>{console.error(e);process.exit(1);});
