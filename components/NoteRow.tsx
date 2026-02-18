"use client";

import { useState } from "react";
import Link from "next/link";
import TagPill from "./TagPill";
import type { NoteListItem } from "@/lib/types";

interface Props {
  note: NoteListItem;
  projectId: string;
  currentSearch?: string;
  currentFilter?: string;
  showScore?: boolean;
  showUpdated?: boolean;
}

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function NoteRow({
  note,
  projectId,
  currentSearch = "",
  currentFilter = "",
  showScore = false,
  showUpdated = false,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [body, setBody] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function toggle() {
    if (!expanded && body === null) {
      setLoading(true);
      const res = await fetch(
        `/api/rendered-note-body?id=${note.id}`
      );
      const data = await res.json();
      setBody(data.html ?? "");
      setLoading(false);
    }
    setExpanded((v) => !v);
  }

  const headerTags = note.tags.filter((t) => t.is_header);
  const mentionTags = note.tags.filter((t) => !t.is_header);
  const headerPeople = note.people.filter((p) => p.is_header);
  const mentionPeople = note.people.filter((p) => !p.is_header);

  return (
    <div className="border-b border-gray-100 py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <Link
            href={`/note/${note.id}`}
            className="font-medium text-blue-700 hover:underline break-words"
          >
            {note.title}
          </Link>

          <div className="flex flex-wrap gap-1 mt-1">
            {headerTags.map((t) => (
              <TagPill
                key={`ht-${t.tag}`}
                tag={t.tag}
                isHeader
                currentSearch={currentSearch}
                currentFilter={currentFilter}
                currentProject={projectId}
                variant="tag"
              />
            ))}
            {headerPeople.map((p) => (
              <TagPill
                key={`hp-${p.person}`}
                tag={p.person}
                isHeader
                currentSearch={currentSearch}
                currentFilter={currentFilter}
                currentProject={projectId}
                variant="person"
              />
            ))}
            {mentionTags.map((t) => (
              <TagPill
                key={`mt-${t.tag}`}
                tag={t.tag}
                isHeader={false}
                currentSearch={currentSearch}
                currentFilter={currentFilter}
                currentProject={projectId}
                variant="tag"
              />
            ))}
            {mentionPeople.map((p) => (
              <TagPill
                key={`mp-${p.person}`}
                tag={p.person}
                isHeader={false}
                currentSearch={currentSearch}
                currentFilter={currentFilter}
                currentProject={projectId}
                variant="person"
              />
            ))}
          </div>

          <div className="text-xs text-gray-400 mt-1 flex gap-3">
            <span>{fmt(note.created_at)}</span>
            {showUpdated && (
              <span>edited {fmt(note.updated_at)}</span>
            )}
            {showScore && note.score !== undefined && (
              <span>score: {note.score.toFixed(3)}</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 text-sm">
          <Link
            href={`/edit/${note.id}`}
            className="text-gray-500 hover:text-gray-800"
          >
            Edit
          </Link>
          <Link
            href={`/clone/${note.id}`}
            className="text-gray-500 hover:text-gray-800"
          >
            Clone
          </Link>
          <button
            onClick={toggle}
            className="text-gray-500 hover:text-gray-800"
          >
            {expanded ? "Collapse" : "Expand"}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-3 pl-0">
          {loading ? (
            <p className="text-sm text-gray-400">Loading…</p>
          ) : (
            <div
              className="note-body text-sm"
              dangerouslySetInnerHTML={{ __html: body ?? "" }}
            />
          )}
        </div>
      )}
    </div>
  );
}
