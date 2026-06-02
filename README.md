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
| `NEXT_PUBLIC_SUPABASE_URL` | Cloud only | — | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Cloud only | — | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Migration only | — | Used by `scripts/migrate.mjs` (Supabase migration) |

---

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `node scripts/migrate-sqlite.mjs` | Migrate v1 notes → local SQLite |
| `node scripts/migrate.mjs` | Migrate v1 notes → Supabase (cloud mode) |
