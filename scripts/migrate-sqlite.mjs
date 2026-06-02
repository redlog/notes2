#!/usr/bin/env node
/**
 * Migration script: v1 local notes → Localnotes v2 SQLite (local mode)
 *
 * Walks a directory tree with the v1 structure:
 *   <root>/yyyy/mm/dd/<unixtimestamp>.md
 *   <root>/yyyy/mm/dd/<unixtimestamp>/<N>.png   ← optional images
 *
 * Each .md file may start with HTML comment headers:
 *   <!-- tags: tag1, tag2 -->
 *   <!-- attendees: person1, person2 -->
 *
 * These are stripped from the body and stored as first-class DB metadata.
 * The unix timestamp in the filename becomes the note's created_at date.
 *
 * Prerequisites:
 *   npm run build   (or just have better-sqlite3 installed: npm install)
 *   PROVIDER=sqlite in .env.local  (or set SQLITE_DB_PATH directly)
 *
 * Usage:
 *   node scripts/migrate-sqlite.mjs --dir /path/to/old/notes
 *
 * Optional flags:
 *   --project <name>   Target project name (default: "Default", created if absent)
 *   --dry-run          Print what would be imported without writing anything
 *   --verbose          Show per-image progress
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

// ── Env loader ────────────────────────────────────────────────────────────────

function loadEnvLocal() {
  const envPath = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
}

loadEnvLocal();

// ── Path helpers (mirrors lib/local-storage.ts) ───────────────────────────────

function getLocalDbPath() {
  return process.env.SQLITE_DB_PATH ?? path.join(process.cwd(), 'local-data', 'notes.db');
}

function getLocalImagesDir() {
  if (process.env.LOCAL_IMAGES_DIR) return process.env.LOCAL_IMAGES_DIR;
  const dbPath = process.env.SQLITE_DB_PATH;
  if (dbPath) return path.join(path.dirname(dbPath), 'images');
  return path.join(process.cwd(), 'local-data', 'images');
}

// ── CLI args ──────────────────────────────────────────────────────────────────

function arg(name) {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

function flag(name) {
  return process.argv.includes(`--${name}`);
}

const NOTES_DIR    = arg('dir');
const PROJECT_NAME = arg('project') ?? 'Default';
const DRY_RUN      = flag('dry-run');
const VERBOSE      = flag('verbose');

if (!NOTES_DIR) {
  console.error(`
Usage:
  node scripts/migrate-sqlite.mjs \\
    --dir /path/to/old/notes \\
    [--project "Project name"] \\
    [--dry-run] [--verbose]

Reads SQLITE_DB_PATH and LOCAL_IMAGES_DIR from .env.local (or env vars).
Defaults:
  SQLITE_DB_PATH   <cwd>/local-data/notes.db
  LOCAL_IMAGES_DIR next to the DB file in "images/"

Run with --dry-run first to verify note discovery before writing anything.
Running twice will create duplicate notes — start fresh or use --dry-run.
`);
  process.exit(1);
}

// ── Schema (mirrors lib/providers/sqlite/index.ts) ────────────────────────────

function initSchema(db) {
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

// ── Local user + project bootstrap ───────────────────────────────────────────

function ensureLocalUser(db) {
  const hasSettings = db.prepare('SELECT 1 FROM user_settings WHERE user_id = ?').get('local');
  if (!hasSettings) {
    db.prepare('INSERT INTO user_settings (user_id) VALUES (?)').run('local');
  }
}

function ensureProject(db, name) {
  const row = db.prepare('SELECT id FROM projects WHERE user_id = ? AND name = ?').get('local', name);
  if (row) return row.id;

  const id = crypto.randomUUID();
  db.prepare('INSERT INTO projects (id, user_id, name) VALUES (?, ?, ?)').run(id, 'local', name);
  console.log(`Created project "${name}" (${id})`);
  return id;
}

// ── v1 note parser ────────────────────────────────────────────────────────────

function parseV1Note(content) {
  const lines = content.split(/\r?\n/);
  const tags = [];
  const people = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const tagsMatch = line.match(/^<!--\s*tags:\s*(.*?)\s*-->$/i);
    const attendeesMatch = line.match(/^<!--\s*attendees:\s*(.*?)\s*-->$/i);

    if (tagsMatch) {
      tags.push(...tagsMatch[1].split(/[\s,]+/).map(t => t.replace(/^#+/, '')).filter(Boolean));
      i++;
    } else if (attendeesMatch) {
      people.push(...attendeesMatch[1].split(/[\s,]+/).map(p => p.replace(/^@+/, '')).filter(Boolean));
      i++;
    } else if (line.trim() === '') {
      i++;
    } else {
      break;
    }
  }

  while (i < lines.length && lines[i].trim() === '') i++;

  const body = lines.slice(i).join('\n').trimEnd();
  return { tags, people, body };
}

function extractTitle(body) {
  const m = body.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : '(untitled)';
}

function stripH1(body) {
  return body.replace(/^#[^\S\n]*[^\n]+\n?(\n)?/, '$1').trimStart();
}

// ── Directory walker ──────────────────────────────────────────────────────────

function walkNotes(root) {
  if (!fs.existsSync(root)) {
    console.error(`Directory not found: ${root}`);
    process.exit(1);
  }

  const results = [];

  function isNumericDir(name, len) {
    return name.length === len && /^\d+$/.test(name);
  }

  for (const year of fs.readdirSync(root).sort()) {
    if (!isNumericDir(year, 4)) continue;
    const yearDir = path.join(root, year);
    if (!fs.statSync(yearDir).isDirectory()) continue;

    for (const month of fs.readdirSync(yearDir).sort()) {
      if (!isNumericDir(month, 2)) continue;
      const monthDir = path.join(yearDir, month);
      if (!fs.statSync(monthDir).isDirectory()) continue;

      for (const day of fs.readdirSync(monthDir).sort()) {
        if (!isNumericDir(day, 2)) continue;
        const dayDir = path.join(monthDir, day);
        if (!fs.statSync(dayDir).isDirectory()) continue;

        for (const entry of fs.readdirSync(dayDir).sort()) {
          if (!entry.endsWith('.md')) continue;
          const base = entry.slice(0, -3);
          if (!/^\d+$/.test(base)) continue;

          results.push({
            mdPath: path.join(dayDir, entry),
            timestamp: parseInt(base, 10),
            imageDir: path.join(dayDir, base),
          });
        }
      }
    }
  }

  return results.sort((a, b) => a.timestamp - b.timestamp);
}

function collectImages(imageDir) {
  if (!fs.existsSync(imageDir)) return [];
  return fs.readdirSync(imageDir)
    .filter(f => /^\d+\.png$/i.test(f))
    .map(f => ({ imgNum: parseInt(f, 10), imgPath: path.join(imageDir, f) }))
    .sort((a, b) => a.imgNum - b.imgNum);
}

// ── Main ──────────────────────────────────────────────────────────────────────

function migrate() {
  const noteFiles = walkNotes(NOTES_DIR);

  if (noteFiles.length === 0) {
    console.log('No note files found. Check --dir points to the root with yyyy/mm/dd subdirs.');
    process.exit(0);
  }

  console.log(`Found ${noteFiles.length} notes in ${NOTES_DIR}`);
  if (DRY_RUN) {
    console.log('DRY RUN — nothing will be written.\n');
  } else {
    console.log(`Database: ${getLocalDbPath()}`);
    console.log(`Images:   ${getLocalImagesDir()}\n`);
  }

  if (DRY_RUN) {
    let totalImages = 0;
    for (const file of noteFiles) {
      const rel = path.relative(NOTES_DIR, file.mdPath);
      let content;
      try { content = fs.readFileSync(file.mdPath, 'utf-8'); }
      catch (err) { console.log(`  SKIP ${rel}: cannot read — ${err.message}`); continue; }

      const { tags, people, body } = parseV1Note(content);
      const title = extractTitle(body);
      const images = collectImages(file.imageDir);
      totalImages += images.length;
      const date = new Date(file.timestamp * 1000).toISOString().split('T')[0];
      console.log(`  ${date}  "${title}"  tags=[${tags.join(', ')}]  people=[${people.join(', ')}]  images=${images.length}`);
    }
    console.log(`\nTotal: ${noteFiles.length} notes, ${totalImages} images`);
    return;
  }

  // Set up DB
  const dbPath = getLocalDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  initSchema(db);
  ensureLocalUser(db);
  const projectId = ensureProject(db, PROJECT_NAME);

  const imagesDir = getLocalImagesDir();

  // Prepared statements
  const insertNote = db.prepare(
    'INSERT INTO notes (project_id, user_id, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const insertFts = db.prepare(
    'INSERT INTO notes_fts(rowid, title, body) VALUES (?, ?, ?)'
  );
  const insertTag = db.prepare(
    'INSERT OR IGNORE INTO note_tags (note_id, tag, is_header) VALUES (?, ?, ?)'
  );
  const insertPerson = db.prepare(
    'INSERT OR IGNORE INTO note_people (note_id, person, is_header) VALUES (?, ?, ?)'
  );
  const insertImage = db.prepare(
    'INSERT INTO note_images (note_id, img_num, storage_path) VALUES (?, ?, ?)'
  );

  // Wrap everything in a single transaction for speed
  const run = db.transaction(() => {
    let success = 0;
    let failed = 0;
    let imageCount = 0;
    let imagesFailed = 0;

    for (const file of noteFiles) {
      const rel = path.relative(NOTES_DIR, file.mdPath);
      let content;
      try { content = fs.readFileSync(file.mdPath, 'utf-8'); }
      catch (err) {
        console.error(`  FAIL ${rel}: cannot read — ${err.message}`);
        failed++;
        continue;
      }

      const { tags, people, body } = parseV1Note(content);
      const title = extractTitle(body);
      const cleanBody = stripH1(body);
      const createdAt = new Date(file.timestamp * 1000).toISOString();
      const images = collectImages(file.imageDir);

      // Insert note
      let noteId;
      try {
        const result = insertNote.run(projectId, 'local', title, cleanBody, createdAt, createdAt);
        noteId = result.lastInsertRowid;
      } catch (err) {
        console.error(`  FAIL ${rel}: DB insert — ${err.message}`);
        failed++;
        continue;
      }

      // FTS
      insertFts.run(noteId, title, cleanBody);

      // Tags
      for (const tag of tags) insertTag.run(noteId, tag, 1);

      // People
      for (const person of people) insertPerson.run(noteId, person, 1);

      // Images — copy file then record
      let imgOk = 0;
      for (const { imgNum, imgPath } of images) {
        const storagePath = `${noteId}/${imgNum}.png`;
        const destDir = path.join(imagesDir, String(noteId));
        const destPath = path.join(destDir, `${imgNum}.png`);

        try {
          fs.mkdirSync(destDir, { recursive: true });
          fs.copyFileSync(imgPath, destPath);
        } catch (err) {
          console.warn(`    WARN image ${path.relative(NOTES_DIR, imgPath)}: copy failed — ${err.message}`);
          imagesFailed++;
          continue;
        }

        try {
          insertImage.run(noteId, imgNum, storagePath);
        } catch (err) {
          console.warn(`    WARN image ${path.relative(NOTES_DIR, imgPath)}: DB record failed — ${err.message}`);
          imagesFailed++;
          continue;
        }

        imgOk++;
        if (VERBOSE) console.log(`    IMG  ${path.relative(NOTES_DIR, imgPath)} → ${storagePath}`);
      }

      imageCount += imgOk;

      const imgSuffix = images.length ? `  images=${imgOk}/${images.length}` : '';
      console.log(`  OK   ${rel} → note ${noteId}  tags=${tags.length}  people=${people.length}${imgSuffix}`);
      success++;
    }

    return { success, failed, imageCount, imagesFailed };
  });

  const { success, failed, imageCount, imagesFailed } = run();

  console.log('');
  console.log('Done.');
  console.log(`  Notes:  ${success} migrated, ${failed} failed`);
  console.log(`  Images: ${imageCount} copied${imagesFailed ? `, ${imagesFailed} failed` : ''}`);
  if (failed > 0 || imagesFailed > 0) process.exit(1);
}

migrate();
