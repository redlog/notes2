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
import { extractMentions, extractNoteRefs, buildPreview } from "@/lib/notes";
import { getLocalDbPath, getLocalImagesDir } from "@/lib/local-storage";
import type { DataProvider, NotesDataProvider, ProjectsDataProvider, BiosDataProvider } from "../types";
import type {
  ListParams,
  ListResult,
  Note,
  NoteImage,
  NoteListItem,
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
  ensureLocalUser(db);

  globalForDb.sqliteDb = db;
  return db;
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
      trigram_search INTEGER NOT NULL DEFAULT 1,
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

function buildFtsQuery(search: string): string {
  return search
    .trim()
    .replace(/[^\w\s\-']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
};

type ProjectRow = {
  id: string;
  user_id: string;
  name: string;
  trigram_search: number;
  created_at: string;
};

function projectRowToProject(row: ProjectRow): Project {
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    trigram_search: !!row.trigram_search,
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
      } = params;
      const offset = (page - 1) * perPage;

      // Parse filter tokens
      const filterTokens = filter.split(/[\s,]+/).map((t) => t.trim()).filter(Boolean);
      const requiredTags    = filterTokens.filter((t) => t.startsWith("#")).map((t) => t.slice(1));
      const requiredPeople  = filterTokens.filter((t) => t.startsWith("@")).map((t) => t.slice(1));
      const exclusiveTags   = filterTokens.filter((t) => t.startsWith("+#")).map((t) => t.slice(2));
      const exclusivePeople = filterTokens.filter((t) => t.startsWith("+@")).map((t) => t.slice(2));
      const excludedTags    = filterTokens.filter((t) => t.startsWith("~#")).map((t) => t.slice(2));

      // Pre-filter by required tags / people
      let filterIds: number[] | null = null;
      if (requiredTags.length > 0 || requiredPeople.length > 0) {
        let ids: Set<number> | null = null;

        for (const tag of requiredTags) {
          const rows = db
            .prepare("SELECT note_id FROM note_tags WHERE tag = ?")
            .all(tag) as { note_id: number }[];
          const s = new Set(rows.map((r) => r.note_id));
          ids = ids === null ? s : setIntersect(ids, s);
        }
        for (const person of requiredPeople) {
          const rows = db
            .prepare("SELECT note_id FROM note_people WHERE person = ?")
            .all(person) as { note_id: number }[];
          const s = new Set(rows.map((r) => r.note_id));
          ids = ids === null ? s : setIntersect(ids, s);
        }

        filterIds = [...(ids ?? new Set<number>())];
        if (filterIds.length === 0) {
          return { notes: [], total: 0, page, perPage, sortKey: params.sortKey ?? "created_at", sortOrder };
        }
      }

      // Build WHERE clause
      const conditions: string[] = ["n.project_id = ?"];
      const values: unknown[] = [projectId];

      if (search) {
        const ftsQ = buildFtsQuery(search);
        if (ftsQ) {
          conditions.push("n.id IN (SELECT rowid FROM notes_fts WHERE notes_fts MATCH ?)");
          values.push(ftsQ);
        }
      }
      if (filterIds !== null) {
        conditions.push(`n.id IN (${filterIds.map(() => "?").join(",")})`);
        values.push(...filterIds);
      }
      if (timeMin) { conditions.push("n.created_at >= ?"); values.push(timeMin); }
      if (timeMax) {
        const end = new Date(timeMax);
        end.setDate(end.getDate() + 1);
        conditions.push("n.created_at < ?");
        values.push(end.toISOString());
      }

      const where = conditions.join(" AND ");
      const effectiveSortKey =
        search && sortKey === "relevance" ? "created_at" : sortKey;
      const dir = sortOrder === "asc" ? "ASC" : "DESC";

      const total = (
        db.prepare(`SELECT COUNT(*) AS cnt FROM notes n WHERE ${where}`).get(...values) as { cnt: number }
      ).cnt;

      const rows = db
        .prepare(
          `SELECT id, title, body, created_at, updated_at FROM notes n
           WHERE ${where}
           ORDER BY n.${effectiveSortKey} ${dir}
           LIMIT ? OFFSET ?`
        )
        .all(...values, perPage, offset) as NoteRow[];

      if (!rows.length) {
        return { notes: [], total, page, perPage, sortKey: params.sortKey ?? "created_at", sortOrder };
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

      let notes: NoteListItem[] = rows.map((row) => ({
        id: row.id,
        title: row.title,
        created_at: row.created_at,
        updated_at: row.updated_at,
        tags: tagMap.get(row.id) ?? [],
        people: personMap.get(row.id) ?? [],
        preview: buildPreview(row.body),
      }));

      // Client-side exclusive/excluded filters
      if (exclusiveTags.length) {
        notes = notes.filter(
          (n) =>
            n.tags.filter((t) => t.is_header).length === exclusiveTags.length &&
            exclusiveTags.every((t) => n.tags.some((nt) => nt.tag === t && nt.is_header))
        );
      }
      if (exclusivePeople.length) {
        notes = notes.filter(
          (n) =>
            n.people.filter((p) => p.is_header).length === exclusivePeople.length &&
            exclusivePeople.every((p) =>
              n.people.some((np) => np.person === p && np.is_header)
            )
        );
      }
      if (excludedTags.length) {
        notes = notes.filter(
          (n) => !excludedTags.some((t) => n.tags.some((nt) => nt.tag === t))
        );
      }

      return { notes, total, page, perPage, sortKey: params.sortKey ?? "created_at", sortOrder };
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
          "SELECT id, title FROM notes WHERE project_id = ? AND title LIKE ? LIMIT ?"
        )
        .all(projectId, `%${query}%`, limit) as { id: number; title: string }[];
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
      const tagPattern = new RegExp(`#${tag}\\b`, "i");

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
      return { id, user_id: userId, name, trigram_search: true, created_at: now };
    },

    async update(projectId, updates): Promise<void> {
      if (updates.name !== undefined) {
        db.prepare("UPDATE projects SET name = ? WHERE id = ?").run(
          updates.name,
          projectId
        );
      }
      if (updates.trigram_search !== undefined) {
        db.prepare("UPDATE projects SET trigram_search = ? WHERE id = ?").run(
          updates.trigram_search ? 1 : 0,
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

export function createSqliteProvider(): DataProvider {
  const db = getDb();
  return {
    notes: buildNotesProvider(db),
    projects: buildProjectsProvider(db),
    bios: buildBiosProvider(db),
  };
}
