import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  createProject,
  updateProject,
  deleteProject,
  updateUserSettings,
} from "@/lib/projects";

// POST /api/projects — create a new project
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name } = await request.json();
  if (!name?.trim()) return NextResponse.json({ error: "Name required" }, { status: 400 });

  const project = await createProject(supabase, user.id, name.trim());
  return NextResponse.json({ ok: true, project });
}

// PATCH /api/projects — update project or user settings
export async function PATCH(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();

  if (body.projectId) {
    await updateProject(supabase, body.projectId, {
      name: body.name,
      trigram_search: body.trigram_search,
    });
  }

  if (body.settings) {
    await updateUserSettings(supabase, user.id, body.settings);
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

  // Verify ownership
  const { data } = await supabase
    .from("projects")
    .select("user_id")
    .eq("id", projectId)
    .single();
  if (!data || data.user_id !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await deleteProject(supabase, projectId);
  return NextResponse.json({ ok: true });
}
