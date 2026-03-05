import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getProvider } from "@/lib/providers";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") ?? "";
  const projectId = searchParams.get("project") ?? "";

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const provider = await getProvider();
  const project = await provider.projects.getActive(user.id, projectId || undefined);
  if (!project) return NextResponse.json({ results: [] });

  const results = await provider.notes.searchTitles(project.id, q);
  return NextResponse.json({ results });
}
