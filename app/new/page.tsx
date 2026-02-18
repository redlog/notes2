import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveProject } from "@/lib/projects";
import { createNote } from "@/lib/notes";

export default async function NewNotePage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const activeProject = await getActiveProject(supabase, user.id, sp.project);
  if (!activeProject) redirect("/");

  const noteId = await createNote(supabase, activeProject.id, user.id);
  redirect(`/edit/${noteId}?project=${activeProject.id}`);
}
