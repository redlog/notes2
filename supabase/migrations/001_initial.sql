-- ============================================================
-- Localnotes v2 — initial schema
-- ============================================================

-- Enable pg_trgm for trigram search
create extension if not exists pg_trgm;

-- ============================================================
-- User settings (one row per auth user)
-- ============================================================
create table user_settings (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  notes_per_page      int  not null default 25,
  autosave_enabled    bool not null default true,
  autosave_interval   int  not null default 30  -- seconds
);

-- ============================================================
-- Projects
-- ============================================================
create table projects (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  trigram_search bool not null default true,
  created_at  timestamptz not null default now(),
  constraint projects_user_name_unique unique (user_id, name)
);

create index projects_user_idx on projects(user_id);

-- ============================================================
-- Notes
-- ============================================================
create table notes (
  id          bigserial primary key,
  project_id  uuid not null references projects(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text not null default '(untitled)',
  body        text not null default '',
  version     int  not null default 1,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- Full-text search vector (body + title + tags + people combined)
  search_vec  tsvector generated always as (
    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body, ''))
  ) stored
);

create index notes_project_idx   on notes(project_id);
create index notes_user_idx      on notes(user_id);
create index notes_created_idx   on notes(created_at desc);
create index notes_updated_idx   on notes(updated_at desc);
create index notes_search_idx    on notes using gin(search_vec);
-- Trigram index for partial-word matching
create index notes_body_trgm_idx on notes using gin(body gin_trgm_ops);

-- ============================================================
-- Tags  (per note; is_header = set via UI, false = body mention)
-- ============================================================
create table note_tags (
  id        bigserial primary key,
  note_id   bigint not null references notes(id) on delete cascade,
  tag       text   not null,
  is_header bool   not null default true,
  constraint note_tags_unique unique (note_id, tag, is_header)
);

create index note_tags_note_idx on note_tags(note_id);
create index note_tags_tag_idx  on note_tags(tag);

-- ============================================================
-- People / attendees
-- ============================================================
create table note_people (
  id        bigserial primary key,
  note_id   bigint not null references notes(id) on delete cascade,
  person    text   not null,
  is_header bool   not null default true,
  constraint note_people_unique unique (note_id, person, is_header)
);

create index note_people_note_idx   on note_people(note_id);
create index note_people_person_idx on note_people(person);

-- ============================================================
-- Inlinks (note:ID cross-references)
-- ============================================================
create table note_inlinks (
  source_note_id bigint not null references notes(id) on delete cascade,
  target_note_id bigint not null references notes(id) on delete cascade,
  primary key (source_note_id, target_note_id)
);

create index note_inlinks_target_idx on note_inlinks(target_note_id);

-- ============================================================
-- Images
-- ============================================================
create table note_images (
  id          bigserial primary key,
  note_id     bigint not null references notes(id) on delete cascade,
  img_num     int    not null,
  storage_path text  not null,
  constraint note_images_unique unique (note_id, img_num)
);

create index note_images_note_idx on note_images(note_id);

-- ============================================================
-- Row-Level Security
-- ============================================================

alter table user_settings  enable row level security;
alter table projects        enable row level security;
alter table notes           enable row level security;
alter table note_tags       enable row level security;
alter table note_people     enable row level security;
alter table note_inlinks    enable row level security;
alter table note_images     enable row level security;

-- user_settings: own row only
create policy "user_settings_own" on user_settings
  for all using (auth.uid() = user_id);

-- projects: own rows only
create policy "projects_own" on projects
  for all using (auth.uid() = user_id);

-- notes: own rows only
create policy "notes_own" on notes
  for all using (auth.uid() = user_id);

-- note_tags: via note ownership
create policy "note_tags_own" on note_tags
  for all using (
    exists (select 1 from notes n where n.id = note_id and n.user_id = auth.uid())
  );

-- note_people: via note ownership
create policy "note_people_own" on note_people
  for all using (
    exists (select 1 from notes n where n.id = note_id and n.user_id = auth.uid())
  );

-- note_inlinks: via source note ownership
create policy "note_inlinks_own" on note_inlinks
  for all using (
    exists (select 1 from notes n where n.id = source_note_id and n.user_id = auth.uid())
  );

-- note_images: via note ownership
create policy "note_images_own" on note_images
  for all using (
    exists (select 1 from notes n where n.id = note_id and n.user_id = auth.uid())
  );

-- ============================================================
-- Trigger: auto-create user settings + Default project on signup
-- ============================================================
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
declare
  proj_id uuid;
begin
  insert into user_settings (user_id) values (new.id);
  insert into projects (user_id, name) values (new.id, 'Default')
    returning id into proj_id;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- ============================================================
-- Storage: private note-images bucket
-- ============================================================

-- Create a private bucket (public = false means no anonymous access)
insert into storage.buckets (id, name, public)
values ('note-images', 'note-images', false)
on conflict (id) do nothing;

-- Storage paths are: {user_id}/{note_id}/{img_num}.png
-- The first folder component is the owner's user ID.

create policy "storage_note_images_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'note-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "storage_note_images_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'note-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "storage_note_images_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'note-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
