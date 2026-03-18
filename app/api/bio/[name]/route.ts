import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActiveProject } from "@/lib/projects";

const MAX_BIO_BYTES = 100_000;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const person = decodeURIComponent(name);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const projectParam = url.searchParams.get("project") ?? undefined;
  const activeProject = await getActiveProject(supabase, user.id, projectParam);
  if (!activeProject) return NextResponse.json({ error: "No project" }, { status: 400 });

  const { data } = await supabase
    .from("person_bios")
    .select("content, updated_at")
    .eq("project_id", activeProject.id)
    .eq("person", person)
    .single();

  return NextResponse.json({ content: data?.content ?? "", updated_at: data?.updated_at ?? null });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const person = decodeURIComponent(name);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const projectParam = url.searchParams.get("project") ?? undefined;
  const activeProject = await getActiveProject(supabase, user.id, projectParam);
  if (!activeProject) return NextResponse.json({ error: "No project" }, { status: 400 });

  const { content } = await request.json();
  if (typeof content !== "string" || content.length > MAX_BIO_BYTES) {
    return NextResponse.json({ error: "Invalid content" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("person_bios")
    .upsert(
      { project_id: activeProject.id, user_id: user.id, person, content, updated_at: now },
      { onConflict: "project_id,person" }
    );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, updated_at: now });
}
