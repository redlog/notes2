/**
 * Splits a note into independently retrievable chunks for embedding.
 *
 * Notes in this corpus are largely meeting notes where each top-level bullet is
 * a distinct topic, so chunking per top-level bullet means a meeting covering
 * three topics produces three separately retrievable vectors rather than one
 * blurred average-of-everything.
 *
 * See docs/vector-search-and-rag.md §4.
 */
import { createHash } from "crypto";

/** Rough guides, not hard limits — see estimateTokens(). */
const MIN_CHUNK_TOKENS = 20;
const MAX_CHUNK_TOKENS = 1000;

export interface NoteChunk {
  chunkIndex: number;
  /** Raw chunk text, shown to a user. */
  content: string;
  /** Context-prefixed text — this is what actually gets embedded. */
  embedText: string;
  /** sha256 of embedText. Changing the prefix invalidates every chunk. */
  contentHash: string;
  tokenCount: number;
}

/**
 * Approximate token count. Voyage does not publish a tokenizer we can run
 * locally, and pulling one in for chunk-size heuristics would be a heavy
 * dependency for a rough bound. Word count × 1.3 is close enough for deciding
 * "is this bullet too small to stand alone" — it is never used for billing or
 * for enforcing a hard API limit (the API truncates on its own by default).
 */
export function estimateTokens(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.ceil(words * 1.3);
}

/**
 * Normalises text before it is embedded.
 *
 * Image placeholders (`<3>`) and note references (`note:412`) are pure noise in
 * an embedding — an ID carries no semantic signal, and leaving them in wastes
 * tokens and drags the vector toward whatever numerals mean to the model.
 */
export function normaliseForEmbedding(text: string): string {
  return text
    .replace(/<\d+>/g, " ")           // image placeholders
    .replace(/note:\d+/g, "note")     // note references → a bare word
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Deterministic context header prepended to the embedded text.
 *
 * A bare chunk loses its anchor: "decided to push to Q3, Dana pushing back on
 * scope" is nearly unretrievable alone. The title and date restore enough of it
 * to make the chunk findable.
 *
 * Tags and people are deliberately NOT included. They are filter dimensions
 * rather than query terms, and a tag or surname is exactly the
 * out-of-vocabulary token that embeddings handle worst — it would spend tokens
 * without moving the vector anywhere useful. Leaving them out also keeps the
 * embedded text aligned with what lexical search sees, so the two halves of
 * hybrid retrieval cannot disagree about what a note contains.
 * See docs/vector-search-and-rag.md §2.1 and §4.2.
 */
export function buildContextPrefix(title: string, createdAt: string): string {
  const date = (createdAt ?? "").slice(0, 10);
  return `Note: ${title || "(untitled)"}\nDate: ${date}\n\n`;
}

/**
 * Splits body text into top-level blocks: `#`/`##`… headings, and top-level
 * `*` / `-` / `+` bullets. Nested (indented) bullets and plain continuation
 * lines stay attached to the block above them.
 */
function splitIntoBlocks(body: string): string[] {
  const lines = body.split("\n");
  const blocks: string[] = [];
  let current: string[] = [];

  const flush = () => {
    const text = current.join("\n").trim();
    if (text) blocks.push(text);
    current = [];
  };

  for (const line of lines) {
    const isHeading = /^#{1,6}\s/.test(line);
    const isTopBullet = /^[*+-]\s/.test(line);
    if (isHeading || isTopBullet) flush();
    current.push(line);
  }
  flush();

  return blocks;
}

/** Last-resort split of a single unit that has no internal line structure. */
function splitByWords(unit: string): string[] {
  const words = unit.split(/\s+/).filter(Boolean);
  const perChunk = Math.max(1, Math.floor(MAX_CHUNK_TOKENS / 1.3));
  const out: string[] = [];
  for (let i = 0; i < words.length; i += perChunk) {
    out.push(words.slice(i, i + perChunk).join(" "));
  }
  return out;
}

/**
 * Splits an oversized block on paragraph, then line, then word boundaries.
 *
 * The word-level fallback is not hypothetical: a single pasted wall of text is
 * one "line", so paragraph and line splitting both yield exactly one unit and
 * the block would otherwise pass through at full size regardless of the cap.
 */
function splitOversized(block: string): string[] {
  if (estimateTokens(block) <= MAX_CHUNK_TOKENS) return [block];

  const units = (block.includes("\n\n") ? block.split(/\n{2,}/) : block.split("\n"))
    // A unit that alone exceeds the cap has no usable boundary left.
    .flatMap((u) => (estimateTokens(u) > MAX_CHUNK_TOKENS ? splitByWords(u) : [u]));

  const out: string[] = [];
  let buf: string[] = [];

  for (const unit of units) {
    const candidate = [...buf, unit].join("\n");
    if (buf.length && estimateTokens(candidate) > MAX_CHUNK_TOKENS) {
      out.push(buf.join("\n").trim());
      buf = [unit];
    } else {
      buf.push(unit);
    }
  }
  if (buf.length) out.push(buf.join("\n").trim());
  return out.filter(Boolean);
}

/**
 * Merges blocks below MIN_CHUNK_TOKENS into their neighbour. A one-line bullet
 * like "lunch with Bob" is retrieval noise as a standalone vector — it will
 * match weakly against everything and strongly against nothing.
 */
function mergeTiny(blocks: string[]): string[] {
  if (blocks.length <= 1) return blocks;

  const out: string[] = [];
  for (const block of blocks) {
    if (out.length && estimateTokens(block) < MIN_CHUNK_TOKENS) {
      out[out.length - 1] = `${out[out.length - 1]}\n${block}`;
    } else {
      out.push(block);
    }
  }
  // A tiny *first* block has no predecessor to merge into, so fold it forward.
  if (out.length > 1 && estimateTokens(out[0]) < MIN_CHUNK_TOKENS) {
    out[1] = `${out[0]}\n${out[1]}`;
    out.shift();
  }
  return out;
}

export function hashChunk(embedText: string): string {
  return createHash("sha256").update(embedText).digest("hex");
}

/**
 * Chunks a note. Returns [] for an empty body — a note with no text has nothing
 * to retrieve, and emitting an empty chunk would embed the context prefix alone
 * and make every untitled empty note a near-duplicate of the others.
 */
export function chunkNote(
  title: string,
  body: string,
  createdAt: string
): NoteChunk[] {
  const normalised = normaliseForEmbedding(body ?? "");
  if (!normalised) return [];

  const blocks = mergeTiny(splitIntoBlocks(normalised).flatMap(splitOversized));
  // Prose notes with no bullet or heading structure fall back to whole-note
  // chunking, which splitIntoBlocks already produces (a single block).
  if (blocks.length === 0) return [];

  const prefix = buildContextPrefix(title, createdAt);

  return blocks.map((content, chunkIndex) => {
    const embedText = `${prefix}${content}`;
    return {
      chunkIndex,
      content,
      embedText,
      contentHash: hashChunk(embedText),
      tokenCount: estimateTokens(embedText),
    };
  });
}
