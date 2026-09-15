// `window.claude` only exists when this app is running inside a claude.ai
// Artifact viewer that declared the relevant runtime capability (see the
// Artifact publish call's `capabilities` option) — a real deployed build
// or `npm run dev` never has it. Typed narrowly and locally rather than
// pulling the platform's own capability contract into this app's source
// tree, since the app has to keep working standalone too. Centralized here
// (rather than one `declare global` per capability) because TypeScript
// requires every `interface Window` merge across the whole program to
// agree on `claude`'s exact shape — a second, differently-typed
// declaration elsewhere is a compile error, not an override.
export interface ClaudeDownloadsNamespace {
  save(request: { filename: string; data: string }): Promise<{ status: "saved" }>;
}
// Shape of a tool result. `cache` is present ONLY when the runtime served
// this from its call cache: `storedAt` is when that result was originally
// produced, and the contract is explicit that a "last updated" indicator
// must be driven from it rather than Date.now() — otherwise a replayed
// cache entry reports itself as fresh.
export interface ClaudeMcpResult {
  payload?: unknown;
  cache?: { storedAt: number; revalidating: boolean };
}
export type ClaudeMcpWatchEvent =
  | { type: "data"; result: ClaudeMcpResult }
  | { type: "error"; error: unknown };

export interface ClaudeMcpNamespace {
  listTools(): Promise<{ servers: { server: string; authStatus: string; tools: { name: string }[] }[] }>;
  callTool(server: string, tool: string, input?: unknown): Promise<ClaudeMcpResult>;
  // The DISPLAY arm: replays any cached entry immediately, refreshes when
  // stale, and delivers every later result for the same identity —
  // including its own `refetchInterval` polls, which the runtime clamps to
  // a ~30s floor and pauses while the tab is hidden. Optional at runtime:
  // an older viewer may not implement it, so every call site must tolerate
  // its absence rather than assuming a live feed exists.
  watchTool?(
    server: string,
    tool: string,
    input: unknown,
    handler: (ev: ClaudeMcpWatchEvent) => void,
    options?: { cache?: { staleTime?: number; gcTime?: number }; refetchInterval?: number },
  ): () => void;
}
declare global {
  interface Window {
    claude?: {
      use(name: "downloads"): Promise<ClaudeDownloadsNamespace | null>;
      use(name: "mcp"): Promise<ClaudeMcpNamespace | null>;
    };
  }
}
