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

  for (const t of [...tables, ...virtuals]) to.exec(t.sql);

  to.transaction(() => {
    for (const t of tables) {
      const cols = from
        .prepare(`SELECT name FROM pragma_table_info('${t.name}')`)
        .all()
        .map((r) => `"${r.name}"`);
      const rows = from.prepare(`SELECT ${cols.join(",")} FROM "${t.name}" NOT INDEXED`).all();
      if (rows.length) {
        const insert = to.prepare(
          `INSERT INTO "${t.name}" (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`
        );
        for (const row of rows) insert.run(cols.map((c) => row[c.slice(1, -1)]));
      }
      copied.push({ name: t.name, rows: rows.length });
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
  return copied;
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
  // The table scans, not the pragma output, decide this. A scan that reads
  // every row of every table proves the row data survived, which means the
  // damage is in derived structures and REINDEX rebuilds them from scratch.
  const tableDamage = [...owners.values()].filter((o) => o.type === "table");
  const healthy = quick.ok && full.ok && bad.length === 0;

  heading("Verdict");
  if (healthy) {
    console.log(`  ${c.green("Database is healthy.")}`);
    db.close();
    return;
  }

  if (brokenTables.length > 0 || tableDamage.length > 0) {
    console.log(`  ${c.red("Damage reaches table data — rows themselves are unreadable.")}`);
    console.log("  A rebuild cannot help; salvage what is left with the sqlite3 CLI:");
    console.log(c.dim(`    sqlite3 ${file} ".recover" | sqlite3 ${file}.recovered`));
    console.log(c.dim(`    mv ${file} ${file}.corrupt && mv ${file}.recovered ${file}`));
    console.log(c.dim("    node scripts/check-sqlite.mjs   # verify"));
    db.close();
    process.exitCode = 1;
    return;
  }

  console.log(`  ${c.yellow("Damage is confined to indexes.")}`);
  console.log("  Indexes hold no data of their own — they are derived from the tables,");
  console.log("  and every table scans cleanly, so nothing has been lost.");

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
  const copied = rebuildInto(file, rebuilt);
  for (const t of copied) {
    const expected = before.get(t.name);
    const match = expected === undefined || expected === t.rows;
    const suffix = match ? "" : c.red(`  ← expected ${expected}`);
    console.log(`    ${t.name.padEnd(16)} ${String(t.rows).padStart(7)} rows${suffix}`);
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
  const lost = copied.filter((t) => before.has(t.name) && before.get(t.name) !== t.rows);
  rw.close();

  heading("Done");
  if (after.ok && stillBad.length === 0 && lost.length === 0) {
    // Only swap the files once the rebuild has been proven good.
    const saved = backup(file);
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
