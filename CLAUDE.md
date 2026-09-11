# CLAUDE.md — Localnotes v2

This file provides guidance for AI assistants working on the Localnotes v2 codebase.

## Project Overview

Localnotes v2 is a cloud-hosted personal note-taking app. Notes are stored in Markdown format in a Postgres database (Supabase). Users authenticate via Google OAuth. The app is a Next.js frontend hosted on Vercel, backed by Supabase for database, auth, and file storage.

See `PRD.md` for full product requirements.

---

## Stack

| Layer | Technology |
|---|---|
| Frontend + API routes | Next.js (App Router) on Vercel |
| Database | Supabase (Postgres) |
| Auth | Supabase Auth (Google OAuth) |
| File storage | Supabase Storage (image attachments) |
| Full-text search | Postgres `tsvector` / `tsquery` (built into Supabase) |
| Semantic search | Voyage AI embeddings + pgvector (brute-force cosine in JS on SQLite) |

---

## Repository Layout

_To be populated as the project is built._

---

## Key Decisions

- **No custom backend server.** All server logic lives in Next.js API routes (or Server Actions).
- **Postgres full-text search.** No third-party search service — search is handled natively via `tsvector` columns and `tsquery`.
- **Relevance ranking lives in the database, not the app.** PostgREST cannot express `ORDER BY ts_rank(...)`, so the Supabase provider ranks through the `search_notes_ranked()` RPC (`supabase/migrations/005_search_ranking.sql`); GCP uses `ts_rank_cd` in raw SQL and SQLite uses `bm25()`. When adding a ranked query (vector similarity, hybrid fusion), **extend that RPC rather than adding a parallel one** — it already carries the project filter, filter-id pre-filter, date bounds, tag/person aggregation and total count.
- **The sort order never changes the match set.** Sorting is presentation. A search returns the same notes whether it is ordered by relevance or by date — only the `ORDER BY` differs, which is why `search_notes_ranked()` takes `p_sort_key` and every search (date sorts included) goes through it. Do not re-introduce a sort-specific query path, and do not gate the query embedding on `sortKey`: the embedding decides which notes match, not just their order. See `docs/vector-search-and-rag.md` §7.5.
- **Search scores are normalised, never raw.** `ts_rank_cd` and `bm25()` are not comparable (bm25 is negative and inverted), so every provider returns `score` as 0..1 against the best match in the whole result set. Do not surface a backend's raw ranking value.
- **Whole-word matching only.** There is no substring/trigram search; the `trigram_search` flag that once implied otherwise was removed as never-implemented. See `docs/vector-search-and-rag.md` §2.1.
- **Semantic search is additive and opt-in.** Keyword search is the baseline and always works; embeddings are gated on `projects.vector_search` (default off) *and* a `VOYAGE_API_KEY`. Never make a code path assume embeddings exist — notes may be unembedded, embedded by a different model, or queued.
- **Embedding never happens on the save path.** Saving re-chunks and diffs content hashes (pure DB work); chunks land with `embedding = NULL`, which *is* the drain queue, and `/api/embed-drain` fills them in. Do not "simplify" this by calling Voyage during a save — autosave fires every 30s, and a Voyage outage would start failing note saves.
- **Hybrid ranking fuses ranks, never scores.** `ts_rank_cd`/`bm25` and cosine distance are not comparable quantities; RRF combines their ordinal positions. Never add or weight the raw values together.
- **The vector side needs a distance threshold, not just a top-N cap.** Cosine distance is defined for every chunk, so a cap alone makes every note in a small project a candidate and search returns the whole corpus. See `docs/vector-search-and-rag.md` §7.1.
- **Filter ids pre-filter both sides of the fusion.** When resolving `#tag`/`@person` tokens to note ids, never narrow that query by the search term — doing so silently removes semantic-only results. See §7.2.
- **Tags and people are filters, not query terms.** They are deliberately absent from `search_vec` / the FTS5 table: the `#tag` and `@person` filter tokens match them exactly, which beats stemmed free-text matching, and they are poor embedding material. Do not "fix" this by adding them to the search index — see `docs/vector-search-and-rag.md` §2.1.
- **Supabase Auth.** Google OAuth is the sole sign-in method. No username/password.
- **Markdown storage.** Note bodies are stored as raw Markdown. Tag and people metadata are stored in dedicated DB columns/tables, not embedded in the note body as HTML comments (unlike v1).
- **Single-page feel.** Fast navigation without full page reloads, consistent with v1 UX.
