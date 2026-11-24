#!/usr/bin/env node
// Runs every suite against one preview server. `npm test` builds first.
const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const http = require("http");
const PORT = 4174;
const dir = path.join(__dirname, "suites");
const up = () => new Promise((r) => { const q = http.get(`http://localhost:${PORT}`, (res) => { res.resume(); r(res.statusCode === 200); }); q.on("error", () => r(false)); });
(async () => {
  const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], { cwd: path.join(__dirname, ".."), stdio: "ignore" });
  for (let i = 0; i < 40 && !(await up()); i++) await new Promise((r) => setTimeout(r, 250));
  let failed = 0;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".cjs")).sort()) {
    const needsDisplay = f.includes("-ui");
    const cmd = needsDisplay && !process.env.DISPLAY ? ["xvfb-run", ["-a", "node", path.join(dir, f)]] : ["node", [path.join(dir, f)]];
    const r = spawnSync(cmd[0], cmd[1], { stdio: "inherit", env: { ...process.env, BASE: `http://localhost:${PORT}` } });
    console.log(`${f.padEnd(24)} ${r.status === 0 ? "ok" : "FAIL"}`);
    if (r.status !== 0) failed++;
  }
  server.kill();
  process.exit(failed ? 1 : 0);
})();
