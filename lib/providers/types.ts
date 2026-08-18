/**
 * Provider interfaces for data operations.
 * Auth is handled separately via lib/auth.ts.
 *
 * Implementations:
 *   supabase  — Vercel + Supabase (default)
 *   gcp       — Cloud Run + Cloud SQL + GCS
 *   sqlite    — local-only, no auth, file-based image storage
 */

import type { NoteChunk } from "@/lib/chunking";
import type {
  ChunkSyncResult,
  PendingChunk,
  RelatedNote,
  ListParams,
  ListResult,
  Note,
  NoteImage,
  GalleryImage,
  TagCount,
  PersonCount,
  Project,
  UserSettings,
  SaveNoteResponse,
} from "@/lib/types";

export interface NotesDataProvider {
  list(params: ListParams): Promise<ListResult>;
  get(noteId: number): Promise<Note | null>;
  create(
    projectId: string,
    userId: string,
    title?: string,
    body?: string,
    tags?: string[],
    people?: string[]
  ): Promise<number>;
  save(
    noteId: number,
    title: string,
    body: string,
    tags: string[],
    people: string[],
    version: number
  ): Promise<SaveNoteResponse>;
  delete(noteId: number): Promise<void>;
  checkOwner(noteId: number): Promise<string | null>;
  moveToProject(noteId: number, projectId: string): Promise<void>;
  getVersions(
    noteId: number
  ): Promise<{ id: number; version: number; title: string; saved_at: string }[]>;
  getVersion(
    noteId: number,
    version: number
  ): Promise<{ version: number; title: string; body: string; saved_at: string } | null>;
  getTagCounts(projectId: string): Promise<TagCount[]>;
  getPersonCounts(projectId: string): Promise<PersonCount[]>;
  getSignedImageUrls(
    images: { img_num: number; storage_path: string }[],
    expiresIn?: number
  ): Promise<Record<number, string>>;
  searchTitles(
    projectId: string,
    query: string,
    limit?: number
  ): Promise<{ id: number; title: string; created_at: string }[]>;
  getEarliestNoteDate(projectId: string): Promise<string | null>;
  getTaglines(
    projectId: string,
    tag: string,
    page?: number,
    pageSize?: number
  ): Promise<{
    lines: { noteId: number; noteTitle: string; noteCreatedAt: string; line: string }[];
    total: number;
  }>;
  getRefTitles(ids: number[], userId: string): Promise<Map<number, string>>;

  // Image gallery
  listImages(
    projectId: string,
    page?: number,
    perPage?: number
  ): Promise<{ images: GalleryImage[]; total: number; page: number; perPage: number }>;

  // Inlinks (used by note view page)
  getInlinks(noteId: number): Promise<{ source_note_id: number; note_title: string }[]>;

  // Raw image record operations (used by upload/delete API routes)
  getImageRecords(noteId: number): Promise<NoteImage[]>;
  getImageRecord(noteId: number, imgNum: number): Promise<{ storage_path: string } | null>;
  getNextImageNum(noteId: number): Promise<number>;
  insertImageRecord(noteId: number, imgNum: number, storagePath: string): Promise<void>;
  deleteImageRecord(noteId: number, imgNum: number): Promise<void>;
}

/**
 * Chunk + embedding storage. This is the first search artifact the app has to
 * maintain itself: the tsvector column and the FTS5 table are both written by
 * the database inside the note write, but an embedding needs a network call, so
 * chunks are written with no embedding and filled in later by the drain.
 */
export interface ChunksDataProvider {
  /**
   * Reconciles a note's stored chunks against freshly computed ones by content
   * hash. Unchanged chunks keep their embedding; new or edited chunks are
   * (re)written with a NULL embedding, which is what queues them for the drain.
   * Pure database work — no network call, so it is safe on the save path.
   */
  sync(
    noteId: number,
    projectId: string,
    chunks: NoteChunk[]
  ): Promise<ChunkSyncResult>;

  /**
   * A page of notes for (re)chunking, keyed by an id cursor.
   *
   * Notes that already existed when semantic search was switched on have no
   * chunk rows at all — only the save path creates them — so the index has to
   * be built once over the back catalogue. Paged by id rather than offset so
   * the walk is stable and resumable.
   */
  notesToChunk(
    projectId: string,
    afterId: number,
    limit: number
  ): Promise<{ id: number; title: string; body: string; created_at: string }[]>;

  /** Chunks awaiting an embedding. The drain's work queue. */
  pending(limit: number, projectId?: string): Promise<PendingChunk[]>;

  /** Writes embeddings back, stamping the model and dimension used. */
  writeEmbeddings(
    rows: { id: number; embedding: number[] }[],
    model: string,
    dim: number
  ): Promise<void>;

  /** How many chunks are still queued — surfaced so a stalled drain is visible. */
  pendingCount(projectId: string): Promise<number>;

  /** Notes whose chunks are closest to this note's chunks. */
  related(noteId: number, limit?: number): Promise<RelatedNote[]>;

  /**
   * Clears every embedding in the project, re-queueing all chunks. This is what
   * a "Reindex" does — the drain refills them, so backfill and repair are the
   * same code path.
   */
  clearEmbeddings(projectId: string): Promise<void>;
}

export interface ProjectsDataProvider {
  getActive(userId: string, projectId?: string): Promise<Project | null>;
  getUserProjects(userId: string): Promise<Project[]>;
  getUserSettings(userId: string): Promise<UserSettings>;
  create(userId: string, name: string): Promise<Project>;
  update(
    projectId: string,
    updates: Partial<Pick<Project, "name" | "vector_search">>
  ): Promise<void>;
  delete(projectId: string): Promise<void>;
  checkOwner(projectId: string): Promise<string | null>;
  updateSettings(userId: string, updates: Partial<UserSettings>): Promise<void>;
  clearNotes(projectId: string): Promise<void>;
}

export interface BiosDataProvider {
  get(
    projectId: string,
    person: string
  ): Promise<{ content: string; updated_at: string | null }>;
  save(
    projectId: string,
    userId: string,
    person: string,
    content: string
  ): Promise<{ updated_at: string }>;
}

export interface DataProvider {
  notes: NotesDataProvider;
  projects: ProjectsDataProvider;
  bios: BiosDataProvider;
  chunks: ChunksDataProvider;
}
