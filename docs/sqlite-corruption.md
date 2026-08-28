# SQLite corruption: `database disk image is malformed`

## The symptom

```
✗ SqliteError: database disk image is malformed
    at Object.list (.next/server/chunks/5435.js:108:1517)
    at t (.next/server/app/page.js:1:1283) {
  code: 'SQLITE_CORRUPT',
  digest: '1116094476'
}
```

…thrown only when filtering by **one particular person**. Every other person
filters fine, the unfiltered note list renders, and the sidebar shows the right
counts for everybody.

That narrowness is what makes this look like an application bug rather than a
damaged file. It isn't. It is the signature of a damaged b-tree page inside a
**single index**.

## Why one person and not the others

`SQLITE_CORRUPT` is raised when SQLite walks a page it cannot parse. It walks a
page only if the query plan takes it there — so damage confined to one index
breaks exactly the queries that use that index, and nothing else.

A page load of `/` runs three queries against `note_people`, and they use three
different b-trees:

| Query | Index used |
|---|---|
| `notes.list()` resolving `@name`:<br>`SELECT note_id FROM note_people WHERE person = ?` | **`note_ppl_prsn_idx`** |
| `getPersonCounts()` for the sidebar:<br>`SELECT np.person, np.is_header FROM note_people np JOIN notes n ON n.id = np.note_id` | `sqlite_autoindex_note_people_1` |
| Batch-fetching people for the rows on the page:<br>`SELECT note_id, person, is_header FROM note_people WHERE note_id IN (…)` | `sqlite_autoindex_note_people_1` |

Only the first one reads `note_ppl_prsn_idx`, and it is reached only when a
`@person` filter is applied. So if a page of `note_ppl_prsn_idx` is damaged:

- the sidebar still lists every person with correct counts — different b-tree;
- the unfiltered list still works — never touches `note_people` by person;
- filtering by a person whose keys live on an undamaged page still works;
- filtering by a person whose keys live on the **damaged** page throws.

The same reasoning applies to `#tag` filters and `note_tags_tag_idx`.

Worth knowing: index damage does not always raise. Depending on which bytes are
affected, SQLite may instead walk the damaged page happily and return **fewer
rows than exist** — a person filter that quietly shows 435 of their 533 notes.
`scripts/check-sqlite.mjs` checks for that too, by comparing each filter's
result count against the same count read from a full table scan.

## Data loss

**Reading is safe. Writing is what loses data.** The corruption itself destroys
nothing — an index holds no data of its own — but continuing to *edit* notes
while the database is damaged does.

`NotesDataProvider.save()` is not wrapped in a transaction, and
`upsertTagsAndPeople()` rewrites a note's metadata as separate autocommitted
statements:

```
DELETE FROM note_tags   WHERE note_id = ?   -- commits
DELETE FROM note_people WHERE note_id = ?   -- commits
INSERT INTO note_tags   …                   -- commits
INSERT INTO note_people …                   -- raises SQLITE_CORRUPT
```

If any of the note's people hash onto the damaged index page, the deletes have
already committed when the insert throws. Replaying `save()` against a damaged
database, editing a note that mentions an affected person:

| | before | after |
|---|---|---|
| body | `body 4 lorem` | `Edited body with new content` |
| version | 1 | 2 |
| people | `["Eve"]` | `[]` |
| tags | `[]` | `["work"]` |
| version snapshots | 0 | 0 |

Three things go wrong at once:

- **The note's people are gone.** Deleted and never restored.
- **No version snapshot is recorded.** `save()` throws before
  `recordNoteVersion()`, so there is no history entry to undo from.
- **The save half-succeeded but reports failure.** The body and version were
  already committed, so the editor shows an error for a save that did land.

Tags survive, because they are re-inserted before the people loop.

Notes that mention only unaffected people save normally, which is what makes
this easy to miss.

Corruption did not spread to table data across inserts, updates, cascading
deletes and drain writes in testing — but writing into a damaged b-tree is not
behaviour to lean on. Repair first.

### What the checker cannot tell you

The `NOT INDEXED` table scans prove the rows that are *there* are readable, and
the rebuild compares per-table row counts before and after. Neither can detect
rows that went missing *before* the check ran: if a page had been lost from a
table's own b-tree, the scan would simply not see those rows and report a clean,
smaller database. So after repairing, sanity-check the note count against what
you expect rather than trusting "clean" alone.

## Diagnosing it

```bash
node scripts/check-sqlite.mjs
```

Read-only; safe to run with the app up. It does four things:

1. **`PRAGMA quick_check`, then `PRAGMA integrity_check`.** `quick_check` comes
   first on purpose: on damage severe enough to break page parsing,
   `integrity_check` raises `SQLITE_CORRUPT` and tells you nothing, while
   `quick_check` keeps going and names the object outright
   (`wrong # of entries in index note_ppl_prsn_idx`). Damage reported as
   `Tree <n> page <m>` is resolved to a name through `sqlite_schema.rootpage`.
2. **A full scan of every table with `NOT INDEXED`**, which bypasses every index
   and reads the table's own b-tree. This is the decisive test: if all tables
   scan cleanly, no note data has been lost and the damage is in derived
   structures only.
3. **The FTS5 integrity check** (`INSERT INTO notes_fts(notes_fts)
   VALUES('integrity-check')`), which needs a writable database, so it runs only
   under `--repair`.
4. **A probe of every `#tag` and `@person` filter**, running the query the app
   runs, so the output names the affected filters directly.

## Repairing it

```bash
node scripts/check-sqlite.mjs --repair    # stop the app first
```

The obvious repairs do not work. `REINDEX`, `REINDEX <one index>`,
`DROP INDEX`, `VACUUM` and `VACUUM INTO` all fail with the same
`SQLITE_CORRUPT`, because every one of them has to free the damaged index's
pages before it can rebuild — the repair trips over the very thing it is
repairing.

So `--repair` rebuilds the file instead:

1. Read the schema from `sqlite_schema`.
2. Create the tables in a new file and copy every row with `NOT INDEXED`, which
   touches no index at all.
3. Carry over the `sqlite_sequence` high-water marks, so reused note ids cannot
   collide with the image directories on disk that are named after old ids.
4. Create the indexes, views and triggers from scratch.
5. Repopulate `notes_fts` from `notes` rather than copying it, so the search
   index is consistent with the note bodies by construction.
6. Verify the rebuild (`integrity_check`, filter probes, per-table row counts
   against the original) and only then swap the files, keeping the damaged
   original as `notes.db.<timestamp>.bak`.

Two cases need care, and the rebuild handles both explicitly rather than
failing or dropping rows quietly:

**Rows that violate the schema's own constraints.** A damaged unique index can
let a duplicate through — `non-unique entry in index sqlite_autoindex_note_tags_1`.
The destination table enforces the constraint, so one such row would otherwise
abort the whole copy. The rebuild retries the table row by row, keeps one of
each, and lists what it skipped (also written to `<db>.rejected.json`).

**Rows whose id itself was damaged.** `Rowid … out of order` can mean a rowid
was overwritten with one already in use. That row is *not* redundant —
`{id: 1377, note_id: 1649, person: "jon"}` is a real association whose only
problem is a colliding surrogate key. Where the id is a surrogate that nothing
references, the row is re-inserted without it and SQLite assigns a fresh one, so
the content survives. `notes.id` is excluded from this: image directories on
disk are named after it and `note:<id>` links reference it, so a colliding note
is reported rather than renumbered.

A rejection on the `notes` table, or any row that goes missing without being
reported, blocks the swap outright — the original is left untouched.

Only if a **table scan** fails are rows genuinely unreadable, and no rebuild can
invent them. The checker says so and stops, pointing at the sqlite3 CLI:

```bash
sqlite3 local-data/notes.db ".recover" | sqlite3 local-data/notes.db.recovered
```

Note that quick_check naming a *table* is not by itself that case.
`Rowid … out of order` is a violated ordering invariant in the table's b-tree,
and a full scan still returns every row — which is precisely what a rebuild
fixes, by writing those rows into a fresh, correctly ordered tree. The table
scans, not the pragma output, decide whether data is recoverable.

## How the file got damaged

Nothing in this codebase writes malformed pages — SQLite is not corrupted by
ordinary application bugs. In practice the causes are environmental, and worth
ruling out so it does not recur:

- **The database on a file-syncing or network filesystem.** OneDrive, iCloud
  Drive, Dropbox, Google Drive, NFS, SMB. This is the most common cause by far,
  and the one actually observed here — the damaged database lived under
  `OneDrive - <org>\notes2\`. SQLite coordinates readers and writers through byte-range locks and the
  `-wal`/`-shm` sidecar files; a sync client that copies, relocates or
  materialises those files behind SQLite's back produces exactly this kind of
  localised page damage. `SQLITE_DB_PATH` defaults to `<cwd>/local-data/notes.db`,
  so a checkout inside a synced folder puts the database in one by default.
  Move it out with `SQLITE_DB_PATH=/somewhere/local/notes.db`.
- **Two copies of the app on one database file.** `npm run dev` and
  `npm start` at once, or `scripts/migrate-sqlite.mjs` against a database the
  server has open. WAL handles concurrent access correctly on a local disk, but
  not across a sync client, and not if the sidecar files are removed underneath
  a running process.
- **Hardware or power loss**, including external drives that acknowledge
  `fsync` before the data is durable.

If the database lives on local disk and is only ever opened by one app at a
time, this should not recur. If it does, that points at the storage.

### Keeping a copy in a synced folder anyway

Pausing the sync client while the app runs does close the main hole, but it
makes correctness depend on a ritual performed perfectly every time, and the
failure is silent for weeks. It also leaves a real edge: after an unclean exit
the main file can be nearly empty with everything sitting in the `-wal`
sidecar, and the two are only meaningful as a matched pair.

```
.db  = 4096 bytes      ← after a kill: essentially empty
-wal = 98912 bytes     ← every row lives here
```

Set `SQLITE_BACKUP_PATH` instead. The app snapshots the database with
`VACUUM INTO` — hourly by default and again on clean exit — and the sync client
only ever sees a finished file. Measured against a database taking ~66
writes/second throughout, a snapshot came out fully consistent (equal counts
across `notes`, `notes_fts` and `note_people`, no note missing its person row);
it simply represents an earlier moment. A byte-for-byte copy under the same
conditions is what produces the index/table disagreement above.
