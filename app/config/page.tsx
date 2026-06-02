import { redirect } from "next/navigation";
import Link from "next/link";
import { getAuthUser } from "@/lib/auth";
import { getProvider } from "@/lib/providers";
import Header from "@/components/Header";
import ConfigForm from "@/components/ConfigForm";
import { ArrowLeft } from "lucide-react";

export default async function ConfigPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const sp = await searchParams;
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const provider = await getProvider();

  const [projects, settings] = await Promise.all([
    provider.projects.getUserProjects(user.id),
    provider.projects.getUserSettings(user.id),
  ]);

  const activeProject = await provider.projects.getActive(user.id, sp.project);
  if (!activeProject) redirect("/");

  return (
    <div className="min-h-screen bg-background">
      <Header
        projects={projects}
        activeProject={activeProject}
        userEmail={user.email}
      />
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6">
        <div className="mb-6">
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to notes
          </Link>
          <h1 className="text-xl font-bold">Settings</h1>
        </div>
        <ConfigForm
          projects={projects}
          activeProject={activeProject}
          settings={settings}
          userEmail={user.email}
          userId={user.id}
        />
      </div>
    </div>
  );
}
