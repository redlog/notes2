-- ============================================================
-- 005: Lexical search ranking
-- ============================================================
-- Until now the `relevance` sort key was accepted by the UI and silently
-- coerced to `created_at` in every provider: `@@` returns a boolean, and
-- ORDER BY ts_rank(...) is not expressible through PostgREST. This migration
-- adds the RPC that makes ranking reachable from the Supabase client.
--
-- Also retires `projects.trigram_search`, which was never read by any query,
-- and moves the trigram index onto the column that is actually matched with
-- LIKE (`title`, by searchTitles / the note-ref autocomplete) rather than
-- `body`, which nothing ever matched with LIKE.

-- ── Ranked search RPC ────────────────────────────────────────────────────────
-- SECURITY INVOKER (the default, stated explicitly): the caller's RLS policies
-- apply, so this cannot widen access to other users' notes. `p_project_id` is
-- passed and filtered on explicitly rather than inferred.
--
-- `score` is normalised to 0..1 against the top-ranked row of the *whole*
-- match set, not the current page, so it stays stable across pagination and
-- means the same thing here as the SQLite provider's normalised bm25.
-- Raw ts_rank_cd values are not returned: they are not comparable across
-- providers and are not meaningful to show a user.
create or replace function public.search_notes_ranked(
  p_project_id uuid,
  p_search     text,
  p_filter_ids bigint[]   default null,
  p_time_min   timestamptz default null,
  p_time_max   timestamptz default null,
  p_sort_order text        default 'desc',
  p_limit      int         default 25,
  p_offset     int         default 0
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
    select websearch_to_tsquery('english', p_search) as tsq
  ),
  matched as (
    select
      n.id, n.title, n.body, n.created_at, n.updated_at,
      ts_rank_cd(n.search_vec, q.tsq) as raw_score
    from notes n
    cross join q
    where n.project_id = p_project_id
      and n.search_vec @@ q.tsq
      and (p_filter_ids is null or n.id = any (p_filter_ids))
      and (p_time_min is null or n.created_at >= p_time_min)
      and (p_time_max is null or n.created_at <  p_time_max)
  ),
  scored as (
    select
      m.*,
      count(*)         over () as total,
      max(m.raw_score) over () as max_score
    from matched m
  )
  select
    s.id,
    s.title,
    s.body,
    s.created_at,
    s.updated_at,
    coalesce(
      (select jsonb_agg(jsonb_build_object('tag', t.tag, 'is_header', t.is_header))
         from note_tags t where t.note_id = s.id),
      '[]'::jsonb
    ),
    coalesce(
      (select jsonb_agg(jsonb_build_object('person', p.person, 'is_header', p.is_header))
         from note_people p where p.note_id = s.id),
      '[]'::jsonb
    ),
    (case when s.max_score > 0 then s.raw_score / s.max_score else 0 end)::real,
    s.total
  from scored s
  order by
    case when p_sort_order = 'asc'  then s.raw_score end asc  nulls last,
    case when p_sort_order <> 'asc' then s.raw_score end desc nulls last,
    -- Deterministic tiebreak: equal ts_rank_cd is common on short notes, and
    -- without this, LIMIT/OFFSET pagination can repeat or skip rows.
    s.id desc
  limit  p_limit
  offset p_offset;
$$;

grant execute on function public.search_notes_ranked(
  uuid, text, bigint[], timestamptz, timestamptz, text, int, int
) to authenticated;

-- ── Trigram index: move from body to title ───────────────────────────────────
-- `notes_body_trgm_idx` was created for a partial-word search feature that was
-- never implemented; no query has ever referenced it. Meanwhile searchTitles()
-- runs `title ILIKE '%q%'` on every keystroke of the note-ref autocomplete and
-- had no index to use, so it sequential-scanned the table.
drop index if exists notes_body_trgm_idx;
create index if not exists notes_title_trgm_idx on notes using gin (title gin_trgm_ops);

-- ── Retire the dead trigram_search flag ──────────────────────────────────────
-- Column, API field, provider CRUD and a settings toggle all existed; nothing
-- ever read the value. Removing it rather than leaving a control that claims
-- to do something it does not.
alter table projects drop column if exists trigram_search;
