/**
 * Supabase implementation of DataProvider.
 * Delegates to existing lib/notes.ts and lib/projects.ts helpers,
 * which accept a SupabaseClient as their first argument.
 */

import { createClient } from "@/lib/supabase/server";
import * as notesLib from "@/lib/notes";
import * as projectsLib from "@/lib/projects";
import type { DataProvider } from "../types";

export async function createSupabaseProvider(): Promise<DataProvider> {
  const supabase = await createClient();

  return {
    notes: {
      list: (params) => notesLib.listNotes(supabase, params),

      get: (noteId) => notesLib.getNote(supabase, noteId),

      create: (projectId, userId, title, body, tags, people) =>
        notesLib.createNote(supabase, projectId, userId, title, body, tags, people),

      save: (noteId, title, body, tags, people, version) =>
        notesLib.saveNote(supabase, noteId, title, body, tags, people, version),

      delete: (noteId) => notesLib.deleteNote(supabase, noteId),

      checkOwner: async (noteId) => {
        const { data } = await supabase
          .from("notes")
          .select("user_id")
          .eq("id", noteId)
          .single();
        return data?.user_id ?? null;
      },

      moveToProject: async (noteId, projectId) => {
        const { error } = await supabase
          .from("notes")
          .update({ project_id: projectId })
          .eq("id", noteId);
        if (error) throw error;
      },

      getVersions: (noteId) => notesLib.getNoteVersions(supabase, noteId),

      getVersion: (noteId, version) => notesLib.getNoteVersion(supabase, noteId, version),

      getTagCounts: (projectId) => notesLib.getTagCounts(supabase, projectId),

      getPersonCounts: (projectId) => notesLib.getPersonCounts(supabase, projectId),

      getSignedImageUrls: (images, expiresIn) =>
        notesLib.getSignedImageUrls(supabase, images, expiresIn),

      searchTitles: (projectId, query, limit) =>
        notesLib.searchTitles(supabase, projectId, query, limit),

      getEarliestNoteDate: (projectId) => notesLib.getEarliestNoteDate(supabase, projectId),

      getTaglines: (projectId, tag, page, pageSize) =>
        notesLib.getTaglines(supabase, projectId, tag, page, pageSize),

      getRefTitles: async (ids, userId) => {
        const map = new Map<number, string>();
        if (!ids.length) return map;
        const { data } = await supabase
          .from("notes")
          .select("id, title")
          .in("id", ids)
          .eq("user_id", userId);
        (data ?? []).forEach((n: { id: number; title: string }) => map.set(n.id, n.title));
        return map;
      },
    },

    projects: {
      getActive: (userId, projectId) =>
        projectsLib.getActiveProject(supabase, userId, projectId),

      getUserProjects: (userId) => projectsLib.getUserProjects(supabase, userId),

      getUserSettings: (userId) => projectsLib.getUserSettings(supabase, userId),

      create: (userId, name) => projectsLib.createProject(supabase, userId, name),

      update: (projectId, updates) => projectsLib.updateProject(supabase, projectId, updates),

      delete: (projectId) => projectsLib.deleteProject(supabase, projectId),

      checkOwner: async (projectId) => {
        const { data } = await supabase
          .from("projects")
          .select("user_id")
          .eq("id", projectId)
          .single();
        return data?.user_id ?? null;
      },

      updateSettings: (userId, updates) =>
        projectsLib.updateUserSettings(supabase, userId, updates),

      clearNotes: (projectId) =>
        projectsLib.clearProjectNotes(supabase, projectId),
    },
  };
}
