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
 * Invoked by the Vercel cron in vercel.json (daily — see the note there), by
 * the Settings page, and by a local ticker in development. The save path also
 * drains opportunistically via after(), so on Vercel the cron is a safety net
 * rather than the primary mechanism.
 */
import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { getProvider } from "@/lib/providers";
import { drainOnce } from "@/lib/drain";
import { MAX_BATCH, embeddingDim, embeddingModel, isEmbeddingConfigured } from "@/lib/embeddings";

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
    Number(url.searchParams.get("batch") ?? MAX_BATCH) || MAX_BATCH,
    MAX_BATCH
  );
  const projectId = url.searchParams.get("project") ?? undefined;

  const provider = await getProvider();
  const result = await drainOnce(provider, { limit: batchSize, projectId });

  if (result.error) {
    // Rows are left queued rather than marked failed, so the next pass retries
    // them. A permanently poisoned chunk therefore retries forever, which shows
    // up as a pending count that never falls — better than silently dropping
    // content out of the index.
    return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
  }

  const remaining = projectId ? await provider.chunks.pendingCount(projectId) : null;

  return NextResponse.json({
    ok: true,
    embedded: result.embedded,
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
