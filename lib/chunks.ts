/**
 * Chunk + embedding storage for the Supabase provider.
 *
 * The save path calls syncChunks(); the drain calls pendingChunks() and
 * writeEmbeddings(). See docs/vector-search-and-rag.md §5.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NoteChunk } from "./chunking";
import type { ChunkSyncResult, PendingChunk, RelatedNote } from "./types";
import { toVectorLiteral, embeddingModel } from "./embeddings";

/**
 * Reconciles stored chunks against freshly computed ones by content hash.
 *
 * This runs inside the note save, so it must stay pure database work: no
 * network call, no Voyage latency on the save path, and no possibility of a
 * Voyage outage failing a save. New and edited chunks land with a NULL
 * embedding, which is what enqueues them.
 *
 * The payoff is that autosave storms collapse — fixing a typo in one bullet of
 * a thirty-bullet note re-embeds one chunk, not thirty, because the other
 * twenty-nine hash identically every time.
 */
export async function syncChunks(
  supabase: SupabaseClient,
  noteId: number,
  projectId: string,
  chunks: NoteChunk[]
): Promise<ChunkSyncResult> {
  const { data: existingRows, error: readErr } = await supabase
    .from("note_chunks")
    .select("id, chunk_index, content_hash")
    .eq("note_id", noteId);
  if (readErr) throw readErr;

  const existing = new Map<number, { id: number; content_hash: string }>();
  for (const r of (existingRows ?? []) as {
    id: number;
    chunk_index: number;
    content_hash: string;
  }[]) {
    existing.set(r.chunk_index, { id: r.id, content_hash: r.content_hash });
  }

  const result: ChunkSyncResult = { inserted: 0, updated: 0, deleted: 0, unchanged: 0 };
  const toUpsert: Record<string, unknown>[] = [];

  for (const c of chunks) {
    const prior = existing.get(c.chunkIndex);
    if (prior && prior.content_hash === c.contentHash) {
      result.unchanged++;
      continue;
    }
    if (prior) result.updated++;
    else result.inserted++;

    toUpsert.push({
      note_id: noteId,
      project_id: projectId,
      chunk_index: c.chunkIndex,
      content: c.content,
      embed_text: c.embedText,
      content_hash: c.contentHash,
      token_count: c.tokenCount,
      // Explicitly cleared: an edited chunk must not keep the vector of its
      // previous text, or search would match on content that no longer exists.
      embedding: null,
      model: null,
      dim: null,
      embedded_at: null,
    });
  }

  if (toUpsert.length) {
    const { error } = await supabase
      .from("note_chunks")
      .upsert(toUpsert, { onConflict: "note_id,chunk_index" });
    if (error) throw error;
  }

  // Chunks past the end of the new list belong to text that no longer exists.
  const staleIndexes = [...existing.keys()].filter(
    (idx) => !chunks.some((c) => c.chunkIndex === idx)
  );
  if (staleIndexes.length) {
    const { error } = await supabase
      .from("note_chunks")
      .delete()
      .eq("note_id", noteId)
      .in("chunk_index", staleIndexes);
    if (error) throw error;
    result.deleted = staleIndexes.length;
  }

  return result;
}

export async function notesToChunk(
  supabase: SupabaseClient,
  projectId: string,
  afterId: number,
  limit: number
): Promise<{ id: number; title: string; body: string; created_at: string }[]> {
  const { data, error } = await supabase
    .from("notes")
    .select("id, title, body, created_at")
    .eq("project_id", projectId)
    .gt("id", afterId)
    .order("id", { ascending: true })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as { id: number; title: string; body: string; created_at: string }[];
}

export async function pendingChunks(
  supabase: SupabaseClient,
  limit: number,
  projectId?: string
): Promise<PendingChunk[]> {
  let q = supabase
    .from("note_chunks")
    .select("id, embed_text")
    .is("embedding", null)
    .order("id", { ascending: true })
    .limit(limit);
  if (projectId) q = q.eq("project_id", projectId);

  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as PendingChunk[];
}

export async function writeEmbeddings(
  supabase: SupabaseClient,
  rows: { id: number; embedding: number[] }[],
  model: string,
  dim: number
): Promise<void> {
  const now = new Date().toISOString();
  // Updated one row at a time on purpose: an upsert would need every NOT NULL
  // column restated, and getting that wrong would blank `content`/`embed_text`
  // rather than fail. Batches are at most 128.
  for (const r of rows) {
    const { error } = await supabase
      .from("note_chunks")
      .update({
        embedding: toVectorLiteral(r.embedding),
        model,
        dim,
        embedded_at: now,
      })
      .eq("id", r.id);
    if (error) throw error;
  }
}

export async function pendingChunkCount(
  supabase: SupabaseClient,
  projectId: string
): Promise<number> {
  const { count, error } = await supabase
    .from("note_chunks")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .is("embedding", null);
  if (error) throw error;
  return count ?? 0;
}

export async function relatedNotes(
  supabase: SupabaseClient,
  noteId: number,
  limit = 5
): Promise<RelatedNote[]> {
  const { data, error } = await supabase.rpc("related_notes", {
    p_note_id: noteId,
    p_limit: limit,
    p_model: embeddingModel(),
  });
  if (error) throw error;
  return ((data ?? []) as {
    out_id: number;
    out_title: string;
    out_created_at: string;
    out_score: number;
  }[]).map((r) => ({
    id: r.out_id,
    title: r.out_title,
    created_at: r.out_created_at,
    score: r.out_score,
  }));
}

export async function clearEmbeddings(
  supabase: SupabaseClient,
  projectId: string
): Promise<void> {
  const { error } = await supabase
    .from("note_chunks")
    .update({ embedding: null, model: null, dim: null, embedded_at: null })
    .eq("project_id", projectId);
  if (error) throw error;
}
