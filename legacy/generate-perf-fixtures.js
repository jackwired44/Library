// Regenerates the synthetic CSV fixtures test-perf.js benchmarks against.
// Not committed to git (see .gitignore) — deterministic and cheap to
// rebuild, no reason to carry ~2MB of generated data in version control.
// Run: node generate-perf-fixtures.js
const fs = require("fs");
const path = require("path");

const COMMENTS = [
  "Planning to implement Dynamics 365 for about 30 users next quarter.",
  "Evaluating Power BI, planning to roll out this quarter.",
  "Migrating our on-prem servers to Azure this year, budget approved.",
  "Currently on Microsoft 365 Business Premium, 45 users, renewing licenses soon.",
  "Not interested at this time, already have an MSP.",
];

function buildCsv(n) {
  const lines = ["Company,Contact Name,Email,Title,Number of Employees,Comments"];
  for (let i = 0; i < n; i++) {
    const employees = 10 + ((i * 37) % 490); // deterministic spread, no Math.random needed
    const comment = COMMENTS[i % COMMENTS.length];
    lines.push(`Company ${i},Contact ${i},contact${i}@example.com,IT Director,${employees},"${comment}"`);
  }
  return lines.join("\n") + "\n";
}

[1000, 5000, 10000].forEach((n) => {
  const file = path.resolve(__dirname, `perf-test-${n}.csv`);
  fs.writeFileSync(file, buildCsv(n), "utf8");
  console.log(`Wrote ${file} (${n} rows)`);
});
