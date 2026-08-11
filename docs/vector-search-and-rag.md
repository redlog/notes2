# Design: Vector Search and Notes-as-RAG

**Status:** Proposed — not implemented. Written as a plan to pick up later.
**Date:** 2026-08-11
**Scope:** Semantic search over notes via Voyage AI embeddings, and exposing the
resulting retrieval layer to an external chat agent (Claude) over MCP.

---

## 1. Motivation

Two related goals, with very different complexity:

1. **Semantic search.** Today's search is lexical only — `tsvector` /
   `websearch_to_tsquery`. It cannot find "the meeting where we decided to delay
   the platform migration" unless those exact words appear. Embedding notes lets
   the search box answer conceptual queries.
2. **Q&A over notes.** Ask "what's the current status of project X?" and get an
   answer synthesized from the notes. Explicitly **not** by building a chat UI in
   this app — instead by exposing the notes as a retrieval tool to an external
   agent (Claude Desktop / Claude Code / claude.ai) via MCP.

Goal 1 is a self-contained feature. Goal 2 is a thin wrapper over goal 1, and is
only cheap *because* goal 1 exists. Build them in that order.

---

## 2. Where this lands in the existing codebase

Read this section before designing anything; the current shape constrains the
options.

| Fact | Location | Consequence |
|---|---|---|
| FTS is a **generated column** on `notes` | `supabase/migrations/001_initial.sql:45` | No index table to maintain. Vector chunks will be the first genuinely stateful search artifact. |
| Three provider implementations | `lib/providers/{supabase,gcp,sqlite}/index.ts` behind `lib/providers/types.ts:24` | Any search change is a 3× change, or a deliberate per-project capability flag. |
| `relevance` is a live `SortKey` in the UI… | `lib/types.ts:76`, `app/page.tsx:49` | …but **all three providers silently fall back to `created_at`** (`lib/notes.ts:244`, `lib/providers/gcp/index.ts:188`, `lib/providers/sqlite/index.ts:468`). The scored-result plumbing already exists and is currently dead. Hybrid search is what finally makes it real. |
| Autosave defaults on, **30s interval** | PRD §4.5 | The single hardest constraint on "re-embed on save". See §5. |
| `saveNote()` already extracts title, mentions, inlinks | `lib/notes.ts:317`, `lib/notes.ts:21` | The metadata needed for contextual chunk prefixes is already computed on the save path. |
| Existing per-project search capability flag | `projects.trigram_search` | Precedent for making vector search opt-in per project / per provider. |
| Existing API surface | `/api/notes/[id]`, `/api/title-search`, `/api/tagline/[tag]`, `/api/export-json` | An MCP server is mostly a thin wrapper over routes that already exist. |

---

## 3. Embedding provider and model

**Provider:** Voyage AI.

**Free tier is a non-issue at personal-notes scale.** Voyage grants 200M free
tokens on the general models. A 5,000-note corpus at ~400 tokens/note is ~2M
tokens for a *full* backfill — about 1% of the allowance. Incremental re-embeds
are rounding error. Cost is not a design constraint here; if it ever becomes
one, paid `voyage-3.5-lite` is ~$0.02 / 1M tokens.

**Model:** `voyage-3.5-lite`, `output_dimension: 1024`, `output_dtype: float`.

- Supports Matryoshka dimensions (2048 / 1024 / 512 / 256) and int8 / uint8 /
  binary / ubinary quantization, so there is a storage escape hatch that does
  not require re-architecting.
- At 1024-dim float that is 4KB/chunk. 20k chunks ≈ 80MB — fits Supabase's
  500MB free-tier database, but it is a real fraction of it. Dropping to
  512-dim int8 is ~16× smaller for a modest quality cost.

**Two details that are easy to get wrong and hard to debug:**

1. **`input_type` must be `"document"` when indexing and `"query"` when
   searching.** Voyage embeds the two into different regions of the space.
   Getting this wrong does not error — it quietly degrades recall.
2. **Store `model` and `dim` on every row.** A model change is a full re-embed.
   Mixing two models in one vector column produces silently wrong neighbours.

**Worth re-evaluating at implementation time:** Voyage shipped
`voyage-context-3`, a contextualized-chunk embedding model that embeds each
chunk with its full parent document as context. That targets exactly the problem
§4 solves manually. Check current pricing/availability before committing — but
note that the manual context prefix below is free and gets most of the benefit.

---

## 4. Chunking

### 4.1 Boundary: top-level bullet

Notes in this corpus are largely meeting notes where each top-level bullet is a
distinct topic. Chunking per top-level bullet means a meeting covering three
topics produces three independently retrievable chunks, rather than one blurred
average-of-everything vector.

Rules:

- Split on top-level `*` / `-` bullets and `##` headings.
- A bullet carries its nested children into the same chunk.
- Merge chunks under ~20 tokens into the neighbouring chunk (one-line bullets
  like "lunch with Bob" are retrieval noise on their own).
- Split any chunk over ~1000 tokens.
- Fall back to whole-note chunking for prose notes with no bullet structure.
- Strip image placeholders (`<1>`) and normalize `note:ID` refs before embedding.

### 4.2 Context prefix (the highest-leverage decision here)

A bare chunk loses its anchor. *"decided to push to Q3, Dana pushing back on
scope"* is nearly unretrievable alone — no project, no date, no participants.

**Prepend a deterministic context header to the text that gets embedded, while
storing the raw chunk for display:**

```
Note: Weekly sync — Platform migration
Date: 2026-03-14  Tags: #platform #q2  People: @dana @raj

* decided to push to Q3, Dana pushing back on scope
  * Dana: scope creep on the auth piece
  * revisit at next sync
```

This is the cheap deterministic version of contextual retrieval — no LLM call,
no extra latency, no cost. Title, tags, people and mentions are already computed
on the save path (`lib/notes.ts:21`), so the ingredients are in hand.

### 4.3 Explicitly not doing: note-level embeddings

Score a note as `max()` over its chunk scores. A separate whole-note vector
doubles the write path for a marginal gain on aggregate "what is this note
about" queries. Add it later if that class of query measurably underperforms.

---

## 5. The save-flow problem

Naive "re-embed the note on save" fails three ways:

1. **Autosave fires every 30 seconds while typing.** A 30-bullet note
   re-embedded 40 times during one editing session is 1,200 embed calls for one
   note.
2. **Voyage latency lands on the save path.** ~200–500ms added to every
   autosave, and a Voyage outage would fail *saves*. Unacceptable for a note app.
3. **Vercel serverless reclaims the process after the response.**
   Fire-and-forget after the response is unreliable; it needs `waitUntil()` or
   an out-of-band drain.

### 5.1 Solution: content-hash diffing + a dirty queue

**On save (synchronous, pure Postgres, no network):**

1. Re-chunk the body.
2. Hash each chunk's embed-text (context prefix included, so a title change
   correctly invalidates every chunk in the note).
3. Compare against stored hashes for that note:
   - unchanged → leave the row and its embedding untouched
   - new or changed → upsert the row with `embedding = NULL`
   - no longer present → delete
4. Return. Total added latency: one query.

**Out of band (a drain):** select `WHERE embedding IS NULL`, batch up to 128
chunks per Voyage request, write embeddings back. Trigger via Vercel Cron each
minute, `pg_cron`, or `waitUntil()` on the save request — whichever fits the
deployment.

**What this buys:**

- Fixing a typo in one bullet of a 30-bullet note costs **one** embed, not 30.
- Autosave storms collapse — unchanged bullets hash identically every time.
- Voyage downtime means search is stale for a few minutes, not that saves fail.
- **Backfill and incremental use the same code.** Backfill is just "insert all
  chunks with NULL embeddings and let the drain run." Resumability is free.
  Mirrors the existing `scripts/migrate.mjs` batch pattern.

---

## 6. Schema sketch

New migration: `supabase/migrations/005_note_chunks.sql`.

```sql
create extension if not exists vector;

create table note_chunks (
  id           bigserial primary key,
  note_id      bigint not null references notes(id) on delete cascade,
  project_id   uuid   not null references projects(id) on delete cascade,
  chunk_index  int    not null,
  content      text   not null,          -- raw chunk, for display
  embed_text   text   not null,          -- context-prefixed, what was embedded
  content_hash text   not null,          -- sha256 of embed_text
  token_count  int,
  embedding    vector(1024),             -- NULL = queued for the drain
  model        text,                     -- e.g. 'voyage-3.5-lite'
  dim          int,
  embedded_at  timestamptz,
  constraint note_chunks_unique unique (note_id, chunk_index)
);

create index note_chunks_note_idx    on note_chunks(note_id);
create index note_chunks_project_idx on note_chunks(project_id);
create index note_chunks_pending_idx on note_chunks(project_id)
  where embedding is null;             -- drain queue

alter table note_chunks enable row level security;

create policy "note_chunks_own" on note_chunks
  for all using (
    exists (select 1 from notes n where n.id = note_id and n.user_id = auth.uid())
  );
```

`project_id` is denormalized onto the chunk deliberately: every similarity query
filters by project, and joining to `notes` for that on a vector scan is wasteful.

**No ANN index initially.** At ~20k chunks a project-filtered exact scan is a few
hundred milliseconds, and pgvector HNSW under a restrictive `WHERE` clause has
over-filtering pathologies that cost more than they save at this scale. Add HNSW
when a measurement demands it, not before.

**RLS note:** similarity search will likely go through an RPC function. Be
deliberate about `security definer` and pass `project_id` explicitly rather than
trusting the caller.

---

## 7. Search: hybrid, not replacement

**Do not replace tsvector with vectors.** Personal notes are full of
idiosyncratic tokens — project codenames, ticket IDs, surnames. Embeddings are
genuinely bad at those. `ACME-4432` is a job for `websearch_to_tsquery`.

**Run both, fuse with Reciprocal Rank Fusion:**

```
score(note) = Σ over result lists  1 / (60 + rank_in_list)
```

RRF needs no score normalization, which matters because `ts_rank` and cosine
similarity are not remotely comparable quantities. Roughly 15 lines. This is what
makes the dead `relevance` sort key (§2) real for the first time.

Aggregation: a note's vector-side rank comes from its best-scoring chunk
(`max()`), then RRF fuses the note-level lexical and semantic rankings.

**Filters are pre-filters.** The existing `#tag`, `@person`, `+#tag`, `~#tag`,
and date-range tokens should narrow the candidate set *before* the similarity
scan. This works well — filters cut the scan cost — and it is another reason the
ANN index can wait.

**UI:** prefer an explicit toggle (a "Semantic" switch beside the search bar) over
silently changing what the search box does. Relevance semantics changing
invisibly is user-hostile, and the PRD's stated principle is "speed over polish."

### 7.1 Query expansion — deferred

Ranked by cost/benefit:

1. **Nothing.** Voyage query embeddings are good. Start here.
2. **HyDE** — have a small model write a hypothetical note answering the query,
   embed *that*. Usually beats paraphrase-based expansion on this kind of corpus.
3. **Multi-query paraphrase** — 3 variants, union the results.

All of them put an LLM call on the search path (latency + cost), which fights the
"speed over polish" principle. Hybrid retrieval will yield more than expansion
will. Measure before adding.

### 7.2 Near-free bonus: related notes

Once chunks are embedded, "notes related to this one" is a single query. The read
view sidebar already has an inlinks ("What links here") panel for it to sit
beside. Highest value per line of code in this entire document.

---

## 8. Exposing notes to Claude (MCP)

The right call is **not** to build a chat UI. Expose retrieval as tools and let an
external agent do the multi-step work.

### 8.1 Transport

| | Local stdio MCP | Remote MCP (Streamable HTTP) |
|---|---|---|
| Effort | ~half a day | 2–3 days, mostly auth |
| Auth | API key in env | OAuth 2.1 + dynamic client registration |
| Reach | Claude Code / Desktop, one machine | claude.ai web, mobile, desktop |

**Start with local stdio.** Supabase Auth is not an OAuth *provider*, so the
remote path means standing up an OAuth shim or a per-user bearer token — real
work for a benefit that may not be wanted yet. A local stdio server calling the
existing API routes with an API key delivers the whole experience in an
afternoon. Promote to remote MCP only if mobile access turns out to matter.

### 8.2 Tool design (matters more than transport)

- `search_notes(query, filters, date_range, limit)` — hybrid search; returns
  chunks with note id, title, date, tags
- `get_note(id)` — full markdown (wraps `/api/notes/[id]`)
- `recent_notes(since, filters)` — plain recency, no semantics
- `get_taglines(tag)` — wraps the existing `/api/tagline/[tag]`; surprisingly
  good as an agent tool, since it returns every line mentioning a tag in context
- `list_tags` / `list_people`
- `related_notes(id)` — §7.2

### 8.3 The key insight about status questions

**"What's the current status of project X" is not a semantic similarity query.**
Pure vector search returns the most *topically similar* chunks regardless of
date — it will happily return the kickoff meeting from eight months ago. Status
questions are recency-weighted.

So: expose date filters and a recency tool, and let the agent run
`search → filter to last 60 days → get_note on the top few → synthesize`. That
multi-step behaviour is exactly what is gained by *not* building a bespoke chat,
and it is the strongest argument for the MCP approach.

---

## 9. Risks and open questions

- **Provider fan-out.** `sqlite` mode has no pgvector. Options: `sqlite-vec`, or
  brute-force cosine in JS (genuinely fine under ~10k chunks). Either way, gate
  it as a per-project capability flag following the `projects.trigram_search`
  precedent, so local mode does not break. `gcp` mode needs pgvector enabled on
  Cloud SQL.
- **Privacy posture change.** v1 was local-first and `sqlite` mode still is.
  Sending note bodies to Voyage — and then note contents into Claude via MCP —
  is a meaningful shift. For the Supabase deployment it is a small delta since
  notes are already cloud-hosted. For local mode it is not; vector search should
  probably be opt-in there, and the setting should say plainly what leaves the
  machine.
- **Supabase free-tier database size.** 500MB. See §3 for the dimension /
  quantization escape hatch.
- **Backfill rate limits.** Batch 128 inputs per request. Resumability comes free
  from the NULL-embedding queue.
- **Model pinning.** Changing embedding model = full re-embed. The `model`/`dim`
  columns exist so this is detectable rather than silently corrupting results.
- **Open: does `voyage-context-3` obsolete the manual context prefix (§4.2)?**
  Evaluate at implementation time.
- **Open: chunk-level or note-level results in the UI?** Showing matching chunks
  is more informative but diverges from the existing note-row list layout.

---

## 10. Phasing

Each phase is independently useful; stopping after any of them leaves the app in
a coherent state.

1. **Foundation.** `note_chunks` table, chunker, hash diffing, backfill script,
   drain job. No UI change at all. Verifiable by inspecting the table.
2. **Hybrid search.** Vector + lexical, RRF fusion, wired into the existing
   `relevance` sort key. Plus related-notes in the read sidebar (§7.2) for
   near-zero marginal cost.
3. **Save-flow hook.** Dirty-marking in `saveNote()` (`lib/notes.ts:317`) and the
   two provider equivalents, so the index stays live without a manual reindex.
4. **Local stdio MCP server** over the existing API routes plus the new search.
5. **(Probably never.)** Query expansion — see §7.1.

Phases 1–2 are the bulk of the value. Phase 4 is small and delivers the Q&A goal
outright. Phase 5 is likely unnecessary once hybrid search is in.
