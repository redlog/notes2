export interface Project {
  id: string;
  user_id: string;
  name: string;
  /** Opt-in: embeds this project's notes with Voyage AI for semantic search. */
  vector_search: boolean;
  created_at: string;
}

export interface Note {
  id: number;
  project_id: string;
  user_id: string;
  title: string;
  body: string;
  version: number;
  created_at: string;
  updated_at: string;
  tags: NoteTag[];
  people: NotePerson[];
  images: NoteImage[];
}

export interface NoteTag {
  tag: string;
  is_header: boolean;
}

export interface NotePerson {
  person: string;
  is_header: boolean;
}

export interface NoteImage {
  img_num: number;
  storage_path: string;
}

export interface GalleryImage {
  note_id: number;
  note_title: string;
  note_created_at: string;
  img_num: number;
  storage_path: string;
  signed_url: string;
}

export interface NoteListItem {
  id: number;
  title: string;
  created_at: string;
  updated_at: string;
  tags: NoteTag[];
  people: NotePerson[];
  score?: number;
  preview?: string;
}

export interface UserSettings {
  notes_per_page: number;
  autosave_enabled: boolean;
  autosave_interval: number;
}

export interface TagCount {
  tag: string;
  count: number;
  header_count: number;
}

export interface PersonCount {
  person: string;
  count: number;
  header_count: number;
}

export interface RelatedNote {
  id: number;
  title: string;
  created_at: string;
  /** Cosine similarity 0..1; higher is closer. */
  score: number;
}

/** One chunk awaiting an embedding — the drain's unit of work. */
export interface PendingChunk {
  id: number;
  embed_text: string;
}

export interface ChunkSyncResult {
  inserted: number;
  updated: number;
  deleted: number;
  unchanged: number;
}

export type SortKey = "created_at" | "updated_at" | "relevance";
export type SortOrder = "asc" | "desc";

export interface ListParams {
  projectId: string;
  search?: string;
  /**
   * Query embedding for hybrid search. When present the relevance path fuses
   * lexical and semantic rankings with RRF; when absent it stays purely
   * lexical. Callers embed the query — providers never call Voyage themselves.
   */
  queryEmbedding?: number[];
  filter?: string;
  page?: number;
  perPage?: number;
  sortKey?: SortKey;
  sortOrder?: SortOrder;
  timeMin?: string;
  timeMax?: string;
}

export interface ListResult {
  notes: NoteListItem[];
  total: number;
  page: number;
  perPage: number;
  sortKey: SortKey;
  sortOrder: SortOrder;
}

export interface SaveNoteRequest {
  noteId: number;
  title: string;
  body: string;
  tags: string[];
  people: string[];
  version: number;
}

export interface SaveNoteResponse {
  ok: boolean;
  version?: number;
  updated_at?: string;
  conflict?: boolean;
  currentBody?: string;
  error?: string;
}
