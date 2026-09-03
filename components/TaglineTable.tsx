"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp, ChevronsUpDown, Pencil } from "lucide-react";

export type TaglineRow = {
  noteId: number;
  noteTitle: string;
  noteCreatedAt: string;
  line: string;
  lineHtml: string;
};

type SortKey = "title" | "date" | "content";
type SortOrder = "asc" | "desc";

export default function TaglineTable({ rows }: { rows: TaglineRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      // Sensible default direction per column.
      setSortOrder(key === "date" ? "desc" : "asc");
    }
  }

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "date") {
        cmp =
          new Date(a.noteCreatedAt).getTime() -
          new Date(b.noteCreatedAt).getTime();
      } else if (sortKey === "title") {
        cmp = a.noteTitle.localeCompare(b.noteTitle);
      } else {
        cmp = a.line.localeCompare(b.line);
      }
      return sortOrder === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [rows, sortKey, sortOrder]);

  return (
    <div className="overflow-x-auto rounded-lg border border-border/60">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/60 bg-muted/40 text-left">
            <SortHeader
              label="Note Title"
              active={sortKey === "title"}
              order={sortOrder}
              onClick={() => toggleSort("title")}
              className="w-1/4"
            />
            <SortHeader
              label="Date"
              active={sortKey === "date"}
              order={sortOrder}
              onClick={() => toggleSort("date")}
              className="w-32 whitespace-nowrap"
            />
            <SortHeader
              label="Content"
              active={sortKey === "content"}
              order={sortOrder}
              onClick={() => toggleSort("content")}
            />
            <th className="px-3 py-2.5 font-medium w-16" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, idx) => (
            <tr
              key={idx}
              className="border-b border-border/40 last:border-0 align-top hover:bg-muted/20"
            >
              <td className="px-3 py-2.5">
                <Link
                  href={`/note/${row.noteId}`}
                  className="font-medium text-primary hover:underline"
                >
                  {row.noteTitle}
                </Link>
              </td>
              <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">
                {new Date(row.noteCreatedAt).toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })}
              </td>
              <td className="px-3 py-2.5">
                <div
                  className="note-body text-foreground/90"
                  dangerouslySetInnerHTML={{ __html: row.lineHtml }}
                />
              </td>
              <td className="px-3 py-2.5 whitespace-nowrap text-right">
                <Link
                  href={`/edit/${row.noteId}`}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Pencil className="h-3 w-3" />
                  Edit
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SortHeader({
  label,
  active,
  order,
  onClick,
  className = "",
}: {
  label: string;
  active: boolean;
  order: SortOrder;
  onClick: () => void;
  className?: string;
}) {
  return (
    <th className={`px-3 py-2.5 font-medium ${className}`}>
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
        aria-sort={active ? (order === "asc" ? "ascending" : "descending") : "none"}
      >
        {label}
        {active ? (
          order === "asc" ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )
        ) : (
          <ChevronsUpDown className="h-3.5 w-3.5 opacity-40" />
        )}
      </button>
    </th>
  );
}
