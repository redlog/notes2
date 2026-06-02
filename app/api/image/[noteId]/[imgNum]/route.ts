import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { getProvider } from "@/lib/providers";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ noteId: string; imgNum: string }> }
) {
  const { noteId: noteIdStr, imgNum: imgNumStr } = await params;
  const noteId = Number(noteIdStr);
  const imgNum = Number(imgNumStr);

  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const provider = await getProvider();

  const ownerId = await provider.notes.checkOwner(noteId);
  if (!ownerId || ownerId !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const img = await provider.notes.getImageRecord(noteId, imgNum);

  if (img) {
    if (process.env.PROVIDER === "sqlite") {
      const { getLocalImagesDir } = await import("@/lib/local-storage");
      const { unlink } = await import("fs/promises");
      const { join } = await import("path");
      const filePath = join(getLocalImagesDir(), img.storage_path);
      await unlink(filePath).catch(() => {});
    } else {
      const { createClient } = await import("@/lib/supabase/server");
      const supabase = await createClient();
      await supabase.storage.from("note-images").remove([img.storage_path]);
    }
    await provider.notes.deleteImageRecord(noteId, imgNum);
  }

  const images = await provider.notes.getImageRecords(noteId);
  const signedUrls = await provider.notes.getSignedImageUrls(images);
  return NextResponse.json({ ok: true, images, signedUrls });
}
