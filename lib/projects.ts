import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Project, UserSettings } from "./types";

export async function getUserProjects(
  supabase: SupabaseClient,
  userId: string
): Promise<Project[]> {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function getActiveProject(
  supabase: SupabaseClient,
  userId: string,
  projectId?: string
): Promise<Project | null> {
  // Explicit arg → cookie → first project
  const cookieStore = await cookies();
  const effectiveId = projectId ?? cookieStore.get("active_project")?.value;

  if (effectiveId) {
    const { data } = await supabase
      .from("projects")
      .select("*")
      .eq("id", effectiveId)
      .eq("user_id", userId)
      .single();
    if (data) return data;
  }

  // Fall back to the first project
  const { data } = await supabase
    .from("projects")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .single();
  return data ?? null;
}

export async function getUserSettings(
  supabase: SupabaseClient,
  userId: string
): Promise<UserSettings> {
  const { data } = await supabase
    .from("user_settings")
    .select("*")
    .eq("user_id", userId)
    .single();
  return (
    data ?? {
      notes_per_page: 25,
      autosave_enabled: true,
      autosave_interval: 30,
    }
  );
}

export async function createProject(
  supabase: SupabaseClient,
  userId: string,
  name: string
): Promise<Project> {
  const { data, error } = await supabase
    .from("projects")
    .insert({ user_id: userId, name })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateProject(
  supabase: SupabaseClient,
  projectId: string,
  updates: Partial<Pick<Project, "name" | "trigram_search">>
): Promise<void> {
  const { error } = await supabase
    .from("projects")
    .update(updates)
    .eq("id", projectId);
  if (error) throw error;
}

export async function deleteProject(
  supabase: SupabaseClient,
  projectId: string
): Promise<void> {
  const { error } = await supabase
    .from("projects")
    .delete()
    .eq("id", projectId);
  if (error) throw error;
}

export async function clearProjectNotes(
  supabase: SupabaseClient,
  projectId: string
): Promise<void> {
  const { error } = await supabase
    .from("notes")
    .delete()
    .eq("project_id", projectId);
  if (error) throw error;
}

export async function updateUserSettings(
  supabase: SupabaseClient,
  userId: string,
  updates: Partial<UserSettings>
): Promise<void> {
  const { error } = await supabase
    .from("user_settings")
    .update(updates)
    .eq("user_id", userId);
  if (error) throw error;
}
