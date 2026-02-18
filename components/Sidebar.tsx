"use client";

import { useState } from "react";
import Link from "next/link";
import type { TagCount, PersonCount } from "@/lib/types";

interface Props {
  tags: TagCount[];
  people: PersonCount[];
  projectId: string;
  currentSearch?: string;
  currentFilter?: string;
}

type SortMode = "count" | "name";

function addFilterToken(
  currentFilter: string,
  token: string
): string {
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
  projectId,
  currentSearch = "",
  currentFilter = "",
}: Props) {
  const [tagSort, setTagSort] = useState<SortMode>("count");
  const [personSort, setPersonSort] = useState<SortMode>("count");
  const [tagFilter, setTagFilter] = useState("");
  const [personFilter, setPersonFilter] = useState("");

  const sortedTags = [...tags]
    .filter((t) => t.tag.includes(tagFilter))
    .sort(
      tagSort === "count"
        ? (a, b) => b.count - a.count
        : (a, b) => a.tag.localeCompare(b.tag)
    );

  const sortedPeople = [...people]
    .filter((p) => p.person.includes(personFilter))
    .sort(
      personSort === "count"
        ? (a, b) => b.count - a.count
        : (a, b) => a.person.localeCompare(b.person)
    );

  function filterHref(token: string) {
    const params = new URLSearchParams();
    if (projectId) params.set("project", projectId);
    if (currentSearch) params.set("search", currentSearch);
    const newFilter = addFilterToken(currentFilter, token);
    if (newFilter) params.set("filter", newFilter);
    return `/?${params.toString()}`;
  }

  return (
    <aside className="w-56 shrink-0 text-sm space-y-4">
      {/* Tags */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="font-semibold text-gray-700">Tags</span>
          <span className="text-xs text-gray-400 space-x-1">
            <button
              onClick={() => setTagSort("count")}
              className={tagSort === "count" ? "font-bold" : "hover:underline"}
            >
              #
            </button>
            <button
              onClick={() => setTagSort("name")}
              className={tagSort === "name" ? "font-bold" : "hover:underline"}
            >
              A
            </button>
          </span>
        </div>
        <input
          type="text"
          placeholder="filter…"
          value={tagFilter}
          onChange={(e) => setTagFilter(e.target.value)}
          className="w-full border border-gray-200 rounded px-2 py-0.5 text-xs mb-1"
        />
        <ul className="space-y-0.5 max-h-64 overflow-y-auto">
          {sortedTags.map((t) => (
            <li key={t.tag} className="flex items-center justify-between">
              <Link
                href={filterHref(`#${t.tag}`)}
                className="text-blue-700 hover:underline truncate flex-1"
              >
                #{t.tag}
              </Link>
              <span className="text-gray-400 text-xs ml-1">{t.count}</span>
              <Link
                href={`/tagline/${encodeURIComponent(t.tag)}?project=${projectId}`}
                className="text-gray-400 hover:text-gray-600 text-xs ml-1"
                title="Tagline view"
              >
                TL
              </Link>
            </li>
          ))}
          {sortedTags.length === 0 && (
            <li className="text-gray-400 text-xs">No tags</li>
          )}
        </ul>
      </div>

      {/* People */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="font-semibold text-gray-700">People</span>
          <span className="text-xs text-gray-400 space-x-1">
            <button
              onClick={() => setPersonSort("count")}
              className={personSort === "count" ? "font-bold" : "hover:underline"}
            >
              #
            </button>
            <button
              onClick={() => setPersonSort("name")}
              className={personSort === "name" ? "font-bold" : "hover:underline"}
            >
              A
            </button>
          </span>
        </div>
        <input
          type="text"
          placeholder="filter…"
          value={personFilter}
          onChange={(e) => setPersonFilter(e.target.value)}
          className="w-full border border-gray-200 rounded px-2 py-0.5 text-xs mb-1"
        />
        <ul className="space-y-0.5 max-h-64 overflow-y-auto">
          {sortedPeople.map((p) => (
            <li key={p.person} className="flex items-center justify-between">
              <Link
                href={filterHref(`@${p.person}`)}
                className="text-purple-700 hover:underline truncate flex-1"
              >
                @{p.person}
              </Link>
              <span className="text-gray-400 text-xs ml-1">{p.count}</span>
            </li>
          ))}
          {sortedPeople.length === 0 && (
            <li className="text-gray-400 text-xs">No people</li>
          )}
        </ul>
      </div>
    </aside>
  );
}
