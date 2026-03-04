import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getActiveProject, getUserProjects } from "@/lib/projects";
import { getTaglines } from "@/lib/notes";
import Header from "@/components/Header";
import { renderMarkdown } from "@/lib/markdown";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";

const PAGE_SIZE = 25;

export default async function TaglinePage({
  params,
  searchParams,
}: {
  params: Promise<{ tag: string }>;
  searchParams: Promise<{ project?: string; page?: string }>;
}) {
  const { tag } = await params;
  const sp = await searchParams;
  const decodedTag = decodeURIComponent(tag);
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [projects] = await Promise.all([getUserProjects(supabase, user.id)]);
  const activeProject = await getActiveProject(supabase, user.id, sp.project);
  if (!activeProject) redirect("/");

  const { lines, total } = await getTaglines(supabase, activeProject.id, decodedTag, page, PAGE_SIZE);
  const totalPages = Math.ceil(total / PAGE_SIZE);

  function pageHref(p: number) {
    const params = new URLSearchParams();
    if (sp.project) params.set("project", sp.project);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return `/tagline/${tag}${qs ? `?${qs}` : ""}`;
  }

  return (
    <div className="min-h-screen bg-background">
      <Header
        projects={projects}
        activeProject={activeProject}
        userEmail={user.email ?? ""}
      />
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-5 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to notes
        </Link>

        <div className="flex items-baseline gap-3 mb-6">
          <h1 className="text-xl font-bold">
            Tagline:{" "}
            <span className="text-blue-600">#{decodedTag}</span>
          </h1>
          <span className="text-sm text-muted-foreground">
            {total} {total === 1 ? "line" : "lines"}
          </span>
        </div>

        {total === 0 ? (
          <p className="text-muted-foreground text-sm py-8 text-center">
            No lines found for #{decodedTag}.
          </p>
        ) : (
          <>
            <div className="space-y-4">
              {lines.map((line, idx) => (
                <div key={idx} className="rounded-lg border border-border/60 bg-card p-4">
                  <div className="flex items-baseline gap-2 mb-2">
                    <Link
                      href={`/note/${line.noteId}`}
                      className="text-sm font-medium text-primary hover:underline"
                    >
                      {line.noteTitle}
                    </Link>
                    <span className="text-xs text-muted-foreground">
                      {new Date(line.noteCreatedAt).toLocaleDateString(undefined, {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                  </div>
                  <div
                    className="note-body text-sm text-foreground/90"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(line.line) }}
                  />
                </div>
              ))}
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-6 pt-4 border-t border-border/60">
                <Link
                  href={pageHref(page - 1)}
                  aria-disabled={page <= 1}
                  className={
                    page <= 1
                      ? "pointer-events-none opacity-40 inline-flex items-center gap-1 text-sm text-muted-foreground"
                      : "inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
                  }
                >
                  <ChevronLeft className="h-4 w-4" />
                  Previous
                </Link>
                <span className="text-sm text-muted-foreground">
                  Page {page} of {totalPages}
                </span>
                <Link
                  href={pageHref(page + 1)}
                  aria-disabled={page >= totalPages}
                  className={
                    page >= totalPages
                      ? "pointer-events-none opacity-40 inline-flex items-center gap-1 text-sm text-muted-foreground"
                      : "inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
                  }
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Link>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
