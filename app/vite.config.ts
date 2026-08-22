import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// This ships as one self-contained page, same spirit as the legacy build
// (one HTML file, zero external runtime dependencies) — see CLAUDE.md for
// why that constraint matters here (it's what makes the extension + the
// password-gated web version trivial to produce from the same build).
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    assetsInlineLimit: 100_000_000, // inline everything; no separate asset files to lose track of
    cssCodeSplit: false,
  },
});
