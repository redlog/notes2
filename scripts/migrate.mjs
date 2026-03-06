#!/usr/bin/env node
/**
 * Migration script: v1 local notes → Localnotes v2 (Supabase)
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
 *   Add to .env.local:
 *     SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
 *
 * Usage:
 *   node scripts/migrate.mjs \
 *     --dir /path/to/old/notes \
 *     --project-id <uuid> \
 *     --user-id <uuid>
 *
 * Optional flags:
 *   --dry-run      Print what would be imported without writing anything
 *   --verbose      Show per-image progress
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

// ── Env loader ────────────────────────────────────────────────────────────────

function loadEnvLocal() {
  const envPath = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && process.env[m[1]] === undefined) {
      // Strip optional surrounding quotes
      process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
}

loadEnvLocal();

// ── CLI args ──────────────────────────────────────────────────────────────────

function arg(name) {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

function flag(name) {
  return process.argv.includes(`--${name}`);
}

const NOTES_DIR    = arg('dir');
const PROJECT_ID   = arg('project-id');
const USER_ID      = arg('user-id');
const DRY_RUN      = flag('dry-run');
const VERBOSE      = flag('verbose');

const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!NOTES_DIR || !PROJECT_ID || !USER_ID || !SUPABASE_URL || !SERVICE_KEY) {
  console.error(`
Usage:
  node scripts/migrate.mjs \\
    --dir /path/to/old/notes \\
    --project-id <uuid> \\
    --user-id <uuid> \\
    [--dry-run] [--verbose]

Required environment variables (in .env.local or shell):
  NEXT_PUBLIC_SUPABASE_URL       – your Supabase project URL
  SUPABASE_SERVICE_ROLE_KEY      – service role key (bypasses RLS)

Required arguments:
  --dir          Root directory of v1 notes (contains yyyy/ subdirs)
  --project-id   UUID of the target project in Localnotes v2
  --user-id      UUID of the owning user in Supabase Auth
`);
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

// ── v1 note parser ────────────────────────────────────────────────────────────

/**
 * Parse a v1 note file.
 *
 * The file may start with any number of these comment lines (interspersed
 * with blank lines):
 *   <!-- tags: tag1, tag2 -->
 *   <!-- attendees: person1, person2 -->
 *
 * Everything after those header lines becomes the clean body.
 *
 * @param {string} content Raw file contents
 * @returns {{ tags: string[], people: string[], body: string }}
 */
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
      tags.push(...tagsMatch[1].split(',').map(t => t.trim()).filter(Boolean));
      i++;
    } else if (attendeesMatch) {
      people.push(...attendeesMatch[1].split(',').map(p => p.trim()).filter(Boolean));
      i++;
    } else if (line.trim() === '') {
      // Blank line — could be between header comments or trailing after them;
      // keep scanning but do not commit to stopping yet.
      i++;
    } else {
      // First real content line — stop header scan.
      break;
    }
  }

  // Skip any additional leading blank lines before the body.
  while (i < lines.length && lines[i].trim() === '') i++;

  const body = lines.slice(i).join('\n').trimEnd();
  return { tags, people, body };
}

// ── Title extractor (mirrors lib/notes.ts) ────────────────────────────────────

function extractTitle(body) {
  const m = body.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : '(untitled)';
}

// ── Directory walker ──────────────────────────────────────────────────────────

/**
 * Walk <root>/yyyy/mm/dd/ directories and collect .md files whose basenames
 * are pure unix timestamps.
 *
 * @param {string} root
 * @returns {Array<{ mdPath: string, timestamp: number, imageDir: string }>}
 */
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
          if (!/^\d+$/.test(base)) continue; // must be all-digit unix timestamp

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

// ── Image collector ───────────────────────────────────────────────────────────

/**
 * Return sorted list of { imgNum, imgPath } for images in the image dir.
 * Only files named <digits>.png are included; numbers need not be consecutive.
 *
 * @param {string} imageDir
 * @returns {Array<{ imgNum: number, imgPath: string }>}
 */
function collectImages(imageDir) {
  if (!fs.existsSync(imageDir)) return [];
  return fs.readdirSync(imageDir)
    .filter(f => /^\d+\.png$/i.test(f))
    .map(f => ({ imgNum: parseInt(f, 10), imgPath: path.join(imageDir, f) }))
    .sort((a, b) => a.imgNum - b.imgNum);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function migrate() {
  const noteFiles = walkNotes(NOTES_DIR);

  if (noteFiles.length === 0) {
    console.log('No note files found. Check --dir points to the root yyyy/mm/dd tree.');
    process.exit(0);
  }

  console.log(`Found ${noteFiles.length} notes in ${NOTES_DIR}`);
  if (DRY_RUN) console.log('DRY RUN — nothing will be written.\n');
  console.log('');

  let success = 0;
  let failed = 0;
  let imageCount = 0;

  for (const file of noteFiles) {
    const rel = path.relative(NOTES_DIR, file.mdPath);
    let content;
    try {
      content = fs.readFileSync(file.mdPath, 'utf-8');
    } catch (err) {
      console.error(`  FAIL ${rel}: cannot read file — ${err.message}`);
      failed++;
      continue;
    }

    const { tags, people, body } = parseV1Note(content);
    const title = extractTitle(body);
    const createdAt = new Date(file.timestamp * 1000).toISOString();
    const images = collectImages(file.imageDir);

    if (DRY_RUN) {
      console.log(`  DRY  ${rel}`);
      console.log(`       title="${title}"  tags=[${tags.join(', ')}]  people=[${people.join(', ')}]  images=${images.length}`);
      success++;
      continue;
    }

    // ── Insert note ────────────────────────────────────────────────────────
    const { data: noteData, error: noteErr } = await supabase
      .from('notes')
      .insert({
        project_id: PROJECT_ID,
        user_id: USER_ID,
        title,
        body,
        created_at: createdAt,
        updated_at: createdAt,
      })
      .select('id')
      .single();

    if (noteErr || !noteData) {
      console.error(`  FAIL ${rel}: DB insert failed — ${noteErr?.message}`);
      failed++;
      continue;
    }

    const noteId = noteData.id;

    // ── Tags ───────────────────────────────────────────────────────────────
    if (tags.length) {
      const { error: tagErr } = await supabase.from('note_tags').insert(
        tags.map(tag => ({ note_id: noteId, tag, is_header: true }))
      );
      if (tagErr) console.warn(`    WARN ${rel}: tags insert — ${tagErr.message}`);
    }

    // ── People ─────────────────────────────────────────────────────────────
    if (people.length) {
      const { error: peopleErr } = await supabase.from('note_people').insert(
        people.map(person => ({ note_id: noteId, person, is_header: true }))
      );
      if (peopleErr) console.warn(`    WARN ${rel}: people insert — ${peopleErr.message}`);
    }

    // ── Images ─────────────────────────────────────────────────────────────
    let imgOk = 0;
    for (const { imgNum, imgPath } of images) {
      const storagePath = `${USER_ID}/${noteId}/${imgNum}.png`;
      let imgData;
      try {
        imgData = fs.readFileSync(imgPath);
      } catch (err) {
        console.warn(`    WARN image ${imgPath}: cannot read — ${err.message}`);
        continue;
      }

      const { error: uploadErr } = await supabase.storage
        .from('note-images')
        .upload(storagePath, imgData, { contentType: 'image/png' });

      if (uploadErr) {
        console.warn(`    WARN image ${imgPath}: upload failed — ${uploadErr.message}`);
        continue;
      }

      const { error: imgRowErr } = await supabase.from('note_images').insert({
        note_id: noteId,
        img_num: imgNum,
        storage_path: storagePath,
      });

      if (imgRowErr) {
        console.warn(`    WARN image ${imgPath}: DB row failed — ${imgRowErr.message}`);
        continue;
      }

      imgOk++;
      if (VERBOSE) console.log(`    IMG  ${path.relative(NOTES_DIR, imgPath)} → ${storagePath}`);
    }

    imageCount += imgOk;

    const imgSuffix = images.length
      ? `  images=${imgOk}/${images.length}`
      : '';
    console.log(`  OK   ${rel} → note ${noteId}  tags=${tags.length}  people=${people.length}${imgSuffix}`);
    success++;
  }

  console.log('');
  console.log(`Done.`);
  console.log(`  Notes:  ${success} migrated, ${failed} failed`);
  if (!DRY_RUN) console.log(`  Images: ${imageCount} uploaded`);
  if (failed > 0) process.exit(1);
}

migrate().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
