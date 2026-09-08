/**
 * Glue between the app and the embedding layer.
 *
 * Both entry points here are deliberately failure-tolerant: semantic search is
 * an enhancement over a lexical baseline that works on its own, so a Voyage
 * outage, a missing key, or a project with the feature switched off must
 * degrade to plain lexical search — never fail a request or a note save.
 */
import type { DataProvider } from "./providers/types";
import type { Project } from "./types";
import { chunkNote } from "./chunking";
import { embedQuery, isEmbeddingConfigured } from "./embeddings";

/** True when this project is set up to use embeddings at all. */
export function semanticEnabled(project: Pick<Project, "vector_search">): boolean {
  return project.vector_search && isEmbeddingConfigured();
}

/**
 * Embeds the search query, or returns undefined to stay lexical-only.
 *
 * Deliberately *not* gated on the sort key. It was, on the reasoning that the
 * date sorts do not rank so the Voyage round trip bought nothing — but the
 * embedding does not only order results, it decides which notes match at all.
 * Skipping it on a date sort dropped every semantic-only hit, so changing the
 * sort silently changed the result set. Sorting is presentation; the match set
 * is not. See docs/vector-search-and-rag.md §7.5.
 */
export async function embedSearchQuery(
  project: Pick<Project, "vector_search">,
  search: string
): Promise<number[] | undefined> {
  if (!semanticEnabled(project)) return undefined;
  if (!search.trim()) return undefined;

  try {
    return await embedQuery(search);
  } catch (err) {
    // Deliberately swallowed: the caller falls back to lexical ranking, which
    // is a worse result rather than a broken page. Logged so a persistently
    // failing key does not stay invisible.
    console.error("[semantic] query embedding failed, falling back to lexical:", err);
    return undefined;
  }
}

/**
 * Re-chunks a note and reconciles the stored chunks against it.
 *
 * Called after a successful save. Involves no network call — it is hash
 * comparison and a few row writes — so it is safe on the save path, and a
 * Voyage outage cannot make saving a note fail. New and edited chunks are left
 * with a NULL embedding for the drain to pick up.
 */
export async function syncNoteChunks(
  provider: DataProvider,
  noteId: number,
  project: Pick<Project, "id" | "vector_search">,
  title: string,
  body: string,
  createdAt: string
): Promise<void> {
  if (!project.vector_search) return;

  try {
    const chunks = chunkNote(title, body, createdAt);
    await provider.chunks.sync(noteId, project.id, chunks);
  } catch (err) {
    // A failed chunk sync must not fail the save — the note itself is already
    // written. The cost is a stale index until the note is next saved or a
    // reindex runs, which the pending count on the config page makes visible.
    console.error("[semantic] chunk sync failed for note", noteId, err);
  }
}
