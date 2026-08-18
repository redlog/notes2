/**
 * Node-runtime startup.
 *
 * Two jobs:
 *  1. For the SQLite provider, register shutdown handlers so the WAL is
 *     checkpointed (PRAGMA wal_checkpoint(TRUNCATE)) and the database
 *     connection is closed when the process exits — whether via Ctrl-C
 *     (SIGINT), SIGTERM, or normal process exit.
 *  2. Run the embedding drain on a timer when there is no cron to do it.
 */
import { shutdownDb } from "@/lib/providers/sqlite";

if ((process.env.PROVIDER ?? "supabase") === "sqlite") {
  process.on("exit", shutdownDb);
  process.on("SIGINT", () => process.exit(0));
  process.on("SIGTERM", () => process.exit(0));
}

// ── Local embedding drain ────────────────────────────────────────────────────
// Vercel's cron runs the drain in the cloud, but at most once a day on the
// Hobby plan (see vercel.json) — and it does not run locally at all. A
// long-lived local server can just do it on a timer instead.
//
// Enabled by default in SQLite mode, which is exactly "running on a machine
// rather than on Vercel". Any other setup can opt in by setting the interval
// explicitly, which covers self-hosting the cloud provider without cron.
//
// Set EMBED_DRAIN_INTERVAL_SECONDS=0 to turn it off.
const intervalSetting = process.env.EMBED_DRAIN_INTERVAL_SECONDS;
const isLocalProvider = (process.env.PROVIDER ?? "supabase") === "sqlite";
const intervalSeconds = Number(intervalSetting ?? (isLocalProvider ? 180 : 0));

if (Number.isFinite(intervalSeconds) && intervalSeconds > 0) {
  // Imported lazily so the module graph for the non-draining case stays as it
  // was, and so a provider that cannot initialise here does not break startup.
  const tick = async () => {
    try {
      const [{ getProvider }, { drainUntilEmpty }, { isEmbeddingConfigured }] =
        await Promise.all([
          import("@/lib/providers"),
          import("@/lib/drain"),
          import("@/lib/embeddings"),
        ]);

      if (!isEmbeddingConfigured()) return;

      const provider = await getProvider();
      const result = await drainUntilEmpty(provider);
      if (result.embedded > 0) {
        console.log(`[drain] embedded ${result.embedded} chunk(s)`);
      }
    } catch (err) {
      // Never allowed to take the server down: a failing drain means search is
      // stale, which the pending count on the config page already surfaces.
      console.error("[drain] local tick failed:", err);
    }
  };

  // Deliberately not fired immediately — let the server finish coming up first.
  const timer = setInterval(tick, intervalSeconds * 1000);
  // Does not keep the process alive on its own, so Ctrl-C still exits at once.
  timer.unref?.();

  console.log(`[drain] local embedding drain every ${intervalSeconds}s`);
}
