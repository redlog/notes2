import { createClient } from "@/lib/supabase/server";
import { getProvider } from "@/lib/providers";
import { extractNoteRefs } from "@/lib/notes";
import { renderMarkdown } from "@/lib/markdown";
import type { SortKey, SortOrder } from "@/lib/types";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const projectId = searchParams.get("project") ?? "";
  const search = searchParams.get("search") ?? "";
  const filter = searchParams.get("filter") ?? "";
  const sortKey = (searchParams.get("sk") ?? "created_at") as SortKey;
  const sortOrder = (searchParams.get("so") ?? "desc") as SortOrder;
  const timeMin = searchParams.get("time_min") ?? undefined;
  const timeMax = searchParams.get("time_max") ?? undefined;

  const provider = await getProvider();

  const project = await provider.projects.getActive(user.id, projectId || undefined);
  if (!project) return new Response("Not found", { status: 404 });

  // Fetch all matching notes (no pagination limit for export)
  const result = await provider.notes.list({
    projectId: project.id,
    search,
    filter,
    page: 1,
    perPage: 9999,
    sortKey,
    sortOrder,
    timeMin,
    timeMax,
  });

  // Render each note
  const rendered: { id: number; title: string; created_at: string; html: string }[] = [];
  for (const item of result.notes) {
    const note = await provider.notes.get(item.id);
    if (!note) continue;

    const refIds = extractNoteRefs(note.body);
    const noteRefs = await provider.notes.getRefTitles(refIds, user.id);
    const imageUrls = await provider.notes.getSignedImageUrls(note.images);
    const html = renderMarkdown(note.body, { noteRefs, imageUrls });
    rendered.push({ id: note.id, title: note.title, created_at: note.created_at, html });
  }

  const toc = rendered
    .map((n) => `<li><a href="#note-${n.id}">${escHtml(n.title)}</a> <small>${fmtDate(n.created_at)}</small></li>`)
    .join("\n");

  const bodies = rendered
    .map(
      (n) => `<section id="note-${n.id}">
  <h2>${escHtml(n.title)}</h2>
  <p class="meta">${fmtDate(n.created_at)}</p>
  <div class="note-body">${n.html}</div>
  <p><a href="#toc">↑ Back to top</a></p>
</section>`
    )
    .join("\n\n");

  const exportHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Localnotes export — ${escHtml(project.name)}</title>
<style>
  body { font-family: sans-serif; max-width: 780px; margin: 0 auto; padding: 2rem; color: #1a1a1a; }
  h1, h2 { margin-top: 2rem; }
  a { color: #2563eb; }
  .meta { color: #6b7280; font-size: 0.85rem; }
  .note-body pre { background: #f3f4f6; padding: 1rem; overflow-x: auto; }
  .note-body code { background: #f3f4f6; padding: 0.1em 0.3em; border-radius: 3px; }
  .note-body table { border-collapse: collapse; width: 100%; }
  .note-body th, .note-body td { border: 1px solid #d1d5db; padding: 0.4rem 0.6rem; }
  section { border-top: 1px solid #e5e7eb; padding-top: 1rem; margin-top: 1rem; }
</style>
</head>
<body>
<h1 id="toc">Localnotes — ${escHtml(project.name)}</h1>
${search ? `<p>Search: <em>${escHtml(search)}</em></p>` : ""}
${filter ? `<p>Filter: <em>${escHtml(filter)}</em></p>` : ""}
<p>${rendered.length} note${rendered.length !== 1 ? "s" : ""}</p>
<ol>${toc}</ol>
${bodies}
</body>
</html>`;

  return new Response(exportHtml, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `attachment; filename="localnotes-export.html"`,
    },
  });
}

function escHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
  });
}
