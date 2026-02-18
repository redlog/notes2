import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveProject, getUserProjects, getUserSettings } from "@/lib/projects";
import Header from "@/components/Header";
import ConfigForm from "@/components/ConfigForm";

export default async function ConfigPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [projects, settings] = await Promise.all([
    getUserProjects(supabase, user.id),
    getUserSettings(supabase, user.id),
  ]);

  const activeProject = await getActiveProject(supabase, user.id, sp.project);
  if (!activeProject) redirect("/");

  return (
    <>
      <Header
        projects={projects}
        activeProject={activeProject}
        userEmail={user.email ?? ""}
      />
      <div className="max-w-2xl mx-auto px-4 py-6">
        <h1 className="text-xl font-bold mb-6">Settings</h1>
        <ConfigForm
          projects={projects}
          activeProject={activeProject}
          settings={settings}
          userEmail={user.email ?? ""}
        />
      </div>
    </>
  );
}
