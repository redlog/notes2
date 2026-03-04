"use client";

import { useState } from "react";
import Link from "next/link";
import type { TagCount, PersonCount } from "@/lib/types";
import { Hash, Users, ArrowUpDown, Type, AlignLeft } from "lucide-react";
import { Input } from "./ui/input";
import { ScrollArea } from "./ui/scroll-area";
import { cn } from "@/lib/utils";

interface Props {
  tags: TagCount[];
  people: PersonCount[];
  currentSearch?: string;
  currentFilter?: string;
  onNavigate?: () => void;
}

type SortMode = "count" | "name";

function addFilterToken(currentFilter: string, token: string): string {
  const tokens = currentFilter
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (tokens.includes(token)) return currentFilter;
  return [...tokens, token].join(" ");
}

export default function Sidebar({
  tags,
  people,
  currentSearch = "",
  currentFilter = "",
  onNavigate,
}: Props) {
  const [tagSort, setTagSort] = useState<SortMode>("count");
  const [personSort, setPersonSort] = useState<SortMode>("count");
  const [tagFilter, setTagFilter] = useState("");
  const [personFilter, setPersonFilter] = useState("");

  const sortedTags = [...tags]
    .filter((t) => t.tag.toLowerCase().includes(tagFilter.toLowerCase()))
    .sort(
      tagSort === "count"
        ? (a, b) => b.count - a.count
        : (a, b) => a.tag.localeCompare(b.tag)
    );

  const sortedPeople = [...people]
    .filter((p) => p.person.toLowerCase().includes(personFilter.toLowerCase()))
    .sort(
      personSort === "count"
        ? (a, b) => b.count - a.count
        : (a, b) => a.person.localeCompare(b.person)
    );

  function filterHref(token: string) {
    const params = new URLSearchParams();
    if (currentSearch) params.set("search", currentSearch);
    const newFilter = addFilterToken(currentFilter, token);
    if (newFilter) params.set("filter", newFilter);
    return `/?${params.toString()}`;
  }

  return (
    <div className="space-y-5 text-sm">
      {/* Tags section */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5 font-semibold text-foreground text-xs uppercase tracking-wider">
            <Hash className="h-3.5 w-3.5 text-blue-500" />
            <span>Tags</span>
            {tags.length > 0 && (
              <span className="text-muted-foreground font-normal">({tags.length})</span>
            )}
          </div>
          <div className="flex gap-0.5">
            <button
              onClick={() => setTagSort("count")}
              title="Sort by count"
              className={cn(
                "p-1 rounded text-muted-foreground hover:text-foreground transition-colors",
                tagSort === "count" && "text-primary bg-primary/10"
              )}
            >
              <ArrowUpDown className="h-3 w-3" />
            </button>
            <button
              onClick={() => setTagSort("name")}
              title="Sort by name"
              className={cn(
                "p-1 rounded text-muted-foreground hover:text-foreground transition-colors",
                tagSort === "name" && "text-primary bg-primary/10"
              )}
            >
              <Type className="h-3 w-3" />
            </button>
          </div>
        </div>

        {tags.length > 5 && (
          <Input
            type="text"
            placeholder="Filter tags…"
            value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value)}
            className="h-7 text-xs mb-2"
          />
        )}

        <ScrollArea className="max-h-52">
          <ul className="space-y-0.5 pr-1">
            {sortedTags.map((t) => (
              <li key={t.tag} className="flex items-center justify-between group">
                <Link
                  href={filterHref(`#${t.tag}`)}
                  onClick={onNavigate}
                  className="flex-1 truncate text-blue-700 hover:text-blue-900 hover:bg-blue-50 rounded px-1.5 py-0.5 transition-colors"
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
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-all"
                  >
                    <AlignLeft className="h-3 w-3" />
                  </Link>
                </div>
              </li>
            ))}
            {sortedTags.length === 0 && (
              <li className="text-muted-foreground text-xs py-1 px-1.5">No tags yet</li>
            )}
          </ul>
        </ScrollArea>
      </div>

      {/* People section */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5 font-semibold text-foreground text-xs uppercase tracking-wider">
            <Users className="h-3.5 w-3.5 text-violet-500" />
            <span>People</span>
            {people.length > 0 && (
              <span className="text-muted-foreground font-normal">({people.length})</span>
            )}
          </div>
          <div className="flex gap-0.5">
            <button
              onClick={() => setPersonSort("count")}
              title="Sort by count"
              className={cn(
                "p-1 rounded text-muted-foreground hover:text-foreground transition-colors",
                personSort === "count" && "text-primary bg-primary/10"
              )}
            >
              <ArrowUpDown className="h-3 w-3" />
            </button>
            <button
              onClick={() => setPersonSort("name")}
              title="Sort by name"
              className={cn(
                "p-1 rounded text-muted-foreground hover:text-foreground transition-colors",
                personSort === "name" && "text-primary bg-primary/10"
              )}
            >
              <Type className="h-3 w-3" />
            </button>
          </div>
        </div>

        {people.length > 5 && (
          <Input
            type="text"
            placeholder="Filter people…"
            value={personFilter}
            onChange={(e) => setPersonFilter(e.target.value)}
            className="h-7 text-xs mb-2"
          />
        )}

        <ScrollArea className="max-h-52">
          <ul className="space-y-0.5 pr-1">
            {sortedPeople.map((p) => (
              <li key={p.person} className="flex items-center justify-between">
                <Link
                  href={filterHref(`@${p.person}`)}
                  onClick={onNavigate}
                  className="flex-1 truncate text-violet-700 hover:text-violet-900 hover:bg-violet-50 rounded px-1.5 py-0.5 transition-colors"
                >
                  <span className="text-violet-400 mr-0.5">@</span>
                  {p.person}
                </Link>
                <span className="text-muted-foreground text-xs tabular-nums ml-1 shrink-0">{p.count}</span>
              </li>
            ))}
            {sortedPeople.length === 0 && (
              <li className="text-muted-foreground text-xs py-1 px-1.5">No people yet</li>
            )}
          </ul>
        </ScrollArea>
      </div>
    </div>
  );
}
