import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth";
import { getProvider } from "@/lib/providers";

export default async function NewNotePage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const sp = await searchParams;
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const provider = await getProvider();

  const activeProject = await provider.projects.getActive(user.id, sp.project);
  if (!activeProject) redirect("/");

  const noteId = await provider.notes.create(activeProject.id, user.id);
  redirect(`/edit/${noteId}`);
}
