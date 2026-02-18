import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActiveProject } from "@/lib/projects";
import { searchTitles } from "@/lib/notes";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") ?? "";
  const projectId = searchParams.get("project") ?? "";

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const project = await getActiveProject(supabase, user.id, projectId || undefined);
  if (!project) return NextResponse.json({ results: [] });

  const results = await searchTitles(supabase, project.id, q);
  return NextResponse.json({ results });
}
