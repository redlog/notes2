/**
 * Re-queues every chunk in a project for embedding.
 *
 * This is PRD §12.2's "Reindex", which had nothing to do while the index was
 * maintained inside the write. Embeddings change that: a model switch, an
 * interrupted backfill, or a chunk sync that failed after a save all leave the
 * vector index out of step with the notes, and nothing else repairs it.
 *
 * Clearing the embeddings *is* the reindex — the drain refills them, so
 * backfill and repair are the same code path and resuming is free.
 */
import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { getProvider } from "@/lib/providers";

export async function POST(request: Request) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await request.json();
  if (typeof projectId !== "string" || !projectId) {
    return NextResponse.json({ error: "Invalid projectId" }, { status: 400 });
  }

  const provider = await getProvider();

  const ownerId = await provider.projects.checkOwner(projectId);
  if (!ownerId || ownerId !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await provider.chunks.clearEmbeddings(projectId);
  const pending = await provider.chunks.pendingCount(projectId);

  return NextResponse.json({ ok: true, pending });
}
