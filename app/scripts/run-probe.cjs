// Bundle-and-run one .probe.ts. Same esbuild pattern every suite runner
// uses; takes the probe path as argv[2] and forwards the rest.
const path=require('path');const esbuild=require('esbuild');
const entry=path.join(process.cwd(),process.argv[2]);
const out=path.join(require('os').tmpdir(),`probe-${process.pid}.mjs`);
esbuild.buildSync({entryPoints:[entry],bundle:true,platform:'node',format:'esm',outfile:out});
process.argv.splice(2,1);
import(require('url').pathToFileURL(out).href).catch(e=>{console.error(e);process.exit(1);});
