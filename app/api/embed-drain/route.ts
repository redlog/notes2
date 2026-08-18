/**
 * The drain: turns queued chunks into embedded ones.
 *
 * Chunks are written on save with a NULL embedding — that NULL *is* the queue.
 * This route selects a batch, sends it to Voyage, and writes the vectors back.
 *
 * Keeping it out of the save path is the whole point: autosave fires every 30
 * seconds while typing, Voyage adds 200-500ms per call, and a Voyage outage
 * would otherwise fail note saves rather than merely delaying search freshness.
 *
 * Triggered by Vercel Cron (see vercel.json), or by hand during a backfill.
 */
import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { getProvider } from "@/lib/providers";
import {
  MAX_BATCH,
  embedDocuments,
  embeddingDim,
  embeddingModel,
  isEmbeddingConfigured,
} from "@/lib/embeddings";

/** One Voyage request per invocation, so a cron tick has a bounded runtime. */
const DEFAULT_BATCH = MAX_BATCH;

/**
 * Cron requests carry no user session, so they authenticate with a shared
 * secret instead. Without CRON_SECRET set, the route is session-only — it is
 * never left open.
 */
function isAuthorisedCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization");
  return header === `Bearer ${secret}`;
}

async function drain(request: Request): Promise<Response> {
  if (!isEmbeddingConfigured()) {
    return NextResponse.json(
      { ok: false, error: "VOYAGE_API_KEY is not set" },
      { status: 503 }
    );
  }

  const cron = isAuthorisedCron(request);
  const user = cron ? null : await getAuthUser();
  if (!cron && !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const batchSize = Math.min(
    Number(url.searchParams.get("batch") ?? DEFAULT_BATCH) || DEFAULT_BATCH,
    MAX_BATCH
  );
  const projectId = url.searchParams.get("project") ?? undefined;

  const provider = await getProvider();
  const pending = await provider.chunks.pending(batchSize, projectId);

  if (pending.length === 0) {
    return NextResponse.json({ ok: true, embedded: 0, remaining: 0 });
  }

  let vectors: number[][];
  try {
    vectors = await embedDocuments(pending.map((c) => c.embed_text));
  } catch (err) {
    // Left queued rather than marked failed: the rows still have NULL
    // embeddings, so the next tick retries them. A permanently poisoned chunk
    // would retry forever, which is visible as a pending count that never
    // falls — better than silently dropping content out of the index.
    const message = err instanceof Error ? err.message : String(err);
    console.error("[drain] embedding failed:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }

  await provider.chunks.writeEmbeddings(
    pending.map((c, i) => ({ id: c.id, embedding: vectors[i] })),
    embeddingModel(),
    embeddingDim()
  );

  const remaining = projectId ? await provider.chunks.pendingCount(projectId) : null;

  return NextResponse.json({
    ok: true,
    embedded: pending.length,
    model: embeddingModel(),
    dim: embeddingDim(),
    ...(remaining !== null ? { remaining } : {}),
  });
}

export async function GET(request: Request) {
  return drain(request);
}

export async function POST(request: Request) {
  return drain(request);
}
