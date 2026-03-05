import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getNote, getNoteVersion } from "@/lib/notes";
import { getUserProjects, getActiveProject } from "@/lib/projects";
import { renderMarkdown } from "@/lib/markdown";
import Header from "@/components/Header";
import RestoreButton from "./RestoreButton";
import ClientTime from "./ClientTime";
import { ArrowLeft, Clock } from "lucide-react";

export default async function NoteVersionPage({
  params,
}: {
  params: Promise<{ id: string; ver: string }>;
}) {
  const { id, ver } = await params;
  const noteId = Number(id);
  const version = Number(ver);
  if (isNaN(noteId) || isNaN(version)) notFound();

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [note, projects, snapshot] = await Promise.all([
    getNote(supabase, noteId),
    getUserProjects(supabase, user.id),
    getNoteVersion(supabase, noteId, version),
  ]);

  if (!note || note.user_id !== user.id) notFound();
  if (!snapshot) notFound();

  const activeProject = await getActiveProject(supabase, user.id, note.project_id);

  const html = renderMarkdown(snapshot.body, { noteRefs: new Map(), imageUrls: {} });

  const isCurrent = note.version === version;

  return (
    <div className="min-h-screen bg-background">
      <Header
        projects={projects}
        activeProject={activeProject!}
        userEmail={user.email ?? ""}
      />

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-5">
        <Link
          href={`/note/${noteId}/history`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-5 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to history
        </Link>

        <div className="flex flex-col lg:flex-row gap-6">
          <article className="flex-1 min-w-0 order-2 lg:order-1">
            {snapshot.title && (
              <h1 className="text-2xl font-bold text-foreground mb-4">{snapshot.title}</h1>
            )}
            <div
              className="note-body prose max-w-none text-foreground"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          </article>

          <aside className="w-full lg:w-52 xl:w-56 shrink-0 order-1 lg:order-2">
            <div className="lg:sticky lg:top-20 space-y-4">
              <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground space-y-1">
                <div className="font-semibold text-foreground">Version {version}</div>
                <div className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  <ClientTime iso={snapshot.saved_at} />
                </div>
                {isCurrent && (
                  <div className="text-green-600 dark:text-green-400 font-medium">Current version</div>
                )}
              </div>

              {!isCurrent && (
                <RestoreButton noteId={noteId} version={version} />
              )}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
