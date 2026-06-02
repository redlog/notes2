import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getAuthUser } from "@/lib/auth";
import { getProvider } from "@/lib/providers";
import { extractMentions, extractNoteRefs } from "@/lib/notes";
import { renderMarkdown } from "@/lib/markdown";
import Header from "@/components/Header";
import TagPill from "@/components/TagPill";
import DeleteButton from "@/components/DeleteButton";
import MoveNoteButton from "@/components/MoveNoteButton";
import { Button } from "@/components/ui/button";
import { Pencil, Copy, ArrowLeft, Clock, Calendar, Link2, History } from "lucide-react";

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

  const user = await getAuthUser();
  if (!user) redirect("/login");

  const provider = await getProvider();

  const [note, projects] = await Promise.all([
    provider.notes.get(noteId),
    provider.projects.getUserProjects(user.id),
  ]);

  if (!note || note.user_id !== user.id) notFound();

  const activeProject = await provider.projects.getActive(
    user.id,
    sp.project ?? note.project_id
  );

  const refIds = extractNoteRefs(note.body);
  const [noteRefs, signedImageUrls, inlinks] = await Promise.all([
    provider.notes.getRefTitles(refIds, user.id),
    provider.notes.getSignedImageUrls(note.images),
    provider.notes.getInlinks(noteId),
  ]);

  const html = renderMarkdown(note.body, { noteRefs, imageUrls: signedImageUrls });

  function fmt(iso: string) {
    return new Date(iso).toLocaleString(undefined, {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  }

  const headerTags = note.tags.filter((t) => t.is_header);
  const headerPeople = note.people.filter((p) => p.is_header);
  const headerTagNames = new Set(headerTags.map((t) => t.tag));
  const headerPeopleNames = new Set(headerPeople.map((p) => p.person));
  const { tags: bodyTagNames, people: bodyPeopleNames } = extractMentions(note.body);
  const mentionTags = bodyTagNames.filter((t) => !headerTagNames.has(t)).map((t) => ({ tag: t }));
  const mentionPeople = bodyPeopleNames.filter((p) => !headerPeopleNames.has(p)).map((p) => ({ person: p }));

  return (
    <div className="min-h-screen bg-background">
      <Header
        projects={projects}
        activeProject={activeProject!}
        userEmail={user.email}
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
          <article className="flex-1 min-w-0">
            {note.title && (
              <h1 className="text-2xl font-bold text-foreground mb-4">{note.title}</h1>
            )}
            <div
              className="note-body prose max-w-none text-foreground"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          </article>

          {/* Sidebar */}
          <aside className="w-full lg:w-52 xl:w-56 shrink-0">
            <div className="lg:sticky lg:top-20 space-y-5">
              {/* Actions */}
              <div className="flex flex-wrap gap-2">
                <Button asChild className="gap-1.5 flex-1 sm:flex-none justify-center">
                  <Link href={`/edit/${note.id}`}>
                    <Pencil className="h-3.5 w-3.5" />
                    Edit
                  </Link>
                </Button>
                <Button asChild variant="outline" className="gap-1.5">
                  <Link href={`/clone/${note.id}`}>
                    <Copy className="h-3.5 w-3.5" />
                    Clone
                  </Link>
                </Button>
                <Button asChild variant="outline" className="gap-1.5">
                  <Link href={`/note/${note.id}/history`}>
                    <History className="h-3.5 w-3.5" />
                    History
                  </Link>
                </Button>
                <MoveNoteButton noteId={note.id} currentProjectId={note.project_id} projects={projects} />
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
                      <TagPill key={t.tag} tag={t.tag} isHeader variant="tag" />
                    ))}
                    {mentionTags.map((t) => (
                      <TagPill key={t.tag} tag={t.tag} isHeader={false} variant="tag" />
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
                      <TagPill key={p.person} tag={p.person} isHeader variant="person" />
                    ))}
                    {mentionPeople.map((p) => (
                      <TagPill key={p.person} tag={p.person} isHeader={false} variant="person" />
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
                          {il.note_title}
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
