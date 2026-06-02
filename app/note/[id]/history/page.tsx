import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getAuthUser } from "@/lib/auth";
import { getProvider } from "@/lib/providers";
import Header from "@/components/Header";
import HistoryDiffView from "./HistoryDiffView";
import { ArrowLeft } from "lucide-react";

export default async function NoteHistoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const noteId = Number(id);
  if (isNaN(noteId)) notFound();

  const user = await getAuthUser();
  if (!user) redirect("/login");

  const provider = await getProvider();

  const [note, projects, versions] = await Promise.all([
    provider.notes.get(noteId),
    provider.projects.getUserProjects(user.id),
    provider.notes.getVersions(noteId),
  ]);

  if (!note || note.user_id !== user.id) notFound();

  const activeProject = await provider.projects.getActive(user.id, note.project_id);

  return (
    <div className="min-h-screen bg-background">
      <Header
        projects={projects}
        activeProject={activeProject!}
        userEmail={user.email}
      />

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5">
        <Link
          href={`/note/${noteId}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-5 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to note
        </Link>

        <h1 className="text-xl font-bold mb-1">{note.title || "(untitled)"}</h1>
        <p className="text-sm text-muted-foreground mb-5">Version history</p>

        {versions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No saved versions yet. Versions are recorded on each manual save.
          </p>
        ) : (
          <HistoryDiffView noteId={noteId} versions={versions} />
        )}
      </div>
    </div>
  );
}
