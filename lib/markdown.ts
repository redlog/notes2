import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

// Allowlist for sanitizing marked HTML output.
// We intentionally exclude <img> here — user Markdown cannot embed external
// images. Only our own <N> placeholder → signed-URL substitution is allowed,
// and those replacements happen after sanitization so they are fully controlled.
const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "h1", "h2", "h3", "h4", "h5", "h6",
    "p", "blockquote", "pre", "ol", "ul", "li",
    "table", "thead", "tbody", "tr", "th", "td",
    "hr", "br",
    "a", "strong", "b", "em", "i", "code",
    "s", "del", "ins", "span",
  ],
  allowedAttributes: {
    a: ["href", "target", "rel", "class", "title"],
    code: ["class"],
    pre: ["class"],
    span: ["class", "title"],
    th: ["align"],
    td: ["align"],
    "*": ["class"],
  },
  allowedSchemes: ["https", "http", "mailto"],
  allowProtocolRelative: false,
  // Force all external links to open in a new tab safely
  transformTags: {
    a: (_tagName, attribs) => {
      const href = attribs.href ?? "";
      const isExternal = /^https?:\/\//i.test(href);
      return {
        tagName: "a",
        attribs: isExternal
          ? { ...attribs, target: "_blank", rel: "noopener noreferrer" }
          : attribs,
      };
    },
  },
};

function escAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

/**
 * Render Markdown to sanitized HTML with post-render enrichment:
 * - note:ID → clickable link with note title
 * - <N>     → embedded image from signed URL
 */
export function renderMarkdown(
  body: string,
  options: {
    noteRefs?: Map<number, string>; // id → title
    imageUrls?: Record<number, string>; // img_num → signed URL
  } = {}
): string {
  const { noteRefs = new Map(), imageUrls = {} } = options;

  // Pre-process: escape <N> image placeholders so marked doesn't eat them.
  // Use a token that looks nothing like valid HTML.
  const pre = body.replace(/<(\d+)>/g, "IMGPLACEHOLDER_$1_END");

  // Render Markdown to raw HTML, then sanitize.
  const rawHtml = marked.parse(pre) as string;
  const safeHtml = sanitizeHtml(rawHtml, SANITIZE_OPTIONS);

  // Post-process: apply controlled enrichments that we generate ourselves
  // (note links and image embeds). These are not re-sanitized, so we must
  // ensure all user-derived values (title) are HTML-escaped.
  const out = safeHtml
    // note:ID references — id is always \d+ from the regex; title is escaped
    .replace(/note:(\d+)/g, (_, id) => {
      const nid = Number(id);
      const title = noteRefs.get(nid);
      if (!title) {
        return `<del class="note-ref-missing" title="Note not found">note:${id}</del>`;
      }
      return `<a href="/note/${id}" class="note-ref">${escAttr(title)}</a>`;
    })
    // Image placeholders — url comes from our own getSignedImageUrls(), not user input
    .replace(/IMGPLACEHOLDER_(\d+)_END/g, (_, num) => {
      const n = Number(num);
      const url = imageUrls[n];
      if (!url) return `<span class="img-missing">&lt;${n}&gt;</span>`;
      // Signed URLs are HTTPS Supabase URLs — safe to embed directly
      return `<a href="${url}" target="_blank" rel="noopener noreferrer"><img src="${url}" alt="Image ${n}" class="note-img" /></a>`;
    });

  return out;
}
