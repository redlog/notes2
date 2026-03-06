"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import type { TagCount, PersonCount } from "@/lib/types";
import { Hash, Users, AlignLeft, ArrowUp, ArrowDown, ArrowUpDown, Type } from "lucide-react";
import { Input } from "./ui/input";
import { cn } from "@/lib/utils";

interface Props {
  tags: TagCount[];
  people: PersonCount[];
  onNavigate?: () => void;
}

type SortKey = "count" | "name";
type SortDir = "asc" | "desc";
type SortMode = `${SortKey}-${SortDir}`;

const DEFAULT_DIR: Record<SortKey, SortDir> = { count: "desc", name: "asc" };

function toggleSort(current: SortMode, key: SortKey): SortMode {
  const [currentKey, currentDir] = current.split("-") as [SortKey, SortDir];
  if (currentKey === key) {
    return `${key}-${currentDir === "asc" ? "desc" : "asc"}`;
  }
  return `${key}-${DEFAULT_DIR[key]}`;
}

function DirIcon({ mode, sortKey }: { mode: SortMode; sortKey: SortKey }) {
  const [key, dir] = mode.split("-") as [SortKey, SortDir];
  if (key !== sortKey) return sortKey === "count" ? <ArrowUpDown className="h-3 w-3" /> : <Type className="h-3 w-3" />;
  return dir === "asc"
    ? <ArrowUp className="h-3 w-3" />
    : <ArrowDown className="h-3 w-3" />;
}


export default function Sidebar({
  tags,
  people,
  onNavigate,
}: Props) {
  const searchParams = useSearchParams();
  const [tagSort, setTagSort] = useState<SortMode>("count-desc");
  const [personSort, setPersonSort] = useState<SortMode>("count-desc");
  const [tagFilter, setTagFilter] = useState("");
  const [personFilter, setPersonFilter] = useState("");

  const [tagSortKey, tagSortDir] = tagSort.split("-") as [SortKey, SortDir];
  const [personSortKey, personSortDir] = personSort.split("-") as [SortKey, SortDir];

  const sortedTags = [...tags]
    .filter((t) => t.tag.toLowerCase().includes(tagFilter.toLowerCase()))
    .sort((a, b) => {
      const cmp =
        tagSortKey === "count" ? a.count - b.count : a.tag.localeCompare(b.tag);
      return tagSortDir === "asc" ? cmp : -cmp;
    });

  const sortedPeople = [...people]
    .filter((p) => p.person.toLowerCase().includes(personFilter.toLowerCase()))
    .sort((a, b) => {
      const cmp =
        personSortKey === "count"
          ? a.count - b.count
          : a.person.localeCompare(b.person);
      return personSortDir === "asc" ? cmp : -cmp;
    });

  function filterHref(token: string) {
    const params = new URLSearchParams();
    const project = searchParams.get("project");
    if (project) params.set("project", project);
    params.set("filter", token);
    return `/?${params.toString()}`;
  }

  return (
    <div className="flex gap-3 text-sm h-full">
      {/* ── Tags column ─────────────────────────────────────── */}
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1 font-semibold text-foreground text-xs uppercase tracking-wider">
            <Hash className="h-3.5 w-3.5 text-blue-500 shrink-0" />
            <span>Tags</span>
            {tags.length > 0 && (
              <span className="text-muted-foreground font-normal">({tags.length})</span>
            )}
          </div>
          <div className="flex gap-0.5 shrink-0">
            <button
              onClick={() => setTagSort((s) => toggleSort(s, "count"))}
              title={`Sort by count (${tagSortKey === "count" ? (tagSortDir === "asc" ? "ascending" : "descending") : "click to switch"})`}
              className={cn(
                "p-1 rounded text-muted-foreground hover:text-foreground transition-colors",
                tagSortKey === "count" && "text-primary bg-primary/10"
              )}
            >
              <DirIcon mode={tagSort} sortKey="count" />
            </button>
            <button
              onClick={() => setTagSort((s) => toggleSort(s, "name"))}
              title={`Sort by name (${tagSortKey === "name" ? (tagSortDir === "asc" ? "A→Z" : "Z→A") : "click to switch"})`}
              className={cn(
                "p-1 rounded text-muted-foreground hover:text-foreground transition-colors",
                tagSortKey === "name" && "text-primary bg-primary/10"
              )}
            >
              <DirIcon mode={tagSort} sortKey="name" />
            </button>
          </div>
        </div>

        <Input
          type="text"
          placeholder="Filter…"
          value={tagFilter}
          onChange={(e) => setTagFilter(e.target.value)}
          className="h-7 text-xs mb-2"
        />

        <div className="flex-1 overflow-y-auto min-h-0">
          <ul className="space-y-0.5 pr-1">
            {sortedTags.map((t) => (
              <li key={t.tag} className="flex items-center justify-between group">
                <Link
                  href={filterHref(`#${t.tag}`)}
                  onClick={onNavigate}
                  className="flex-1 truncate text-blue-700 hover:text-blue-900 hover:bg-blue-50 rounded px-1.5 py-2 lg:py-0.5 transition-colors"
                >
                  <span className="text-blue-400 mr-0.5">#</span>
                  {t.tag}
                </Link>
                <div className="flex items-center gap-1 shrink-0 ml-1">
                  <span className="text-muted-foreground text-xs tabular-nums">{t.count}</span>
                  <Link
                    href={`/tagline/${encodeURIComponent(t.tag)}`}
                    onClick={onNavigate}
                    title="Tagline view"
                    className="p-1 -mr-1 rounded opacity-60 group-hover:opacity-100 text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
                  >
                    <AlignLeft className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </li>
            ))}
            {sortedTags.length === 0 && (
              <li className="text-muted-foreground text-xs py-1 px-1.5">
                {tagFilter ? "No matches" : "No tags yet"}
              </li>
            )}
          </ul>
        </div>
      </div>

      {/* Divider */}
      <div className="w-px bg-border shrink-0" />

      {/* ── People column ────────────────────────────────────── */}
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1 font-semibold text-foreground text-xs uppercase tracking-wider">
            <Users className="h-3.5 w-3.5 text-violet-500 shrink-0" />
            <span>People</span>
            {people.length > 0 && (
              <span className="text-muted-foreground font-normal">({people.length})</span>
            )}
          </div>
          <div className="flex gap-0.5 shrink-0">
            <button
              onClick={() => setPersonSort((s) => toggleSort(s, "count"))}
              title={`Sort by count (${personSortKey === "count" ? (personSortDir === "asc" ? "ascending" : "descending") : "click to switch"})`}
              className={cn(
                "p-1 rounded text-muted-foreground hover:text-foreground transition-colors",
                personSortKey === "count" && "text-primary bg-primary/10"
              )}
            >
              <DirIcon mode={personSort} sortKey="count" />
            </button>
            <button
              onClick={() => setPersonSort((s) => toggleSort(s, "name"))}
              title={`Sort by name (${personSortKey === "name" ? (personSortDir === "asc" ? "A→Z" : "Z→A") : "click to switch"})`}
              className={cn(
                "p-1 rounded text-muted-foreground hover:text-foreground transition-colors",
                personSortKey === "name" && "text-primary bg-primary/10"
              )}
            >
              <DirIcon mode={personSort} sortKey="name" />
            </button>
          </div>
        </div>

        <Input
          type="text"
          placeholder="Filter…"
          value={personFilter}
          onChange={(e) => setPersonFilter(e.target.value)}
          className="h-7 text-xs mb-2"
        />

        <div className="flex-1 overflow-y-auto min-h-0">
          <ul className="space-y-0.5 pr-1">
            {sortedPeople.map((p) => (
              <li key={p.person} className="flex items-center justify-between">
                <Link
                  href={filterHref(`@${p.person}`)}
                  onClick={onNavigate}
                  className="flex-1 truncate text-violet-700 hover:text-violet-900 hover:bg-violet-50 rounded px-1.5 py-2 lg:py-0.5 transition-colors"
                >
                  <span className="text-violet-400 mr-0.5">@</span>
                  {p.person}
                </Link>
                <span className="text-muted-foreground text-xs tabular-nums ml-1 shrink-0 min-w-[1.5rem] text-right">{p.count}</span>
              </li>
            ))}
            {sortedPeople.length === 0 && (
              <li className="text-muted-foreground text-xs py-1 px-1.5">
                {personFilter ? "No matches" : "No people yet"}
              </li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}
