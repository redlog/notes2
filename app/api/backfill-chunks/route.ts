/**
 * Chunks a page of existing notes.
 *
 * Notes written before semantic search was switched on have no chunk rows —
 * only the save path creates them — so the back catalogue has to be walked
 * once. This does one page per request and returns a cursor, so a large corpus
 * is many short requests rather than one that trips a serverless timeout.
 *
 * No Voyage call happens here: chunking is hashing and row writes. The vectors
 * are filled in afterwards by /api/embed-drain, which is why the backfill and
 * the incremental path are the same code and resuming is free.
 */
import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { getProvider } from "@/lib/providers";
import { chunkNote } from "@/lib/chunking";

const DEFAULT_PAGE = 50;
const MAX_PAGE = 200;

export async function POST(request: Request) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId, afterId = 0, limit = DEFAULT_PAGE } = await request.json();
  if (typeof projectId !== "string" || !projectId) {
    return NextResponse.json({ error: "Invalid projectId" }, { status: 400 });
  }
  if (typeof afterId !== "number" || !Number.isInteger(afterId) || afterId < 0) {
    return NextResponse.json({ error: "Invalid afterId" }, { status: 400 });
  }
  const pageSize = Math.min(Number(limit) || DEFAULT_PAGE, MAX_PAGE);

  const provider = await getProvider();

  const ownerId = await provider.projects.checkOwner(projectId);
  if (!ownerId || ownerId !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const notes = await provider.chunks.notesToChunk(projectId, afterId, pageSize);

  let chunksWritten = 0;
  for (const note of notes) {
    const chunks = chunkNote(note.title, note.body, note.created_at);
    const result = await provider.chunks.sync(note.id, projectId, chunks);
    chunksWritten += result.inserted + result.updated;
  }

  const lastId = notes.length ? notes[notes.length - 1].id : afterId;

  return NextResponse.json({
    ok: true,
    processed: notes.length,
    chunksWritten,
    lastId,
    // Short page means the walk reached the end.
    done: notes.length < pageSize,
  });
}
