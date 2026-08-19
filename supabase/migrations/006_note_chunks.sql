-- ============================================================
-- 006: Note chunks, embeddings, and hybrid search
-- ============================================================
-- Adds the first genuinely stateful search artifact in the app: `note_chunks`,
-- one row per retrievable passage, each carrying a Voyage embedding.
--
-- Everything before this maintained its index inside the write (a generated
-- tsvector column, an FTS5 table). Embeddings cannot work that way — they need
-- a network call — so chunks are written synchronously with `embedding = NULL`
-- and filled in out of band by the drain (/api/embed-drain). A NULL embedding
-- *is* the queue; see `note_chunks_pending_idx`.

-- Resolve unqualified type names against both layouts. Supabase installs
-- extensions into an `extensions` schema; a vanilla Postgres (and Cloud SQL)
-- puts them in `public`. Naming a schema that does not exist is harmless —
-- Postgres simply skips it — so this one line works for both.
set search_path = public, extensions;

create extension if not exists vector;

-- ── Per-project opt-in ───────────────────────────────────────────────────────
-- Embedding sends note text to Voyage AI. For the cloud deployments that is a
-- small delta (notes are already hosted), but for local SQLite mode it is a
-- real change in posture, so this is off until explicitly enabled.
--
-- Unlike the `trigram_search` flag this replaces, it is wired to actual queries
-- in the same commit that adds it.
alter table projects
  add column if not exists vector_search boolean not null default false;

-- ── Chunks ───────────────────────────────────────────────────────────────────
create table if not exists note_chunks (
  id           bigserial primary key,
  note_id      bigint not null references notes(id)    on delete cascade,
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

-- project_id is denormalised onto the chunk deliberately: every similarity
-- query filters by project, and joining to notes for that on a vector scan is
-- wasteful.
create index if not exists note_chunks_note_idx    on note_chunks(note_id);
create index if not exists note_chunks_project_idx on note_chunks(project_id);
create index if not exists note_chunks_pending_idx on note_chunks(project_id)
  where embedding is null;             -- the drain queue

-- No ANN (HNSW/IVFFlat) index on purpose. At personal-notes scale a
-- project-filtered exact scan is a few hundred milliseconds, and pgvector's ANN
-- indexes have over-filtering pathologies under a restrictive WHERE that cost
-- more than they save here. Add one when a measurement demands it.
--
-- The embedding column is vector(1024) rather than unconstrained: changing
-- output_dimension is a full re-embed anyway, so it warrants its own migration
-- rather than silently mixing widths.

alter table note_chunks enable row level security;

drop policy if exists "note_chunks_own" on note_chunks;
create policy "note_chunks_own" on note_chunks
  for all using (
    exists (select 1 from notes n where n.id = note_id and n.user_id = auth.uid())
  );

-- ── Hybrid search ────────────────────────────────────────────────────────────
-- Extends search_notes_ranked() rather than adding a parallel function: it
-- already carries the project filter, the filter-id pre-filter, the date
-- bounds, the tag/person aggregation and the window-function total.
--
-- With p_query_embedding NULL the behaviour is exactly as before (pure
-- lexical), so existing callers are unaffected.
--
-- Fusion is Reciprocal Rank Fusion: score = Σ 1/(k + rank_in_list). RRF
-- consumes *ranks*, not scores, which is what makes it valid to combine
-- ts_rank_cd with cosine distance — two quantities that are not remotely
-- comparable.
--
-- p_query_embedding is `text`, not `vector`: PostgREST passes RPC arguments as
-- JSON, and a JSON string cast to a domain type is the one shape that works
-- across PostgREST versions. It is cast to `vector` inside. An unconstrained
-- cast is deliberate — a dimension mismatch then errors loudly at comparison
-- time rather than being silently coerced.
drop function if exists public.search_notes_ranked(
  uuid, text, bigint[], timestamptz, timestamptz, text, int, int
);

create or replace function public.search_notes_ranked(
  p_project_id       uuid,
  p_search           text,
  p_filter_ids       bigint[]    default null,
  p_time_min         timestamptz default null,
  p_time_max         timestamptz default null,
  p_sort_order       text        default 'desc',
  p_limit            int         default 25,
  p_offset           int         default 0,
  p_query_embedding  text        default null,
  p_model            text        default null,
  p_vector_limit     int         default 50,
  p_max_distance     real        default 0.65
)
returns table (
  out_id         bigint,
  out_title      text,
  out_body       text,
  out_created_at timestamptz,
  out_updated_at timestamptz,
  out_tags       jsonb,
  out_people     jsonb,
  out_score      real,
  out_total      bigint
)
language sql
stable
security invoker
set search_path = public, extensions, pg_temp
as $$
  with q as (
    select
      websearch_to_tsquery('english', p_search) as tsq,
      case when p_query_embedding is null then null
           else p_query_embedding::vector end   as qvec
  ),
  -- Lexical side: ranked by cover density.
  lex as (
    select
      n.id,
      row_number() over (
        order by ts_rank_cd(n.search_vec, q.tsq) desc, n.id desc
      ) as rnk
    from notes n
    cross join q
    where n.project_id = p_project_id
      and n.search_vec @@ q.tsq
      and (p_filter_ids is null or n.id = any (p_filter_ids))
      and (p_time_min is null or n.created_at >= p_time_min)
      and (p_time_max is null or n.created_at <  p_time_max)
  ),
  -- Semantic side: a note's distance is its best-matching chunk (min cosine
  -- distance).
  --
  -- Two bounds, and BOTH are load-bearing. p_vector_limit caps how many
  -- candidates can join the fusion; p_max_distance decides whether a candidate
  -- is related at all. Cosine distance is defined for *every* stored chunk, so
  -- with only a top-N cap a small project returns every note it has — a search
  -- for "platform" would come back with the entire corpus, ranked. The
  -- threshold is what makes "no semantic matches" an expressible outcome.
  --
  -- 0.65 (≈0.35 cosine similarity) is a starting point, not a measured value:
  -- it is deliberately a parameter so it can be tuned against a real corpus
  -- without a migration. Too tight loses the semantic-only recall that is the
  -- entire point of this feature; too loose reintroduces the everything-matches
  -- behaviour above.
  vec as (
    select
      c.note_id as id,
      row_number() over (order by min(c.embedding <=> q.qvec) asc, c.note_id desc) as rnk
    from note_chunks c
    join notes n on n.id = c.note_id
    cross join q
    where q.qvec is not null
      and c.project_id = p_project_id
      and c.embedding is not null
      -- Checked, not merely stored: chunks embedded by a different model are
      -- not comparable to this query vector and must not be scored against it.
      and (p_model is null or c.model = p_model)
      and (p_filter_ids is null or c.note_id = any (p_filter_ids))
      and (p_time_min is null or n.created_at >= p_time_min)
      and (p_time_max is null or n.created_at <  p_time_max)
    group by c.note_id
    having min(c.embedding <=> q.qvec) <= p_max_distance
    order by min(c.embedding <=> q.qvec) asc, c.note_id desc
    limit p_vector_limit
  ),
  fused as (
    select
      coalesce(l.id, v.id) as id,
      coalesce(1.0 / (60 + l.rnk), 0) + coalesce(1.0 / (60 + v.rnk), 0) as rrf
    from lex l
    full outer join vec v on v.id = l.id
  ),
  scored as (
    select
      f.id,
      f.rrf,
      count(*)     over () as total,
      max(f.rrf)   over () as max_rrf
    from fused f
  )
  select
    n.id,
    n.title,
    n.body,
    n.created_at,
    n.updated_at,
    coalesce(
      (select jsonb_agg(jsonb_build_object('tag', t.tag, 'is_header', t.is_header))
         from note_tags t where t.note_id = n.id),
      '[]'::jsonb
    ),
    coalesce(
      (select jsonb_agg(jsonb_build_object('person', p.person, 'is_header', p.is_header))
         from note_people p where p.note_id = n.id),
      '[]'::jsonb
    ),
    (case when s.max_rrf > 0 then s.rrf / s.max_rrf else 0 end)::real,
    s.total
  from scored s
  join notes n on n.id = s.id
  order by
    case when p_sort_order = 'asc'  then s.rrf end asc  nulls last,
    case when p_sort_order <> 'asc' then s.rrf end desc nulls last,
    n.id desc
  limit  p_limit
  offset p_offset;
$$;

grant execute on function public.search_notes_ranked(
  uuid, text, bigint[], timestamptz, timestamptz, text, int, int, text, text, int, real
) to authenticated;

-- ── Related notes ────────────────────────────────────────────────────────────
-- "Notes related to this one": the cheapest possible use of the chunk table,
-- and the highest value per line in the whole design. A note's relatedness to
-- another is the closest chunk pair between them.
create or replace function public.related_notes(
  p_note_id      bigint,
  p_limit        int  default 5,
  p_model        text default null,
  p_max_distance real default 0.65
)
returns table (
  out_id         bigint,
  out_title      text,
  out_created_at timestamptz,
  out_score      real
)
language sql
stable
security invoker
set search_path = public, extensions, pg_temp
as $$
  with src as (
    select c.embedding, c.project_id
    from note_chunks c
    where c.note_id = p_note_id
      and c.embedding is not null
      and (p_model is null or c.model = p_model)
  ),
  nearest as (
    select
      c.note_id as id,
      min(c.embedding <=> s.embedding) as dist
    from note_chunks c
    cross join src s
    where c.project_id = s.project_id
      and c.note_id <> p_note_id
      and c.embedding is not null
      and (p_model is null or c.model = p_model)
    group by c.note_id
    -- Same reasoning as the search threshold above: without it this panel
    -- always shows p_limit notes, however unrelated, which reads as a
    -- recommendation rather than "nothing is related to this".
    having min(c.embedding <=> s.embedding) <= p_max_distance
    order by dist asc
    limit p_limit
  )
  select
    n.id,
    n.title,
    n.created_at,
    -- Cosine distance is 0..2; report similarity as 1 - distance so higher is
    -- better, consistent with every other score the app surfaces.
    greatest(0, 1 - nearest.dist)::real
  from nearest
  join notes n on n.id = nearest.id
  order by nearest.dist asc;
$$;

grant execute on function public.related_notes(bigint, int, text, real) to authenticated;

-- ── Drain queue observability ────────────────────────────────────────────────
-- A stalled drain returns *plausible* results (stale ones) rather than failing,
-- so the pending count needs to be visible somewhere. Surfaced on the config
-- page.
create or replace function public.pending_chunk_count(p_project_id uuid)
returns bigint
language sql
stable
security invoker
set search_path = public, extensions, pg_temp
as $$
  select count(*) from note_chunks
  where project_id = p_project_id and embedding is null;
$$;

grant execute on function public.pending_chunk_count(uuid) to authenticated;
