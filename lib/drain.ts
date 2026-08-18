/**
 * The embedding drain, as a plain function.
 *
 * Extracted from the route so it can be invoked three ways without any of them
 * going through HTTP:
 *   - /api/embed-drain          — cron and the Settings "Build index" button
 *   - after() on the save path  — keeps the index fresh between cron ticks
 *   - the local dev ticker      — instrumentation-node.ts
 */
import type { DataProvider } from "./providers/types";
import {
  MAX_BATCH,
  embedDocuments,
  embeddingDim,
  embeddingModel,
  isEmbeddingConfigured,
} from "./embeddings";

export interface DrainResult {
  embedded: number;
  error?: string;
}

/**
 * Embeds up to one API batch of queued chunks.
 *
 * Never throws: every caller treats a failed drain as "the index is stale for
 * now", which is the correct posture — a Voyage outage must not fail a save, a
 * page render, or a cron invocation. Failed rows keep their NULL embedding and
 * are retried on the next pass.
 */
export async function drainOnce(
  provider: DataProvider,
  options: { limit?: number; projectId?: string } = {}
): Promise<DrainResult> {
  if (!isEmbeddingConfigured()) return { embedded: 0, error: "VOYAGE_API_KEY is not set" };

  const limit = Math.min(options.limit ?? MAX_BATCH, MAX_BATCH);

  try {
    const pending = await provider.chunks.pending(limit, options.projectId);
    if (pending.length === 0) return { embedded: 0 };

    const vectors = await embedDocuments(pending.map((c) => c.embed_text));

    await provider.chunks.writeEmbeddings(
      pending.map((c, i) => ({ id: c.id, embedding: vectors[i] })),
      embeddingModel(),
      embeddingDim()
    );

    return { embedded: pending.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[drain]", message);
    return { embedded: 0, error: message };
  }
}

/**
 * Drains repeatedly until the queue is empty or `maxRounds` is reached.
 *
 * The round cap is a safety rail, not a tuning knob: without it a large
 * backfill would hold a serverless invocation open until it timed out, and a
 * chunk that fails deterministically would spin forever.
 */
export async function drainUntilEmpty(
  provider: DataProvider,
  options: { projectId?: string; maxRounds?: number } = {}
): Promise<DrainResult> {
  const maxRounds = options.maxRounds ?? 20;
  let embedded = 0;

  for (let round = 0; round < maxRounds; round++) {
    const result = await drainOnce(provider, { projectId: options.projectId });
    if (result.error) return { embedded, error: result.error };
    if (result.embedded === 0) break;
    embedded += result.embedded;
  }

  return { embedded };
}
