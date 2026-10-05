import { execSync } from "node:child_process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// A visible build stamp, because "is this the new build?" cost a whole
// session to answer once. The commit and the build time are baked in at
// compile time and rendered in the top bar, so an old copy of the HTML
// identifies itself instead of looking identical to a new one.
function buildId(): string {
  let sha = "nogit";
  try {
    sha = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    /* a build outside a checkout still gets a timestamp */
  }
  const when = new Date().toISOString().slice(0, 16).replace("T", " ");
  return `${sha} · ${when}`;
}

// This ships as one self-contained page, same spirit as the legacy build
// (one HTML file, zero external runtime dependencies) — see CLAUDE.md for
// why that constraint matters here (it's what makes the extension + the
// password-gated web version trivial to produce from the same build).
// assetsInlineLimit only inlines assets imported from within code (images,
// fonts) — it does NOT inline the main JS/CSS bundle Vite itself injects as
// <script src>/<link> tags, so viteSingleFile is what actually collapses
// those into the HTML too, producing one true self-contained file.
export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(buildId()) },
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: "dist",
    assetsInlineLimit: 100_000_000, // inline everything; no separate asset files to lose track of
    cssCodeSplit: false,
  },
});
