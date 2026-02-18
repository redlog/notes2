import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSignedImageUrls } from "@/lib/notes";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const form = await request.formData();
  const file = form.get("file") as File | null;
  const noteId = Number(form.get("noteId"));

  if (!file || !noteId) {
    return NextResponse.json({ error: "Missing file or noteId" }, { status: 400 });
  }

  // Verify note ownership before reading the file body
  const { data: note } = await supabase
    .from("notes")
    .select("user_id")
    .eq("id", noteId)
    .single();
  if (!note || note.user_id !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const buffer = await file.arrayBuffer();

  // Validate by magic bytes — browser-supplied MIME type is not trustworthy.
  // PNG magic: 89 50 4E 47 0D 0A 1A 0A
  const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const bytes = new Uint8Array(buffer);
  if (
    bytes.length < PNG_MAGIC.length ||
    !PNG_MAGIC.every((b, i) => bytes[i] === b)
  ) {
    return NextResponse.json({ error: "File is not a valid PNG" }, { status: 400 });
  }

  // Get next image number
  const { data: existingImages } = await supabase
    .from("note_images")
    .select("img_num")
    .eq("note_id", noteId)
    .order("img_num", { ascending: false })
    .limit(1);
  const nextNum = existingImages?.[0]?.img_num ? existingImages[0].img_num + 1 : 1;

  const storagePath = `${user.id}/${noteId}/${nextNum}.png`;

  const { error: uploadError } = await supabase.storage
    .from("note-images")
    .upload(storagePath, buffer, { contentType: "image/png", upsert: false });

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  await supabase
    .from("note_images")
    .insert({ note_id: noteId, img_num: nextNum, storage_path: storagePath });

  // Return updated image list with fresh signed URLs
  const { data: images } = await supabase
    .from("note_images")
    .select("img_num, storage_path")
    .eq("note_id", noteId)
    .order("img_num");

  const signedUrls = await getSignedImageUrls(supabase, images ?? []);
  return NextResponse.json({ ok: true, images: images ?? [], signedUrls });
}
