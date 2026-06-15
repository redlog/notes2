/**
 * Node-runtime startup. For the SQLite provider, registers shutdown
 * handlers so the WAL is checkpointed (PRAGMA wal_checkpoint(TRUNCATE))
 * and the database connection is closed when the process exits — whether
 * via Ctrl-C (SIGINT), SIGTERM, or normal process exit.
 */
import { shutdownDb } from "@/lib/providers/sqlite";

if ((process.env.PROVIDER ?? "supabase") === "sqlite") {
  process.on("exit", shutdownDb);
  process.on("SIGINT", () => process.exit(0));
  process.on("SIGTERM", () => process.exit(0));
}
