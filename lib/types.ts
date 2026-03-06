export interface Project {
  id: string;
  user_id: string;
  name: string;
  trigram_search: boolean;
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

export type SortKey = "created_at" | "updated_at" | "relevance";
export type SortOrder = "asc" | "desc";

export interface ListParams {
  projectId: string;
  search?: string;
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
