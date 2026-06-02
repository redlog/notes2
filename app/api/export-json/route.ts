import { getAuthUser } from "@/lib/auth";
import { getProvider } from "@/lib/providers";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const user = await getAuthUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const projectId = searchParams.get("project") ?? "";
  const provider = await getProvider();

  const project = await provider.projects.getActive(user.id, projectId || undefined);
  if (!project) return new Response("Not found", { status: 404 });

  const result = await provider.notes.list({
    projectId: project.id,
    page: 1,
    perPage: 9999,
    sortKey: "created_at",
    sortOrder: "asc",
  });

  const notes = [];
  for (const item of result.notes) {
    const note = await provider.notes.get(item.id);
    if (!note) continue;

    const images = [];
    for (const img of note.images) {
      const data = await downloadImageBytes(note.id, img.img_num, img.storage_path);
      if (data) {
        images.push({ img_num: img.img_num, data: data.toString("base64") });
      }
    }

    notes.push({
      id: note.id,
      title: note.title,
      body: note.body,
      tags: note.tags.filter((t) => t.is_header).map((t) => t.tag),
      people: note.people.filter((p) => p.is_header).map((p) => p.person),
      created_at: note.created_at,
      updated_at: note.updated_at,
      images,
    });
  }

  const exportData = {
    version: 1,
    exported_at: new Date().toISOString(),
    project_name: project.name,
    notes,
  };

  const slug = project.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  return new Response(JSON.stringify(exportData), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="localnotes-${slug}.json"`,
    },
  });
}

async function downloadImageBytes(
  noteId: number,
  imgNum: number,
  storagePath: string
): Promise<Buffer | null> {
  if (process.env.PROVIDER === "sqlite") {
    const { getLocalImagesDir } = await import("@/lib/local-storage");
    const { readFile } = await import("fs/promises");
    const { join } = await import("path");
    try {
      return await readFile(join(getLocalImagesDir(), String(noteId), `${imgNum}.png`));
    } catch {
      return null;
    }
  }

  if (process.env.PROVIDER === "gcp") {
    const { Storage } = await import("@google-cloud/storage");
    const bucket = process.env.GCS_BUCKET;
    if (!bucket) return null;
    try {
      const [contents] = await new Storage().bucket(bucket).file(storagePath).download();
      return contents as Buffer;
    } catch {
      return null;
    }
  }

  // Supabase (default)
  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();
  const { data, error } = await supabase.storage.from("note-images").download(storagePath);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}
