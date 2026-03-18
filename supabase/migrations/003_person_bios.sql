-- ============================================================
-- Person bios — one scratchpad per (person, project)
-- ============================================================

create table person_bios (
  id          bigserial primary key,
  project_id  uuid   not null references projects(id) on delete cascade,
  user_id     uuid   not null references auth.users(id) on delete cascade,
  person      text   not null,
  content     text   not null default '',
  updated_at  timestamptz not null default now(),
  constraint person_bios_unique unique (project_id, person)
);

create index person_bios_project_idx on person_bios(project_id);
create index person_bios_person_idx  on person_bios(person);

alter table person_bios enable row level security;

create policy "person_bios_own" on person_bios
  for all using (auth.uid() = user_id);
