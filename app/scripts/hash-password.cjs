// Prints the hash to paste into src/lib/auth.ts's PASSWORD_HASH constant.
// Usage: npm run hash-password -- "your new password"
const crypto = require("crypto");

const APP_SALT = "wired-cio-lead-scanner-v1"; // must match auth.ts exactly
const password = process.argv[2];

if (!password) {
  console.error('Usage: npm run hash-password -- "your new password"');
  process.exit(1);
}

const hash = crypto.createHash("sha256").update(`${APP_SALT}:${password}`).digest("hex");
console.log(hash);
