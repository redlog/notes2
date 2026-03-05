-- ============================================================
-- Note version history
-- ============================================================

create table note_versions (
  id          bigserial primary key,
  note_id     bigint not null references notes(id) on delete cascade,
  version     int    not null,
  title       text   not null,
  body        text   not null,
  saved_at    timestamptz not null default now()
);

create index note_versions_note_idx on note_versions(note_id, version desc);
