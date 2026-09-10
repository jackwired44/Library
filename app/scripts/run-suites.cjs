#!/usr/bin/env node
// Runs every committed regression suite against ONE preview server.
//
// Why this exists: the suites used to live in a session scratchpad and
// each pointed at its own hardcoded port, so "all suites green" was a
// claim nobody could re-check from a fresh clone. Now:
//
//   npm run build && npm run suites
//
// Each suite is a standalone Playwright script that exits non-zero on
// failure; this only sequences them and sums the result. Pass a filter
// to run a subset: `npm run suites -- sequence`.
const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const http = require("http");

const PORT = Number(process.env.PORT || 4173);
const BASE = `http://localhost:${PORT}`;
const SUITES_DIR = path.join(__dirname, "suites");
const filter = process.argv[2] || "";

const suites = fs
  .readdirSync(SUITES_DIR)
  .filter((f) => f.endsWith(".cjs"))
  .filter((f) => !filter || f.includes(filter))
  .sort();

if (!fs.existsSync(path.join(__dirname, "..", "dist", "index.html"))) {
  console.error("No dist/ build found. Run `npm run build` first.");
  process.exit(1);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function serverUp() {
  return new Promise((resolve) => {
    const req = http.get(BASE, (res) => { res.resume(); resolve(res.statusCode === 200); });
    req.on("error", () => resolve(false));
    req.setTimeout(1500, () => { req.destroy(); resolve(false); });
  });
}

(async () => {
  let preview = null;
  if (!(await serverUp())) {
    preview = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], {
      cwd: path.join(__dirname, ".."),
      stdio: "ignore",
      detached: true,
    });
    for (let i = 0; i < 25 && !(await serverUp()); i++) await wait(600);
    if (!(await serverUp())) {
      console.error(`Preview server never came up on ${BASE}.`);
      process.exit(1);
    }
  }

  // Node scripts (no browser) run directly; Playwright suites need a
  // display, so use xvfb-run when there isn't one.
  const hasDisplay = Boolean(process.env.DISPLAY);
  const results = [];
  for (const file of suites) {
    const full = path.join(SUITES_DIR, file);
    const name = file.replace(/\.cjs$/, "");
    process.stdout.write(`${name.padEnd(22)} `);
    const cmd = hasDisplay ? "node" : "xvfb-run";
    const args = hasDisplay ? [full] : ["-a", "node", full];
    const r = spawnSync(cmd, args, {
      env: { ...process.env, BASE },
      encoding: "utf8",
      timeout: 15 * 60 * 1000,
    });
    const out = `${r.stdout || ""}${r.stderr || ""}`;
    const tally = (out.match(/(\d+)\s*\/\s*(\d+)/g) || []).pop() || "";
    // Belt and braces: a suite that forgets to set an exit code would
    // otherwise report PASS next to a losing tally, which is exactly how
    // two real failures hid in audit-fixes. If the tally says some checks
    // failed, that is a failure regardless of the exit status.
    const m = /(\d+)\s*\/\s*(\d+)/.exec(tally);
    const tallyOk = !m || Number(m[1]) === Number(m[2]);
    const ok = r.status === 0 && tallyOk;
    results.push({ name, ok, tally, out });
    console.log(ok ? `PASS ${tally}` : `FAIL ${tally}`);
  }

  // The pure-Node send test lives outside suites/ — run it too.
  const sendTest = path.join(__dirname, "test-email-send.mjs");
  if (fs.existsSync(sendTest) && (!filter || "email-send".includes(filter))) {
    process.stdout.write("email-send".padEnd(23));
    const r = spawnSync("npx", ["tsx", sendTest], { encoding: "utf8", cwd: path.join(__dirname, "..") });
    const out = `${r.stdout || ""}${r.stderr || ""}`;
    const tally = (out.match(/(\d+)\s*\/\s*(\d+)/g) || []).pop() || "";
    results.push({ name: "email-send", ok: r.status === 0, tally, out });
    console.log(r.status === 0 ? `PASS ${tally}` : `FAIL ${tally}`);
  }

  if (preview) { try { process.kill(-preview.pid); } catch { /* already gone */ } }

  const failed = results.filter((r) => !r.ok);
  const checks = results.reduce((n, r) => {
    const m = /(\d+)\s*\/\s*(\d+)/.exec(r.tally || "");
    return n + (m ? Number(m[2]) : 0);
  }, 0);
  console.log(`\n${results.length - failed.length}/${results.length} suites passed · ${checks} checks`);
  if (failed.length) {
    console.log("\nFailures:");
    failed.forEach((f) => {
      console.log(`\n=== ${f.name} ===`);
      console.log(f.out.split("\n").filter((l) => /FAIL|CRASH|Error/.test(l)).slice(0, 6).join("\n"));
    });
    process.exit(1);
  }
})();
