import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { getProvider } from "@/lib/providers";

export async function POST(request: Request) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const form = await request.formData();
  const file = form.get("file") as File | null;
  const noteId = Number(form.get("noteId"));

  if (!file || !noteId) {
    return NextResponse.json({ error: "Missing file or noteId" }, { status: 400 });
  }

  const provider = await getProvider();

  // Verify note ownership
  const ownerId = await provider.notes.checkOwner(noteId);
  if (!ownerId || ownerId !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const buffer = await file.arrayBuffer();

  // Validate PNG by magic bytes
  const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const bytes = new Uint8Array(buffer);
  if (
    bytes.length < PNG_MAGIC.length ||
    !PNG_MAGIC.every((b, i) => bytes[i] === b)
  ) {
    return NextResponse.json({ error: "File is not a valid PNG" }, { status: 400 });
  }

  const imgNum = await provider.notes.getNextImageNum(noteId);
  const storagePath = `${noteId}/${imgNum}.png`;

  if (process.env.PROVIDER === "sqlite") {
    // Local filesystem storage
    const { getLocalImagesDir } = await import("@/lib/local-storage");
    const { writeFile, mkdir } = await import("fs/promises");
    const { join } = await import("path");

    const imagesDir = getLocalImagesDir();
    const noteDir = join(imagesDir, String(noteId));
    await mkdir(noteDir, { recursive: true });
    await writeFile(join(noteDir, `${imgNum}.png`), Buffer.from(buffer));
  } else {
    // Supabase storage (path includes user_id prefix for RLS)
    const supabaseStoragePath = `${user.id}/${noteId}/${imgNum}.png`;
    const { createClient } = await import("@/lib/supabase/server");
    const supabase = await createClient();
    const { error: uploadError } = await supabase.storage
      .from("note-images")
      .upload(supabaseStoragePath, buffer, { contentType: "image/png", upsert: false });
    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }
    // Use the Supabase-namespaced path in the DB record
    await provider.notes.insertImageRecord(noteId, imgNum, supabaseStoragePath);

    const images = await provider.notes.getImageRecords(noteId);
    const signedUrls = await provider.notes.getSignedImageUrls(images);
    return NextResponse.json({ ok: true, images, signedUrls });
  }

  // Local mode: record in DB and return updated list
  await provider.notes.insertImageRecord(noteId, imgNum, storagePath);

  const images = await provider.notes.getImageRecords(noteId);
  const signedUrls = await provider.notes.getSignedImageUrls(images);
  return NextResponse.json({ ok: true, images, signedUrls });
}
