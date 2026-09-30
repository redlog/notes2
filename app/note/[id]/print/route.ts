import { getAuthUser } from "@/lib/auth";
import { getProvider } from "@/lib/providers";
import { extractMentions, extractNoteRefs } from "@/lib/notes";
import { renderMarkdown } from "@/lib/markdown";

// A route handler rather than a page: the response is a bare, self-contained
// HTML document — no app layout, no Next.js scripts, no header or sidebar — so
// what the browser prints is exactly the note.

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

function validTimeZone(tz: string | null): string | undefined {
  if (!tz) return undefined;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: tz });
    return tz;
  } catch {
    return undefined;
  }
}

function page(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
    },
  });
}

const STYLES = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0 auto; padding: 32px 24px; max-width: 760px;
    background: #fff; color: #111;
    font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
  header { border-bottom: 2px solid #111; padding-bottom: 12px; margin-bottom: 24px; }
  header h1 { font-size: 30px; line-height: 1.2; margin: 0 0 10px; }
  header h1 .untitled { color: #888; font-style: italic; font-weight: normal; }
  .meta { font-size: 13px; color: #444; margin: 2px 0; }
  .meta .label { font-weight: 600; color: #111; margin-right: 4px; }
  .times { font-size: 12px; color: #666; margin-top: 8px; }
  .times span + span { margin-left: 16px; }
  main h1 { font-size: 24px; margin: 20px 0 8px; }
  main h2 { font-size: 20px; margin: 18px 0 8px; }
  main h3 { font-size: 17px; margin: 16px 0 6px; }
  main p { margin: 0 0 12px; }
  main ul, main ol { margin: 0 0 12px; padding-left: 24px; }
  main li > p:first-child { margin: 0; }
  main blockquote { border-left: 4px solid #ccc; margin: 12px 0; padding-left: 14px; color: #555; font-style: italic; }
  main code { background: #f3f3f3; padding: 1px 4px; border-radius: 3px; font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  main pre { background: #f6f6f6; border: 1px solid #ddd; border-radius: 4px; padding: 10px 12px; overflow-x: auto; white-space: pre-wrap; }
  main pre code { background: none; padding: 0; }
  main table { border-collapse: collapse; margin: 0 0 12px; }
  main th, main td { border: 1px solid #ccc; padding: 4px 8px; text-align: left; }
  main hr { border: 0; border-top: 1px solid #ccc; margin: 20px 0; }
  a { color: inherit; text-decoration: none; }
  a.note-ref { text-decoration: underline; }
  .note-tag-inline, .note-person-inline { font-weight: 600; }
  .note-ref-missing { color: #999; }
  .img-missing { color: #999; font-family: monospace; }
  img { max-width: 100%; height: auto; display: block; margin: 12px 0; page-break-inside: avoid; break-inside: avoid; }
  .attachments { margin-top: 32px; border-top: 1px solid #ccc; padding-top: 12px; }
  .attachments h2 { font-size: 16px; margin: 0 0 8px; }
  figure { margin: 0 0 16px; break-inside: avoid; page-break-inside: avoid; }
  figcaption { font-size: 12px; color: #666; }
  @media print {
    body { padding: 0; max-width: none; }
    @page { margin: 18mm 16mm; }
  }
`;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const noteId = Number(id);
  if (!Number.isInteger(noteId)) return page(404, "<!doctype html><title>Not found</title><p>Not found</p>");

  const user = await getAuthUser();
  if (!user) return page(401, "<!doctype html><title>Unauthorized</title><p>Unauthorized</p>");

  const provider = await getProvider();
  const note = await provider.notes.get(noteId);
  if (!note || note.user_id !== user.id) {
    return page(404, "<!doctype html><title>Not found</title><p>Not found</p>");
  }

  const [noteRefs, imageUrls] = await Promise.all([
    provider.notes.getRefTitles(extractNoteRefs(note.body), user.id),
    provider.notes.getSignedImageUrls(note.images),
  ]);

  const bodyHtml = renderMarkdown(note.body, { noteRefs, imageUrls });

  // Timestamps are formatted server-side (no scripts), so the caller passes the
  // viewer's zone as ?tz=; the zone name is printed so the times are unambiguous.
  const timeZone = validTimeZone(new URL(request.url).searchParams.get("tz"));
  const fmt = (iso: string) =>
    new Date(iso).toLocaleString("en-US", {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit", timeZoneName: "short",
      timeZone,
    });

  // Header metadata first, then anything only mentioned in the body — same
  // order as the read page.
  const { tags: bodyTags, people: bodyPeople } = extractMentions(note.body);
  const tags = [...new Set([
    ...note.tags.filter((t) => t.is_header).map((t) => t.tag),
    ...note.tags.map((t) => t.tag),
    ...bodyTags,
  ])];
  const people = [...new Set([
    ...note.people.filter((p) => p.is_header).map((p) => p.person),
    ...note.people.map((p) => p.person),
    ...bodyPeople,
  ])];

  // An image is "tagged" when the body embeds it with <N>; renderMarkdown
  // substitutes every such placeholder, so the same regex decides both.
  const embedded = new Set([...note.body.matchAll(/<(\d+)>/g)].map((m) => Number(m[1])));
  const unembedded = note.images
    .filter((img) => !embedded.has(img.img_num) && imageUrls[img.img_num])
    .sort((a, b) => a.img_num - b.img_num);

  const title = note.title
    ? esc(note.title)
    : `<span class="untitled">Untitled</span>`;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(note.title || "Untitled")}</title>
<style>${STYLES}</style>
</head>
<body>
<header>
  <h1>${title}</h1>
  ${people.length ? `<div class="meta"><span class="label">People:</span>${people.map((p) => `@${esc(p)}`).join(", ")}</div>` : ""}
  ${tags.length ? `<div class="meta"><span class="label">Tags:</span>${tags.map((t) => `#${esc(t)}`).join(", ")}</div>` : ""}
  <div class="times"><span>Created ${esc(fmt(note.created_at))}</span><span>Updated ${esc(fmt(note.updated_at))}</span></div>
</header>
<main>
${bodyHtml}
</main>
${unembedded.length ? `<section class="attachments">
  <h2>Attached images</h2>
  ${unembedded.map((img) => `<figure><img src="${esc(imageUrls[img.img_num])}" alt="Image ${img.img_num}"><figcaption>Image ${img.img_num}</figcaption></figure>`).join("\n  ")}
</section>` : ""}
</body>
</html>
`;

  return page(200, html);
}
