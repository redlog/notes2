/**
 * Node-runtime startup.
 *
 * Three jobs:
 *  1. For the SQLite provider, register shutdown handlers so the WAL is
 *     checkpointed (PRAGMA wal_checkpoint(TRUNCATE)) and the database
 *     connection is closed when the process exits — whether via Ctrl-C
 *     (SIGINT), SIGTERM, or normal process exit.
 *  2. Snapshot the database to SQLITE_BACKUP_PATH, if set, on a timer and at
 *     exit — the safe way to keep a copy in a synced folder.
 *  3. Run the embedding drain on a timer when there is no cron to do it.
 */
import { shutdownDb, backupDb } from "@/lib/providers/sqlite";

const isSqlite = (process.env.PROVIDER ?? "supabase") === "sqlite";

// ── Snapshot backups ─────────────────────────────────────────────────────────
// Set SQLITE_BACKUP_PATH to keep a consistent copy of the database somewhere
// else — a synced folder (OneDrive, Dropbox, iCloud) being the point.
//
// The live database must NOT live in a synced folder: the sync client reads
// the file while the app writes to it and stores a mix of old and new pages,
// which is how the database in docs/sqlite-corruption.md was destroyed. A
// snapshot has none of that problem. It is written by VACUUM INTO in one shot
// and never touched again, so the sync client only ever sees a finished,
// consistent file — exactly what sync clients handle safely.
//
// Backups run on a timer as well as at exit, because exit is the one moment
// that cannot be relied on: a crash, a kill, a closed console window or a lost
// power cable skips it entirely, and those are the cases a backup is for.
// Snapshotting costs ~250ms for a 100MB database and does not block writes.
const backupPath = process.env.SQLITE_BACKUP_PATH;
const backupEvery = Number(process.env.SQLITE_BACKUP_INTERVAL_SECONDS ?? 3600);

function runBackup(reason: string) {
  if (!backupPath) return;
  try {
    const { bytes, ms } = backupDb(backupPath);
    console.log(`[backup] ${reason}: ${(bytes / 1024 / 1024).toFixed(1)} MB in ${ms}ms`);
  } catch (err) {
    // Never allowed to take the server down or block a shutdown.
    console.error("[backup] failed:", err);
  }
}

if (isSqlite) {
  process.on("exit", () => {
    // Before shutdownDb(), which closes the connection the snapshot needs.
    // Exit handlers must be synchronous, and better-sqlite3 is.
    runBackup("on exit");
    shutdownDb();
  });
  process.on("SIGINT", () => process.exit(0));
  process.on("SIGTERM", () => process.exit(0));

  if (backupPath && Number.isFinite(backupEvery) && backupEvery > 0) {
    const timer = setInterval(() => runBackup("periodic"), backupEvery * 1000);
    timer.unref?.();
    console.log(`[backup] snapshot to ${backupPath} every ${backupEvery}s and on exit`);
  } else if (backupPath) {
    console.log(`[backup] snapshot to ${backupPath} on exit only`);
  }
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
const intervalSeconds = Number(intervalSetting ?? (isSqlite ? 180 : 0));

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
