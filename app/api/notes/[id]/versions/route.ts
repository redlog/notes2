import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getNoteVersions } from "@/lib/notes";

export async function GET(
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

  // Ownership check
  const { data: note } = await supabase
    .from("notes")
    .select("user_id")
    .eq("id", noteId)
    .single();
  if (!note || note.user_id !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const versions = await getNoteVersions(supabase, noteId);
  return NextResponse.json(versions);
}
