import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { getProvider } from "@/lib/providers";

// Returns every tagline for a given tag as JSON so it can be consumed by
// other applications, e.g. GET /api/tagline/todo?project=<id>
export async function GET(
  request: Request,
  { params }: { params: Promise<{ tag: string }> }
) {
  const { tag } = await params;
  const decodedTag = decodeURIComponent(tag);
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("project") ?? "";

  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const provider = await getProvider();
  const project = await provider.projects.getActive(user.id, projectId || undefined);
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Fetch all lines (no pagination) with a large page size.
  const { lines, total } = await provider.notes.getTaglines(
    project.id,
    decodedTag,
    1,
    1_000_000
  );

  return NextResponse.json({
    tag: decodedTag,
    project: project.name,
    total,
    lines: lines.map((l) => ({
      note_id: l.noteId,
      note_title: l.noteTitle,
      note_created_at: l.noteCreatedAt,
      content: l.line,
    })),
  });
}
