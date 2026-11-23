// Builds dist/sequence-hygiene.html: one self-contained page (styles and scripts inlined).
// Run: node sequence-hygiene/build.js
const fs = require("fs");
const path = require("path");
const src = (f) => fs.readFileSync(path.join(__dirname, "src", f), "utf8");
const scripts = ["config.js", "rules.js", "collect.js", "demo.js", "app.js"].map(src).join("\n;\n")
  .replace(/<\/script/gi, "<\\/script");
const html = src("shell.html").replace("/*STYLES*/", () => src("styles.css")).replace("/*SCRIPTS*/", () => scripts);
fs.mkdirSync(path.join(__dirname, "dist"), { recursive: true });
const out = path.join(__dirname, "dist", "sequence-hygiene.html");
fs.writeFileSync(out, html);
console.log(`Wrote ${out} (${(html.length / 1024).toFixed(1)} KB)`);
