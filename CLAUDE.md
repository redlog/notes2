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

---

## Repository Layout

_To be populated as the project is built._

---

## Key Decisions

- **No custom backend server.** All server logic lives in Next.js API routes (or Server Actions).
- **Postgres full-text search.** No third-party search service — search is handled natively via `tsvector` columns and `tsquery`.
- **Supabase Auth.** Google OAuth is the sole sign-in method. No username/password.
- **Markdown storage.** Note bodies are stored as raw Markdown. Tag and people metadata are stored in dedicated DB columns/tables, not embedded in the note body as HTML comments (unlike v1).
- **Single-page feel.** Fast navigation without full page reloads, consistent with v1 UX.
