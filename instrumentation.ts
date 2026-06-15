/**
 * Runs once when the Next.js server process starts. The node-only setup
 * lives in instrumentation-node.ts — it must be imported behind this exact
 * `process.env.NEXT_RUNTIME === "nodejs"` check so the edge runtime build
 * doesn't try to bundle node built-ins (fs, path, better-sqlite3).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
