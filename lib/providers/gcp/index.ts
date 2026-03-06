/**
 * GCP implementation of DataProvider.
 *
 * Database:  Cloud SQL for PostgreSQL, accessed via DATABASE_URL.
 *            On Cloud Run the recommended approach is the Cloud SQL connector;
 *            a plain connection string also works for dev / AlloyDB / external PG.
 *
 * Storage:   Google Cloud Storage (GCS).  Bucket name is read from GCS_BUCKET.
 *            Signed URLs use Application Default Credentials (ADC), which Cloud
 *            Run supplies automatically via the service-account's IAM binding.
 *
 * Required env vars (add these to Vercel / Cloud Run):
 *   DATABASE_URL          Full Postgres connection string
 *                         e.g. postgres://user:password@host:5432/dbname
 *   GCS_BUCKET            Name of the GCS bucket that holds note images
 *                         e.g. my-project-note-images
 */

import { Pool } from "pg";
import { Storage } from "@google-cloud/storage";
import { cookies } from "next/headers";
import { extractMentions, extractNoteRefs } from "@/lib/notes";
import type { DataProvider, NotesDataProvider, ProjectsDataProvider } from "../types";
import type {
  ListParams,
  ListResult,
  Note,
  NoteListItem,
  TagCount,
  PersonCount,
  Project,
  UserSettings,
  SaveNoteResponse,
} from "@/lib/types";

// ── Singletons ────────────────────────────────────────────────────────────────
// Reused across requests in the same Cloud Run instance / long-lived server.

let _pool: Pool | null = null;

function getPool(): Pool {
  if (!_pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL env var not set");
    _pool = new Pool({ connectionString, max: 10 });
  }
  return _pool;
}

function getGcsBucket(): string {
  const b = process.env.GCS_BUCKET;
  if (!b) throw new Error("GCS_BUCKET env var not set");
  return b;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

const MAX_VERSIONS = 50;

async function upsertTagsAndPeople(
  db: Pool,
  noteId: number,
  headerTags: string[],
  headerPeople: string[],
  body: string
) {
  const { tags: mentionTags, people: mentionPeople } = extractMentions(body);

  // Delete all existing rows then re-insert (same semantics as Supabase impl)
  await db.query("DELETE FROM note_tags WHERE note_id = $1", [noteId]);
  await db.query("DELETE FROM note_people WHERE note_id = $1", [noteId]);

  const tagRows = [
    ...headerTags.map((tag) => ({ note_id: noteId, tag, is_header: true })),
    ...mentionTags
      .filter((t) => !headerTags.includes(t))
      .map((tag) => ({ note_id: noteId, tag, is_header: false })),
  ];
  const personRows = [
    ...headerPeople.map((person) => ({ note_id: noteId, person, is_header: true })),
    ...mentionPeople
      .filter((p) => !headerPeople.includes(p))
      .map((person) => ({ note_id: noteId, person, is_header: false })),
  ];

  if (tagRows.length) {
    const vals = tagRows.map((_, i) => `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`).join(", ");
    await db.query(
      `INSERT INTO note_tags (note_id, tag, is_header) VALUES ${vals}`,
      tagRows.flatMap((r) => [r.note_id, r.tag, r.is_header])
    );
  }
  if (personRows.length) {
    const vals = personRows.map((_, i) => `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`).join(", ");
    await db.query(
      `INSERT INTO note_people (note_id, person, is_header) VALUES ${vals}`,
      personRows.flatMap((r) => [r.note_id, r.person, r.is_header])
    );
  }
}

async function updateInlinks(db: Pool, sourceNoteId: number, body: string) {
  const refs = extractNoteRefs(body);
  await db.query("DELETE FROM note_inlinks WHERE source_note_id = $1", [sourceNoteId]);
  if (refs.length) {
    const vals = refs.map((_, i) => `($1, $${i + 2})`).join(", ");
    await db.query(
      `INSERT INTO note_inlinks (source_note_id, target_note_id) VALUES ${vals}`,
      [sourceNoteId, ...refs]
    );
  }
}

async function recordNoteVersion(
  db: Pool,
  noteId: number,
  version: number,
  title: string,
  body: string
) {
  await db.query(
    "INSERT INTO note_versions (note_id, version, title, body) VALUES ($1, $2, $3, $4)",
    [noteId, version, title, body]
  );
  // Trim to most recent MAX_VERSIONS entries
  await db.query(
    `DELETE FROM note_versions
     WHERE note_id = $1 AND version <= (
       SELECT version FROM note_versions
       WHERE note_id = $1
       ORDER BY version DESC
       OFFSET $2 LIMIT 1
     )`,
    [noteId, MAX_VERSIONS]
  );
}

// ── Notes provider ────────────────────────────────────────────────────────────

function buildNotesProvider(db: Pool, storage: Storage): NotesDataProvider {
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

      // Parse filter tokens (same logic as Supabase impl)
      const filterTokens = filter.split(/[\s,]+/).map((t) => t.trim()).filter(Boolean);
      const requiredTags    = filterTokens.filter((t) => t.startsWith("#")).map((t) => t.slice(1));
      const requiredPeople  = filterTokens.filter((t) => t.startsWith("@")).map((t) => t.slice(1));
      const exclusiveTags   = filterTokens.filter((t) => t.startsWith("+#")).map((t) => t.slice(2));
      const exclusivePeople = filterTokens.filter((t) => t.startsWith("+@")).map((t) => t.slice(2));
      const excludedTags    = filterTokens.filter((t) => t.startsWith("~#")).map((t) => t.slice(2));

      const sqlVals: unknown[] = [projectId];
      let pIdx = 2;
      const conditions: string[] = ["n.project_id = $1"];

      if (search) {
        conditions.push(`n.search_vec @@ websearch_to_tsquery('english', $${pIdx})`);
        sqlVals.push(search);
        pIdx++;
      }
      if (timeMin) {
        conditions.push(`n.created_at >= $${pIdx}`);
        sqlVals.push(timeMin);
        pIdx++;
      }
      if (timeMax) {
        const end = new Date(timeMax);
        end.setDate(end.getDate() + 1);
        conditions.push(`n.created_at < $${pIdx}`);
        sqlVals.push(end.toISOString());
        pIdx++;
      }

      // "relevance" is not a real column — fall back to created_at
      const effectiveSortKey = sortKey === "relevance" ? "created_at" : sortKey;
      const orderDir = sortOrder === "asc" ? "ASC" : "DESC";

      const whereClause = conditions.join(" AND ");
      sqlVals.push(perPage, offset);

      const sql = `
        SELECT
          n.id, n.title, n.created_at, n.updated_at,
          COALESCE(
            json_agg(DISTINCT jsonb_build_object('tag', nt.tag, 'is_header', nt.is_header))
            FILTER (WHERE nt.tag IS NOT NULL), '[]'
          ) AS tags,
          COALESCE(
            json_agg(DISTINCT jsonb_build_object('person', np.person, 'is_header', np.is_header))
            FILTER (WHERE np.person IS NOT NULL), '[]'
          ) AS people,
          COUNT(*) OVER() AS total_count
        FROM notes n
        LEFT JOIN note_tags   nt ON nt.note_id = n.id
        LEFT JOIN note_people np ON np.note_id = n.id
        WHERE ${whereClause}
        GROUP BY n.id
        ORDER BY n.${effectiveSortKey} ${orderDir}
        LIMIT $${pIdx} OFFSET $${pIdx + 1}
      `;

      const { rows } = await db.query(sql, sqlVals);

      const totalCount = rows.length > 0 ? Number(rows[0].total_count) : 0;

      let notes: NoteListItem[] = rows.map((row) => ({
        id: row.id as number,
        title: row.title as string,
        created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
        updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
        tags: row.tags ?? [],
        people: row.people ?? [],
      }));

      // Client-side filter application (matches Supabase impl behaviour)
      if (requiredTags.length)
        notes = notes.filter((n) => requiredTags.every((t) => n.tags.some((nt) => nt.tag === t)));
      if (requiredPeople.length)
        notes = notes.filter((n) => requiredPeople.every((p) => n.people.some((np) => np.person === p)));
      if (exclusiveTags.length)
        notes = notes.filter(
          (n) =>
            n.tags.filter((t) => t.is_header).length === exclusiveTags.length &&
            exclusiveTags.every((t) => n.tags.some((nt) => nt.tag === t && nt.is_header))
        );
      if (exclusivePeople.length)
        notes = notes.filter(
          (n) =>
            n.people.filter((p) => p.is_header).length === exclusivePeople.length &&
            exclusivePeople.every((p) => n.people.some((np) => np.person === p && np.is_header))
        );
      if (excludedTags.length)
        notes = notes.filter((n) => !excludedTags.some((t) => n.tags.some((nt) => nt.tag === t)));

      return {
        notes,
        total: totalCount,
        page,
        perPage,
        sortKey: params.sortKey ?? "created_at",
        sortOrder,
      };
    },

    async get(noteId: number): Promise<Note | null> {
      const { rows } = await db.query(
        `SELECT
           n.*,
           COALESCE(
             json_agg(DISTINCT jsonb_build_object('tag', nt.tag, 'is_header', nt.is_header))
             FILTER (WHERE nt.tag IS NOT NULL), '[]'
           ) AS tags,
           COALESCE(
             json_agg(DISTINCT jsonb_build_object('person', np.person, 'is_header', np.is_header))
             FILTER (WHERE np.person IS NOT NULL), '[]'
           ) AS people,
           COALESCE(
             json_agg(DISTINCT jsonb_build_object('img_num', ni.img_num, 'storage_path', ni.storage_path))
             FILTER (WHERE ni.img_num IS NOT NULL), '[]'
           ) AS images
         FROM notes n
         LEFT JOIN note_tags   nt ON nt.note_id = n.id
         LEFT JOIN note_people np ON np.note_id = n.id
         LEFT JOIN note_images ni ON ni.note_id = n.id
         WHERE n.id = $1
         GROUP BY n.id`,
        [noteId]
      );
      if (!rows[0]) return null;
      const r = rows[0];
      return {
        ...r,
        created_at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
        updated_at: r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at,
      } as Note;
    },

    async create(projectId, userId, title = "", body = "", tags = [], people = []): Promise<number> {
      const { rows } = await db.query(
        "INSERT INTO notes (project_id, user_id, title, body) VALUES ($1, $2, $3, $4) RETURNING id",
        [projectId, userId, title, body]
      );
      const noteId: number = rows[0].id;
      await upsertTagsAndPeople(db, noteId, tags, people, body);
      return noteId;
    },

    async save(noteId, title, body, tags, people, expectedVersion): Promise<SaveNoteResponse> {
      const { rows: cur } = await db.query(
        "SELECT version, body FROM notes WHERE id = $1",
        [noteId]
      );
      if (!cur.length) return { ok: false };
      if (cur[0].version !== expectedVersion)
        return { ok: false, conflict: true, currentBody: cur[0].body };

      const newVersion = expectedVersion + 1;
      const { rows: updated } = await db.query(
        `UPDATE notes
         SET title = $1, body = $2, version = $3, updated_at = NOW()
         WHERE id = $4
         RETURNING version, updated_at`,
        [title, body, newVersion, noteId]
      );
      if (!updated.length) return { ok: false };

      await upsertTagsAndPeople(db, noteId, tags, people, body);
      await updateInlinks(db, noteId, body);
      await recordNoteVersion(db, noteId, newVersion, title, body);

      const updatedAt = updated[0].updated_at instanceof Date
        ? updated[0].updated_at.toISOString()
        : updated[0].updated_at;
      return { ok: true, version: updated[0].version, updated_at: updatedAt };
    },

    async delete(noteId): Promise<void> {
      const { rows: images } = await db.query(
        "SELECT storage_path FROM note_images WHERE note_id = $1",
        [noteId]
      );
      if (images.length) {
        const bkt = storage.bucket(getGcsBucket());
        await Promise.all(
          images.map((img: { storage_path: string }) =>
            bkt.file(img.storage_path).delete().catch(() => {})
          )
        );
      }
      await db.query("DELETE FROM notes WHERE id = $1", [noteId]);
    },

    async checkOwner(noteId): Promise<string | null> {
      const { rows } = await db.query("SELECT user_id FROM notes WHERE id = $1", [noteId]);
      return rows[0]?.user_id ?? null;
    },

    async moveToProject(noteId, projectId): Promise<void> {
      await db.query("UPDATE notes SET project_id = $1 WHERE id = $2", [projectId, noteId]);
    },

    async getVersions(noteId) {
      const { rows } = await db.query(
        "SELECT id, version, title, saved_at FROM note_versions WHERE note_id = $1 ORDER BY version DESC",
        [noteId]
      );
      return rows.map((r) => ({
        ...r,
        saved_at: r.saved_at instanceof Date ? r.saved_at.toISOString() : r.saved_at,
      }));
    },

    async getVersion(noteId, version) {
      const { rows } = await db.query(
        "SELECT version, title, body, saved_at FROM note_versions WHERE note_id = $1 AND version = $2",
        [noteId, version]
      );
      if (!rows[0]) return null;
      const r = rows[0];
      return {
        ...r,
        saved_at: r.saved_at instanceof Date ? r.saved_at.toISOString() : r.saved_at,
      };
    },

    async getTagCounts(projectId): Promise<TagCount[]> {
      const { rows } = await db.query(
        `SELECT nt.tag, nt.is_header
         FROM note_tags nt
         JOIN notes n ON n.id = nt.note_id
         WHERE n.project_id = $1`,
        [projectId]
      );
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
      const { rows } = await db.query(
        `SELECT np.person, np.is_header
         FROM note_people np
         JOIN notes n ON n.id = np.note_id
         WHERE n.project_id = $1`,
        [projectId]
      );
      const map = new Map<string, PersonCount>();
      for (const row of rows) {
        const e = map.get(row.person) ?? { person: row.person, count: 0, header_count: 0 };
        e.count++;
        if (row.is_header) e.header_count++;
        map.set(row.person, e);
      }
      return [...map.values()].sort((a, b) => b.count - a.count);
    },

    async getSignedImageUrls(images, expiresIn = 3600): Promise<Record<number, string>> {
      if (!images.length) return {};
      const bkt = storage.bucket(getGcsBucket());
      const result: Record<number, string> = {};
      await Promise.all(
        images.map(async (img) => {
          const [url] = await bkt.file(img.storage_path).getSignedUrl({
            action: "read",
            expires: Date.now() + expiresIn * 1000,
          });
          result[img.img_num] = url;
        })
      );
      return result;
    },

    async searchTitles(projectId, query, limit = 25) {
      const { rows } = await db.query(
        "SELECT id, title FROM notes WHERE project_id = $1 AND title ILIKE $2 LIMIT $3",
        [projectId, `%${query}%`, limit]
      );
      return rows as { id: number; title: string }[];
    },

    async getEarliestNoteDate(projectId): Promise<string | null> {
      const { rows } = await db.query(
        "SELECT created_at FROM notes WHERE project_id = $1 ORDER BY created_at ASC LIMIT 1",
        [projectId]
      );
      if (!rows[0]) return null;
      const d = rows[0].created_at;
      return (d instanceof Date ? d.toISOString() : d).split("T")[0];
    },

    async getTaglines(projectId, tag, page = 1, pageSize = 25) {
      const { rows } = await db.query(
        `SELECT n.id, n.title, n.body, n.created_at
         FROM note_tags nt
         JOIN notes n ON n.id = nt.note_id
         WHERE n.project_id = $1 AND nt.tag = $2
         ORDER BY n.created_at DESC`,
        [projectId, tag]
      );

      const all: { noteId: number; noteTitle: string; noteCreatedAt: string; line: string }[] = [];
      const tagPattern = new RegExp(`#${tag}\\b`, "i");

      for (const note of rows) {
        const noteCreatedAt =
          note.created_at instanceof Date ? note.created_at.toISOString() : note.created_at;
        for (const line of (note.body as string).split("\n")) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("<!--")) continue;
          if (tagPattern.test(trimmed)) {
            all.push({ noteId: note.id, noteTitle: note.title, noteCreatedAt, line: trimmed });
          }
        }
      }

      const offset = (page - 1) * pageSize;
      return { lines: all.slice(offset, offset + pageSize), total: all.length };
    },

    async getRefTitles(ids, userId): Promise<Map<number, string>> {
      const map = new Map<number, string>();
      if (!ids.length) return map;
      const { rows } = await db.query(
        "SELECT id, title FROM notes WHERE id = ANY($1) AND user_id = $2",
        [ids, userId]
      );
      for (const row of rows) map.set(row.id as number, row.title as string);
      return map;
    },
  };
}

// ── Projects provider ─────────────────────────────────────────────────────────

function buildProjectsProvider(db: Pool): ProjectsDataProvider {
  return {
    async getActive(userId, projectId?): Promise<Project | null> {
      const cookieStore = await cookies();
      const effectiveId = projectId ?? cookieStore.get("active_project")?.value;

      if (effectiveId) {
        const { rows } = await db.query(
          "SELECT * FROM projects WHERE id = $1 AND user_id = $2",
          [effectiveId, userId]
        );
        if (rows[0]) return rows[0] as Project;
      }

      const { rows } = await db.query(
        "SELECT * FROM projects WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1",
        [userId]
      );
      return (rows[0] as Project) ?? null;
    },

    async getUserProjects(userId): Promise<Project[]> {
      const { rows } = await db.query(
        "SELECT * FROM projects WHERE user_id = $1 ORDER BY created_at ASC",
        [userId]
      );
      return rows as Project[];
    },

    async getUserSettings(userId): Promise<UserSettings> {
      const { rows } = await db.query(
        "SELECT * FROM user_settings WHERE user_id = $1",
        [userId]
      );
      return (rows[0] as UserSettings) ?? {
        notes_per_page: 25,
        autosave_enabled: true,
        autosave_interval: 30,
      };
    },

    async create(userId, name): Promise<Project> {
      const { rows } = await db.query(
        "INSERT INTO projects (user_id, name) VALUES ($1, $2) RETURNING *",
        [userId, name]
      );
      return rows[0] as Project;
    },

    async update(projectId, updates): Promise<void> {
      const sets: string[] = [];
      const vals: unknown[] = [];
      let i = 1;
      if (updates.name !== undefined) { sets.push(`name = $${i++}`); vals.push(updates.name); }
      if (updates.trigram_search !== undefined) { sets.push(`trigram_search = $${i++}`); vals.push(updates.trigram_search); }
      if (!sets.length) return;
      vals.push(projectId);
      await db.query(`UPDATE projects SET ${sets.join(", ")} WHERE id = $${i}`, vals);
    },

    async delete(projectId): Promise<void> {
      await db.query("DELETE FROM projects WHERE id = $1", [projectId]);
    },

    async checkOwner(projectId): Promise<string | null> {
      const { rows } = await db.query("SELECT user_id FROM projects WHERE id = $1", [projectId]);
      return rows[0]?.user_id ?? null;
    },

    async updateSettings(userId, updates): Promise<void> {
      const sets: string[] = [];
      const vals: unknown[] = [];
      let i = 1;
      if (updates.notes_per_page !== undefined) { sets.push(`notes_per_page = $${i++}`); vals.push(updates.notes_per_page); }
      if (updates.autosave_enabled !== undefined) { sets.push(`autosave_enabled = $${i++}`); vals.push(updates.autosave_enabled); }
      if (updates.autosave_interval !== undefined) { sets.push(`autosave_interval = $${i++}`); vals.push(updates.autosave_interval); }
      if (!sets.length) return;
      vals.push(userId);
      await db.query(`UPDATE user_settings SET ${sets.join(", ")} WHERE user_id = $${i}`, vals);
    },

    async clearNotes(projectId): Promise<void> {
      await db.query("DELETE FROM notes WHERE project_id = $1", [projectId]);
    },
  };
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createGcpProvider(): DataProvider {
  const db = getPool();
  const storage = new Storage();
  return {
    notes: buildNotesProvider(db, storage),
    projects: buildProjectsProvider(db),
  };
}
