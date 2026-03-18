import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getActiveProject, getUserProjects } from "@/lib/projects";
import Header from "@/components/Header";
import BioEditor from "@/components/BioEditor";
import { ArrowLeft } from "lucide-react";

export default async function BioPage({
  params,
  searchParams,
}: {
  params: Promise<{ name: string }>;
  searchParams: Promise<{ project?: string }>;
}) {
  const { name } = await params;
  const sp = await searchParams;
  const person = decodeURIComponent(name);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [projects] = await Promise.all([getUserProjects(supabase, user.id)]);
  const activeProject = await getActiveProject(supabase, user.id, sp.project);
  if (!activeProject) redirect("/");

  const { data: bioData } = await supabase
    .from("person_bios")
    .select("content, updated_at")
    .eq("project_id", activeProject.id)
    .eq("person", person)
    .single();

  const backHref = sp.project ? `/?project=${encodeURIComponent(sp.project)}` : "/";

  return (
    <div className="min-h-screen bg-background">
      <Header
        projects={projects}
        activeProject={activeProject}
        userEmail={user.email ?? ""}
      />
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
        <Link
          href={backHref}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-5 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to notes
        </Link>

        <div className="flex items-baseline gap-3 mb-6">
          <h1 className="text-xl font-bold">
            Bio:{" "}
            <span className="text-violet-600">@{person}</span>
          </h1>
        </div>

        <BioEditor
          person={person}
          initialContent={bioData?.content ?? ""}
          initialUpdatedAt={bioData?.updated_at ?? null}
          projectParam={sp.project}
        />
      </div>
    </div>
  );
}
