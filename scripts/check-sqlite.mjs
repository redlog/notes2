#!/usr/bin/env node
/**
 * Integrity check and repair for the local SQLite database.
 *
 * Motivation: a damaged b-tree page inside a *single* index shows up as a
 * puzzlingly narrow bug rather than an obviously broken database. Every query
 * whose plan avoids that index keeps working, so the app looks healthy — the
 * note list renders, the sidebar counts are right — and only the one query
 * that walks the damaged page fails, with
 *
 *     SqliteError: database disk image is malformed   (code SQLITE_CORRUPT)
 *
 * The person filter is the clearest example. `notes.list()` resolves `@name`
 * with `SELECT note_id FROM note_people WHERE person = ?`, which is the only
 * query in a page load that uses `note_ppl_prsn_idx`; the sidebar's
 * `getPersonCounts()` reads the same table through
 * `sqlite_autoindex_note_people_1` instead. So damage confined to
 * `note_ppl_prsn_idx` breaks filtering by the handful of people whose keys sit
 * on the damaged page, and nothing else.
 *
 * Usage:
 *   node scripts/check-sqlite.mjs            # diagnose only, never writes
 *   node scripts/check-sqlite.mjs --repair   # back up, then rebuild indexes
 *
 * Stop the app before running with --repair.
 */

import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

const REPAIR = process.argv.includes("--repair");

function dbPath() {
  const explicit = process.argv.find((a) => a.startsWith("--db="));
  if (explicit) return explicit.slice(5);
  return process.env.SQLITE_DB_PATH ?? path.join(process.cwd(), "local-data", "notes.db");
}

// ── Output helpers ────────────────────────────────────────────────────────────

const c = {
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

function heading(s) {
  console.log(`\n${c.bold(s)}`);
}

/** Quotes a path for a shell command. Paths with spaces are the norm on Windows. */
function q(p) {
  return /[\s&()]/.test(p) ? `"${p}"` : p;
}

// ── Checks ────────────────────────────────────────────────────────────────────

/**
 * `quick_check` rather than `integrity_check` on purpose. On damage severe
 * enough to break page parsing, `integrity_check` raises SQLITE_CORRUPT and
 * tells you nothing; `quick_check` keeps going and names the object — it is the
 * one that reports "wrong # of entries in index note_ppl_prsn_idx". It skips
 * the index-content comparison that `integrity_check` does, so
 * `integrity_check` still runs afterwards for the extra detail when it can.
 */
function runCheck(db, pragma) {
  try {
    const rows = db.prepare(`PRAGMA ${pragma}`).all().map((r) => r[pragma]);
    if (rows.length === 1 && rows[0] === "ok") return { ok: true, problems: [] };
    // A single row can carry several newline-separated complaints.
    return { ok: false, problems: rows.flatMap((r) => String(r).split("\n")) };
  } catch (err) {
    if (err.code === "SQLITE_CORRUPT") {
      return { ok: false, problems: [`${pragma} aborted: ${err.message}`], threw: true };
    }
    throw err;
  }
}

/**
 * Names the damaged objects, which is the difference between "REINDEX fixes
 * this" and "you need to recover the file". Two sources: a complaint may name
 * an index outright ("wrong # of entries in index X"), or locate the damage as
 * "Tree <rootpage> page <n>" — and that root page number is exactly what
 * `sqlite_schema.rootpage` holds.
 */
function damagedObjects(db, problems) {
  let roots = [];
  try {
    roots = db.prepare("SELECT name, type, rootpage FROM sqlite_schema WHERE rootpage > 0").all();
  } catch {
    return new Map();
  }
  const byRoot = new Map(roots.map((r) => [r.rootpage, r]));
  const byName = new Map(roots.map((r) => [r.name, r]));
  const found = new Map();

  const note = (obj) => {
    if (!obj) return;
    const entry = found.get(obj.name) ?? { ...obj, count: 0 };
    entry.count++;
    found.set(obj.name, entry);
  };

  for (const p of problems) {
    const tree = /Tree (\d+)/.exec(p);
    if (tree) note(byRoot.get(Number(tree[1])));
    for (const m of p.matchAll(/index ([A-Za-z_][A-Za-z0-9_]*)/g)) note(byName.get(m[1]));
  }
  return found;
}

/**
 * The decisive table-vs-index test: `NOT INDEXED` forces a full scan of the
 * table's own b-tree, bypassing every index on it. If that scan succeeds, no
 * row data is lost and rebuilding the indexes is enough.
 */
function tableScans(db) {
  const tables = db
    .prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all()
    .map((r) => r.name);

  const results = [];
  for (const name of tables) {
    try {
      // Virtual tables (notes_fts) reject NOT INDEXED; they are checked
      // separately by the FTS5 integrity-check.
      const rows = db.prepare(`SELECT count(*) AS c FROM "${name}" NOT INDEXED`).get();
      results.push({ name, ok: true, rows: rows.c });
    } catch (err) {
      if (/no query solution|not indexed/i.test(err.message)) {
        results.push({ name, ok: true, skipped: true });
      } else {
        results.push({ name, ok: false, error: `${err.code}: ${err.message}` });
      }
    }
  }
  return results;
}

function ftsIntegrity(db) {
  try {
    db.exec("INSERT INTO notes_fts(notes_fts) VALUES('integrity-check')");
    return { ok: true };
  } catch (err) {
    if (/no such table/.test(err.message)) return { skipped: true };
    return { ok: false, message: `${err.code}: ${err.message}` };
  }
}

/**
 * Finds rows that violate a UNIQUE constraint.
 *
 * "non-unique entry in index sqlite_autoindex_note_tags_1" means the table
 * holds two rows the constraint says cannot both exist. That matters beyond
 * tidiness: a rebuild inserts these rows into a *fresh* table that enforces the
 * constraint, so an undetected duplicate aborts the copy. Found up front, it
 * can be reported and skipped deliberately instead.
 *
 * The grouping is done with NOT INDEXED so the damaged index cannot hide the
 * very duplicates being looked for.
 */
function duplicateRows(db) {
  const tables = db
    .prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all()
    .map((r) => r.name);

  const found = [];
  for (const table of tables) {
    let uniques;
    try {
      uniques = db
        .prepare(`SELECT name FROM pragma_index_list('${table}') WHERE "unique" = 1`)
        .all()
        .map((r) => r.name);
    } catch {
      continue;
    }
    for (const index of uniques) {
      let cols;
      try {
        cols = db
          .prepare(`SELECT name FROM pragma_index_info('${index}')`)
          .all()
          .map((r) => r.name)
          .filter((n) => n !== null);
      } catch {
        continue;
      }
      if (!cols.length) continue;
      const list = cols.map((n) => `"${n}"`).join(", ");
      try {
        const dupes = db
          .prepare(
            `SELECT ${list}, count(*) AS n FROM "${table}" NOT INDEXED
              GROUP BY ${list} HAVING n > 1`
          )
          .all();
        for (const d of dupes) {
          found.push({ table, index, columns: cols, values: d, extra: d.n - 1 });
        }
      } catch {
        // A scan that cannot complete is already reported by the table scans.
      }
    }
  }
  return found;
}

/**
 * Finds notes whose body mentions a `@person` or `#tag` that is missing from
 * note_people / note_tags.
 *
 * This is the one check that looks for damage a repair cannot undo. Saving a
 * note deletes its tags and people and re-inserts them without a transaction
 * (see docs/sqlite-corruption.md), so a save that tripped a damaged index left
 * the delete committed and the re-insert unfinished. Those rows are simply
 * gone; rebuilding the file cannot bring them back.
 *
 * The app derives mention metadata from the body on every save, so the body is
 * an independent record of what should be there. The regexes mirror
 * lib/notes.ts exactly — the question is whether the database agrees with what
 * the app itself would have stored.
 *
 * Only mentions are checkable. People added through the editor's header field
 * rather than written into the body leave no trace in the body, so a lost one
 * is not detectable this way.
 */
function mentionConsistency(db) {
  const PERSON_RE = /@([a-z0-9_-]+)/g; // mirrors lib/notes.ts
  const TAG_RE = /#([a-z0-9_-]+)/g;

  let notes, people, tags;
  try {
    notes = db.prepare("SELECT id, title, body FROM notes NOT INDEXED").all();
    people = db.prepare("SELECT note_id, person, is_header FROM note_people NOT INDEXED").all();
    tags = db.prepare("SELECT note_id, tag, is_header FROM note_tags NOT INDEXED").all();
  } catch (err) {
    return { error: `${err.code}: ${err.message}` };
  }

  const has = new Set(people.map((r) => `${r.note_id}|${r.person}`));
  const hasTag = new Set(tags.map((r) => `${r.note_id}|${r.tag}`));

  // Which notes the *save path* has ever processed — the difference between the
  // two causes below. scripts/migrate-sqlite.mjs reads v1's
  // `<!-- attendees: -->` header comment and stores those with is_header = 1;
  // it never looks at body mentions. Only upsertTagsAndPeople() writes
  // is_header = 0. So a note carrying no is_header = 0 row at all has never
  // been saved through the app, and its missing mentions were never recorded
  // rather than lost.
  const saved = new Set([
    ...people.filter((r) => r.is_header === 0).map((r) => r.note_id),
    ...tags.filter((r) => r.is_header === 0).map((r) => r.note_id),
  ]);

  const neverRecorded = [];
  const lost = [];
  for (const n of notes) {
    const body = String(n.body ?? "");
    const wantPeople = [...new Set([...body.matchAll(PERSON_RE)].map((m) => m[1]))];
    const wantTags = [...new Set([...body.matchAll(TAG_RE)].map((m) => m[1]))];
    const missPeople = wantPeople.filter((p) => !has.has(`${n.id}|${p}`));
    const missTags = wantTags.filter((t) => !hasTag.has(`${n.id}|${t}`));
    if (!missPeople.length && !missTags.length) continue;
    const entry = { id: n.id, title: n.title, people: missPeople, tags: missTags };
    (saved.has(n.id) ? lost : neverRecorded).push(entry);
  }
  return { neverRecorded, lost };
}

/**
 * Runs the real filter query for every distinct person and tag. This is what
 * turns "something is corrupt" into "filtering by @Frank is what breaks", and
 * it catches silent damage too: a damaged index page can also make SQLite
 * return *fewer* rows rather than raise, so the row count is compared against
 * the same count read without the index.
 */
function probeFilters(db) {
  const results = { person: [], tag: [] };

  const probe = (kind, table, column, indexName) => {
    let values;
    try {
      // NOT INDEXED matters here: without it SQLite serves the DISTINCT from
      // the very index under test, so a damaged index takes the enumeration
      // down with it and every filter is left unprobed.
      values = db
        .prepare(`SELECT DISTINCT ${column} AS v FROM ${table} NOT INDEXED ORDER BY v`)
        .all();
    } catch (err) {
      results[kind].push({ value: "(could not enumerate)", error: `${err.code}: ${err.message}` });
      return;
    }

    // Same query the app runs, and the same query with the index suppressed.
    // `+column` in the WHERE clause makes the term unusable by an index, so a
    // mismatch between the two counts means the index is lying.
    const viaIndex = db.prepare(`SELECT note_id FROM ${table} WHERE ${column} = ?`);
    const viaScan = db.prepare(`SELECT note_id FROM ${table} WHERE +${column} = ?`);

    for (const { v } of values) {
      let indexed = null;
      let scanned = null;
      let error = null;
      try {
        indexed = viaIndex.all(v).length;
      } catch (err) {
        error = `${err.code}: ${err.message}`;
      }
      try {
        scanned = viaScan.all(v).length;
      } catch (err) {
        error = error ?? `${err.code}: ${err.message} (table scan)`;
      }
      if (error) {
        results[kind].push({ value: v, error, index: indexName });
      } else if (indexed !== scanned) {
        results[kind].push({
          value: v,
          error: `index returned ${indexed} rows, table scan returned ${scanned}`,
          index: indexName,
          silent: true,
        });
      }
    }
  };

  probe("person", "note_people", "person", "note_ppl_prsn_idx");
  probe("tag", "note_tags", "tag", "note_tags_tag_idx");
  return results;
}

// ── Repair ────────────────────────────────────────────────────────────────────

function backup(file) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = `${file}.${stamp}.bak`;
  fs.copyFileSync(file, dest);
  for (const suffix of ["-wal", "-shm"]) {
    if (fs.existsSync(file + suffix)) fs.copyFileSync(file + suffix, dest + suffix);
  }
  return dest;
}

/**
 * Rebuilds the database into a fresh file.
 *
 * REINDEX, DROP INDEX, and VACUUM all fail on a database with a damaged index
 * page, because every one of them has to walk that index to free its pages
 * before it can rebuild — the repair trips over the very thing it is repairing.
 * So nothing is repaired in place. Instead the tables are read with NOT INDEXED
 * (which touches no index at all) and copied into a new file, where the indexes
 * are then built from scratch.
 *
 * The FTS5 table is repopulated from `notes` rather than copied, so it comes
 * out consistent with the note bodies by construction.
 */
function rebuildInto(src, dest) {
  for (const suffix of ["", "-wal", "-shm"]) {
    if (fs.existsSync(dest + suffix)) fs.unlinkSync(dest + suffix);
  }

  const from = new Database(src, { readonly: true });
  const to = new Database(dest);
  to.pragma("journal_mode = WAL");
  to.pragma("foreign_keys = OFF"); // re-enabled after the copy

  const schema = from
    .prepare("SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE sql IS NOT NULL")
    .all();

  // Shadow tables belong to the virtual tables that create them, and the
  // sqlite_* tables are maintained by SQLite itself.
  const virtualNames = schema.filter((o) => /^CREATE VIRTUAL TABLE/i.test(o.sql)).map((o) => o.name);
  const isShadow = (name) =>
    virtualNames.some((v) => name.startsWith(v + "_")) || name.startsWith("sqlite_");

  const pick = (type, pred = () => true) =>
    schema.filter((o) => o.type === type && !isShadow(o.name) && pred(o));

  const tables = pick("table", (o) => !/^CREATE VIRTUAL TABLE/i.test(o.sql));
  const virtuals = pick("table", (o) => /^CREATE VIRTUAL TABLE/i.test(o.sql));
  const indexes = pick("index");
  const triggers = pick("trigger");
  const views = pick("view");

  const copied = [];
  const rejected = [];
  const renumbered = [];

  for (const t of [...tables, ...virtuals]) to.exec(t.sql);

  // Corruption can damage a rowid itself, which collides a surrogate primary
  // key on the way back in. Such a row is not redundant — {id: 1377, note_id:
  // 1649, person: "jon"} is a real association that a naive rebuild would drop
  // on the floor. Where the id is a surrogate that nothing points at, the row
  // is re-inserted without it and SQLite assigns a fresh one.
  //
  // `notes.id` is emphatically not such a key: image directories on disk are
  // named after it and `note:<id>` links reference it, so a note whose id
  // collides is reported rather than renumbered.
  const referenced = new Set();
  for (const t of tables) {
    for (const fk of from.prepare(`PRAGMA foreign_key_list("${t.name}")`).all()) {
      referenced.add(fk.table);
    }
  }
  const surrogateKey = (table) => {
    if (referenced.has(table)) return null;
    const info = from.prepare(`SELECT name, type, pk FROM pragma_table_info('${table}')`).all();
    const pk = info.filter((col) => col.pk > 0);
    if (pk.length !== 1) return null;
    return /^INTEGER$/i.test(pk[0].type) ? pk[0].name : null;
  };

  to.transaction(() => {
    for (const t of tables) {
      const cols = from
        .prepare(`SELECT name FROM pragma_table_info('${t.name}')`)
        .all()
        .map((r) => `"${r.name}"`);
      const rows = from.prepare(`SELECT ${cols.join(",")} FROM "${t.name}" NOT INDEXED`).all();
      const insert = to.prepare(
        `INSERT INTO "${t.name}" (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`
      );
      const values = (row) => cols.map((c) => row[c.slice(1, -1)]);

      let inserted = 0;
      try {
        for (const row of rows) {
          insert.run(values(row));
          inserted++;
        }
      } catch {
        // A damaged database can hold rows that violate its own constraints —
        // a duplicate the UNIQUE index failed to catch, say. The destination
        // enforces them, so one bad row would otherwise cost the whole table.
        // Start over row by row and record exactly what will not go in, rather
        // than dropping it silently or giving up on the table.
        to.exec(`DELETE FROM "${t.name}"`);
        inserted = 0;

        const key = surrogateKey(t.name);
        const keptCols = key ? cols.filter((c) => c.slice(1, -1) !== key) : null;
        const insertNoKey = keptCols
          ? to.prepare(
              `INSERT INTO "${t.name}" (${keptCols.join(",")}) ` +
                `VALUES (${keptCols.map(() => "?").join(",")})`
            )
          : null;

        for (const row of rows) {
          try {
            insert.run(values(row));
            inserted++;
            continue;
          } catch (err) {
            // Only a clash on the surrogate key itself is safe to renumber; a
            // violated natural key means the row really is a duplicate.
            if (insertNoKey && err.code === "SQLITE_CONSTRAINT_PRIMARYKEY") {
              try {
                insertNoKey.run(keptCols.map((c) => row[c.slice(1, -1)]));
                inserted++;
                renumbered.push({ table: t.name, was: row[key], row });
                continue;
              } catch (err2) {
                rejected.push({ table: t.name, reason: `${err2.code}: ${err2.message}`, row });
                continue;
              }
            }
            rejected.push({ table: t.name, reason: `${err.code}: ${err.message}`, row });
          }
        }
      }
      copied.push({ name: t.name, rows: inserted, source: rows.length });
    }

    // AUTOINCREMENT high-water marks, so reused ids cannot collide with the
    // image directories on disk that are named after old note ids.
    try {
      const seq = from.prepare("SELECT name, seq FROM sqlite_sequence").all();
      const upsert = to.prepare(
        "INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?) " +
          "ON CONFLICT(name) DO UPDATE SET seq = excluded.seq"
      );
      for (const s of seq) upsert.run(s.name, s.seq);
    } catch {
      // No AUTOINCREMENT table in this database — nothing to carry over.
    }
  })();

  for (const i of indexes) to.exec(i.sql);
  for (const v of views) to.exec(v.sql);
  for (const t of triggers) to.exec(t.sql);

  // FTS is rebuilt from the notes themselves, not copied.
  if (virtualNames.includes("notes_fts")) {
    to.exec("DELETE FROM notes_fts");
    to.exec("INSERT INTO notes_fts(rowid, title, body) SELECT id, title, body FROM notes");
  }

  to.pragma("foreign_keys = ON");
  to.exec("ANALYZE");
  to.pragma("wal_checkpoint(TRUNCATE)");
  from.close();
  to.close();
  return { copied, rejected, renumbered };
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
  const file = dbPath();
  if (!fs.existsSync(file)) {
    console.error(c.red(`No database at ${file}`));
    console.error(c.dim("Set SQLITE_DB_PATH or pass --db=/path/to/notes.db"));
    process.exit(1);
  }

  console.log(c.bold(`Checking ${file}`));
  console.log(c.dim(`  ${(fs.statSync(file).size / 1024 / 1024).toFixed(1)} MB`));

  // --repair opens the database read-write (the FTS5 integrity-check needs it),
  // so the backup is taken before anything can touch the file at all — not
  // later, once a repair is known to be needed.
  const saved = REPAIR ? backup(file) : null;
  if (saved) console.log(c.dim(`  backed up to ${saved}`));

  const db = new Database(file, { readonly: !REPAIR });

  heading("PRAGMA quick_check / integrity_check");
  const quick = runCheck(db, "quick_check");
  const full = runCheck(db, "integrity_check");
  const problems = [...quick.problems, ...full.problems];
  const owners = damagedObjects(db, problems);

  if (quick.ok && full.ok) {
    console.log(`  ${c.green("ok")}`);
  } else {
    const shown = [...new Set(problems.filter((p) => p !== "*** in database main ***"))];
    for (const line of shown.slice(0, 10)) console.log(`  ${c.red(line)}`);
    if (shown.length > 10) console.log(c.dim(`  … and ${shown.length - 10} more`));
    if (owners.size) {
      console.log("\n  Damage is in:");
      for (const o of owners.values()) {
        const label = o.type === "index" ? c.yellow("index") : c.red("TABLE");
        console.log(`    ${label} ${o.name}`);
      }
    }
  }

  heading("Table scans (bypassing every index)");
  const scans = tableScans(db);
  const brokenTables = scans.filter((s) => !s.ok);
  if (brokenTables.length === 0) {
    console.log(`  ${c.green(`all ${scans.length} tables scan cleanly`)}`);
    console.log(c.dim("  → row data is intact"));
  } else {
    for (const s of brokenTables) console.log(`  ${c.red(`${s.name}: ${s.error}`)}`);
  }

  heading("PRAGMA foreign_key_check");
  try {
    const fk = db.prepare("PRAGMA foreign_key_check").all();
    if (fk.length === 0) console.log(`  ${c.green("ok")}`);
    else {
      console.log(`  ${c.red(`${fk.length} violation(s)`)}`);
      for (const row of fk.slice(0, 5)) console.log(`    ${JSON.stringify(row)}`);
    }
  } catch (err) {
    console.log(`  ${c.red(`${err.code}: ${err.message}`)}`);
  }

  heading("FTS5 index (notes_fts)");
  if (REPAIR) {
    const fts = ftsIntegrity(db);
    if (fts.skipped) console.log(c.dim("  no notes_fts table — skipped"));
    else if (fts.ok) console.log(`  ${c.green("ok")}`);
    else console.log(`  ${c.red(fts.message)}`);
  } else {
    console.log(c.dim("  skipped — the FTS5 integrity-check needs a writable database"));
    console.log(c.dim("  re-run with --repair to include it"));
  }

  heading("Constraint violations in the data");
  const dupes = duplicateRows(db);
  if (dupes.length === 0) {
    console.log(`  ${c.green("none")}`);
  } else {
    for (const d of dupes.slice(0, 8)) {
      const shown = d.columns.map((n) => `${n}=${JSON.stringify(d.values[n])}`).join(", ");
      console.log(`  ${c.yellow(`${d.table}: ${d.extra} duplicate row(s)`)} ${c.dim(`(${shown})`)}`);
    }
    if (dupes.length > 8) console.log(c.dim(`  … and ${dupes.length - 8} more`));
    console.log(c.dim("  A rebuild keeps one of each and reports the rest — see --repair."));
  }

  heading("Metadata the body says should exist");
  const mentions = mentionConsistency(db);
  if (mentions.error) {
    console.log(`  ${c.red(mentions.error)}`);
  } else {
    const show = (list) => {
      for (const m of list.slice(0, 8)) {
        const what = [...m.people.map((p) => `@${p}`), ...m.tags.map((t) => `#${t}`)].join(" ");
        console.log(`    note ${m.id} ${c.dim(`"${m.title}"`)} → ${what}`);
      }
      if (list.length > 8) console.log(c.dim(`    … and ${list.length - 8} more`));
    };

    if (mentions.lost.length === 0) {
      console.log(`  ${c.green("no saved note is missing metadata its body mentions")}`);
    } else {
      // These notes have been through a save, so the app did extract their
      // mentions once. Missing ones were deleted and not re-inserted.
      console.log(`  ${c.red(`${mentions.lost.length} note(s) lost metadata a save should have kept:`)}`);
      show(mentions.lost);
      console.log(c.dim("  Opening each and saving it re-derives these from the body."));
    }

    if (mentions.neverRecorded.length > 0) {
      // Not damage. Nothing to alarm anyone with.
      console.log(
        `\n  ${c.dim(`${mentions.neverRecorded.length} note(s) mention people or tags that were never recorded:`)}`
      );
      show(mentions.neverRecorded);
      console.log(c.dim("  These have never been saved through the app. scripts/migrate-sqlite.mjs"));
      console.log(c.dim("  imported v1's `<!-- attendees: -->` header only and never read body"));
      console.log(c.dim("  mentions, so this is migration history rather than damage — but it does"));
      console.log(c.dim("  mean @ and # filters do not find these notes."));
    }
  }

  heading("Filter probes (every #tag and @person)");
  const probes = probeFilters(db);
  const bad = [...probes.person, ...probes.tag];
  if (bad.length === 0) {
    console.log(`  ${c.green("all filters resolve correctly")}`);
  } else {
    for (const kind of ["person", "tag"]) {
      for (const r of probes[kind]) {
        const token = kind === "person" ? `@${r.value}` : `#${r.value}`;
        const tag = r.silent ? c.yellow("WRONG RESULTS") : c.red("FAILS");
        console.log(`  ${tag} ${token}`);
        console.log(`    ${c.dim(r.error)}`);
      }
    }
  }

  // ── Verdict ────────────────────────────────────────────────────────────────
  // The table scans decide this, and nothing else does. quick_check naming a
  // *table* is not on its own a reason to give up: "rowid out of order" is a
  // violated ordering invariant in the table's b-tree, and a full scan still
  // returns every row — which is exactly the case a rebuild fixes, by writing
  // those rows into a fresh, correctly ordered tree. Only a scan that cannot
  // read the rows means the rows are actually gone.
  const healthy = quick.ok && full.ok && bad.length === 0;

  heading("Verdict");
  if (healthy) {
    console.log(`  ${c.green("Database is healthy.")}`);
    db.close();
    return;
  }

  if (brokenTables.length > 0) {
    console.log(`  ${c.red("Rows themselves are unreadable:")}`);
    for (const s of brokenTables) console.log(`    ${c.red(s.name)}`);
    console.log("  A rebuild cannot recover what it cannot read. Salvage with the");
    console.log("  sqlite3 CLI, which walks the file at a lower level:");
    console.log(c.dim(`    sqlite3 ${q(file)} ".recover" | sqlite3 ${q(file + ".recovered")}`));
    console.log(c.dim(`  Then replace ${q(file)} with the .recovered file and re-check.`));
    db.close();
    process.exitCode = 1;
    return;
  }

  const damagedTables = [...owners.values()].filter((o) => o.type === "table");
  if (damagedTables.length > 0) {
    console.log(`  ${c.yellow("A table's b-tree is structurally damaged, but every row is readable.")}`);
    for (const o of damagedTables) console.log(`    ${c.yellow(o.name)}`);
    console.log("  A full scan returns the rows regardless of the broken ordering, so a");
    console.log("  rebuild copies them into a correctly ordered table and loses nothing.");
  } else {
    console.log(`  ${c.yellow("Damage is confined to indexes.")}`);
    console.log("  Indexes hold no data of their own — they are derived from the tables.");
  }
  console.log("  Every table scans cleanly, so nothing has been lost yet.");

  if (bad.length > 0) {
    // Saving a note is not wrapped in a transaction: upsertTagsAndPeople()
    // deletes the note's tags and people and then re-inserts them, so an
    // insert that trips the damaged page leaves the delete committed and the
    // note stripped of its metadata — and save() throws before it can record a
    // version snapshot to undo from.
    console.log(`\n  ${c.red("Do not edit notes until this is repaired.")}`);
    console.log("  Saving a note rewrites its tags and people as separate statements,");
    console.log("  so saving one that mentions an affected filter deletes that note's");
    console.log("  people and then fails before restoring them — and records no version");
    console.log("  snapshot. Reading is safe; writing is what loses data.");
  }

  if (!REPAIR) {
    console.log(`\n  Stop the app, then re-run with ${c.bold("--repair")} to rebuild the file.`);
    db.close();
    process.exitCode = 1;
    return;
  }

  heading("Repairing");
  db.close();

  // Row counts from the damaged file, to compare against the rebuild.
  const before = new Map(scans.filter((s) => s.ok && !s.skipped).map((s) => [s.name, s.rows]));

  const rebuilt = `${file}.rebuilt`;
  console.log(`  rebuilding into ${rebuilt} …`);
  const { copied, rejected, renumbered } = rebuildInto(file, rebuilt);
  for (const t of copied) {
    const expected = before.get(t.name);
    const short = expected !== undefined && expected !== t.rows;
    const suffix = short ? c.yellow(`  ← ${expected - t.rows} not copied`) : "";
    console.log(`    ${t.name.padEnd(16)} ${String(t.rows).padStart(7)} rows${suffix}`);
  }

  // Rows the rebuild could not insert are never dropped quietly — they are
  // listed here and written out in full, so the decision to lose them is the
  // reader's rather than the script's.
  if (rejected.length) {
    const dump = `${file}.rejected.json`;
    fs.writeFileSync(dump, JSON.stringify(rejected, null, 2));
    console.log(`\n  ${c.yellow(`${rejected.length} row(s) could not be copied:`)}`);
    for (const r of rejected.slice(0, 5)) {
      console.log(`    ${r.table}: ${c.dim(r.reason)}`);
      console.log(`      ${c.dim(JSON.stringify(r.row))}`);
    }
    if (rejected.length > 5) console.log(c.dim(`    … and ${rejected.length - 5} more`));
    console.log(`  written in full to ${dump}`);
    // Only a violated *natural* key means the row duplicates one already
    // copied. A bare primary-key clash does not, and is never described as one.
    const naturalDupes = rejected.filter((r) => r.reason.startsWith("SQLITE_CONSTRAINT_UNIQUE"));
    if (naturalDupes.length === rejected.length) {
      console.log(c.dim("  All duplicate rows already copied — nothing unique is lost."));
    } else {
      console.log(`  ${c.red("Some carry content that is not duplicated elsewhere — review the dump.")}`);
    }
  }

  if (renumbered.length) {
    console.log(`\n  ${c.dim(`${renumbered.length} row(s) had a damaged id and were given a new one:`)}`);
    for (const r of renumbered.slice(0, 5)) {
      console.log(c.dim(`    ${r.table}: id ${r.was} → reassigned  ${JSON.stringify(r.row)}`));
    }
    if (renumbered.length > 5) console.log(c.dim(`    … and ${renumbered.length - 5} more`));
    console.log(c.dim("  Their content is preserved; only the surrogate id changed."));
  }

  heading("Verifying the rebuild");
  const rw = new Database(rebuilt, { readonly: true });
  const after = runCheck(rw, "integrity_check");
  console.log(`  integrity_check: ${after.ok ? c.green("ok") : c.red(after.problems[0])}`);
  const afterProbes = probeFilters(rw);
  const stillBad = [...afterProbes.person, ...afterProbes.tag];
  if (stillBad.length === 0) {
    console.log(`  filters: ${c.green("all resolve correctly")}`);
  } else {
    for (const r of stillBad) console.log(`  ${c.red(`still failing: ${r.value} — ${r.error}`)}`);
  }
  // A row that vanished without being reported as rejected is unaccounted for,
  // and losing a *note* is never an acceptable cost of a repair — so either
  // blocks the swap even when everything else came out clean.
  const unaccounted = copied.filter((t) => t.source !== t.rows + rejected.filter((r) => r.table === t.name).length);
  const lostNotes = rejected.filter((r) => r.table === "notes");
  if (unaccounted.length) {
    for (const t of unaccounted) console.log(`  ${c.red(`${t.name}: ${t.source} rows in, ${t.rows} out, unaccounted for`)}`);
  }
  if (lostNotes.length) {
    console.log(`  ${c.red(`${lostNotes.length} row(s) of the notes table could not be copied`)}`);
  }
  rw.close();

  heading("Done");
  if (after.ok && stillBad.length === 0 && unaccounted.length === 0 && lostNotes.length === 0) {
    // Only swap the files once the rebuild has been proven good.
    for (const suffix of ["-wal", "-shm"]) {
      if (fs.existsSync(file + suffix)) fs.unlinkSync(file + suffix);
    }
    fs.renameSync(rebuilt, file);
    console.log(`  ${c.green("Repaired.")} Restart the app.`);
    console.log(c.dim(`  The damaged database was kept at ${saved}`));
    console.log(c.dim("  Delete it once you have confirmed everything looks right."));
  } else {
    console.log(`  ${c.red("The rebuild did not come out clean — the original was left untouched.")}`);
    console.log(c.dim(`  Inspect ${rebuilt}, or recover with the sqlite3 CLI:`));
    console.log(c.dim(`    sqlite3 ${file} ".recover" | sqlite3 ${file}.recovered`));
    process.exitCode = 1;
  }
}

main();
