import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getProvider } from "@/lib/providers";

async function resolveParams(params: Promise<{ id: string; ver: string }>) {
  const { id, ver } = await params;
  const noteId = Number(id);
  const version = Number(ver);
  if (!Number.isInteger(noteId) || noteId <= 0 || !Number.isInteger(version) || version <= 0) {
    return null;
  }
  return { noteId, version };
}

// GET /api/notes/[id]/versions/[ver] — fetch a specific snapshot
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; ver: string }> }
) {
  const resolved = await resolveParams(params);
  if (!resolved) return NextResponse.json({ error: "Invalid params" }, { status: 400 });
  const { noteId, version } = resolved;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const provider = await getProvider();

  const ownerId = await provider.notes.checkOwner(noteId);
  if (!ownerId || ownerId !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const snapshot = await provider.notes.getVersion(noteId, version);
  if (!snapshot) return NextResponse.json({ error: "Version not found" }, { status: 404 });
  return NextResponse.json(snapshot);
}

// POST /api/notes/[id]/versions/[ver]/restore — restore a snapshot as the current note
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; ver: string }> }
) {
  const resolved = await resolveParams(params);
  if (!resolved) return NextResponse.json({ error: "Invalid params" }, { status: 400 });
  const { noteId, version } = resolved;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const provider = await getProvider();

  const note = await provider.notes.get(noteId);
  if (!note || note.user_id !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const snapshot = await provider.notes.getVersion(noteId, version);
  if (!snapshot) return NextResponse.json({ error: "Version not found" }, { status: 404 });

  const headerTags = note.tags.filter((t) => t.is_header).map((t) => t.tag);
  const headerPeople = note.people.filter((p) => p.is_header).map((p) => p.person);

  const result = await provider.notes.save(
    noteId,
    snapshot.title,
    snapshot.body,
    headerTags,
    headerPeople,
    note.version
  );

  if (!result.ok) return NextResponse.json({ error: "Restore failed" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
