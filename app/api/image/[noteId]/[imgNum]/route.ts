import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSignedImageUrls } from "@/lib/notes";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ noteId: string; imgNum: string }> }
) {
  const { noteId: noteIdStr, imgNum: imgNumStr } = await params;
  const noteId = Number(noteIdStr);
  const imgNum = Number(imgNumStr);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Verify ownership via note
  const { data: note } = await supabase
    .from("notes")
    .select("user_id")
    .eq("id", noteId)
    .single();
  if (!note || note.user_id !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: img } = await supabase
    .from("note_images")
    .select("storage_path")
    .eq("note_id", noteId)
    .eq("img_num", imgNum)
    .single();

  if (img) {
    await supabase.storage.from("note-images").remove([img.storage_path]);
    await supabase
      .from("note_images")
      .delete()
      .eq("note_id", noteId)
      .eq("img_num", imgNum);
  }

  const { data: images } = await supabase
    .from("note_images")
    .select("img_num, storage_path")
    .eq("note_id", noteId)
    .order("img_num");

  const signedUrls = await getSignedImageUrls(supabase, images ?? []);
  return NextResponse.json({ ok: true, images: images ?? [], signedUrls });
}
