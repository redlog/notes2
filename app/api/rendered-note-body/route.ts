import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { getProvider } from "@/lib/providers";
import { extractNoteRefs } from "@/lib/notes";
import { renderMarkdown } from "@/lib/markdown";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = Number(searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const provider = await getProvider();

  const note = await provider.notes.get(id);
  if (!note || note.user_id !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const refIds = extractNoteRefs(note.body);
  const noteRefs = await provider.notes.getRefTitles(refIds, user.id);
  const imageUrls = await provider.notes.getSignedImageUrls(note.images);

  const html = renderMarkdown(note.body, { noteRefs, imageUrls });

  return NextResponse.json({ html });
}
