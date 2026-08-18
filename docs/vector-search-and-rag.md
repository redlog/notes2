# Design: Vector Search and Notes-as-RAG

**Status:** Phase 0 shipped. Phases 1–5 proposed — not implemented.
**Date:** 2026-08-11 (revised 2026-08-11 — see §2.1; revised 2026-08-18 — phase 0 landed)
**Scope:** Semantic search over notes via Voyage AI embeddings, and exposing the
resulting retrieval layer to an external chat agent (Claude) over MCP.

**Revision note:** this document originally assumed a working lexical search to
build on top of. That assumption was false — relevance ranking had never been
implemented (§2.1). Repairing the lexical baseline was therefore folded in as
phase 0, and **that phase has now shipped**: all three providers rank, `score`
is populated, and the `relevance` sort key does what it says. §2.1 below is kept
as the record of what was wrong and how it was fixed; the RRF step in §7 now has
a real ranked list to fuse against.

---

## 1. Motivation

Three goals now, with very different complexity:

0. ~~**Make lexical search actually rank.**~~ **Done.** Discovered while scoping
   this work: search was *boolean matching plus a date sort*. No score was ever
   computed and the `relevance` sort key was silently coerced to `created_at` in
   all three providers. This was load-bearing for goal 1, because RRF (§7) needs
   a *ranked* lexical list to fuse against. Full detail and outcome in §2.1.
1. **Semantic search.** Today's search is lexical only — `tsvector` /
   `websearch_to_tsquery`. It cannot find "the meeting where we decided to delay
   the platform migration" unless those exact words appear. Embedding notes lets
   the search box answer conceptual queries.
2. **Q&A over notes.** Ask "what's the current status of project X?" and get an
   answer synthesized from the notes. Explicitly **not** by building a chat UI in
   this app — instead by exposing the notes as a retrieval tool to an external
   agent (Claude Desktop / Claude Code / claude.ai) via MCP.

Goal 1 is a self-contained feature. Goal 2 is a thin wrapper over goal 1, and is
only cheap *because* goal 1 exists. Goal 0 had to land first, or the fusion step
in goal 1 would have had nothing to fuse; it has.

---

## 2. Where this lands in the existing codebase

Read this section before designing anything; the current shape constrains the
options.

| Fact | Location | Consequence |
|---|---|---|
| FTS is a **generated column** on `notes` | `supabase/migrations/001_initial.sql:45` | No index table to maintain. Vector chunks will be the first genuinely stateful search artifact. |
| Three provider implementations | `lib/providers/{supabase,gcp,sqlite}/index.ts` behind `lib/providers/types.ts:24` | Any search change is a 3× change, or a deliberate per-project capability flag. |
| `relevance` is a live `SortKey` and now **works** | `lib/types.ts`, `app/page.tsx:49` | Ranked via the `search_notes_ranked()` RPC (Supabase), `ts_rank_cd` (GCP), `bm25()` (SQLite). RRF has a ranked list to fuse against — see §2.1. |
| `score` is populated, normalised 0..1 | `lib/types.ts`, `components/NoteRow.tsx:144` | Normalised against the best match in the whole result set, so it is stable across pages and comparable between providers. Raw `ts_rank_cd` / `bm25` values are never surfaced. |
| `search_vec` covers title + body only | `supabase/migrations/001_initial.sql:45` | **By design — not a gap.** Tags and people are filter dimensions, not query terms; the `#tag` / `@person` tokens match them exactly. See §2.1. |
| ~~`projects.trigram_search` is a dead flag~~ | *removed* | The flag, its API field, provider CRUD, the config toggle and the `notes_body_trgm_idx` index have all been dropped; no query ever read any of them. The trigram index moved to `title`, which `searchTitles()` actually matches with `ILIKE`. **No longer a precedent to follow** — it is the cautionary tale, not the template. Use a real capability flag for vector search (§9). |
| Query semantics diverge per provider | `lib/providers/sqlite/index.ts` `buildFtsQuery` vs `websearch_to_tsquery` | **Still open.** Postgres supports quoted phrases, `or`, and `-negation`; SQLite's `buildFtsQuery` strips punctuation, so those are silently discarded and everything becomes implicit AND. Phase 0 documented the divergence in PRD §5.1 rather than unifying it. The providers still rank different candidate sets for the same query. |
| `notes_body_trgm_idx` was on the wrong column | *fixed in migration 005* | The only `ILIKE '%…%'` queries in the app are on `title` (`searchTitles`, the note-ref autocomplete), but the trigram index was on `body` — so that query sequential-scanned on every keystroke while the index sat unused. Index moved to `title`. |
| Autosave defaults on, **30s interval** | PRD §4.5 | The single hardest constraint on "re-embed on save". See §5. |
| `saveNote()` already extracts title, mentions, inlinks | `lib/notes.ts:386`, `lib/notes.ts:24` | The metadata needed for contextual chunk prefixes is already computed on the save path. |
| No per-project search capability flag exists any more | *`projects.trigram_search` removed* | Vector search will need one; there is no longer a pattern in the codebase to copy, which is a feature — see §9. |
| Existing API surface | `/api/notes/[id]`, `/api/title-search`, `/api/tagline/[tag]`, `/api/export-json` | An MCP server is mostly a thin wrapper over routes that already exist. |

### 2.1 Pre-existing lexical search debt — resolved

Scoping this design surfaced that **relevance ranking had never worked**. This
section records what was broken and what shipped to fix it (migration
`005_search_ranking.sql` plus the three provider `list()` implementations).

**What search did before.** Every provider filtered notes to matches/non-matches
and then ordered by a date column. Nothing computed a score anywhere in the stack.

| Provider | Match | Order (before) | Order (now) |
|---|---|---|---|
| Supabase | `.textSearch("search_vec", …, {type:"websearch"})` | `created_at` / `updated_at` | `ts_rank_cd` via `search_notes_ranked()` RPC |
| GCP | `search_vec @@ websearch_to_tsquery(…)` | same | `ts_rank_cd` in the `ORDER BY` |
| SQLite | `notes_fts MATCH ?` | same | `bm25(notes_fts)` |

Matching itself was always fine and correctly indexed (GIN on `search_vec`, FTS5
virtual table). It was only the ranking half that was missing.

**Why it was silent rather than an error.** Three things conspired:

1. The UI kept showing the sort you picked — `ListResult` echoed
   `params.sortKey` back unchanged and `app/page.tsx:129` highlights the button
   from the URL, not from what the query did.
2. Scores could never render (see the `score` row above), so their absence
   looked normal.
3. Date-descending is *plausible* for personal notes. Wrong ordering reads as
   mediocre ordering, not as a bug.

Worse, `app/page.tsx:49` defaults to `relevance` whenever a search is active, so
the broken path was the **default** post-search view.

All three are now closed: `ListResult.sortKey` reports the sort actually
applied rather than echoing the request, and `score` is populated on the
relevance path so `NoteRow` renders it.

**Why it happened.** Not a decision anyone made. Everything above traces to a
single commit — `40fe6b3` "First commit, v2", the whole app scaffolded in one
shot. The PRD asked for ranking explicitly (§5.1 "ranked by relevance", §12.3
TF-IDF normalized by document length, scores displayed) and inherited it from v1,
whose hand-rolled index produced a score as a byproduct of matching. §14
"Features Explicitly Removed vs. v1" lists v1's `index.json` as removed but
**does not list scoring** — the intent was to keep ranking and change only where
the index lives.

The storage swap is what broke it. Postgres FTS gives a boolean from `@@`; the
score is a separate `ts_rank()` you must select and order by. And through the
PostgREST client, `.textSearch()` is one line while `ORDER BY ts_rank(...)` is
not expressible at all — it needs an RPC or a view, i.e. a migration. The cheap
half shipped, the expensive half became a shim, and the comment that sat on it
in the GCP provider — *"relevance is not a real column — fall back to
created_at"* (removed in the phase 0 commit) — records an ORM limitation, not a
product decision. The
provider abstraction (`0664e4e`), GCP (`0bef887`) and SQLite (`936db29`) then
each ported `list()` from the Supabase version, shim included, turning one line
into three and making it look like a convention.

**What fixing it involved, per provider:**

- **Postgres (Supabase):** blocked on PostgREST, as predicted. Ranking lives in
  a `search_notes_ranked()` RPC (migration 005) returning rows plus `score` and
  a window-function `total`. It runs `SECURITY INVOKER`, so RLS still applies —
  verified by calling it as the `authenticated` role with another user's
  `project_id` and getting zero rows. This is the same plumbing the similarity
  query will need (§6 "RLS note"); extend this function rather than adding a
  second one.
- **Postgres (GCP):** raw SQL already, so `ts_rank_cd` dropped straight into the
  `SELECT` and `ORDER BY`.
- **SQLite:** restructured to join `notes_fts` so `bm25()` is reachable. Two
  sharp edges worth knowing before touching this again, both found by running
  the queries rather than reading docs:
  - **FTS5 rejects table aliases.** `notes_fts AS f` then `f MATCH ?` or
    `bm25(f)` fails with `no such column: f`. The real table name is required,
    so the join cannot be aliased.
  - **FTS5 refuses `bm25()` inside an aggregate.** `MIN(bm25(notes_fts))` fails
    with `unable to use function bm25 in the requested context`, and wrapping it
    in a subquery does not help. The normalisation anchor is read with
    `ORDER BY … ASC LIMIT 1` instead — which is cheaper anyway.

**Score normalisation.** `ts_rank_cd` returns small positive floats; `bm25()`
returns *negative* numbers where smaller is better. Surfacing either raw would
be meaningless to a user and incomparable across providers — the same
"plausible but wrong" failure this whole section is about. So every provider
normalises to **0..1 against the best match in the whole result set**: the top
hit reads 1.000, everything else is a fraction of it. Anchoring on the whole
match set rather than the current page keeps the number stable under
pagination.

**Also handled in the same pass:**

- `NoteListItem.score` is populated, so `components/NoteRow.tsx:144` renders.
- **Latent crash, fixed.** The Supabase and SQLite guards were
  `search && sortKey === "relevance"`; only GCP guarded unconditionally. With
  `sk=relevance` and an *empty* search, `ORDER BY relevance` hit a non-existent
  column — confirmed against Postgres: `ERROR: column "relevance" does not
  exist`. `SearchBar` drops `sk` on submit so the normal flow avoided it, but a
  hand-edited URL, a bookmark, back-navigation, or `/api/export?sk=relevance`
  with no search term (`app/api/export/route.ts:15`) reached it. All three
  guards are now unconditional.
- `projects.trigram_search` **removed** along with the `notes_body_trgm_idx`
  index; the trigram index moved to `title`. Rationale: implementing real
  partial-word matching is a 3× provider change with no `pg_trgm` equivalent on
  SQLite, it would mix trigram similarity into a ranking path whose whole point
  is that incomparable scores must not be blended, and hybrid semantic search
  (§7) serves "I can't recall the exact word" far better than substring matching
  does. PRD §5.1 and §14 updated to say partial-word matching is not supported.
- Query-syntax divergence **documented rather than unified** — PRD §5.1 now
  states that the SQLite backend discards phrase/`or`/negation operators. Still
  open work.

**Dropped from scope — tags and people in `search_vec`.** Earlier revisions of
this document treated this as a gap to close. It is not; it is a design
decision, and the plan is simpler without it:

- **They are filters, not queries.** The `#tag` / `@person` filter tokens match
  this metadata *exactly*. Folding it into `search_vec` would give the same
  metadata a second, worse retrieval path — stemmed, ranked, and fuzzy — for no
  user-visible gain.
- **They are poor embedding material.** Tags and surnames are exactly the
  idiosyncratic, out-of-vocabulary tokens §7 cites as the reason to keep lexical
  search rather than replace it. They do not carry their weight in a vector.
- Where a tag or person is written into the body it indexes incidentally anyway
  (`to_tsvector` strips the sigil, so `#platform` → `platform`). That is a
  side-effect of indexing body text, not something to rely on or extend.

Two things this removes from the plan: the asymmetry warning in §2's table (if
lexical search never indexes this metadata, there is nothing for semantic search
to be asymmetric *with*), and the trigger-maintained column it would have
required. Worth recording that the originally-proposed mechanism was not
implementable regardless — Postgres rejects it with `cannot use subquery in
column generation expression`, since a generated column may only reference its
own row.

**Deliberately deferred:**

- **PRD §12.2's manual "Reindex".** Both backends maintain their index inside
  the write, so there is no drift to repair and nothing for a reindex to do.
  Revisit when a genuinely stateful search artifact exists — the chunk drain
  (§5.1) is exactly that, and gives it a natural home.

**Consequence for this design:** §7's RRF step assumes two ranked lists. It now
has them — the lexical side produces a real `rank_in_list`, so phase 2 of §10 is
unblocked.

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
on the save path (`lib/notes.ts:24`), so the ingredients are in hand.

**Open at implementation time: should the prefix carry tags and people at all?**
§2.1 keeps them out of the lexical index because they are filter dimensions and
weak embedding material. The second half of that argument applies here too — a
tag or surname is an out-of-vocabulary token that contributes little to a chunk
vector. The title and date do most of the anchoring work. Measure with and
without before assuming the metadata line earns its tokens; note that dropping
it would also make the embedded text align exactly with what lexical search
sees, which is one less way for the two halves of §7 to disagree.

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
similarity are not remotely comparable quantities. Roughly 15 lines.

**RRF consumes ranks, and the lexical side now produces one** (§2.1). Before
phase 0 the lexical list came back ordered by `created_at`, which would have
made the fusion a date-vs-similarity blend rather than a relevance one. That is
resolved: `ts_rank_cd` / `bm25` ordering gives a real `rank_in_list`.

Note that RRF consumes **ranks, not scores**, so it is indifferent to the 0..1
normalisation phase 0 introduced for display. Feed it the ordinal position in
each list and ignore the score column entirely.

Aggregation: a note's vector-side rank comes from its best-scoring chunk
(`max()`), then RRF fuses the note-level lexical and semantic rankings.

The `k=60` constant is the standard default and is fine to start with, but note
it assumes both lists are of comparable quality. If lexical ranking lands and
measurably outperforms semantic on this corpus (likely, given the codename /
ticket-ID argument above), a per-list weight is a one-line change.

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
  it as a per-project capability flag so local mode does not break. Note the
  `projects.trigram_search` precedent has been **removed**, not followed: it was
  a flag with no implementation behind it. If vector search gets a flag, wire it
  to a query on the same commit that adds the column.  `gcp` mode needs pgvector
  enabled on Cloud SQL.
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
- **Silent degradation is this codebase's established failure mode.** Relevance
  ranking (§2.1) and `trigram_search` both shipped as complete-looking UI
  surfaces over unimplemented backends, and neither surfaced an error for six
  months. Both are now resolved, but semantic search has the same shape of risk,
  and worse: a wrong `input_type` (§3), a model change without a re-embed, or a
  stalled drain all return *plausible* results rather than failing. Build in
  something observable — a count of `WHERE embedding IS NULL` on the settings
  page, and the `model`/`dim` columns actually checked at query time rather than
  merely stored.
  The phase 0 lesson worth carrying forward: **every claim in this document that
  was checked against a running database turned out to have an exception** —
  generated columns cannot aggregate cross-table, FTS5 rejects aliases and
  refuses `bm25()` in an aggregate. None of those would have failed loudly.
  Run the query before believing the design.
- **The PRD was not a reliable description of the system.** §5.1, §12.1, §12.2
  and §12.3 described search behaviour that did not exist; it was written from v1
  and landed in the same commit as the code, so it never acted as a check on the
  implementation. Those four sections have now been rewritten to match the code.
  The habit still applies: verify against the code before treating any PRD claim
  as current, and update it as part of the work.
- **Open: does `voyage-context-3` obsolete the manual context prefix (§4.2)?**
  Evaluate at implementation time.
- **Open: chunk-level or note-level results in the UI?** Showing matching chunks
  is more informative but diverges from the existing note-row list layout.

---

## 10. Phasing

Each phase is independently useful; stopping after any of them leaves the app in
a coherent state.

0. ~~**Lexical ranking (§2.1).**~~ **Shipped.** `ts_rank_cd` via the
   `search_notes_ranked()` RPC on Supabase, `ts_rank_cd` in the GCP SQL,
   `bm25()` on SQLite; `score` populated and normalised 0..1; `trigram_search`
   removed and the trigram index moved to `title`; the empty-search
   `sk=relevance` crash fixed. Extending `search_vec` to tags and people was
   dropped from scope as a design decision — see §2.1.
   Migration: `supabase/migrations/005_search_ranking.sql`.
1. **Foundation.** `note_chunks` table, chunker, hash diffing, backfill script,
   drain job. No UI change at all. Verifiable by inspecting the table.
2. **Hybrid search.** Vector + lexical, RRF fusion, wired into the existing
   `relevance` sort key. Plus related-notes in the read sidebar (§7.2) for
   near-zero marginal cost. **Phase 0 dependency satisfied** — see §7.
3. **Save-flow hook.** Dirty-marking in `saveNote()` (`lib/notes.ts:386`) and the
   two provider equivalents, so the index stays live without a manual reindex.
4. **Local stdio MCP server** over the existing API routes plus the new search.
5. **(Probably never.)** Query expansion — see §7.1.

Phase 0 was cheap, unblocks phase 2, and was worth doing even if the rest of this
document is never built. Phases 1–2 are the bulk of the remaining value. Phase 4
is small and delivers the Q&A goal outright. Phase 5 is likely unnecessary once
hybrid search is in.

**Sequencing note:** phase 0 shipped before phase 1, so the "one migration"
consolidation it suggested did not happen — `005_search_ranking.sql` exposes
lexical rank only. When the similarity query arrives, **extend
`search_notes_ranked()` rather than adding a parallel function**: it already
carries the project filter, the `filter_ids` pre-filter, the date bounds, the
tag/person aggregation and the window-function total, and duplicating that in a
second RPC is how the three-way `list()` divergence happened in the first place.
