import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const SLUG_RE = "^[a-z0-9_-]+$";

  const [tagsResult, peopleResult] = await Promise.all([
    supabase.from("note_tags").delete({ count: "exact" }).not("tag", "match", SLUG_RE),
    supabase.from("note_people").delete({ count: "exact" }).not("person", "match", SLUG_RE),
  ]);

  if (tagsResult.error) return NextResponse.json({ error: tagsResult.error.message }, { status: 500 });
  if (peopleResult.error) return NextResponse.json({ error: peopleResult.error.message }, { status: 500 });

  return NextResponse.json({
    tagsDeleted: tagsResult.count ?? 0,
    peopleDeleted: peopleResult.count ?? 0,
  });
}
