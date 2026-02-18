import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { saveNote, deleteNote } from "@/lib/notes";

const MAX_BODY_BYTES = 500_000; // 500 KB plain-text limit
const MAX_TAGS = 200;
const MAX_TAG_LENGTH = 200;
const MAX_PEOPLE = 200;
const MAX_PERSON_LENGTH = 200;

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const noteId = Number(id);
  if (!Number.isInteger(noteId) || noteId <= 0) {
    return NextResponse.json({ error: "Invalid note ID" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Explicit ownership check (defense-in-depth alongside RLS)
  const { data: existing } = await supabase
    .from("notes")
    .select("user_id")
    .eq("id", noteId)
    .single();
  if (!existing || existing.user_id !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { body, tags, people, version } = await request.json();

  // Input validation
  if (typeof body !== "string" || body.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Note body too large or invalid" }, { status: 400 });
  }
  if (
    !Array.isArray(tags) ||
    tags.length > MAX_TAGS ||
    tags.some((t) => typeof t !== "string" || t.length > MAX_TAG_LENGTH)
  ) {
    return NextResponse.json({ error: "Invalid tags" }, { status: 400 });
  }
  if (
    !Array.isArray(people) ||
    people.length > MAX_PEOPLE ||
    people.some((p) => typeof p !== "string" || p.length > MAX_PERSON_LENGTH)
  ) {
    return NextResponse.json({ error: "Invalid people" }, { status: 400 });
  }
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    return NextResponse.json({ error: "Invalid version" }, { status: 400 });
  }

  const result = await saveNote(supabase, noteId, body, tags, people, version);
  return NextResponse.json(result);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const noteId = Number(id);
  if (!Number.isInteger(noteId) || noteId <= 0) {
    return NextResponse.json({ error: "Invalid note ID" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data } = await supabase
    .from("notes")
    .select("user_id")
    .eq("id", noteId)
    .single();
  if (!data || data.user_id !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await deleteNote(supabase, noteId);
  return NextResponse.json({ ok: true });
}
