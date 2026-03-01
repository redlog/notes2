import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getActiveProject, getUserProjects, getUserSettings } from "@/lib/projects";
import { getNote, getSignedImageUrls } from "@/lib/notes";
import { renderMarkdown } from "@/lib/markdown";
import Header from "@/components/Header";
import TagPill from "@/components/TagPill";
import DeleteButton from "@/components/DeleteButton";
import { Button } from "@/components/ui/button";
import { Pencil, Copy, ArrowLeft, Clock, Calendar, Link2 } from "lucide-react";

export default async function ReadNotePage({
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

  const activeProject = await getActiveProject(supabase, user.id, sp.project ?? note.project_id);

  // Resolve note:ID references
  const NOTE_REF_RE = /note:(\d+)/g;
  const refIds = [...new Set([...note.body.matchAll(NOTE_REF_RE)].map((m) => Number(m[1])))];
  const noteRefs = new Map<number, string>();
  if (refIds.length) {
    const { data } = await supabase
      .from("notes")
      .select("id, title")
      .in("id", refIds)
      .eq("user_id", user.id);
    (data ?? []).forEach((n: { id: number; title: string }) => noteRefs.set(n.id, n.title));
  }

  const signedImageUrls = await getSignedImageUrls(supabase, note.images);

  // Inlinks
  const { data: inlinkData } = await supabase
    .from("note_inlinks")
    .select("source_note_id, notes!source_note_id(id, title)")
    .eq("target_note_id", noteId);
  const inlinks = ((inlinkData ?? []) as unknown) as Array<{ source_note_id: number; notes: { id: number; title: string } }>;

  const html = renderMarkdown(note.body, {
    noteRefs,
    imageUrls: signedImageUrls,
  });

  function fmt(iso: string) {
    return new Date(iso).toLocaleString(undefined, {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  }

  const headerTags = note.tags.filter((t) => t.is_header);
  const mentionTags = note.tags.filter((t) => !t.is_header);
  const headerPeople = note.people.filter((p) => p.is_header);
  const mentionPeople = note.people.filter((p) => !p.is_header);

  void settings;

  return (
    <div className="min-h-screen bg-background">
      <Header
        projects={projects}
        activeProject={activeProject!}
        userEmail={user.email ?? ""}
      />

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-5">
        {/* Back link */}
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-5 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to notes
        </Link>

        <div className="flex flex-col lg:flex-row gap-6">
          {/* Note body */}
          <article className="flex-1 min-w-0 order-2 lg:order-1">
            <div
              className="note-body prose max-w-none text-foreground"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          </article>

          {/* Right sidebar */}
          <aside className="w-full lg:w-52 xl:w-56 shrink-0 order-1 lg:order-2">
            <div className="lg:sticky lg:top-20 space-y-5">
              {/* Actions */}
              <div className="flex flex-wrap gap-2">
                <Button asChild size="sm" className="gap-1.5">
                  <Link href={`/edit/${note.id}`}>
                    <Pencil className="h-3.5 w-3.5" />
                    Edit
                  </Link>
                </Button>
                <Button asChild variant="outline" size="sm" className="gap-1.5">
                  <Link href={`/clone/${note.id}`}>
                    <Copy className="h-3.5 w-3.5" />
                    Clone
                  </Link>
                </Button>
                <DeleteButton noteId={note.id} />
              </div>

              {/* Timestamps */}
              <div className="space-y-1 text-xs text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5" />
                  <span>Created {fmt(note.created_at)}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" />
                  <span>Edited {fmt(note.updated_at)}</span>
                </div>
              </div>

              {/* Tags */}
              {(headerTags.length > 0 || mentionTags.length > 0) && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Tags</p>
                  <div className="flex flex-wrap gap-1.5">
                    {headerTags.map((t) => (
                      <TagPill key={t.tag} tag={t.tag} isHeader currentProject={activeProject?.id} variant="tag" />
                    ))}
                    {mentionTags.map((t) => (
                      <TagPill key={t.tag} tag={t.tag} isHeader={false} currentProject={activeProject?.id} variant="tag" />
                    ))}
                  </div>
                </div>
              )}

              {/* People */}
              {(headerPeople.length > 0 || mentionPeople.length > 0) && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">People</p>
                  <div className="flex flex-wrap gap-1.5">
                    {headerPeople.map((p) => (
                      <TagPill key={p.person} tag={p.person} isHeader currentProject={activeProject?.id} variant="person" />
                    ))}
                    {mentionPeople.map((p) => (
                      <TagPill key={p.person} tag={p.person} isHeader={false} currentProject={activeProject?.id} variant="person" />
                    ))}
                  </div>
                </div>
              )}

              {/* Images */}
              {note.images.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Images</p>
                  <div className="space-y-2">
                    {note.images.map((img) => {
                      const url = signedImageUrls[img.img_num];
                      return (
                        <div key={img.img_num} className="space-y-0.5">
                          {url && (
                            <a href={url} target="_blank" rel="noopener noreferrer">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={url} alt={`Image ${img.img_num}`} className="w-full rounded-md border border-border" />
                            </a>
                          )}
                          <div className="text-xs text-muted-foreground">
                            embed: <code className="bg-muted px-1 rounded">&lt;{img.img_num}&gt;</code>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Inlinks */}
              {inlinks.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1">
                    <Link2 className="h-3.5 w-3.5" />
                    What links here
                  </p>
                  <ul className="space-y-1">
                    {inlinks.map((il) => (
                      <li key={il.source_note_id}>
                        <Link
                          href={`/note/${il.source_note_id}`}
                          className="text-xs text-primary hover:underline"
                        >
                          {il.notes.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
