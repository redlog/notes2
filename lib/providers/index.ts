/**
 * Provider factory.
 *
 * Reads the PROVIDER env var (defaults to "supabase") and returns the
 * appropriate DataProvider implementation.
 *
 * Supported values:
 *   supabase  — Vercel + Supabase (default, no env var needed)
 *   gcp       — Cloud Run + Cloud SQL + GCS
 *               Required env vars: DATABASE_URL, GCS_BUCKET
 *   sqlite    — local-only, no auth
 *               Optional env vars: SQLITE_DB_PATH, LOCAL_IMAGES_DIR
 */

import type { DataProvider } from "./types";

export type { DataProvider } from "./types";
export type {
  NotesDataProvider,
  ProjectsDataProvider,
  BiosDataProvider,
} from "./types";

export async function getProvider(): Promise<DataProvider> {
  const provider = process.env.PROVIDER ?? "supabase";

  if (provider === "supabase") {
    const { createSupabaseProvider } = await import("./supabase");
    return createSupabaseProvider();
  }

  if (provider === "gcp") {
    const { createGcpProvider } = await import("./gcp");
    return createGcpProvider();
  }

  if (provider === "sqlite") {
    const { createSqliteProvider } = await import("./sqlite");
    return createSqliteProvider();
  }

  throw new Error(
    `Unknown PROVIDER "${provider}". Supported values: supabase, gcp, sqlite`
  );
}
