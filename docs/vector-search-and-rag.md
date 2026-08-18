# Design: Vector Search and Notes-as-RAG

**Status:** Phases 0–3 shipped. Phase 4 (MCP) proposed; phase 5 unlikely.
**Date:** 2026-08-11 (revised 2026-08-11 — see §2.1; revised 2026-08-18 — phases 0–3 landed)
**Scope:** Semantic search over notes via Voyage AI embeddings, and exposing the
resulting retrieval layer to an external chat agent (Claude) over MCP.

**Revision note:** this document originally assumed a working lexical search to
build on top of. That assumption was false — relevance ranking had never been
implemented (§2.1). Repairing the lexical baseline was therefore folded in as
phase 0, and **that phase has now shipped**: all three providers rank, `score`
is populated, and the `relevance` sort key does what it says. §2.1 below is kept
as the record of what was wrong and how it was fixed.

**Phases 1–3 have also shipped** — notes are chunked and embedded, search fuses
the lexical and semantic rankings with RRF, related notes are live, and the save
path keeps the index current. What remains is phase 4 (MCP). Sections below are
annotated where the implementation departed from the plan; §11 records what was
learned building it.

---

## 1. Motivation

Three goals now, with very different complexity:

0. ~~**Make lexical search actually rank.**~~ **Done.** Discovered while scoping
   this work: search was *boolean matching plus a date sort*. No score was ever
   computed and the `relevance` sort key was silently coerced to `created_at` in
   all three providers. This was load-bearing for goal 1, because RRF (§7) needs
   a *ranked* lexical list to fuse against. Full detail and outcome in §2.1.
1. ~~**Semantic search.**~~ **Done.** Search was lexical only — `tsvector` /
   `websearch_to_tsquery` — and could not find "the meeting where we decided to
   delay the platform migration" unless those exact words appeared. Notes are
   now chunked and embedded, and the relevance sort fuses both rankings (§7).
2. **Q&A over notes.** Ask "what's the current status of project X?" and get an
   answer synthesized from the notes. Explicitly **not** by building a chat UI in
   this app — instead by exposing the notes as a retrieval tool to an external
   agent (Claude Desktop / Claude Code / claude.ai) via MCP.

Goal 1 is a self-contained feature and is now built. Goal 2 is a thin wrapper
over it, and is only cheap *because* goal 1 exists — that is the remaining work.

---

## 2. Where this lands in the existing codebase

Read this section before designing anything; the current shape constrains the
options.

| Fact | Location | Consequence |
|---|---|---|
| FTS is a **generated column** on `notes` | `supabase/migrations/001_initial.sql:45` | No index table to maintain. `note_chunks` (migration 006) is now the first genuinely stateful search artifact — and the reason PRD §12.2's reindex finally has something to repair. |
| Three provider implementations | `lib/providers/{supabase,gcp,sqlite}/index.ts` behind `lib/providers/types.ts:24` | Any search change is a 3× change, or a deliberate per-project capability flag. |
| `relevance` is a live `SortKey` and now **works** | `lib/types.ts`, `app/page.tsx:49` | Ranked via the `search_notes_ranked()` RPC (Supabase), `ts_rank_cd` (GCP), `bm25()` (SQLite). RRF has a ranked list to fuse against — see §2.1. |
| `score` is populated, normalised 0..1 | `lib/types.ts`, `components/NoteRow.tsx:144` | Normalised against the best match in the whole result set, so it is stable across pages and comparable between providers. Raw `ts_rank_cd` / `bm25` values are never surfaced. |
| `search_vec` covers title + body only | `supabase/migrations/001_initial.sql:45` | **By design — not a gap.** Tags and people are filter dimensions, not query terms; the `#tag` / `@person` tokens match them exactly. See §2.1. |
| ~~`projects.trigram_search` is a dead flag~~ | *removed* | The flag, its API field, provider CRUD, the config toggle and the `notes_body_trgm_idx` index have all been dropped; no query ever read any of them. The trigram index moved to `title`, which `searchTitles()` actually matches with `ILIKE`. **No longer a precedent to follow** — it is the cautionary tale, not the template. Use a real capability flag for vector search (§9). |
| Query semantics diverge per provider | `lib/providers/sqlite/index.ts` `buildFtsQuery` vs `websearch_to_tsquery` | **Still open.** Postgres supports quoted phrases, `or`, and `-negation`; SQLite's `buildFtsQuery` strips punctuation, so those are silently discarded and everything becomes implicit AND. Phase 0 documented the divergence in PRD §5.1 rather than unifying it. The providers still rank different candidate sets for the same query. |
| `notes_body_trgm_idx` was on the wrong column | *fixed in migration 005* | The only `ILIKE '%…%'` queries in the app are on `title` (`searchTitles`, the note-ref autocomplete), but the trigram index was on `body` — so that query sequential-scanned on every keystroke while the index sat unused. Index moved to `title`. |
| Autosave defaults on, **30s interval** | PRD §4.5 | The single hardest constraint on "re-embed on save", and the reason for the hash-diff queue in §5. Handled: an unchanged bullet hashes identically, so an autosave storm produces no embedding work at all. |
| `saveNote()` already extracts title, mentions, inlinks | `lib/notes.ts:386`, `lib/notes.ts:24` | The metadata needed for contextual chunk prefixes is already computed on the save path. |
| `projects.vector_search` is a real capability flag | migration 006, `components/ConfigForm.tsx` | Gates embedding per project, defaults off, and states plainly that note text goes to Voyage. Wired to actual queries in the same commit that added the column — the opposite of how `trigram_search` was done. |
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

**Resolved at implementation time — `voyage-context-*` was evaluated and not
used.** The contextualized-chunk models (`voyage-context-3`, and now
`voyage-context-4`) embed each chunk with its parent document as context, which
does target the problem §4.2 solves by hand. They were rejected on architecture,
not quality: their request shape is `inputs: string[][]` — chunks **grouped by
document** — so a chunk's vector depends on its siblings. Editing one bullet
would then invalidate every chunk in the note, which destroys the property the
whole save-flow design in §5 is built on ("fix a typo, pay for one embed, not
thirty"). The batching model also conflicts with a drain that pulls arbitrary
pending chunks across notes. The manual context prefix stays: it is free, it
keeps chunks independent, and it gets most of the benefit.

**API shape was taken from the official `voyageai` TypeScript SDK's types, not
from the docs site** (which the sandbox could not reach). Endpoint is
`POST https://api.voyageai.com/v1/embeddings`; `input` is capped at 128 entries.
`lib/embeddings.ts` is a plain fetch wrapper rather than the SDK — one endpoint,
six fields, no reason for the dependency.

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

**Settled: the prefix carries title and date only.** The tags/people line shown
above was dropped. §2.1 keeps that metadata out of the lexical index because it
is a filter dimension and weak embedding material, and the second half of the
argument applies here too — a tag or surname is an out-of-vocabulary token that
spends prefix tokens without moving the vector anywhere useful. Dropping it also
aligns the embedded text with what lexical search sees, so the two halves of §7
cannot disagree about what a note contains. Implemented in
`buildContextPrefix()` (`lib/chunking.ts`).

**Also implemented in the chunker, beyond the rules in §4.1:** a word-level
split for oversized blocks. Paragraph and line splitting both yield a single
unit for a pasted wall of text, so without it a 3,000-word single-line bullet
sailed past the 1,000-token cap untouched — caught by testing the chunker, not
by reading it.

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

**Shipped as designed.** `lib/semantic.ts` calls the chunk sync after a
successful save; `/api/embed-drain` is the drain; a Vercel cron entry
(`vercel.json`) runs it every five minutes.

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

**Backfill ended up browser-driven rather than a script.** Notes written before
the feature was switched on have no chunk rows at all, so the back catalogue has
to be walked once. `/api/backfill-chunks` chunks one page of notes per request
and returns a cursor; the Settings button loops it, then loops the drain,
showing progress. Two reasons this beat `scripts/migrate.mjs`'s pattern: a
standalone script would need its own service-role credentials and provider
wiring, and a single server-side loop would exceed a serverless timeout on any
real corpus. The queue lives in the database, so closing the page mid-run loses
nothing.

---

## 6. Schema sketch

Shipped as `supabase/migrations/006_note_chunks.sql` (005 was taken by the
lexical ranking work). The sketch below is what landed, with one addition: a
`projects.vector_search` flag gating the whole feature per project.

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

**RLS note:** similarity search goes through the `search_notes_ranked()` RPC.
It is `SECURITY INVOKER` — the caller's RLS applies — and takes `project_id`
explicitly rather than inferring it. Verified by calling it as the
`authenticated` role with another user's `project_id` and getting zero rows;
same for `related_notes()`.

**The query embedding is passed as `text`, not `vector`.** PostgREST sends RPC
arguments as JSON, and a JSON string cast inside the function is the shape that
works across PostgREST versions. The internal cast is to unconstrained `vector`
on purpose, so a dimension mismatch errors loudly at comparison time instead of
being coerced.

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
made the fusion a date-vs-similarity blend rather than a relevance one.

RRF consumes **ranks, not scores**, so it is indifferent to the 0..1
normalisation phase 0 introduced for display: the implementation feeds it
ordinal positions and ignores the score column. The fused RRF value is then
itself normalised 0..1 for display, exactly as the lexical score was.

### 7.1 The threshold is not tuning — it is what makes the feature work

The single most important thing learned building this, and it is not in the plan
above.

**Cosine distance is defined for every stored chunk.** A top-N cap on the vector
side bounds how many candidates join the fusion, but says nothing about whether
any of them are *related*. With only a cap, a project holding fewer notes than
the cap contributes every note it has to the candidate set — so searching
"platform" returns the entire corpus, ranked. Observed directly in testing: a
note reading "nothing at all", with an orthogonal vector and no lexical match,
scored 0.488 and ranked third.

So the vector side carries **two** bounds:

- `p_vector_limit` (default 50) — how many candidates may join the fusion.
- `p_max_distance` (default 0.65) — whether a candidate counts as related at all.

The threshold is what makes "no semantic matches" an expressible outcome. Too
tight and the semantic-only recall that justifies the whole feature disappears;
too loose and everything matches. **0.65 is a starting point, not a measured
value** — it is a function parameter rather than a constant precisely so it can
be tuned against a real corpus without a migration. Tune it once there are real
embeddings to look at.

`related_notes()` carries the same threshold for the same reason: without it the
sidebar panel always shows five notes no matter how unrelated, which reads as a
recommendation rather than as "nothing here is related".

### 7.2 Filter pre-resolution has a trap in it

The tag/person filter tokens resolve to a list of note ids that pre-filters the
query. That list is applied to **both** sides of the fusion — which means
resolving it must not involve the search term. All three providers originally
narrowed those ids by the lexical match, which would have confined vector search
to notes that already matched the words, silently deleting exactly the
semantic-only results hybrid search exists to produce. Fixed in the same commit;
worth re-checking if that code is ever restructured.

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

**UI — departed from the plan.** The suggestion here was a "Semantic" switch
beside the search bar. What shipped is a per-project setting instead, for two
reasons: the per-search toggle would have to be a URL parameter threaded through
every search link, and the honest unit of consent is the project, not the query
— the meaningful choice is "may this project's text be sent to Voyage", which is
answered once rather than per search. Relevance semantics still do not change
invisibly: the feature is off until switched on, and the settings copy says what
leaves the machine.

### 7.3 Query expansion — deferred

Ranked by cost/benefit:

1. **Nothing.** Voyage query embeddings are good. Start here.
2. **HyDE** — have a small model write a hypothetical note answering the query,
   embed *that*. Usually beats paraphrase-based expansion on this kind of corpus.
3. **Multi-query paraphrase** — 3 variants, union the results.

All of them put an LLM call on the search path (latency + cost), which fights the
"speed over polish" principle. Hybrid retrieval will yield more than expansion
will. Measure before adding — and with hybrid now shipped, measuring is possible.

### 7.4 Near-free bonus: related notes

Shipped, and the assessment held: it is a single query, and it sits beside the
inlinks panel in the note sidebar. One panel is the links you wrote, the other
the ones you didn't. Highest value per line of code in this entire document.

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

- **Provider fan-out — resolved.** `sqlite` mode brute-forces cosine in JS
  (`vectorRanking()` / `fuseRRF()` in the provider), avoiding a native
  `sqlite-vec` dependency in the one mode whose appeal is that it just runs.
  Embeddings are stored as a Float32Array BLOB — 4KB at 1024 dims against ~15KB
  as JSON, and this is the largest table in a local database. Fusion happens in
  TypeScript there and in SQL on Postgres. `gcp` still needs pgvector enabled on
  Cloud SQL, and needs migrations 005–006 applied.
  The GCP provider calls the shared `search_notes_ranked()` function rather than
  keeping its own copy of the ranking SQL — a second implementation of the
  fusion logic is precisely how `relevance` stayed broken for six months.
- **Privacy posture change — handled.** `projects.vector_search` defaults to
  **false** everywhere, not just in local mode, and the settings copy says
  plainly that note text is sent to Voyage AI. Two independent gates in practice:
  no `VOYAGE_API_KEY` means nothing is embedded at all, and the settings panel
  says so rather than silently doing nothing. Sending note contents into Claude
  via MCP (phase 4) is a further step and deserves its own consent point.
- **Supabase free-tier database size.** 500MB. See §3 for the dimension /
  quantization escape hatch.
- **Backfill rate limits.** Batch 128 inputs per request (the API's hard cap).
  Resumability comes free from the NULL-embedding queue. A failed drain batch
  leaves the rows queued rather than marking them failed, so the next tick
  retries — which means a permanently poisoned chunk retries forever, visible as
  a pending count that never reaches zero. That is the intended trade: better
  than silently dropping content out of the index.
- **Model pinning — enforced, not just recorded.** Changing the embedding model
  is a full re-embed. `model` is checked *at query time*: chunks embedded by a
  different model are excluded from the similarity scan rather than compared
  across incompatible vector spaces. "Rebuild from scratch" in Settings is the
  supported way to switch. Changing `VOYAGE_DIM` additionally needs a migration,
  since `note_chunks.embedding` is declared `vector(1024)`.
- **Silent degradation is this codebase's established failure mode.** Relevance
  ranking (§2.1) and `trigram_search` both shipped as complete-looking UI
  surfaces over unimplemented backends, and neither surfaced an error for six
  months. Semantic search has the same shape of risk and worse: a wrong
  `input_type` (§3), a model change without a re-embed, or a stalled drain all
  return *plausible* results rather than failing. Countermeasures shipped:
  the pending-chunk count is on the config page, `model` is checked at query
  time, `input_type` is two separate named functions (`embedDocuments` /
  `embedQuery`) rather than one flag that can default wrong, and the Voyage
  response is validated for width and re-sorted by `index` rather than trusted
  by array order. The settings panel distinguishes "on but no API key" from
  "on and working", because those look identical from the search box.
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
- ~~**Open: does `voyage-context-3` obsolete the manual context prefix?**~~
  Answered in §3: no, because chunk vectors would stop being independent and the
  save-flow design depends on that independence.
- **Still open: chunk-level or note-level results in the UI?** Shipped
  note-level — a note's score comes from its best-matching chunk — because that
  fits the existing note-row layout. Showing *which passage* matched is more
  informative and remains unbuilt; the chunk text is stored (`content`) for
  exactly this.
- **Still open: the distance threshold is unmeasured.** See §7.1. It is the one
  number in this feature picked by reasoning rather than evidence.

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
1. ~~**Foundation.**~~ **Shipped.** `note_chunks` (migration 006), chunker
   (`lib/chunking.ts`), hash diffing, browser-driven backfill
   (`/api/backfill-chunks`), drain (`/api/embed-drain` + Vercel cron).
2. ~~**Hybrid search.**~~ **Shipped.** Vector + lexical, RRF fusion, wired into
   the `relevance` sort key, plus related notes in the read sidebar (§7.4).
3. ~~**Save-flow hook.**~~ **Shipped.** Chunk sync runs after a successful save
   (`lib/semantic.ts`, called from the note PUT route) rather than inside each
   provider's `save()` — one call site instead of three.
4. **Local stdio MCP server** over the existing API routes plus the new search.
   The only phase left, and now the cheapest it will ever be: `search_notes`
   is a thin wrapper over the hybrid search that already exists, and
   `related_notes` is already a provider method.
5. **(Probably never.)** Query expansion — see §7.3.

Phases 0–3 delivered the bulk of the value. Phase 4 is small and delivers the
Q&A goal outright. Phase 5 is likely unnecessary now that hybrid search is in.

**Sequencing note, resolved.** Phase 0 shipped before phase 1, so the "one
migration" consolidation did not happen: 005 exposed lexical rank and 006 added
the vector side. The advice it carried was followed — 006 **extended**
`search_notes_ranked()` with optional embedding arguments rather than adding a
parallel function, so the project filter, filter-id pre-filter, date bounds,
tag/person aggregation and window-function total have exactly one
implementation. With `p_query_embedding` NULL the function behaves precisely as
it did before, which is what let the change land without touching the lexical
path's behaviour.

---

## 11. What building it changed about the plan

Kept short and specific, because the pattern is the point: **every assumption in
this document that was checked against a running system had an exception.** None
of them would have failed loudly.

| Planned | Actual |
|---|---|
| Extend `search_vec` to tags/people via the generated column | Not possible — `cannot use subquery in column generation expression`. Then dropped from scope entirely as a design decision (§2.1). |
| `bm25()` is "one call away" on SQLite | FTS5 rejects table aliases, and refuses `bm25()` inside an aggregate. |
| Cap the vector side at top-N | A cap alone returns the whole corpus on a small project. The distance threshold is the load-bearing bound (§7.1). |
| `voyage-context-3` may replace the manual prefix | It would couple chunk vectors to their siblings and destroy the incremental re-embed property (§3). |
| Backfill as a batch script | Browser-driven paging instead: no separate credentials, no serverless timeout (§5.1). |
| Per-search "Semantic" toggle | Per-project setting: consent belongs to the project, not the query (§7). |
| Filter ids pre-filter the query | They pre-filter *both* sides, so resolving them must not involve the search term — or semantic-only results silently vanish (§7.2). |

Two further notes for whoever picks this up:

**The distance threshold is the one unmeasured number.** Everything else here is
either verified against a running database or forced by an API contract. 0.65 was
chosen by reasoning about cosine distance, not by looking at this corpus. It is a
function parameter for that reason.

**Test with controlled vectors, not real ones.** Every similarity behaviour above
— ranking order, the threshold, the model-mismatch exclusion, RRF fusion,
pagination stability — was verified with one-hot vectors, where distance is
exactly 0 or exactly 1. That makes assertions about ordering and thresholds
deterministic and needs no API key. Reserve real embeddings for judging result
*quality*, which is the one thing synthetic vectors cannot tell you.

---

## 12. Operating it

- **Setup:** set `VOYAGE_API_KEY`, apply migration 006, then turn on "Semantic
  search" per project in Settings and press **Build index**. New notes are
  indexed automatically from then on.
- **Keeping it current:** the Vercel cron entry in `vercel.json` hits
  `/api/embed-drain` every five minutes, authenticated with `CRON_SECRET`.
  Without that variable the drain is session-only and runs from the Settings
  button. Local SQLite mode has no cron — use the button.
- **Watching it:** the pending-chunk count on the config page is the health
  signal. Zero means the index is current. A number that never falls means the
  drain is failing; check the server log for `[drain]`.
- **Changing model:** set `VOYAGE_MODEL`, then **Rebuild from scratch**. Old
  vectors are ignored at query time until they are replaced, so search degrades
  to lexical-only during the rebuild rather than returning nonsense.
- **Cost:** a full re-index of ~5,000 notes is roughly 2M tokens — about 1% of
  Voyage's 200M free tier. Incremental re-embeds are rounding error.
