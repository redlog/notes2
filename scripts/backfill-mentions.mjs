#!/usr/bin/env node
/**
 * Backfills `@person` and `#tag` mentions from note bodies.
 *
 * Why this is needed: `scripts/migrate-sqlite.mjs` imports v1 metadata from the
 * `<!-- tags: -->` / `<!-- attendees: -->` header comments and stores it with
 * is_header = 1. It never reads the body. The app, by contrast, re-derives
 * mentions from the body on every save (`upsertTagsAndPeople`) and stores them
 * with is_header = 0. So a migrated note that has not been saved since carries
 * only its v1 header metadata, and every `@name` written in its body is
 * invisible to the `@` and `#` filters.
 *
 * This adds the missing rows, exactly as a save would.
 *
 * Faithful to `upsertTagsAndPeople` in one detail that matters: a mention which
 * is *already* a header person is stored once, as is_header = 1, not twice.
 * The UNIQUE constraint is (note_id, person, is_header), so it would happily
 * accept a second row with is_header = 0 — and `getPersonCounts()` counts rows,
 * so that would inflate the sidebar count for everyone already in a header.
 * The check is therefore for a row with *any* is_header, not INSERT OR IGNORE.
 *
 * Tags and people are deliberately absent from the search index and the
 * embedding text (`buildContextPrefix` uses only title and date), so nothing
 * needs re-indexing or re-embedding afterwards.
 *
 * Usage:
 *   node scripts/backfill-mentions.mjs                  # dry run, never writes
 *   node scripts/backfill-mentions.mjs --apply          # back up, then insert
 *   node scripts/backfill-mentions.mjs --skip-embedded  # ignore email/URL matches
 *
 * Stop the app before running with --apply.
 */

import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

const APPLY = process.argv.includes("--apply");
const SKIP_EMBEDDED = process.argv.includes("--skip-embedded");

function dbPath() {
  const explicit = process.argv.find((a) => a.startsWith("--db="));
  if (explicit) return explicit.slice(5);
  return process.env.SQLITE_DB_PATH ?? path.join(process.cwd(), "local-data", "notes.db");
}

const c = {
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};
const heading = (s) => console.log(`\n${c.bold(s)}`);

// Mirrors lib/notes.ts. The point is to store what the app itself would store.
const PERSON_RE = /@([a-z0-9_-]+)/g;
const TAG_RE = /#([a-z0-9_-]+)/g;

/**
 * True when the sigil is glued to the end of a word — `foo@bar.com`,
 * `example.com/page#section`. The app's regexes match these too, so they are
 * not excluded by default; a save would put them straight back. They are worth
 * separating in the report, because a backfill applies them in bulk to an
 * archive nobody is reading line by line.
 */
function isEmbedded(body, index) {
  return index > 0 && !/\s/.test(body[index - 1]);
}

function collect(body, re) {
  const out = new Map(); // value -> embedded?
  for (const m of body.matchAll(re)) {
    const embedded = isEmbedded(body, m.index);
    // A name written properly at least once counts as a real mention.
    out.set(m[1], (out.get(m[1]) ?? true) && embedded);
  }
  return out;
}

function plan(db) {
  const notes = db.prepare("SELECT id, title, body FROM notes").all();
  const people = db.prepare("SELECT note_id, person FROM note_people").all();
  const tags = db.prepare("SELECT note_id, tag FROM note_tags").all();

  // Any is_header — see the header comment.
  const hasPerson = new Set(people.map((r) => `${r.note_id}|${r.person}`));
  const hasTag = new Set(tags.map((r) => `${r.note_id}|${r.tag}`));

  const addPeople = [];
  const addTags = [];
  const notesTouched = new Set();

  for (const n of notes) {
    const body = String(n.body ?? "");
    for (const [person, embedded] of collect(body, PERSON_RE)) {
      if (hasPerson.has(`${n.id}|${person}`)) continue;
      addPeople.push({ note_id: n.id, title: n.title, person, embedded });
      if (!(embedded && SKIP_EMBEDDED)) notesTouched.add(n.id);
    }
    for (const [tag, embedded] of collect(body, TAG_RE)) {
      if (hasTag.has(`${n.id}|${tag}`)) continue;
      addTags.push({ note_id: n.id, title: n.title, tag, embedded });
      if (!(embedded && SKIP_EMBEDDED)) notesTouched.add(n.id);
    }
  }
  return { addPeople, addTags, notesTouched, totalNotes: notes.length };
}

function tally(rows, key) {
  const counts = new Map();
  for (const r of rows) counts.set(r[key], (counts.get(r[key]) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function summarise(label, rows, key, sigil) {
  const wanted = rows.filter((r) => !r.embedded);
  const embedded = rows.filter((r) => r.embedded);
  console.log(`  ${c.bold(label)}: ${rows.length} row(s), ${tally(rows, key).length} distinct`);

  const list = tally(wanted, key);
  for (const [value, n] of list.slice(0, 30)) {
    console.log(`    ${sigil}${value.padEnd(28)} ${String(n).padStart(5)} note(s)`);
  }
  if (list.length > 30) console.log(c.dim(`    … and ${list.length - 30} more`));

  if (embedded.length) {
    const e = tally(embedded, key);
    console.log(
      `\n    ${c.yellow(`${embedded.length} row(s) come from text like an email address or URL:`)}`
    );
    for (const [value, n] of e.slice(0, 10)) {
      console.log(c.dim(`      ${sigil}${value.padEnd(26)} ${String(n).padStart(5)} note(s)`));
    }
    if (e.length > 10) console.log(c.dim(`      … and ${e.length - 10} more`));
    console.log(
      c.dim(
        SKIP_EMBEDDED
          ? "      skipped (--skip-embedded). A future save of those notes will add them back."
          : "      included, because that is what the app stores. --skip-embedded leaves them out."
      )
    );
  }
}

function backup(file) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = `${file}.${stamp}.bak`;
  fs.copyFileSync(file, dest);
  for (const suffix of ["-wal", "-shm"]) {
    if (fs.existsSync(file + suffix)) fs.copyFileSync(file + suffix, dest + suffix);
  }
  return dest;
}

function main() {
  const file = dbPath();
  if (!fs.existsSync(file)) {
    console.error(c.red(`No database at ${file}`));
    process.exit(1);
  }

  console.log(c.bold(`${APPLY ? "Backfilling" : "Planning backfill for"} ${file}`));

  const saved = APPLY ? backup(file) : null;
  if (saved) console.log(c.dim(`  backed up to ${saved}`));

  const db = new Database(file, { readonly: !APPLY });
  const { addPeople, addTags, notesTouched, totalNotes } = plan(db);

  const keep = (rows) => (SKIP_EMBEDDED ? rows.filter((r) => !r.embedded) : rows);
  const doPeople = keep(addPeople);
  const doTags = keep(addTags);

  heading("What is missing");
  if (!addPeople.length && !addTags.length) {
    console.log(`  ${c.green("nothing — every mention in every note body is already recorded")}`);
    db.close();
    return;
  }
  summarise("People", addPeople, "person", "@");
  console.log();
  summarise("Tags", addTags, "tag", "#");

  console.log(
    `\n  ${notesTouched.size} of ${totalNotes} notes affected; ` +
      `${doPeople.length + doTags.length} row(s) to add.`
  );

  const dump = `${file}.backfill-plan.json`;
  fs.writeFileSync(dump, JSON.stringify({ people: doPeople, tags: doTags }, null, 2));
  console.log(c.dim(`  Full plan, note by note, written to ${dump}`));

  if (!APPLY) {
    heading("Dry run");
    console.log("  Nothing was written. Review the plan above, then re-run with");
    console.log(`  ${c.bold("--apply")} to insert these rows (stop the app first).`);
    db.close();
    return;
  }

  heading("Applying");
  const insertPerson = db.prepare(
    "INSERT OR IGNORE INTO note_people (note_id, person, is_header) VALUES (?, ?, 0)"
  );
  const insertTag = db.prepare(
    "INSERT OR IGNORE INTO note_tags (note_id, tag, is_header) VALUES (?, ?, 0)"
  );
  const before = {
    people: db.prepare("SELECT count(*) c FROM note_people").get().c,
    tags: db.prepare("SELECT count(*) c FROM note_tags").get().c,
  };

  db.transaction(() => {
    for (const r of doPeople) insertPerson.run(r.note_id, r.person);
    for (const r of doTags) insertTag.run(r.note_id, r.tag);
  })();

  const after = {
    people: db.prepare("SELECT count(*) c FROM note_people").get().c,
    tags: db.prepare("SELECT count(*) c FROM note_tags").get().c,
  };
  console.log(`  note_people ${before.people} → ${after.people}  (+${after.people - before.people})`);
  console.log(`  note_tags   ${before.tags} → ${after.tags}  (+${after.tags - before.tags})`);

  heading("Verifying");
  const remaining = plan(db);
  const left = keep(remaining.addPeople).length + keep(remaining.addTags).length;
  const integrity = db.prepare("PRAGMA integrity_check").all()[0].integrity_check;
  console.log(`  integrity_check: ${integrity === "ok" ? c.green("ok") : c.red(integrity)}`);
  console.log(
    left === 0
      ? `  mentions: ${c.green("every body mention is now recorded")}`
      : `  mentions: ${c.red(`${left} still missing`)}`
  );

  const expected = doPeople.length + doTags.length;
  const actual = after.people - before.people + (after.tags - before.tags);
  if (actual !== expected) {
    console.log(
      c.yellow(`  ${expected - actual} row(s) were already present and skipped by OR IGNORE`)
    );
  }
  db.close();

  heading("Done");
  console.log(`  ${c.green("Backfilled.")} Restart the app — @ and # filters now find these notes.`);
  console.log(c.dim(`  Previous database kept at ${saved}`));
}

main();
