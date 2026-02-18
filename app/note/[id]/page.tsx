import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getActiveProject, getUserProjects, getUserSettings } from "@/lib/projects";
import { getNote, getSignedImageUrls } from "@/lib/notes";
import { renderMarkdown } from "@/lib/markdown";
import Header from "@/components/Header";
import TagPill from "@/components/TagPill";
import DeleteButton from "@/components/DeleteButton";

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

  // Signed URLs for private bucket images
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

  // settings used only to satisfy getUserSettings call above; suppress unused warning
  void settings;

  return (
    <>
      <Header
        projects={projects}
        activeProject={activeProject!}
        userEmail={user.email ?? ""}
      />
      <div className="max-w-5xl mx-auto px-4 py-6 flex gap-6">
        {/* Note body */}
        <article className="flex-1 min-w-0">
          <div
            className="note-body prose max-w-none"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </article>

        {/* Right sidebar */}
        <aside className="w-56 shrink-0 space-y-4 text-sm">
          {/* Actions */}
          <div className="flex gap-2 flex-wrap">
            <Link
              href={`/edit/${note.id}`}
              className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
            >
              Edit
            </Link>
            <Link
              href={`/clone/${note.id}`}
              className="px-3 py-1 border border-gray-300 rounded text-sm hover:bg-gray-50"
            >
              Clone
            </Link>
            <DeleteButton noteId={note.id} />
          </div>

          {/* Timestamps */}
          <div className="text-xs text-gray-500 space-y-1">
            <div>Created: {fmt(note.created_at)}</div>
            <div>Edited: {fmt(note.updated_at)}</div>
          </div>

          {/* Tags */}
          {(headerTags.length > 0 || mentionTags.length > 0) && (
            <div>
              <div className="font-semibold text-gray-700 mb-1">Tags</div>
              <div className="flex flex-wrap gap-1">
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
              <div className="font-semibold text-gray-700 mb-1">People</div>
              <div className="flex flex-wrap gap-1">
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
              <div className="font-semibold text-gray-700 mb-1">Images</div>
              <div className="space-y-2">
                {note.images.map((img) => {
                  const url = signedImageUrls[img.img_num];
                  return (
                    <div key={img.img_num} className="space-y-0.5">
                      {url && (
                        <a href={url} target="_blank" rel="noopener noreferrer">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={url} alt={`Image ${img.img_num}`} className="w-full rounded border" />
                        </a>
                      )}
                      <div className="text-xs text-gray-400">
                        embed: <code>&lt;{img.img_num}&gt;</code>
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
              <div className="font-semibold text-gray-700 mb-1">What links here</div>
              <ul className="space-y-1">
                {inlinks.map((il) => (
                  <li key={il.source_note_id}>
                    <Link
                      href={`/note/${il.source_note_id}`}
                      className="text-blue-600 hover:underline text-xs"
                    >
                      {il.notes.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
    </>
  );
}
