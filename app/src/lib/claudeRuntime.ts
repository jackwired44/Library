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
export interface ClaudeMcpNamespace {
  listTools(): Promise<{ servers: { server: string; authStatus: string; tools: { name: string }[] }[] }>;
  callTool(server: string, tool: string, input?: unknown): Promise<{ payload?: unknown }>;
}
// The `sample` capability: ask Claude on the viewer's own account. Each
// call is memoryless; the prompt carries everything.
export interface ClaudeSampleOptions {
  modelTier?: "quick" | "default" | "complex";
  cache?: boolean;
  signal?: AbortSignal;
}
export interface ClaudeSampleFn {
  (input: string, options?: ClaudeSampleOptions): Promise<{ text: string; truncated: boolean }>;
  json(input: string, options?: ClaudeSampleOptions): Promise<unknown>;
}
declare global {
  interface Window {
    claude?: {
      use(name: "downloads"): Promise<ClaudeDownloadsNamespace | null>;
      use(name: "mcp"): Promise<ClaudeMcpNamespace | null>;
      use(name: "sample"): Promise<ClaudeSampleFn | null>;
    };
  }
}
