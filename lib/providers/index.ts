/**
 * Provider factory.
 *
 * Reads the PROVIDER env var (defaults to "supabase") and returns the
 * appropriate DataProvider implementation.
 *
 * Supported values:
 *   supabase  — Vercel + Supabase (current default, no env var needed)
 *   gcp       — Cloud Run + Cloud SQL + GCS
 *               Required extra env vars: DATABASE_URL, GCS_BUCKET
 */

import type { DataProvider } from "./types";

export type { DataProvider } from "./types";
export type {
  NotesDataProvider,
  ProjectsDataProvider,
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

  throw new Error(
    `Unknown PROVIDER "${provider}". Supported values: supabase, gcp`
  );
}
