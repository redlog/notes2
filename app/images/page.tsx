import { redirect } from "next/navigation";
import Link from "next/link";
import { getAuthUser } from "@/lib/auth";
import { getProvider } from "@/lib/providers";
import AppShell from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, ImageIcon } from "lucide-react";

export default async function ImagesPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; pg?: string }>;
}) {
  const sp = await searchParams;
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const provider = await getProvider();

  const [projects, settings] = await Promise.all([
    provider.projects.getUserProjects(user.id),
    provider.projects.getUserSettings(user.id),
  ]);
  void settings;

  const activeProject = await provider.projects.getActive(user.id, sp.project);
  if (!activeProject) redirect("/");

  const page = Math.max(1, Number(sp.pg ?? 1));
  const perPage = 24;

  const [galleryResult, tagCounts, peopleCounts] = await Promise.all([
    provider.notes.listImages(activeProject.id, page, perPage),
    provider.notes.getTagCounts(activeProject.id),
    provider.notes.getPersonCounts(activeProject.id),
  ]);

  const { images, total } = galleryResult;
  const totalPages = Math.ceil(total / perPage);
  const from = total === 0 ? 0 : (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, total);

  function buildUrl(pg: number) {
    const params = new URLSearchParams();
    if (sp.project) params.set("project", sp.project);
    if (pg > 1) params.set("pg", String(pg));
    const qs = params.toString();
    return `/images${qs ? `?${qs}` : ""}`;
  }

  return (
    <AppShell
      projects={projects}
      activeProject={activeProject}
      userEmail={user.email}
      tags={tagCounts}
      people={peopleCounts}
    >
      <main className="px-4 sm:px-6 py-5 max-w-4xl mx-auto lg:max-w-none">
        {/* Header row */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <ImageIcon className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-base font-semibold">Images</h1>
            {total > 0 && (
              <span className="text-sm text-muted-foreground">
                {from}–{to} of {total}
              </span>
            )}
          </div>
          <Link
            href={sp.project ? `/?project=${sp.project}` : "/"}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            ← Notes
          </Link>
        </div>

        {/* Grid */}
        {images.length === 0 ? (
          <div className="text-center py-20">
            <ImageIcon className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-muted-foreground text-sm">No images in this project yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-2">
            {images.map((img) => (
              <Link
                key={`${img.note_id}-${img.img_num}`}
                href={`/note/${img.note_id}`}
                className="group relative aspect-square overflow-hidden rounded-lg border border-border bg-muted/40 hover:border-primary/50 transition-colors"
              >
                {img.signed_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={img.signed_url}
                    alt={img.note_title}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <ImageIcon className="h-6 w-6 text-muted-foreground/30" />
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="absolute bottom-0 left-0 right-0 p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <p className="text-white text-xs truncate leading-tight drop-shadow">
                    {img.note_title}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-1 mt-6">
            {page > 1 && (
              <Button variant="outline" size="sm" asChild>
                <Link href={buildUrl(page - 1)}>
                  <ChevronLeft className="h-4 w-4" />
                </Link>
              </Button>
            )}
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter((p) => Math.abs(p - page) <= 2 || p === 1 || p === totalPages)
              .map((p, idx, arr) => (
                <span key={p} className="contents">
                  {idx > 0 && arr[idx - 1] !== p - 1 && (
                    <span className="px-1 text-muted-foreground text-sm">…</span>
                  )}
                  <Button
                    variant={p === page ? "default" : "outline"}
                    size="sm"
                    asChild
                    className="min-w-[2rem]"
                  >
                    <Link href={buildUrl(p)}>{p}</Link>
                  </Button>
                </span>
              ))}
            {page < totalPages && (
              <Button variant="outline" size="sm" asChild>
                <Link href={buildUrl(page + 1)}>
                  <ChevronRight className="h-4 w-4" />
                </Link>
              </Button>
            )}
          </div>
        )}
      </main>
    </AppShell>
  );
}
