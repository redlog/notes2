import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getNote, extractNoteRefs, getSignedImageUrls } from "@/lib/notes";
import { renderMarkdown } from "@/lib/markdown";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = Number(searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const note = await getNote(supabase, id);
  if (!note || note.user_id !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const refIds = extractNoteRefs(note.body);
  const noteRefs = new Map<number, string>();
  if (refIds.length) {
    const { data } = await supabase
      .from("notes")
      .select("id, title")
      .in("id", refIds)
      .eq("user_id", user.id);
    (data ?? []).forEach((n: { id: number; title: string }) => noteRefs.set(n.id, n.title));
  }

  const imageUrls = await getSignedImageUrls(supabase, note.images);

  const html = renderMarkdown(note.body, { noteRefs, imageUrls });

  return NextResponse.json({ html });
}
