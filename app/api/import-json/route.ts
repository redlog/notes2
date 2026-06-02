import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { getProvider } from "@/lib/providers";
import type { DataProvider } from "@/lib/providers";

interface ImportNote {
  id: number;
  title: string;
  body: string;
  tags: string[];
  people: string[];
  created_at: string;
  updated_at: string;
  images: Array<{ img_num: number; data: string }>;
}

interface ImportFile {
  version: number;
  notes: ImportNote[];
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const projectId = searchParams.get("project") ?? "";
  const provider = await getProvider();

  const project = await provider.projects.getActive(user.id, projectId || undefined);
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  let payload: ImportFile;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!payload || typeof payload !== "object" || !Array.isArray(payload.notes)) {
    return NextResponse.json({ error: "Invalid export file format" }, { status: 400 });
  }

  const notes: ImportNote[] = payload.notes;

  // Pass 1: create all notes (title only) to get new IDs, build old→new ID map
  const idMap = new Map<number, number>();
  for (const note of notes) {
    try {
      const newId = await provider.notes.create(project.id, user.id, note.title ?? "");
      idMap.set(note.id, newId);
    } catch {
      // will be reported as error in pass 2
    }
  }

  // Pass 2: save content, upload images, restore timestamps
  let imported = 0;
  const errors: string[] = [];

  for (const note of notes) {
    const newId = idMap.get(note.id);
    if (newId === undefined) {
      errors.push(`Note "${note.title}" (id ${note.id}): failed to create`);
      continue;
    }

    try {
      // Remap note:OLDID → note:NEWID references in body
      const body = (note.body ?? "").replace(/note:(\d+)/g, (match, oldId) => {
        const mapped = idMap.get(Number(oldId));
        return mapped !== undefined ? `note:${mapped}` : match;
      });

      const saveResult = await provider.notes.save(
        newId,
        note.title ?? "",
        body,
        Array.isArray(note.tags) ? note.tags : [],
        Array.isArray(note.people) ? note.people : [],
        1
      );

      if (!saveResult.ok) {
        errors.push(`Note "${note.title}" (id ${note.id}): save failed`);
        continue;
      }

      // Upload images
      for (const img of note.images ?? []) {
        try {
          const buf = Buffer.from(img.data, "base64");
          const bytes = new Uint8Array(buf);
          if (buf.length >= 8 && PNG_MAGIC.every((b, i) => bytes[i] === b)) {
            await uploadImageBytes(newId, img.img_num, buf, user.id, provider);
          }
        } catch {
          // skip individual image errors — note still imports without it
        }
      }

      // Restore original timestamps
      await restoreTimestamps(newId, note.created_at, note.updated_at, user.id);

      imported++;
    } catch (err) {
      errors.push(
        `Note "${note.title}" (id ${note.id}): ${err instanceof Error ? err.message : "unknown error"}`
      );
    }
  }

  return NextResponse.json({ imported, total: notes.length, errors });
}

async function uploadImageBytes(
  noteId: number,
  imgNum: number,
  buf: Buffer,
  userId: string,
  provider: DataProvider
): Promise<void> {
  if (process.env.PROVIDER === "sqlite") {
    const { getLocalImagesDir } = await import("@/lib/local-storage");
    const { writeFile, mkdir } = await import("fs/promises");
    const { join } = await import("path");
    const imagesDir = getLocalImagesDir();
    await mkdir(join(imagesDir, String(noteId)), { recursive: true });
    await writeFile(join(imagesDir, String(noteId), `${imgNum}.png`), buf);
    await provider.notes.insertImageRecord(noteId, imgNum, `${noteId}/${imgNum}.png`);
    return;
  }

  if (process.env.PROVIDER === "gcp") {
    const { Storage } = await import("@google-cloud/storage");
    const bucket = process.env.GCS_BUCKET;
    if (!bucket) return;
    const storagePath = `${noteId}/${imgNum}.png`;
    await new Storage().bucket(bucket).file(storagePath).save(buf, { contentType: "image/png" });
    await provider.notes.insertImageRecord(noteId, imgNum, storagePath);
    return;
  }

  // Supabase
  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();
  const storagePath = `${userId}/${noteId}/${imgNum}.png`;
  const { error } = await supabase.storage
    .from("note-images")
    .upload(storagePath, buf, { contentType: "image/png", upsert: true });
  if (!error) {
    await provider.notes.insertImageRecord(noteId, imgNum, storagePath);
  }
}

async function restoreTimestamps(
  noteId: number,
  createdAt: string,
  updatedAt: string,
  userId: string
): Promise<void> {
  if (!createdAt && !updatedAt) return;
  const created = createdAt || new Date().toISOString();
  const updated = updatedAt || new Date().toISOString();

  if (process.env.PROVIDER === "sqlite") {
    // Reuse the SQLite singleton opened by the provider (stored on global by the sqlite provider)
    const g = global as unknown as { sqliteDb?: import("better-sqlite3").Database };
    g.sqliteDb
      ?.prepare("UPDATE notes SET created_at = ?, updated_at = ? WHERE id = ?")
      .run(created, updated, noteId);
    return;
  }

  if (process.env.PROVIDER === "gcp") {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    try {
      await pool.query(
        "UPDATE notes SET created_at = $1, updated_at = $2 WHERE id = $3",
        [created, updated, noteId]
      );
    } finally {
      await pool.end();
    }
    return;
  }

  // Supabase
  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();
  await supabase
    .from("notes")
    .update({ created_at: created, updated_at: updated })
    .eq("id", noteId)
    .eq("user_id", userId);
}
