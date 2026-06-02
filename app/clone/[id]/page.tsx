import { notFound, redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth";
import { getProvider } from "@/lib/providers";

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

  const user = await getAuthUser();
  if (!user) redirect("/login");

  const provider = await getProvider();

  const note = await provider.notes.get(noteId);
  if (!note || note.user_id !== user.id) notFound();

  const activeProject = await provider.projects.getActive(
    user.id,
    sp.project ?? note.project_id
  );
  if (!activeProject) redirect("/");

  const headerTags = note.tags.filter((t) => t.is_header).map((t) => t.tag);
  const headerPeople = note.people.filter((p) => p.is_header).map((p) => p.person);
  const cloneBody = `note:${noteId}\n\n`;

  const newId = await provider.notes.create(
    activeProject.id,
    user.id,
    note.title,
    cloneBody,
    headerTags,
    headerPeople
  );

  redirect(`/edit/${newId}`);
}
