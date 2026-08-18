import { NextResponse, after } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { getProvider } from "@/lib/providers";
import { semanticEnabled, syncNoteChunks } from "@/lib/semantic";
import { drainOnce } from "@/lib/drain";

const MAX_BODY_BYTES = 500_000;
const MAX_TAGS = 200;
const MAX_TAG_LENGTH = 200;
const MAX_PEOPLE = 200;
const MAX_PERSON_LENGTH = 200;

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const noteId = Number(id);
  if (!Number.isInteger(noteId) || noteId <= 0) {
    return NextResponse.json({ error: "Invalid note ID" }, { status: 400 });
  }

  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const provider = await getProvider();

  const ownerId = await provider.notes.checkOwner(noteId);
  if (!ownerId || ownerId !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { title, body, tags, people, version } = await request.json();

  if (typeof title !== "string" || title.length > 500) {
    return NextResponse.json({ error: "Invalid title" }, { status: 400 });
  }
  if (typeof body !== "string" || body.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Note body too large or invalid" }, { status: 400 });
  }
  const SLUG_RE = /^[a-z0-9_-]+$/;
  if (
    !Array.isArray(tags) ||
    tags.length > MAX_TAGS ||
    tags.some((t) => typeof t !== "string" || t.length > MAX_TAG_LENGTH || !SLUG_RE.test(t))
  ) {
    return NextResponse.json({ error: "Invalid tags" }, { status: 400 });
  }
  if (
    !Array.isArray(people) ||
    people.length > MAX_PEOPLE ||
    people.some((p) => typeof p !== "string" || p.length > MAX_PERSON_LENGTH || !SLUG_RE.test(p))
  ) {
    return NextResponse.json({ error: "Invalid people" }, { status: 400 });
  }
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    return NextResponse.json({ error: "Invalid version" }, { status: 400 });
  }

  const result = await provider.notes.save(noteId, title, body, tags, people, version);

  // Re-chunk after a successful save so the semantic index tracks the note.
  // Skipped on a version conflict — nothing was written, so there is nothing to
  // reconcile against. Pure database work, no Voyage call: see lib/semantic.ts.
  if (result.ok && !result.conflict) {
    const note = await provider.notes.get(noteId);
    const project = note
      ? await provider.projects.getActive(user.id, note.project_id)
      : null;
    if (note && project) {
      await syncNoteChunks(provider, noteId, project, title, body, note.created_at);

      // Embed what that just queued, *after* the response is sent.
      //
      // This is what keeps the index fresh on Vercel's Hobby plan, where cron
      // may only run once a day — waiting for the nightly tick would leave a
      // note unsearchable by meaning for up to 24 hours. after() runs the work
      // without holding the response, so the save is as fast as it ever was and
      // a Voyage outage still cannot fail it.
      //
      // Bounded to one batch on purpose: this is opportunistic top-up, not a
      // backfill. Anything left over is picked up by the cron, the local
      // ticker, or the Settings button.
      if (semanticEnabled(project)) {
        after(async () => {
          await drainOnce(provider, { projectId: project.id });
        });
      }
    }
  }

  return NextResponse.json(result);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const noteId = Number(id);
  if (!Number.isInteger(noteId) || noteId <= 0) {
    return NextResponse.json({ error: "Invalid note ID" }, { status: 400 });
  }

  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { project_id } = await request.json();
  if (typeof project_id !== "string" || !project_id) {
    return NextResponse.json({ error: "Invalid project_id" }, { status: 400 });
  }

  const provider = await getProvider();

  const noteOwnerId = await provider.notes.checkOwner(noteId);
  if (!noteOwnerId || noteOwnerId !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const projectOwnerId = await provider.projects.checkOwner(project_id);
  if (!projectOwnerId || projectOwnerId !== user.id) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  await provider.notes.moveToProject(noteId, project_id);
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const noteId = Number(id);
  if (!Number.isInteger(noteId) || noteId <= 0) {
    return NextResponse.json({ error: "Invalid note ID" }, { status: 400 });
  }

  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const provider = await getProvider();

  const ownerId = await provider.notes.checkOwner(noteId);
  if (!ownerId || ownerId !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await provider.notes.delete(noteId);
  return NextResponse.json({ ok: true });
}
