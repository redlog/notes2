"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import TagPill from "./TagPill";
import type { NoteListItem } from "@/lib/types";
import { Pencil, Copy, ChevronDown, ChevronUp, Calendar } from "lucide-react";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";

interface Props {
  note: NoteListItem;
  currentSearch?: string;
  currentFilter?: string;
  showScore?: boolean;
  bodyMode?: "none" | "preview" | "full";
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
  currentSearch = "",
  currentFilter = "",
  showScore = false,
  bodyMode = "preview",
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [body, setBody] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function loadBody() {
    setLoading(true);
    const res = await fetch(`/api/rendered-note-body?id=${note.id}`);
    const data = await res.json();
    setBody(data.html ?? "");
    setLoading(false);
  }

  async function toggle() {
    if (!expanded && body === null) await loadBody();
    setExpanded((v) => !v);
  }

  // In "full" mode, every row shows its rendered body inline — fetch it eagerly.
  useEffect(() => {
    if (bodyMode !== "full" || body !== null) return;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/rendered-note-body?id=${note.id}`)
      .then((res) => res.json())
      .then((data) => { if (!cancelled) setBody(data.html ?? ""); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [bodyMode, body, note.id]);

  const headerTags = note.tags.filter((t) => t.is_header);
  const mentionTags = note.tags.filter((t) => !t.is_header);
  const headerPeople = note.people.filter((p) => p.is_header);
  const mentionPeople = note.people.filter((p) => !p.is_header);
  const hasTags = headerTags.length + mentionTags.length + headerPeople.length + mentionPeople.length > 0;

  return (
    <TooltipProvider delayDuration={500}>
      <div className="group py-3 px-1 border-b border-border/60 hover:bg-muted/30 transition-colors rounded-sm -mx-1">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            {/* Title */}
            <Link
              href={`/note/${note.id}`}
              className="font-medium text-foreground hover:text-primary transition-colors line-clamp-2 leading-snug"
            >
              {note.title || <span className="text-foreground/40 italic">Untitled</span>}
            </Link>

            {/* Tags */}
            {hasTags && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {headerTags.map((t) => (
                  <TagPill
                    key={`ht-${t.tag}`}
                    tag={t.tag}
                    isHeader
                    currentSearch={currentSearch}
                    currentFilter={currentFilter}
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
                    variant="person"
                  />
                ))}
              </div>
            )}

            {/* Body preview — wide screens only, hidden when expanded or in full mode */}
            {note.preview && bodyMode === "preview" && !expanded && (
              <p className="hidden xl:block text-xs text-muted-foreground/70 mt-1.5 line-clamp-2 leading-relaxed">
                {note.preview}
              </p>
            )}

            {/* Date row */}
            <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                {fmt(note.created_at)}
              </span>
              {note.updated_at !== note.created_at && (
                <span>edited {fmt(note.updated_at)}</span>
              )}
              {showScore && note.score !== undefined && (
                <span className="text-muted-foreground/60">score: {note.score.toFixed(3)}</span>
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-0.5 shrink-0 transition-opacity opacity-60 group-hover:opacity-100 lg:opacity-0 lg:group-hover:opacity-100">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-9 w-9 lg:h-7 lg:w-7" asChild>
                  <Link href={`/edit/${note.id}`}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Edit</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-9 w-9 lg:h-7 lg:w-7" asChild>
                  <Link href={`/clone/${note.id}`}>
                    <Copy className="h-3.5 w-3.5" />
                  </Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Clone</TooltipContent>
            </Tooltip>

            {bodyMode !== "full" && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-9 w-9 lg:h-7 lg:w-7" onClick={toggle}>
                    {expanded
                      ? <ChevronUp className="h-3.5 w-3.5" />
                      : <ChevronDown className="h-3.5 w-3.5" />
                    }
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{expanded ? "Collapse" : "Expand"}</TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>

        {/* Expanded body (manual toggle, "none"/"preview" modes) */}
        {bodyMode !== "full" && expanded && (
          <div className="mt-3 pl-0">
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                <div className="h-3 w-3 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                Loading…
              </div>
            ) : (
              <div
                className="note-body text-sm text-foreground/90 border-l-2 border-border pl-3"
                dangerouslySetInnerHTML={{ __html: body ?? "" }}
              />
            )}
          </div>
        )}

        {/* Full rendered body — always shown inline in "full" mode */}
        {bodyMode === "full" && (
          <div className="mt-3 pl-0">
            {loading || body === null ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                <div className="h-3 w-3 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                Loading…
              </div>
            ) : (
              <div
                className="note-body text-sm text-foreground/90 border-l-2 border-border pl-3"
                dangerouslySetInnerHTML={{ __html: body }}
              />
            )}
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
