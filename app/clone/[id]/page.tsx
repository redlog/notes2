import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveProject } from "@/lib/projects";
import { getNote, createNote } from "@/lib/notes";

export default async function CloneNotePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ project?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const noteId = Number(id);
  if (isNaN(noteId)) notFound();

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const note = await getNote(supabase, noteId);
  if (!note || note.user_id !== user.id) notFound();

  const activeProject = await getActiveProject(supabase, user.id, sp.project ?? note.project_id);
  if (!activeProject) redirect("/");

  const headerTags = note.tags.filter((t) => t.is_header).map((t) => t.tag);
  const headerPeople = note.people.filter((p) => p.is_header).map((p) => p.person);
  const cloneBody = `note:${noteId}\n\n`;

  const newId = await createNote(
    supabase,
    activeProject.id,
    user.id,
    cloneBody,
    headerTags,
    headerPeople
  );

  redirect(`/edit/${newId}?project=${activeProject.id}`);
}
