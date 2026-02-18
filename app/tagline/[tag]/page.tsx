import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getActiveProject, getUserProjects } from "@/lib/projects";
import { getTaglines } from "@/lib/notes";
import Header from "@/components/Header";
import { renderMarkdown } from "@/lib/markdown";

export default async function TaglinePage({
  params,
  searchParams,
}: {
  params: Promise<{ tag: string }>;
  searchParams: Promise<{ project?: string }>;
}) {
  const { tag } = await params;
  const sp = await searchParams;
  const decodedTag = decodeURIComponent(tag);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [projects] = await Promise.all([getUserProjects(supabase, user.id)]);
  const activeProject = await getActiveProject(supabase, user.id, sp.project);
  if (!activeProject) redirect("/");

  const lines = await getTaglines(supabase, activeProject.id, decodedTag);

  return (
    <>
      <Header
        projects={projects}
        activeProject={activeProject}
        userEmail={user.email ?? ""}
      />
      <div className="max-w-3xl mx-auto px-4 py-6">
        <div className="flex items-center gap-3 mb-4">
          <Link href="/" className="text-gray-400 hover:text-gray-700 text-sm">
            ← Back
          </Link>
          <h1 className="text-xl font-bold">
            Tagline: <span className="text-blue-700">#{decodedTag}</span>
          </h1>
          <span className="text-sm text-gray-500">({lines.length} lines)</span>
        </div>

        {lines.length === 0 ? (
          <p className="text-gray-400">No lines found for #{decodedTag}.</p>
        ) : (
          <div className="space-y-3">
            {lines.map((line, idx) => (
              <div key={idx} className="border-b border-gray-100 pb-3">
                <div className="flex items-baseline gap-2 mb-1">
                  <Link
                    href={`/note/${line.noteId}`}
                    className="text-sm font-medium text-blue-700 hover:underline"
                  >
                    {line.noteTitle}
                  </Link>
                  <span className="text-xs text-gray-400">
                    {new Date(line.noteCreatedAt).toLocaleDateString(undefined, {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                </div>
                <div
                  className="note-body text-sm"
                  dangerouslySetInnerHTML={{
                    __html: renderMarkdown(line.line),
                  }}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
