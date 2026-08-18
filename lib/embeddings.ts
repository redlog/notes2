/**
 * Voyage AI embeddings client.
 *
 * Deliberately a plain fetch wrapper rather than the `voyageai` SDK: this uses
 * one endpoint with six fields, and the SDK would add a dependency (and its own
 * retry/timeout behaviour) for no benefit on a single call site.
 *
 * Request shape verified against the official TypeScript SDK's types, not
 * guessed. See docs/vector-search-and-rag.md §3.
 */

const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";

/** The API rejects more than 128 inputs in one request. */
export const MAX_BATCH = 128;

/**
 * Model and dimension are env-configurable because changing either is a full
 * re-embed, and every chunk row records the model/dim it was produced with so
 * a mismatch is detectable rather than silently returning wrong neighbours.
 *
 * Default is voyage-3.5-lite at 1024 dimensions. Newer general-purpose models
 * (voyage-4-lite and friends) exist and are a one-variable change followed by a
 * re-embed — but `note_chunks.embedding` is declared vector(1024), so changing
 * VOYAGE_DIM also needs a migration to widen the column.
 */
export function embeddingModel(): string {
  return process.env.VOYAGE_MODEL || "voyage-3.5-lite";
}

export function embeddingDim(): number {
  return Number(process.env.VOYAGE_DIM || 1024);
}

export function isEmbeddingConfigured(): boolean {
  return !!process.env.VOYAGE_API_KEY;
}

interface VoyageResponse {
  data?: { embedding?: number[]; index?: number }[];
  usage?: { total_tokens?: number };
  detail?: string;
}

/**
 * `input_type` is the single easiest thing to get wrong here and the hardest to
 * debug: Voyage embeds documents and queries into different regions of the
 * space, and using the wrong one does not error — it quietly degrades recall.
 * Hence two named functions rather than one with a flag defaulted.
 */
async function embed(
  texts: string[],
  inputType: "document" | "query"
): Promise<number[][]> {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) throw new Error("VOYAGE_API_KEY is not set");
  if (texts.length === 0) return [];
  if (texts.length > MAX_BATCH) {
    throw new Error(`embed() called with ${texts.length} inputs; max is ${MAX_BATCH}`);
  }

  const res = await fetch(VOYAGE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: texts,
      model: embeddingModel(),
      input_type: inputType,
      output_dimension: embeddingDim(),
      output_dtype: "float",
      // Over-length inputs are truncated rather than failing the whole batch.
      // The chunker already bounds chunk size; this is a backstop so one
      // pathological note cannot stall the drain forever.
      truncation: true,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Voyage API ${res.status}: ${body.slice(0, 400)}`);
  }

  const json = (await res.json()) as VoyageResponse;
  const data = json.data ?? [];
  if (data.length !== texts.length) {
    throw new Error(
      `Voyage returned ${data.length} embeddings for ${texts.length} inputs`
    );
  }

  // The API documents an `index` field; sort by it rather than trusting array
  // order, then verify shape. A silently short or wrong-width vector would
  // corrupt neighbours without ever raising an error.
  const sorted = [...data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const dim = embeddingDim();
  return sorted.map((d, i) => {
    const v = d.embedding;
    if (!Array.isArray(v) || v.length !== dim) {
      throw new Error(
        `Voyage returned a ${v?.length ?? "missing"}-dim vector at index ${i}; expected ${dim}`
      );
    }
    return v;
  });
}

/** Embeds note chunks for storage. */
export async function embedDocuments(texts: string[]): Promise<number[][]> {
  return embed(texts, "document");
}

/** Embeds a search query. Never use embedDocuments() for this. */
export async function embedQuery(text: string): Promise<number[]> {
  const [v] = await embed([text], "query");
  return v;
}

/** Splits into API-sized batches. */
export function batched<T>(items: T[], size = MAX_BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** pgvector's text input format. */
export function toVectorLiteral(v: number[]): string {
  return `[${v.join(",")}]`;
}

/** Cosine similarity, for the SQLite provider which has no pgvector. */
export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
