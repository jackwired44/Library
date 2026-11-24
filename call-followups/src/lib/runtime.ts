// window.claude exists only inside a claude.ai Artifact viewer that granted
// the capability. Typed narrowly here, for exactly the calls this tool
// makes, so the page still builds and runs standalone (npm run dev) where
// every use() is simply absent.
export interface ClaudeMcpNamespace {
  listTools(): Promise<{ servers: { server: string; authStatus: string; tools: { name: string }[] }[] }>;
  callTool(server: string, tool: string, input?: unknown): Promise<{ payload?: unknown }>;
}
export interface ClaudeSampleOptions {
  modelTier?: "quick" | "default" | "complex";
  cache?: boolean;
  signal?: AbortSignal;
}
export interface ClaudeSampleFn {
  (input: string, options?: ClaudeSampleOptions): Promise<{ text: string; truncated: boolean }>;
  json(input: string, options?: ClaudeSampleOptions): Promise<unknown>;
}
export interface DbDocSnapshot { id: string; exists: boolean; data(): Record<string, unknown> | undefined }
export interface DbDocRef { get(): Promise<DbDocSnapshot>; set(data: Record<string, unknown>): Promise<void>; delete(): Promise<void> }
export interface DbQuery { limit(n: number): DbQuery; get(): Promise<{ docs: DbDocSnapshot[] }> }
export interface DbCollectionRef extends DbQuery { doc(id?: string): DbDocRef }
export interface ClaudeDb { collection(path: string): DbCollectionRef; doc(path: string): DbDocRef }
export interface ClaudeUser { id(): Promise<string> }

declare global {
  interface Window {
    claude?: {
      use(name: "mcp"): Promise<ClaudeMcpNamespace | null>;
      use(name: "sample"): Promise<ClaudeSampleFn | null>;
      use(name: "db"): Promise<ClaudeDb | null>;
      use(name: "user"): Promise<ClaudeUser | null>;
    };
  }
}

// use() resolves null after ~10s when no viewer answers. Cap the wait so a
// page opened outside a viewer falls back quickly instead of stalling.
export async function useCapability<T>(name: "mcp" | "sample" | "db" | "user", ms = 8000): Promise<T | null> {
  try {
    if (typeof window === "undefined" || !window.claude?.use) return null;
    const p = (window.claude.use as (n: string) => Promise<T | null>)(name);
    const timeout = new Promise<null>((r) => setTimeout(() => r(null), ms));
    return await Promise.race([p, timeout]);
  } catch {
    return null;
  }
}

// mcp.callTool rejects with a plain {code, message} object, never an Error.
export function describeConnectorError(err: unknown, connector = "Apollo"): string {
  if (err && typeof err === "object") {
    const e = err as { code?: string; message?: string };
    if (e.code === "needs_reauth") return `${connector}'s connection needs to be reconnected. Check claude.ai Settings → Connectors.`;
    if (e.code === "server_not_connected" || e.code === "selection_required") return `${connector} isn't connected. Add it in claude.ai Settings → Connectors, then try again.`;
    if (e.code === "not_granted") return `This page wasn't allowed to use ${connector}. Allow it from the page's Permissions menu.`;
    if (e.message) return e.message;
  }
  if (err instanceof Error) return err.message;
  return `${connector} call failed.`;
}
