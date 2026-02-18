import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveProject, getUserProjects, getUserSettings } from "@/lib/projects";
import { getNote, getTagCounts, getPersonCounts, getSignedImageUrls } from "@/lib/notes";
import Header from "@/components/Header";
import Editor from "@/components/Editor";

export default async function EditNotePage({
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

  const [note, projects, settings] = await Promise.all([
    getNote(supabase, noteId),
    getUserProjects(supabase, user.id),
    getUserSettings(supabase, user.id),
  ]);

  if (!note || note.user_id !== user.id) notFound();

  const activeProject = await getActiveProject(
    supabase,
    user.id,
    sp.project ?? note.project_id
  );

  const [tagCounts, peopleCounts, initialSignedUrls] = await Promise.all([
    getTagCounts(supabase, activeProject!.id),
    getPersonCounts(supabase, activeProject!.id),
    getSignedImageUrls(supabase, note.images),
  ]);

  return (
    <>
      <Header
        projects={projects}
        activeProject={activeProject!}
        userEmail={user.email ?? ""}
      />
      <Editor
        note={note}
        allTags={tagCounts.map((t) => t.tag)}
        allPeople={peopleCounts.map((p) => p.person)}
        autosaveEnabled={settings.autosave_enabled}
        autosaveInterval={settings.autosave_interval}
        initialSignedUrls={initialSignedUrls}
      />
    </>
  );
}
