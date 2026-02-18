import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getActiveProject, getUserProjects, getUserSettings } from "@/lib/projects";
import { listNotes, getTagCounts, getPersonCounts } from "@/lib/notes";
import Header from "@/components/Header";
import Sidebar from "@/components/Sidebar";
import NoteRow from "@/components/NoteRow";
import type { SortKey, SortOrder } from "@/lib/types";

interface SearchParams {
  project?: string;
  search?: string;
  filter?: string;
  pg?: string;
  nn?: string;
  sk?: string;
  so?: string;
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
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [projects, settings] = await Promise.all([
    getUserProjects(supabase, user.id),
    getUserSettings(supabase, user.id),
  ]);

  const activeProject = await getActiveProject(supabase, user.id, sp.project);
  if (!activeProject) redirect("/config");

  const search = sp.search ?? "";
  const filter = sp.filter ?? "";
  const page = Number(sp.pg ?? 1);
  const perPage = Number(sp.nn ?? settings.notes_per_page);
  const sortKey = (sp.sk ?? (search ? "relevance" : "created_at")) as SortKey;
  const sortOrder = (sp.so ?? "desc") as SortOrder;
  const timeMin = sp.time_min;
  const timeMax = sp.time_max;

  const [listResult, tagCounts, peopleCounts] = await Promise.all([
    listNotes(supabase, {
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
    getTagCounts(supabase, activeProject.id),
    getPersonCounts(supabase, activeProject.id),
  ]);

  const { notes, total } = listResult;
  const totalPages = Math.ceil(total / perPage);
  const from = (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, total);

  function buildUrl(overrides: Partial<SearchParams>) {
    const params = new URLSearchParams();
    const merged = { project: activeProject!.id, search, filter, pg: String(page), nn: String(perPage), sk: sortKey, so: sortOrder, ...overrides };
    Object.entries(merged).forEach(([k, v]) => { if (v) params.set(k, v); });
    return `/?${params.toString()}`;
  }

  return (
    <>
      <Header
        projects={projects}
        activeProject={activeProject}
        userEmail={user.email ?? ""}
      />
      <div className="max-w-7xl mx-auto px-4 py-4 flex gap-6">
        {/* Sidebar */}
        <Sidebar
          tags={tagCounts}
          people={peopleCounts}
          projectId={activeProject.id}
          currentSearch={search}
          currentFilter={filter}
        />

        {/* Main content */}
        <main className="flex-1 min-w-0">
          {/* Search + filter bar */}
          <form method="get" action="/" className="flex flex-col gap-2 mb-4">
            <input type="hidden" name="project" value={activeProject.id} />
            <div className="flex gap-2">
              <input
                type="text"
                name="search"
                defaultValue={search}
                placeholder="Search notes…"
                className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm"
              />
              <button
                type="submit"
                className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700"
              >
                Search
              </button>
              {(search || filter) && (
                <Link
                  href={buildUrl({ search: "", filter: "", pg: "1" })}
                  className="px-3 py-2 border border-gray-300 rounded text-sm text-gray-600 hover:bg-gray-50"
                >
                  Clear
                </Link>
              )}
            </div>
            <div className="flex gap-2 items-center">
              <input
                type="text"
                name="filter"
                defaultValue={filter}
                placeholder="Filter: #tag @person ~#excludetag +#exclusive"
                className="flex-1 border border-gray-300 rounded px-3 py-1.5 text-sm"
              />
              <input
                type="date"
                name="time_min"
                defaultValue={timeMin}
                className="border border-gray-300 rounded px-2 py-1.5 text-sm"
              />
              <span className="text-gray-400 text-sm">–</span>
              <input
                type="date"
                name="time_max"
                defaultValue={timeMax}
                className="border border-gray-300 rounded px-2 py-1.5 text-sm"
              />
            </div>
          </form>

          {/* Sort controls + count */}
          <div className="flex items-center justify-between text-sm text-gray-500 mb-3">
            <span>
              {total === 0
                ? "No notes"
                : `Showing ${from}–${to} of ${total}`}
            </span>
            <div className="flex gap-3 items-center">
              <span>Sort:</span>
              {(["created_at", "updated_at", ...(search ? ["relevance"] : [])] as SortKey[]).map((sk) => (
                <Link
                  key={sk}
                  href={buildUrl({ sk, pg: "1" })}
                  className={sortKey === sk ? "font-semibold text-gray-800" : "hover:underline"}
                >
                  {sk === "created_at" ? "Date" : sk === "updated_at" ? "Edited" : "Relevance"}
                </Link>
              ))}
              <Link
                href={buildUrl({ so: sortOrder === "asc" ? "desc" : "asc", pg: "1" })}
                className="hover:underline"
              >
                {sortOrder === "asc" ? "↑ Asc" : "↓ Desc"}
              </Link>
            </div>
          </div>

          {/* Note list */}
          <div>
            {notes.length === 0 ? (
              <p className="text-gray-400 text-sm py-8 text-center">
                {search || filter ? "No notes match your query." : "No notes yet. Create one!"}
              </p>
            ) : (
              notes.map((note) => (
                <NoteRow
                  key={note.id}
                  note={note}
                  projectId={activeProject.id}
                  currentSearch={search}
                  currentFilter={filter}
                  showScore={!!(search && sortKey === "relevance")}
                  showUpdated={sortKey === "updated_at"}
                />
              ))
            )}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center gap-2 mt-4 text-sm">
              {page > 1 && (
                <Link href={buildUrl({ pg: String(page - 1) })} className="px-3 py-1 border rounded hover:bg-gray-50">
                  ← Prev
                </Link>
              )}
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter((p) => Math.abs(p - page) <= 2 || p === 1 || p === totalPages)
                .map((p, idx, arr) => (
                  <>
                    {idx > 0 && arr[idx - 1] !== p - 1 && (
                      <span key={`ellipsis-${p}`} className="text-gray-400">…</span>
                    )}
                    <Link
                      key={p}
                      href={buildUrl({ pg: String(p) })}
                      className={`px-3 py-1 border rounded ${p === page ? "bg-blue-600 text-white border-blue-600" : "hover:bg-gray-50"}`}
                    >
                      {p}
                    </Link>
                  </>
                ))}
              {page < totalPages && (
                <Link href={buildUrl({ pg: String(page + 1) })} className="px-3 py-1 border rounded hover:bg-gray-50">
                  Next →
                </Link>
              )}
            </div>
          )}

          {/* Export link */}
          {notes.length > 0 && (
            <div className="mt-4 text-sm">
              <Link
                href={buildUrl({ export: "1", pg: "1", nn: "9999" })}
                className="text-gray-400 hover:underline"
              >
                Export this result set →
              </Link>
            </div>
          )}
        </main>
      </div>
    </>
  );
}
