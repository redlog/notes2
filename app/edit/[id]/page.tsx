import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { getAuthUser } from "@/lib/auth";
import { getProvider } from "@/lib/providers";
import Header from "@/components/Header";
import Editor from "@/components/Editor";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const noteId = Number(id);
  if (isNaN(noteId)) return {};
  const user = await getAuthUser();
  if (!user) return {};
  const provider = await getProvider();
  const note = await provider.notes.get(noteId);
  if (!note || note.user_id !== user.id) return {};
  return { title: note.title };
}

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

  const user = await getAuthUser();
  if (!user) redirect("/login");

  const provider = await getProvider();

  const [note, projects, settings] = await Promise.all([
    provider.notes.get(noteId),
    provider.projects.getUserProjects(user.id),
    provider.projects.getUserSettings(user.id),
  ]);

  if (!note || note.user_id !== user.id) notFound();

  const activeProject = await provider.projects.getActive(
    user.id,
    sp.project ?? note.project_id
  );

  const [tagCounts, peopleCounts, initialSignedUrls] = await Promise.all([
    provider.notes.getTagCounts(activeProject!.id),
    provider.notes.getPersonCounts(activeProject!.id),
    provider.notes.getSignedImageUrls(note.images),
  ]);

  return (
    <>
      <Header
        projects={projects}
        activeProject={activeProject!}
        userEmail={user.email}
        localMode={process.env.PROVIDER === "sqlite"}
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
