/**
 * SQLite implementation of DataProvider.
 *
 * Database: SQLite file, path from SQLITE_DB_PATH env var
 *           (defaults to <cwd>/local-data/notes.db).
 *
 * Images:   Local filesystem, directory from LOCAL_IMAGES_DIR env var
 *           (defaults to the same directory as the DB file, under "images/").
 *           Served at /api/local-image/[noteId]/[imgNum].
 *
 * Auth:     None — single local user (see lib/auth.ts LOCAL_USER_ID).
 */

import Database from "better-sqlite3";
import { cookies } from "next/headers";
import { mkdirSync } from "fs";
import { unlink } from "fs/promises";
import { join, dirname } from "path";
import { extractMentions, extractNoteRefs, buildPreview, exclusiveEnd } from "@/lib/notes";
import { getLocalDbPath, getLocalImagesDir } from "@/lib/local-storage";
import { cosineSimilarity, embeddingModel } from "@/lib/embeddings";
import type {
  ChunksDataProvider,
  DataProvider,
  NotesDataProvider,
  ProjectsDataProvider,
  BiosDataProvider,
} from "../types";
import type {
  ChunkSyncResult,
  PendingChunk,
  RelatedNote,
  ListParams,
  ListResult,
  Note,
  NoteImage,
  NoteListItem,
  SortKey,
  GalleryImage,
  TagCount,
  PersonCount,
  Project,
  UserSettings,
  SaveNoteResponse,
} from "@/lib/types";

// ── Singleton DB ──────────────────────────────────────────────────────────────

const globalForDb = global as unknown as { sqliteDb?: Database.Database };

function getDb(): Database.Database {
  if (globalForDb.sqliteDb) return globalForDb.sqliteDb;

  const dbPath = getLocalDbPath();
  mkdirSync(dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  initSchema(db);
  migrateSchema(db);
  ensureLocalUser(db);

  globalForDb.sqliteDb = db;
  return db;
}

/**
 * Checkpoints the WAL into the main database file and closes the
 * connection. Called on process shutdown (SIGINT/SIGTERM/exit) so the
 * -wal and -shm files don't linger after the app stops.
 */
export function shutdownDb(): void {
  const db = globalForDb.sqliteDb;
  if (!db) return;

  db.pragma("wal_checkpoint(TRUNCATE)");
  db.close();
  globalForDb.sqliteDb = undefined;
}

// ── Schema ────────────────────────────────────────────────────────────────────

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id           TEXT PRIMARY KEY,
      notes_per_page    INTEGER NOT NULL DEFAULT 25,
      autosave_enabled  INTEGER NOT NULL DEFAULT 1,
      autosave_interval INTEGER NOT NULL DEFAULT 30
    );

    CREATE TABLE IF NOT EXISTS projects (
      id             TEXT PRIMARY KEY,
      user_id        TEXT NOT NULL,
      name           TEXT NOT NULL,
      created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      UNIQUE(user_id, name)
    );

    CREATE TABLE IF NOT EXISTS notes (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT    NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id    TEXT    NOT NULL,
      title      TEXT    NOT NULL DEFAULT '',
      body       TEXT    NOT NULL DEFAULT '',
      version    INTEGER NOT NULL DEFAULT 1,
      created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS note_tags (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      note_id   INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      tag       TEXT    NOT NULL,
      is_header INTEGER NOT NULL DEFAULT 1,
      UNIQUE(note_id, tag, is_header)
    );

    CREATE TABLE IF NOT EXISTS note_people (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      note_id   INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      person    TEXT    NOT NULL,
      is_header INTEGER NOT NULL DEFAULT 1,
      UNIQUE(note_id, person, is_header)
    );

    CREATE TABLE IF NOT EXISTS note_inlinks (
      source_note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      target_note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      PRIMARY KEY (source_note_id, target_note_id)
    );

    CREATE TABLE IF NOT EXISTS note_images (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      note_id      INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      img_num      INTEGER NOT NULL,
      storage_path TEXT    NOT NULL,
      UNIQUE(note_id, img_num)
    );

    CREATE TABLE IF NOT EXISTS note_versions (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      title   TEXT    NOT NULL DEFAULT '',
      body    TEXT    NOT NULL DEFAULT '',
      saved_at TEXT   NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS person_bios (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT    NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id    TEXT    NOT NULL,
      person     TEXT    NOT NULL,
      content    TEXT    NOT NULL DEFAULT '',
      updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      UNIQUE(project_id, person)
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(title, body);

    CREATE TABLE IF NOT EXISTS note_chunks (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      note_id      INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      project_id   TEXT    NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      chunk_index  INTEGER NOT NULL,
      content      TEXT    NOT NULL,
      embed_text   TEXT    NOT NULL,
      content_hash TEXT    NOT NULL,
      token_count  INTEGER,
      -- Float32Array buffer, not JSON: 1024 dims is 4KB packed against ~15KB
      -- as text, and this table is the largest thing in a local database.
      embedding    BLOB,
      model        TEXT,
      dim          INTEGER,
      embedded_at  TEXT,
      UNIQUE(note_id, chunk_index)
    );

    CREATE INDEX IF NOT EXISTS note_chunks_note_idx    ON note_chunks(note_id);
    CREATE INDEX IF NOT EXISTS note_chunks_project_idx ON note_chunks(project_id);

    CREATE INDEX IF NOT EXISTS notes_project_idx  ON notes(project_id);
    CREATE INDEX IF NOT EXISTS notes_created_idx  ON notes(created_at DESC);
    CREATE INDEX IF NOT EXISTS notes_updated_idx  ON notes(updated_at DESC);
    CREATE INDEX IF NOT EXISTS note_tags_note_idx ON note_tags(note_id);
    CREATE INDEX IF NOT EXISTS note_tags_tag_idx  ON note_tags(tag);
    CREATE INDEX IF NOT EXISTS note_ppl_note_idx  ON note_people(note_id);
    CREATE INDEX IF NOT EXISTS note_ppl_prsn_idx  ON note_people(person);
    CREATE INDEX IF NOT EXISTS note_img_note_idx  ON note_images(note_id);
  `);
}

/**
 * SQLite has no "ADD COLUMN IF NOT EXISTS", and CREATE TABLE IF NOT EXISTS is a
 * no-op on a database that already has the table — so a column added after a
 * local database was first created has to be applied explicitly. Without this,
 * an existing local notes.db keeps working but silently lacks the new column.
 */
function migrateSchema(db: Database.Database) {
  const columns = new Set(
    (db.prepare("SELECT name FROM pragma_table_info('projects')").all() as { name: string }[])
      .map((r) => r.name)
  );
  if (!columns.has("vector_search")) {
    db.exec("ALTER TABLE projects ADD COLUMN vector_search INTEGER NOT NULL DEFAULT 0");
  }
}

function ensureLocalUser(db: Database.Database) {
  const hasSettings = db
    .prepare("SELECT 1 FROM user_settings WHERE user_id = ?")
    .get("local");
  if (!hasSettings) {
    db.prepare("INSERT INTO user_settings (user_id) VALUES (?)").run("local");
  }

  const hasProject = db
    .prepare("SELECT 1 FROM projects WHERE user_id = ?")
    .get("local");
  if (!hasProject) {
    db.prepare(
      "INSERT INTO projects (id, user_id, name) VALUES (?, ?, ?)"
    ).run(crypto.randomUUID(), "local", "Default");
  }
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function setIntersect(a: Set<number>, b: Set<number>): Set<number> {
  const result = new Set<number>();
  for (const v of a) if (b.has(v)) result.add(v);
  return result;
}

/**
 * Annotates SQLITE_CORRUPT with what to do about it.
 *
 * On its own, "database disk image is malformed" reads like an application
 * bug rather than a damaged file, because damage confined to a single index
 * only breaks the queries whose plan walks that index. A damaged
 * `note_ppl_prsn_idx`, for instance, breaks filtering by the few people whose
 * keys sit on the bad page and nothing else: the note list renders, the
 * sidebar counts are right, and every other person filters fine. Naming the
 * checker in the message saves that whole investigation next time.
 */
function withCorruptionHint<T extends object>(provider: T): T {
  const hint =
    " — the local SQLite database has a damaged page. Run " +
    "`node scripts/check-sqlite.mjs` to see what is damaged, then " +
    "`node scripts/check-sqlite.mjs --repair` to rebuild it.";

  return new Proxy(provider, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      return async (...args: unknown[]) => {
        try {
          return await (value as (...a: unknown[]) => unknown).apply(target, args);
        } catch (err) {
          const e = err as Error & { code?: string };
          if (e?.code === "SQLITE_CORRUPT" && !e.message.includes("check-sqlite")) {
            e.message += hint;
          }
          throw err;
        }
      };
    },
  });
}

function buildFtsQuery(search: string): string {
  return search
    .trim()
    .replace(/[^\w\s\-']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Vector helpers (no pgvector here) ─────────────────────────────────────────

/**
 * SQLite mode has no pgvector, so similarity is brute-forced in JS. That is
 * genuinely fine at personal-notes scale — a few thousand chunks is a few
 * milliseconds of dot products — and it avoids a native extension dependency
 * (sqlite-vec) in the one mode whose whole appeal is that it just runs.
 * See docs/vector-search-and-rag.md §9.
 */
function vecToBlob(v: number[]): Buffer {
  return Buffer.from(new Float32Array(v).buffer);
}

function blobToVec(b: Buffer): Float32Array {
  // Copy rather than view: better-sqlite3 may hand back a Buffer that is a
  // slice of a larger pooled ArrayBuffer, and a bare view over it would read
  // neighbouring rows' bytes.
  const copy = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  return new Float32Array(copy);
}

/** Cosine *distance*, to match pgvector's `<=>` so thresholds mean the same. */
function cosineDistance(a: ArrayLike<number>, b: ArrayLike<number>): number {
  return 1 - cosineSimilarity(a, b);
}

/** Matches the p_max_distance / p_vector_limit defaults in migration 006. */
const MAX_VECTOR_DISTANCE = 0.65;
const VECTOR_CANDIDATES = 50;
const RRF_K = 60;

interface ChunkVecRow {
  note_id: number;
  embedding: Buffer;
}

/**
 * Notes ranked by their best-matching chunk, thresholded and capped.
 *
 * Both bounds matter. Cosine distance is defined for every stored chunk, so
 * without the threshold every note holding an embedding becomes a candidate and
 * a search returns the whole project ranked.
 */
function vectorRanking(
  db: Database.Database,
  projectId: string,
  queryEmbedding: number[],
  model: string,
  allowedIds: number[] | null
): number[] {
  const rows = db
    .prepare(
      `SELECT note_id, embedding FROM note_chunks
        WHERE project_id = ? AND embedding IS NOT NULL AND model = ?`
    )
    .all(projectId, model) as ChunkVecRow[];

  const best = new Map<number, number>();
  const allowed = allowedIds === null ? null : new Set(allowedIds);

  for (const r of rows) {
    if (allowed && !allowed.has(r.note_id)) continue;
    const d = cosineDistance(queryEmbedding, blobToVec(r.embedding));
    const prior = best.get(r.note_id);
    if (prior === undefined || d < prior) best.set(r.note_id, d);
  }

  return [...best.entries()]
    .filter(([, d]) => d <= MAX_VECTOR_DISTANCE)
    .sort((a, b) => a[1] - b[1] || b[0] - a[0])
    .slice(0, VECTOR_CANDIDATES)
    .map(([id]) => id);
}

/**
 * Reciprocal Rank Fusion over two ranked id lists.
 *
 * RRF consumes ranks rather than scores, which is what makes it valid to
 * combine bm25 with cosine distance — quantities that are not comparable and
 * whose raw values must never be added together.
 */
function fuseRRF(lexical: number[], semantic: number[]): { id: number; rrf: number }[] {
  const scores = new Map<number, number>();
  const add = (ids: number[]) =>
    ids.forEach((id, i) => scores.set(id, (scores.get(id) ?? 0) + 1 / (RRF_K + i + 1)));
  add(lexical);
  add(semantic);
  return [...scores.entries()]
    .map(([id, rrf]) => ({ id, rrf }))
    .sort((a, b) => b.rrf - a.rrf || b.id - a.id);
}

function upsertTagsAndPeople(
  db: Database.Database,
  noteId: number,
  headerTags: string[],
  headerPeople: string[],
  body: string
) {
  const { tags: mentionTags, people: mentionPeople } = extractMentions(body);

  db.prepare("DELETE FROM note_tags WHERE note_id = ?").run(noteId);
  db.prepare("DELETE FROM note_people WHERE note_id = ?").run(noteId);

  const tagRows = [
    ...headerTags.map((tag) => ({ note_id: noteId, tag, is_header: 1 })),
    ...mentionTags
      .filter((t) => !headerTags.includes(t))
      .map((tag) => ({ note_id: noteId, tag, is_header: 0 })),
  ];
  const personRows = [
    ...headerPeople.map((person) => ({ note_id: noteId, person, is_header: 1 })),
    ...mentionPeople
      .filter((p) => !headerPeople.includes(p))
      .map((person) => ({ note_id: noteId, person, is_header: 0 })),
  ];

  const insertTag = db.prepare(
    "INSERT OR IGNORE INTO note_tags (note_id, tag, is_header) VALUES (?, ?, ?)"
  );
  for (const r of tagRows) insertTag.run(r.note_id, r.tag, r.is_header);

  const insertPerson = db.prepare(
    "INSERT OR IGNORE INTO note_people (note_id, person, is_header) VALUES (?, ?, ?)"
  );
  for (const r of personRows) insertPerson.run(r.note_id, r.person, r.is_header);
}

function updateInlinks(db: Database.Database, sourceNoteId: number, body: string) {
  const refs = extractNoteRefs(body);
  db.prepare("DELETE FROM note_inlinks WHERE source_note_id = ?").run(sourceNoteId);
  if (refs.length) {
    const ins = db.prepare(
      "INSERT OR IGNORE INTO note_inlinks (source_note_id, target_note_id) VALUES (?, ?)"
    );
    for (const target of refs) ins.run(sourceNoteId, target);
  }
}

const MAX_VERSIONS = 50;

function recordNoteVersion(
  db: Database.Database,
  noteId: number,
  version: number,
  title: string,
  body: string
) {
  db.prepare(
    "INSERT INTO note_versions (note_id, version, title, body, saved_at) VALUES (?, ?, ?, ?, ?)"
  ).run(noteId, version, title, body, new Date().toISOString());

  const cutoff = db
    .prepare(
      "SELECT version FROM note_versions WHERE note_id = ? ORDER BY version DESC LIMIT 1 OFFSET ?"
    )
    .get(noteId, MAX_VERSIONS) as { version: number } | undefined;

  if (cutoff) {
    db.prepare(
      "DELETE FROM note_versions WHERE note_id = ? AND version <= ?"
    ).run(noteId, cutoff.version);
  }
}

type NoteRow = {
  id: number;
  project_id: string;
  user_id: string;
  title: string;
  body: string;
  version: number;
  created_at: string;
  updated_at: string;
  /** Only present on the relevance path — raw bm25(), negative, lower is better. */
  raw_score?: number;
};

type ProjectRow = {
  id: string;
  user_id: string;
  name: string;
  vector_search: number;
  created_at: string;
};

function projectRowToProject(row: ProjectRow): Project {
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    vector_search: !!row.vector_search,
    created_at: row.created_at,
  };
}

// ── Notes provider ────────────────────────────────────────────────────────────

function buildNotesProvider(db: Database.Database): NotesDataProvider {
  return {
    async list(params: ListParams): Promise<ListResult> {
      const {
        projectId,
        search = "",
        filter = "",
        page = 1,
        perPage = 25,
        sortKey = "created_at",
        sortOrder = "desc",
        timeMin,
        timeMax,
        queryEmbedding,
      } = params;
      const offset = (page - 1) * perPage;

      // ── Resolve the sort actually applied ───────────────────────────────
      // `relevance` is bm25() over the FTS match, not a column, so it only
      // means something when there is a search term to rank against. Guard it
      // unconditionally: with `sk=relevance` and no search (a bookmarked URL,
      // back-navigation, or /api/export?sk=relevance) the fallback is what
      // keeps `ORDER BY relevance` from reaching SQLite as a bare column.
      const ftsQuery = search ? buildFtsQuery(search) : "";
      const useRelevance = sortKey === "relevance" && ftsQuery !== "";
      const dateSortKey = sortKey === "relevance" ? "created_at" : sortKey;
      const appliedSortKey: SortKey = useRelevance ? "relevance" : dateSortKey;

      // Parse filter tokens
      const filterTokens = filter.split(/[\s,]+/).map((t) => t.trim()).filter(Boolean);
      const requiredTags    = filterTokens.filter((t) => t.startsWith("#")).map((t) => t.slice(1));
      const requiredPeople  = filterTokens.filter((t) => t.startsWith("@")).map((t) => t.slice(1));
      const exclusiveTags   = filterTokens.filter((t) => t.startsWith("+#")).map((t) => t.slice(2));
      const exclusivePeople = filterTokens.filter((t) => t.startsWith("+@")).map((t) => t.slice(2));
      const excludedTags    = filterTokens.filter((t) => t.startsWith("~#")).map((t) => t.slice(2));

      // Pre-filter by required / exclusive tags & people
      let filterIds: number[] | null = null;
      if (
        requiredTags.length > 0 ||
        requiredPeople.length > 0 ||
        exclusiveTags.length > 0 ||
        exclusivePeople.length > 0
      ) {
        let ids: Set<number> | null = null;

        for (const tag of [...requiredTags, ...exclusiveTags]) {
          const rows = db
            .prepare("SELECT note_id FROM note_tags WHERE tag = ?")
            .all(tag) as { note_id: number }[];
          const s = new Set(rows.map((r) => r.note_id));
          ids = ids === null ? s : setIntersect(ids, s);
        }
        for (const person of [...requiredPeople, ...exclusivePeople]) {
          const rows = db
            .prepare("SELECT note_id FROM note_people WHERE person = ?")
            .all(person) as { note_id: number }[];
          const s = new Set(rows.map((r) => r.note_id));
          ids = ids === null ? s : setIntersect(ids, s);
        }

        filterIds = [...(ids ?? new Set<number>())];
        if (filterIds.length === 0) {
          return { notes: [], total: 0, page, perPage, sortKey: appliedSortKey, sortOrder };
        }
      }

      // ── Narrow to exact matches for exclusive/excluded filters ────────────
      // "+@person"/"+#tag" require the note's header people/tags to be
      // *exactly* that set, and "~#tag" excludes notes mentioning a tag at
      // all. Both need each candidate's full tag/person list, so resolve the
      // exact matching note ids *before* counting/paginating — otherwise the
      // reported total (and page contents) reflect the looser "contains"
      // match instead of the filter actually applied to the results.
      if (exclusiveTags.length > 0 || exclusivePeople.length > 0 || excludedTags.length > 0) {
        const baseConditions: string[] = ["n.project_id = ?"];
        const baseValues: unknown[] = [projectId];

        // The search term is deliberately NOT applied here. These ids pre-filter
        // the semantic side as well as the lexical one, so narrowing them by the
        // lexical match would confine vector search to notes that already
        // matched the words — removing exactly the semantic-only results hybrid
        // search exists to find. Both paths below apply the search themselves.
        if (filterIds !== null) {
          baseConditions.push(`n.id IN (${filterIds.map(() => "?").join(",")})`);
          baseValues.push(...filterIds);
        }
        if (timeMin) { baseConditions.push("n.created_at >= ?"); baseValues.push(timeMin); }
        if (timeMax) {
          const end = new Date(timeMax);
          end.setDate(end.getDate() + 1);
          baseConditions.push("n.created_at < ?");
          baseValues.push(end.toISOString());
        }

        const candidateIds = (
          db.prepare(`SELECT id FROM notes n WHERE ${baseConditions.join(" AND ")}`).all(...baseValues) as { id: number }[]
        ).map((r) => r.id);

        if (candidateIds.length === 0) {
          return { notes: [], total: 0, page, perPage, sortKey: appliedSortKey, sortOrder };
        }

        const cph = candidateIds.map(() => "?").join(",");
        const candTagRows = db
          .prepare(`SELECT note_id, tag, is_header FROM note_tags WHERE note_id IN (${cph})`)
          .all(...candidateIds) as { note_id: number; tag: string; is_header: number }[];
        const candPersonRows = db
          .prepare(`SELECT note_id, person, is_header FROM note_people WHERE note_id IN (${cph})`)
          .all(...candidateIds) as { note_id: number; person: string; is_header: number }[];

        const candTagMap = new Map<number, { tag: string; is_header: boolean }[]>();
        const candPersonMap = new Map<number, { person: string; is_header: boolean }[]>();
        for (const r of candTagRows) {
          if (!candTagMap.has(r.note_id)) candTagMap.set(r.note_id, []);
          candTagMap.get(r.note_id)!.push({ tag: r.tag, is_header: !!r.is_header });
        }
        for (const r of candPersonRows) {
          if (!candPersonMap.has(r.note_id)) candPersonMap.set(r.note_id, []);
          candPersonMap.get(r.note_id)!.push({ person: r.person, is_header: !!r.is_header });
        }

        filterIds = candidateIds.filter((id) => {
          const tags = candTagMap.get(id) ?? [];
          const people = candPersonMap.get(id) ?? [];
          if (
            exclusiveTags.length &&
            !(
              tags.filter((t) => t.is_header).length === exclusiveTags.length &&
              exclusiveTags.every((t) => tags.some((nt) => nt.tag === t && nt.is_header))
            )
          )
            return false;
          if (
            exclusivePeople.length &&
            !(
              people.filter((p) => p.is_header).length === exclusivePeople.length &&
              exclusivePeople.every((p) => people.some((np) => np.person === p && np.is_header))
            )
          )
            return false;
          if (excludedTags.length && excludedTags.some((t) => tags.some((nt) => nt.tag === t)))
            return false;
          return true;
        });

        if (filterIds.length === 0) {
          return { notes: [], total: 0, page, perPage, sortKey: appliedSortKey, sortOrder };
        }
      }

      // ── Build WHERE clause ────────────────────────────────────────────────
      // The FTS predicate is held separately from the rest: the ranked path
      // joins notes_fts directly (FTS5 exposes bm25() only on the matched
      // table, and rejects table aliases), while every other path keeps the
      // cheaper `id IN (subquery)` form.
      const restConditions: string[] = ["n.project_id = ?"];
      const restValues: unknown[] = [projectId];

      if (filterIds !== null) {
        restConditions.push(`n.id IN (${filterIds.map(() => "?").join(",")})`);
        restValues.push(...filterIds);
      }
      if (timeMin) { restConditions.push("n.created_at >= ?"); restValues.push(timeMin); }
      if (timeMax) {
        restConditions.push("n.created_at < ?");
        restValues.push(exclusiveEnd(timeMax));
      }

      const dir = sortOrder === "asc" ? "ASC" : "DESC";

      const where = [
        ...(ftsQuery ? ["n.id IN (SELECT rowid FROM notes_fts WHERE notes_fts MATCH ?)"] : []),
        ...restConditions,
      ].join(" AND ");
      const values = [...(ftsQuery ? [ftsQuery] : []), ...restValues];

      let rows: NoteRow[];
      let total: number;
      // Populated on both ranked paths; null on the date-sorted path, where
      // there is no score to show.
      let scoreById: Map<number, number> | null = null;
      // Most-negative bm25 across the whole match set, used to normalise.
      let bestScore = 0;

      const useHybrid = useRelevance && !!queryEmbedding;

      if (useHybrid) {
        // ── Hybrid: lexical + semantic, fused with RRF ────────────────────
        // Fusion has to happen across the *whole* candidate set before
        // pagination — a page of one list cannot be fused with a page of the
        // other — so both rankings are materialised in full and the fused list
        // is what gets paginated. That is affordable here precisely because
        // this is the single-user local provider.
        const rankedWhere = ["notes_fts MATCH ?", ...restConditions].join(" AND ");
        const rankedValues = [ftsQuery, ...restValues];

        const lexicalIds = ftsQuery
          ? (
              db
                .prepare(
                  `SELECT n.id FROM notes n JOIN notes_fts ON notes_fts.rowid = n.id
                    WHERE ${rankedWhere}
                    ORDER BY bm25(notes_fts) ASC, n.id DESC`
                )
                .all(...rankedValues) as { id: number }[]
            ).map((r) => r.id)
          : [];

        const semanticIds = vectorRanking(
          db,
          projectId,
          queryEmbedding!,
          embeddingModel(),
          filterIds
        );

        const fused = fuseRRF(lexicalIds, semanticIds);
        total = fused.length;

        const maxRrf = fused.length ? fused[0].rrf : 0;
        scoreById = new Map(fused.map((f) => [f.id, maxRrf > 0 ? f.rrf / maxRrf : 0]));

        const pageIds = (dir === "ASC" ? [...fused].reverse() : fused)
          .slice(offset, offset + perPage)
          .map((f) => f.id);

        if (pageIds.length === 0) {
          return { notes: [], total, page, perPage, sortKey: appliedSortKey, sortOrder };
        }

        const fetched = db
          .prepare(
            `SELECT id, title, body, created_at, updated_at FROM notes
              WHERE id IN (${pageIds.map(() => "?").join(",")})`
          )
          .all(...pageIds) as NoteRow[];

        // Restore fused order — SQL returns rows in whatever order it likes.
        const byId = new Map(fetched.map((r) => [r.id, r]));
        rows = pageIds.map((id) => byId.get(id)).filter(Boolean) as NoteRow[];
      } else if (useRelevance) {
        const rankedWhere = ["notes_fts MATCH ?", ...restConditions].join(" AND ");
        const rankedValues = [ftsQuery, ...restValues];

        // The normalisation anchor is the best score in the *whole* match set,
        // not the page. It has to be read with ORDER BY + LIMIT 1 rather than
        // MIN(): FTS5 refuses bm25() inside an aggregate ("unable to use
        // function bm25 in the requested context"). This form is cheaper too.
        // Always ASC — the anchor is the best match regardless of sortOrder.
        bestScore = Number(
          (
            db
              .prepare(
                `SELECT bm25(notes_fts) AS best
                   FROM notes n JOIN notes_fts ON notes_fts.rowid = n.id
                  WHERE ${rankedWhere}
                  ORDER BY best ASC
                  LIMIT 1`
              )
              .get(...rankedValues) as { best: number | null } | undefined
          )?.best ?? 0
        );

        // bm25() returns *negative* numbers where smaller is better, so
        // best-first is ASC — the inverse of the ts_rank ordering the Postgres
        // providers use. Tiebreak on id so LIMIT/OFFSET pagination cannot
        // repeat or skip rows when scores are equal.
        rows = db
          .prepare(
            `SELECT n.id, n.title, n.body, n.created_at, n.updated_at,
                    bm25(notes_fts) AS raw_score
               FROM notes n JOIN notes_fts ON notes_fts.rowid = n.id
              WHERE ${rankedWhere}
              ORDER BY raw_score ${dir === "DESC" ? "ASC" : "DESC"}, n.id DESC
              LIMIT ? OFFSET ?`
          )
          .all(...rankedValues, perPage, offset) as NoteRow[];

        total = (
          db.prepare(`SELECT COUNT(*) AS cnt FROM notes n WHERE ${where}`).get(...values) as {
            cnt: number;
          }
        ).cnt;
      } else {
        rows = db
          .prepare(
            `SELECT id, title, body, created_at, updated_at FROM notes n
             WHERE ${where}
             ORDER BY n.${dateSortKey} ${dir}
             LIMIT ? OFFSET ?`
          )
          .all(...values, perPage, offset) as NoteRow[];

        total = (
          db.prepare(`SELECT COUNT(*) AS cnt FROM notes n WHERE ${where}`).get(...values) as {
            cnt: number;
          }
        ).cnt;
      }

      if (!rows.length) {
        return { notes: [], total, page, perPage, sortKey: appliedSortKey, sortOrder };
      }

      // Batch-fetch tags and people for the returned note IDs
      const noteIds = rows.map((r) => r.id);
      const ph = noteIds.map(() => "?").join(",");

      const tagRows = db
        .prepare(`SELECT note_id, tag, is_header FROM note_tags WHERE note_id IN (${ph})`)
        .all(...noteIds) as { note_id: number; tag: string; is_header: number }[];

      const personRows = db
        .prepare(`SELECT note_id, person, is_header FROM note_people WHERE note_id IN (${ph})`)
        .all(...noteIds) as { note_id: number; person: string; is_header: number }[];

      const tagMap = new Map<number, { tag: string; is_header: boolean }[]>();
      const personMap = new Map<number, { person: string; is_header: boolean }[]>();

      for (const r of tagRows) {
        if (!tagMap.has(r.note_id)) tagMap.set(r.note_id, []);
        tagMap.get(r.note_id)!.push({ tag: r.tag, is_header: !!r.is_header });
      }
      for (const r of personRows) {
        if (!personMap.has(r.note_id)) personMap.set(r.note_id, []);
        personMap.get(r.note_id)!.push({ person: r.person, is_header: !!r.is_header });
      }

      // All filter tokens are now resolved into `filterIds` above, so no
      // further client-side filtering is needed here.
      // Normalised to 0..1 against the best match in the whole result set (not
      // the page), so it stays stable across pagination and means the same
      // thing as the Postgres providers' ts_rank-derived score. Raw bm25
      // values are never surfaced: they are negative, inverted, and not
      // comparable to ts_rank.
      const notes: NoteListItem[] = rows.map((row) => ({
        id: row.id,
        title: row.title,
        created_at: row.created_at,
        updated_at: row.updated_at,
        tags: tagMap.get(row.id) ?? [],
        people: personMap.get(row.id) ?? [],
        preview: buildPreview(row.body),
        ...(scoreById
          ? { score: scoreById.get(row.id) ?? 0 }
          : useRelevance
            ? { score: bestScore < 0 ? Number(row.raw_score) / bestScore : 0 }
            : {}),
      }));

      return { notes, total, page, perPage, sortKey: appliedSortKey, sortOrder };
    },

    async get(noteId: number): Promise<Note | null> {
      const note = db
        .prepare("SELECT * FROM notes WHERE id = ?")
        .get(noteId) as NoteRow | undefined;
      if (!note) return null;

      const tags = db
        .prepare("SELECT tag, is_header FROM note_tags WHERE note_id = ?")
        .all(noteId) as { tag: string; is_header: number }[];
      const people = db
        .prepare("SELECT person, is_header FROM note_people WHERE note_id = ?")
        .all(noteId) as { person: string; is_header: number }[];
      const images = db
        .prepare(
          "SELECT img_num, storage_path FROM note_images WHERE note_id = ? ORDER BY img_num"
        )
        .all(noteId) as { img_num: number; storage_path: string }[];

      return {
        id: note.id,
        project_id: note.project_id,
        user_id: note.user_id,
        title: note.title,
        body: note.body,
        version: note.version,
        created_at: note.created_at,
        updated_at: note.updated_at,
        tags: tags.map((t) => ({ tag: t.tag, is_header: !!t.is_header })),
        people: people.map((p) => ({ person: p.person, is_header: !!p.is_header })),
        images,
      };
    },

    async create(
      projectId,
      userId,
      title = "",
      body = "",
      tags = [],
      people = []
    ): Promise<number> {
      const result = db
        .prepare(
          "INSERT INTO notes (project_id, user_id, title, body) VALUES (?, ?, ?, ?)"
        )
        .run(projectId, userId, title, body);
      const noteId = result.lastInsertRowid as number;

      db.prepare(
        "INSERT INTO notes_fts(rowid, title, body) VALUES (?, ?, ?)"
      ).run(noteId, title, body);

      upsertTagsAndPeople(db, noteId, tags, people, body);
      return noteId;
    },

    async save(
      noteId,
      title,
      body,
      tags,
      people,
      expectedVersion
    ): Promise<SaveNoteResponse> {
      const current = db
        .prepare("SELECT version, body FROM notes WHERE id = ?")
        .get(noteId) as { version: number; body: string } | undefined;
      if (!current) return { ok: false };
      if (current.version !== expectedVersion) {
        return { ok: false, conflict: true, currentBody: current.body };
      }

      const newVersion = expectedVersion + 1;
      const now = new Date().toISOString();

      db.prepare(
        "UPDATE notes SET title = ?, body = ?, version = ?, updated_at = ? WHERE id = ?"
      ).run(title, body, newVersion, now, noteId);

      // Sync FTS index
      db.prepare("DELETE FROM notes_fts WHERE rowid = ?").run(noteId);
      db.prepare(
        "INSERT INTO notes_fts(rowid, title, body) VALUES (?, ?, ?)"
      ).run(noteId, title, body);

      upsertTagsAndPeople(db, noteId, tags, people, body);
      updateInlinks(db, noteId, body);
      recordNoteVersion(db, noteId, newVersion, title, body);

      return { ok: true, version: newVersion, updated_at: now };
    },

    async delete(noteId): Promise<void> {
      // Remove from FTS before cascade removes the row
      db.prepare("DELETE FROM notes_fts WHERE rowid = ?").run(noteId);

      // Delete image files from disk
      const images = db
        .prepare("SELECT storage_path FROM note_images WHERE note_id = ?")
        .all(noteId) as { storage_path: string }[];
      if (images.length) {
        const imagesDir = getLocalImagesDir();
        for (const img of images) {
          try {
            await unlink(join(imagesDir, img.storage_path));
          } catch {
            // ignore missing files
          }
        }
      }

      db.prepare("DELETE FROM notes WHERE id = ?").run(noteId);
    },

    async checkOwner(noteId): Promise<string | null> {
      const row = db
        .prepare("SELECT user_id FROM notes WHERE id = ?")
        .get(noteId) as { user_id: string } | undefined;
      return row?.user_id ?? null;
    },

    async moveToProject(noteId, projectId): Promise<void> {
      db.prepare("UPDATE notes SET project_id = ? WHERE id = ?").run(projectId, noteId);
    },

    async getVersions(noteId) {
      return db
        .prepare(
          "SELECT id, version, title, saved_at FROM note_versions WHERE note_id = ? ORDER BY version DESC"
        )
        .all(noteId) as { id: number; version: number; title: string; saved_at: string }[];
    },

    async getVersion(noteId, version) {
      const row = db
        .prepare(
          "SELECT version, title, body, saved_at FROM note_versions WHERE note_id = ? AND version = ?"
        )
        .get(noteId, version) as
        | { version: number; title: string; body: string; saved_at: string }
        | undefined;
      return row ?? null;
    },

    async getTagCounts(projectId): Promise<TagCount[]> {
      const rows = db
        .prepare(
          `SELECT nt.tag, nt.is_header
           FROM note_tags nt
           JOIN notes n ON n.id = nt.note_id
           WHERE n.project_id = ?`
        )
        .all(projectId) as { tag: string; is_header: number }[];

      const map = new Map<string, TagCount>();
      for (const row of rows) {
        const e = map.get(row.tag) ?? { tag: row.tag, count: 0, header_count: 0 };
        e.count++;
        if (row.is_header) e.header_count++;
        map.set(row.tag, e);
      }
      return [...map.values()].sort((a, b) => b.count - a.count);
    },

    async getPersonCounts(projectId): Promise<PersonCount[]> {
      const rows = db
        .prepare(
          `SELECT np.person, np.is_header
           FROM note_people np
           JOIN notes n ON n.id = np.note_id
           WHERE n.project_id = ?`
        )
        .all(projectId) as { person: string; is_header: number }[];

      const map = new Map<string, PersonCount>();
      for (const row of rows) {
        const e = map.get(row.person) ?? { person: row.person, count: 0, header_count: 0 };
        e.count++;
        if (row.is_header) e.header_count++;
        map.set(row.person, e);
      }
      return [...map.values()].sort((a, b) => b.count - a.count);
    },

    async getSignedImageUrls(
      images: { img_num: number; storage_path: string }[]
    ): Promise<Record<number, string>> {
      // In local mode, storage_path is "{noteId}/{imgNum}.png" — derive the API URL from it
      const result: Record<number, string> = {};
      for (const img of images) {
        const [noteId, file] = img.storage_path.split("/");
        const imgNum = file?.replace(".png", "") ?? String(img.img_num);
        result[img.img_num] = `/api/local-image/${noteId}/${imgNum}`;
      }
      return result;
    },

    async searchTitles(projectId, query, limit = 25) {
      return db
        .prepare(
          "SELECT id, title, created_at FROM notes WHERE project_id = ? AND title LIKE ? LIMIT ?"
        )
        .all(projectId, `%${query}%`, limit) as {
        id: number;
        title: string;
        created_at: string;
      }[];
    },

    async getEarliestNoteDate(projectId): Promise<string | null> {
      const row = db
        .prepare(
          "SELECT created_at FROM notes WHERE project_id = ? ORDER BY created_at ASC LIMIT 1"
        )
        .get(projectId) as { created_at: string } | undefined;
      if (!row) return null;
      return row.created_at.split("T")[0];
    },

    async getTaglines(projectId, tag, page = 1, pageSize = 25) {
      const rows = db
        .prepare(
          `SELECT n.id, n.title, n.body, n.created_at
           FROM note_tags nt
           JOIN notes n ON n.id = nt.note_id
           WHERE n.project_id = ? AND nt.tag = ?
           ORDER BY n.created_at DESC`
        )
        .all(projectId, tag) as {
        id: number;
        title: string;
        body: string;
        created_at: string;
      }[];

      const all: {
        noteId: number;
        noteTitle: string;
        noteCreatedAt: string;
        line: string;
      }[] = [];
      const tagPattern = new RegExp(`#${tag}(?![a-z0-9_-])`, "i");

      for (const note of rows) {
        for (const line of note.body.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("<!--")) continue;
          if (tagPattern.test(trimmed)) {
            all.push({
              noteId: note.id,
              noteTitle: note.title,
              noteCreatedAt: note.created_at,
              line: trimmed,
            });
          }
        }
      }

      const offset2 = (page - 1) * pageSize;
      return { lines: all.slice(offset2, offset2 + pageSize), total: all.length };
    },

    async getRefTitles(ids, userId): Promise<Map<number, string>> {
      const map = new Map<number, string>();
      if (!ids.length) return map;
      const ph = ids.map(() => "?").join(",");
      const rows = db
        .prepare(`SELECT id, title FROM notes WHERE id IN (${ph}) AND user_id = ?`)
        .all(...ids, userId) as { id: number; title: string }[];
      for (const row of rows) map.set(row.id, row.title);
      return map;
    },

    async listImages(projectId, page = 1, perPage = 24) {
      const total = (
        db
          .prepare(
            `SELECT COUNT(*) AS cnt
             FROM note_images ni JOIN notes n ON n.id = ni.note_id
             WHERE n.project_id = ?`
          )
          .get(projectId) as { cnt: number }
      ).cnt;

      const offset = (page - 1) * perPage;
      const rows = db
        .prepare(
          `SELECT ni.note_id, ni.img_num, ni.storage_path,
                  n.title AS note_title, n.created_at AS note_created_at
           FROM note_images ni
           JOIN notes n ON n.id = ni.note_id
           WHERE n.project_id = ?
           ORDER BY ni.note_id DESC, ni.img_num ASC
           LIMIT ? OFFSET ?`
        )
        .all(projectId, perPage, offset) as {
        note_id: number;
        img_num: number;
        storage_path: string;
        note_title: string;
        note_created_at: string;
      }[];

      const images: GalleryImage[] = rows.map((r) => ({
        note_id: r.note_id,
        note_title: r.note_title,
        note_created_at: r.note_created_at,
        img_num: r.img_num,
        storage_path: r.storage_path,
        signed_url: `/api/local-image/${r.note_id}/${r.img_num}`,
      }));

      return { images, total, page, perPage };
    },

    async getInlinks(noteId) {
      return db
        .prepare(
          `SELECT ni.source_note_id, n.title AS note_title
           FROM note_inlinks ni
           JOIN notes n ON n.id = ni.source_note_id
           WHERE ni.target_note_id = ?`
        )
        .all(noteId) as { source_note_id: number; note_title: string }[];
    },

    async getImageRecords(noteId): Promise<NoteImage[]> {
      return db
        .prepare(
          "SELECT img_num, storage_path FROM note_images WHERE note_id = ? ORDER BY img_num"
        )
        .all(noteId) as NoteImage[];
    },

    async getImageRecord(noteId, imgNum) {
      return (
        (db
          .prepare(
            "SELECT storage_path FROM note_images WHERE note_id = ? AND img_num = ?"
          )
          .get(noteId, imgNum) as { storage_path: string } | undefined) ?? null
      );
    },

    async getNextImageNum(noteId): Promise<number> {
      const row = db
        .prepare("SELECT MAX(img_num) AS max_num FROM note_images WHERE note_id = ?")
        .get(noteId) as { max_num: number | null };
      return (row.max_num ?? 0) + 1;
    },

    async insertImageRecord(noteId, imgNum, storagePath): Promise<void> {
      db.prepare(
        "INSERT INTO note_images (note_id, img_num, storage_path) VALUES (?, ?, ?)"
      ).run(noteId, imgNum, storagePath);
    },

    async deleteImageRecord(noteId, imgNum): Promise<void> {
      db.prepare(
        "DELETE FROM note_images WHERE note_id = ? AND img_num = ?"
      ).run(noteId, imgNum);
    },
  };
}

// ── Projects provider ─────────────────────────────────────────────────────────

function buildProjectsProvider(db: Database.Database): ProjectsDataProvider {
  return {
    async getActive(userId, projectId?): Promise<Project | null> {
      const cookieStore = await cookies();
      const effectiveId = projectId ?? cookieStore.get("active_project")?.value;

      if (effectiveId) {
        const row = db
          .prepare("SELECT * FROM projects WHERE id = ? AND user_id = ?")
          .get(effectiveId, userId) as ProjectRow | undefined;
        if (row) return projectRowToProject(row);
      }

      const row = db
        .prepare(
          "SELECT * FROM projects WHERE user_id = ? ORDER BY created_at ASC LIMIT 1"
        )
        .get(userId) as ProjectRow | undefined;
      return row ? projectRowToProject(row) : null;
    },

    async getUserProjects(userId): Promise<Project[]> {
      const rows = db
        .prepare("SELECT * FROM projects WHERE user_id = ? ORDER BY created_at ASC")
        .all(userId) as ProjectRow[];
      return rows.map(projectRowToProject);
    },

    async getUserSettings(userId): Promise<UserSettings> {
      const row = db
        .prepare("SELECT * FROM user_settings WHERE user_id = ?")
        .get(userId) as {
        notes_per_page: number;
        autosave_enabled: number;
        autosave_interval: number;
      } | undefined;
      if (!row) return { notes_per_page: 25, autosave_enabled: true, autosave_interval: 30 };
      return {
        notes_per_page: row.notes_per_page,
        autosave_enabled: !!row.autosave_enabled,
        autosave_interval: row.autosave_interval,
      };
    },

    async create(userId, name): Promise<Project> {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      db.prepare(
        "INSERT INTO projects (id, user_id, name, created_at) VALUES (?, ?, ?, ?)"
      ).run(id, userId, name, now);
      return { id, user_id: userId, name, vector_search: false, created_at: now };
    },

    async update(projectId, updates): Promise<void> {
      if (updates.name !== undefined) {
        db.prepare("UPDATE projects SET name = ? WHERE id = ?").run(
          updates.name,
          projectId
        );
      }
      if (updates.vector_search !== undefined) {
        db.prepare("UPDATE projects SET vector_search = ? WHERE id = ?").run(
          updates.vector_search ? 1 : 0,
          projectId
        );
      }
    },

    async delete(projectId): Promise<void> {
      db.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
    },

    async checkOwner(projectId): Promise<string | null> {
      const row = db
        .prepare("SELECT user_id FROM projects WHERE id = ?")
        .get(projectId) as { user_id: string } | undefined;
      return row?.user_id ?? null;
    },

    async updateSettings(userId, updates): Promise<void> {
      if (updates.notes_per_page !== undefined) {
        db.prepare(
          "UPDATE user_settings SET notes_per_page = ? WHERE user_id = ?"
        ).run(updates.notes_per_page, userId);
      }
      if (updates.autosave_enabled !== undefined) {
        db.prepare(
          "UPDATE user_settings SET autosave_enabled = ? WHERE user_id = ?"
        ).run(updates.autosave_enabled ? 1 : 0, userId);
      }
      if (updates.autosave_interval !== undefined) {
        db.prepare(
          "UPDATE user_settings SET autosave_interval = ? WHERE user_id = ?"
        ).run(updates.autosave_interval, userId);
      }
    },

    async clearNotes(projectId): Promise<void> {
      // Remove from FTS before cascade delete
      const noteIds = db
        .prepare("SELECT id FROM notes WHERE project_id = ?")
        .all(projectId) as { id: number }[];
      for (const { id } of noteIds) {
        db.prepare("DELETE FROM notes_fts WHERE rowid = ?").run(id);
      }
      db.prepare("DELETE FROM notes WHERE project_id = ?").run(projectId);
    },
  };
}

// ── Bios provider ─────────────────────────────────────────────────────────────

function buildBiosProvider(db: Database.Database): BiosDataProvider {
  return {
    async get(projectId, person) {
      const row = db
        .prepare(
          "SELECT content, updated_at FROM person_bios WHERE project_id = ? AND person = ?"
        )
        .get(projectId, person) as
        | { content: string; updated_at: string }
        | undefined;
      return { content: row?.content ?? "", updated_at: row?.updated_at ?? null };
    },

    async save(projectId, userId, person, content) {
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO person_bios (project_id, user_id, person, content, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(project_id, person)
         DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`
      ).run(projectId, userId, person, content, now);
      return { updated_at: now };
    },
  };
}

// ── Factory ───────────────────────────────────────────────────────────────────

// ── Chunks provider ───────────────────────────────────────────────────────────

function buildChunksProvider(db: Database.Database): ChunksDataProvider {
  return {
    async sync(noteId, projectId, chunks): Promise<ChunkSyncResult> {
      const existing = new Map<number, string>(
        (
          db
            .prepare("SELECT chunk_index, content_hash FROM note_chunks WHERE note_id = ?")
            .all(noteId) as { chunk_index: number; content_hash: string }[]
        ).map((r) => [r.chunk_index, r.content_hash])
      );

      const result: ChunkSyncResult = { inserted: 0, updated: 0, deleted: 0, unchanged: 0 };

      const upsert = db.prepare(
        `INSERT INTO note_chunks
           (note_id, project_id, chunk_index, content, embed_text, content_hash,
            token_count, embedding, model, dim, embedded_at)
         VALUES (?,?,?,?,?,?,?,NULL,NULL,NULL,NULL)
         ON CONFLICT(note_id, chunk_index) DO UPDATE SET
           content      = excluded.content,
           embed_text   = excluded.embed_text,
           content_hash = excluded.content_hash,
           token_count  = excluded.token_count,
           -- Cleared deliberately: an edited chunk must not keep the vector of
           -- text that no longer exists. NULL also re-queues it for the drain.
           embedding    = NULL,
           model        = NULL,
           dim          = NULL,
           embedded_at  = NULL`
      );

      const run = db.transaction(() => {
        for (const c of chunks) {
          const prior = existing.get(c.chunkIndex);
          if (prior === c.contentHash) {
            result.unchanged++;
            continue;
          }
          if (prior !== undefined) result.updated++;
          else result.inserted++;
          upsert.run(
            noteId, projectId, c.chunkIndex, c.content, c.embedText, c.contentHash, c.tokenCount
          );
        }

        const keep = chunks.map((c) => c.chunkIndex);
        const info = keep.length
          ? db
              .prepare(
                `DELETE FROM note_chunks
                  WHERE note_id = ? AND chunk_index NOT IN (${keep.map(() => "?").join(",")})`
              )
              .run(noteId, ...keep)
          : db.prepare("DELETE FROM note_chunks WHERE note_id = ?").run(noteId);
        result.deleted = info.changes;
      });
      run();

      return result;
    },

    async notesToChunk(projectId, afterId, limit) {
      return db
        .prepare(
          `SELECT id, title, body, created_at FROM notes
            WHERE project_id = ? AND id > ? ORDER BY id LIMIT ?`
        )
        .all(projectId, afterId, limit) as {
        id: number;
        title: string;
        body: string;
        created_at: string;
      }[];
    },

    async pending(limit, projectId): Promise<PendingChunk[]> {
      return (
        projectId
          ? db
              .prepare(
                `SELECT id, embed_text FROM note_chunks
                  WHERE embedding IS NULL AND project_id = ? ORDER BY id LIMIT ?`
              )
              .all(projectId, limit)
          : db
              .prepare(
                "SELECT id, embed_text FROM note_chunks WHERE embedding IS NULL ORDER BY id LIMIT ?"
              )
              .all(limit)
      ) as PendingChunk[];
    },

    async writeEmbeddings(rows, model, dim): Promise<void> {
      const now = new Date().toISOString();
      const stmt = db.prepare(
        "UPDATE note_chunks SET embedding = ?, model = ?, dim = ?, embedded_at = ? WHERE id = ?"
      );
      db.transaction(() => {
        for (const r of rows) stmt.run(vecToBlob(r.embedding), model, dim, now, r.id);
      })();
    },

    async pendingCount(projectId): Promise<number> {
      return (
        db
          .prepare(
            "SELECT COUNT(*) AS c FROM note_chunks WHERE project_id = ? AND embedding IS NULL"
          )
          .get(projectId) as { c: number }
      ).c;
    },

    async related(noteId, limit = 5): Promise<RelatedNote[]> {
      const model = embeddingModel();
      const src = db
        .prepare(
          `SELECT project_id, embedding FROM note_chunks
            WHERE note_id = ? AND embedding IS NOT NULL AND model = ?`
        )
        .all(noteId, model) as { project_id: string; embedding: Buffer }[];
      if (!src.length) return [];

      const others = db
        .prepare(
          `SELECT note_id, embedding FROM note_chunks
            WHERE project_id = ? AND note_id != ? AND embedding IS NOT NULL AND model = ?`
        )
        .all(src[0].project_id, noteId, model) as { note_id: number; embedding: Buffer }[];

      const srcVecs = src.map((r) => blobToVec(r.embedding));
      const best = new Map<number, number>();
      for (const o of others) {
        const v = blobToVec(o.embedding);
        let d = Infinity;
        for (const sv of srcVecs) d = Math.min(d, cosineDistance(sv, v));
        const prior = best.get(o.note_id);
        if (prior === undefined || d < prior) best.set(o.note_id, d);
      }

      const near = [...best.entries()]
        .filter(([, d]) => d <= MAX_VECTOR_DISTANCE)
        .sort((a, b) => a[1] - b[1])
        .slice(0, limit);
      if (!near.length) return [];

      const ids = near.map(([id]) => id);
      const rows = db
        .prepare(
          `SELECT id, title, created_at FROM notes WHERE id IN (${ids.map(() => "?").join(",")})`
        )
        .all(...ids) as { id: number; title: string; created_at: string }[];
      const byId = new Map(rows.map((r) => [r.id, r]));

      return near
        .map(([id, d]) => {
          const row = byId.get(id);
          if (!row) return null;
          return {
            id: row.id,
            title: row.title,
            created_at: row.created_at,
            score: Math.max(0, 1 - d),
          };
        })
        .filter(Boolean) as RelatedNote[];
    },

    async clearEmbeddings(projectId): Promise<void> {
      db.prepare(
        `UPDATE note_chunks SET embedding = NULL, model = NULL, dim = NULL, embedded_at = NULL
          WHERE project_id = ?`
      ).run(projectId);
    },
  };
}

export function createSqliteProvider(): DataProvider {
  const db = getDb();
  return {
    notes: withCorruptionHint(buildNotesProvider(db)),
    projects: withCorruptionHint(buildProjectsProvider(db)),
    bios: withCorruptionHint(buildBiosProvider(db)),
    chunks: withCorruptionHint(buildChunksProvider(db)),
  };
}
