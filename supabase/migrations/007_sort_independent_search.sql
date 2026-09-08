-- ============================================================
-- 007: Make the search match set independent of the sort order
-- ============================================================
-- Until now `search_notes_ranked()` was the *relevance* path only, and the
-- date-sorted path was a separate, purely lexical query. That made the sort
-- control silently change what a search matched: a note found only by the
-- semantic side would appear under "sort by relevance" and vanish under "sort
-- by date", which reads as search being broken rather than as a re-ordering.
--
-- Sorting is a presentation choice. The set of notes a query matches must not
-- depend on it. So the RPC gains `p_sort_key` and becomes the single definition
-- of "what this search matches" for both Postgres providers; the callers route
-- every search through it and only the ORDER BY changes.
--
-- Extending the existing function rather than adding a parallel one, for the
-- same reasons as 006: it already carries the project filter, the filter-id
-- pre-filter, the date bounds, the tag/person aggregation and the total.

drop function if exists public.search_notes_ranked(
  uuid, text, bigint[], timestamptz, timestamptz, text, int, int, text, text, int, real
);

-- `p_sort_key` is appended last so the existing positional argument order is
-- untouched. Accepted values: 'relevance' (default, fused RRF order),
-- 'created_at', 'updated_at'. Anything else falls back to relevance rather than
-- erroring — an unknown sort key is a bad URL parameter, not a reason to fail
-- the page.
--
-- `p_sort_order` applies to whichever key is chosen: it is the RRF score on the
-- relevance path and the timestamp on a date path.
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
  p_max_distance     real        default 0.65,
  p_sort_key         text        default 'relevance'
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
set search_path = public, pg_temp
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
  -- distance). Both bounds are load-bearing — see the commentary in 006 and
  -- docs/vector-search-and-rag.md §7.1.
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
    -- The score is returned on the date paths too. It is still the honest
    -- relevance of the row against this query — the caller decides whether to
    -- show it — and computing it is free here since the fusion has already run.
    (case when s.max_rrf > 0 then s.rrf / s.max_rrf else 0 end)::real,
    s.total
  from scored s
  join notes n on n.id = s.id
  -- One ORDER BY over three sort keys. Each CASE yields NULL unless its key is
  -- the selected one, so exactly one arm is ever significant; the others
  -- collapse to a constant NULL and cost nothing.
  order by
    case when p_sort_key = 'created_at' and p_sort_order =  'asc' then n.created_at end asc  nulls last,
    case when p_sort_key = 'created_at' and p_sort_order <> 'asc' then n.created_at end desc nulls last,
    case when p_sort_key = 'updated_at' and p_sort_order =  'asc' then n.updated_at end asc  nulls last,
    case when p_sort_key = 'updated_at' and p_sort_order <> 'asc' then n.updated_at end desc nulls last,
    case when p_sort_key not in ('created_at', 'updated_at') and p_sort_order =  'asc' then s.rrf end asc  nulls last,
    case when p_sort_key not in ('created_at', 'updated_at') and p_sort_order <> 'asc' then s.rrf end desc nulls last,
    -- Deterministic tiebreak: ties are common on both keys (equal ts_rank_cd on
    -- short notes, same-day timestamps), and without this LIMIT/OFFSET
    -- pagination can repeat or skip rows.
    n.id desc
  limit  p_limit
  offset p_offset;
$$;

grant execute on function public.search_notes_ranked(
  uuid, text, bigint[], timestamptz, timestamptz, text, int, int, text, text, int, real, text
) to authenticated;
