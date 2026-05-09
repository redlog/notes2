-- ============================================================
-- Enable RLS on note_versions (missed in 002)
-- ============================================================

alter table note_versions enable row level security;

-- Access via note ownership
create policy "note_versions_own" on note_versions
  for all using (
    exists (select 1 from notes n where n.id = note_id and n.user_id = auth.uid())
  );
