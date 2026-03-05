import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getProvider } from "@/lib/providers";

// POST /api/projects — create a new project
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name } = await request.json();
  if (!name?.trim()) return NextResponse.json({ error: "Name required" }, { status: 400 });

  const provider = await getProvider();
  const project = await provider.projects.create(user.id, name.trim());
  return NextResponse.json({ ok: true, project });
}

// PATCH /api/projects — update project or user settings
export async function PATCH(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const provider = await getProvider();

  if (body.projectId) {
    await provider.projects.update(body.projectId, {
      name: body.name,
      trigram_search: body.trigram_search,
    });
  }

  if (body.settings) {
    await provider.projects.updateSettings(user.id, body.settings);
  }

  return NextResponse.json({ ok: true });
}

// DELETE /api/projects — delete a project
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await request.json();
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  const provider = await getProvider();

  // Verify ownership
  const ownerId = await provider.projects.checkOwner(projectId);
  if (!ownerId || ownerId !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await provider.projects.delete(projectId);
  return NextResponse.json({ ok: true });
}
