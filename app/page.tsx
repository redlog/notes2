import { redirect } from "next/navigation";
import Link from "next/link";
import { getAuthUser } from "@/lib/auth";
import { getProvider } from "@/lib/providers";
import AppShell from "@/components/AppShell";
import SearchBar from "@/components/SearchBar";
import NoteRow from "@/components/NoteRow";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Download, ArrowUpDown } from "lucide-react";
import type { SortKey, SortOrder } from "@/lib/types";

interface SearchParams {
  project?: string;
  search?: string;
  filter?: string;
  pg?: string;
  nn?: string;
  sk?: string;
  so?: string;
  pv?: string;
  time_min?: string;
  time_max?: string;
  export?: string;
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
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
  if (!activeProject) redirect("/config");

  const search = sp.search ?? "";
  const filter = sp.filter ?? "";
  const page = Number(sp.pg ?? 1);
  const perPage = Number(sp.nn ?? settings.notes_per_page);
  const sortKey = (sp.sk ?? (search ? "relevance" : "created_at")) as SortKey;
  const sortOrder = (sp.so ?? "desc") as SortOrder;
  const showPreview = sp.pv === "1";
  const timeMin = sp.time_min;
  const timeMax = sp.time_max;

  const [listResult, tagCounts, peopleCounts, earliestDate] = await Promise.all([
    provider.notes.list({
      projectId: activeProject.id,
      search,
      filter,
      page,
      perPage,
      sortKey,
      sortOrder,
      timeMin,
      timeMax,
    }),
    provider.notes.getTagCounts(activeProject.id),
    provider.notes.getPersonCounts(activeProject.id),
    provider.notes.getEarliestNoteDate(activeProject.id),
  ]);

  const today = new Date().toISOString().split("T")[0];
  const defaultMin = timeMin ?? earliestDate ?? "";
  const defaultMax = timeMax ?? today;
  void defaultMin;
  void defaultMax;

  const { notes, total } = listResult;
  const totalPages = Math.ceil(total / perPage);
  const from = (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, total);

  function buildUrl(overrides: Partial<SearchParams>) {
    const params = new URLSearchParams();
    const merged = {
      search,
      filter,
      pg: String(page),
      nn: String(perPage),
      sk: sortKey,
      so: sortOrder,
      pv: showPreview ? "1" : undefined,
      ...overrides,
    };
    Object.entries(merged).forEach(([k, v]) => { if (v) params.set(k, v); });
    return `/?${params.toString()}`;
  }

  const sortKeys: SortKey[] = ["created_at", "updated_at", ...(search ? ["relevance" as SortKey] : [])];

  return (
    <AppShell
      projects={projects}
      activeProject={activeProject}
      userEmail={user.email}
      localMode={process.env.PROVIDER === "sqlite"}
      tags={tagCounts}
      people={peopleCounts}
      toolbar={<SearchBar earliestDate={earliestDate ?? ""} />}
    >
      <main className="px-4 sm:px-6 py-5 max-w-4xl mx-auto lg:max-w-none w-full">

        {/* Result meta row */}
        <div className="flex items-center justify-between text-sm text-muted-foreground mb-3">
          <span>
            {total === 0
              ? "No notes"
              : `${from}–${to} of ${total}`}
          </span>
          <div className="flex items-center gap-1">
            <ArrowUpDown className="h-3.5 w-3.5" />
            <span className="mr-1">Sort:</span>
            {sortKeys.map((sk) => (
              <Link
                key={sk}
                href={buildUrl({ sk, pg: "1" })}
                className={`px-2 py-1.5 lg:py-0.5 rounded text-xs transition-colors ${
                  sortKey === sk
                    ? "bg-primary text-primary-foreground font-medium"
                    : "hover:bg-muted"
                }`}
              >
                {sk === "created_at" ? "Date" : sk === "updated_at" ? "Edited" : "Relevance"}
              </Link>
            ))}
            <Link
              href={buildUrl({ so: sortOrder === "asc" ? "desc" : "asc", pg: "1" })}
              className="px-2 py-1.5 lg:py-0.5 rounded text-xs hover:bg-muted transition-colors ml-1"
            >
              {sortOrder === "asc" ? "↑" : "↓"}
            </Link>
            <Link
              href={buildUrl({ pv: showPreview ? "0" : "1" })}
              className="flex items-center gap-1.5 px-2 py-1.5 lg:py-0.5 rounded text-xs hover:bg-muted transition-colors ml-2"
            >
              <span className={`h-3.5 w-3.5 border rounded-sm flex items-center justify-center shrink-0 transition-colors ${showPreview ? "bg-primary border-primary text-primary-foreground" : "border-muted-foreground/50"}`}>
                {showPreview && <span className="text-[9px] leading-none font-bold">✓</span>}
              </span>
              Previews
            </Link>
          </div>
        </div>

        {/* Note list */}
        <div className="space-y-0">
          {notes.length === 0 ? (
            <div className="text-center py-16">
              <div className="text-muted-foreground text-sm">
                {search || filter
                  ? "No notes match your query."
                  : "No notes yet. Create your first note!"}
              </div>
              {!search && !filter && (
                <Button asChild className="mt-4 gap-1.5">
                  <Link href="/new">Create a note</Link>
                </Button>
              )}
            </div>
          ) : (
            notes.map((note) => (
              <NoteRow
                key={note.id}
                note={note}
                currentSearch={search}
                currentFilter={filter}
                showScore={!!(search && sortKey === "relevance")}
                showUpdated={sortKey === "updated_at"}
                showPreview={showPreview}
              />
            ))
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-1 mt-6">
            {page > 1 && (
              <Button variant="outline" size="sm" asChild>
                <Link href={buildUrl({ pg: String(page - 1) })}>
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
                    <Link href={buildUrl({ pg: String(p) })}>{p}</Link>
                  </Button>
                </span>
              ))}
            {page < totalPages && (
              <Button variant="outline" size="sm" asChild>
                <Link href={buildUrl({ pg: String(page + 1) })}>
                  <ChevronRight className="h-4 w-4" />
                </Link>
              </Button>
            )}
          </div>
        )}

        {/* Export */}
        {notes.length > 0 && (
          <div className="mt-5 flex justify-end">
            <Link
              href={buildUrl({ export: "1", pg: "1", nn: "9999" })}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
            >
              <Download className="h-3 w-3" />
              Export results
            </Link>
          </div>
        )}
      </main>
    </AppShell>
  );
}
