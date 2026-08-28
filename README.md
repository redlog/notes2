# Localnotes v2

A personal note-taking app with Markdown editing, tag/people organisation, full-text search, and image attachments.

Two deployment modes share the same codebase, switched by a single env var:

| Mode | Auth | Database | Storage | Use case |
|------|------|----------|---------|----------|
| **Cloud** (default) | Google OAuth via Supabase | Supabase Postgres | Supabase Storage | Vercel deployment, multiple users |
| **Local** | None (single user) | SQLite file | Local filesystem | Localhost, air-gapped, OneDrive-syncable |

---

## Cloud mode (Supabase + Vercel)

### Prerequisites

- A [Supabase](https://supabase.com) project with Google OAuth configured
- A Vercel project connected to this repo

### Environment variables

Add these to Vercel (and to `.env.local` for local dev against Supabase):

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

### Running locally against Supabase

```
npm install
npm run dev
```

---

## Local mode (SQLite, no auth)

Local mode stores everything on disk — no Supabase account needed, no internet required.
The database file and image folder are ordinary files you can put inside a OneDrive or any
sync folder.

### Setup

1. Install dependencies (only needed once):

   ```
   npm install
   ```

2. Create `.env.local` in the project root:

   ```env
   PROVIDER=sqlite

   # Optional — defaults shown below
   # SQLITE_DB_PATH=C:/Users/you/OneDrive/Notes/notes.db
   # LOCAL_IMAGES_DIR=C:/Users/you/OneDrive/Notes/images
   ```

   Path rules for Windows:
   - Use **forward slashes** (`C:/Users/...`) — Node accepts them everywhere on Windows.
   - Wrap in **double quotes** if the path contains spaces: `"C:/My OneDrive/Notes/notes.db"`

3. Start the app:

   ```
   npm run dev
   ```

   On first run the database file and a "Default" project are created automatically.

### Default paths

If you leave `SQLITE_DB_PATH` and `LOCAL_IMAGES_DIR` unset the files land next to the
project in a `local-data/` folder:

```
<project-root>/
  local-data/
    notes.db
    images/
      <noteId>/
        1.png
        2.png
```

---

## Migrating from v1

If you have a v1 notes tree (the `yyyy/mm/dd/<timestamp>.md` structure) you can import
it into the SQLite database with the bundled migration script.

### v1 directory structure

```
<root>/
  2024/
    01/
      15/
        1705123456.md          ← note body
        1705123456/
          1.png                ← optional images
          2.png
```

The `.md` files may start with HTML comment headers that v1 used to store metadata:

```markdown
<!-- tags: tag1, tag2 -->
<!-- attendees: person1, person2 -->

# Note title
Body text...
```

The migration script strips those headers, stores tags/people as first-class database
rows, extracts the title from the first `# heading`, and derives `created_at` from
the unix timestamp in the filename.

### Running the migration

Always do a **dry run first** to verify note discovery:

```
node scripts/migrate-sqlite.mjs --dir "C:/path/to/old/notes" --dry-run
```

This prints every note title, tag count, people count, and image count without writing
anything.

When you're happy, run for real:

```
node scripts/migrate-sqlite.mjs --dir "C:/path/to/old/notes"
```

Images are **copied** (not moved) from the v1 directory into `LOCAL_IMAGES_DIR`.

### Migration flags

| Flag | Description |
|------|-------------|
| `--dir <path>` | **(Required)** Root of the v1 notes tree |
| `--project <name>` | Target project name (default: `Default`). Created if it doesn't exist. |
| `--dry-run` | Print what would be imported; write nothing |
| `--verbose` | Show each image file as it is copied |

### Migrating into multiple projects

Run the script once per source directory, targeting different project names:

```
node scripts/migrate-sqlite.mjs --dir "C:/notes/work"     --project "Work"
node scripts/migrate-sqlite.mjs --dir "C:/notes/personal" --project "Personal"
```

> **Note:** Running the script twice against the same directory will create duplicate
> notes. Use `--dry-run` to confirm before running for real, and only run once per source.

---

## Projects

### How the active project is resolved

1. `?project=<id>` query parameter in the URL — also writes a cookie for next time
2. `active_project` cookie set on the last switch
3. Oldest project by creation date (the automatic fallback)

### Managing projects

Go to **Settings** (`/config`) to:
- Rename the current project
- Create new projects
- Delete projects

### Switching projects

Use the project picker in the app header. Selecting a project navigates to
`/?project=<id>`, which the middleware intercepts to set the `active_project` cookie.
All subsequent requests use that project until you switch again.

### Default project

The first time the app runs in local mode it creates a project called **Default**.
This is always the fallback if no cookie is set. You can rename it in Settings.

---

## Environment variable reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PROVIDER` | No | *(Supabase mode)* | Set to `sqlite` to enable local mode |
| `SQLITE_DB_PATH` | No | `<cwd>/local-data/notes.db` | Path to the SQLite database file |
| `LOCAL_IMAGES_DIR` | No | Next to DB file in `images/` | Directory for image attachments |
| `SQLITE_BACKUP_PATH` | No | — | Write a consistent snapshot of the database here. Safe to point at a synced folder |
| `SQLITE_BACKUP_INTERVAL_SECONDS` | No | `3600` | How often to snapshot while running. `0` for on-exit only |
| `NEXT_PUBLIC_SUPABASE_URL` | Cloud only | — | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Cloud only | — | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Migration only | — | Used by `scripts/migrate.mjs` (Supabase migration) |
| `VOYAGE_API_KEY` | No | — | Enables semantic search. Without it the app runs keyword-only |
| `VOYAGE_MODEL` | No | `voyage-3.5-lite` | Embedding model. Changing it requires a full rebuild |
| `VOYAGE_DIM` | No | `1024` | Embedding dimensions. Changing it also requires a migration |
| `CRON_SECRET` | No | — | Authenticates the scheduled embedding drain (`vercel.json`) |

---

## Semantic search (optional)

Off by default. With it on, search matches on meaning as well as words, and the
note view gains a "Related notes" panel. Keyword search remains the baseline and
is unaffected — the two rankings are fused, so a note matching both ranks above
one matching either.

**Setup:**

1. Get an API key from [voyageai.com](https://voyageai.com) and set
   `VOYAGE_API_KEY`. The free tier is 200M tokens; a full index of ~5,000 notes
   is around 2M, so cost is not a practical concern at personal scale.
2. **Cloud mode:** apply `supabase/migrations/006_note_chunks.sql`. It needs the
   `vector` extension, which Supabase provides. On GCP/Cloud SQL, enable
   pgvector and apply migrations `005` and `006` by hand.
   **Local SQLite mode:** nothing to do — the tables are created on startup.
3. In **Settings → your project**, switch on *Semantic search* and press
   **Build index**. Progress is shown as it runs; it is resumable, so closing
   the page mid-run loses no work.

Notes saved after that are indexed automatically.

**What leaves your machine:** note text is sent to Voyage AI to be embedded.
That is why the setting is per project and off by default — in local SQLite
mode especially, it is a real change from the app being entirely offline.

**Keeping it current** — three mechanisms, because no single one covers every
deployment:

| Where | What runs the drain |
|---|---|
| Any deployment | Saving a note embeds what that save queued, just after the response is sent |
| Vercel | The cron in `vercel.json`, **once a day** — Hobby plan allows no more (set `CRON_SECRET` so it can authenticate) |
| Local / self-hosted | A timer in the server process, every 180s by default (`EMBED_DRAIN_INTERVAL_SECONDS`) |

The per-save drain is what makes a daily cron acceptable: a note you edit is
searchable by meaning within seconds, not at the next nightly tick. The cron and
the local timer are the safety net that catches whatever a save missed — a
Voyage blip, a bulk import, a project switched on with a back catalogue.

The config page shows how many chunks are still waiting. If that number never
reaches zero, the drain is failing; check the server log for `[drain]`.

**Changing the embedding model:** set `VOYAGE_MODEL`, then use *Rebuild from
scratch*. Chunks embedded by a previous model are ignored at query time rather
than compared against incompatible vectors, so search degrades to keyword-only
during the rebuild instead of returning nonsense.

Design notes and rationale: [`docs/vector-search-and-rag.md`](docs/vector-search-and-rag.md).

---

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `node scripts/migrate-sqlite.mjs` | Migrate v1 notes → local SQLite |
| `node scripts/migrate.mjs` | Migrate v1 notes → Supabase (cloud mode) |
| `node scripts/check-sqlite.mjs` | Check the local database for corruption (`--repair` to fix) |

### Backups, and never putting the database in a synced folder

**Do not keep the live database in OneDrive, Dropbox, iCloud Drive or Google
Drive.** The sync client reads the file while the app is writing to it and
stores a mix of old and new pages — a file that still opens, but whose indexes
quietly disagree with its tables. That is the single most likely way to corrupt
it.

Keep the database on local disk and let the app write the snapshot instead:

```bash
SQLITE_DB_PATH=C:\Users\you\notes2-data\notes.db
SQLITE_BACKUP_PATH=C:\Users\you\OneDrive\notes2\notes-backup.db
```

The snapshot is taken with `VACUUM INTO`, which runs inside a read transaction,
so it is transactionally consistent even while the app is serving writes — no
pausing, no stopping the app, no risk of a torn copy. It is written under a
temporary name and renamed into place, so an interrupted backup cannot replace
a good one with a truncated file. The sync client only ever sees a finished,
closed file, which is what sync clients handle safely.

It runs hourly by default *and* on clean exit. Both, deliberately: exit is the
one moment that cannot be relied on, since a crash, a kill, a closed console
window or a lost power cable skips it — and those are exactly the cases a
backup exists for. A 100 MB database snapshots in about 250 ms.

To restore, stop the app and copy the snapshot over `SQLITE_DB_PATH`. Image
attachments live outside the database (`LOCAL_IMAGES_DIR`), so back that
directory up too — it is ordinary files and safe to sync directly.

### `database disk image is malformed`

If a query fails with `SqliteError: database disk image is malformed`
(`SQLITE_CORRUPT`), a page of the local database file is damaged. The symptom is
often oddly narrow — filtering by *one* `@person` or `#tag` fails while
everything else works — because damage confined to a single index only breaks
the queries whose plan walks that index.

```bash
node scripts/check-sqlite.mjs            # diagnose; never writes
node scripts/check-sqlite.mjs --repair   # rebuild the file (stop the app first)
```

The checker names the damaged object, proves whether the row data survived, and
lists exactly which filters are affected — including ones that silently return
*too few* results rather than raising. When the damage is limited to indexes,
`--repair` rebuilds the database into a new file with the indexes built from
scratch, keeping the damaged original as a `.bak` alongside it.

See [`docs/sqlite-corruption.md`](docs/sqlite-corruption.md) for the full
diagnosis and how the file gets damaged in the first place.
