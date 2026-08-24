import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// This ships as one self-contained page, same spirit as the legacy build
// (one HTML file, zero external runtime dependencies) — see CLAUDE.md for
// why that constraint matters here (it's what makes the extension + the
// password-gated web version trivial to produce from the same build).
// assetsInlineLimit only inlines assets imported from within code (images,
// fonts) — it does NOT inline the main JS/CSS bundle Vite itself injects as
// <script src>/<link> tags, so viteSingleFile is what actually collapses
// those into the HTML too, producing one true self-contained file.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: "dist",
    assetsInlineLimit: 100_000_000, // inline everything; no separate asset files to lose track of
    cssCodeSplit: false,
  },
});
