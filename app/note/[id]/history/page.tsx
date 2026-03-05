import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getNote, getNoteVersions } from "@/lib/notes";
import { getUserProjects, getActiveProject } from "@/lib/projects";
import Header from "@/components/Header";
import { ArrowLeft, Clock } from "lucide-react";

export default async function NoteHistoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const noteId = Number(id);
  if (isNaN(noteId)) notFound();

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [note, projects, versions] = await Promise.all([
    getNote(supabase, noteId),
    getUserProjects(supabase, user.id),
    getNoteVersions(supabase, noteId),
  ]);

  if (!note || note.user_id !== user.id) notFound();

  const activeProject = await getActiveProject(supabase, user.id, note.project_id);

  function fmt(iso: string) {
    return new Date(iso).toLocaleString(undefined, {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  }

  return (
    <div className="min-h-screen bg-background">
      <Header
        projects={projects}
        activeProject={activeProject!}
        userEmail={user.email ?? ""}
      />

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-5">
        <Link
          href={`/note/${noteId}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-5 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to note
        </Link>

        <h1 className="text-xl font-bold mb-1">{note.title || "(untitled)"}</h1>
        <p className="text-sm text-muted-foreground mb-6">Version history</p>

        {versions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No saved versions yet. Versions are recorded on each manual save.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {versions.map((v) => (
              <li key={v.version}>
                <Link
                  href={`/note/${noteId}/history/${v.version}`}
                  className="flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors"
                >
                  <div>
                    <span className="text-sm font-medium">{v.title || "(untitled)"}</span>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                      <Clock className="h-3 w-3" />
                      {fmt(v.saved_at)}
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground">v{v.version}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
