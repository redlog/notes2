/**
 * Supabase implementation of DataProvider.
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

      getVersion: (noteId, version) =>
        notesLib.getNoteVersion(supabase, noteId, version),

      getTagCounts: (projectId) => notesLib.getTagCounts(supabase, projectId),

      getPersonCounts: (projectId) => notesLib.getPersonCounts(supabase, projectId),

      getSignedImageUrls: (images, expiresIn) =>
        notesLib.getSignedImageUrls(supabase, images, expiresIn),

      searchTitles: (projectId, query, limit) =>
        notesLib.searchTitles(supabase, projectId, query, limit),

      getEarliestNoteDate: (projectId) =>
        notesLib.getEarliestNoteDate(supabase, projectId),

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
        (data ?? []).forEach((n: { id: number; title: string }) =>
          map.set(n.id, n.title)
        );
        return map;
      },

      listImages: (projectId, page, perPage) =>
        notesLib.listProjectImages(supabase, projectId, page, perPage),

      getInlinks: async (noteId) => {
        const { data } = await supabase
          .from("note_inlinks")
          .select("source_note_id, notes!source_note_id(id, title)")
          .eq("target_note_id", noteId);
        return ((data ?? []) as unknown as {
          source_note_id: number;
          notes: { id: number; title: string };
        }[]).map((r) => ({
          source_note_id: r.source_note_id,
          note_title: r.notes?.title ?? "",
        }));
      },

      getImageRecords: async (noteId) => {
        const { data } = await supabase
          .from("note_images")
          .select("img_num, storage_path")
          .eq("note_id", noteId)
          .order("img_num");
        return data ?? [];
      },

      getImageRecord: async (noteId, imgNum) => {
        const { data } = await supabase
          .from("note_images")
          .select("storage_path")
          .eq("note_id", noteId)
          .eq("img_num", imgNum)
          .single();
        return data ?? null;
      },

      getNextImageNum: async (noteId) => {
        const { data } = await supabase
          .from("note_images")
          .select("img_num")
          .eq("note_id", noteId)
          .order("img_num", { ascending: false })
          .limit(1);
        return ((data?.[0] as { img_num?: number } | undefined)?.img_num ?? 0) + 1;
      },

      insertImageRecord: async (noteId, imgNum, storagePath) => {
        await supabase
          .from("note_images")
          .insert({ note_id: noteId, img_num: imgNum, storage_path: storagePath });
      },

      deleteImageRecord: async (noteId, imgNum) => {
        await supabase
          .from("note_images")
          .delete()
          .eq("note_id", noteId)
          .eq("img_num", imgNum);
      },
    },

    projects: {
      getActive: (userId, projectId) =>
        projectsLib.getActiveProject(supabase, userId, projectId),

      getUserProjects: (userId) => projectsLib.getUserProjects(supabase, userId),

      getUserSettings: (userId) => projectsLib.getUserSettings(supabase, userId),

      create: (userId, name) => projectsLib.createProject(supabase, userId, name),

      update: (projectId, updates) =>
        projectsLib.updateProject(supabase, projectId, updates),

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

    bios: {
      get: async (projectId, person) => {
        const { data } = await supabase
          .from("person_bios")
          .select("content, updated_at")
          .eq("project_id", projectId)
          .eq("person", person)
          .single();
        return { content: data?.content ?? "", updated_at: data?.updated_at ?? null };
      },

      save: async (projectId, userId, person, content) => {
        const now = new Date().toISOString();
        await supabase.from("person_bios").upsert(
          { project_id: projectId, user_id: userId, person, content, updated_at: now },
          { onConflict: "project_id,person" }
        );
        return { updated_at: now };
      },
    },
  };
}
