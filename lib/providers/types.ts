/**
 * Provider interfaces for data operations.
 * Auth and file storage are handled separately (not part of this abstraction).
 *
 * The Supabase implementation lives in ./supabase/index.ts.
 * A future GCP implementation would live in ./gcp/index.ts.
 */

import type {
  ListParams,
  ListResult,
  Note,
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
  /** Returns the owner user_id, or null if the note doesn't exist. */
  checkOwner(noteId: number): Promise<string | null>;
  /** Moves a note to a different project (no ownership check — caller must verify). */
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
  /** Fetches id→title pairs for a set of note IDs, scoped to a user. */
  getRefTitles(ids: number[], userId: string): Promise<Map<number, string>>;
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
  /** Returns the owner user_id, or null if the project doesn't exist. */
  checkOwner(projectId: string): Promise<string | null>;
  updateSettings(userId: string, updates: Partial<UserSettings>): Promise<void>;
  /** Deletes all notes (and their tags, people, images) from a project. */
  clearNotes(projectId: string): Promise<void>;
}

export interface DataProvider {
  notes: NotesDataProvider;
  projects: ProjectsDataProvider;
}
