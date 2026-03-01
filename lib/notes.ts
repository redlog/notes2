/**
 * Server-side data access helpers for notes.
 * All functions accept a Supabase client already scoped to the authed user.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ListParams,
  ListResult,
  Note,
  NoteListItem,
  TagCount,
  PersonCount,
} from "./types";

// ── Mention extraction ────────────────────────────────────────────────────────

const TAG_RE = /#([\w/-]+)/g;
const PERSON_RE = /@([\w./-]+)/g;

export function extractMentions(body: string): {
  tags: string[];
  people: string[];
} {
  const tags = [...new Set([...body.matchAll(TAG_RE)].map((m) => m[1]))];
  const people = [...new Set([...body.matchAll(PERSON_RE)].map((m) => m[1]))];
  return { tags, people };
}

// ── Inlink extraction ─────────────────────────────────────────────────────────

const NOTE_REF_RE = /note:(\d+)/g;

export function extractNoteRefs(body: string): number[] {
  return [...new Set([...body.matchAll(NOTE_REF_RE)].map((m) => Number(m[1])))];
}

// ── Title extraction ──────────────────────────────────────────────────────────

export function extractTitle(body: string): string {
  const match = body.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : "(untitled)";
}

// ── List notes ────────────────────────────────────────────────────────────────

export async function listNotes(
  supabase: SupabaseClient,
  params: ListParams
): Promise<ListResult> {
  const {
    projectId,
    search = "",
    filter = "",
    page = 1,
    perPage = 25,
    sortKey = "created_at",
    sortOrder = "desc",
    timeMin,
    timeMax,
  } = params;

  const offset = (page - 1) * perPage;

  // Parse filter tokens
  const filterTokens = filter
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  const requiredTags = filterTokens
    .filter((t) => t.startsWith("#"))
    .map((t) => t.slice(1));
  const requiredPeople = filterTokens
    .filter((t) => t.startsWith("@"))
    .map((t) => t.slice(1));
  const exclusiveTags = filterTokens
    .filter((t) => t.startsWith("+#"))
    .map((t) => t.slice(2));
  const exclusivePeople = filterTokens
    .filter((t) => t.startsWith("+@"))
    .map((t) => t.slice(2));
  const excludedTags = filterTokens
    .filter((t) => t.startsWith("~#"))
    .map((t) => t.slice(2));

  // Build base query with search
  let query = supabase
    .from("notes")
    .select(
      `id, title, created_at, updated_at,
       note_tags(tag, is_header),
       note_people(person, is_header)`,
      { count: "exact" }
    )
    .eq("project_id", projectId);

  if (search) {
    // Use websearch_to_tsquery for natural language; fall back to trigram for partial matches
    query = query.textSearch("search_vec", search, {
      type: "websearch",
      config: "english",
    });
  }

  if (timeMin) query = query.gte("created_at", timeMin);
  if (timeMax) {
    // Include the full end day
    const end = new Date(timeMax);
    end.setDate(end.getDate() + 1);
    query = query.lt("created_at", end.toISOString());
  }

  // Tag/people filters applied post-fetch (Supabase doesn't support arbitrary
  // subquery filters in the JS client easily; for large datasets, use DB functions)
  const resolvedSortKey =
    search && sortKey === "relevance" ? "created_at" : sortKey;
  query = query
    .order(resolvedSortKey, { ascending: sortOrder === "asc" })
    .range(offset, offset + perPage - 1);

  const { data, count, error } = await query;
  if (error) throw error;

  // Client-side filter application
  let notes: NoteListItem[] = (data ?? []).map((row: Record<string, unknown>) => ({
    id: row.id as number,
    title: row.title as string,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    tags: (row.note_tags as NoteTag[]) ?? [],
    people: (row.note_people as NotePerson[]) ?? [],
  }));

  // Apply tag/people filters
  if (requiredTags.length) {
    notes = notes.filter((n) =>
      requiredTags.every((t) => n.tags.some((nt) => nt.tag === t))
    );
  }
  if (requiredPeople.length) {
    notes = notes.filter((n) =>
      requiredPeople.every((p) => n.people.some((np) => np.person === p))
    );
  }
  if (exclusiveTags.length) {
    notes = notes.filter(
      (n) =>
        n.tags.filter((t) => t.is_header).length === exclusiveTags.length &&
        exclusiveTags.every((t) => n.tags.some((nt) => nt.tag === t && nt.is_header))
    );
  }
  if (exclusivePeople.length) {
    notes = notes.filter(
      (n) =>
        n.people.filter((p) => p.is_header).length === exclusivePeople.length &&
        exclusivePeople.every((p) =>
          n.people.some((np) => np.person === p && np.is_header)
        )
    );
  }
  if (excludedTags.length) {
    notes = notes.filter(
      (n) => !excludedTags.some((t) => n.tags.some((nt) => nt.tag === t))
    );
  }

  return {
    notes,
    total: count ?? 0,
    page,
    perPage,
    sortKey: params.sortKey ?? "created_at",
    sortOrder,
  };
}

// ── Get full note ─────────────────────────────────────────────────────────────

export async function getNote(
  supabase: SupabaseClient,
  noteId: number
): Promise<Note | null> {
  const { data, error } = await supabase
    .from("notes")
    .select(
      `*, tags:note_tags(tag, is_header), people:note_people(person, is_header), images:note_images(img_num, storage_path)`
    )
    .eq("id", noteId)
    .single();

  if (error || !data) return null;
  return data as Note;
}

// ── Create note ───────────────────────────────────────────────────────────────

export async function createNote(
  supabase: SupabaseClient,
  projectId: string,
  userId: string,
  body = "",
  tags: string[] = [],
  people: string[] = []
): Promise<number> {
  const title = extractTitle(body);

  const { data, error } = await supabase
    .from("notes")
    .insert({ project_id: projectId, user_id: userId, title, body })
    .select("id")
    .single();
  if (error) throw error;

  const noteId: number = data.id;
  await upsertTagsAndPeople(supabase, noteId, tags, people, body);
  return noteId;
}

// ── Save note ─────────────────────────────────────────────────────────────────

export async function saveNote(
  supabase: SupabaseClient,
  noteId: number,
  body: string,
  tags: string[],
  people: string[],
  expectedVersion: number
): Promise<{ ok: boolean; conflict?: boolean; version?: number; updated_at?: string; currentBody?: string }> {
  // Fetch current version
  const { data: current, error: fetchErr } = await supabase
    .from("notes")
    .select("version, body")
    .eq("id", noteId)
    .single();
  if (fetchErr || !current) return { ok: false };

  if (current.version !== expectedVersion) {
    return { ok: false, conflict: true, currentBody: current.body };
  }

  const title = extractTitle(body);
  const newVersion = expectedVersion + 1;

  const { data: updated, error: updateErr } = await supabase
    .from("notes")
    .update({ title, body, version: newVersion, updated_at: new Date().toISOString() })
    .eq("id", noteId)
    .select("version, updated_at")
    .single();
  if (updateErr || !updated) return { ok: false };

  await upsertTagsAndPeople(supabase, noteId, tags, people, body);
  await updateInlinks(supabase, noteId, body);

  return { ok: true, version: updated.version, updated_at: updated.updated_at };
}

// ── Tags and people upsert ────────────────────────────────────────────────────

interface NoteTag { tag: string; is_header: boolean; }
interface NotePerson { person: string; is_header: boolean; }

async function upsertTagsAndPeople(
  supabase: SupabaseClient,
  noteId: number,
  headerTags: string[],
  headerPeople: string[],
  body: string
) {
  const { tags: mentionTags, people: mentionPeople } = extractMentions(body);

  // Remove header tags/people not in the new list (keep body mentions as-is)
  await supabase
    .from("note_tags")
    .delete()
    .eq("note_id", noteId)
    .eq("is_header", true);
  await supabase
    .from("note_people")
    .delete()
    .eq("note_id", noteId)
    .eq("is_header", true);
  // Remove old body mentions (will re-insert fresh)
  await supabase
    .from("note_tags")
    .delete()
    .eq("note_id", noteId)
    .eq("is_header", false);
  await supabase
    .from("note_people")
    .delete()
    .eq("note_id", noteId)
    .eq("is_header", false);

  const tagRows = [
    ...headerTags.map((tag) => ({ note_id: noteId, tag, is_header: true })),
    ...mentionTags
      .filter((t) => !headerTags.includes(t))
      .map((tag) => ({ note_id: noteId, tag, is_header: false })),
  ];
  const personRows = [
    ...headerPeople.map((person) => ({ note_id: noteId, person, is_header: true })),
    ...mentionPeople
      .filter((p) => !headerPeople.includes(p))
      .map((person) => ({ note_id: noteId, person, is_header: false })),
  ];

  if (tagRows.length)
    await supabase.from("note_tags").insert(tagRows);
  if (personRows.length)
    await supabase.from("note_people").insert(personRows);
}

// ── Inlinks ───────────────────────────────────────────────────────────────────

async function updateInlinks(
  supabase: SupabaseClient,
  sourceNoteId: number,
  body: string
) {
  const refs = extractNoteRefs(body);
  await supabase
    .from("note_inlinks")
    .delete()
    .eq("source_note_id", sourceNoteId);
  if (refs.length) {
    await supabase.from("note_inlinks").insert(
      refs.map((target) => ({
        source_note_id: sourceNoteId,
        target_note_id: target,
      }))
    );
  }
}

// ── Delete note ───────────────────────────────────────────────────────────────

export async function deleteNote(
  supabase: SupabaseClient,
  noteId: number
): Promise<void> {
  // Images: delete from storage first
  const { data: images } = await supabase
    .from("note_images")
    .select("storage_path")
    .eq("note_id", noteId);

  if (images?.length) {
    const paths = images.map((i: { storage_path: string }) => i.storage_path);
    await supabase.storage.from("note-images").remove(paths);
  }

  await supabase.from("notes").delete().eq("id", noteId);
}

// ── Tag/People aggregates ─────────────────────────────────────────────────────

export async function getTagCounts(
  supabase: SupabaseClient,
  projectId: string
): Promise<TagCount[]> {
  const { data, error } = await supabase
    .from("note_tags")
    .select("tag, is_header, note_id, notes!inner(project_id)")
    .eq("notes.project_id", projectId);

  if (error || !data) return [];

  const map = new Map<string, TagCount>();
  for (const row of data as Array<{ tag: string; is_header: boolean }>) {
    const existing = map.get(row.tag) ?? {
      tag: row.tag,
      count: 0,
      header_count: 0,
    };
    existing.count++;
    if (row.is_header) existing.header_count++;
    map.set(row.tag, existing);
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

export async function getPersonCounts(
  supabase: SupabaseClient,
  projectId: string
): Promise<PersonCount[]> {
  const { data, error } = await supabase
    .from("note_people")
    .select("person, is_header, note_id, notes!inner(project_id)")
    .eq("notes.project_id", projectId);

  if (error || !data) return [];

  const map = new Map<string, PersonCount>();
  for (const row of data as Array<{ person: string; is_header: boolean }>) {
    const existing = map.get(row.person) ?? {
      person: row.person,
      count: 0,
      header_count: 0,
    };
    existing.count++;
    if (row.is_header) existing.header_count++;
    map.set(row.person, existing);
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

// ── Signed image URLs ─────────────────────────────────────────────────────────

export async function getSignedImageUrls(
  supabase: SupabaseClient,
  images: { img_num: number; storage_path: string }[],
  expiresIn = 3600
): Promise<Record<number, string>> {
  if (!images.length) return {};
  const result: Record<number, string> = {};
  await Promise.all(
    images.map(async (img) => {
      const { data } = await supabase.storage
        .from("note-images")
        .createSignedUrl(img.storage_path, expiresIn);
      if (data?.signedUrl) result[img.img_num] = data.signedUrl;
    })
  );
  return result;
}

// ── Title search ──────────────────────────────────────────────────────────────

export async function searchTitles(
  supabase: SupabaseClient,
  projectId: string,
  query: string,
  limit = 25
): Promise<{ id: number; title: string }[]> {
  const { data, error } = await supabase
    .from("notes")
    .select("id, title")
    .eq("project_id", projectId)
    .ilike("title", `%${query}%`)
    .limit(limit);
  if (error) return [];
  return data ?? [];
}

// ── Taglines ──────────────────────────────────────────────────────────────────

export async function getTaglines(
  supabase: SupabaseClient,
  projectId: string,
  tag: string,
  limit = 25
): Promise<{ noteId: number; noteTitle: string; noteCreatedAt: string; line: string }[]> {
  // Find all notes in project that mention this tag
  const { data: tagData, error } = await supabase
    .from("note_tags")
    .select("note_id, notes!inner(id, title, body, created_at, project_id)")
    .eq("notes.project_id", projectId)
    .eq("tag", tag);

  if (error || !tagData) return [];

  const results: { noteId: number; noteTitle: string; noteCreatedAt: string; line: string }[] = [];
  const tagPattern = new RegExp(`#${tag}\\b`, "i");

  for (const row of (tagData as unknown) as Array<{ note_id: number; notes: { id: number; title: string; body: string; created_at: string } }>) {
    const note = row.notes;
    const lines = note.body.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("<!--")) continue;
      if (tagPattern.test(trimmed)) {
        results.push({
          noteId: note.id,
          noteTitle: note.title,
          noteCreatedAt: note.created_at,
          line: trimmed,
        });
        if (results.length >= limit) return results;
      }
    }
  }
  return results;
}
