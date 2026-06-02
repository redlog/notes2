/**
 * Provider interfaces for data operations.
 * Auth is handled separately via lib/auth.ts.
 *
 * Implementations:
 *   supabase  — Vercel + Supabase (default)
 *   gcp       — Cloud Run + Cloud SQL + GCS
 *   sqlite    — local-only, no auth, file-based image storage
 */

import type {
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
  ): Promise<{ id: number; title: string }[]>;
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

export interface ProjectsDataProvider {
  getActive(userId: string, projectId?: string): Promise<Project | null>;
  getUserProjects(userId: string): Promise<Project[]>;
  getUserSettings(userId: string): Promise<UserSettings>;
  create(userId: string, name: string): Promise<Project>;
  update(
    projectId: string,
    updates: Partial<Pick<Project, "name" | "trigram_search">>
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
}
